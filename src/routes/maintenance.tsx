import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { KpiCard } from "@/components/KpiCard";
import { EventDetailDialog } from "@/components/EventDetailDialog";
import {
  Wrench,
  Zap,
  Activity,
  Timer,
  Plus,
  Loader2,
  FileDown,
  Repeat,
  Gauge,
  CalendarCheck,
  Layers,
  AlertTriangle,
  Trash2,
  Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { requireSession } from "@/lib/require-session";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  TYPE_LABELS,
  STATUS_LABELS,
  SEVERITY_LABEL_OPTIONS,
  typeBadgeVariant,
  statusBadgeVariant,
  severityBadgeVariant,
  formatDuration,
  formatHours,
  sortByWorstMtbf,
  toDatetimeLocalValue,
} from "@/lib/maintenance-format";
import { TechnicianMultiSelect } from "@/components/TechnicianMultiSelect";
import {
  linesQuery,
  maintenanceEventsQuery,
  maintenanceMetricsQuery,
  maintenanceStoppagesQuery,
  maintenanceStoppageQuery,
  stoppageEventsQuery,
  syncStoppageAggregate,
  majorityMaintenanceType,
  stoppageDurationMinutes,
  techniciansQuery,
  type MaintenanceEvent,
  type MaintenanceType,
  type MaintenanceStatus,
  type MaintenanceMetric,
  type MaintenanceStoppage,
  type StoppageMemberEvent,
} from "@/lib/queries";

export const Route = createFileRoute("/maintenance")({
  head: () => ({ meta: [{ title: "Maintenance · Production Scorecard" }] }),
  beforeLoad: requireSession,
  loader: ({ context }) => context.queryClient.ensureQueryData(linesQuery),
  component: () => (
    <RequireAuth requirePermission="maintenance.view">
      <MaintenancePage />
    </RequireAuth>
  ),
});

