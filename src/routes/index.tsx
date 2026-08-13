import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useState, useMemo, useRef, lazy, Suspense } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { MaintenanceEventsCard } from "@/components/MaintenanceEventsCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  linesQuery,
  entriesQuery,
  entryDowntimesForEntriesQuery,
  maintenanceEventsAsDowntimes,
  productionAreasQuery,
  areaOwnersQuery,
  entryAreaOwnersForEntriesQuery,
  departmentsQuery,
  departmentCategoriesQuery,
  downtimeTypesQuery,
  severityLevelsQuery,
  maintenanceEventsQuery,
  maintenanceStoppagesQuery,
} from "@/lib/queries";
import { monthRange, pct } from "@/lib/date-utils";
import { requireSession } from "@/lib/require-session";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { PlusSquare, FileDown, Loader2, Factory, Bell, Inbox } from "lucide-react";

// recharts (the bulk of these components' weight) is code-split into its own
// chunk; loading these lazily keeps it out of the main route bundle and lets
// the dashboard shell (header, tabs) paint before charts finish downloading.
const PerformanceSection = lazy(() =>
  import("@/components/PerformanceSection").then((m) => ({ default: m.PerformanceSection })),
);
const DowntimeSection = lazy(() =>
  import("@/components/DowntimeSection").then((m) => ({ default: m.DowntimeSection })),
);
const ReworkSection = lazy(() =>
  import("@/components/ReworkSection").then((m) => ({ default: m.ReworkSection })),
);
const TopQualityAreaCard = lazy(() =>
  import("@/components/TopQualityAreaCard").then((m) => ({ default: m.TopQualityAreaCard })),
);
const MaintenanceDowntimeCard = lazy(() =>
  import("@/components/MaintenanceDowntimeCard").then((m) => ({
    default: m.MaintenanceDowntimeCard,
  })),
);

function ChartsSkeleton() {
  return (
    <div className="mt-6 grid grid-cols-1 gap-6">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-64 animate-pulse rounded-2xl border border-border bg-card" />
      ))}
    </div>
  );
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Production Scorecard · Dashboard" },
      {
        name: "description",
        content: "Live MTD + last-day plant performance across all production lines.",
      },
    ],
  }),
  beforeLoad: requireSession,
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(linesQuery),
      context.queryClient.ensureQueryData(productionAreasQuery),
      context.queryClient.ensureQueryData(areaOwnersQuery),
      context.queryClient.ensureQueryData(departmentsQuery),
      context.queryClient.ensureQueryData(departmentCategoriesQuery),
      context.queryClient.ensureQueryData(downtimeTypesQuery),
      context.queryClient.ensureQueryData(severityLevelsQuery),
    ]),
  component: () => (
    <RequireAuth requirePermission="dashboard.view">
      <Dashboard />
    </RequireAuth>
  ),
});

