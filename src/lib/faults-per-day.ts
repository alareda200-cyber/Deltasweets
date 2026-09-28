// Dashboard › Maintenance › Faults per day (Ala, 28 Sep 2026).
//
// One bar per calendar day: how many faults were logged that day, counted the
// same way as the Maintenance card's "Faults" (every fault event, preventive
// left out — preventive is planned work, not a fault). The day's stopped
// minutes come from the same stops as the card's "Fault downtime", so a
// stoppage counts its window once.
//
// Most / fewest / average only look at finished days that tell us something:
// today is still running (its number only grows), a later day hasn't
// happened, a recorded non-production day was closed, and a day with no entry
// and no fault is unknown — none of those can be the "best" or "worst" day.
import { iso } from "@/lib/date-utils";
import { eachDay, formatDayName, parseDay, todayIso } from "@/lib/dashboard-metrics";
import { isFault, type MachineStop } from "@/lib/machine-downtime";
import type { ClosedDays } from "@/lib/maintenance-format";

export interface FaultDay {
  day: string;
  faults: number;
  /** Fault downtime that started this day (a stoppage's window once). */
  minutes: number;
  /** Faults on this day still open: their minutes aren't known yet. */
  open: number;
  hasEntry: boolean;
  /** A recorded non-production day for this line, the whole day. */
  closed: boolean;
  isToday: boolean;
  /** After today. */
  future: boolean;
  /** Takes part in most / fewest / average. */
  counted: boolean;
}

export interface FaultDaysSummary {
  days: FaultDay[];
  /** null when no day is counted. `days` = every day that shares the value. */
  most: { faults: number; days: string[] } | null;
  fewest: { faults: number; days: string[] } | null;
  average: number | null;
  countedDays: number;
}

function wholeDayClosed(closed: ClosedDays, lineId: string, day: string): boolean {
  const start = parseDay(day);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const dayMin = (end.getTime() - start.getTime()) / 60_000;
  return closed.closedMinutes(lineId, start, end) >= dayMin - 1;
}

export function faultsPerDay(input: {
  lineId: string;
  from: string;
  to: string;
  /** Maintenance events in the period (any type — preventive is dropped here). */
  events: { type: MachineStop["type"]; started_at: string }[];
  /** machineStops() for the same period. */
  stops: MachineStop[];
  entryDays: Set<string>;
  closed: ClosedDays;
  today?: string;
}): FaultDaysSummary {
  const today = input.today ?? todayIso();
  const faults = new Map<string, number>();
  for (const e of input.events) {
    if (!isFault(e.type)) continue;
    const d = iso(new Date(e.started_at));
    faults.set(d, (faults.get(d) ?? 0) + 1);
  }
  const minutes = new Map<string, number>();
  const open = new Map<string, number>();
  for (const st of input.stops) {
    if (!isFault(st.type)) continue;
    minutes.set(st.day, (minutes.get(st.day) ?? 0) + st.minutes);
    if (st.open) open.set(st.day, (open.get(st.day) ?? 0) + 1);
  }

  const days: FaultDay[] = eachDay(input.from, input.to).map((day) => {
    const n = faults.get(day) ?? 0;
    const hasEntry = input.entryDays.has(day);
    const closed = wholeDayClosed(input.closed, input.lineId, day);
    const isToday = day === today;
    const future = day > today;
    return {
      day,
      faults: n,
      minutes: Math.round(minutes.get(day) ?? 0),
      open: open.get(day) ?? 0,
      hasEntry,
      closed,
      isToday,
      future,
      counted: !isToday && !future && !closed && (hasEntry || n > 0),
    };
  });

  const counted = days.filter((d) => d.counted);
  if (counted.length === 0) {
    return { days, most: null, fewest: null, average: null, countedDays: 0 };
  }
  const hi = Math.max(...counted.map((d) => d.faults));
  const lo = Math.min(...counted.map((d) => d.faults));
  const total = counted.reduce((a, d) => a + d.faults, 0);
  return {
    days,
    most: { faults: hi, days: counted.filter((d) => d.faults === hi).map((d) => d.day) },
    // One counted day, or every day the same: there is no "fewest" apart
    // from the "most".
    fewest:
      hi === lo
        ? null
        : { faults: lo, days: counted.filter((d) => d.faults === lo).map((d) => d.day) },
    average: total / counted.length,
    countedDays: counted.length,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Tue 1 Sep", "Sat 12 · Sun 13 Sep", "4 · 11 · 18 Sep", "5 days". */
export function daysLabel(days: string[]): string {
  if (days.length === 1) return formatDayName(days[0]);
  const ds = days.map(parseDay);
  const sameMonth = ds.every(
    (d) => d.getMonth() === ds[0].getMonth() && d.getFullYear() === ds[0].getFullYear(),
  );
  if (days.length === 2 && sameMonth) {
    return `${WEEKDAYS[ds[0].getDay()]} ${ds[0].getDate()} · ${WEEKDAYS[ds[1].getDay()]} ${ds[1].getDate()} ${MONTHS[ds[1].getMonth()]}`;
  }
  if (days.length === 2) return `${formatDayName(days[0])} · ${formatDayName(days[1])}`;
  if (days.length === 3 && sameMonth) {
    return `${ds.map((d) => d.getDate()).join(" · ")} ${MONTHS[ds[0].getMonth()]}`;
  }
  return `${days.length} days`;
}
