// A Full-day entry next to shift entries is a packing-only entry (Ala, 6 Nov
// 2026; mockup "Marshmallows Day Rule"). Marshmallows is entered by shift
// (A / B) for making, plus a Full-day entry each day for the day's packing and
// rework: making 0, 1,440 min, making plan 2,835. Counted as making time and
// plan, it halved Performance and Making % (1–5 Nov: P 41% instead of 91%).
//
// On a line-day that has both a Full-day entry and shift entries, the Full-day
// entry keeps its packing actual, rework, WIP and downtime, and counts 0 for
// available minutes, making plan, making actual (kg and count) and packing
// plan: the shifts carry those. Days with only a Full-day entry, or only
// shifts, are unchanged. The data itself isn't changed.

interface EntryLike {
  line_id: string;
  entry_date: string;
  shift: string;
  available_min: number;
  making_plan: number;
  making_actual: number;
  making_plan_count?: number | null;
  making_actual_count?: number | null;
  packing_plan: number;
}

/** Line-days that have shift entries, as "line|day". */
function shiftDays(entries: EntryLike[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) if (e.shift !== "DAY") out.add(`${e.line_id}|${e.entry_date}`);
  return out;
}

export function isPackingOnlyDay(e: EntryLike, withShifts: Set<string>): boolean {
  return e.shift === "DAY" && withShifts.has(`${e.line_id}|${e.entry_date}`);
}

export function withPackingOnlyDays<T extends EntryLike>(
  entries: T[] | undefined,
): T[] | undefined {
  if (!entries) return entries;
  const withShifts = shiftDays(entries);
  if (withShifts.size === 0) return entries;
  return entries.map((e) =>
    isPackingOnlyDay(e, withShifts)
      ? {
          ...e,
          available_min: 0,
          making_plan: 0,
          making_actual: 0,
          ...(e.making_plan_count != null ? { making_plan_count: 0 } : {}),
          ...(e.making_actual_count != null ? { making_actual_count: 0 } : {}),
          packing_plan: 0,
        }
      : e,
  );
}
