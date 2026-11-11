// The events the Plant floor needs: everything that touches the production
// day (started before it ends, and not resolved before it starts), for every
// line of the company in view. Narrow columns, paged, refetched every minute.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { selectAllRows } from "@/lib/queries";
import type { PlantEvent } from "@/lib/plant-floor";

export const plantEventsQuery = (startMs: number, endMs: number) =>
  queryOptions({
    queryKey: ["plant-events", startMs, endMs],
    refetchInterval: 60_000,
    queryFn: async (): Promise<PlantEvent[]> => {
      const from = new Date(startMs).toISOString();
      const to = new Date(endMs).toISOString();
      const data = await selectAllRows(() =>
        supabase
          .from("maintenance_events")
          .select(
            "id, line_id, type, title, status, started_at, resolved_at, stops_line, machine_id",
          )
          .lt("started_at", to)
          .or(`resolved_at.is.null,resolved_at.gte.${from}`)
          .order("started_at")
          .order("id"),
      );
      return data as unknown as PlantEvent[];
    },
  });

// The newest event that has started by now: the latest production day whose
// fault report is in. Faults are usually imported the day after, so this is
// where the Plant floor opens.
export const latestReportedEventQuery = () =>
  queryOptions({
    queryKey: ["plant-latest-event"],
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("maintenance_events")
        .select("started_at")
        .lt("started_at", new Date().toISOString())
        .order("started_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0]?.started_at ?? null;
    },
  });
