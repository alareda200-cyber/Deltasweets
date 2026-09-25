import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { requireSession } from "@/lib/require-session";
import {
  linesQuery,
  allReasonsQuery,
  reasonUsageQuery,
  lineFieldCountsQuery,
  productionAreasQuery,
  areaOwnersQuery,
  departmentsQuery,
  downtimeTypesQuery,
  severityLevelsQuery,
  departmentCategoriesQuery,
  techniciansQuery,
  appSettingsQuery,
  productionTargetsQuery,
  DEFAULT_TARGETS,
  rootCausesQuery,
} from "@/lib/queries";
import { isSectionId, type SectionId } from "@/components/settings/sections";
import {
  SettingsMobileList,
  SettingsSidebar,
  type NavKey,
  type NavSummary,
} from "@/components/settings/SettingsNav";
import { LOCKED_NAMES, isLockedName } from "@/components/settings/shared";
import { LinesSection } from "@/components/settings/LinesSection";
import { FieldsSection } from "@/components/settings/FieldsSection";
import { ReasonsSection } from "@/components/settings/ReasonsSection";
import { TechniciansSection } from "@/components/settings/TechniciansSection";
import {
  AreaOwnersSection,
  DepartmentsSection,
  ProductionAreasSection,
  RootCausesSection,
  SimpleCodeListSection,
} from "@/components/settings/MasterDataSections";
import { FaultTitlesSection, type FaultTitleStat } from "@/components/settings/FaultTitlesSection";
import {
  BackupSection,
  ReliabilitySection,
  TargetsSection,
} from "@/components/settings/SystemSections";

// /settings?section=<id> opens one section (ids: see sections.ts — a contract
// with the mobile More tab). `line` picks the line on the Line fields section.
interface SettingsSearch {
  section?: SectionId;
  line?: string;
}

// The section desktop shows when the URL names none. Below md the bare URL
// shows the grouped list instead.
const DEFAULT_SECTION: SectionId = "lines";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings · Production Scorecard" }] }),
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({
    section: isSectionId(search.section) ? search.section : undefined,
    line: typeof search.line === "string" && search.line ? search.line : undefined,
  }),
  beforeLoad: requireSession,
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(linesQuery),
      context.queryClient.ensureQueryData(allReasonsQuery),
      context.queryClient.ensureQueryData(productionAreasQuery),
      context.queryClient.ensureQueryData(areaOwnersQuery),
      context.queryClient.ensureQueryData(departmentsQuery),
      context.queryClient.ensureQueryData(downtimeTypesQuery),
      context.queryClient.ensureQueryData(severityLevelsQuery),
      context.queryClient.ensureQueryData(departmentCategoriesQuery),
      context.queryClient.ensureQueryData(techniciansQuery),
      context.queryClient.ensureQueryData(rootCausesQuery()),
    ]),
  component: () => (
    <RequireAuth requirePermission="settings.manage">
      <SettingsPage />
    </RequireAuth>
  ),
});

