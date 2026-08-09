import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { iso } from "@/lib/date-utils";

export interface ProductionLine {
  id: string;
  name: string;
  code: string | null;
  color: string;
  sort_order: number;
  is_active: boolean;
}

export interface LineFieldDef {
  id: string;
  line_id: string;
  field_key: string;
  label: string;
  section: "making" | "packing" | "downtime" | "rework" | "extra";
  unit: string;
  default_value: number | null;
  sort_order: number;
}

export interface DowntimeReason {
  id: string;
  line_id: string | null;
  name: string;
  code: string | null;
  area: string;
  production_area_id: string | null;
  department_id: string | null;
  downtime_type_id: string | null;
  severity_id: string | null;
  is_active: boolean;
}

// Classification fields (department_id/downtime_type_id/severity_id/production_area_id)
// are resolved through the reason's own record via the embedded select in
// entryDowntimesQuery below — they are never duplicated onto entry_downtimes
// itself, so a reason's classification can be corrected in Settings without
// having to touch historical entries.
export interface EntryDowntime {
  id: string;
  entry_id: string;
  reason_id: string | null;
  reason_name: string;
  area: string;
  minutes: number;
  department_id: string | null;
  downtime_type_id: string | null;
  severity_id: string | null;
  production_area_id: string | null;
  // Distinguishes rows synthesized from maintenance_events (see
  // maintenanceEventsAsDowntimes) from real entry_downtimes rows — "entry"
  // rows omit this in older callers, so treat undefined as "entry".
  source?: "entry" | "maintenance";
  // Display-only override for the "Severity" slot on maintenance-derived
  // rows, sourced from maintenance_events.severity_label — a free-text
  // field (no master-data list, unlike severity_id) — so it's carried here
  // rather than resolved via severity_id like a real entry_downtimes row.
  severity_label?: string;
  // Whether the linked downtime_reasons row is still active in Settings.
  // A reason retired from Settings (e.g. a defunct "Preventive
  // Maintenance" bucket) stays on old entry_downtimes rows for historical
  // integrity, but shouldn't count in live downtime analysis (Pareto
  // chart, Top Reasons, KPI totals) — consumers should treat
  // `is_active === false` as "hide this row". null means there's no linked
  // reason to check (or, for source: "maintenance" rows, doesn't apply —
  // those are always set true, never hidden by this rule).
  is_active: boolean | null;
  // Local calendar date (YYYY-MM-DD, see date-utils.iso) the underlying
  // event occurred on. Only set for source: "maintenance" rows — real
  // entry_downtimes rows don't carry their own date here (callers instead
  // match entry_id against the already-fetched daily_entries), and
  // entry_id on a maintenance-derived row is the maintenance_events row's
  // own id, not a daily_entries id, so it can't be used the same way.
  event_date?: string;
  // Aggregated label ("Mechanical Maintenance" / "Electrical Maintenance")
  // for the overall Pareto chart (DowntimeSection), which groups by this
  // instead of reason_name for source: "maintenance" rows so every
  // mechanical (or electrical) event rolls into one bar there. reason_name
  // itself stays the per-event title — MaintenanceDowntimeCard's own
  // chart/Top Reasons list groups by reason_name, not this, so the
  // per-servo detail (Servo 1004, Servo 1002, ...) is unaffected. Undefined
  // for real entry_downtimes rows, which have no type to aggregate by.
  pareto_reason_name?: string;
}

export interface ProductionArea {
  id: string;
  name: string;
  code: string | null;
  display_order: number;
  is_active: boolean;
}

export interface AreaOwner {
  id: string;
  name: string;
  code: string | null;
  employee_id: string | null;
  department: string | null;
  department_id: string | null;
  is_active: boolean;
}

export interface EntryAreaOwner {
  id: string;
  entry_id: string;
  production_area_id: string;
  owner_id: string | null;
  performance_score: number | null;
}

export interface DepartmentCategory {
  id: string;
  code: string;
  name: string;
  display_order: number;
  is_active: boolean;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  department_category_id: string | null;
  display_order: number;
  is_active: boolean;
}

export interface DowntimeType {
  id: string;
  code: string;
  name: string;
  display_order: number;
  is_active: boolean;
}

export interface SeverityLevel {
  id: string;
  code: string;
  name: string;
  display_order: number;
  is_active: boolean;
}

