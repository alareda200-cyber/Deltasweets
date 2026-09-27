// Machine downtime for the dashboard: faults and preventive work logged on
// the Maintenance page, counted the same way that page counts them.
//
// - A stoppage is one window. Events sharing a stoppage_id collapse into one
//   stop timed by the stoppage itself (collapseStoppageEvents), never the
//   sum of its members.
// - Downtime follows eventDowntimeMinutes: nothing while an event is still
//   open, nothing when the line kept running (stops_line = false), and no
//   minutes on a recorded non-production day.
// - Preventive maintenance is planned time, not a fault: it adds to planned
//   downtime but never to the fault count.

import { iso } from "@/lib/date-utils";
import { eventDowntimeMinutes, type ClosedDays } from "@/lib/maintenance-format";
import {
  collapseStoppageEvents,
  type MaintenanceEvent,
  type MaintenanceStoppage,
  type MaintenanceType,
} from "@/lib/queries";
import type { ReasonRow, TimeSplit } from "@/lib/dashboard-metrics";

export interface MachineStop {
  id: string;
  title: string;
  type: MaintenanceType;
  /** Downtime charged to the line (see the rules above). */
  minutes: number;
  /** Local calendar day the stop started on, "YYYY-MM-DD". */
  day: string;
  open: boolean;
  /** Events in this stop: 1 for a standalone fault, n for a stoppage. */
  members: number;
}

export function machineStops(
  events: MaintenanceEvent[],
  stoppages: MaintenanceStoppage[],
  closed: ClosedDays,
): MachineStop[] {
  const members = new Map<string, number>();
  for (const e of events) {
    if (e.stoppage_id) members.set(e.stoppage_id, (members.get(e.stoppage_id) ?? 0) + 1);
  }
  return collapseStoppageEvents(events, stoppages).map((e) => ({
    id: e.stoppage_id ?? e.id,
    title: e.title.trim(),
    type: e.type,
    minutes: eventDowntimeMinutes(e, closed),
    day: iso(new Date(e.started_at)),
    open: e.status !== "resolved" || !e.resolved_at,
    members: e.stoppage_id ? (members.get(e.stoppage_id) ?? 1) : 1,
  }));
}

export const isFault = (t: MaintenanceType) => t !== "preventive";

/** Planned = preventive, unplanned = every fault type. */
export function machineSplit(stops: MachineStop[]): TimeSplit {
  const s: TimeSplit = { total: 0, planned: 0, unplanned: 0, unclassified: 0 };
  for (const st of stops) {
    s.total += st.minutes;
    if (isFault(st.type)) s.unplanned += st.minutes;
    else s.planned += st.minutes;
  }
  return s;
}

export function addSplits(a: TimeSplit, b: TimeSplit): TimeSplit {
  return {
    total: a.total + b.total,
    planned: a.planned + b.planned,
    unplanned: a.unplanned + b.unplanned,
    unclassified: a.unclassified + b.unclassified,
  };
}

const TYPE_ROW: Record<MaintenanceType, string> = {
  mechanical: "Mechanical faults",
  electrical: "Electrical faults",
  refrigeration: "Refrigeration faults",
  preventive: "Preventive maintenance",
};

/**
 * One "Where the time went" row per maintenance type, so hundreds of short
 * faults read as one cause next to the daily-entry reasons. The per-fault
 * detail lives on the Maintenance card and page.
 */
export function machineReasonRows(stops: MachineStop[]): ReasonRow[] {
  const byType = new Map<MaintenanceType, ReasonRow>();
  for (const st of stops) {
    if (st.minutes <= 0) continue;
    const cur = byType.get(st.type);
    if (cur) {
      cur.count += 1;
      cur.minutes += st.minutes;
    } else {
      byType.set(st.type, {
        key: `machine:${st.type}`,
        name: TYPE_ROW[st.type],
        kind: isFault(st.type) ? "unplanned" : "planned",
        severity: null,
        area: "Maintenance page",
        count: 1,
        minutes: st.minutes,
      });
    }
  }
  return Array.from(byType.values());
}

export function mergeReasonRows(a: ReasonRow[], b: ReasonRow[]): ReasonRow[] {
  return [...a, ...b].sort((x, y) => y.minutes - x.minutes || x.name.localeCompare(y.name));
}

export interface FaultTitleRow {
  title: string;
  type: MaintenanceType;
  count: number;
  minutes: number;
}

/** Faults (preventive left out) grouped by title, longest downtime first. */
export function faultsByTitle(stops: MachineStop[]): FaultTitleRow[] {
  const by = new Map<string, FaultTitleRow>();
  for (const st of stops) {
    if (!isFault(st.type)) continue;
    const key = st.title.toLowerCase();
    const cur = by.get(key);
    if (cur) {
      cur.count += st.members;
      cur.minutes += st.minutes;
    } else {
      by.set(key, { title: st.title, type: st.type, count: st.members, minutes: st.minutes });
    }
  }
  return Array.from(by.values()).sort(
    (a, b) => b.minutes - a.minutes || b.count - a.count || a.title.localeCompare(b.title),
  );
}
