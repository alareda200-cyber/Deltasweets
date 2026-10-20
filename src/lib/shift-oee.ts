// OEE by shift and by operator for one day, from the machine sheet
// (machine_runs) — approved mockup "Shift & Operator OEE", 20 Oct 2026.
//
// Shifts (claude/sql-import-playbook.md):
//   A 08:00–16:00 on the day · B 16:00–24:00 on the day · C 00:00–08:00 the next day.
// For each machine in each shift it ran (has sheet rows):
//   planned = 480 − preventive work on the machine inside the shift
//   down    = its own faults + the line's stops (stops_line, a stoppage as one
//             window) inside the shift, overlaps once, never more than planned
//   run     = planned − down
//   A = run ÷ planned · P = (bags ÷ speed from Settings) ÷ run
//   Q = the line's packing quality that day; while the day has no entry Q is
//       pending and the OEE shown is A × P.
// A cell whose faults cover the whole shift but that still packed bags (Rovema 4,
// open fault since 30 Sep) contradicts itself: it is flagged and left out of
// the totals until the fault is closed.
// Operators: a cell shared by several operators is split by their share of the
// bags. Minutes and bags are added up first, then divided.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MaintenanceEvent, MaintenanceStoppage } from "@/lib/queries";
import { collapseStoppageEvents } from "@/lib/queries";
import type { MachineRun, PackingMachine } from "@/lib/packing";
import { SHIFT_MIN } from "@/lib/oee";

export type ShiftCode = "A" | "B" | "C";
export const SHIFT_CODES: ShiftCode[] = ["A", "B", "C"];
export const SHIFT_HOURS: Record<ShiftCode, string> = {
  A: "08:00–16:00",
  B: "16:00–24:00",
  C: "00:00–08:00",
};

type Interval = [number, number];

