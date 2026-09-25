// Pure maths for the Production dashboard (src/routes/index.tsx).
//
// Everything here is computed from rows the page already fetched — no
// queries, no React — so each number on the page can be traced to one
// function and checked by hand.
//
// Scope rules the page relies on:
// - "Time lost" is DAILY ENTRIES ONLY: entry_downtimes minutes ÷ available
//   minutes. Maintenance events are never added in — the same stop is often
//   logged on both pages, so adding them would count it twice.
// - Preventive maintenance is not a fault: it never counts as "stopped" or as
//   a known defect in the Right now strip.

import type {
  AreaOwner,
  DailyEntry,
  DowntimeType,
  EntryAreaOwner,
  EntryDowntime,
  MaintenanceEvent,
  ProductionArea,
  SeverityLevel,
} from "@/lib/queries";
import { iso } from "@/lib/date-utils";

// Fixed targets. There is no Targets table yet, so these stay hard-coded (the
// same 90% / 70% cut-offs and 10% / 25% loss bands the old sections used).
export const ADHERENCE_TARGET = 0.9;
export const ADHERENCE_WARN = 0.7;
export const LOSS_ALERT_PCT = 10;
export const LOSS_BAD_PCT = 25;

export type Tone = "success" | "warning" | "danger" | "neutral";

export function adherenceTone(adh: number): Tone {
  if (adh >= ADHERENCE_TARGET) return "success";
  if (adh >= ADHERENCE_WARN) return "warning";
  return "danger";
}

export function lossTone(lossPct: number): Tone {
  if (lossPct < LOSS_ALERT_PCT) return "success";
  if (lossPct < LOSS_BAD_PCT) return "warning";
  return "danger";
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

// Fixed names: en-GB in newer ICU spells September "Sept".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return iso(d);
}

export function todayIso(): string {
  return iso(new Date());
}