// Standalone master-data list of maintenance staff, assignable to
// maintenance_events via technician_ids — deliberately not filtered to
// is_active here (unlike ProductionArea/AreaOwner/etc. above) because the
// Settings page needs to see and re-activate inactive technicians too;
// callers that only want assignable staff (the Maintenance page's
// multi-select) filter client-side instead.
export interface Technician {
  id: string;
  name: string;
  role: "Technician" | "Engineer" | "Supervisor" | "Operator" | null;
  department: "Mechanical" | "Electrical" | "Production" | null;
  is_active: boolean;
  created_at: string;
}

export interface DailyEntry {
  id: string;
  line_id: string;
  entry_date: string;
  shift: string;
  supervisor: string | null;
  operator: string | null;
  comments: string | null;
  making_plan: number;
  making_actual: number;
  packing_plan: number;
  packing_actual: number;
  available_min: number;
  downtime_min: number;
  rework_cooking: number;
  rework_making: number;
  rework_packing: number;
  custom_fields: Record<string, number | string>;
  created_at: string;
  updated_at: string;
}

export const linesQuery = queryOptions({
  queryKey: ["lines"],
  queryFn: async (): Promise<ProductionLine[]> => {
    const { data, error } = await supabase.from("production_lines").select("*").order("sort_order");
    if (error) throw error;
    return data as ProductionLine[];
  },
});

export const reasonsQuery = queryOptions({
  queryKey: ["reasons"],
  queryFn: async (): Promise<DowntimeReason[]> => {
    const { data, error } = await supabase
      .from("downtime_reasons")
      .select("*")
      .eq("is_active", true)
      .order("name");
    if (error) throw error;
    return data as DowntimeReason[];
  },
});

export const productionAreasQuery = queryOptions({
  queryKey: ["production-areas"],
  queryFn: async (): Promise<ProductionArea[]> => {
    const { data, error } = await supabase
      .from("production_areas")
      .select("*")
      .eq("is_active", true)
      .order("display_order");
    if (error) throw error;
    return data as ProductionArea[];
  },
});

export const areaOwnersQuery = queryOptions({
  queryKey: ["area-owners"],
  queryFn: async (): Promise<AreaOwner[]> => {
    const { data, error } = await supabase
      .from("area_owners")
      .select("*")
      .eq("is_active", true)
      .order("name");
    if (error) throw error;
    return data as AreaOwner[];
  },
});

export const departmentCategoriesQuery = queryOptions({
  queryKey: ["department-categories"],
  queryFn: async (): Promise<DepartmentCategory[]> => {
    const { data, error } = await supabase
      .from("department_categories")
      .select("*")
      .eq("is_active", true)
      .order("display_order");
    if (error) throw error;
    return data as DepartmentCategory[];
  },
});

export const departmentsQuery = queryOptions({
  queryKey: ["departments"],
  queryFn: async (): Promise<Department[]> => {
    const { data, error } = await supabase
      .from("departments")
      .select("*")
      .eq("is_active", true)
      .order("display_order");
    if (error) throw error;
    return data as Department[];
  },
});

export const downtimeTypesQuery = queryOptions({
  queryKey: ["downtime-types"],
  queryFn: async (): Promise<DowntimeType[]> => {
    const { data, error } = await supabase
      .from("downtime_types")
      .select("*")
      .eq("is_active", true)
      .order("display_order");
    if (error) throw error;
    return data as DowntimeType[];
  },
});

export const severityLevelsQuery = queryOptions({
  queryKey: ["severity-levels"],
  queryFn: async (): Promise<SeverityLevel[]> => {
    const { data, error } = await supabase
      .from("severity_levels")
      .select("*")
      .eq("is_active", true)
      .order("display_order");
    if (error) throw error;
    return data as SeverityLevel[];
  },
});

export const techniciansQuery = queryOptions({
  queryKey: ["technicians"],
  queryFn: async (): Promise<Technician[]> => {
    const { data, error } = await supabase.from("technicians").select("*").order("name");
    if (error) throw error;
    return data as Technician[];
  },
});

export const fieldsQuery = (lineId: string | null) =>
  queryOptions({
    queryKey: ["fields", lineId],
    enabled: !!lineId,
    queryFn: async (): Promise<LineFieldDef[]> => {
      if (!lineId) return [];
      const { data, error } = await supabase
        .from("line_field_definitions")
        .select("*")
        .eq("line_id", lineId)
        .order("sort_order");
      if (error) throw error;
      return data as LineFieldDef[];
    },
  });

export interface EntryHistoryRow extends DailyEntry {
  production_lines: { name: string } | null;
}

// Entry History needs entries across ALL lines (unlike entriesQuery, which
// is scoped to one line for the Dashboard) — reuses the same embedded-select
// join pattern already used in entryDowntimesQuery.
export const allEntriesQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ["all-entries", from, to],
    queryFn: async (): Promise<EntryHistoryRow[]> => {
      const { data, error } = await supabase
        .from("daily_entries")
        .select("*, production_lines(name)")
        .gte("entry_date", from)
        .lte("entry_date", to)
        .order("entry_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as EntryHistoryRow[];
    },
  });