function truncateNote(text: string, max = 50): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function MaintenancePage() {
  const { data: lines } = useSuspenseQuery(linesQuery);
  const { role, user, profile } = useAuth();
  const canEdit = can(role, "maintenance.edit");
  const canDelete = can(role, "maintenance.delete");
  const qc = useQueryClient();

  const [lineId, setLineId] = useState("");
  const [type, setType] = useState<MaintenanceType | "">("");
  const [status, setStatus] = useState<MaintenanceStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [stoppageDialogOpen, setStoppageDialogOpen] = useState(false);
  // Set when a row in the Stoppages tab is clicked (view an existing
  // stoppage) — distinct from stoppageDialogOpen (the "New Stoppage" button,
  // which starts the create flow). Both drive the same StoppageDialog
  // instance below; see closeStoppageDialog.
  const [viewStoppageId, setViewStoppageId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<MaintenanceEvent | null>(null);
  const [exportingReport, setExportingReport] = useState(false);
  const [reportProgress, setReportProgress] = useState("");

  // Summary cards reflect plant-wide current state, independent of the table
  // filters below (same reasoning as the Dashboard's global KPI cards) — an
  // analyst filtering the table down to one line shouldn't see the open-count
  // cards silently change to match.
  const { data: allEvents = [] } = useQuery(maintenanceEventsQuery(null, null, null, null, null));
  const { data: metrics = [] } = useQuery(maintenanceMetricsQuery());
  // Global (unfiltered) stoppage list — used to look up each stoppage
  // referenced by `events`/`allEvents` for the "Part of Stoppage" badge and
  // the PDF report's Stoppages summary; StoppageDialog fetches its own
  // single-stoppage/member-event queries instead of reading from this list.
  const { data: stoppages = [] } = useQuery(maintenanceStoppagesQuery());

  const { data: events = [], isLoading } = useQuery(
    maintenanceEventsQuery(lineId || null, type || null, status || null, from || null, to || null),
  );

  // Covers every query-key prefix a stoppage can be cached under (list,
  // single-row detail, member-event list) — see maintenanceStoppagesQuery /
  // maintenanceStoppageQuery / stoppageEventsQuery in src/lib/queries.ts.
  // Called after any event mutation, not just stoppage-specific ones,
  // because EventDetailDialog/insertEvent already resync the affected
  // stoppage row in the DB — this just makes sure the cache catches up.
  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["maintenance-events"] });
    qc.invalidateQueries({ queryKey: ["maintenance-metrics"] });
    qc.invalidateQueries({ queryKey: ["maintenance-stoppages"] });
    qc.invalidateQueries({ queryKey: ["maintenance-stoppage"] });
    qc.invalidateQueries({ queryKey: ["maintenance-stoppage-events"] });
  }

  const openMechanical = allEvents.filter(
    (e) => e.type === "mechanical" && e.status !== "resolved",
  ).length;
  const openElectrical = allEvents.filter(
    (e) => e.type === "electrical" && e.status !== "resolved",
  ).length;
  const openPreventive = allEvents.filter(
    (e) => e.type === "preventive" && e.status !== "resolved",
  ).length;

  const mtbfMechanicalHours = useMemo(
    () => weightedAverage(metrics, "mechanical", "mtbf_hours", "mtbf_gap_count"),
    [metrics],
  );
  const mttrMechanicalHours = useMemo(
    () => weightedAverage(metrics, "mechanical", "mttr_hours", "mttr_sample_count"),
    [metrics],
  );
  const mtbfElectricalHours = useMemo(
    () => weightedAverage(metrics, "electrical", "mtbf_hours", "mtbf_gap_count"),
    [metrics],
  );
  const mttrElectricalHours = useMemo(
    () => weightedAverage(metrics, "electrical", "mttr_hours", "mttr_sample_count"),
    [metrics],
  );
  // Mechanical + electrical pooled — same weighted-average formula as
  // weightedAverage() above, just spanning both types at once instead of
  // one, for the mobile-only combined MTBF/MTTR mini KPIs.
  const mtbfCombinedHours = useMemo(
    () => weightedAverage(metrics, ["mechanical", "electrical"], "mtbf_hours", "mtbf_gap_count"),
    [metrics],
  );
  const mttrCombinedHours = useMemo(
    () => weightedAverage(metrics, ["mechanical", "electrical"], "mttr_hours", "mttr_sample_count"),
    [metrics],
  );

  // Reliability Analytics section — every number below is derived from the
  // already-fetched `events` (same line/type/date filters as the table
  // above), never a new query, per the maintenance-manager brief this was
  // built against.
  const reliabilitySummary = useMemo(() => {
    const totalDowntimeMinutes = totalDowntimeMinutesOf(events);
    const repeatFailureRatePct = repeatFailureRateOf(events);
    const mtbfHours = localMtbfHours(events);
    const mttrHours = localMttrHours(events);
    const availabilityPct = availabilityPctOf(mtbfHours, mttrHours);
    return { totalDowntimeMinutes, repeatFailureRatePct, mtbfHours, mttrHours, availabilityPct };
  }, [events]);

  const titleAggregates = useMemo(() => aggregateByTitle(events), [events]);
  // Preventive-excluded counterpart of titleAggregates — feeds every
  // "how often does this recur" failure-analysis view below (Top Losses by
  // Frequency, Chronic vs Sporadic), same reasoning as
  // repeatFailureRateOf/localMtbfHours/localMttrHours: a preventive visit
  // recurring on schedule isn't a failure, and letting it in would let
  // scheduled PM titles out-rank genuine recurring failures by raw count.
  // titleAggregates itself stays preventive-inclusive for the downtime-total
  // views (Top Losses by Downtime, Mean Downtime per Fault) — preventive
  // still stops the line, so it's still real downtime there.
  const failureTitleAggregates = useMemo(
    () => aggregateByTitle(events.filter((e) => e.type !== "preventive")),
    [events],
  );

  const topLossesByDowntime = useMemo(
    () => [...titleAggregates].sort((a, b) => b.totalMinutes - a.totalMinutes).slice(0, 8),
    [titleAggregates],
  );
  const topLossesByFrequency = useMemo(
    () => [...failureTitleAggregates].sort((a, b) => b.count - a.count).slice(0, 8),
    [failureTitleAggregates],
  );
  const meanDowntimePerFault = useMemo(
    () =>
      titleAggregates
        .map((t) => ({ ...t, meanMinutes: t.totalMinutes / t.count }))
        .sort((a, b) => b.meanMinutes - a.meanMinutes),
    [titleAggregates],
  );
  // Chronic = recurred (count > 1) AND its average duration is worse than
  // the overall (current-filter) MTTR — a fault that only ever ran short
  // shouldn't count as chronic just because it happened twice. Sporadic is
  // everything else, including every single-occurrence fault, by
  // definition (see reliability-management brief this was built against).
  // When MTTR itself is unknown (no resolved events yet), nothing can be
  // judged "above average" honestly, so nothing is marked chronic.
  const chronicVsSporadic = useMemo(() => {
    const mttrThresholdMinutes =
      reliabilitySummary.mttrHours !== null ? reliabilitySummary.mttrHours * 60 : null;
    return failureTitleAggregates
      .map((t) => ({ ...t, meanMinutes: t.totalMinutes / t.count }))
      .map((t) => ({
        ...t,
        chronic:
          t.count > 1 && mttrThresholdMinutes !== null && t.meanMinutes > mttrThresholdMinutes,
      }))
      .sort((a, b) => b.count - a.count);
  }, [failureTitleAggregates, reliabilitySummary.mttrHours]);
  const reliabilityByLine = useMemo(() => reliabilityByLineOf(events), [events]);
  // Stoppages referenced by the currently-filtered `events` — same
  // "exported (currently filtered) events" semantics reliabilityByLine
  // above already uses, so the PDF report's Stoppages summary always
  // matches what's actually in the export.
  const stoppagesSummary = useMemo(
    () => stoppagesSummaryOf(events, stoppages),
    [events, stoppages],
  );

  // Every stoppage (unfiltered — the Stoppages tab is a management view,
  // not scoped to the events table's line/type/status/date filters above),
  // each with its member-event count computed from allEvents (also
  // unfiltered) rather than a second query. eventCount === 0 is what makes a
  // row "orphaned" — see allStoppagesOf.
  const allStoppageRows = useMemo(
    () => allStoppagesOf(stoppages, allEvents),
    [stoppages, allEvents],
  );
  const orphanedStoppageCount = useMemo(
    () => allStoppageRows.filter((s) => s.eventCount === 0).length,
    [allStoppageRows],
  );

  function closeStoppageDialog() {
    setStoppageDialogOpen(false);
    setViewStoppageId(null);
  }

  // Deletion is restricted to orphaned (zero-event) stoppages by the caller
  // (StoppagesSection only renders the delete control when eventCount === 0)
  // — Postgres itself backs that up too: maintenance_events.stoppage_id has
  // no ON DELETE clause, so a stoppage that still has member events can't be
  // deleted regardless (see 20260810130000_maintenance_role_can_delete_stoppages.sql).
  async function handleDeleteStoppage(stoppageId: string): Promise<boolean> {
    const { error } = await supabase.from("maintenance_stoppages").delete().eq("id", stoppageId);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success("Stoppage deleted");
    void logAudit("maintenance.delete_stoppage", "maintenance_stoppage", stoppageId);
    invalidateAll();
    return true;
  }

  // Shared by the top-level "New event" dialog and StoppageDialog's nested
  // "Add Event" — inserts the row, and when it's linked to a stoppage
  // (stoppageId set), resyncs that stoppage's status/resolved_at
  // afterward. Returns the new event's id on success, null on failure, so
  // each caller can decide what "success" means for its own dialog (close
  // it, keep it open to add another event, etc.) without duplicating the
  // insert/audit-log logic.
  async function insertEvent(data: {
    lineId: string;
    type: MaintenanceType;
    title: string;
    description: string;
    startedAt: string;
    severityLabel: string;
    technicianIds: string[];
    stoppageId: string | null;
  }): Promise<string | null> {
    const { data: inserted, error } = await supabase
      .from("maintenance_events")
      .insert({
        line_id: data.lineId,
        type: data.type,
        title: data.title.trim(),
        description: data.description.trim() || null,
        started_at: data.startedAt,
        severity_label: data.severityLabel.trim() || null,
        technician_ids: data.technicianIds,
        created_by: user?.id ?? null,
        stoppage_id: data.stoppageId,
      })
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      return null;
    }
    toast.success("Maintenance event created");
    void logAudit("maintenance.create_event", "maintenance_event", inserted.id, {
      type: data.type,
      title: data.title,
      stoppageId: data.stoppageId,
    });
    if (data.stoppageId) {
      try {
        await syncStoppageAggregate(data.stoppageId);
      } catch (err) {
        // Non-fatal — the event itself was created successfully.
        console.error("Failed to sync stoppage aggregate", err);
      }
    }
    invalidateAll();
    return inserted.id;
  }

  async function handleCreate(data: {
    lineId: string;
    type: MaintenanceType;
    title: string;
    description: string;
    startedAt: string;
    severityLabel: string;
    technicianIds: string[];
    stoppageId: string | null;
  }) {
    const id = await insertEvent(data);
    if (id) setCreateOpen(false);
  }

  const lineName = lineId ? (lines.find((l) => l.id === lineId)?.name ?? "All Lines") : "All Lines";

  async function handleExportReport() {
    setExportingReport(true);
    setReportProgress("Preparing report…");
    try {
      const { exportMaintenanceReportToPdf } = await import("@/lib/maintenance-report");
      await exportMaintenanceReportToPdf({
        lineName,
        from: from || null,
        to: to || null,
        generatedBy: profile?.display_name || profile?.email || user?.email || "—",
        events,
        metrics,
        totalEvents: allEvents.length,
        openCount: openMechanical + openElectrical,
        openPreventiveCount: openPreventive,
        mtbfMechanicalHours,
        mttrMechanicalHours,
        mtbfElectricalHours,
        mttrElectricalHours,
        totalDowntimeMinutes: reliabilitySummary.totalDowntimeMinutes,
        repeatFailureRatePct: reliabilitySummary.repeatFailureRatePct,
        availabilityPct: reliabilitySummary.availabilityPct,
        topLossesByDowntime,
        topLossesByFrequency,
        chronicVsSporadic,
        reliabilityByLine,
        stoppagesSummary,
        onProgress: (msg) => setReportProgress(msg),
      });
      toast.success("Maintenance report exported");
      void logAudit("maintenance.export_report", "maintenance_event", undefined, {
        lineName,
        from,
        to,
        eventCount: events.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Report export failed: ${msg}`);
    } finally {
      setExportingReport(false);
      setReportProgress("");
    }
  }

  return (
    <AppShell>
      {/* Mobile-only compact header — title + description + a single accent
          "+ Event" action in one row. The full desktop header (Export
          Report / New Stoppage / New event) below is unchanged, just gated
          to md+ so it doesn't also render here. */}
      <div className="mb-4 flex items-center justify-between gap-3 md:hidden">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Maintenance</h1>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            Events &amp; reliability metrics
          </p>
        </div>
        {canEdit && (
          <Button size="sm" className="shrink-0 bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Event
          </Button>
        )}
      </div>

      {/* Mobile-only quick actions — 2x2 grid, icon over label. */}
      <div className="mb-4 grid grid-cols-2 gap-2 md:hidden">
        {canEdit && (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex flex-col items-center gap-1 rounded-lg bg-accent p-3 text-accent-foreground"
          >
            <Plus className="h-[18px] w-[18px]" />
            <span className="text-xs font-medium">New event</span>
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => setStoppageDialogOpen(true)}
            className="flex flex-col items-center gap-1 rounded-lg bg-muted p-3 text-foreground"
          >
            <Layers className="h-[18px] w-[18px]" />
            <span className="text-xs font-medium">New stoppage</span>
          </button>
        )}
        <button
          onClick={handleExportReport}
          disabled={exportingReport}
          className="flex flex-col items-center gap-1 rounded-lg bg-muted p-3 text-foreground disabled:opacity-50"
        >
          {exportingReport ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" />
          ) : (
            <FileDown className="h-[18px] w-[18px]" />
          )}
          <span className="text-xs font-medium">Export report</span>
        </button>
        <button
          onClick={() =>
            document
              .getElementById("reliability-analytics")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className="flex flex-col items-center gap-1 rounded-lg bg-muted p-3 text-foreground"
        >
          <Gauge className="h-[18px] w-[18px]" />
          <span className="text-xs font-medium">Analytics</span>
        </button>
      </div>

      {/* Mobile-only mini KPI row — MTBF/MTTR combined across mechanical +
          electrical (same weighted-average formula as the Mechanical/
          Electrical KPI cards below, just pooled across both types instead
          of filtered to one) and Open = open mechanical + open electrical,
          same definition the PDF report's openCount already uses. */}
      <div className="mb-4 grid grid-cols-3 gap-1 md:hidden">
        <div className="rounded-lg bg-muted p-2 text-center">
          <p className="text-[10px] text-muted-foreground">MTBF</p>
          <p className="text-sm font-semibold">{formatHours(mtbfCombinedHours)}</p>
        </div>
        <div className="rounded-lg bg-muted p-2 text-center">
          <p className="text-[10px] text-muted-foreground">MTTR</p>
          <p className="text-sm font-semibold">{formatHours(mttrCombinedHours)}</p>
        </div>
        <div className="rounded-lg bg-destructive p-2 text-center">
          <p className="text-[10px] text-destructive-foreground/80">Open</p>
          <p className="text-sm font-semibold text-destructive-foreground">
            {openMechanical + openElectrical}
          </p>
        </div>
      </div>

      <div className="mb-6 hidden md:flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Maintenance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Mechanical, electrical & preventive maintenance events, reliability metrics.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={handleExportReport} disabled={exportingReport}>
            {exportingReport ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="mr-1.5 h-4 w-4" />
            )}
            {exportingReport ? reportProgress || "Exporting…" : "Export Report"}
          </Button>
          {canEdit && (
            <Button variant="outline" onClick={() => setStoppageDialogOpen(true)}>
              <Layers className="mr-1.5 h-4 w-4" />
              New Stoppage
            </Button>
          )}
          {canEdit && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              New event
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-3">
        <KpiCard
          label="Open Mechanical"
          value={String(openMechanical)}
          icon={Wrench}
          variant={openMechanical > 0 ? "warning" : "success"}
          className="p-3 md:p-5"
        />
        <KpiCard
          label="MTBF (Mechanical)"
          value={formatHours(mtbfMechanicalHours)}
          sub="Avg. time between failures"
          icon={Activity}
          variant="primary"
          className="p-3 md:p-5"
        />
        <KpiCard
          label="MTTR (Mechanical)"
          value={formatHours(mttrMechanicalHours)}
          sub="Avg. time to repair"
          icon={Timer}
          variant="primary"
          className="p-3 md:p-5"
        />
        <KpiCard
          label="Open Electrical"
          value={String(openElectrical)}
          icon={Zap}
          variant={openElectrical > 0 ? "warning" : "success"}
          className="p-3 md:p-5"
        />
        <KpiCard
          label="MTBF (Electrical)"
          value={formatHours(mtbfElectricalHours)}
          sub="Avg. time between failures"
          icon={Activity}
          variant="primary"
          className="p-3 md:p-5"
        />
        <KpiCard
          label="MTTR (Electrical)"
          value={formatHours(mttrElectricalHours)}
          sub="Avg. time to repair"
          icon={Timer}
          variant="primary"
          className="p-3 md:p-5"
        />
        <KpiCard
          label="Open Preventive"
          value={String(openPreventive)}
          sub="Scheduled maintenance, not counted in MTBF"
          icon={CalendarCheck}
          variant={openPreventive > 0 ? "warning" : "success"}
          className="p-3 md:p-5"
        />
      </div>

      <Tabs defaultValue="events">
        <TabsList>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="stoppages" className="gap-1.5">
            Stoppages
            {orphanedStoppageCount > 0 && (
              <Badge
                variant="destructive"
                className="h-4 min-w-4 justify-center px-1 text-[10px] leading-none"
              >
                {orphanedStoppageCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="events">
          <Card>
            <CardHeader>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <Select
                  value={lineId || "all"}
                  onValueChange={(v) => setLineId(v === "all" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Lines" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Lines</SelectItem>
                    {lines.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={type || "all"}
                  onValueChange={(v) => setType(v === "all" ? "" : (v as MaintenanceType))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="mechanical">Mechanical</SelectItem>
                    <SelectItem value="electrical">Electrical</SelectItem>
                    <SelectItem value="preventive">Preventive Maintenance</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={status || "all"}
                  onValueChange={(v) => setStatus(v === "all" ? "" : (v as MaintenanceStatus))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
                <div>
                  <Label className="text-xs">From</Label>
                  <Input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Mobile: one card per event instead of the table below (which
                  is desktop-only, hidden md:block, fully unchanged) — same
                  events/isLoading data and the same durationMs/firstNote
                  derivations as the table rows use. */}
              <div className="space-y-2 md:hidden">
                {isLoading && (
                  <div className="flex justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!isLoading && events.length === 0 && (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No maintenance events match this filter.
                  </p>
                )}
                {events.map((e) => {
                  const durationMs =
                    (e.resolved_at ? new Date(e.resolved_at).getTime() : Date.now()) -
                    new Date(e.started_at).getTime();
                  const borderColor =
                    e.type === "mechanical"
                      ? "border-l-destructive"
                      : e.type === "electrical"
                        ? "border-l-warning"
                        : "border-l-border";
                  return (
                    <div
                      key={e.id}
                      onClick={() => setSelectedEvent(e)}
                      className={`flex cursor-pointer items-start justify-between gap-2 rounded-r-lg border border-border border-l-[3px] ${borderColor} bg-card p-3`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium leading-tight">{e.title}</p>
                        <p className="truncate text-xs leading-tight text-muted-foreground">
                          {[e.production_lines?.name, e.technician_names.join(", ") || null]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </p>
                        <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>{formatDuration(durationMs)}</span>
                          {e.severity_label && <span>· {e.severity_label}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge variant={typeBadgeVariant(e.type)}>{TYPE_LABELS[e.type]}</Badge>
                        <Badge variant={statusBadgeVariant(e.status)}>
                          {STATUS_LABELS[e.status]}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead className="hidden md:table-cell">Line</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="hidden sm:table-cell">Severity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden lg:table-cell">Started</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead className="hidden md:table-cell">Technician</TableHead>
                      <TableHead className="hidden md:table-cell">Notes</TableHead>
                      <TableHead className="hidden lg:table-cell">Closed by</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                      <TableRow>
                        <TableCell colSpan={10} className="py-10 text-center">
                          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading && events.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={10}
                          className="py-10 text-center text-sm text-muted-foreground"
                        >
                          No maintenance events match this filter.
                        </TableCell>
                      </TableRow>
                    )}
                    {events.map((e) => {
                      const durationMs =
                        (e.resolved_at ? new Date(e.resolved_at).getTime() : Date.now()) -
                        new Date(e.started_at).getTime();
                      const firstNote = e.maintenance_notes[0]?.note;
                      return (
                        <TableRow
                          key={e.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedEvent(e)}
                        >
                          <TableCell>
                            <p className="text-sm font-medium leading-tight">{e.title}</p>
                            {e.description && (
                              <p className="line-clamp-1 text-xs text-muted-foreground leading-tight">
                                {e.description}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                            {e.production_lines?.name ?? "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge variant={typeBadgeVariant(e.type)}>
                                {TYPE_LABELS[e.type]}
                              </Badge>
                              {e.stoppage_id && (
                                <Badge variant="outline" className="text-[10px]">
                                  Part of Stoppage
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            {e.severity_label ? (
                              <Badge variant={severityBadgeVariant(e.severity_label)}>
                                {e.severity_label}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusBadgeVariant(e.status)}>
                              {STATUS_LABELS[e.status]}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                            {new Date(e.started_at).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {formatDuration(durationMs)}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            {e.technician_names.length > 0 ? e.technician_names.join(", ") : "—"}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            {firstNote ? truncateNote(firstNote) : "—"}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                            {e.status === "resolved"
                              ? e.resolved_by_profile?.display_name ||
                                e.resolved_by_profile?.email ||
                                "—"
                              : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stoppages">
          <StoppagesSection
            rows={allStoppageRows}
            canDelete={canDelete}
            onView={setViewStoppageId}
            onDelete={handleDeleteStoppage}
          />
        </TabsContent>
      </Tabs>

      <ReliabilityAnalyticsSection
        totalDowntimeMinutes={reliabilitySummary.totalDowntimeMinutes}
        repeatFailureRatePct={reliabilitySummary.repeatFailureRatePct}
        availabilityPct={reliabilitySummary.availabilityPct}
        topLossesByDowntime={topLossesByDowntime}
        topLossesByFrequency={topLossesByFrequency}
        meanDowntimePerFault={meanDowntimePerFault}
        chronicVsSporadic={chronicVsSporadic}
        reliabilityByLine={reliabilityByLine}
      />

      <MetricsTable metrics={metrics} />

      <CreateEventDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        lines={lines}
        onCreate={handleCreate}
      />
      <StoppageDialog
        open={stoppageDialogOpen || viewStoppageId !== null}
        onOpenChange={(o) => !o && closeStoppageDialog()}
        initialStoppageId={viewStoppageId}
        lines={lines}
        canEdit={canEdit}
        userId={user?.id ?? null}
        onCreateEvent={insertEvent}
      />
      <EventDetailDialog
        event={selectedEvent}
        canEdit={canEdit}
        userId={user?.id ?? null}
        onOpenChange={(o) => !o && setSelectedEvent(null)}
        onChanged={invalidateAll}
      />
    </AppShell>
  );
}

// Averages `field` across every metric row of the given type, weighted by
// `weightField` (gap/sample count) — averaging the per-line averages
// directly would under-weight a line with many events relative to one with
// few, giving a misleading plant-wide number.
function weightedAverage(
  metrics: MaintenanceMetric[],
  type: MaintenanceType | MaintenanceType[],
  field: "mtbf_hours" | "mttr_hours",
  weightField: "mtbf_gap_count" | "mttr_sample_count",
): number | null {
  const types = Array.isArray(type) ? type : [type];
  const rows = metrics.filter((m) => types.includes(m.type));
  const totalWeight = rows.reduce((s, m) => s + m[weightField], 0);
  if (totalWeight === 0) return null;
  const totalValue = rows.reduce((s, m) => s + (m[field] ?? 0) * m[weightField], 0);
  return totalValue / totalWeight;
}

// Matches the duration math already used per-row in the events table above
// (line ~236) — resolved events use resolved_at, still-open events run the
// clock to now.
function eventDurationMinutes(e: MaintenanceEvent): number {
  const startedMs = new Date(e.started_at).getTime();
  const endMs = e.resolved_at ? new Date(e.resolved_at).getTime() : Date.now();
  return Math.max(0, (endMs - startedMs) / 60_000);
}

function totalDowntimeMinutesOf(events: MaintenanceEvent[]): number {
  return events.reduce((s, e) => s + eventDurationMinutes(e), 0);
}

// Repeat = any event whose title (trimmed, case-insensitive) occurs more
// than once in the current filtered set. 0 events -> 0%, not NaN. Preventive
// events are excluded first — this measures unplanned failure recurrence,
// same reasoning as localMtbfHours/localMttrHours below: a monthly
// preventive visit recurring by schedule isn't a "repeat failure", and
// counting it would both inflate the rate and dilute the denominator with
// non-failure events.
function repeatFailureRateOf(events: MaintenanceEvent[]): number {
  const failureEvents = events.filter((e) => e.type !== "preventive");
  if (failureEvents.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const e of failureEvents) {
    const key = e.title.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeatCount = failureEvents.filter(
    (e) => (counts.get(e.title.trim().toLowerCase()) ?? 0) > 1,
  ).length;
  return (repeatCount / failureEvents.length) * 100;
}

// Local (filter-scoped) MTBF: average gap in hours between started_at of
// consecutive events, pooled across whatever the current line/type/date
// filters resolve to — deliberately not the lifetime per-line+type
// `metrics` query above. Null with fewer than 2 events (no gap exists).
// Preventive events are excluded — scheduled maintenance isn't a "failure",
// so it shouldn't dilute time-between-failures math (same reasoning as
// maintenanceMetricsQuery in src/lib/queries.ts).
function localMtbfHours(events: MaintenanceEvent[]): number | null {
  const failureEvents = events.filter((e) => e.type !== "preventive");
  if (failureEvents.length < 2) return null;
  const starts = failureEvents.map((e) => new Date(e.started_at).getTime()).sort((a, b) => a - b);
  let totalGapHours = 0;
  for (let i = 1; i < starts.length; i++) totalGapHours += (starts[i] - starts[i - 1]) / 3_600_000;
  return totalGapHours / (starts.length - 1);
}

// Local (filter-scoped) MTTR: average resolved_at - started_at in hours
// across resolved events only. Null when none are resolved yet. Preventive
// events are excluded — see localMtbfHours above.
function localMttrHours(events: MaintenanceEvent[]): number | null {
  const durations = events
    .filter((e) => e.type !== "preventive" && e.resolved_at)
    .map(
      (e) =>
        (new Date(e.resolved_at as string).getTime() - new Date(e.started_at).getTime()) /
        3_600_000,
    );
  if (durations.length === 0) return null;
  return durations.reduce((s, v) => s + v, 0) / durations.length;
}

function availabilityPctOf(mtbfHours: number | null, mttrHours: number | null): number | null {
  if (mtbfHours === null || mttrHours === null) return null;
  const denom = mtbfHours + mttrHours;
  if (denom <= 0) return null;
  return (mtbfHours / denom) * 100;
}

interface TitleAggregate {
  title: string;
  totalMinutes: number;
  count: number;
}

// Groups events by title (trimmed, case-insensitive) — the display title
// keeps the first occurrence's original casing/spacing.
function aggregateByTitle(events: MaintenanceEvent[]): TitleAggregate[] {
  const map = new Map<string, TitleAggregate>();
  for (const e of events) {
    const key = e.title.trim().toLowerCase();
    const minutes = eventDurationMinutes(e);
    const cur = map.get(key);
    if (cur) {
      cur.totalMinutes += minutes;
      cur.count += 1;
    } else {
      map.set(key, { title: e.title.trim(), totalMinutes: minutes, count: 1 });
    }
  }
  return Array.from(map.values());
}

interface LineReliability {
  lineId: string;
  lineName: string;
  mtbfHours: number | null;
  mttrHours: number | null;
  availabilityPct: number | null;
  eventCount: number;
}

// Same local MTBF/MTTR math as above, grouped per line so each row reflects
// only that line's events within the current filter.
function reliabilityByLineOf(events: MaintenanceEvent[]): LineReliability[] {
  const groups = new Map<string, MaintenanceEvent[]>();
  for (const e of events) {
    const key = e.line_id ?? "unassigned";
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }
  const rows: LineReliability[] = [];
  for (const [lineId, groupEvents] of groups) {
    const mtbfHours = localMtbfHours(groupEvents);
    const mttrHours = localMttrHours(groupEvents);
    rows.push({
      lineId,
      lineName: groupEvents[0].production_lines?.name ?? "—",
      mtbfHours,
      mttrHours,
      availabilityPct: availabilityPctOf(mtbfHours, mttrHours),
      eventCount: groupEvents.length,
    });
  }
  // Worst availability first; unknown (null, too little data) sorts last —
  // same "unknown isn't bad" reasoning as sortByWorstMtbf.
  return rows.sort((a, b) => {
    if (a.availabilityPct === null && b.availabilityPct === null) return 0;
    if (a.availabilityPct === null) return 1;
    if (b.availabilityPct === null) return -1;
    return a.availabilityPct - b.availabilityPct;
  });
}

interface StoppageSummaryRow {
  id: string;
  lineName: string;
  majorityType: MaintenanceType;
  eventCount: number;
  startedAt: string;
  status: MaintenanceStatus;
  resolvedAt: string | null;
  durationMinutes: number;
}

// Groups the currently-filtered `events` by stoppage_id, joins each group
// against the (unfiltered) `stoppages` list for its window/status, and
// returns one summary row per stoppage — backs the PDF report's Stoppages
// section. Events with no stoppage_id contribute nothing here (they're
// already covered by the report's ordinary Events table).
function stoppagesSummaryOf(
  events: MaintenanceEvent[],
  stoppages: MaintenanceStoppage[],
): StoppageSummaryRow[] {
  const stoppageById = new Map(stoppages.map((s) => [s.id, s]));
  const groups = new Map<string, MaintenanceEvent[]>();
  for (const e of events) {
    if (!e.stoppage_id) continue;
    const arr = groups.get(e.stoppage_id);
    if (arr) arr.push(e);
    else groups.set(e.stoppage_id, [e]);
  }
  const rows: StoppageSummaryRow[] = [];
  for (const [stoppageId, members] of groups) {
    const stoppage = stoppageById.get(stoppageId);
    if (!stoppage) continue; // stale cache — FK guarantees this exists in the DB
    rows.push({
      id: stoppageId,
      lineName: stoppage.production_lines?.name ?? members[0].production_lines?.name ?? "—",
      majorityType: majorityMaintenanceType(members),
      eventCount: members.length,
      startedAt: stoppage.started_at,
      status: stoppage.status,
      resolvedAt: stoppage.resolved_at,
      durationMinutes: stoppageDurationMinutes(stoppage),
    });
  }
  return rows.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

interface StoppageRow {
  id: string;
  lineName: string;
  status: MaintenanceStatus;
  startedAt: string;
  resolvedAt: string | null;
  durationMinutes: number;
  eventCount: number;
}

// Unlike stoppagesSummaryOf above (which only surfaces stoppages that have
// at least one member event among the currently-filtered `events`), this
// walks every stoppage in the plant regardless of filters — an orphaned
// stoppage has zero member events by definition, so it would never appear
// via a group-by-events pass. Member counts come from the caller's already-
// fetched unfiltered event list rather than a second query. Backs the
// Stoppages tab.
function allStoppagesOf(
  stoppages: MaintenanceStoppage[],
  allEvents: MaintenanceEvent[],
): StoppageRow[] {
  const countByStoppage = new Map<string, number>();
  for (const e of allEvents) {
    if (!e.stoppage_id) continue;
    countByStoppage.set(e.stoppage_id, (countByStoppage.get(e.stoppage_id) ?? 0) + 1);
  }
  return stoppages
    .map((s) => ({
      id: s.id,
      lineName: s.production_lines?.name ?? "—",
      status: s.status,
      startedAt: s.started_at,
      resolvedAt: s.resolved_at,
      durationMinutes: stoppageDurationMinutes(s),
      eventCount: countByStoppage.get(s.id) ?? 0,
    }))
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

function EmptyMiniState() {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      No data for this filter.
    </div>
  );
}

function ReliabilityAnalyticsSection({
  totalDowntimeMinutes,
  repeatFailureRatePct,
  availabilityPct,
  topLossesByDowntime,
  topLossesByFrequency,
  meanDowntimePerFault,
  chronicVsSporadic,
  reliabilityByLine,
}: {
  totalDowntimeMinutes: number;
  repeatFailureRatePct: number;
  availabilityPct: number | null;
  topLossesByDowntime: TitleAggregate[];
  topLossesByFrequency: TitleAggregate[];
  meanDowntimePerFault: (TitleAggregate & { meanMinutes: number })[];
  chronicVsSporadic: (TitleAggregate & { meanMinutes: number; chronic: boolean })[];
  reliabilityByLine: LineReliability[];
}) {
  const isMobile = useIsMobile();
  const nameMaxLen = isMobile ? 10 : 20;

  const downtimeChartData = topLossesByDowntime.map((t) => ({
    name: t.title.length > nameMaxLen ? `${t.title.slice(0, nameMaxLen)}…` : t.title,
    fullName: t.title,
    minutes: Math.round(t.totalMinutes),
  }));
  const frequencyChartData = topLossesByFrequency.map((t) => ({
    name: t.title.length > nameMaxLen ? `${t.title.slice(0, nameMaxLen)}…` : t.title,
    fullName: t.title,
    count: t.count,
  }));

  return (
    <div id="reliability-analytics" className="mt-6 space-y-4 scroll-mt-4">
      <div>
        <h2 className="text-lg font-semibold">Reliability Analytics</h2>
        <p className="text-sm text-muted-foreground">
          Computed from the events matching the filters above.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KpiCard
          label="Maintenance events downtime"
          value={formatDuration(totalDowntimeMinutes * 60_000)}
          sub="from /maintenance records only"
          icon={Timer}
          variant="warning"
        />
        <KpiCard
          label="Repeat Failure Rate"
          value={`${repeatFailureRatePct.toFixed(1)}%`}
          sub="Events whose title recurs ÷ total"
          icon={Repeat}
          variant={
            repeatFailureRatePct > 30 ? "danger" : repeatFailureRatePct > 10 ? "warning" : "success"
          }
        />
        <KpiCard
          label="Equipment Availability"
          value={availabilityPct === null ? "—" : `${availabilityPct.toFixed(1)}%`}
          sub="Based on mechanical/electrical failures only (MTBF ÷ (MTBF + MTTR))"
          icon={Gauge}
          variant={
            availabilityPct === null
              ? "default"
              : availabilityPct >= 90
                ? "success"
                : availabilityPct >= 75
                  ? "warning"
                  : "danger"
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold">Top Losses by Downtime</h3>
          </CardHeader>
          <CardContent>
            {downtimeChartData.length === 0 ? (
              <EmptyMiniState />
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={downtimeChartData}
                    layout="vertical"
                    margin={{ top: 4, right: 24, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={isMobile ? 70 : 120}
                      tick={{ fontSize: 11, fill: "var(--color-foreground)" }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-popover)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value: number) => [formatDuration(value * 60_000), "Downtime"]}
                      labelFormatter={(_l, payload) => payload?.[0]?.payload?.fullName ?? ""}
                    />
                    <Bar dataKey="minutes" radius={[0, 6, 6, 0]} fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold">Top Losses by Frequency</h3>
          </CardHeader>
          <CardContent>
            {frequencyChartData.length === 0 ? (
              <EmptyMiniState />
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={frequencyChartData}
                    layout="vertical"
                    margin={{ top: 4, right: 24, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={isMobile ? 70 : 120}
                      tick={{ fontSize: 11, fill: "var(--color-foreground)" }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-popover)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value: number) => [
                        `${value} event${value === 1 ? "" : "s"}`,
                        "Frequency",
                      ]}
                      labelFormatter={(_l, payload) => payload?.[0]?.payload?.fullName ?? ""}
                    />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]} fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold">Mean Downtime per Fault</h3>
          </CardHeader>
          <CardContent>
            {meanDowntimePerFault.length === 0 ? (
              <EmptyMiniState />
            ) : (
              <ul className="space-y-2">
                {meanDowntimePerFault.slice(0, 10).map((t) => (
                  <li
                    key={t.title}
                    className="flex items-center justify-between gap-3 border-b border-border/50 pb-2 text-sm last:border-0 last:pb-0"
                  >
                    <span className="truncate">{t.title}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatDuration(t.meanMinutes * 60_000)} avg · {t.count}x
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold">Chronic vs Sporadic</h3>
            <p className="text-xs text-muted-foreground">Chronic = recurred + above-avg duration</p>
          </CardHeader>
          <CardContent>
            {chronicVsSporadic.length === 0 ? (
              <EmptyMiniState />
            ) : (
              <ul className="space-y-2">
                {chronicVsSporadic.slice(0, 10).map((t) => (
                  <li
                    key={t.title}
                    className="flex items-center justify-between gap-3 border-b border-border/50 pb-2 text-sm last:border-0 last:pb-0"
                  >
                    <span className="truncate">{t.title}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums text-muted-foreground">{t.count}x</span>
                      <Badge variant={t.chronic ? "destructive" : "outline"}>
                        {t.chronic ? "Chronic" : "Sporadic"}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold">Reliability by Line</h3>
          <p className="text-xs text-muted-foreground">
            Sorted worst availability first, computed from the currently filtered events.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Line</TableHead>
                  <TableHead>MTBF</TableHead>
                  <TableHead>MTTR</TableHead>
                  <TableHead>Equipment Availability</TableHead>
                  <TableHead className="hidden sm:table-cell">Events</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reliabilityByLine.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No events match this filter.
                    </TableCell>
                  </TableRow>
                )}
                {reliabilityByLine.map((r) => (
                  <TableRow key={r.lineId}>
                    <TableCell className="text-sm">{r.lineName}</TableCell>
                    <TableCell className="tabular-nums">{formatHours(r.mtbfHours)}</TableCell>
                    <TableCell className="tabular-nums">{formatHours(r.mttrHours)}</TableCell>
                    <TableCell className="tabular-nums">
                      {r.availabilityPct === null ? "—" : `${r.availabilityPct.toFixed(1)}%`}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {r.eventCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricsTable({ metrics }: { metrics: MaintenanceMetric[] }) {
  const sorted = sortByWorstMtbf(metrics);
  return (
    <Card className="mt-6">
      <CardHeader>
        <h2 className="text-lg font-semibold">MTBF / MTTR by Line & Type</h2>
        <p className="text-sm text-muted-foreground">
          Lifetime reliability metrics — not affected by the table filters above. Sorted worst MTBF
          first.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>MTBF</TableHead>
                <TableHead>MTTR</TableHead>
                <TableHead className="hidden sm:table-cell">Events</TableHead>
                <TableHead className="hidden sm:table-cell">Resolved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No maintenance events recorded yet.
                  </TableCell>
                </TableRow>
              )}
              {sorted.map((m) => (
                <TableRow key={`${m.line_id}-${m.type}`}>
                  <TableCell className="text-sm">{m.line_name}</TableCell>
                  <TableCell>
                    <Badge variant={typeBadgeVariant(m.type)}>{TYPE_LABELS[m.type]}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatHours(m.mtbf_hours)}</TableCell>
                  <TableCell className="tabular-nums">{formatHours(m.mttr_hours)}</TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                    {m.event_count}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                    {m.resolved_count}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// Management view for maintenance_stoppages — every stoppage in the plant
// (not scoped to the Events tab's filters), with its member-event count and
// total duration, so Admin/Maintenance can spot and clean up orphaned
// stoppages (eventCount === 0, left behind once every member event under
// it has been deleted — see EventDetailDialog's handleDelete /
// syncStoppageAggregate) that would otherwise sit invisibly in the
// database. Clicking a row opens it read/add-only in StoppageDialog (same
// component the "New Stoppage" button uses, just pre-loaded with an
// existing id); the delete control only ever appears on orphaned rows.
function StoppagesSection({
  rows,
  canDelete,
  onView,
  onDelete,
}: {
  rows: StoppageRow[];
  canDelete: boolean;
  onView: (id: string) => void;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const pendingDelete = rows.find((r) => r.id === pendingDeleteId) ?? null;

  async function confirmDelete() {
    if (!pendingDeleteId) return;
    setDeleting(true);
    const ok = await onDelete(pendingDeleteId);
    setDeleting(false);
    if (ok) setPendingDeleteId(null);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Stoppages</h2>
          <p className="text-sm text-muted-foreground">
            Downtime windows grouping several maintenance events. Rows marked{" "}
            <span className="font-medium text-foreground">Orphaned</span> have no member events left
            and can be deleted.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Line</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      No stoppages recorded yet.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((s) => {
                  const orphaned = s.eventCount === 0;
                  return (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => onView(s.id)}
                    >
                      <TableCell className="text-sm font-medium">{s.lineName}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant={statusBadgeVariant(s.status)}>
                            {STATUS_LABELS[s.status]}
                          </Badge>
                          {orphaned && (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Orphaned
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                        {new Date(s.startedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {formatDuration(s.durationMinutes * 60_000)}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">{s.eventCount}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {orphaned && canDelete && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setPendingDeleteId(s.id)}
                            aria-label="Delete orphaned stoppage"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(o) => !o && setPendingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this stoppage?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `The empty stoppage for ${pendingDelete.lineName} started ${new Date(pendingDelete.startedAt).toLocaleString()} will be permanently deleted. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CreateEventDialog({
  open,
  onOpenChange,
  lines,
  stoppage,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lines: { id: string; name: string }[];
  // When set, this dialog creates an event pre-linked to an already-created
  // stoppage (see StoppageDialog's "Add Event") — the line is locked to the
  // stoppage's own line (a stoppage's member events all share one line) and
  // every created row carries stoppageId.
  stoppage?: { id: string; lineId: string } | null;
  onCreate: (data: {
    lineId: string;
    type: MaintenanceType;
    title: string;
    description: string;
    startedAt: string;
    severityLabel: string;
    technicianIds: string[];
    stoppageId: string | null;
  }) => Promise<void>;
}) {
  const [lineId, setLineId] = useState(stoppage?.lineId ?? "");
  const [type, setType] = useState<MaintenanceType>("mechanical");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startedAt, setStartedAt] = useState(() => toDatetimeLocalValue(new Date()));
  const [severityLabel, setSeverityLabel] = useState("");
  const [technicianIds, setTechnicianIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const { data: technicians = [] } = useQuery(techniciansQuery);
  const activeTechnicians = technicians.filter((t) => t.is_active);

  function reset() {
    setLineId(stoppage?.lineId ?? "");
    setType("mechanical");
    setTitle("");
    setDescription("");
    setStartedAt(toDatetimeLocalValue(new Date()));
    setSeverityLabel("");
    setTechnicianIds([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lineId || !title.trim()) {
      toast.error("Please select a line and enter a title.");
      return;
    }
    if (!startedAt) {
      toast.error("Started At is required.");
      return;
    }
    setSubmitting(true);
    try {
      await onCreate({
        lineId,
        type,
        title,
        description,
        startedAt: new Date(startedAt).toISOString(),
        severityLabel,
        technicianIds,
        stoppageId: stoppage?.id ?? null,
      });
      reset();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Maintenance Event</DialogTitle>
          <DialogDescription>
            {stoppage
              ? "Log an event as part of this stoppage."
              : "Log a new mechanical, electrical, or preventive maintenance issue."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Line</Label>
              <Select value={lineId} onValueChange={setLineId} disabled={!!stoppage}>
                <SelectTrigger>
                  <SelectValue placeholder="Select line" />
                </SelectTrigger>
                <SelectContent>
                  {lines.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as MaintenanceType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mechanical">Mechanical</SelectItem>
                  <SelectItem value="electrical">Electrical</SelectItem>
                  <SelectItem value="preventive">Preventive Maintenance</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Severity (optional)</Label>
              <Select
                value={severityLabel || "none"}
                onValueChange={(v) => setSeverityLabel(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unclassified</SelectItem>
                  {SEVERITY_LABEL_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Technicians (optional)</Label>
              <TechnicianMultiSelect
                technicians={activeTechnicians}
                selectedIds={technicianIds}
                onChange={setTechnicianIds}
              />
            </div>
          </div>
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div>
            <Label>Started At</Label>
            <Input
              type="datetime-local"
              value={startedAt}
              onChange={(e) => setStartedAt(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create Event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// A stoppage groups several maintenance events (e.g. a line down for
// several concurrent reasons) into a single downtime window — see
// MaintenanceStoppage in src/lib/queries.ts. Two-phase UI: first pick a
// line + Started At and create the (initially empty) stoppage row itself,
// then add member events to it one at a time via the same CreateEventDialog
// used for standalone events. status/resolved_at are never edited directly
// here — they're derived from member events by syncStoppageAggregate,
// called after every add (and, from EventDetailDialog, every member
// status change/delete).
function StoppageDialog({
  open,
  onOpenChange,
  lines,
  canEdit,
  userId,
  onCreateEvent,
  initialStoppageId = null,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lines: { id: string; name: string }[];
  canEdit: boolean;
  userId: string | null;
  onCreateEvent: (data: {
    lineId: string;
    type: MaintenanceType;
    title: string;
    description: string;
    startedAt: string;
    severityLabel: string;
    technicianIds: string[];
    stoppageId: string | null;
  }) => Promise<string | null>;
  // Set by the Stoppages tab when opening this dialog to view an already-
  // existing stoppage (as opposed to the "New Stoppage" button, which opens
  // it with this null and starts the create form below).
  initialStoppageId?: string | null;
}) {
  const [stoppageId, setStoppageId] = useState<string | null>(initialStoppageId);
  const [lineId, setLineId] = useState("");
  const [startedAt, setStartedAt] = useState(() => toDatetimeLocalValue(new Date()));
  const [creating, setCreating] = useState(false);
  const [addEventOpen, setAddEventOpen] = useState(false);

  const { data: stoppage } = useQuery(maintenanceStoppageQuery(stoppageId));
  const { data: members = [] } = useQuery(stoppageEventsQuery(stoppageId));

  function reset() {
    setStoppageId(initialStoppageId);
    setLineId("");
    setStartedAt(toDatetimeLocalValue(new Date()));
  }

  // Re-sync every time the dialog opens — covers both switching which
  // stoppage is being viewed (one row's "view" click while a different
  // stoppage was previously open) and going from "view" back to "create"
  // (New Stoppage button after a view was closed), neither of which a plain
  // useState initializer would catch since this component instance is
  // reused for every open rather than remounted.
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialStoppageId]);

  async function handleCreateStoppage(e: React.FormEvent) {
    e.preventDefault();
    if (!lineId) {
      toast.error("Please select a line.");
      return;
    }
    if (!startedAt) {
      toast.error("Started At is required.");
      return;
    }
    setCreating(true);
    try {
      const { data: inserted, error } = await supabase
        .from("maintenance_stoppages")
        .insert({
          line_id: lineId,
          started_at: new Date(startedAt).toISOString(),
          created_by: userId,
        })
        .select()
        .single();
      if (error) throw error;
      toast.success("Stoppage created — add events to it below.");
      void logAudit("maintenance.create_stoppage", "maintenance_stoppage", inserted.id, { lineId });
      setStoppageId(inserted.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create stoppage");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          onOpenChange(o);
          if (!o) reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{stoppageId ? "Stoppage" : "New Stoppage"}</DialogTitle>
            <DialogDescription>
              {stoppageId
                ? "Add the individual maintenance events that make up this stoppage."
                : "Groups several maintenance events into one downtime window — pick the line and when the stoppage started, then add its events."}
            </DialogDescription>
          </DialogHeader>

          {!stoppageId ? (
            <form onSubmit={handleCreateStoppage} className="space-y-3">
              <div>
                <Label>Line</Label>
                <Select value={lineId} onValueChange={setLineId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select line" />
                  </SelectTrigger>
                  <SelectContent>
                    {lines.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Started At</Label>
                <Input
                  type="datetime-local"
                  value={startedAt}
                  onChange={(e) => setStartedAt(e.target.value)}
                  required
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? "Creating…" : "Create Stoppage"}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{stoppage?.production_lines?.name ?? "—"}</span>
                <Badge variant={statusBadgeVariant(stoppage?.status ?? "open")}>
                  {STATUS_LABELS[stoppage?.status ?? "open"]}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Started {stoppage ? new Date(stoppage.started_at).toLocaleString() : "—"}
                {stoppage?.resolved_at && (
                  <> → Resolved {new Date(stoppage.resolved_at).toLocaleString()}</>
                )}
              </p>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Events in this stoppage
                </p>
                {members.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No events added yet.</p>
                ) : (
                  <ul className="max-h-64 space-y-2 overflow-y-auto">
                    {members.map((m: StoppageMemberEvent) => (
                      <li
                        key={m.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{m.title}</p>
                          <p className="text-xs text-muted-foreground">{TYPE_LABELS[m.type]}</p>
                        </div>
                        <Badge variant={statusBadgeVariant(m.status)}>
                          {STATUS_LABELS[m.status]}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
                {canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => setAddEventOpen(true)}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add Event
                  </Button>
                )}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {stoppageId && (
        <CreateEventDialog
          open={addEventOpen}
          onOpenChange={setAddEventOpen}
          lines={lines}
          stoppage={{ id: stoppageId, lineId: stoppage?.line_id ?? lineId }}
          onCreate={async (data) => {
            const id = await onCreateEvent(data);
            if (id) setAddEventOpen(false);
          }}
        />
      )}
    </>
  );
}