/** "1–23 Sep 2026", "28 Aug – 3 Sep 2026", "28 Dec 2025 – 3 Jan 2026". */
export function formatRange(from: string, to: string): string {
  const a = parseDay(from);
  const b = parseDay(to);
  if (from === to) return `${a.getDate()} ${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  if (a.getFullYear() === b.getFullYear()) {
    if (a.getMonth() === b.getMonth()) {
      return `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
    }
    return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
  }
  return `${a.getDate()} ${MONTHS[a.getMonth()]} ${a.getFullYear()} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
}

/** Same as formatRange without the year — for tight mobile labels. */
export function formatRangeShort(from: string, to: string): string {
  const full = formatRange(from, to);
  const a = parseDay(from);
  const b = parseDay(to);
  if (a.getFullYear() !== b.getFullYear()) return full;
  return full.replace(` ${b.getFullYear()}`, "").replace(` ${a.getFullYear()}`, "");
}

/** "Wed 23 Sep". */
export function formatDayName(day: string): string {
  const d = parseDay(day);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "23 Sep". */
export function formatDayShort(day: string): string {
  const d = parseDay(day);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * The part of [from, to] that has already happened: `to` is capped at today,
 * so "This month" on 25 Sep reads 1–25 Sep rather than promising 26–30.
 * Never returns an end before the start.
 */
export function elapsedRange(
  from: string,
  to: string,
  today = todayIso(),
): { from: string; to: string } {
  const end = to > today ? today : to;
  return { from, to: end < from ? from : end };
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  if (from > to) return out;
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const kg = (n: number) => nf0.format(Math.round(n));
export const num = (n: number) => nf0.format(Math.round(n));
export const pct1 = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export interface Totals {
  makingPlan: number;
  makingActual: number;
  packingPlan: number;
  packingActual: number;
  availableMin: number;
  reworkCooking: number;
  reworkMaking: number;
  reworkPacking: number;
}

export function sumEntries(entries: DailyEntry[]): Totals {
  const t: Totals = {
    makingPlan: 0,
    makingActual: 0,
    packingPlan: 0,
    packingActual: 0,
    availableMin: 0,
    reworkCooking: 0,
    reworkMaking: 0,
    reworkPacking: 0,
  };
  for (const e of entries) {
    t.makingPlan += Number(e.making_plan) || 0;
    t.makingActual += Number(e.making_actual) || 0;
    t.packingPlan += Number(e.packing_plan) || 0;
    t.packingActual += Number(e.packing_actual) || 0;
    t.availableMin += Number(e.available_min) || 0;
    t.reworkCooking += Number(e.rework_cooking) || 0;
    t.reworkMaking += Number(e.rework_making) || 0;
    t.reworkPacking += Number(e.rework_packing) || 0;
  }
  return t;
}

export const reworkTotal = (t: Totals) => t.reworkCooking + t.reworkMaking + t.reworkPacking;
export const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

/** Distinct entry dates — "production days". */
export function productionDays(entries: DailyEntry[]): number {
  return new Set(entries.map((e) => e.entry_date)).size;
}

/** Every row of one calendar day summed — a day can hold several shift rows. */
export function entriesByDay(entries: DailyEntry[]): Map<string, DailyEntry[]> {
  const m = new Map<string, DailyEntry[]>();
  for (const e of entries) {
    const arr = m.get(e.entry_date);
    if (arr) arr.push(e);
    else m.set(e.entry_date, [e]);
  }
  return m;
}

export interface DayPoint {
  day: string;
  hasEntry: boolean;
  plan: number | null;
  actual: number | null;
}

/** One point per calendar day in [from, to]; days with no entry have nulls. */
export function dailySeries(
  entries: DailyEntry[],
  from: string,
  to: string,
  stage: "making" | "packing",
): DayPoint[] {
  const byDay = entriesByDay(entries);
  return eachDay(from, to).map((day) => {
    const rows = byDay.get(day);
    if (!rows) return { day, hasEntry: false, plan: null, actual: null };
    const t = sumEntries(rows);
    return {
      day,
      hasEntry: true,
      plan: stage === "making" ? t.makingPlan : t.packingPlan,
      actual: stage === "making" ? t.makingActual : t.packingActual,
    };
  });
}

/** The plan every recorded day shares, or null when it varies. */
export function uniformPlan(points: DayPoint[]): number | null {
  const plans = points.filter((p) => p.hasEntry).map((p) => p.plan ?? 0);
  if (plans.length === 0) return null;
  return plans.every((p) => p === plans[0]) ? plans[0] : null;
}

// ---------------------------------------------------------------------------
// Time lost (daily entries only)
// ---------------------------------------------------------------------------

export type DowntimeKind = "planned" | "unplanned" | "unclassified";

export function downtimeKindResolver(types: DowntimeType[]) {
  const byId = new Map(types.map((t) => [t.id, t.name.trim().toLowerCase()]));
  return (typeId: string | null): DowntimeKind => {
    const name = typeId ? byId.get(typeId) : undefined;
    if (name === "planned") return "planned";
    if (name === "unplanned") return "unplanned";
    return "unclassified";
  };
}

export interface TimeSplit {
  total: number;
  planned: number;
  unplanned: number;
  unclassified: number;
}

export function splitDowntime(
  downtimes: EntryDowntime[],
  kindOf: (typeId: string | null) => DowntimeKind,
): TimeSplit {
  const s: TimeSplit = { total: 0, planned: 0, unplanned: 0, unclassified: 0 };
  for (const d of downtimes) {
    const m = Number(d.minutes) || 0;
    s.total += m;
    s[kindOf(d.downtime_type_id)] += m;
  }
  return s;
}

export interface ReasonRow {
  key: string;
  name: string;
  kind: DowntimeKind;
  severity: string | null;
  area: string | null;
  count: number;
  minutes: number;
}

export function reasonRows(
  downtimes: EntryDowntime[],
  kindOf: (typeId: string | null) => DowntimeKind,
  severities: SeverityLevel[],
  areas: ProductionArea[],
): ReasonRow[] {
  const sevById = new Map(severities.map((s) => [s.id, s.name]));
  const areaById = new Map(areas.map((a) => [a.id, a.name]));
  const byKey = new Map<string, ReasonRow>();
  for (const d of downtimes) {
    const key = d.reason_id ?? `name:${d.reason_name}`;
    const cur = byKey.get(key);
    const m = Number(d.minutes) || 0;
    if (cur) {
      cur.count += 1;
      cur.minutes += m;
    } else {
      byKey.set(key, {
        key,
        name: d.reason_name,
        kind: kindOf(d.downtime_type_id),
        severity: d.severity_id ? (sevById.get(d.severity_id) ?? null) : null,
        area: d.production_area_id ? (areaById.get(d.production_area_id) ?? null) : null,
        count: 1,
        minutes: m,
      });
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name),
  );
}

export const KIND_LABEL: Record<DowntimeKind, string> = {
  planned: "Planned",
  unplanned: "Unplanned",
  unclassified: "Unclassified",
};

// ---------------------------------------------------------------------------
// Right now (live, all lines)
// ---------------------------------------------------------------------------

export interface RightNow {
  stoppedLineNames: string[];
  /** Open, non-preventive faults that are not stopping their line. */
  knownDefects: number;
}

// Same split as RightNowSection on /maintenance: stops_line decides whether a
// line is stopped. Preventive work is scheduled, not a fault, so it is left
// out entirely here.
export function summarizeRightNow(openEvents: MaintenanceEvent[]): RightNow {
  const faults = openEvents.filter((e) => e.type !== "preventive" && e.status !== "resolved");
  const stopping = faults.filter((e) => e.stops_line);
  const names = Array.from(
    new Set(stopping.map((e) => e.production_lines?.name ?? "Unassigned line")),
  );
  return {
    stoppedLineNames: names.sort((a, b) => a.localeCompare(b)),
    knownDefects: faults.filter((e) => !e.stops_line).length,
  };
}

// ---------------------------------------------------------------------------
// Area-owner scores
// ---------------------------------------------------------------------------

export interface ScoreRow {
  key: string;
  area: string;
  areaOrder: number;
  owner: string;
  average: number;
  count: number;
}

export function areaOwnerScores(
  rows: EntryAreaOwner[],
  areas: ProductionArea[],
  owners: AreaOwner[],
): ScoreRow[] {
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const ownerById = new Map(owners.map((o) => [o.id, o.name]));
  const byKey = new Map<string, ScoreRow & { total: number }>();
  for (const r of rows) {
    if (r.performance_score == null) continue;
    const area = areaById.get(r.production_area_id);
    if (!area) continue; // area deactivated or deleted since
    const key = `${r.production_area_id}|${r.owner_id ?? "none"}`;
    const score = Number(r.performance_score);
    const cur = byKey.get(key);
    if (cur) {
      cur.total += score;
      cur.count += 1;
    } else {
      byKey.set(key, {
        key,
        area: area.name,
        areaOrder: area.display_order,
        owner: r.owner_id ? (ownerById.get(r.owner_id) ?? "Unknown owner") : "No owner",
        average: 0,
        count: 1,
        total: score,
      });
    }
  }
  return Array.from(byKey.values())
    .map(({ total, ...r }) => ({ ...r, average: total / r.count }))
    .sort((a, b) => a.areaOrder - b.areaOrder || a.owner.localeCompare(b.owner));
}
