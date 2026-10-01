// Maintenance › "Getting worse" (monthly upgrade, October 2026).
//
// Compares each fault's last 7 full days with its usual week (the 28 days
// before, ÷ 4) and lists the faults that are rising — the plant's total can
// stay flat while one machine quietly gets much worse.
//
// Counting is the same as Top losses:
// - events come in already collapsed (collapseStoppageEvents), so a stoppage
//   counts once with its own window;
// - minutes are eventDowntimeMinutes (closed days left out, open events and
//   stops_line = false count 0 min but still count as a stop);
// - preventive is not a fault and is left out;
// - faults are grouped by line + faultKey (trimmed, case-insensitive title).
// Today is still running, so the window always ends yesterday.
import { iso } from "@/lib/date-utils";
import { eventDowntimeMinutes, faultKey, type ClosedDays } from "@/lib/maintenance-format";
import type { MaintenanceEvent } from "@/lib/queries";

export const TREND_RECENT_DAYS = 7;
export const TREND_BASE_DAYS = 28;
/** Rising = the last 7 days at this many times the usual week, or more. */
export const TREND_RISE = 1.5;
/** …and big enough to matter: at least this many stops, or minutes. */
export const TREND_MIN_STOPS = 3;
export const TREND_MIN_MINUTES = 60;
/** Getting better = a usual week of at least 7 stops, now at ≤ 85% on both. */
export const TREND_BETTER_BASE_STOPS = 7;
export const TREND_BETTER_RATIO = 0.85;

export type TrendLens = "time" | "count";

export interface TrendWindow {
  /** First day of the 28-day base. */
  from: string;
  /** Yesterday: the last full day. */
  to: string;
  /** First day of the last 7 days. */
  recentFrom: string;
  /** Last day of the base. */
  baseTo: string;
  /** All 35 days, oldest first. */
  days: string[];
}

function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return iso(d);
}

export function faultTrendWindow(today: string = iso(new Date())): TrendWindow {
  const to = addDays(today, -1);
  const from = addDays(to, -(TREND_RECENT_DAYS + TREND_BASE_DAYS - 1));
  const recentFrom = addDays(to, -(TREND_RECENT_DAYS - 1));
  const baseTo = addDays(recentFrom, -1);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return { from, to, recentFrom, baseTo, days };
}

/**
 * A looser key, only to spot the same machine logged under another name
 * ("Twist Machine no 3" vs "Twist 3"). Never used to merge: numbers stay, so
 * Servo 1003 and Servo 1004 never match.
 */
export function looseFaultKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w && !["machine", "no", "number", "nr", "num", "the"].includes(w))
    .join(" ");
}

export interface TrendDay {
  stops: number;
  minutes: number;
}

export interface TrendEvent {
  event: MaintenanceEvent;
  minutes: number;
}

export interface FaultTrendRow {
  key: string;
  lineId: string | null;
  lineName: string;
  /** Spelling of the latest stop. */
  title: string;
  /** Last 7 days. */
  stops7: number;
  minutes7: number;
  /** The 28 days before. */
  stops28: number;
  minutes28: number;
  /** Usual week = the 28 days ÷ 4. */
  usualStops: number;
  usualMinutes: number;
  /** Not seen at all in the 28 days before. */
  isNew: boolean;
  /** Which measure rose enough to list it. */
  risingByStops: boolean;
  risingByMinutes: boolean;
  /** One entry per day of the window, oldest first. */
  daily: TrendDay[];
  /** Latest first. */
  latest: TrendEvent[];
  lastSeen: string;
  /** Same machine under another spelling, on the same line (not merged). */
  lookalikes: { title: string; stops: number; minutes: number; lastSeen: string }[];
}

export interface FaultTrendResult {
  window: TrendWindow;
  /** All faults a day, last 7 vs the 28 before. */
  perDay7: number;
  perDay28: number;
  rising: FaultTrendRow[];
  better: FaultTrendRow[];
}

/** The measure a row shows under a lens: the lens itself if it flagged the row, else the one that did. */
export function rowMeasure(row: FaultTrendRow, lens: TrendLens): TrendLens {
  if (lens === "time") return row.risingByMinutes || !row.risingByStops ? "time" : "count";
  return row.risingByStops || !row.risingByMinutes ? "count" : "time";
}

/** Times its usual week, for the measure shown (null when new). */
export function rowRatio(row: FaultTrendRow, measure: TrendLens): number | null {
  if (row.isNew) return null;
  const usual = measure === "time" ? row.usualMinutes : row.usualStops;
  const now = measure === "time" ? row.minutes7 : row.stops7;
  return usual > 0 ? now / usual : null;
}

export function sortTrend(rows: FaultTrendRow[], lens: TrendLens): FaultTrendRow[] {
  const gap = (r: FaultTrendRow) =>
    lens === "time" ? r.minutes7 - r.usualMinutes : r.stops7 - r.usualStops;
  return [...rows].sort(
    (a, b) => gap(b) - gap(a) || b.minutes7 - a.minutes7 || a.title.localeCompare(b.title),
  );
}

