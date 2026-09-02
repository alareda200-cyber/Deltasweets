import type { MaintenanceType, MaintenanceStatus, MaintenanceMetric } from "@/lib/queries";

// Shared between src/routes/maintenance.tsx and
// src/components/MaintenanceDowntimeCard.tsx (Dashboard's "Open Maintenance
// Events" list) — both render the same event rows and must stay visually
// consistent, so labels/formatting live here once instead of twice.

export const TYPE_LABELS: Record<MaintenanceType, string> = {
  mechanical: "Mechanical",
  electrical: "Electrical",
  preventive: "Preventive Maintenance",
  refrigeration: "Refrigeration",
};
export const STATUS_LABELS: Record<MaintenanceStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
};

export function typeBadgeVariant(t: MaintenanceType) {
  if (t === "mechanical") return "secondary";
  if (t === "preventive") return "default";
  if (t === "refrigeration") return "refrigeration";
  return "outline";
}

export function statusBadgeVariant(
  s: MaintenanceStatus,
): "default" | "secondary" | "destructive" | "outline" {
  if (s === "open") return "destructive";
  if (s === "in_progress") return "secondary";
  return "default";
}

// Fixed choices for maintenance_events.severity_label — a plain text
// column (see 20260804220000_maintenance_events_severity.sql), but the
// create/edit UI constrains input to this list via a Select rather than
// letting it be arbitrary free text, so every event's severity reads the
// same regardless of who logged it.
export const SEVERITY_LABEL_OPTIONS = ["Critical", "Major", "Minor", "Low"] as const;

// Matches by name (Critical/Major/Minor/Low) rather than an id — works the
// same whether the name came from severity_levels (real entry_downtimes
// rows) or maintenance_events.severity_label (free text, constrained to
// SEVERITY_LABEL_OPTIONS by the UI). Unrecognized/missing name (including
// "Unclassified") gets the same neutral treatment as no severity at all.
export function severityBadgeVariant(
  name: string | null | undefined,
): "default" | "secondary" | "destructive" | "outline" {
  const n = (name ?? "").trim().toLowerCase();
  if (n === "critical") return "destructive";
  if (n === "major") return "secondary";
  if (n === "minor") return "outline";
  if (n === "low") return "outline";
  return "outline";
}

// Worst (lowest) MTBF first — that's the line+type failing most often, the
// thing an engineer scanning this table actually wants to spot first rather
// than comparing every row by eye against an alphabetical line-name order.
// A null MTBF (fewer than 2 events, so no gap can be computed yet) isn't
// "good" or "bad", just unknown — sorted after every real number. Shared
// between the live /maintenance page's table and the PDF report so both
// present the same ordering.
export function sortByWorstMtbf(metrics: MaintenanceMetric[]): MaintenanceMetric[] {
  return [...metrics].sort((a, b) => {
    if (a.mtbf_hours === null && b.mtbf_hours === null) return 0;
    if (a.mtbf_hours === null) return 1;
    if (b.mtbf_hours === null) return -1;
    return a.mtbf_hours - b.mtbf_hours;
  });
}

export function formatHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

// ---------------------------------------------------------------------------
// Event duration: two questions, two functions, on purpose.
//
// These were one function, copy-pasted into four files, and that is what let a
// fault reported at 04:25 on a Thursday read as 41 hours of "downtime" by the
// Friday — the plant was on holiday for most of it and never scheduled to run.
//
//   elapsed  — how long has this been broken? Wall clock, still running while
//              the event is open. Honest as a status line ("open 41h, nobody
//              has closed it"), meaningless as lost production: it counts
//              holidays, night hours and closed shifts.
//
//   downtime — how much production time did this cost? An open event
//              contributes NOTHING. Not because zero is true, but because the
//              cost is UNKNOWN until it is resolved, and letting the clock run
//              silently invents minutes the plant never lost. Every caller
//              showing a downtime total must also show how many open events
//              were excluded (openEventCount) — quietly dropping time is the
//              same class of error as quietly inventing it.
//
// This does NOT make downtime correct yet: a resolved event's window still
// spans any non-working hours inside it. Fixing that needs a production
// calendar — an explicit record of when the plant is scheduled to run.
// Absence of a daily entry cannot substitute for one: it cannot tell "closed
// today" from "not filled in yet", and guessing wrong erases real faults.
// ---------------------------------------------------------------------------

/** Wall-clock time since the event started. Runs to now while it is open. */
export function eventElapsedMinutes(e: { started_at: string; resolved_at: string | null }): number {
  const startedMs = new Date(e.started_at).getTime();
  const endMs = e.resolved_at ? new Date(e.resolved_at).getTime() : Date.now();
  return Math.max(0, (endMs - startedMs) / 60_000);
}

/**
 * Days the plant was not scheduled to run, keyed by line.
 * Built by nonProductionDayLookup() from the non_production_days table.
 */
