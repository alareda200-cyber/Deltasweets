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
} from "@/lib/queries";
import { monthRange } from "@/lib/date-utils";
import { requireSession } from "@/lib/require-session";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { PlusSquare, FileDown, Loader2 } from "lucide-react";

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

  // Plant-wide open-events count for MaintenanceEventsCard — deliberately not
  // filtered by lineId/from/to (see that component's comment). Visible to
  // every role that can reach the Dashboard at all (RequireAuth below already
  // requires "dashboard.view"), unlike the standalone /maintenance page which
  // stays gated behind "maintenance.view".
  const { data: maintenanceEvents = [] } = useQuery(maintenanceEventsQuery(null, null, null, null, null));

  const activeLine = useMemo(() => lines.find((l) => l.id === lineId) ?? lines[0], [lines, lineId]);

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
          <HeroHeader line={activeLine} from={from} to={to} />

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
              <Button
                size="sm"
                className="w-full md:w-auto"
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
}: {
  line: { name: string; color: string } | undefined;
  from: string;
  to: string;
}) {
  return (
    <div
      data-pdf-section="hero"
      className="overflow-hidden rounded-3xl gradient-hero p-8 text-white shadow-elevated md:p-10"
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
  const { data: entryAreaOwners = [] } = useSuspenseQuery(entryAreaOwnersForEntriesQuery(entryIds));
  const { data: productionAreas } = useSuspenseQuery(productionAreasQuery);
  const { data: areaOwners } = useSuspenseQuery(areaOwnersQuery);
  const { data: departments } = useSuspenseQuery(departmentsQuery);
  const { data: departmentCategories } = useSuspenseQuery(departmentCategoriesQuery);
  const { data: downtimeTypes } = useSuspenseQuery(downtimeTypesQuery);
  const { data: severityLevels } = useSuspenseQuery(severityLevelsQuery);
  const downtimes = useMemo(
    () => [...entryDowntimes, ...maintenanceEventsAsDowntimes(lineMaintenanceEvents, departments, downtimeTypes)],
    [entryDowntimes, lineMaintenanceEvents, departments, downtimeTypes],
  );

  if (entries.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-12 text-center">
        <p className="text-base font-semibold text-foreground">No entries in this period</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a daily entry to populate the dashboard.
        </p>
      </div>
    );
  }

  return (
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
            />
          </div>
        )}
        <div data-pdf-section="rework">
          <ReworkSection entries={entries} />
        </div>
      </div>
    </Suspense>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-16 text-center">
      <h2 className="text-xl font-bold">No production lines yet</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Create your first production line in Settings.
      </p>
      <Button className="mt-6" onClick={onCreate}>
        Open Settings
      </Button>
    </div>
  );
}
