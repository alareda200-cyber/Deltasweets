// Packing OEE per machine and per packing line (approved mockup, 19 Oct 2026).
//
// For each machine and day:
//   planned  = shifts run (0–3, from the daily entry) × 480 min
//              − preventive work logged on that machine
//   down     = the machine's own faults (maintenance events with its
//              machine_id), overlaps counted once, never more than planned.
//              The line's stops are NOT counted: when the making line stops
//              (a depositor servo…) the packing machines keep packing from
//              stock (Ala, 25 Oct 2026 — Rovema 2 packed 68,050 bags in a
//              shift with 88 min of line stops, which showed as P 116%).
//   run      = planned − down
//   A = run ÷ planned
//   P = (bags ÷ ideal speed) ÷ run       ideal minutes ÷ run minutes
//   Q = (packed − rework packing) ÷ packed, the line's figure that day
//   OEE = A × P × Q
// Over several days or machines the minutes and bags are added up first, then
// divided, so a busy day weighs more than a quiet one.
//
// A day is the local calendar day, like the rest of the dashboard. An open
// fault runs until now.

import type { MaintenanceEvent, MaintenanceStoppage } from "@/lib/queries";
import type { PackingMachine } from "@/lib/packing";

export const SHIFT_MIN = 480;

export interface MachineDayInput {
  machine_id: string;
  entry_date: string;
  shifts: number;
  bags: number;
}

export interface LineDayQuality {
  entry_date: string;
  packing_actual: number;
  rework_packing: number;
}

export interface OeeFigures {
  plannedMin: number;
  downMin: number;
  runMin: number;
  idealMin: number;
  bags: number;
  A: number | null;
  P: number | null;
  Q: number | null;
  oee: number | null;
}

export interface MachineOee extends OeeFigures {
  machine: PackingMachine;
  /** Days in the range the machine ran at least one shift. */
  daysRun: number;
  /** Shifts run in the range. */
  shifts: number;
  /** Its own faults that started in the range (preventive left out). */
  faults: number;
  /** Minutes of its own faults inside the days it was planned to run. */
  faultMin: number;
  /** An open fault on the machine right now. */
  openFault: MaintenanceEvent | null;
}

export interface LineOee extends OeeFigures {
  machines: MachineOee[];
  /** Minutes lost to the machines' faults, and to running below ideal speed. */
  lostToStopsMin: number;
  lostToSpeedMin: number;
  packed: number;
  rework: number;
}

type Interval = [number, number];

function dayBounds(day: string): Interval {
  const [y, m, d] = day.split("-").map(Number);
  return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()];
}

function unionMinutesWithin(intervals: Interval[], win: Interval): number {
  const clipped = intervals
    .map(([s, e]): Interval => [Math.max(s, win[0]), Math.min(e, win[1])])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: Interval | null = null;
  for (const iv of clipped) {
    if (!cur || iv[0] > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [iv[0], iv[1]];
    } else cur[1] = Math.max(cur[1], iv[1]);
  }
  if (cur) total += cur[1] - cur[0];
  return total / 60000;
}

function interval(e: { started_at: string; resolved_at: string | null }, now: number): Interval {
  return [
    new Date(e.started_at).getTime(),
    e.resolved_at ? new Date(e.resolved_at).getTime() : now,
  ];
}

function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

function figures(
  plannedMin: number,
  downMin: number,
  idealMin: number,
  bags: number,
  Q: number | null,
): OeeFigures {
  const runMin = Math.max(0, plannedMin - downMin);
  const A = ratio(runMin, plannedMin);
  const P = ratio(idealMin, runMin);
  const oee = A !== null && Q !== null ? A * (P ?? 0) * Q : null;
  return { plannedMin, downMin, runMin, idealMin, bags, A, P, Q, oee };
}

/** Quality of a line from its entries: (packed − rework) ÷ packed. */
export function lineQuality(days: LineDayQuality[]): {
  Q: number | null;
  packed: number;
  rework: number;
} {
  const packed = days.reduce((s, d) => s + (Number(d.packing_actual) || 0), 0);
  const rework = days.reduce((s, d) => s + (Number(d.rework_packing) || 0), 0);
  return { Q: packed > 0 ? Math.max(0, packed - rework) / packed : null, packed, rework };
}