/** The local clock window of a shift of a day (C runs into the next day). */
export function shiftWindow(day: string, shift: ShiftCode): Interval {
  const [y, m, d] = day.split("-").map(Number);
  const at = (dd: number, h: number) => new Date(y, m - 1, dd, h).getTime();
  if (shift === "A") return [at(d, 8), at(d, 16)];
  if (shift === "B") return [at(d, 16), at(d + 1, 0)];
  return [at(d + 1, 0), at(d + 1, 8)];
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

const interval = (e: { started_at: string; resolved_at: string | null }, now: number): Interval => [
  new Date(e.started_at).getTime(),
  e.resolved_at ? new Date(e.resolved_at).getTime() : now,
];

export const normOperator = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export interface Totals {
  plannedMin: number;
  runMin: number;
  idealMin: number;
  bags: number;
  kg: number;
  A: number | null;
  P: number | null;
  Q: number | null;
  /** A × P × Q, or A × P while Q is pending. */
  oee: number | null;
}

export interface ShiftCell {
  shift: ShiftCode;
  machine: PackingMachine;
  operators: { name: string; bags: number; kg: number }[];
  plannedMin: number;
  downMin: number;
  runMin: number;
  idealMin: number;
  bags: number;
  kg: number;
  P: number | null;
  /** Faults cover the whole shift, yet it packed bags: left out of the totals. */
  conflict: boolean;
}

export interface ShiftRow extends Totals {
  shift: ShiftCode;
  cells: ShiftCell[];
}

export interface OperatorRow extends Totals {
  name: string;
  shifts: ShiftCode[];
  machines: string[];
  /** Machines of theirs left out (the conflict above). */
  excluded: string[];
}

export interface ShiftOee {
  day: string;
  Q: number | null;
  total: Totals;
  shifts: ShiftRow[];
  operators: OperatorRow[];
  conflicts: ShiftCell[];
  /** Cells running faster than the speed in Settings (P over 100%). */
  fast: ShiftCell[];
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

function totals(
  parts: { plannedMin: number; runMin: number; idealMin: number }[],
  bags: number,
  kg: number,
  Q: number | null,
): Totals {
  const plannedMin = parts.reduce((s, p) => s + p.plannedMin, 0);
  const runMin = parts.reduce((s, p) => s + p.runMin, 0);
  const idealMin = parts.reduce((s, p) => s + p.idealMin, 0);
  const A = ratio(runMin, plannedMin);
  const P = ratio(idealMin, runMin);
  const oee = A === null ? null : A * (P ?? 0) * (Q ?? 1);
  return { plannedMin, runMin, idealMin, bags, kg, A, P, Q, oee };
}

export function computeShiftOee(args: {
  day: string;
  machines: PackingMachine[];
  runs: MachineRun[];
  events: MaintenanceEvent[];
  stoppages: MaintenanceStoppage[];
  lineId: string;
  /** The line's packing quality that day; null when the day has no entry yet. */
  Q: number | null;
  now?: number;
}): ShiftOee {
  const now = args.now ?? Date.now();
  const Q = args.Q;
  const byId = new Map(args.machines.map((m) => [m.id, m]));

  const lineStops = collapseStoppageEvents(
    args.events.filter((e) => e.line_id === args.lineId),
    args.stoppages,
  )
    .filter((e) => e.stops_line && !e.machine_id && e.type !== "preventive")
    .map((e) => interval(e, now));

  // cells: shift × machine
  const cellMap = new Map<string, ShiftCell>();
  for (const r of args.runs) {
    const machine = byId.get(r.machine_id);
    if (!machine) continue;
    const key = `${r.shift}|${machine.id}`;
    let c = cellMap.get(key);
    if (!c) {
      c = {
        shift: r.shift,
        machine,
        operators: [],
        plannedMin: 0,
        downMin: 0,
        runMin: 0,
        idealMin: 0,
        bags: 0,
        kg: 0,
        P: null,
        conflict: false,
      };
      cellMap.set(key, c);
    }
    const name = normOperator(r.operator) || "No operator";
    const kg = r.bag_g && r.bag_g > 0 ? (r.bags * r.bag_g) / 1000 : 0;
    const op = c.operators.find((o) => o.name === name);
    if (op) {
      op.bags += r.bags;
      op.kg += kg;
    } else c.operators.push({ name, bags: r.bags, kg });
    c.bags += r.bags;
    c.kg += kg;
  }

  const cells = [...cellMap.values()];
  for (const c of cells) {
    const win = shiftWindow(args.day, c.shift);
    const own = args.events.filter((e) => e.machine_id === c.machine.id);
    const faults = own.filter((e) => e.type !== "preventive").map((e) => interval(e, now));
    const prev = own.filter((e) => e.type === "preventive").map((e) => interval(e, now));
    c.plannedMin = Math.max(0, SHIFT_MIN - unionMinutesWithin(prev, win));
    c.downMin = Math.min(c.plannedMin, unionMinutesWithin([...faults, ...lineStops], win));
    c.runMin = Math.max(0, c.plannedMin - c.downMin);
    c.idealMin = c.machine.speed_per_min > 0 ? c.bags / c.machine.speed_per_min : 0;
    c.P = ratio(c.idealMin, c.runMin);
    c.conflict = c.runMin <= 0 && c.bags > 0;
  }
  const order = (a: ShiftCell, b: ShiftCell) =>
    a.machine.sort_order - b.machine.sort_order || a.machine.name.localeCompare(b.machine.name);

  const sum = (list: ShiftCell[], f: (c: ShiftCell) => number) =>
    list.reduce((s, c) => s + f(c), 0);
  const counted = (list: ShiftCell[]) => list.filter((c) => !c.conflict);

  const shifts: ShiftRow[] = SHIFT_CODES.map((shift) => {
    const list = cells.filter((c) => c.shift === shift).sort(order);
    return {
      shift,
      cells: list,
      ...totals(
        counted(list),
        sum(list, (c) => c.bags),
        sum(list, (c) => c.kg),
        Q,
      ),
    };
  });

  // operators
  const ops = new Map<
    string,
    {
      parts: { plannedMin: number; runMin: number; idealMin: number }[];
      shifts: Set<ShiftCode>;
      machines: Set<string>;
      excluded: Set<string>;
      bags: number;
      kg: number;
    }
  >();
  for (const c of cells)
    for (const o of c.operators) {
      const share = c.bags > 0 ? o.bags / c.bags : 1 / c.operators.length;
      const r = ops.get(o.name) ?? {
        parts: [],
        shifts: new Set<ShiftCode>(),
        machines: new Set<string>(),
        excluded: new Set<string>(),
        bags: 0,
        kg: 0,
      };
      r.shifts.add(c.shift);
      r.machines.add(c.machine.name);
      r.bags += o.bags;
      r.kg += o.kg;
      if (c.conflict) r.excluded.add(c.machine.name);
      else
        r.parts.push({
          plannedMin: c.plannedMin * share,
          runMin: c.runMin * share,
          idealMin: c.idealMin * share,
        });
      ops.set(o.name, r);
    }
  const operators: OperatorRow[] = [...ops].map(([name, r]) => ({
    name,
    shifts: SHIFT_CODES.filter((s) => r.shifts.has(s)),
    machines: [...r.machines].sort(),
    excluded: [...r.excluded].sort(),
    ...totals(r.parts, r.bags, r.kg, Q),
  }));

  return {
    day: args.day,
    Q,
    total: totals(
      counted(cells),
      sum(cells, (c) => c.bags),
      sum(cells, (c) => c.kg),
      Q,
    ),
    shifts,
    operators,
    conflicts: cells.filter((c) => c.conflict).sort(order),
    fast: counted(cells)
      .filter((c) => (c.P ?? 0) > 1)
      .sort(order),
  };
}

/** The last day in [from, to] with a machine sheet for these machines. */
export const lastRunDayQuery = (machineIds: string[], from: string, to: string) =>
  queryOptions({
    queryKey: ["machine-runs-last-day", machineIds, from, to],
    enabled: machineIds.length > 0,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("machine_runs")
        .select("day")
        .in("machine_id", machineIds)
        .gte("day", from)
        .lte("day", to)
        .order("day", { ascending: false })
        .limit(1);
      if (error) {
        if (error.code === "PGRST205" || error.code === "42P01") return null;
        throw error;
      }
      return data?.[0]?.day ?? null;
    },
  });

/**
 * Faults and line stops that touch the three shifts of a day (08:00 on the day
 * to 08:00 the next), on these machines or the line — open ones included.
 */
export const shiftEventsQuery = (lineId: string, machineIds: string[], day: string) =>
  queryOptions({
    queryKey: ["shift-events", lineId, machineIds, day],
    queryFn: async (): Promise<MaintenanceEvent[]> => {
      const startIso = new Date(shiftWindow(day, "A")[0]).toISOString();
      const endIso = new Date(shiftWindow(day, "C")[1]).toISOString();
      const touching = () =>
        supabase
          .from("maintenance_events")
          .select("*")
          .lt("started_at", endIso)
          .or(`resolved_at.is.null,resolved_at.gte.${startIso}`);
      const [line, own] = await Promise.all([
        touching().eq("line_id", lineId),
        machineIds.length
          ? touching().in("machine_id", machineIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (line.error) throw line.error;
      if (own.error) throw own.error;
      const byId = new Map<string, MaintenanceEvent>();
      for (const e of [...(line.data ?? []), ...(own.data ?? [])] as unknown as MaintenanceEvent[])
        byId.set(e.id, e);
      return [...byId.values()];
    },
  });
