import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { KpiCard } from "@/components/KpiCard";
import { EventDetailDialog } from "@/components/EventDetailDialog";
import { Wrench, Zap, Activity, Timer, Plus, Loader2, FileDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { requireSession } from "@/lib/require-session";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { TYPE_LABELS, STATUS_LABELS, SEVERITY_LABEL_OPTIONS, typeBadgeVariant, statusBadgeVariant, severityBadgeVariant, formatDuration, formatHours, sortByWorstMtbf, toDatetimeLocalValue } from "@/lib/maintenance-format";
import {
  linesQuery,
  maintenanceEventsQuery,
  maintenanceMetricsQuery,
  type MaintenanceEvent,
  type MaintenanceType,
  type MaintenanceStatus,
  type MaintenanceMetric,
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
  const qc = useQueryClient();

  const [lineId, setLineId] = useState("");
  const [type, setType] = useState<MaintenanceType | "">("");
  const [status, setStatus] = useState<MaintenanceStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<MaintenanceEvent | null>(null);
  const [exportingReport, setExportingReport] = useState(false);
  const [reportProgress, setReportProgress] = useState("");

  // Summary cards reflect plant-wide current state, independent of the table
  // filters below (same reasoning as the Dashboard's global KPI cards) — an
  // analyst filtering the table down to one line shouldn't see the open-count
  // cards silently change to match.
  const { data: allEvents = [] } = useQuery(maintenanceEventsQuery(null, null, null, null, null));
  const { data: metrics = [] } = useQuery(maintenanceMetricsQuery());

  const { data: events = [], isLoading } = useQuery(
    maintenanceEventsQuery(lineId || null, type || null, status || null, from || null, to || null),
  );

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["maintenance-events"] });
    qc.invalidateQueries({ queryKey: ["maintenance-metrics"] });
  }

  const openMechanical = allEvents.filter((e) => e.type === "mechanical" && e.status !== "resolved").length;
  const openElectrical = allEvents.filter((e) => e.type === "electrical" && e.status !== "resolved").length;

  const mtbfMechanicalHours = useMemo(() => weightedAverage(metrics, "mechanical", "mtbf_hours", "mtbf_gap_count"), [metrics]);
  const mttrMechanicalHours = useMemo(() => weightedAverage(metrics, "mechanical", "mttr_hours", "mttr_sample_count"), [metrics]);
  const mtbfElectricalHours = useMemo(() => weightedAverage(metrics, "electrical", "mtbf_hours", "mtbf_gap_count"), [metrics]);
  const mttrElectricalHours = useMemo(() => weightedAverage(metrics, "electrical", "mttr_hours", "mttr_sample_count"), [metrics]);

  async function handleCreate(data: { lineId: string; type: MaintenanceType; title: string; description: string; startedAt: string; severityLabel: string; technician: string }) {
    const { data: inserted, error } = await supabase
      .from("maintenance_events")
      .insert({
        line_id: data.lineId,
        type: data.type,
        title: data.title.trim(),
        description: data.description.trim() || null,
        started_at: data.startedAt,
        severity_label: data.severityLabel.trim() || null,
        technician: data.technician.trim() || null,
        created_by: user?.id ?? null,
      })
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Maintenance event created");
    void logAudit("maintenance.create_event", "maintenance_event", inserted.id, { type: data.type, title: data.title });
    invalidateAll();
    setCreateOpen(false);
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
        mtbfMechanicalHours,
        mttrMechanicalHours,
        mtbfElectricalHours,
        mttrElectricalHours,
        onProgress: (msg) => setReportProgress(msg),
      });
      toast.success("Maintenance report exported");
      void logAudit("maintenance.export_report", "maintenance_event", undefined, { lineName, from, to, eventCount: events.length });
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
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Maintenance</h1>
          <p className="mt-1 text-sm text-muted-foreground">Mechanical & electrical maintenance events, reliability metrics.</p>
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
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />New event
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Open Mechanical" value={String(openMechanical)} icon={Wrench} variant={openMechanical > 0 ? "warning" : "success"} />
        <KpiCard label="MTBF (Mechanical)" value={formatHours(mtbfMechanicalHours)} sub="Avg. time between failures" icon={Activity} variant="primary" />
        <KpiCard label="MTTR (Mechanical)" value={formatHours(mttrMechanicalHours)} sub="Avg. time to repair" icon={Timer} variant="primary" />
        <KpiCard label="Open Electrical" value={String(openElectrical)} icon={Zap} variant={openElectrical > 0 ? "warning" : "success"} />
        <KpiCard label="MTBF (Electrical)" value={formatHours(mtbfElectricalHours)} sub="Avg. time between failures" icon={Activity} variant="primary" />
        <KpiCard label="MTTR (Electrical)" value={formatHours(mttrElectricalHours)} sub="Avg. time to repair" icon={Timer} variant="primary" />
      </div>

      <Card>
        <CardHeader>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Select value={lineId || "all"} onValueChange={(v) => setLineId(v === "all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="All Lines" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Lines</SelectItem>
                {lines.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={type || "all"} onValueChange={(v) => setType(v === "all" ? "" : (v as MaintenanceType))}>
              <SelectTrigger><SelectValue placeholder="All Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="mechanical">Mechanical</SelectItem>
                <SelectItem value="electrical">Electrical</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : (v as MaintenanceStatus))}>
              <SelectTrigger><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" /></div>
            <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" /></div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
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
                  <TableHead className="hidden md:table-cell">Notes</TableHead>
                  <TableHead className="hidden lg:table-cell">Resolved by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={9} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
                )}
                {!isLoading && events.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">No maintenance events match this filter.</TableCell></TableRow>
                )}
                {events.map((e) => {
                  const durationMs = (e.resolved_at ? new Date(e.resolved_at).getTime() : Date.now()) - new Date(e.started_at).getTime();
                  const firstNote = e.maintenance_notes[0]?.note;
                  return (
                    <TableRow key={e.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedEvent(e)}>
                      <TableCell>
                        <p className="text-sm font-medium leading-tight">{e.title}</p>
                        {e.description && <p className="line-clamp-1 text-xs text-muted-foreground leading-tight">{e.description}</p>}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{e.production_lines?.name ?? "—"}</TableCell>
                      <TableCell><Badge variant={typeBadgeVariant(e.type)}>{TYPE_LABELS[e.type]}</Badge></TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {e.severity_label ? <Badge variant={severityBadgeVariant(e.severity_label)}>{e.severity_label}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell><Badge variant={statusBadgeVariant(e.status)}>{STATUS_LABELS[e.status]}</Badge></TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{new Date(e.started_at).toLocaleString()}</TableCell>
                      <TableCell className="text-sm tabular-nums">{formatDuration(durationMs)}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{firstNote ? truncateNote(firstNote) : "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {e.status === "resolved" ? (e.resolved_by_profile?.display_name || e.resolved_by_profile?.email || "—") : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <MetricsTable metrics={metrics} />

      <CreateEventDialog open={createOpen} onOpenChange={setCreateOpen} lines={lines} onCreate={handleCreate} />
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
  type: MaintenanceType,
  field: "mtbf_hours" | "mttr_hours",
  weightField: "mtbf_gap_count" | "mttr_sample_count",
): number | null {
  const rows = metrics.filter((m) => m.type === type);
  const totalWeight = rows.reduce((s, m) => s + m[weightField], 0);
  if (totalWeight === 0) return null;
  const totalValue = rows.reduce((s, m) => s + (m[field] ?? 0) * m[weightField], 0);
  return totalValue / totalWeight;
}

function MetricsTable({ metrics }: { metrics: MaintenanceMetric[] }) {
  const sorted = sortByWorstMtbf(metrics);
  return (
    <Card className="mt-6">
      <CardHeader>
        <h2 className="text-lg font-semibold">MTBF / MTTR by Line & Type</h2>
        <p className="text-sm text-muted-foreground">Lifetime reliability metrics — not affected by the table filters above. Sorted worst MTBF first.</p>
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
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No maintenance events recorded yet.</TableCell></TableRow>
              )}
              {sorted.map((m) => (
                <TableRow key={`${m.line_id}-${m.type}`}>
                  <TableCell className="text-sm">{m.line_name}</TableCell>
                  <TableCell><Badge variant={typeBadgeVariant(m.type)}>{TYPE_LABELS[m.type]}</Badge></TableCell>
                  <TableCell className="tabular-nums">{formatHours(m.mtbf_hours)}</TableCell>
                  <TableCell className="tabular-nums">{formatHours(m.mttr_hours)}</TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{m.event_count}</TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{m.resolved_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateEventDialog({ open, onOpenChange, lines, onCreate }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lines: { id: string; name: string }[];
  onCreate: (data: { lineId: string; type: MaintenanceType; title: string; description: string; startedAt: string; severityLabel: string; technician: string }) => Promise<void>;
}) {
  const [lineId, setLineId] = useState("");
  const [type, setType] = useState<MaintenanceType>("mechanical");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startedAt, setStartedAt] = useState(() => toDatetimeLocalValue(new Date()));
  const [severityLabel, setSeverityLabel] = useState("");
  const [technician, setTechnician] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setLineId(""); setType("mechanical"); setTitle(""); setDescription(""); setStartedAt(toDatetimeLocalValue(new Date())); setSeverityLabel(""); setTechnician("");
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
      await onCreate({ lineId, type, title, description, startedAt: new Date(startedAt).toISOString(), severityLabel, technician });
      reset();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Maintenance Event</DialogTitle>
          <DialogDescription>Log a new mechanical or electrical issue.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Line</Label>
              <Select value={lineId} onValueChange={setLineId}>
                <SelectTrigger><SelectValue placeholder="Select line" /></SelectTrigger>
                <SelectContent>{lines.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as MaintenanceType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mechanical">Mechanical</SelectItem>
                  <SelectItem value="electrical">Electrical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Severity (optional)</Label>
              <Select value={severityLabel || "none"} onValueChange={(v) => setSeverityLabel(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select severity" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unclassified</SelectItem>
                  {SEVERITY_LABEL_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Technician (optional)</Label>
              <Input value={technician} onChange={(e) => setTechnician(e.target.value)} placeholder="Who did the work" />
            </div>
          </div>
          <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
          <div><Label>Description (optional)</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></div>
          <div><Label>Started At</Label><Input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} required /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create Event"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