function Dashboard() {
  const navigate = useNavigate();
  const { data: lines } = useSuspenseQuery(linesQuery);
  const initial = monthRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const exportRef = useRef<HTMLDivElement>(null);

  // Scoped to the currently selected line (see that component's comment) —
  // not date-range filtered, so an open event stays visible regardless of
  // the From/To window above it. Visible to every role that can reach the
  // Dashboard at all (RequireAuth below already requires "dashboard.view"),
  // unlike the standalone /maintenance page which stays gated behind
  // "maintenance.view".
  const { data: maintenanceEvents = [] } = useQuery(
    maintenanceEventsQuery(lineId, null, null, null, null),
  );

  const activeLine = useMemo(() => lines.find((l) => l.id === lineId) ?? lines[0], [lines, lineId]);
  // Same "open" predicate MaintenanceEventsCard uses for its OPEN MECHANICAL/
  // OPEN ELECTRICAL KPIs — reused here only to light the mobile header's bell
  // dot, not a new source of truth.
  const hasOpenFaults = maintenanceEvents.some((e) => e.status !== "resolved");

  async function handleExportPdf() {
    if (!activeLine || !exportRef.current) return;
    setExporting(true);
    setExportProgress("Preparing PDF…");
    try {
      const { exportDashboardToPdf } = await import("@/lib/pdf-export");
      await exportDashboardToPdf({
        container: exportRef.current,
        dashboardName: "Production Scorecard Dashboard",
        lineName: activeLine.name,
        from,
        to,
        onProgress: (msg) => setExportProgress(msg),
      });
      toast.success("PDF exported successfully");
      void logAudit("dashboard.export_pdf", "dashboard", activeLine.id, {
        lineName: activeLine.name,
        from,
        to,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`PDF export failed: ${msg}`);
    } finally {
      setExporting(false);
      setExportProgress("");
    }
  }

  return (
    <AppShell>
      {lines.length === 0 ? (
        <EmptyState onCreate={() => navigate({ to: "/settings" })} />
      ) : (
        <div ref={exportRef}>
          <HeroHeader line={activeLine} from={from} to={to} hasOpenFaults={hasOpenFaults} />

          <div
            data-pdf-exclude="true"
            className="mt-6 flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-card md:flex-row md:items-end md:justify-between"
          >
            <Tabs value={lineId} onValueChange={setLineId} className="min-w-0 flex-1">
              <TabsList className="flex w-full items-center justify-start gap-1 overflow-x-auto bg-muted/50 p-1">
                {lines.map((l) => (
                  <TabsTrigger
                    key={l.id}
                    value={l.id}
                    className="shrink-0 whitespace-nowrap data-[state=active]:bg-card data-[state=active]:shadow-sm"
                  >
                    <span
                      className="mr-2 inline-block h-2 w-2 rounded-full"
                      style={{ background: l.color }}
                    />
                    {l.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:flex md:flex-wrap md:items-end">
              {/* From/To as their own compact row on mobile — md:contents
                  unwraps this div entirely at md+, so it has zero effect on
                  the md:flex md:flex-wrap layout below: From/To become two
                  independent flex items there again, exactly as before. */}
              <div className="grid grid-cols-2 gap-2 sm:col-span-2 md:contents">
                <div>
                  <Label className="text-xs">From</Label>
                  <Input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="h-9 w-full sm:w-[150px]"
                  />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="h-9 w-full sm:w-[150px]"
                  />
                </div>
              </div>
              {/* This Month + Export PDF as their own compact row on mobile —
                  same md:contents unwrap as above. */}
              <div className="grid grid-cols-2 gap-2 sm:col-span-2 md:contents">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full md:w-auto"
                  onClick={() => {
                    const m = monthRange();
                    setFrom(m.from);
                    setTo(m.to);
                  }}
                >
                  This Month
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full md:w-auto"
                  onClick={handleExportPdf}
                  disabled={exporting}
                >
                  {exporting ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <FileDown className="mr-1.5 h-4 w-4" />
                  )}
                  {exporting ? exportProgress || "Preparing PDF…" : "Export PDF"}
                </Button>
              </div>
              {/* New Entry: prominent full-width button below the two rows
                  above on mobile (h-11); md:h-8 restores the exact original
                  size="sm" height (32px) at md+, where it just flows inline
                  again like every other control here. */}
              <Button
                size="sm"
                className="h-11 w-full sm:col-span-2 md:h-8 md:w-auto"
                onClick={() => navigate({ to: "/entry" })}
              >
                <PlusSquare className="mr-1.5 h-4 w-4" /> New Entry
              </Button>
            </div>
          </div>

          <div className="mt-6" data-pdf-section="maintenance-events">
            <MaintenanceEventsCard events={maintenanceEvents} />
          </div>

          {activeLine && (
            <DashboardBody lineId={activeLine.id} color={activeLine.color} from={from} to={to} />
          )}
        </div>
      )}
    </AppShell>
  );
}

function HeroHeader({
  line,
  from,
  to,
  hasOpenFaults,
}: {
  line: { name: string; color: string } | undefined;
  from: string;
  to: string;
  hasOpenFaults: boolean;
}) {
  return (
    <>
      {/* Mobile-only compact replacement for the full hero below — brand mark
          + line name on the left, a faults bell on the right, per the
          approved mobile mockup. Not part of data-pdf-section="hero" (no
          data-pdf-section attribute of its own), so it never appears in PDF
          exports regardless of screen size. */}
      <div className="md:hidden flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-lg bg-accent">
            <Factory className="h-3.5 w-3.5 text-accent-foreground" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold leading-tight">Scorecard OS</div>
            <div className="truncate text-xs leading-tight text-muted-foreground">
              {line?.name ?? "—"}
            </div>
          </div>
        </div>
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {hasOpenFaults && (
            <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-destructive" />
          )}
        </div>
      </div>

      {/* hidden md:block: the big gradient hero is replaced on mobile by the
          compact header above. Still always captured by PDF export — see
          pdf-export.ts's forced-visible handling of any display:none
          data-pdf-section element. */}
      <div
        data-pdf-section="hero"
        className="hidden overflow-hidden rounded-3xl gradient-hero p-8 text-white shadow-elevated md:block md:p-10"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.3em] opacity-80">
          Daily Production Scorecard
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-5xl">
          {line?.name ?? "—"} <span className="opacity-70">Production Line</span>
        </h1>
        <p className="mt-2 text-sm opacity-90">Making → Packing · Plant Performance Overview</p>
        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">
          Reporting period · {from} → {to}
        </p>
      </div>
    </>
  );
}

function DashboardBody({
  lineId,
  color,
  from,
  to,
}: {
  lineId: string;
  color: string;
  from: string;
  to: string;
}) {
  const { role } = useAuth();
  const { data: entries = [] } = useSuspenseQuery(entriesQuery(lineId, from, to));
  const entryIds = useMemo(() => entries.map((e) => e.id), [entries]);
  const { data: entryDowntimes = [] } = useSuspenseQuery(entryDowntimesForEntriesQuery(entryIds));
  // Merges in mechanical/electrical maintenance_events (same line_id/date
  // range as the rest of the dashboard) so the downtime Pareto chart and the
  // Maintenance card's Top Reasons list both show real maintenance downtime
  // alongside entry_downtimes — see maintenanceEventsAsDowntimes.
  const { data: lineMaintenanceEvents = [] } = useSuspenseQuery(
    maintenanceEventsQuery(lineId, null, null, from, to),
  );
  // No date filter (unlike lineMaintenanceEvents above) — a stoppage
  // referenced by an in-window event still needs its own started_at/
  // resolved_at looked up regardless of whether those fall inside [from,
  // to], see maintenanceEventsAsDowntimes.
  const { data: lineMaintenanceStoppages = [] } = useSuspenseQuery(
    maintenanceStoppagesQuery(lineId),
  );
  const { data: entryAreaOwners = [] } = useSuspenseQuery(entryAreaOwnersForEntriesQuery(entryIds));
  const { data: productionAreas } = useSuspenseQuery(productionAreasQuery);
  const { data: areaOwners } = useSuspenseQuery(areaOwnersQuery);
  const { data: departments } = useSuspenseQuery(departmentsQuery);
  const { data: departmentCategories } = useSuspenseQuery(departmentCategoriesQuery);
  const { data: downtimeTypes } = useSuspenseQuery(downtimeTypesQuery);
  const { data: severityLevels } = useSuspenseQuery(severityLevelsQuery);
  const downtimes = useMemo(
    () =>
      [
        ...entryDowntimes,
        ...maintenanceEventsAsDowntimes(
          lineMaintenanceEvents,
          lineMaintenanceStoppages,
          departments,
          downtimeTypes,
        ),
      ].filter(
        // Historical entry_downtimes rows can point at a downtime_reasons
        // row that's since been deactivated in Settings (e.g. a retired
        // "Preventive Maintenance" reason) — it stays in the DB for
        // historical integrity, but shouldn't count in live downtime
        // analysis. Filtering once here keeps every downstream consumer of
        // `downtimes` (Pareto chart, Top Reasons, KPI totals) automatically
        // consistent instead of drifting from each other.
        (d) => d.is_active !== false,
      ),
    [entryDowntimes, lineMaintenanceEvents, lineMaintenanceStoppages, departments, downtimeTypes],
  );

  if (entries.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-12 text-center">
        <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-base font-semibold text-foreground">No entries in this period</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a daily entry to populate the dashboard.
        </p>
      </div>
    );
  }

  // Same formulas as PerformanceSection's monthAdh (making/packing) and
  // DowntimeSection's lossPct — recomputed here from the same entries/
  // downtimes rather than imported, just to drive this compact mobile-only
  // summary row; not a new source of truth, so it can't drift from the full
  // sections below it.
  const monthMakingPlan = entries.reduce((s, e) => s + Number(e.making_plan), 0);
  const monthMakingActual = entries.reduce((s, e) => s + Number(e.making_actual), 0);
  const makingAdh = monthMakingPlan > 0 ? monthMakingActual / monthMakingPlan : 0;
  const monthPackingPlan = entries.reduce((s, e) => s + Number(e.packing_plan), 0);
  const monthPackingActual = entries.reduce((s, e) => s + Number(e.packing_actual), 0);
  const packingAdh = monthPackingPlan > 0 ? monthPackingActual / monthPackingPlan : 0;
  const totalAvail = entries.reduce((s, e) => s + Number(e.available_min), 0);
  const totalDown = downtimes.reduce((s, d) => s + Number(d.minutes), 0);
  const lossPct = totalAvail > 0 ? (totalDown / totalAvail) * 100 : 0;
  const adhColor = (v: number) =>
    v >= 0.9 ? "text-success" : v >= 0.7 ? "text-warning" : "text-destructive";
  const lossColor = lossPct < 10 ? "text-success" : lossPct < 25 ? "text-warning" : "text-destructive";

  return (
    <>
      {/* Mobile-only at-a-glance summary — the full Making/Packing/Downtime
          sections below (in the Suspense boundary) carry the same numbers
          plus charts; this is just a quick compact read before scrolling. */}
      <div className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-card md:hidden">
        <p className="mb-3 text-sm font-semibold">Performance</p>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Making adherence</span>
            <span className={`font-medium ${adhColor(makingAdh)}`}>{pct(makingAdh)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Packing adherence</span>
            <span className={`font-medium ${adhColor(packingAdh)}`}>{pct(packingAdh)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Loss %</span>
            <span className={`font-medium ${lossColor}`}>{lossPct.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      <Suspense fallback={<ChartsSkeleton />}>
      <div className="mt-6 grid grid-cols-1 gap-6">
        <div data-pdf-section="performance-making">
          <PerformanceSection
            title="1. Making / Depositing Performance"
            subtitle="Plan vs Actual — Weight (kg)"
            entries={entries}
            field="making"
            accentColor={color}
          />
        </div>
        <div data-pdf-section="performance-packing">
          <PerformanceSection
            title="2. Packing Performance"
            subtitle="Plan vs Actual — Packed Quantity (kg)"
            entries={entries}
            field="packing"
            accentColor={color}
          />
        </div>
        <div data-pdf-section="quality">
          <TopQualityAreaCard
            productionAreas={productionAreas}
            areaOwners={areaOwners}
            entryAreaOwners={entryAreaOwners}
          />
        </div>
        <div data-pdf-section="downtime">
          <DowntimeSection entries={entries} downtimes={downtimes} />
        </div>
        {can(role, "dashboard.viewMaintenanceCard") && (
          <div data-pdf-section="maintenance">
            <MaintenanceDowntimeCard
              downtimes={downtimes}
              departments={departments}
              departmentCategories={departmentCategories}
              downtimeTypes={downtimeTypes}
              severityLevels={severityLevels}
              entries={entries}
              maintenanceEvents={lineMaintenanceEvents}
            />
          </div>
        )}
        <div data-pdf-section="rework">
          <ReworkSection entries={entries} />
        </div>
      </div>
    </Suspense>
    </>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-16 text-center">
      <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
      <h2 className="mt-3 text-xl font-bold">No production lines yet</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Create your first production line in Settings.
      </p>
      <Button className="mt-6" onClick={onCreate}>
        Open Settings
      </Button>
    </div>
  );
}
