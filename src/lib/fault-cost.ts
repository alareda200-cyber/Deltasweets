// What faults cost, in kilograms (upgrade 4, October 2026).
//
// A fault minute is worth the product the plan expected in that minute: the
// line's plan pace = making plan ÷ available minutes, over the same days. The
// month's plan then splits cleanly into three parts:
//
//   plan = made + lost to faults + other losses
//
// "Other losses" is everything else that kept the line under plan — stops
// logged in the daily entries and running slower than plan.
//
// Only days with a daily entry count, the same rule the Dashboard uses for
// machine stops: without an entry there is no plan or pace to price a minute
// with. Minutes on such days are reported as "not priced", never dropped
// silently. Stops come in already counted the Maintenance way: a stoppage
// once with its own window, open faults and faults where the line kept
// running at 0 minutes, non-production time left out.
import type { DailyEntry } from "@/lib/queries";
import { faultKey } from "@/lib/maintenance-format";

export interface CostStop {
  lineId: string | null;
  /** Local calendar day the stop started, "YYYY-MM-DD". */
  day: string;
  minutes: number;
  title: string;
  /** Preventive is planned work, not a fault: never priced here. */
  isFault: boolean;
}

export interface LineCost {
  lineId: string;
  name: string;
  /** Making plan and actual over the entry days, kg. */
  plan: number;
  made: number;
  /** kg a minute the plan expected. */
  pace: number;
  lostKg: number;
  lostMinutes: number;
  /** plan − made − lost, never below 0. */
  otherKg: number;
  stops: number;
  entryDays: number;
}

export interface FaultCostRow {
  key: string;
  lineId: string;
  lineName: string;
  /** Spelling of the latest stop. */
  title: string;
  stops: number;
  minutes: number;
  kg: number;
  /** Minutes per day. */
  byDay: Record<string, number>;
}

export interface FaultCost {
  lines: LineCost[];
  /** Every priced fault, all lines, by kg. */
  rows: FaultCostRow[];
  /** Fault minutes on days with no daily entry (or a line with no plan). */
  unpricedMinutes: number;
}

export function faultCost(input: {
  stops: CostStop[];
  entries: DailyEntry[];
  lines: { id: string; name: string }[];
}): FaultCost {
  const names = new Map(input.lines.map((l) => [l.id, l.name]));
  // Entry days and plan pace per line.
  const perLine = new Map<
    string,
    { plan: number; made: number; available: number; days: Set<string> }
  >();
  for (const e of input.entries) {
    let p = perLine.get(e.line_id);
    if (!p) {
      p = { plan: 0, made: 0, available: 0, days: new Set() };
      perLine.set(e.line_id, p);
    }
    p.plan += Number(e.making_plan) || 0;
    p.made += Number(e.making_actual) || 0;
    p.available += Number(e.available_min) || 0;
    p.days.add(e.entry_date);
  }

  let unpriced = 0;
  const rowsByKey = new Map<string, FaultCostRow & { latest: string }>();
  const lostMin = new Map<string, number>();
  const stopCount = new Map<string, number>();
  for (const s of input.stops) {
    if (!s.isFault || s.minutes <= 0) continue;
    const p = s.lineId ? perLine.get(s.lineId) : undefined;
    if (!s.lineId || !p || !p.days.has(s.day) || p.available <= 0 || p.plan <= 0) {
      unpriced += s.minutes;
      continue;
    }
    const pace = p.plan / p.available;
    const key = `${s.lineId}|${faultKey(s.title)}`;
    let r = rowsByKey.get(key);
    if (!r) {
      r = {
        key,
        lineId: s.lineId,
        lineName: names.get(s.lineId) ?? "—",
        title: s.title.trim(),
        latest: s.day,
        stops: 0,
        minutes: 0,
        kg: 0,
        byDay: {},
      };
      rowsByKey.set(key, r);
    }
    if (s.day >= r.latest) {
      r.latest = s.day;
      r.title = s.title.trim();
    }
    r.stops += 1;
    r.minutes += s.minutes;
    r.kg += s.minutes * pace;
    r.byDay[s.day] = (r.byDay[s.day] ?? 0) + s.minutes;
    lostMin.set(s.lineId, (lostMin.get(s.lineId) ?? 0) + s.minutes);
    stopCount.set(s.lineId, (stopCount.get(s.lineId) ?? 0) + 1);
  }

  const lines: LineCost[] = [];
  for (const [lineId, p] of perLine) {
    if (p.available <= 0 || p.plan <= 0) continue;
    const pace = p.plan / p.available;
    const minutes = lostMin.get(lineId) ?? 0;
    const lostKg = minutes * pace;
    lines.push({
      lineId,
      name: names.get(lineId) ?? "—",
      plan: p.plan,
      made: p.made,
      pace,
      lostKg,
      lostMinutes: minutes,
      otherKg: Math.max(0, p.plan - p.made - lostKg),
      stops: stopCount.get(lineId) ?? 0,
      entryDays: p.days.size,
    });
  }
  lines.sort((a, b) => b.lostKg - a.lostKg || a.name.localeCompare(b.name));
  const rows = [...rowsByKey.values()]
    .map(({ latest: _latest, ...r }) => r)
    .sort((a, b) => b.kg - a.kg || b.minutes - a.minutes || a.title.localeCompare(b.title));
  return { lines, rows, unpricedMinutes: unpriced };
}

/** "89.1 t", "135 kg" */
export function tonnes(kg: number): string {
  return kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg)} kg`;
}
