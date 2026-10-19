// Packing machines, SKUs and monthly forecasts (migration
// 20261019120000_packing_oee). The database keeps the company scope, so each
// query returns only the company in view.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { selectAllRows } from "@/lib/queries";

export interface PackingMachine {
  id: string;
  line_id: string;
  name: string;
  speed_per_min: number;
  sort_order: number;
  is_active: boolean;
}

export interface Sku {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  line_id: string | null;
  kg_per_unit: number | null;
  is_active: boolean;
}

/** One packing machine on a daily entry, as the form holds it. */
export interface EntryMachineLine {
  machine_id: string;
  shifts: number;
  bags: string;
  bagG: string;
}

export const packingMachinesQuery = queryOptions({
  queryKey: ["packing-machines"],
  queryFn: async (): Promise<PackingMachine[]> => {
    const { data, error } = await supabase
      .from("packing_machines")
      .select("*")
      .order("sort_order")
      .order("name");
    if (error) throw error;
    return (data ?? []).map((m) => ({ ...m, speed_per_min: Number(m.speed_per_min) }));
  },
});

export const skusQuery = queryOptions({
  queryKey: ["skus"],
  queryFn: async (): Promise<Sku[]> => {
    const rows = await selectAllRows(() => supabase.from("skus").select("*").order("code"));
    return (rows as Sku[]).map((s) => ({
      ...s,
      kg_per_unit: s.kg_per_unit == null ? null : Number(s.kg_per_unit),
    }));
  },
});

export interface PackedSku {
  id: string;
  line_id: string;
  day: string;
  sku_id: string | null;
  code: string;
  qty: number;
  kg: number | null;
}

/** Packed SKUs of the company in view between two days (inclusive). */
export const packedSkusQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ["packed-skus", from, to],
    queryFn: async (): Promise<PackedSku[]> => {
      const rows = await selectAllRows(() =>
        supabase
          .from("packed_skus")
          .select("id, line_id, day, sku_id, code, qty, kg")
          .gte("day", from)
          .lte("day", to)
          .order("day")
          .order("created_at"),
      );
      return (rows as PackedSku[]).map((r) => ({
        ...r,
        qty: Number(r.qty),
        kg: r.kg == null ? null : Number(r.kg),
      }));
    },
  });

export interface SkuForecast {
  id: string;
  month: string;
  sku_id: string | null;
  code: string;
  qty: number;
}

/** The month's forecast per SKU ("YYYY-MM-01"). */
export const skuForecastsQuery = (month: string) =>
  queryOptions({
    queryKey: ["sku-forecasts", month],
    queryFn: async (): Promise<SkuForecast[]> => {
      const rows = await selectAllRows(() =>
        supabase
          .from("sku_forecasts")
          .select("id, month, sku_id, code, qty")
          .eq("month", month)
          .order("code"),
      );
      return (rows as SkuForecast[]).map((r) => ({ ...r, qty: Number(r.qty) }));
    },
  });

/** What the packed SKUs add up to for one line and day; null = none pasted. */
export function packedFor(rows: PackedSku[], lineId: string, day: string) {
  const mine = rows.filter((r) => r.line_id === lineId && r.day === day);
  if (mine.length === 0) return null;
  const kg = Math.round(mine.reduce((s, r) => s + (r.kg ?? 0), 0) * 100) / 100;
  return { kg, count: mine.length, missing: mine.filter((r) => r.kg == null).length };
}

export interface EntryMachineRow {
  entry_id: string;
  machine_id: string;
  shifts: number;
  bags: number;
  bag_g: number | null;
}

/** Machine rows of the entries between two days (inclusive), for the OEE. */
export const entryMachinesQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ["entry-machines", from, to],
    queryFn: async (): Promise<(EntryMachineRow & { entry_date: string; shift: string })[]> => {
      const rows = await selectAllRows(() =>
        supabase
          .from("entry_machines")
          .select(
            "entry_id, machine_id, shifts, bags, bag_g, daily_entries!inner(entry_date, shift)",
          )
          .gte("daily_entries.entry_date", from)
          .lte("daily_entries.entry_date", to),
      );
      return (
        rows as unknown as (EntryMachineRow & {
          daily_entries: { entry_date: string; shift: string };
        })[]
      ).map((r) => ({
        entry_id: r.entry_id,
        machine_id: r.machine_id,
        shifts: Number(r.shifts),
        bags: Number(r.bags),
        bag_g: r.bag_g == null ? null : Number(r.bag_g),
        entry_date: r.daily_entries.entry_date,
        shift: r.daily_entries.shift,
      }));
    },
  });

export function machinesForLine(machines: PackingMachine[], lineId: string): PackingMachine[] {
  return machines
    .filter((m) => m.line_id === lineId && m.is_active)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/** "2026-10-17" → "2026-10-01". */
export function monthOf(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/**
 * Faults on these machines that touch the period — including one that began
 * before it and is still open or ran into it (Rovema 4 open since 30 Sep).
 */
export const machineEventsQuery = (machineIds: string[], from: string, to: string) =>
  queryOptions({
    queryKey: ["machine-events", machineIds, from, to],
    enabled: machineIds.length > 0,
    queryFn: async () => {
      const [y1, m1, d1] = from.split("-").map(Number);
      const [y2, m2, d2] = to.split("-").map(Number);
      const startIso = new Date(y1, m1 - 1, d1).toISOString();
      const endIso = new Date(y2, m2 - 1, d2 + 1).toISOString();
      const { data, error } = await supabase
        .from("maintenance_events")
        .select("*")
        .in("machine_id", machineIds)
        .lt("started_at", endIso)
        .or(`resolved_at.is.null,resolved_at.gte.${startIso}`);
      if (error) throw error;
      return (data ?? []) as unknown as import("@/lib/queries").MaintenanceEvent[];
    },
  });
