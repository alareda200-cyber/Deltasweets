import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { PerformanceSection } from "@/components/PerformanceSection";
import { DowntimeSection } from "@/components/DowntimeSection";
import { ReworkSection } from "@/components/ReworkSection";
import { TopQualityAreaCard } from "@/components/TopQualityAreaCard";
import { MaintenanceDowntimeCard } from "@/components/MaintenanceDowntimeCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  linesQuery,
  entriesQuery,
  entryDowntimesQuery,
  productionAreasQuery,
  areaOwnersQuery,
  entryAreaOwnersQuery,
  departmentsQuery,
  departmentCategoriesQuery,
  downtimeTypesQuery,
  severityLevelsQuery,
} from "@/lib/queries";
import { monthRange } from "@/lib/date-utils";
import { exportDashboardToPdf } from "@/lib/pdf-export";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { PlusSquare, FileDown, Loader2 } from "lucide-react";

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
  const queryClient = useQueryClient();
  const { data: lines } = useSuspenseQuery(linesQuery);
  const initial = monthRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");

  const activeLine = useMemo(() => lines.find((l) => l.id === lineId) ?? lines[0], [lines, lineId]);

  async function handleExportPdf() {
    if (!activeLine) return;
    setExporting(true);
    setExportProgress("Preparing PDF…");
    try {
      // Reuses whatever DashboardBody already loaded for this line/period via
      // react-query's cache — no extra network round trip in the common case.
      const [entries, downtimes] = await Promise.all([
        queryClient.ensureQueryData(entriesQuery(activeLine.id, from, to)),
        queryClient.ensureQueryData(entryDowntimesQuery(activeLine.id, from, to)),
      ]);
      await exportDashboardToPdf({
        dashboardName: "Production Scorecard Dashboard",
        lineName: activeLine.name,
        from,
        to,
        entries,
        downtimes,
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
        <>
          <HeroHeader line={activeLine} from={from} to={to} />

          <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-card md:flex-row md:items-end md:justify-between">
            <Tabs value={lineId} onValueChange={setLineId} className="flex-1">
              <TabsList className="flex w-full flex-wrap justify-start gap-1 bg-muted/50 p-1">
                {lines.map((l) => (
                  <TabsTrigger
                    key={l.id}
                    value={l.id}
                    className="data-[state=active]:bg-card data-[state=active]:shadow-sm"
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
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-xs">From</Label>
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-9 w-[150px]"
                />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-9 w-[150px]"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const m = monthRange();
                  setFrom(m.from);
                  setTo(m.to);
                }}
              >
                This Month
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={exporting}>
                {exporting ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="mr-1.5 h-4 w-4" />
                )}
                {exporting ? exportProgress || "Preparing PDF…" : "Export PDF"}
              </Button>
              <Button size="sm" onClick={() => navigate({ to: "/entry" })}>
                <PlusSquare className="mr-1.5 h-4 w-4" /> New Entry
              </Button>
            </div>
          </div>

          {activeLine && (
            <DashboardBody lineId={activeLine.id} color={activeLine.color} from={from} to={to} />
          )}
        </>
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
    <div className="overflow-hidden rounded-3xl gradient-hero p-8 text-white shadow-elevated md:p-10">
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
  const { data: downtimes = [] } = useSuspenseQuery(entryDowntimesQuery(lineId, from, to));
  const { data: entryAreaOwners = [] } = useSuspenseQuery(entryAreaOwnersQuery(lineId, from, to));
  const { data: productionAreas } = useSuspenseQuery(productionAreasQuery);
  const { data: areaOwners } = useSuspenseQuery(areaOwnersQuery);
  const { data: departments } = useSuspenseQuery(departmentsQuery);
  const { data: departmentCategories } = useSuspenseQuery(departmentCategoriesQuery);
  const { data: downtimeTypes } = useSuspenseQuery(downtimeTypesQuery);
  const { data: severityLevels } = useSuspenseQuery(severityLevelsQuery);

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
    <div className="mt-6 grid grid-cols-1 gap-6">
      <PerformanceSection
        title="1. Making / Depositing Performance"
        subtitle="Plan vs Actual — Weight (kg)"
        entries={entries}
        field="making"
        accentColor={color}
      />
      <PerformanceSection
        title="2. Packing Performance"
        subtitle="Plan vs Actual — Packed Quantity (kg)"
        entries={entries}
        field="packing"
        accentColor={color}
      />
      <TopQualityAreaCard
        productionAreas={productionAreas}
        areaOwners={areaOwners}
        entryAreaOwners={entryAreaOwners}
      />
      <DowntimeSection entries={entries} downtimes={downtimes} />
      {can(role, "dashboard.viewMaintenanceCard") && (
        <MaintenanceDowntimeCard
          downtimes={downtimes}
          departments={departments}
          departmentCategories={departmentCategories}
          downtimeTypes={downtimeTypes}
          severityLevels={severityLevels}
        />
      )}
      <ReworkSection entries={entries} />
    </div>
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