export function faultTrend(input: {
  /** Collapsed events (collapseStoppageEvents) started inside the window. */
  events: MaintenanceEvent[];
  closed: ClosedDays;
  lineNames: Map<string, string>;
  window: TrendWindow;
}): FaultTrendResult {
  const { window: w } = input;
  const dayIndex = new Map(w.days.map((d, i) => [d, i]));
  const groups = new Map<
    string,
    {
      lineId: string | null;
      fkey: string;
      daily: TrendDay[];
      events: TrendEvent[];
    }
  >();
  let total7 = 0;
  let total28 = 0;

  for (const e of input.events) {
    if (e.type === "preventive") continue;
    const day = iso(new Date(e.started_at));
    const i = dayIndex.get(day);
    if (i === undefined) continue;
    const minutes = eventDowntimeMinutes(e, input.closed);
    const fkey = faultKey(e.title);
    const key = `${e.line_id ?? "-"}|${fkey}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        lineId: e.line_id,
        fkey,
        daily: w.days.map(() => ({ stops: 0, minutes: 0 })),
        events: [],
      };
      groups.set(key, g);
    }
    g.daily[i].stops += 1;
    g.daily[i].minutes += minutes;
    g.events.push({ event: e, minutes });
    if (day >= w.recentFrom) total7 += 1;
    else total28 += 1;
  }

  const rows: FaultTrendRow[] = [];
  for (const [key, g] of groups) {
    const recentStart = TREND_BASE_DAYS;
    let stops7 = 0;
    let minutes7 = 0;
    let stops28 = 0;
    let minutes28 = 0;
    g.daily.forEach((d, i) => {
      if (i >= recentStart) {
        stops7 += d.stops;
        minutes7 += d.minutes;
      } else {
        stops28 += d.stops;
        minutes28 += d.minutes;
      }
    });
    const usualStops = stops28 / 4;
    const usualMinutes = minutes28 / 4;
    const risingByStops = stops7 >= TREND_MIN_STOPS && stops7 >= TREND_RISE * usualStops;
    const risingByMinutes = minutes7 >= TREND_MIN_MINUTES && minutes7 >= TREND_RISE * usualMinutes;
    const latest = [...g.events].sort((a, b) =>
      b.event.started_at.localeCompare(a.event.started_at),
    );
    rows.push({
      key,
      lineId: g.lineId,
      lineName: (g.lineId && input.lineNames.get(g.lineId)) || "No line",
      title: latest[0].event.title.trim(),
      stops7,
      minutes7,
      stops28,
      minutes28,
      usualStops,
      usualMinutes,
      isNew: stops28 === 0,
      risingByStops,
      risingByMinutes,
      daily: g.daily,
      latest: latest.slice(0, 3),
      lastSeen: latest[0].event.started_at,
      lookalikes: [],
    });
  }

  const rising = rows.filter((r) => r.stops7 > 0 && (r.risingByStops || r.risingByMinutes));
  const better = rows.filter(
    (r) =>
      r.usualStops >= TREND_BETTER_BASE_STOPS &&
      r.stops7 <= TREND_BETTER_RATIO * r.usualStops &&
      r.minutes7 <= TREND_BETTER_RATIO * r.usualMinutes,
  );

  // Other spellings of a rising fault on the same line, for a note only.
  for (const r of rising) {
    const loose = looseFaultKey(r.title);
    if (!loose) continue;
    r.lookalikes = rows
      .filter((o) => o.key !== r.key && o.lineId === r.lineId && looseFaultKey(o.title) === loose)
      .map((o) => ({
        title: o.title,
        stops: o.stops7 + o.stops28,
        minutes: o.minutes7 + o.minutes28,
        lastSeen: o.lastSeen,
      }));
  }

  return {
    window: w,
    perDay7: total7 / TREND_RECENT_DAYS,
    perDay28: total28 / TREND_BASE_DAYS,
    rising,
    better: [...better].sort(
      (a, b) => a.minutes7 / Math.max(a.usualMinutes, 1) - b.minutes7 / Math.max(b.usualMinutes, 1),
    ),
  };
}

// ---------------------------------------------------------------------------
// Labels shared by the card and the PDF, so the two always read the same.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "28 Sep" */
export function trendDayLabel(day: string): string {
  const d = parseDay(day);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "25–30 Sep", "25 Sep–1 Oct" */
export function trendRangeLabel(from: string, to: string): string {
  const a = parseDay(from);
  const b = parseDay(to);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear())
    return `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}`;
  return `${trendDayLabel(from)}–${trendDayLabel(to)}`;
}

/** "1 Oct 07:04" in local time. */
export function trendStampLabel(isoTs: string): string {
  const d = new Date(isoTs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${hh}:${mm}`;
}

/** 1,250 · 248 · 42.5 · 0.8 */
export function trendNum(v: number): string {
  if (v >= 100) return Math.round(v).toLocaleString("en-US");
  return String(Math.round(v * 10) / 10);
}

/** "×2.1", "×12" */
export function trendTimes(ratio: number): string {
  return `×${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}`;
}

/** The sentence under the title: all faults a day, now vs usual. */
export function trendSummary(r: FaultTrendResult): {
  total: string;
  verdict: string;
  rising: string;
} {
  const now = r.perDay7;
  const usual = r.perDay28;
  let verdict = "about the same";
  if (usual > 0 && now >= usual * 1.1) verdict = "more than usual";
  else if (usual > 0 && now <= usual * 0.9) verdict = "fewer than usual";
  else if (usual === 0 && now > 0) verdict = "more than usual";
  const n = r.rising.length;
  const rising =
    n === 0
      ? "No fault is rising."
      : `${n} fault${n === 1 ? " is" : "s are"} rising${verdict === "more than usual" ? "" : " underneath"}.`;
  return { total: `${trendNum(now)} a day vs ${trendNum(usual)} usual`, verdict, rising };
}

export const TREND_RULES =
  "Shows a fault when its last 7 days run at 1.5× its usual week or more, with at least 3 stops or 60 min. Usual week = the 28 days before ÷ 4. New = not seen in the 28 days before. Preventive is left out; a stoppage counts once.";
