// One line's numbers for a period, from what the Dashboard loads: the daily
// entries (already normalised), their downtime rows and the maintenance stops.
// Shared by the Dashboard and the Plant floor's line room, so time lost, the
// reasons and the OEE's lost minutes are the same on both. Moved from
// src/routes/index.tsx as is.
import {
  addSplits,
  machineReasonRows,
  machineSplit,
  mergeReasonRows,
  type MachineStop,
} from "@/lib/machine-downtime";
import {
  downtimeKindResolver,
  reasonRows,
  splitDowntime,
  sumEntries,
  type ReasonRow,
  type TimeSplit,
  type Totals,
} from "@/lib/dashboard-metrics";
import type { DailyEntry, EntryDowntime, ProductionArea, SeverityLevel } from "@/lib/queries";

export interface PeriodNumbers {
  totals: Totals;
  /** Production days: dates with an entry. */
  days: number;
  entryDays: Set<string>;
  /** Machine stops on days that have an entry. */
  dayStops: MachineStop[];
  entrySplit: TimeSplit;
  mSplit: TimeSplit;
  split: TimeSplit;
  /** Minutes lost per entry day, as "Time lost" counts them (for the line OEE). */
  lostByDay: Map<string, number>;
  reasons: ReasonRow[];
}

export function periodNumbers(args: {
  list: DailyEntry[];
  /** Active downtime reasons only. */
  downtimes: EntryDowntime[];
  kindOf: ReturnType<typeof downtimeKindResolver>;
  stops: MachineStop[];
  severityLevels: SeverityLevel[];
  productionAreas: ProductionArea[];
}): PeriodNumbers {
  const { list, downtimes, kindOf, stops, severityLevels, productionAreas } = args;
  const totals = sumEntries(list);
  const days = new Set(list.map((e) => e.entry_date)).size;
  // Machine stops count toward time lost only on days that have a daily
  // entry: available minutes come from the entries, so a fault on a day with
  // no entry has nothing to be a share of. The Maintenance card still shows
  // every fault in the period.
  const entryDays = new Set(list.map((e) => e.entry_date));
  const dayStops = stops.filter((st) => entryDays.has(st.day));
  const entrySplit = splitDowntime(downtimes, kindOf);
  const mSplit = machineSplit(dayStops);
  const split = addSplits(entrySplit, mSplit);
  const lostByDay = new Map<string, number>();
  for (const e of list) {
    lostByDay.set(e.entry_date, (lostByDay.get(e.entry_date) ?? 0) + (Number(e.downtime_min) || 0));
  }
  for (const st of dayStops) lostByDay.set(st.day, (lostByDay.get(st.day) ?? 0) + st.minutes);
  const reasons = mergeReasonRows(
    reasonRows(downtimes, kindOf, severityLevels, productionAreas),
    machineReasonRows(dayStops),
  );
  return { totals, days, entryDays, dayStops, entrySplit, mSplit, split, lostByDay, reasons };
}
