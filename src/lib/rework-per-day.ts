// Dashboard › Rework and area owners › Rework per day (Ala, 30 Sep 2026).
//
// One bar per calendar day: the rework recorded in that day's daily entries
// (cooking + making + packing, every shift of the day summed), in kg, or as a
// share of the day's making actual. Most / least / average only look at days
// that have an entry — a day with no entry is unknown, never "no rework".
// The % view compares each day with Settings › Targets' rework limit.
import type { DailyEntry } from "@/lib/queries";
import { eachDay, todayIso } from "@/lib/dashboard-metrics";

export interface ReworkDay {
  day: string;
  hasEntry: boolean;
  /** cooking + making + packing, kg. */
  kg: number;
  cooking: number;
  making: number;
  packing: number;
  makingActual: number;
  /** kg ÷ making actual × 100; null without making output. */
  pct: number | null;
  isToday: boolean;
}

export interface Extreme {
  value: number;
  days: string[];
}

export interface ReworkDaysSummary {
  days: ReworkDay[];
  kg: { most: Extreme | null; least: Extreme | null; average: number | null };
  pct: {
    most: Extreme | null;
    least: Extreme | null;
    /** Whole period: total rework ÷ total making actual (like the Rework tile). */
    period: number | null;
    /** Days with a % above the limit, of `counted` days with a %. */
    over: number;
    counted: number;
  };
  limitPct: number | null;
}

function extremes(rows: { day: string; v: number }[]): {
  most: Extreme | null;
  least: Extreme | null;
} {
  if (rows.length === 0) return { most: null, least: null };
  // Compare on what is shown (kg whole, % one decimal) so ties read as ties.
  const hi = Math.max(...rows.map((r) => r.v));
  const lo = Math.min(...rows.map((r) => r.v));
  return {
    most: { value: hi, days: rows.filter((r) => r.v === hi).map((r) => r.day) },
    // Every day the same: no "least" apart from the "most".
    least: hi === lo ? null : { value: lo, days: rows.filter((r) => r.v === lo).map((r) => r.day) },
  };
}

export function reworkPerDay(input: {
  entries: Pick<
    DailyEntry,
    "entry_date" | "rework_cooking" | "rework_making" | "rework_packing" | "making_actual"
  >[];
  from: string;
  to: string;
  limitPct: number | null;
  today?: string;
}): ReworkDaysSummary {
  const today = input.today ?? todayIso();
  const byDay = new Map<string, { c: number; m: number; p: number; a: number }>();
  for (const e of input.entries) {
    const t = byDay.get(e.entry_date) ?? { c: 0, m: 0, p: 0, a: 0 };
    t.c += Number(e.rework_cooking) || 0;
    t.m += Number(e.rework_making) || 0;
    t.p += Number(e.rework_packing) || 0;
    t.a += Number(e.making_actual) || 0;
    byDay.set(e.entry_date, t);
  }

  const days: ReworkDay[] = eachDay(input.from, input.to).map((day) => {
    const t = byDay.get(day);
    const kg = t ? t.c + t.m + t.p : 0;
    return {
      day,
      hasEntry: !!t,
      kg,
      cooking: t?.c ?? 0,
      making: t?.m ?? 0,
      packing: t?.p ?? 0,
      makingActual: t?.a ?? 0,
      pct: t && t.a > 0 ? (kg / t.a) * 100 : null,
      isToday: day === today,
    };
  });

  const recorded = days.filter((d) => d.hasEntry);
  const kgRows = recorded.map((d) => ({ day: d.day, v: Math.round(d.kg) }));
  const withPct = recorded.filter((d) => d.pct != null);
  const pctRows = withPct.map((d) => ({ day: d.day, v: Math.round((d.pct as number) * 10) / 10 }));
  const totalKg = recorded.reduce((a, d) => a + d.kg, 0);
  const totalMaking = recorded.reduce((a, d) => a + d.makingActual, 0);

  return {
    days,
    kg: {
      ...extremes(kgRows),
      average: recorded.length > 0 ? totalKg / recorded.length : null,
    },
    pct: {
      ...extremes(pctRows),
      period: totalMaking > 0 ? (totalKg / totalMaking) * 100 : null,
      over:
        input.limitPct == null
          ? 0
          : withPct.filter((d) => (d.pct as number) > (input.limitPct as number)).length,
      counted: withPct.length,
    },
    limitPct: input.limitPct,
  };
}