// Same two-step "fetch children for a known set of entry ids" shape already
// used by entryDowntimesQuery/entryAreaOwnersQuery — reused here to compute
// each row's Average Performance Score in the history table.
export const entryAreaOwnersForEntriesQuery = (entryIds: string[]) =>
  queryOptions({
    queryKey: ["entry-area-owners-for-entries", entryIds.slice().sort().join(",")],
    enabled: entryIds.length > 0,
    queryFn: async (): Promise<EntryAreaOwner[]> => {
      if (entryIds.length === 0) return [];
      const { data, error } = await supabase
        .from("entry_area_owners")
        .select("*")
        .in("entry_id", entryIds);
      if (error) throw error;
      return (data ?? []) as EntryAreaOwner[];
    },
  });

export const entriesQuery = (lineId: string | null, from: string, to: string) =>
  queryOptions({
    queryKey: ["entries", lineId, from, to],
    enabled: !!lineId,
    queryFn: async (): Promise<DailyEntry[]> => {
      if (!lineId) return [];
      const { data, error } = await supabase
        .from("daily_entries")
        .select("*")
        .eq("line_id", lineId)
        .gte("entry_date", from)
        .lte("entry_date", to)
        .order("entry_date");
      if (error) throw error;
      return (data ?? []) as DailyEntry[];
    },
  });

// Takes entry IDs already fetched by entriesQuery instead of re-querying
// daily_entries for the same line_id/date range — avoids a duplicate round trip.
export const entryDowntimesForEntriesQuery = (entryIds: string[]) =>
  queryOptions({
    queryKey: ["entry-downtimes-for-entries", entryIds.slice().sort().join(",")],
    enabled: entryIds.length > 0,
    queryFn: async (): Promise<EntryDowntime[]> => {
      if (entryIds.length === 0) return [];
      // Resolve each downtime's classification (department/type/severity/production area)
      // through its reason via an embedded select — same single round trip,
      // no separate lookup query, no N+1.
      const { data, error } = await supabase
        .from("entry_downtimes")
        .select(
          "*, downtime_reasons(department_id, downtime_type_id, severity_id, production_area_id, is_active)",
        )
        .in("entry_id", entryIds);
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: row.id,
        entry_id: row.entry_id,
        reason_id: row.reason_id,
        reason_name: row.reason_name,
        area: row.area,
        minutes: row.minutes,
        department_id: row.downtime_reasons?.department_id ?? null,
        downtime_type_id: row.downtime_reasons?.downtime_type_id ?? null,
        severity_id: row.downtime_reasons?.severity_id ?? null,
        production_area_id: row.downtime_reasons?.production_area_id ?? null,
        is_active: row.downtime_reasons?.is_active ?? null,
        source: "entry" as const,
      }));
    },
  });

export type MaintenanceType = "mechanical" | "electrical";
export type MaintenanceStatus = "open" | "in_progress" | "resolved";

export interface MaintenanceEvent {
  id: string;
  line_id: string | null;
  type: MaintenanceType;
  title: string;
  description: string | null;
  status: MaintenanceStatus;
  started_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_by: string | null;
  created_at: string;
  // Free text, no master-data list — see
  // 20260804220000_maintenance_events_severity.sql.
  severity_label: string | null;
  // Deprecated free-text technician name — superseded by technician_ids
  // below (see 20260809120000_technicians.sql). Left populated on
  // historical rows but no longer written to by the create/edit forms.
  technician: string | null;
  // Who actually did the work, which may differ from created_by (whoever
  // was logged in when the event was entered). References technicians.id.
  technician_ids: string[];
  // Resolved from technician_ids against the technicians table by
  // maintenanceEventsQuery below — PostgREST can't embed a relation over a
  // uuid[] column, so this is joined client-side in the query itself
  // (once, here) rather than duplicated in every caller that displays
  // names. Omits any id whose technician has since been deleted.
  technician_names: string[];
  production_lines: { name: string } | null;
  // Embedded (not a separate batch query) so the events table can show a
  // notes preview per row without an N+1 fetch — ordered oldest-first so
  // callers wanting "the first note" can just read index 0.
  maintenance_notes: { note: string; created_at: string }[];
  // Null whenever the viewer's role can't read another user's profiles row
  // (see "Users can read own profile" / "Admins can read all profiles" in
  // 20260707145601_auth_and_roles.sql) — not an error, just degrades the
  // "Closed by" display to "—" for non-admin viewers of someone else's
  // resolution.
  resolved_by_profile: { display_name: string | null; email: string } | null;
}