export interface ClosedDays {
  /**
   * Minutes of [from, to) that fall inside a recorded closure for this line.
   * `from`/`to` are within a single local calendar day.
   *
   * Returns minutes rather than a boolean because a closure can be partial:
   * 27/8 ran its night shift and only closed at 08:00. A whole-day answer
   * would have to either delete that shift or keep counting the holiday.
   */
  closedMinutes(lineId: string | null, from: Date, to: Date): number;
}

/**
 * Production time lost.
 *
 * 0 while the event is open — the cost is not known until it is resolved, and
 * running the clock invents minutes the plant never lost. 0 too when
 * stops_line is false: the line never stopped, so nothing was lost.
 *
 * Time falling on a day this line was not scheduled to run is excluded. That
 * exclusion is driven ONLY by explicitly recorded non-production days: a day
 * nobody recorded counts in full, because "no record" means "unknown", never
 * "closed". Erring the other way would silently delete real faults reported on
 * days whose paperwork simply had not been filed yet.
 *
 * `closed` is required rather than optional on purpose. This rule used to live
 * as four copy-pasted functions that drifted apart; an optional argument would
 * let a call site quietly fall back to the old behaviour and start that again.
 */
export function eventDowntimeMinutes(
  e: {
    started_at: string;
    resolved_at: string | null;
    line_id: string | null;
    stops_line: boolean;
  },
  closed: ClosedDays,
): number {
  // The fault happened, but the line kept producing — so it cost no production
  // time. It still counts as an event everywhere else (MTBF, repeat-failure,
  // frequency), which is the whole reason this is a flag and not a deletion.
  if (!e.stops_line) return 0;
  if (!e.resolved_at) return 0;
  const start = new Date(e.started_at);
  const end = new Date(e.resolved_at);
  if (end <= start) return 0;

  // Walk the window one local calendar day at a time: an event can span a
  // holiday in the middle (broke Thursday, fixed Saturday) and only the
  // scheduled part of that span is lost production.
  let total = 0;
  let cursor = start;
  while (cursor < end) {
    const nextMidnight = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    const sliceEnd = nextMidnight < end ? nextMidnight : end;
    const sliceMinutes = (sliceEnd.getTime() - cursor.getTime()) / 60_000;
    total += sliceMinutes - closed.closedMinutes(e.line_id, cursor, sliceEnd);
    cursor = sliceEnd;
  }
  return total;
}

// Local-calendar date string. Duplicated from date-utils' iso() rather than
// imported so this module stays dependency-free for the PDF renderer, which
// mounts it outside the app tree.
function isoLocalDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export interface NonProductionRow {
  line_id: string | null;
  /** Local calendar date, "YYYY-MM-DD". */
  day: string;
  /** Local "HH:MM[:SS]". null = from the start of the day. */
  closed_from: string | null;
  /** Local "HH:MM[:SS]". null = until the end of the day. */
  closed_to: string | null;
}

/** Minutes from local midnight, or a default when the time is absent. */
function minutesOfDay(t: string | null, fallback: number): number {
  if (!t) return fallback;
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Builds the lookup. An all-lines row (line_id null) closes every line, and a
 * line can be closed by an all-lines row and its own row on the same date, so
 * every matching row is considered and the widest closure wins.
 */
export function nonProductionDayLookup(rows: NonProductionRow[]): ClosedDays {
  const byDay = new Map<string, NonProductionRow[]>();
  for (const r of rows) {
    const list = byDay.get(r.day);
    if (list) list.push(r);
    else byDay.set(r.day, [r]);
  }
  return {
    closedMinutes(lineId, from, to) {
      const day = isoLocalDay(from);
      const rowsForDay = byDay.get(day);
      if (!rowsForDay) return 0;

      const dayStart = new Date(from.getFullYear(), from.getMonth(), from.getDate());
      const sliceFrom = (from.getTime() - dayStart.getTime()) / 60_000;
      const sliceTo = (to.getTime() - dayStart.getTime()) / 60_000;

      // Overlapping closures are unioned, not summed — an all-lines holiday and
      // a line-specific shutdown on the same date must not subtract the same
      // minute twice and drive the result negative.
      let covered = 0;
      let cursor = sliceFrom;
      const windows = rowsForDay
        .filter((r) => r.line_id === null || r.line_id === lineId)
        .map((r) => [minutesOfDay(r.closed_from, 0), minutesOfDay(r.closed_to, 1440)] as const)
        .sort((a, b) => a[0] - b[0]);
      for (const [wStart, wEnd] of windows) {
        const start = Math.max(wStart, cursor, sliceFrom);
        const end = Math.min(wEnd, sliceTo);
        if (end > start) {
          covered += end - start;
          cursor = end;
        }
      }
      return covered;
    },
  };
}

/** How many of these are still open — the minutes a downtime total leaves out. */
export function openEventCount(events: { resolved_at: string | null }[]): number {
  return events.reduce((n, e) => n + (e.resolved_at ? 0 : 1), 0);
}

export function formatDuration(ms: number): string {
  if (ms < 0) return "—";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

// datetime-local inputs need "YYYY-MM-DDTHH:mm" in the browser's local time
// (no timezone suffix) — building it from getters instead of toISOString()
// avoids a UTC round-trip that would shift the displayed/edited time.
export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
