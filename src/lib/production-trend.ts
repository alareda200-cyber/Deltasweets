// Dashboard › "vs usual" cards (October 2026): output, operational stops and
// rework. Each line's last 7 full days against its usual — the 28 days
// before — on the same window as Maintenance › Getting worse (35 days ending
// yesterday; today is still running).
//
// Everything is per production day (a day with a daily entry), so a week with
// three entries compares fairly with one that has six. Ratios (adherence,
// rework %) are sums over the window, not averages of daily ratios, so a
// small day can't swing them.
import type { TrendWindow } from "@/lib/fault-trend";
import type { DailyEntry, EntryDowntime } from "@/lib/queries";

/** Red / green / amber / plain / dashed — same words on every card. */
export type TrendTone = "worse" | "better" | "limit" | "steady" | "none";

export const OUT_POINTS = 5;
export const OUT_MIN_DAYS = 2;
export const RW_RISE = 1.5;
export const RW_MIN_POINTS = 0.3;
export const RW_MIN_KG = 50;
export const RW_BETTER = 0.85;
export const RW_BETTER_BASE = 0.5;
export const LINE_RISE = 1.25;
export const LINE_MIN = 15;
export const LINE_BETTER = 0.8;
export const REASON_RISE = 1.5;
export const REASON_MIN = 5;
export const REASON_BETTER = 0.8;

interface LineInfo {
  id: string;
  name: string;
}

type Part = "recent" | "base" | null;
function partOf(day: string, w: TrendWindow): Part {
  if (day < w.from || day > w.to) return null;
  return day >= w.recentFrom ? "recent" : "base";
}

/** Entries of one line grouped by day, with the window's split. */
interface LineEntries {
  line: LineInfo;
  /** Index into w.days → that day's rows (several shifts add up). */
  byDay: Map<number, DailyEntry[]>;
  days7: number;
  days28: number;
  /** Latest entry date anywhere in the window. */
  lastEntry: string | null;
}

function groupByLine(entries: DailyEntry[], lines: LineInfo[], w: TrendWindow): LineEntries[] {
  const index = new Map(w.days.map((d, i) => [d, i]));
  const out = new Map<string, LineEntries>();
  for (const l of lines)
    out.set(l.id, { line: l, byDay: new Map(), days7: 0, days28: 0, lastEntry: null });
  for (const e of entries) {
    const g = out.get(e.line_id);
    const i = index.get(e.entry_date);
    if (!g || i === undefined) continue;
    const rows = g.byDay.get(i);
    if (rows) rows.push(e);
    else {
      g.byDay.set(i, [e]);
      if (partOf(e.entry_date, w) === "recent") g.days7 += 1;
      else g.days28 += 1;
    }
    if (!g.lastEntry || e.entry_date > g.lastEntry) g.lastEntry = e.entry_date;
  }
  // A line with nothing in 35 days has nothing to compare: left out.
  return [...out.values()].filter((g) => g.byDay.size > 0);
}

const sumOf = (rows: DailyEntry[], f: (e: DailyEntry) => number) =>
  rows.reduce((s, e) => s + (Number(f(e)) || 0), 0);

function windowSums(g: LineEntries, w: TrendWindow, f: (e: DailyEntry) => number) {
  let recent = 0;
  let base = 0;
  for (const [i, rows] of g.byDay) {
    const v = sumOf(rows, f);
    if (partOf(w.days[i], w) === "recent") recent += v;
    else base += v;
  }
  return { recent, base };
}

// ---------------------------------------------------------------------------
// Output: actual ÷ plan

export type OutputStage = "making" | "packing";

export interface OutputTile {
  lineId: string;
  name: string;
  tone: TrendTone;
  /** % of plan, last 7 days; null = no entry (or no plan) in them. */
  now: number | null;
  /** % of plan, the 28 days before; null = no plan in them. */
  usual: number | null;
  days7: number;
  lastEntry: string | null;
  /** % of plan per day of the window (null = no entry or no plan). */
  daily: (number | null)[];
  /** Days in the last 7 with a plan and nothing made. */
  zeroDays: string[];
}

