import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
    const { data, error } = await supabase
      .from("production_lines")
      .select("*")
      .order("sort_order");
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
      const { data, error } = await supabase.from("entry_area_owners").select("*").in("entry_id", entryIds);
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

export const entryDowntimesQuery = (lineId: string | null, from: string, to: string) =>
  queryOptions({
    queryKey: ["entry-downtimes", lineId, from, to],
    enabled: !!lineId,
    queryFn: async (): Promise<EntryDowntime[]> => {
      if (!lineId) return [];
      // Get entry IDs in range
      const { data: entries, error: e1 } = await supabase
        .from("daily_entries")
        .select("id")
        .eq("line_id", lineId)
        .gte("entry_date", from)
        .lte("entry_date", to);
      if (e1) throw e1;
      const ids = (entries ?? []).map((e) => e.id);
      if (ids.length === 0) return [];
      // Resolve each downtime's classification (department/type/severity/production area)
      // through its reason via an embedded select — same single round trip,
      // no separate lookup query, no N+1.
      const { data, error } = await supabase
        .from("entry_downtimes")
        .select("*, downtime_reasons(department_id, downtime_type_id, severity_id, production_area_id)")
        .in("entry_id", ids);
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
      }));
    },
  });

export const entryAreaOwnersQuery = (lineId: string | null, from: string, to: string) =>
  queryOptions({
    queryKey: ["entry-area-owners", lineId, from, to],
    enabled: !!lineId,
    queryFn: async (): Promise<EntryAreaOwner[]> => {
      if (!lineId) return [];
      // Get entry IDs in range
      const { data: entries, error: e1 } = await supabase
        .from("daily_entries")
        .select("id")
        .eq("line_id", lineId)
        .gte("entry_date", from)
        .lte("entry_date", to);
      if (e1) throw e1;
      const ids = (entries ?? []).map((e) => e.id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("entry_area_owners")
        .select("*")
        .in("entry_id", ids);
      if (error) throw error;
      return data as EntryAreaOwner[];
    },
  });
