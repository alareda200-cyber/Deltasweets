// A production line's OEE from making (mockup v4, 19 Oct 2026):
//   A = (available − time lost) ÷ available
//   P = made ÷ (capacity per minute × running minutes)
//   Q = (made kg − rework cooking − rework making − rework packing) ÷ made kg
//   OEE = A × P × Q
// The capacity is the line's making capacity on each entry's day (Settings ›
// Production lines): per day ÷ 1,440 min, per shift ÷ 480 min. Entries on
// days without a capacity are left out. In the line's count unit (pallets…)
// the made figure and the capacity are counted in that unit; rework stays in
// kg, so Quality is the same either way.
// Time lost is the Dashboard's: the entries' downtime plus the machine stops
// on those days.

import { capacityFor, type LineCapacity } from "@/lib/capacity";
import type { DailyEntry } from "@/lib/queries";

export type OeeBasis = "kg" | "count";

export interface LineOeeResult {
  basis: OeeBasis;
  availableMin: number;
  lostMin: number;
  runMin: number;
  made: number;
  possible: number;
  reworkKg: number;
  madeKg: number;
  A: number | null;
  P: number | null;
  Q: number | null;
  oee: number | null;
  /** Entries left out: no capacity that day (or no count, in count basis). */
  skipped: number;
  used: number;
}

export function lineOee(args: {
  entries: DailyEntry[];
  capacities: LineCapacity[];
  lineId: string;
  basis: OeeBasis;
  /** Minutes lost per entry date (entries' downtime + machine stops). */
  lostByDay: Map<string, number>;
}): LineOeeResult {
  let avail = 0;
  let rateMin = 0; // Σ rate × available, to split by availability below
  let made = 0;
  let madeKg = 0;
  let rework = 0;
  let skipped = 0;
  const days = new Set<string>();
  for (const e of args.entries) {
    const cap = capacityFor(args.capacities, args.lineId, e.entry_date);
    const perBasis = args.basis === "count" ? cap?.making_count : cap?.making_kg;
    const actual = args.basis === "count" ? e.making_actual_count : e.making_actual;
    if (!cap || perBasis == null || actual == null) {
      skipped++;
      continue;
    }
    const minutes = cap.basis === "day" ? 1440 : 480;
    const rate = Number(perBasis) / minutes;
    const a = Number(e.available_min) || 0;
    avail += a;
    rateMin += rate * a;
    made += Number(actual) || 0;
    madeKg += Number(e.making_actual) || 0;
    rework +=
      (Number(e.rework_cooking) || 0) +
      (Number(e.rework_making) || 0) +
      (Number(e.rework_packing) || 0);
    days.add(e.entry_date);
  }
  let lost = 0;
  for (const d of days) lost += args.lostByDay.get(d) ?? 0;
  lost = Math.min(lost, avail);
  const run = Math.max(0, avail - lost);
  const A = avail > 0 ? run / avail : null;
  // capacity per minute averaged over the entries, by their available time
  const possible = avail > 0 ? (rateMin / avail) * run : 0;
  const P = possible > 0 ? made / possible : null;
  const Q = madeKg > 0 ? Math.max(0, madeKg - rework) / madeKg : null;
  return {
    basis: args.basis,
    availableMin: avail,
    lostMin: lost,
    runMin: run,
    made,
    possible,
    reworkKg: rework,
    madeKg,
    A,
    P,
    Q,
    oee: A !== null && P !== null && Q !== null ? A * P * Q : null,
    skipped,
    used: args.entries.length - skipped,
  };
}