export function outputTrend(
  entries: DailyEntry[],
  lines: LineInfo[],
  w: TrendWindow,
  stage: OutputStage,
): OutputTile[] {
  const plan = (e: DailyEntry) => (stage === "making" ? e.making_plan : e.packing_plan);
  const actual = (e: DailyEntry) => (stage === "making" ? e.making_actual : e.packing_actual);
  const tiles = groupByLine(entries, lines, w).map((g): OutputTile => {
    const p = windowSums(g, w, plan);
    const a = windowSums(g, w, actual);
    const now = g.days7 > 0 && p.recent > 0 ? (a.recent / p.recent) * 100 : null;
    const usual = p.base > 0 ? (a.base / p.base) * 100 : null;
    let tone: TrendTone = "steady";
    if (now === null) tone = "none";
    else if (usual !== null && now - usual <= -OUT_POINTS && g.days7 >= OUT_MIN_DAYS)
      tone = "worse";
    else if (usual !== null && now - usual >= OUT_POINTS) tone = "better";
    const daily = w.days.map((_, i) => {
      const rows = g.byDay.get(i);
      if (!rows) return null;
      const pl = sumOf(rows, plan);
      return pl > 0 ? (sumOf(rows, actual) / pl) * 100 : null;
    });
    const zeroDays: string[] = [];
    for (const [i, rows] of g.byDay)
      if (partOf(w.days[i], w) === "recent" && sumOf(rows, plan) > 0 && sumOf(rows, actual) === 0)
        zeroDays.push(w.days[i]);
    zeroDays.sort();
    return {
      lineId: g.line.id,
      name: g.line.name,
      tone,
      now,
      usual,
      days7: g.days7,
      lastEntry: g.lastEntry,
      daily,
      zeroDays,
    };
  });
  // Worst drop first; lines with no entries last.
  return tiles.sort(
    (x, y) =>
      Number(x.now === null) - Number(y.now === null) ||
      (x.now ?? 0) - (x.usual ?? 0) - ((y.now ?? 0) - (y.usual ?? 0)) ||
      x.name.localeCompare(y.name),
  );
}

// ---------------------------------------------------------------------------
// Rework: kg ÷ making kg, per stage

export type ReworkStage = "Cooking" | "Making" | "Packing";
const RW_FIELD: Record<ReworkStage, (e: DailyEntry) => number> = {
  Cooking: (e) => e.rework_cooking,
  Making: (e) => e.rework_making,
  Packing: (e) => e.rework_packing,
};

export interface ReworkTile {
  key: string;
  lineId: string;
  name: string;
  stage: ReworkStage;
  tone: TrendTone;
  /** % of making, last 7 days. */
  now: number;
  usual: number;
  kg7: number;
  kg28: number;
  days7: number;
  /** % of making per day; kg per day. */
  daily: (number | null)[];
  dailyKg: (number | null)[];
}

export interface ReworkTrend {
  /** Rising (red) first, then over the limit in both periods (amber). */
  flagged: ReworkTile[];
  better: ReworkTile[];
  steady: number;
}

