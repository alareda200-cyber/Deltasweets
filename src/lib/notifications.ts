import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AppNotification {
  id: string;
  severity: "warning" | "critical";
  message: string;
  entryDate: string;
  lineName: string;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function useNotifications() {
  return useQuery({
    queryKey: ["app-notifications"],
    // Refresh periodically so the bell reflects new entries without a manual reload.
    refetchInterval: 60_000,
    queryFn: async (): Promise<AppNotification[]> => {
      const since = daysAgo(7);
      const { data: entries, error: entriesErr } = await supabase
        .from("daily_entries")
        .select("id, entry_date, making_actual, packing_actual, production_lines(name)")
        .gte("entry_date", since)
        .order("entry_date", { ascending: false });
      if (entriesErr || !entries || entries.length === 0) return [];

      const entryIds = entries.map((e) => e.id);
      const [{ data: downtimes }, { data: owners }, { data: areas }] = await Promise.all([
        supabase.from("entry_downtimes").select("entry_id, minutes, reason_name").in("entry_id", entryIds),
        supabase.from("entry_area_owners").select("entry_id, performance_score").in("entry_id", entryIds),
        supabase.from("production_areas").select("id").eq("is_active", true),
      ]);

      const notifications: AppNotification[] = [];
      const lineName = (e: (typeof entries)[number]) => (e as unknown as { production_lines: { name: string } | null }).production_lines?.name ?? "—";

      for (const d of downtimes ?? []) {
        if (Number(d.minutes) > 30) {
          const entry = entries.find((e) => e.id === d.entry_id);
          if (!entry) continue;
          notifications.push({
            id: `downtime-${d.entry_id}-${d.reason_name}-${d.minutes}`,
            severity: "critical",
            message: `Downtime of ${d.minutes} min (${d.reason_name}) on ${lineName(entry)}`,
            entryDate: entry.entry_date,
            lineName: lineName(entry),
          });
        }
      }

      for (const o of owners ?? []) {
        if (o.performance_score != null && Number(o.performance_score) < 70) {
          const entry = entries.find((e) => e.id === o.entry_id);
          if (!entry) continue;
          notifications.push({
            id: `perf-${o.entry_id}`,
            severity: "warning",
            message: `Performance ${Number(o.performance_score).toFixed(1)}% on ${lineName(entry)}`,
            entryDate: entry.entry_date,
            lineName: lineName(entry),
          });
        }
      }

      const hasAreas = (areas?.length ?? 0) > 0;
      if (hasAreas) {
        const scoredEntryIds = new Set((owners ?? []).filter((o) => o.performance_score != null).map((o) => o.entry_id));
        for (const entry of entries) {
          if (!scoredEntryIds.has(entry.id)) {
            notifications.push({
              id: `missing-score-${entry.id}`,
              severity: "warning",
              message: `Missing Performance Score on ${lineName(entry)}`,
              entryDate: entry.entry_date,
              lineName: lineName(entry),
            });
          }
        }
      }

      for (const entry of entries) {
        if (!Number(entry.making_actual) && !Number(entry.packing_actual)) {
          notifications.push({
            id: `missing-qty-${entry.id}`,
            severity: "warning",
            message: `Missing Production Quantity on ${lineName(entry)}`,
            entryDate: entry.entry_date,
            lineName: lineName(entry),
          });
        }
      }

      return notifications.sort((a, b) => (a.entryDate < b.entryDate ? 1 : -1)).slice(0, 50);
    },
  });
}