export interface MaintenanceNote {
  id: string;
  event_id: string;
  note: string;
  created_by: string | null;
  created_at: string;
}

export const maintenanceEventsQuery = (
  lineId?: string | null,
  type?: MaintenanceType | null,
  status?: MaintenanceStatus | null,
  from?: string | null,
  to?: string | null,
) =>
  queryOptions({
    queryKey: ["maintenance-events", lineId, type, status, from, to],
    queryFn: async (): Promise<MaintenanceEvent[]> => {
      let query = supabase
        .from("maintenance_events")
        .select(
          "*, production_lines(name), maintenance_notes(note, created_at), resolved_by_profile:profiles!resolved_by(display_name, email)",
        )
        .order("started_at", { ascending: false })
        .order("created_at", { foreignTable: "maintenance_notes", ascending: true });
      if (lineId) query = query.eq("line_id", lineId);
      if (type) query = query.eq("type", type);
      if (status) query = query.eq("status", status);
      if (from) query = query.gte("started_at", from);
      if (to) query = query.lte("started_at", to);
      // Run alongside the events query, not after it — the technicians
      // table is tiny and this keeps the roundtrip parallel instead of
      // serial.
      const [{ data, error }, { data: techs, error: techsError }] = await Promise.all([
        query,
        supabase.from("technicians").select("id, name"),
      ]);
      if (error) throw error;
      if (techsError) throw techsError;
      const technicianNameById = new Map((techs ?? []).map((t) => [t.id, t.name]));
      const rows = (data ?? []) as unknown as (MaintenanceEvent & { technician_ids: string[] })[];
      return rows.map((row) => ({
        ...row,
        technician_names: row.technician_ids
          .map((id) => technicianNameById.get(id))
          .filter((name): name is string => Boolean(name)),
      }));
    },
  });

// Converts maintenance_events rows already fetched via maintenanceEventsQuery
// into EntryDowntime-shaped rows, so the Dashboard's downtime Pareto chart
// and the Maintenance card's Top Reasons list can merge them in with real
// entry_downtimes rows without either chart knowing about a second data
// source. Pure/sync — callers own the actual maintenanceEventsQuery fetch
// (line_id/date-range filtered to match entriesQuery's own window) so there's
// one query for maintenance_events, not a second bespoke one.
//
// department_id/downtime_type_id are resolved against real Settings master
// data (by name) rather than left null, so every maintenance-derived row
// classifies the same way a real entry_downtimes row would — MaintenanceDowntimeCard's
// `nameOf()` falls back to "Unclassified" on a null/unmatched id, which is
// what these rows showed before this existed. Severity has no equivalent
// master-data id here — maintenance_events.severity_label (added in
// 20260804220000_maintenance_events_severity.sql) is free text, passed
// through as severity_label rather than a severity_id, honestly showing
// "Unclassified" only when nobody filled it in.
export function maintenanceEventsAsDowntimes(
  events: MaintenanceEvent[],
  departments: Department[],
  downtimeTypes: DowntimeType[],
): EntryDowntime[] {
  const now = Date.now();
  const mechanicalDeptId = departments.find((d) => d.name.trim().toLowerCase() === "mechanical maintenance")?.id ?? null;
  const electricalDeptId = departments.find((d) => d.name.trim().toLowerCase() === "electrical maintenance")?.id ?? null;
  // Every maintenance_events row is an unplanned equipment failure/repair —
  // scheduled/preventive maintenance is tracked separately as an ordinary
  // downtime_reasons entry, not through this table.
  const unplannedTypeId = downtimeTypes.find((t) => t.name.trim().toLowerCase() === "unplanned")?.id ?? null;
  return events.map((e) => {
    const startedMs = new Date(e.started_at).getTime();
    const endMs = e.status === "resolved" && e.resolved_at ? new Date(e.resolved_at).getTime() : now;
    return {
      id: `maintenance-${e.id}`,
      entry_id: e.id,
      reason_id: null,
      // Each event keeps its own title as the reason name, so
      // MaintenanceDowntimeCard's Top Reasons list/chart (which groups by
      // reason_name) still shows one row per event instead of every
      // mechanical (or every electrical) event collapsing together. The
      // overall Pareto chart (DowntimeSection) groups by pareto_reason_name
      // instead, below, to get the aggregated per-type bar.
      reason_name: e.title,
      // See EntryDowntime.pareto_reason_name.
      pareto_reason_name: e.type === "mechanical" ? "Mechanical Maintenance" : "Electrical Maintenance",
      area: e.production_lines?.name ?? "—",
      minutes: Math.max(0, (endMs - startedMs) / 60_000),
      department_id: e.type === "mechanical" ? mechanicalDeptId : electricalDeptId,
      downtime_type_id: unplannedTypeId,
      severity_id: null,
      severity_label: e.severity_label ?? undefined,
      production_area_id: null,
      // Not reason-based, so the is_active-deactivation rule (see
      // EntryDowntime.is_active) never hides these rows.
      is_active: true,
      source: "maintenance" as const,
      // Local calendar date the event started on — see EntryDowntime.event_date.
      event_date: iso(new Date(e.started_at)),
    };
  });
}