// "2026-08-18" → "18 Aug" (plus the year when it isn't this year).
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function SettingsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: lines } = useSuspenseQuery(linesQuery);
  const { data: reasons } = useSuspenseQuery(allReasonsQuery);
  const { data: productionAreas } = useSuspenseQuery(productionAreasQuery);
  const { data: areaOwners } = useSuspenseQuery(areaOwnersQuery);
  const { data: departments } = useSuspenseQuery(departmentsQuery);
  const { data: downtimeTypes } = useSuspenseQuery(downtimeTypesQuery);
  const { data: severityLevels } = useSuspenseQuery(severityLevelsQuery);
  const { data: departmentCategories } = useSuspenseQuery(departmentCategoriesQuery);
  const { data: technicians } = useSuspenseQuery(techniciansQuery);
  const { data: rootCauses } = useSuspenseQuery(rootCausesQuery());
  const usageQ = useQuery(reasonUsageQuery);
  const { data: fieldCounts = {} } = useQuery(lineFieldCountsQuery);
  // Only for the "Users ↗" count in the sidebar — users are managed on /users.
  const { data: users = [] } = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").order("email");
      if (error) throw error;
      return data;
    },
  });
  // Every distinct title used on a maintenance_events row, with how many
  // events carry it — grouped client-side, sorted by count desc.
  const { data: faultTitleStats = [] } = useQuery({
    queryKey: ["fault-title-stats"],
    queryFn: async (): Promise<FaultTitleStat[]> => {
      const { data, error } = await supabase.from("maintenance_events").select("title");
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        const t = row.title;
        if (!t) continue;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([title, count]) => ({ title, count }))
        .sort((a, b) => b.count - a.count);
    },
  });
  // Never throws (see appSettingsQuery) — a fetch hiccup falls back to null,
  // i.e. no window declared, i.e. count everything.
  const { data: appSettings } = useQuery(appSettingsQuery());
  const reliabilityStartDate = appSettings?.reliability_start_date ?? null;
  const rootCauseTrackingStartDate = appSettings?.root_cause_tracking_start_date ?? null;
  const { data: targets = DEFAULT_TARGETS } = useQuery(productionTargetsQuery());
  const qc = useQueryClient();
  const [find, setFind] = useState("");

  const active: SectionId = search.section ?? DEFAULT_SECTION;
  const fieldsLineId =
    (search.line && lines.some((l) => l.id === search.line) ? search.line : lines[0]?.id) ?? null;
  const totalFields = Object.values(fieldCounts).reduce((s, n) => s + n, 0);
  const activeReasons = reasons.filter((r) => r.is_active).length;
  const lockedDepartments = departments.filter((d) =>
    isLockedName(LOCKED_NAMES.departments, d.name),
  ).length;
  const anyLocked = (list: readonly string[], rows: { name: string }[]) =>
    rows.some((r) => isLockedName(list, r.name));

  const summaries: Record<NavKey, NavSummary> = {
    lines: { count: String(lines.length) },
    areas: { count: String(productionAreas.length) },
    reasons: { count: String(reasons.length), sub: `${activeReasons} active` },
    fields: { count: String(totalFields), sub: totalFields === 0 ? "None yet" : undefined },
    targets: {
      count: `${targets.makingPct}%`,
      sub: `Making ${targets.makingPct}% · packing ${targets.packingPct}% · time lost ${targets.lossPct}%`,
    },
    technicians: {
      count: String(technicians.length),
      sub: `${technicians.filter((t) => t.is_active).length} active`,
    },
    departments: {
      count: String(departments.length),
      sub: lockedDepartments > 0 ? `${lockedDepartments} are locked` : undefined,
    },
    categories: {
      count: String(departmentCategories.length),
      sub: anyLocked(LOCKED_NAMES.categories, departmentCategories) ? "Locked names" : undefined,
    },
    types: {
      count: String(downtimeTypes.length),
      sub: anyLocked(LOCKED_NAMES.types, downtimeTypes) ? "Locked names" : undefined,
    },
    severity: {
      count: String(severityLevels.length),
      sub: anyLocked(LOCKED_NAMES.severity, severityLevels) ? "Locked names" : undefined,
    },
    rootCauses: { count: String(rootCauses.length) },
    faultTitles: {
      count: String(faultTitleStats.length),
      sub: "Rewrites past maintenance events",
    },
    areaOwners: { count: String(areaOwners.length) },
    users: { count: users.length ? String(users.length) : undefined },
    reliability: {
      count: reliabilityStartDate ? `from ${shortDate(reliabilityStartDate)}` : "not set",
      sub: reliabilityStartDate
        ? `MTBF/MTTR count from ${shortDate(reliabilityStartDate)}`
        : "MTBF/MTTR count every event",
    },
    backup: { sub: "A restore overwrites rows with the same id" },
  };

  function renderSection(id: SectionId) {
    switch (id) {
      case "lines":
        return <LinesSection lines={lines} fieldCounts={fieldCounts} qc={qc} />;
      case "areas":
        return <ProductionAreasSection areas={productionAreas} qc={qc} />;
      case "reasons":
        return (
          <ReasonsSection
            reasons={reasons}
            usage={usageQ.data ?? {}}
            usageLoaded={usageQ.isSuccess}
            productionAreas={productionAreas}
            departments={departments}
            downtimeTypes={downtimeTypes}
            severityLevels={severityLevels}
            qc={qc}
          />
        );
      case "fields":
        return (
          <FieldsSection
            lines={lines}
            lineId={fieldsLineId}
            onLineChange={(line) =>
              navigate({ search: { section: "fields", line }, replace: true })
            }
            totalFields={totalFields}
            qc={qc}
          />
        );
      case "targets":
        return <TargetsSection targets={targets} qc={qc} />;
      case "technicians":
        return <TechniciansSection technicians={technicians} qc={qc} />;
      case "departments":
        return (
          <DepartmentsSection
            departments={departments}
            categories={departmentCategories}
            lockedNames={LOCKED_NAMES.departments}
            qc={qc}
          />
        );
      case "categories":
        return (
          <SimpleCodeListSection
            key="categories"
            sectionId="categories"
            table="department_categories"
            auditEntity="department_category"
            queryKey="department-categories"
            noun="department category"
            rows={departmentCategories}
            lockedNames={LOCKED_NAMES.categories}
            namePlaceholder="e.g. Maintenance"
            deleteConsequence="Departments in this category lose their category, and dashboards that filter by it stop counting their downtime."
            qc={qc}
          />
        );
      case "types":
        return (
          <SimpleCodeListSection
            key="types"
            sectionId="types"
            table="downtime_types"
            auditEntity="downtime_type"
            queryKey="downtime-types"
            noun="downtime type"
            rows={downtimeTypes}
            lockedNames={LOCKED_NAMES.types}
            deleteConsequence="Downtime reasons with this type lose it, and their past downtime is no longer counted as planned or unplanned."
            qc={qc}
          />
        );
      case "severity":
        return (
          <SimpleCodeListSection
            key="severity"
            sectionId="severity"
            table="severity_levels"
            auditEntity="severity_level"
            queryKey="severity-levels"
            noun="severity level"
            rows={severityLevels}
            lockedNames={LOCKED_NAMES.severity}
            deleteConsequence="Downtime reasons with this severity lose it, and it drops out of the Pareto ranking."
            qc={qc}
          />
        );
      case "rootCauses":
        return <RootCausesSection rootCauses={rootCauses} qc={qc} />;
      case "faultTitles":
        return <FaultTitlesSection stats={faultTitleStats} qc={qc} />;
      case "areaOwners":
        return <AreaOwnersSection owners={areaOwners} departments={departments} qc={qc} />;
      case "reliability":
        return (
          <ReliabilitySection
            reliabilityStartDate={reliabilityStartDate}
            rootCauseTrackingStartDate={rootCauseTrackingStartDate}
            qc={qc}
          />
        );
      case "backup":
        return <BackupSection qc={qc} />;
    }
  }

  // Below md, a bare /settings is the grouped list and a section fills the
  // screen (with its own "All settings" back link). From md up the sidebar is
  // always there and the bare URL shows DEFAULT_SECTION.
  const listOnMobile = !search.section;

  return (
    <AppShell>
      <div className="md:grid md:grid-cols-[280px_minmax(0,1fr)] md:items-start md:gap-8">
        <aside className="hidden md:block">
          <SettingsSidebar active={active} summaries={summaries} find={find} onFind={setFind} />
        </aside>
        {listOnMobile && (
          <div className="md:hidden">
            <SettingsMobileList summaries={summaries} find={find} onFind={setFind} />
          </div>
        )}
        <div key={active} className={listOnMobile ? "hidden min-w-0 md:block" : "min-w-0"}>
          {renderSection(active)}
        </div>
      </div>
    </AppShell>
  );
}
