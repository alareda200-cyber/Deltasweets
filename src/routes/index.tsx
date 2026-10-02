import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, FileDown, Inbox, Loader2, Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  areaOwnersQuery,
  downtimeTypesQuery,
  allLinesEntriesQuery,
  entriesQuery,
  entryAreaOwnersForEntriesQuery,
  entryDaysByLineQuery,
  entryDowntimesForEntriesQuery,
  linesQuery,
  openMaintenanceEventsQuery,
  productionAreasQuery,
  severityLevelsQuery,
  maintenanceEventsQuery,
  maintenanceStoppagesQuery,
  nonProductionDaysQuery,
  productionTargetsQuery,
  DEFAULT_TARGETS,
  type ProductionTargets,
  type DailyEntry,
  type EntryDowntime,
  type ProductionLine,
} from "@/lib/queries";
import { iso, monthRange } from "@/lib/date-utils";
import { requireSession } from "@/lib/require-session";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/lib/auth-context";
import { can, type Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { formatSavedAt, shiftLabel } from "@/lib/entry-form";
import { nonProductionDayLookup } from "@/lib/maintenance-format";
import {
  addSplits,
  isFault,
  machineReasonRows,
  machineSplit,
  machineStops,
  mergeReasonRows,
  type MachineStop,
} from "@/lib/machine-downtime";
import {
  addDays,
  adherenceTone,
  areaOwnerScores,
  dailySeries,
  downtimeKindResolver,
  elapsedRange,
  formatDayName,
  formatRange,
  formatRangeShort,
  kg,
  lossTone,
  makingCountView,
  unitTitle,
  reworkTone,
  num,
  packingVariance,
  pct1,
  ratio,
  reasonRows,
  reworkTotal,
  splitDowntime,
  sumEntries,
  summarizeRightNow,
  todayIso,
  type Totals,
  type TimeSplit,
} from "@/lib/dashboard-metrics";
import { RightNowStrip } from "@/components/dashboard/RightNowStrip";
import {
  KpiTile,
  KpiTilesSkeleton,
  toneBar,
  type KpiMemory,
  type KpiTileProps,
} from "@/components/dashboard/KpiTiles";
import {
  AreaScoresCard,
  Card,
  LastDayCard,
  LastDayTimeCard,
  MaintenanceCard,
  MaintenanceLastDayCard,
  SectionHeading,
  ReworkCard,
  TimeLostCard,
  type LastDay,
} from "@/components/dashboard/DashboardCards";
import { CARD, KIND_BAR } from "@/components/dashboard/tone";
import { faultsPerDay } from "@/lib/faults-per-day";
import { reworkPerDay } from "@/lib/rework-per-day";
import { faultTrendWindow } from "@/lib/fault-trend";
import {
  OutputTrendCard,
  ReworkTrendCard,
  StopsTrendCard,
  type TrendData,
} from "@/components/dashboard/TrendCards";

// Recharts is the bulk of the chart's weight; loading it lazily keeps it out of
// the route bundle so the controls, Right now strip and KPI cards paint first.
const DailyOutputChart = lazy(() => import("@/components/dashboard/DailyOutputChart"));
const FaultsPerDayCard = lazy(() => import("@/components/dashboard/FaultsPerDayCard"));
const ReworkPerDayCard = lazy(() => import("@/components/dashboard/ReworkPerDayCard"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Production Scorecard · Dashboard" },
      {
        name: "description",
        content: "Plan against actual, time lost and rework for one production line.",
      },
    ],
  }),
  beforeLoad: requireSession,
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(linesQuery),
      context.queryClient.ensureQueryData(productionAreasQuery),
      context.queryClient.ensureQueryData(areaOwnersQuery),
      context.queryClient.ensureQueryData(downtimeTypesQuery),
      context.queryClient.ensureQueryData(severityLevelsQuery),
    ]),
  component: () => (
    <RequireAuth requirePermission="dashboard.view">
      <Dashboard />
    </RequireAuth>
  ),
});

type Preset = "month" | "7d" | "custom";

const PRESET_LABEL: Record<Preset, string> = {
  month: "This month",
  "7d": "Last 7 days",
  custom: "Custom…",
};

function presetRange(p: Exclude<Preset, "custom">): { from: string; to: string } {
  if (p === "month") return monthRange();
  const today = todayIso();
  return { from: addDays(today, -6), to: today };
}