export function reworkTrend(
  entries: DailyEntry[],
  lines: LineInfo[],
  w: TrendWindow,
  limitPct: number | null,
): ReworkTrend {
  const all: ReworkTile[] = [];
  for (const g of groupByLine(entries, lines, w)) {
    if (g.days7 === 0) continue;
    const making = windowSums(g, w, (e) => e.making_actual);
    for (const stage of ["Cooking", "Making", "Packing"] as const) {
      const f = RW_FIELD[stage];
      const kg = windowSums(g, w, f);
      if (kg.recent === 0 && kg.base === 0) continue;
      const now = making.recent > 0 ? (kg.recent / making.recent) * 100 : 0;
      const usual = making.base > 0 ? (kg.base / making.base) * 100 : 0;
      let tone: TrendTone = "steady";
      if (now >= RW_RISE * usual && now - usual >= RW_MIN_POINTS && kg.recent >= RW_MIN_KG)
        tone = "worse";
      else if (limitPct != null && usual > limitPct && now > limitPct) tone = "limit";
      else if (usual >= RW_BETTER_BASE && now <= RW_BETTER * usual && g.days7 >= OUT_MIN_DAYS)
        tone = "better";
      const daily = w.days.map((_, i) => {
        const rows = g.byDay.get(i);
        if (!rows) return null;
        const m = sumOf(rows, (e) => e.making_actual);
        return m > 0 ? (sumOf(rows, f) / m) * 100 : null;
      });
      const dailyKg = w.days.map((_, i) => {
        const rows = g.byDay.get(i);
        return rows ? sumOf(rows, f) : null;
      });
      all.push({
        key: `${g.line.id}|${stage}`,
        lineId: g.line.id,
        name: g.line.name,
        stage,
        tone,
        now,
        usual,
        kg7: kg.recent,
        kg28: kg.base,
        days7: g.days7,
        daily,
        dailyKg,
      });
    }
  }
  const flagged = all
    .filter((t) => t.tone === "worse" || t.tone === "limit")
    .sort(
      (a, b) =>
        Number(a.tone !== "worse") - Number(b.tone !== "worse") ||
        b.now - b.usual - (a.now - a.usual),
    );
  return {
    flagged,
    better: all.filter((t) => t.tone === "better"),
    steady: all.filter((t) => t.tone === "steady").length,
  };
}

// ---------------------------------------------------------------------------
// Operational stops: downtime logged in the daily entries

export interface StopLine {
  lineId: string;
  name: string;
  tone: TrendTone;
  /** Minutes a production day, last 7 days; null = no entries. */
  now: number | null;
  usual: number;
  days7: number;
  lastEntry: string | null;
  /** Minutes per day (null = no entry). */
  daily: (number | null)[];
}

export interface StopReason {
  key: string;
  lineId: string;
  lineName: string;
  /** Spelling of the latest stop. */
  name: string;
  areas: string[];
  tone: "worse" | "better" | "gone" | "steady";
  /** "×22.4", "new", "gone", "−18%", "+24%", "no entries" */
  chip: string;
  /** Minutes a production day. */
  now: number;
  usual: number;
  min7: number;
  min28: number;
  /** Days of the 35 this reason was logged on. */
  daysLogged: number;
  lastLogged: string;
  daily: number[];
  /** Same line, probably the same stop under another spelling (never merged). */
  lookalikes: string[];
}

export interface StopsTrend {
  lines: StopLine[];
  reasons: StopReason[];
}

/** Lower case, letters and digits only, one-letter words dropped: "P-CIP" ≈ "CIP". */
export function looseReasonKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length > 1)
    .join(" ");
}

const pctChange = (now: number, usual: number) =>
  `${now >= usual ? "+" : "−"}${Math.round(Math.abs(now / usual - 1) * 100)}%`;