export const maintenanceNotesQuery = (eventId: string | null) =>
  queryOptions({
    queryKey: ["maintenance-notes", eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<MaintenanceNote[]> => {
      if (!eventId) return [];
      const { data, error } = await supabase
        .from("maintenance_notes")
        .select("*")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as MaintenanceNote[];
    },
  });

export interface MaintenanceMetric {
  line_id: string;
  line_name: string;
  type: MaintenanceType;
  // Average gap (hours) between started_at of consecutive events of this
  // line+type, sorted chronologically — null when fewer than 2 events exist
  // (no gap can be computed).
  mtbf_hours: number | null;
  // Number of gaps behind mtbf_hours (event_count - 1) — exposed so callers
  // needing a plant-wide MTBF (e.g. the Dashboard summary card) can compute a
  // correct weighted average across lines instead of averaging this
  // per-line average again.
  mtbf_gap_count: number;
  // Average resolved_at - started_at (hours) across resolved events of this
  // line+type — null when none are resolved yet.
  mttr_hours: number | null;
  mttr_sample_count: number;
  event_count: number;
  resolved_count: number;
}

// Computes MTBF/MTTR per line x type from every maintenance_events row (no
// date filter — these are lifetime reliability metrics, not period metrics).
// Grouping by line is required before computing gaps: pooling two lines'
// started_at values together would produce a meaningless gap between an
// event on one line and an unrelated event on another.
export const maintenanceMetricsQuery = () =>
  queryOptions({
    queryKey: ["maintenance-metrics"],
    queryFn: async (): Promise<MaintenanceMetric[]> => {
      const { data, error } = await supabase
        .from("maintenance_events")
        .select("line_id, type, started_at, resolved_at, production_lines(name)")
        .order("started_at");
      if (error) throw error;

      type Row = {
        line_id: string | null;
        type: MaintenanceType;
        started_at: string;
        resolved_at: string | null;
        production_lines: { name: string } | null;
      };

      const groups = new Map<
        string,
        { line_id: string; line_name: string; type: MaintenanceType; starts: number[]; durationsHours: number[] }
      >();
      for (const row of (data ?? []) as unknown as Row[]) {
        if (!row.line_id) continue;
        const key = `${row.line_id}::${row.type}`;
        let g = groups.get(key);
        if (!g) {
          g = { line_id: row.line_id, line_name: row.production_lines?.name ?? "—", type: row.type, starts: [], durationsHours: [] };
          groups.set(key, g);
        }
        g.starts.push(new Date(row.started_at).getTime());
        if (row.resolved_at) {
          g.durationsHours.push((new Date(row.resolved_at).getTime() - new Date(row.started_at).getTime()) / 3_600_000);
        }
      }

      const metrics: MaintenanceMetric[] = [];
      for (const g of groups.values()) {
        const starts = [...g.starts].sort((a, b) => a - b);
        let mtbfHours: number | null = null;
        const gapCount = Math.max(0, starts.length - 1);
        if (gapCount > 0) {
          let totalGapHours = 0;
          for (let i = 1; i < starts.length; i++) totalGapHours += (starts[i] - starts[i - 1]) / 3_600_000;
          mtbfHours = totalGapHours / gapCount;
        }
        const mttrHours = g.durationsHours.length > 0
          ? g.durationsHours.reduce((s, v) => s + v, 0) / g.durationsHours.length
          : null;
        metrics.push({
          line_id: g.line_id,
          line_name: g.line_name,
          type: g.type,
          mtbf_hours: mtbfHours,
          mtbf_gap_count: gapCount,
          mttr_hours: mttrHours,
          mttr_sample_count: g.durationsHours.length,
          event_count: g.starts.length,
          resolved_count: g.durationsHours.length,
        });
      }
      return metrics.sort((a, b) => a.line_name.localeCompare(b.line_name) || a.type.localeCompare(b.type));
    },
  });