export function computeLineOee(args: {
  machines: PackingMachine[];
  machineDays: MachineDayInput[];
  /** Every maintenance event that could touch the range, any line. */
  events: MaintenanceEvent[];
  stoppages: MaintenanceStoppage[];
  lineId: string;
  quality: LineDayQuality[];
  from: string;
  to: string;
  now?: number;
}): LineOee {
  const now = args.now ?? Date.now();
  const { Q, packed, rework } = lineQuality(args.quality);
  const daysOfQuality = new Map<string, LineDayQuality[]>();
  for (const d of args.quality) {
    const list = daysOfQuality.get(d.entry_date) ?? [];
    list.push(d);
    daysOfQuality.set(d.entry_date, list);
  }
  const qualityByDay = new Map<string, number | null>(
    [...daysOfQuality].map(([day, list]) => [day, lineQuality(list).Q]),
  );

  const rangeWin: Interval = [dayBounds(args.from)[0], dayBounds(args.to)[1]];

  const machines = args.machines.map((m): MachineOee => {
    const own = args.events.filter((e) => e.machine_id === m.id);
    const faults = own.filter((e) => e.type !== "preventive");
    const faultIv = faults.map((e) => interval(e, now));
    const prevIv = own.filter((e) => e.type === "preventive").map((e) => interval(e, now));
    // shifts per day (a day may have Full-day or per-shift entries)
    const byDay = new Map<string, { shifts: number; bags: number }>();
    for (const r of args.machineDays) {
      if (r.machine_id !== m.id || r.entry_date < args.from || r.entry_date > args.to) continue;
      const cur = byDay.get(r.entry_date) ?? { shifts: 0, bags: 0 };
      cur.shifts = Math.min(3, cur.shifts + (Number(r.shifts) || 0));
      cur.bags += Number(r.bags) || 0;
      byDay.set(r.entry_date, cur);
    }
    let planned = 0;
    let down = 0;
    let faultMin = 0;
    let bags = 0;
    let shifts = 0;
    let daysRun = 0;
    let qWeighted = 0;
    let qPlanned = 0;
    for (const [day, d] of byDay) {
      bags += d.bags;
      if (d.shifts <= 0) continue;
      daysRun++;
      shifts += d.shifts;
      const win = dayBounds(day);
      const dayPlanned = Math.max(0, d.shifts * SHIFT_MIN - unionMinutesWithin(prevIv, win));
      const dayFault = Math.min(dayPlanned, unionMinutesWithin(faultIv, win));
      const dayDown = Math.min(dayPlanned, unionMinutesWithin(faultIv, win));
      planned += dayPlanned;
      down += dayDown;
      faultMin += dayFault;
      const q = qualityByDay.get(day);
      if (q !== undefined && q !== null) {
        qWeighted += q * dayPlanned;
        qPlanned += dayPlanned;
      }
    }
    const mQ = qPlanned > 0 ? qWeighted / qPlanned : Q;
    const idealMin = m.speed_per_min > 0 ? bags / m.speed_per_min : 0;
    const startedInRange = faults.filter((e) => {
      const t = new Date(e.started_at).getTime();
      return t >= rangeWin[0] && t < rangeWin[1];
    });
    const openFault = faults.find((e) => !e.resolved_at) ?? null;
    return {
      ...figures(planned, down, idealMin, bags, mQ),
      machine: m,
      daysRun,
      shifts,
      faults: startedInRange.length,
      faultMin,
      openFault,
    };
  });

  const planned = machines.reduce((s, m) => s + m.plannedMin, 0);
  const down = machines.reduce((s, m) => s + m.downMin, 0);
  const idealMin = machines.reduce((s, m) => s + m.idealMin, 0);
  const bags = machines.reduce((s, m) => s + m.bags, 0);
  const line = figures(planned, down, idealMin, bags, Q);
  return {
    ...line,
    machines,
    lostToStopsMin: down,
    lostToSpeedMin: Math.max(0, line.runMin - idealMin),
    packed,
    rework,
  };
}

/** Machine output in kg from the bags typed in the entry. */
export function bagsKg(bags: number, bagG: number | null): number | null {
  if (!bagG || !(bagG > 0)) return null;
  return (bags * bagG) / 1000;
}

export function oeeTone(v: number | null): "good" | "warn" | "bad" | "none" {
  if (v === null) return "none";
  if (v >= 0.85) return "good";
  if (v >= 0.6) return "warn";
  return "bad";
}
