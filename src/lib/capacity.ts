// Making capacity per line (migration 20261013120000_line_capacities).
//
// An admin sets each line's making capacity per DAY or per SHIFT, from a date.
// The daily entry's making plan comes from it — a trigger in the database
// sets it, the page only shows the same number, locked:
//
//   full day = 1,440 min, a shift (A / B / C) = 480 min → 1 day = 3 shifts
//   per day   → Full-day entry: all of it, shift entry: a third
//   per shift → shift entry: all of it,   Full-day entry: × 3
//
// The rounding matches public.making_plan_for(): whole kilograms, counts to one
// decimal.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CapacityBasis = "day" | "shift";

export interface LineCapacity {
  id: string;
  line_id: string;
  basis: CapacityBasis;
  making_kg: number;
  making_count: number | null;
  effective_from: string;
  created_by: string | null;
  created_at: string;
}

/** Every capacity of the lines in view (the database keeps the company scope). */
export const lineCapacitiesQuery = queryOptions({
  queryKey: ["line-capacities"],
  queryFn: async (): Promise<LineCapacity[]> => {
    const { data, error } = await supabase
      .from("line_capacities")
      .select("*")
      .order("effective_from", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      ...r,
      basis: r.basis as CapacityBasis,
      making_kg: Number(r.making_kg),
      making_count: r.making_count == null ? null : Number(r.making_count),
    }));
  },
});

/** The capacity that applies to a line on a day: the latest one from on or before it. */
export function capacityFor(
  capacities: LineCapacity[],
  lineId: string,
  day: string,
): LineCapacity | null {
  let best: LineCapacity | null = null;
  for (const c of capacities) {
    if (c.line_id !== lineId || c.effective_from > day) continue;
    if (!best || c.effective_from > best.effective_from) best = c;
  }
  return best;
}

/** The current capacity of a line (today or the latest set). */
export function currentCapacity(
  capacities: LineCapacity[],
  lineId: string,
  today: string,
): LineCapacity | null {
  return capacityFor(capacities, lineId, today);
}

function scale(value: number, basis: CapacityBasis, shift: string) {
  const fullDay = shift === "DAY";
  if (basis === "day") return fullDay ? value : value / 3;
  return fullDay ? value * 3 : value;
}

/** The plan a capacity gives one entry (shift "DAY" = full day). */
export function planFromCapacity(
  cap: Pick<LineCapacity, "basis" | "making_kg" | "making_count">,
  shift: string,
): { kg: number; count: number | null } {
  return {
    kg: Math.round(scale(cap.making_kg, cap.basis, shift)),
    count:
      cap.making_count == null
        ? null
        : Math.round(scale(cap.making_count, cap.basis, shift) * 10) / 10,
  };
}

/** "25,600 kg per day" */
export function capacityLabel(cap: Pick<LineCapacity, "basis" | "making_kg">) {
  return `${Math.round(cap.making_kg).toLocaleString("en-US")} kg per ${cap.basis}`;
}

/** How a capacity turns into one entry's plan, in words. */
export function capacityWhy(cap: Pick<LineCapacity, "basis">, shift: string) {
  const fullDay = shift === "DAY";
  if (cap.basis === "day") return fullDay ? "" : " ÷ 3 for one shift";
  return fullDay ? " × 3 for a full day" : "";
}