function Dashboard() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const { data: lines } = useSuspenseQuery(linesQuery);
  const initial = monthRange();
  const [preset, setPreset] = useState<Preset>("month");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const exportRef = useRef<HTMLDivElement>(null);
  // What each KPI tile last showed, so switching line or period rolls the
  // odometers from the old numbers instead of from 0.
  const kpiMemory: KpiMemory = useRef({});

  const activeLine = useMemo(() => lines.find((l) => l.id === lineId) ?? lines[0], [lines, lineId]);
  const rangeValid = !!from && !!to && from <= to;

  // Live, all lines, never filtered — see RightNowStrip.
  const openQ = useQuery(openMaintenanceEventsQuery(null));
  const rightNow = useMemo(() => (openQ.data ? summarizeRightNow(openQ.data) : null), [openQ.data]);

  // Entry count per line for the tabs: one narrow request for every line.
  const countsQ = useQuery({ ...entryDaysByLineQuery(from, to), enabled: rangeValid });
  const counts = useMemo(() => {
    if (!countsQ.data) return null;
    const m = new Map<string, number>();
    for (const r of countsQ.data) m.set(r.line_id, (m.get(r.line_id) ?? 0) + 1);
    return m;
  }, [countsQ.data]);
  const countText = (id: string) => {
    if (!counts) return "";
    const n = counts.get(id) ?? 0;
    return n === 0 ? "no entries" : String(n);
  };

  const canEntry = can(role, "entry.view");
  const canMaintenance = can(role, "maintenance.view");

  function choosePreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") {
      const r = presetRange(p);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  async function handleExportPdf() {
    if (!activeLine || !exportRef.current) return;
    setExporting(true);
    setExportProgress("Preparing PDF…");
    // Freeze every animation at its final state for the capture (styles.css).
    exportRef.current.dataset.pdfCapturing = "true";
    try {
      // Let React add the Packing chart (pdfBothStages) and the charts measure
      // themselves before anything is captured.
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))),
      );
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
      delete exportRef.current?.dataset.pdfCapturing;
      setExporting(false);
      setExportProgress("");
    }
  }

  const exportLabel = exporting ? exportProgress || "Preparing PDF…" : "Export PDF";
  const exportIcon = exporting ? (
    <Loader2 className="h-4 w-4 animate-spin" />
  ) : (
    <FileDown className="h-4 w-4" />
  );

  if (lines.length === 0) {
    return (
      <AppShell>
        <EmptyState onCreate={() => navigate({ to: "/settings" })} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div ref={exportRef} className="flex flex-col gap-3.5 md:gap-5">
        {/* Title + desktop controls */}
        <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between md:gap-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight md:text-[30px]">Production</h1>
            <p className="mt-1.5 hidden text-sm text-muted-foreground md:block">
              Plan against actual, time lost and rework for one line.
            </p>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <div
              role="group"
              aria-label="Period"
              className="flex gap-0.5 rounded-[10px] bg-muted p-[3px]"
            >
              {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={preset === p}
                  onClick={() => choosePreset(p)}
                  className={cn(
                    "h-[38px] rounded-lg px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    preset === p
                      ? "bg-card font-semibold text-foreground shadow-sm"
                      : "text-foreground/80 hover:text-foreground",
                  )}
                >
                  {PRESET_LABEL[p]}
                </button>
              ))}
            </div>
            <Button asChild variant="outline" className="h-11 px-4">
              <Link to="/recap">Month recap</Link>
            </Button>
            <Button
              variant="outline"
              className="h-11 px-4"
              onClick={handleExportPdf}
              disabled={exporting}
            >
              {exportIcon}
              {exportLabel}
            </Button>
            {canEntry && (
              <Button asChild className="h-11 px-[18px] font-semibold">
                <Link to="/entry">
                  <Plus className="h-4 w-4" /> New entry
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Mobile controls: line + period, 48px each */}
        <div className="grid grid-cols-2 gap-2 md:hidden">
          <Select value={activeLine?.id ?? ""} onValueChange={setLineId}>
            <SelectTrigger
              aria-label="Line"
              className="h-12 rounded-xl bg-card text-[15px] font-semibold"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {lines.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                  {counts && (
                    <span className="ml-1 text-xs text-muted-foreground">· {countText(l.id)}</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={preset} onValueChange={(v) => choosePreset(v as Preset)}>
            <SelectTrigger
              aria-label="Period"
              className="h-12 rounded-xl bg-card text-[15px] font-semibold"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">This month</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="custom">Custom range</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {preset === "custom" && (
          <div className="grid grid-cols-2 gap-2 md:flex md:items-end md:justify-end md:gap-3">
            <div>
              <Label htmlFor="dash-from" className="text-xs">
                From
              </Label>
              <Input
                id="dash-from"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="h-11 w-full md:h-10 md:w-[160px]"
              />
            </div>
            <div>
              <Label htmlFor="dash-to" className="text-xs">
                To
              </Label>
              <Input
                id="dash-to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="h-11 w-full md:h-10 md:w-[160px]"
              />
            </div>
            {!rangeValid && (
              <p role="alert" className="col-span-2 text-sm text-destructive-strong md:self-center">
                Pick a From date on or before the To date.
              </p>
            )}
          </div>
        )}

        {/* Desktop line tabs with entry counts */}
        <Tabs value={activeLine?.id ?? ""} onValueChange={setLineId} className="hidden md:block">
          <TabsList
            aria-label="Line"
            className="flex h-auto w-full flex-wrap justify-start gap-1.5 rounded-none border-b border-border bg-transparent p-0"
          >
            {lines.map((l) => (
              <TabsTrigger
                key={l.id}
                value={l.id}
                className="-mb-px h-11 gap-1.5 rounded-none border-b-[3px] border-transparent bg-transparent px-3.5 text-sm font-normal text-foreground/80 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                {l.name}
                {counts && (
                  <span className="rounded-full bg-muted px-[7px] py-px text-xs font-semibold text-muted-foreground">
                    {countText(l.id)}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div data-pdf-section="right-now">
          <RightNowStrip
            summary={rightNow}
            loading={openQ.isPending}
            error={openQ.isError}
            canOpenMaintenance={canMaintenance}
          />
        </div>

        {activeLine &&
          (rangeValid ? (
            <PeriodBody
              key={`${activeLine.id}|${from}|${to}`}
              line={activeLine}
              from={from}
              to={to}
              role={role}
              kpiMemory={kpiMemory}
              pdfBothStages={exporting}
            />
          ) : (
            <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
              Choose a valid period to see this line's numbers.
            </p>
          ))}

        {/* Mobile: export + new entry at the end of the page */}
        <div data-pdf-exclude="true" className="grid grid-cols-2 gap-2 md:hidden">
          <Button
            variant="outline"
            className={cn("h-12 rounded-xl text-[15px]", !canEntry && "col-span-2")}
            onClick={handleExportPdf}
            disabled={exporting}
          >
            {exportIcon}
            <span className="truncate">{exportLabel}</span>
          </Button>
          {canEntry && (
            <Button asChild className="h-12 rounded-xl text-[15px] font-semibold">
              <Link to="/entry">
                <Plus className="h-4 w-4" /> New entry
              </Link>
            </Button>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function PeriodBody({
  line,
  from,
  to,
  role,
  kpiMemory,
  pdfBothStages = false,
}: {
  line: ProductionLine;
  from: string;
  to: string;
  role: Role | null;
  kpiMemory: KpiMemory;
  /**
   * PDF export in progress: the report always carries both daily charts —
   * Making in the usual place and Packing in its own row below — whichever
   * stage is picked on screen.
   */
  pdfBothStages?: boolean;
}) {
  const [pickedStage, setStage] = useState<"making" | "packing" | "count">("making");
  // The unit this line also counts making in (Settings › Production lines).
  const countUnit = line.making_count_unit?.trim() || null;
  const stage = pdfBothStages || (pickedStage === "count" && !countUnit) ? "making" : pickedStage;
  const entriesQ = useQuery(entriesQuery(line.id, from, to));
  const entries = entriesQ.data;
  const entryIds = useMemo(() => (entries ?? []).map((e) => e.id), [entries]);
  const downtimesQ = useQuery(entryDowntimesForEntriesQuery(entryIds));
  const ownersQ = useQuery(entryAreaOwnersForEntriesQuery(entryIds));
  // Faults and preventive work from the Maintenance page, same line and
  // period. They are downtime too: they go into time lost and "Where the time
  // went" next to the daily entries' reasons, and feed the Maintenance card.
  const mEventsQ = useQuery(maintenanceEventsQuery(line.id, null, null, from, to));
  const stoppagesQ = useQuery(maintenanceStoppagesQuery(line.id));
  const { data: nonProductionDays = [] } = useQuery(nonProductionDaysQuery());
  // Settings › Targets. Falls back to the old fixed values while loading or
  // if the row can't be read, so cards never flash red on a slow network.
  const { data: targets = DEFAULT_TARGETS } = useQuery(productionTargetsQuery());
  const { data: downtimeTypes } = useSuspenseQuery(downtimeTypesQuery);
  const { data: severityLevels } = useSuspenseQuery(severityLevelsQuery);
  const { data: productionAreas } = useSuspenseQuery(productionAreasQuery);
  const { data: areaOwners } = useSuspenseQuery(areaOwnersQuery);
  const { data: allLines } = useSuspenseQuery(linesQuery);

  // "vs usual" cards: every line, last 7 full days vs the 28 before, on their
  // own window — the period picked above does not change them.
  const today = iso(new Date());
  const trendWindow = useMemo(() => faultTrendWindow(today), [today]);
  const trendEntriesQ = useQuery(allLinesEntriesQuery(trendWindow.from, trendWindow.to));
  const trendIds = useMemo(() => (trendEntriesQ.data ?? []).map((e) => e.id), [trendEntriesQ.data]);
  const trendDowntimesQ = useQuery(entryDowntimesForEntriesQuery(trendIds));
  const trend: TrendData = {
    entries: trendEntriesQ.data,
    downtimes: trendEntriesQ.data && trendIds.length === 0 ? [] : trendDowntimesQ.data,
    loading: trendEntriesQ.isPending,
    error: trendEntriesQ.isError || trendDowntimesQ.isError,
    window: trendWindow,
    lines: allLines,
    viewingLineId: line.id,
  };

  const canEntry = can(role, "entry.view");
  const canMaintenance = can(role, "maintenance.view");

  const hasIds = entryIds.length > 0;
  const loading =
    entriesQ.isPending ||
    (hasIds && downtimesQ.isPending) ||
    mEventsQ.isPending ||
    stoppagesQ.isPending;
  // A maintenance read failure doesn't blank the dashboard: the cards say
  // those minutes are missing instead.
  const machineError = mEventsQ.isError || stoppagesQ.isError;
  // Numbers already on screen while newer ones load in the background.
  const refreshing = !loading && (entriesQ.isFetching || downtimesQ.isFetching);
  const failed = entriesQ.isError || (hasIds && downtimesQ.isError);

  // A retired downtime reason stays on old rows for history but does not count
  // in live analysis — same rule the old downtime sections applied.
  const downtimes = useMemo(
    () => (downtimesQ.data ?? []).filter((d) => d.is_active !== false),
    [downtimesQ.data],
  );
  const kindOf = useMemo(() => downtimeKindResolver(downtimeTypes), [downtimeTypes]);
  const stops = useMemo(
    () =>
      machineError
        ? []
        : machineStops(
            mEventsQ.data ?? [],
            stoppagesQ.data ?? [],
            nonProductionDayLookup(nonProductionDays),
          ),
    [machineError, mEventsQ.data, stoppagesQ.data, nonProductionDays],
  );

  // The period as far as it has happened, stretched to the last entry if one
  // was saved for a later day.
  const lastDate = entries && entries.length > 0 ? entries[entries.length - 1].entry_date : null;
  const elapsed = elapsedRange(from, to);
  const shownTo = lastDate && lastDate > elapsed.to ? lastDate : elapsed.to;
  const rangeText = formatRange(from, shownTo);
  const rangeShort = formatRangeShort(from, shownTo);

  if (loading) {
    return (
      <div className="flex flex-col gap-3.5 md:gap-5" aria-busy="true">
        <span className="sr-only">Loading {line.name} numbers…</span>
        <div className="ds-shimmer h-5 w-72 max-w-full rounded-full md:h-7" />
        <KpiTilesSkeleton />
        <div className="grid gap-3.5 md:grid-cols-3 md:gap-4">
          <div className={cn(CARD, "ds-shimmer h-[328px] md:col-span-2 md:h-[388px]")} />
          <div className={cn(CARD, "ds-shimmer h-[288px] md:h-[388px]")} />
        </div>
      </div>
    );
  }

  if (failed) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-8 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-destructive-strong" aria-hidden="true" />
        <p className="text-sm font-semibold text-destructive-strong">
          Couldn't load {line.name}'s numbers for {rangeText}.
        </p>
        <Button
          variant="outline"
          className="h-11 md:h-9"
          onClick={() => {
            void entriesQ.refetch();
            if (hasIds) void downtimesQ.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  const list = entries ?? [];
  const emptyBox = (
    <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center md:p-12">
      <Inbox className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 text-base font-semibold">
        No entries for {line.name}, {rangeText}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Plan, actual, time lost and rework appear here once a daily entry is saved for this line.
      </p>
      {canEntry && (
        <Button asChild className="mt-5 h-11 md:h-9">
          <Link to="/entry">
            <Plus className="h-4 w-4" /> New entry
          </Link>
        </Button>
      )}
    </div>
  );
  if (list.length === 0) {
    return (
      <>
        {emptyBox}
        <OutputTrendCard data={trend} targets={targets} />
        <StopsTrendCard data={trend} />
        <ReworkTrendCard data={trend} limitPct={targets.reworkPct ?? null} />
      </>
    );
  }

  const totals = sumEntries(list);
  const days = new Set(list.map((e) => e.entry_date)).size;
  // Machine stops count toward time lost only on days that have a daily
  // entry: available minutes come from the entries, so a fault on a day with
  // no entry has nothing to be a share of. The Maintenance card still shows
  // every fault in the period.
  const entryDays = new Set(list.map((e) => e.entry_date));
  const dayStops = stops.filter((st) => entryDays.has(st.day));
  const entrySplit = splitDowntime(downtimes, kindOf);
  const mSplit = machineSplit(dayStops);
  const split = addSplits(entrySplit, mSplit);
  const reasons = mergeReasonRows(
    reasonRows(downtimes, kindOf, severityLevels, productionAreas),
    machineReasonRows(dayStops),
  );
  const lastDay = buildLastDay(list, downtimes, kindOf, line.id, dayStops);
  const lastDayTime = lastDay
    ? {
        dayName: lastDay.dayName,
        split: lastDay.time,
        reasons: mergeReasonRows(
          reasonRows(
            downtimes.filter((d) => lastDay.entryIds.has(d.entry_id)),
            kindOf,
            severityLevels,
            productionAreas,
          ),
          machineReasonRows(dayStops.filter((st) => st.day === lastDate)),
        ),
      }
    : null;
  const rawFaults = (mEventsQ.data ?? []).filter((e) => isFault(e.type));
  const lastDayFaultCount = rawFaults.filter(
    (e) => lastDate != null && iso(new Date(e.started_at)) === lastDate,
  ).length;
  const faultDays = faultsPerDay({
    lineId: line.id,
    from,
    to: shownTo,
    events: mEventsQ.data ?? [],
    stops,
    entryDays,
    closed: nonProductionDayLookup(nonProductionDays),
  });
  const reworkDays = reworkPerDay({
    entries: list,
    from,
    to: shownTo,
    limitPct: targets.reworkPct,
  });
  const scores = areaOwnerScores(ownersQ.data ?? [], productionAreas, areaOwners);
  const points = dailySeries(list, from, shownTo, stage);
  const stageName = stage === "packing" ? "Packing" : "Making";
  const chartUnit = stage === "count" && countUnit ? countUnit : "kg";
  const stageOptions: { key: "making" | "packing" | "count"; label: string }[] = [
    { key: "making", label: "Making" },
    ...(countUnit ? [{ key: "count" as const, label: unitTitle(countUnit) }] : []),
    { key: "packing", label: "Packing" },
  ];
  const countView = countUnit
    ? makingCountView(totals, countUnit, targets.makingCountPct, days)
    : undefined;
  const packingPoints = pdfBothStages ? dailySeries(list, from, shownTo, "packing") : null;

  return (
    <>
      <div data-pdf-section="kpis" className="flex flex-col gap-3.5 md:gap-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="hidden text-lg font-semibold md:block">This period</h2>
          <span className="text-[13px] font-semibold text-primary md:rounded-full md:bg-primary/10 md:px-2 md:py-0.5 md:text-xs">
            <span className="md:hidden">{rangeShort}</span>
            <span className="hidden md:inline">{rangeText}</span> · {line.name} · {days} production{" "}
            {days === 1 ? "day" : "days"}
          </span>
          {refreshing && <JellyDots />}
        </div>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-4">
          {kpiTiles(totals, split, targets, countView).map((k, i) => (
            <KpiTile key={k.title} {...k} index={i} memory={kpiMemory} />
          ))}
        </div>
      </div>

      {/* Each row is one PDF section so the export keeps the side-by-side
          layout instead of blowing a one-third-width card up to a full page. */}
      <div data-pdf-section="chart-and-last-day" className="grid gap-3.5 md:grid-cols-3 md:gap-4">
        <div className="flex min-w-0 md:col-span-2">
          <Card labelledBy="dash-chart" className="flex-1">
            <div className="flex items-center justify-between gap-3">
              <h3 id="dash-chart" className="text-[15px] font-semibold md:text-base">
                <span className="md:hidden">
                  {chartUnit !== "kg" ? unitTitle(chartUnit) : stageName} per day
                </span>
                <span className="hidden md:inline">
                  {stageName} — actual per day against plan ({chartUnit})
                </span>
              </h3>
              <div
                role="group"
                aria-label="Stage"
                data-pdf-exclude="true"
                className="flex shrink-0 gap-0.5 rounded-[10px] bg-muted p-[3px]"
              >
                {stageOptions.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    aria-pressed={stage === o.key}
                    onClick={() => setStage(o.key)}
                    className={cn(
                      "h-11 rounded-lg px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-[34px]",
                      stage === o.key
                        ? "bg-card font-semibold text-foreground shadow-sm"
                        : "text-foreground/80 hover:text-foreground",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <Suspense fallback={<div className="ds-shimmer h-[236px] rounded-lg md:h-[280px]" />}>
              {/* Keyed by stage: switching Making/Packing is new data, so the
                  bars pop again. */}
              <DailyOutputChart
                key={stage}
                points={points}
                stageLabel={stageName}
                unit={chartUnit}
                targetPct={
                  stage === "count"
                    ? targets.makingCountPct
                    : stage === "making"
                      ? targets.makingPct
                      : targets.packingPct
                }
              />
            </Suspense>
          </Card>
        </div>
        {lastDay && (
          <div className="flex min-w-0 [&>section]:flex-1">
            <LastDayCard
              day={lastDay}
              canOpenEntry={canEntry}
              targets={targets}
              countUnit={countUnit}
            />
          </div>
        )}
      </div>

      {packingPoints && (
        <div data-pdf-section="packing-chart">
          <Card labelledBy="dash-chart-packing">
            <h3 id="dash-chart-packing" className="text-[15px] font-semibold md:text-base">
              Packing — actual per day against plan (kg)
            </h3>
            <Suspense fallback={<div className="h-[236px] rounded-lg md:h-[280px]" />}>
              <DailyOutputChart
                key="pdf-packing"
                points={packingPoints}
                stageLabel="Packing"
                targetPct={targets.packingPct}
              />
            </Suspense>
          </Card>
        </div>
      )}

      <OutputTrendCard data={trend} targets={targets} />

      <div
        data-pdf-section="time"
        className="grid gap-3.5 md:grid-cols-2 md:items-stretch md:gap-4"
      >
        <SectionHeading>Time lost</SectionHeading>
        <div className="flex min-w-0 [&>section]:flex-1">
          <TimeLostCard
            split={split}
            reasons={reasons}
            sources={{ entryMin: entrySplit.total, machineMin: mSplit.total, machineError }}
          />
        </div>
        {lastDayTime && (
          <div className="flex min-w-0 [&>section]:flex-1">
            <LastDayTimeCard lastDay={lastDayTime} />
          </div>
        )}
      </div>

      <StopsTrendCard data={trend} />

      {can(role, "dashboard.viewMaintenanceCard") && (
        <div
          data-pdf-section="maintenance"
          className="grid gap-3.5 md:grid-cols-2 md:items-stretch md:gap-4"
        >
          <SectionHeading>Maintenance</SectionHeading>
          <div className="flex min-w-0 [&>section]:flex-1">
            <MaintenanceCard
              lineName={line.name}
              rangeText={rangeShort}
              stops={stops}
              faultCount={rawFaults.length}
              loading={false}
              error={machineError}
              canOpenMaintenance={canMaintenance}
            />
          </div>
          {lastDay && lastDate && (
            <div className="flex min-w-0 [&>section]:flex-1">
              <MaintenanceLastDayCard
                lineName={line.name}
                error={machineError}
                day={{
                  dayName: lastDay.dayName,
                  date: lastDate,
                  stops: stops.filter((st) => st.day === lastDate),
                  faultCount: lastDayFaultCount,
                }}
              />
            </div>
          )}
          <div className="flex min-w-0 md:col-span-2 [&>section]:flex-1">
            <Suspense
              fallback={<div className={cn(CARD, "ds-shimmer h-[360px] flex-1 md:h-[380px]")} />}
            >
              <FaultsPerDayCard
                lineName={line.name}
                rangeText={rangeShort}
                summary={faultDays}
                error={machineError}
              />
            </Suspense>
          </div>
        </div>
      )}

      <div
        data-pdf-section="rework-scores"
        className="grid gap-3.5 md:grid-cols-2 md:items-stretch md:gap-4"
      >
        <SectionHeading>Rework and area owners</SectionHeading>
        <div className="flex min-w-0 [&>section]:flex-1">
          <ReworkCard totals={totals} />
        </div>
        <div className="flex min-w-0 [&>section]:flex-1">
          <AreaScoresCard rows={scores} loading={ownersQ.isPending} lineName={line.name} />
        </div>
        <div className="flex min-w-0 md:col-span-2 [&>section]:flex-1">
          <Suspense
            fallback={<div className={cn(CARD, "ds-shimmer h-[380px] flex-1 md:h-[400px]")} />}
          >
            <ReworkPerDayCard lineName={line.name} rangeText={rangeShort} summary={reworkDays} />
          </Suspense>
        </div>
      </div>

      <ReworkTrendCard data={trend} limitPct={targets.reworkPct ?? null} />

      <p data-pdf-section="definitions" className="text-xs text-muted-foreground">
        Adherence = actual ÷ plan. Time lost = downtime minutes ÷ available minutes: the daily
        entries' downtime plus faults and preventive work from the Maintenance page on days that
        have an entry (a stoppage counts its window once; faults still open, or where the line kept
        running, add nothing). Rework % = rework kg ÷ making actual kg. Targets come from Settings ›
        Targets: making {targets.makingPct}%, packing {targets.packingPct}%, time lost alert above{" "}
        {targets.lossPct}%
        {targets.reworkPct != null ? `, rework at most ${targets.reworkPct}%` : ""}.
      </p>
    </>
  );
}

// A ratio as the percent the tile shows, rounded exactly as pct1 rounds it.
const pctNum = (r: number) => Number((r * 100).toFixed(1));

// Three jelly dots beside the period line while numbers already on screen are
// being refreshed. Phone only; the live region says it once.
function JellyDots() {
  return (
    <span role="status" className="flex items-center gap-[5px] md:hidden">
      <span className="sr-only">Refreshing</span>
      {[
        ["var(--candy-1)", 0],
        ["var(--candy-2)", 120],
        ["var(--candy-3)", 240],
      ].map(([bg, d]) => (
        <span
          key={d}
          aria-hidden="true"
          data-jelly-dot=""
          className="ds-jelly-dot h-[9px] w-[9px] rounded-[4px]"
          style={{ background: bg as string, animationDelay: `${d}ms` }}
        />
      ))}
    </span>
  );
}

function kpiTiles(
  t: Totals,
  split: TimeSplit,
  targets: ProductionTargets,
  count?: KpiTileProps["count"],
): KpiTileProps[] {
  const lossAlert = targets.lossPct;
  const adhTile = (title: string, actual: number, plan: number, target: number): KpiTileProps => {
    if (plan <= 0) {
      return {
        title,
        target: `target ${target}%`,
        value: null,
        detail: `${kg(actual)} kg, no plan entered`,
        segments: [],
        barLabel: "No plan entered",
        status: "No plan entered",
        tone: "neutral",
      };
    }
    const adh = actual / plan;
    const tone = adherenceTone(adh, target);
    const gap = Math.abs(adh * 100 - target);
    const below = adh * 100 < target;
    return {
      title,
      target: `target ${target}%`,
      targetPct: target,
      value: pctNum(adh),
      unit: "of plan",
      detail: `${kg(actual)} of ${kg(plan)} kg`,
      mobileDetail: `${kg(actual)} / ${kg(plan)} kg`,
      segments: [{ pct: adh * 100, className: toneBar(tone) }],
      barLabel: `${(adh * 100).toFixed(1)} percent of plan, target ${target}`,
      status: below
        ? `${gap.toFixed(1)} points below target`
        : gap < 0.05
          ? "On target"
          : `${gap.toFixed(1)} points above target`,
      mobileStatus: below ? `${gap.toFixed(1)} pts under ${target}%` : `At or above ${target}%`,
      tone,
    };
  };

  const avail = t.availableMin;
  const lost = ratio(split.total, avail);
  const share = (m: number) => ratio(m, avail);
  const kinds = [
    ["planned", split.planned],
    ["unplanned", split.unplanned],
    ["unclassified", split.unclassified],
  ] as const;
  const biggest = [...kinds].sort((a, b) => b[1] - a[1])[0];
  const timeStatus =
    split.total === 0
      ? "No downtime recorded"
      : biggest[0] === "planned"
        ? "Mostly planned stops"
        : biggest[0] === "unplanned"
          ? "Mostly unplanned stops"
          : "Mostly unclassified stops";
  const timeTile: KpiTileProps =
    avail <= 0
      ? {
          title: "Time lost",
          target: `alert above ${lossAlert}%`,
          value: null,
          detail: `${num(split.total)} min, no available minutes entered`,
          segments: [],
          barLabel: "No available minutes entered",
          status: "No available minutes entered",
          tone: "neutral",
        }
      : {
          title: "Time lost",
          target: `alert above ${lossAlert}%`,
          targetPct: lossAlert,
          value: pctNum(lost),
          unit: "of available",
          detail:
            `${num(split.total)} of ${num(avail)} min · planned ${pct1(share(split.planned))} · unplanned ${pct1(share(split.unplanned))}` +
            (split.unclassified > 0 ? ` · unclassified ${pct1(share(split.unclassified))}` : ""),
          mobileDetail: `${num(split.total)} min · ${pct1(share(split.unplanned))} unplanned`,
          segments: kinds.map(([k, m]) => ({ pct: share(m) * 100, className: KIND_BAR[k] })),
          barLabel: `Planned ${(share(split.planned) * 100).toFixed(1)} percent, unplanned ${(share(split.unplanned) * 100).toFixed(1)} percent, unclassified ${(share(split.unclassified) * 100).toFixed(1)} percent of available time`,
          status: timeStatus,
          mobileStatus: timeStatus.replace(" stops", ""),
          tone: lossTone(lost * 100, lossAlert),
        };

  const rw = reworkTotal(t);
  const rwParts = [
    t.reworkCooking > 0 ? `cooking ${kg(t.reworkCooking)}` : null,
    `making ${kg(t.reworkMaking)}`,
    `packing ${kg(t.reworkPacking)}`,
  ].filter(Boolean);
  const rwPct = t.makingActual > 0 ? (rw / t.makingActual) * 100 : null;
  const rwTarget = targets.reworkPct;
  const rwTone = rwPct != null ? reworkTone(rwPct, rwTarget) : "neutral";
  const reworkTile: KpiTileProps = {
    title: "Rework",
    target: rwTarget != null ? `at most ${rwTarget}%` : "no target set",
    targetPct: rwTarget,
    value: t.makingActual > 0 ? pctNum(rw / t.makingActual) : null,
    unit: "of making",
    detail: `${kg(rw)} kg · ${rwParts.join(" · ")}`,
    mobileDetail: `${kg(rw)} kg of making`,
    segments: [
      {
        pct: t.makingActual > 0 ? (rw / t.makingActual) * 100 : 0,
        className: rwTone === "neutral" ? "bg-muted-foreground" : toneBar(rwTone),
      },
    ],
    barLabel: `Rework ${t.makingActual > 0 ? ((rw / t.makingActual) * 100).toFixed(1) : 0} percent of making output`,
    status:
      rwTarget == null || rwPct == null
        ? "Share of making output"
        : rwPct <= rwTarget
          ? `Within the ${rwTarget}% limit`
          : `${(rwPct - rwTarget).toFixed(1)} points over the ${rwTarget}% limit`,
    mobileStatus:
      rwTarget == null
        ? "No target set"
        : rwPct != null && rwPct > rwTarget
          ? `Over ${rwTarget}%`
          : `Within ${rwTarget}%`,
    tone: rwTone,
  };

  return [
    { ...adhTile("Making", t.makingActual, t.makingPlan, targets.makingPct), count },
    {
      ...adhTile("Packing", t.packingActual, t.packingPlan, targets.packingPct),
      variance: t.packingPlan > 0 ? varianceStrip(t) : undefined,
    },
    timeTile,
    reworkTile,
  ];
}

// Packing tile: the shortfall against plan less the entries' rework — the
// part the rework doesn't explain. Only drawn when there is a packing plan.
function varianceStrip(t: Totals): NonNullable<KpiTileProps["variance"]> {
  const v = packingVariance(t);
  const label = "Net variance";
  if (v.state === "none") {
    return {
      label,
      valueText: "0 kg",
      quiet: true,
      detail: "Packed at or above plan — nothing short",
      mobileDetail: "At or above plan",
      segments: [],
      barLabel: "Packed at or above plan",
    };
  }
  const netShare = (v.net / v.short) * 100;
  const segments = [
    { pct: netShare, className: "bg-destructive" },
    { pct: 100 - netShare, className: "bg-warning" },
  ];
  const math = `${kg(v.short)} short of plan − ${kg(v.rework)} rework`;
  if (v.state === "covered") {
    return {
      label,
      valueText: "0 kg",
      quiet: false,
      detail: `${math} · rework covers it`,
      mobileDetail: `${kg(v.short)} − ${kg(v.rework)} rework`,
      segments,
      barLabel: `Short of plan ${kg(v.short)} kilograms, all covered by ${kg(v.rework)} kilograms of rework`,
    };
  }
  return {
    label,
    valueText: `${kg(v.net)} kg`,
    quiet: false,
    detail: `${math} · ${pct1(v.netOfPlan ?? 0)} of plan`,
    mobileDetail: `${kg(v.short)} − ${kg(v.rework)} rework`,
    segments,
    barLabel: `Short of plan ${kg(v.short)} kilograms: rework ${kg(v.rework)}, not explained ${kg(v.net)}`,
  };
}

function buildLastDay(
  entries: DailyEntry[],
  downtimes: EntryDowntime[],
  kindOf: ReturnType<typeof downtimeKindResolver>,
  lineId: string,
  stops: MachineStop[],
): (LastDay & { entryIds: Set<string> }) | null {
  const last = entries[entries.length - 1];
  if (!last) return null;
  const rows = entries.filter((e) => e.entry_date === last.entry_date);
  const ids = new Set(rows.map((e) => e.id));
  const shifts = Array.from(new Set(rows.map((e) => e.shift))).sort((a, b) =>
    a === "DAY" ? -1 : b === "DAY" ? 1 : a.localeCompare(b),
  );
  const saved = rows
    .map((e) => e.updated_at || e.created_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  return {
    dayName: formatDayName(last.entry_date),
    shiftText: shifts.map(shiftLabel).join(" + "),
    savedText: saved ? `saved ${formatSavedAt(saved)}` : null,
    totals: sumEntries(rows),
    time: addSplits(
      splitDowntime(
        downtimes.filter((d) => ids.has(d.entry_id)),
        kindOf,
      ),
      machineSplit(stops.filter((st) => st.day === last.entry_date)),
    ),
    link: { line: lineId, date: last.entry_date, shift: shifts[0] },
    entryIds: ids,
  };
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