export function stopsTrend(
  entries: DailyEntry[],
  downtimes: EntryDowntime[],
  lines: LineInfo[],
  w: TrendWindow,
): StopsTrend {
  const groups = groupByLine(entries, lines, w);
  const byLine = new Map(groups.map((g) => [g.line.id, g]));
  const entryAt = new Map<string, { lineId: string; day: string; i: number }>();
  const index = new Map(w.days.map((d, i) => [d, i]));
  for (const e of entries) {
    const i = index.get(e.entry_date);
    if (i !== undefined) entryAt.set(e.id, { lineId: e.line_id, day: e.entry_date, i });
  }

  const lineDaily = new Map<string, (number | null)[]>();
  for (const g of groups)
    lineDaily.set(
      g.line.id,
      w.days.map((_, i) => (g.byDay.has(i) ? 0 : null)),
    );

  interface Acc {
    key: string;
    lineId: string;
    name: string;
    nameDay: string;
    areas: Set<string>;
    min7: number;
    min28: number;
    days: Set<string>;
    daily: number[];
  }
  const acc = new Map<string, Acc>();
  for (const d of downtimes) {
    // A retired reason stays on old rows for history but is not analysed —
    // same rule as the Time lost card.
    if (d.is_active === false) continue;
    const at = entryAt.get(d.entry_id);
    if (!at) continue;
    const minutes = Number(d.minutes) || 0;
    const ld = lineDaily.get(at.lineId);
    if (ld) ld[at.i] = (ld[at.i] ?? 0) + minutes;
    const key = `${at.lineId}|${d.reason_name.trim().toLowerCase()}`;
    let a = acc.get(key);
    if (!a) {
      a = {
        key,
        lineId: at.lineId,
        name: d.reason_name.trim(),
        nameDay: at.day,
        areas: new Set(),
        min7: 0,
        min28: 0,
        days: new Set(),
        daily: w.days.map(() => 0),
      };
      acc.set(key, a);
    }
    if (at.day >= a.nameDay) {
      a.name = d.reason_name.trim();
      a.nameDay = at.day;
    }
    if (d.area?.trim()) a.areas.add(d.area.trim());
    a.daily[at.i] += minutes;
    if (partOf(at.day, w) === "recent") a.min7 += minutes;
    else a.min28 += minutes;
    a.days.add(at.day);
  }

  const stopLines: StopLine[] = groups
    .map((g): StopLine => {
      const daily = lineDaily.get(g.line.id) ?? [];
      let m7 = 0;
      let m28 = 0;
      daily.forEach((v, i) => {
        if (v == null) return;
        if (partOf(w.days[i], w) === "recent") m7 += v;
        else m28 += v;
      });
      const now = g.days7 > 0 ? m7 / g.days7 : null;
      const usual = g.days28 > 0 ? m28 / g.days28 : 0;
      let tone: TrendTone = "steady";
      if (now === null) tone = "none";
      else if (now >= LINE_RISE * usual && now - usual >= LINE_MIN) tone = "worse";
      else if (now <= LINE_BETTER * usual && usual - now >= LINE_MIN) tone = "better";
      return {
        lineId: g.line.id,
        name: g.line.name,
        tone,
        now,
        usual,
        days7: g.days7,
        lastEntry: g.lastEntry,
        daily,
      };
    })
    .sort(
      (x, y) =>
        Number(x.now === null) - Number(y.now === null) ||
        (y.now ?? 0) - y.usual - ((x.now ?? 0) - x.usual) ||
        x.name.localeCompare(y.name),
    );

  const reasons: StopReason[] = [...acc.values()]
    .map((a): StopReason => {
      const g = byLine.get(a.lineId)!;
      const now = g.days7 > 0 ? a.min7 / g.days7 : 0;
      const usual = g.days28 > 0 ? a.min28 / g.days28 : 0;
      let tone: StopReason["tone"] = "steady";
      let chip: string;
      if (g.days7 === 0) chip = "no entries";
      else if (usual === 0 && now > 0) {
        tone = "worse";
        chip = "new";
      } else if (now === 0) {
        tone = "gone";
        chip = "gone";
      } else if (now >= REASON_RISE * usual && now - usual >= REASON_MIN) {
        tone = "worse";
        chip = `×${now / usual >= 10 ? Math.round(now / usual) : (now / usual).toFixed(1)}`;
      } else if (now <= REASON_BETTER * usual) {
        tone = "better";
        chip = pctChange(now, usual);
      } else chip = pctChange(now, usual);
      const last = [...a.days].sort().at(-1)!;
      return {
        key: a.key,
        lineId: a.lineId,
        lineName: g.line.name,
        name: a.name,
        areas: [...a.areas],
        tone,
        chip,
        now,
        usual,
        min7: a.min7,
        min28: a.min28,
        daysLogged: a.days.size,
        lastLogged: last,
        daily: a.daily,
        lookalikes: [],
      };
    })
    .sort((x, y) => y.now - y.usual - (x.now - x.usual) || x.name.localeCompare(y.name));

  for (const r of reasons) {
    const loose = looseReasonKey(r.name);
    if (!loose) continue;
    r.lookalikes = reasons
      .filter((o) => o.key !== r.key && o.lineId === r.lineId && looseReasonKey(o.name) === loose)
      .map((o) => o.name);
  }
  return { lines: stopLines, reasons };
}
