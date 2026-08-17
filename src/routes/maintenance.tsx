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
import { TableSkeletonRows } from "@/components/TableSkeletonRows";
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
  ChevronRight,
  List,
  TrendingDown,
  ChartScatter,
  Inbox,
  type LucideIcon,
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
  collapseStoppageEvents,
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

// Mobile-only event summary card — 3px colored left border (red mechanical,
// amber electrical), title/line/technician, type+status badges, duration +
// severity. Shared by the always-visible "Open events" list and the
// (collapsible) full events list below, so both render identically.
function MobileEventCard({ event: e, onClick }: { event: MaintenanceEvent; onClick: () => void }) {
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
      onClick={onClick}
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
        <Badge variant={statusBadgeVariant(e.status)}>{STATUS_LABELS[e.status]}</Badge>
      </div>
    </div>
  );
}

// Wraps a whole section (Events/Stoppages tabs, Reliability Analytics) on
// mobile: closed by default, tap the summary row (title + optional count +
// chevron) to reveal it. At md+ the toggle row is md:hidden and the content
// is always shown (md:block unconditionally) — desktop is untouched. Plain
// useState, not shadcn's Collapsible — see the same reasoning on
// MobileCollapsibleCard in settings.tsx: nothing here needs Radix's
// mount/animation machinery, and a bare CSS class is trivially safe to force
// back open at md+ regardless of interaction state.
function MobileCollapsibleSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mb-2 flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 md:hidden"
      >
        <span className="text-sm font-semibold">{title}</span>
        <span className="flex items-center gap-2">
          {count !== undefined && (
            <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
          )}
          <ChevronRight
            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          />
        </span>
      </button>
      <div className={`${open ? "block" : "hidden"} md:block`}>{children}</div>
    </>
  );
}

// Mobile-only compact variant of the shared KpiCard, used only for the 3
// headline Reliability Analytics cards — KpiCard itself (used all over the
// app) isn't touched. p-5 + text-2xl/3xl + truncate was clipping/wrapping
// values like "39h 21m" at 3-across mobile width; this trades the icon and
// full label for whitespace-nowrap, a smaller value, and a 2-line label cap.
function MiniKpiCard({
  label,
  value,
  sub,
  variant = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  variant?: "default" | "primary" | "success" | "warning" | "danger";
}) {
  const tone = {
    default: "from-card to-card",
    primary: "from-primary/10 to-primary/[0.02]",
    success: "from-success/15 to-success/[0.02]",
    warning: "from-warning/15 to-warning/[0.02]",
    danger: "from-destructive/15 to-destructive/[0.02]",
  }[variant];
  const accent = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    danger: "text-destructive",
  }[variant];

  return (
    <div className={`rounded-xl border border-border bg-gradient-to-br p-2 shadow-card ${tone}`}>
      <p className="line-clamp-2 text-[9px] font-medium uppercase leading-tight tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 whitespace-nowrap text-lg font-medium tabular-nums ${accent}`}>{value}</p>
      {sub && <p className="mt-1 hidden text-xs text-muted-foreground md:block">{sub}</p>}
    </div>
  );
}

interface MaintenanceSidebarItem {
  id: string;
  label: string;
  icon: LucideIcon;
  count?: number;
}

interface MaintenanceSidebarGroup {
  label: string;
  items: MaintenanceSidebarItem[];
}

// Desktop-only (md:) sidebar nav — same "one section active at a time"
// pattern as SettingsSidebar in settings.tsx (kept local/unexported here
// rather than shared, since the two pages' item shapes and icon sizes
// differ). Purely navigational — doesn't gate or duplicate any query.
function MaintenanceSidebar({
  groups,
  active,
  onSelect,
}: {
  groups: MaintenanceSidebarGroup[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="sticky top-20 self-start">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="mb-2 mt-4 text-xs uppercase tracking-wide text-muted-foreground">
            {group.label}
          </div>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm ${
                    isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.count !== undefined && (
                    <span className="shrink-0 text-xs tabular-nums opacity-70">{item.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

// The 7 headline KPI cards — extracted so both the mobile (always-visible,
// current position) and desktop (inside the sidebar's Events section)
// instances call the same JSX instead of duplicating it. `className`
// controls the grid itself (columns/gap/visibility), everything else is
// identical between the two call sites.
function MaintenanceKpiGrid({
  openMechanical,
  mtbfMechanicalHours,
  mttrMechanicalHours,
  openElectrical,
  mtbfElectricalHours,
  mttrElectricalHours,
  openPreventive,
  className,
}: {
  openMechanical: number;
  mtbfMechanicalHours: number | null;
  mttrMechanicalHours: number | null;
  openElectrical: number;
  mtbfElectricalHours: number | null;
  mttrElectricalHours: number | null;
  openPreventive: number;
  className: string;
}) {
  return (
    <div className={className}>
      <KpiCard
        label="Open Mechanical"
        value={String(openMechanical)}
        icon={Wrench}
        variant={openMechanical > 0 ? "danger" : "success"}
        className="p-3 md:p-5"
      />
      <KpiCard
        label="MTBF (Mechanical)"
        value={formatHours(mtbfMechanicalHours)}
        sub="Lifetime avg. time between failures"
        icon={Activity}
        variant="primary"
        className="p-3 md:p-5"
      />
      <KpiCard
        label="MTTR (Mechanical)"
        value={formatHours(mttrMechanicalHours)}
        sub="Lifetime avg. time to repair"
        icon={Timer}
        variant="primary"
        className="p-3 md:p-5"
      />
      <KpiCard
        label="Open Electrical"
        value={String(openElectrical)}
        icon={Zap}
        variant={openElectrical > 0 ? "danger" : "success"}
        className="p-3 md:p-5"
      />
      <KpiCard
        label="MTBF (Electrical)"
        value={formatHours(mtbfElectricalHours)}
        sub="Lifetime avg. time between failures"
        icon={Activity}
        variant="primary"
        className="p-3 md:p-5"
      />
      <KpiCard
        label="MTTR (Electrical)"
        value={formatHours(mttrElectricalHours)}
        sub="Lifetime avg. time to repair"
        icon={Timer}
        variant="primary"
        className="p-3 md:p-5"
      />
      <KpiCard
        label="Open Preventive"
        value={String(openPreventive)}
        sub="Scheduled maintenance, not counted in MTBF"
        icon={CalendarCheck}
        variant={openPreventive > 0 ? "danger" : "success"}
        className="p-3 md:p-5"
      />
    </div>
  );
}

// Filters + events list — extracted so the mobile Tabs instance and the
// desktop sidebar's Events section call the exact same component instead of
// duplicating this Card. The internal mobile-card-list / desktop-table
// split (unchanged from before) is redundant at each call site now (mobile
// callers only ever render at <768px, desktop callers only at ≥768px), but
// left in place rather than simplified — it's still correct, and touching
// it risks the actual table/card rendering logic, not just layout.
function EventsListCard({
  lines,
  lineId,
  setLineId,
  type,
  setType,
  status,
  setStatus,
  from,
  setFrom,
  to,
  setTo,
  isLoading,
  events,
  onSelectEvent,
}: {
  lines: { id: string; name: string }[];
  lineId: string;
  setLineId: (v: string) => void;
  type: MaintenanceType | "";
  setType: (v: MaintenanceType | "") => void;
  status: MaintenanceStatus | "";
  setStatus: (v: MaintenanceStatus | "") => void;
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
  isLoading: boolean;
  events: MaintenanceEvent[];
  onSelectEvent: (e: MaintenanceEvent) => void;
}) {
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  // Reset to page 1 whenever the actual filters change — not whenever
  // `events` itself changes, which would also fire on every background
  // refetch of the *same* filtered list (e.g. after editing an event
  // elsewhere) and needlessly kick the user back to page 1.
  const filterKey = `${lineId}|${type}|${status}|${from}|${to}`;
  useEffect(() => {
    setPage(1);
  }, [filterKey]);
  const totalPages = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  const pageRows = events.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Card>
      <CardHeader>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Select value={lineId || "all"} onValueChange={(v) => setLineId(v === "all" ? "" : v)}>
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
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Mobile: one card per event instead of the table below (which is
            desktop-only, hidden md:block, fully unchanged) — same
            events/isLoading data and the same durationMs/firstNote
            derivations as the table rows use. */}
        <div className="space-y-2 md:hidden">
          {isLoading && (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isLoading && events.length === 0 && (
            <div className="py-10 text-center">
              <Inbox className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                No maintenance events match this filter.
              </p>
            </div>
          )}
          {pageRows.map((e) => (
            <MobileEventCard key={e.id} event={e} onClick={() => onSelectEvent(e)} />
          ))}
        </div>

        <div className="hidden md:block">
          <Table stickyHeader>
            <TableHeader className="sticky top-16 z-20 bg-card shadow-sm">
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
              {isLoading && <TableSkeletonRows columns={10} />}
              {!isLoading && events.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    <Inbox className="mx-auto h-6 w-6 text-muted-foreground" />
                    <p className="mt-2">No maintenance events match this filter.</p>
                  </TableCell>
                </TableRow>
              )}
              {pageRows.map((e) => {
                const durationMs =
                  (e.resolved_at ? new Date(e.resolved_at).getTime() : Date.now()) -
                  new Date(e.started_at).getTime();
                const firstNote = e.maintenance_notes[0]?.note;
                return (
                  <TableRow
                    key={e.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => onSelectEvent(e)}
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
                        <Badge variant={typeBadgeVariant(e.type)}>{TYPE_LABELS[e.type]}</Badge>
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
                        ? e.resolved_by_profile?.display_name || e.resolved_by_profile?.email || "—"
                        : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {events.length > 0 && (
          <div className="mt-3 flex items-center justify-end gap-3 text-sm text-muted-foreground">
            <span>
              {events.length} event{events.length === 1 ? "" : "s"} · Page {page} of {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MaintenancePage() {
  const { data: lines } = useSuspenseQuery(linesQuery);
  const { role, user, profile } = useAuth();
  const canEdit = can(role, "maintenance.edit");
  const canDelete = can(role, "maintenance.delete");
  const qc = useQueryClient();

  const [lineId, setLineId] = useState("");
  const [activeSection, setActiveSection] = useState("events");
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
  // Feeds CreateEventDialog's Title-field autocomplete/near-match hint —
  // memoized so its reference is stable across renders that don't change
  // allEvents (CreateEventDialog's own useMemos key off this array).
  const allEventTitles = useMemo(() => allEvents.map((e) => e.title), [allEvents]);
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
  // Mobile-only "stays visible, never collapses" list — same open predicate
  // and plant-wide (allEvents, not the filtered `events`) scope as the
  // Open Mechanical/Electrical/Preventive KPI cards above, most-recent first.
  const openEvents = useMemo(
    () =>
      allEvents
        .filter((e) => e.status !== "resolved")
        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()),
    [allEvents],
  );

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

  // /maintenance's own "one downtime answer per stoppage" view of `events`
  // — collapses events sharing a stoppage_id into a single representative
  // event using the stoppage's own window (see collapseStoppageEvents in
  // queries.ts), so a multi-event stoppage counts once instead of once per
  // member below, in Total Downtime / Top Losses / the PDF report. MTBF/
  // MTTR/repeat-failure-rate below intentionally keep reading the raw
  // `events` array — they're a different question (event start/resolve
  // timing), not a sum, so member-level granularity there is correct as-is.
  const collapsedEvents = useMemo(
    () => collapseStoppageEvents(events, stoppages),
    [events, stoppages],
  );

  // Reliability Analytics section — every number below is derived from the
  // already-fetched `events` (same line/type/date filters as the table
  // above), never a new query, per the maintenance-manager brief this was
  // built against.
  const reliabilitySummary = useMemo(() => {
    const totalDowntimeMinutes = totalDowntimeMinutesOf(collapsedEvents);
    const repeatFailureRatePct = repeatFailureRateOf(events);
    const mtbfHours = localMtbfHours(events);
    const mttrHours = localMttrHours(events);
    const availabilityPct = availabilityPctOf(mtbfHours, mttrHours);
    return { totalDowntimeMinutes, repeatFailureRatePct, mtbfHours, mttrHours, availabilityPct };
  }, [events, collapsedEvents]);

  const titleAggregates = useMemo(() => aggregateByTitle(collapsedEvents), [collapsedEvents]);
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
    () => aggregateByTitle(collapsedEvents.filter((e) => e.type !== "preventive")),
    [collapsedEvents],
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
          <Button
            size="sm"
            className="shrink-0 bg-accent text-accent-foreground hover:bg-accent/90"
            onClick={() => setCreateOpen(true)}
          >
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

      {/* Mobile: stays in this always-visible position exactly as before.
          Desktop: this exact grid (same MaintenanceKpiGrid) moves inside the
          sidebar's Events section instead — see renderActiveSection below. */}
      <MaintenanceKpiGrid
        openMechanical={openMechanical}
        mtbfMechanicalHours={mtbfMechanicalHours}
        mttrMechanicalHours={mttrMechanicalHours}
        openElectrical={openElectrical}
        mtbfElectricalHours={mtbfElectricalHours}
        mttrElectricalHours={mttrElectricalHours}
        openPreventive={openPreventive}
        className="mb-6 grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-3 md:hidden"
      />

      {/* Mobile-only, always visible — never collapses, even while the
          section below is closed, so open faults stay in view. */}
      {openEvents.length > 0 && (
        <div className="mb-4 space-y-2 md:hidden">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Open events ({openEvents.length})
          </p>
          {openEvents.map((e) => (
            <MobileEventCard key={e.id} event={e} onClick={() => setSelectedEvent(e)} />
          ))}
        </div>
      )}

      {/* Mobile only below this point through MetricsTable — desktop (md:)
          uses the sidebar layout instead (renderActiveSection below), which
          covers the exact same content via the same extracted components. */}
      <div className="md:hidden">
        <MobileCollapsibleSection title="Maintenance events" count={events.length}>
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
              <EventsListCard
                lines={lines}
                lineId={lineId}
                setLineId={setLineId}
                type={type}
                setType={setType}
                status={status}
                setStatus={setStatus}
                from={from}
                setFrom={setFrom}
                to={to}
                setTo={setTo}
                isLoading={isLoading}
                events={events}
                onSelectEvent={setSelectedEvent}
              />
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
        </MobileCollapsibleSection>

        <div className="mt-6 md:mt-0">
          <MobileCollapsibleSection title="Reliability Analytics">
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
          </MobileCollapsibleSection>
        </div>

        <MetricsTable metrics={metrics} />
      </div>

      {/* Desktop (md: and up): sidebar layout — Overview (Events, Stoppages)
          and Analytics (Reliability, Top losses, MTBF / MTTR) groups, one
          section active at a time via the same extracted
          components/data/props the mobile view above uses. */}
      <div className="mt-6 hidden gap-6 md:grid md:grid-cols-[200px_1fr]">
        <MaintenanceSidebar
          groups={[
            {
              label: "Overview",
              items: [
                { id: "events", label: "Events", icon: List, count: events.length },
                {
                  id: "stoppages",
                  label: "Stoppages",
                  icon: Layers,
                  count: allStoppageRows.length,
                },
              ],
            },
            {
              label: "Analytics",
              items: [
                { id: "reliability", label: "Reliability", icon: ChartScatter },
                { id: "topLosses", label: "Top losses", icon: TrendingDown },
                { id: "mtbf", label: "MTBF / MTTR", icon: Activity },
              ],
            },
          ]}
          active={activeSection}
          onSelect={setActiveSection}
        />
        <div>
          {activeSection === "events" && (
            <div className="space-y-6">
              <MaintenanceKpiGrid
                openMechanical={openMechanical}
                mtbfMechanicalHours={mtbfMechanicalHours}
                mttrMechanicalHours={mttrMechanicalHours}
                openElectrical={openElectrical}
                mtbfElectricalHours={mtbfElectricalHours}
                mttrElectricalHours={mttrElectricalHours}
                openPreventive={openPreventive}
                className="grid grid-cols-3 gap-4"
              />
              <EventsListCard
                lines={lines}
                lineId={lineId}
                setLineId={setLineId}
                type={type}
                setType={setType}
                status={status}
                setStatus={setStatus}
                from={from}
                setFrom={setFrom}
                to={to}
                setTo={setTo}
                isLoading={isLoading}
                events={events}
                onSelectEvent={setSelectedEvent}
              />
            </div>
          )}
          {activeSection === "stoppages" && (
            <StoppagesSection
              rows={allStoppageRows}
              canDelete={canDelete}
              onView={setViewStoppageId}
              onDelete={handleDeleteStoppage}
            />
          )}
          {activeSection === "reliability" && (
            <ReliabilityHeadlineCards
              totalDowntimeMinutes={reliabilitySummary.totalDowntimeMinutes}
              repeatFailureRatePct={reliabilitySummary.repeatFailureRatePct}
              availabilityPct={reliabilitySummary.availabilityPct}
            />
          )}
          {activeSection === "topLosses" && (
            <TopLossesGrid
              topLossesByDowntime={topLossesByDowntime}
              topLossesByFrequency={topLossesByFrequency}
              meanDowntimePerFault={meanDowntimePerFault}
              chronicVsSporadic={chronicVsSporadic}
            />
          )}
          {activeSection === "mtbf" && (
            <div className="space-y-6">
              <MetricsTable metrics={metrics} />
              <ReliabilityByLineTable reliabilityByLine={reliabilityByLine} />
            </div>
          )}
        </div>
      </div>

      <CreateEventDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        lines={lines}
        onCreate={handleCreate}
        existingTitles={allEventTitles}
      />
      <StoppageDialog
        open={stoppageDialogOpen || viewStoppageId !== null}
        onOpenChange={(o) => !o && closeStoppageDialog()}
        initialStoppageId={viewStoppageId}
        lines={lines}
        canEdit={canEdit}
        userId={user?.id ?? null}
        onCreateEvent={insertEvent}
        existingTitles={allEventTitles}
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

// Local (filter-scoped) MTBF: gaps between started_at of consecutive events
// are only meaningful within the same line + type — pooling two different
// lines' (or two different failure types') timestamps together before
// taking gaps would produce a "time between failures" spanning unrelated
// equipment, same reasoning as maintenanceMetricsQuery in src/lib/queries.ts.
// So this groups by line_id + type first, then combines every group's gaps
// into one weighted average (equivalent to weightedAverage() above, weighted
// by each group's gap count) — deliberately not the lifetime per-line+type
// `metrics` query above, but still grouped the same way it is. Null when no
// group has 2+ events (no gap exists anywhere). Preventive events are
// excluded — scheduled maintenance isn't a "failure", so it shouldn't dilute
// time-between-failures math.
function localMtbfHours(events: MaintenanceEvent[]): number | null {
  const failureEvents = events.filter((e) => e.type !== "preventive");
  const groups = new Map<string, MaintenanceEvent[]>();
  for (const e of failureEvents) {
    const key = `${e.line_id ?? "unassigned"}::${e.type}`;
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }
  // Summing each group's total gap hours and dividing by the summed gap
  // count is mathematically the same as averaging the per-group MTBFs
  // weighted by their gap count (group_avg * group_weight === group_total),
  // just without computing each group's average as an intermediate step.
  let totalGapHours = 0;
  let totalGapCount = 0;
  for (const groupEvents of groups.values()) {
    if (groupEvents.length < 2) continue;
    const starts = groupEvents.map((e) => new Date(e.started_at).getTime()).sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++)
      totalGapHours += (starts[i] - starts[i - 1]) / 3_600_000;
    totalGapCount += starts.length - 1;
  }
  if (totalGapCount === 0) return null;
  return totalGapHours / totalGapCount;
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

// The 3 headline KPI cards — split out of the old monolithic
// ReliabilityAnalyticsSection so the desktop sidebar's "Reliability" section
// can render just these, independent of Top Losses / Reliability by Line.
function ReliabilityHeadlineCards({
  totalDowntimeMinutes,
  repeatFailureRatePct,
  availabilityPct,
}: {
  totalDowntimeMinutes: number;
  repeatFailureRatePct: number;
  availabilityPct: number | null;
}) {
  // Shared between the mobile MiniKpiCard row and the desktop KpiCard row
  // below, so both always agree on color/threshold.
  const repeatVariant =
    repeatFailureRatePct > 30 ? "danger" : repeatFailureRatePct > 10 ? "warning" : "success";
  const availabilityVariant =
    availabilityPct === null
      ? "default"
      : availabilityPct >= 90
        ? "success"
        : availabilityPct >= 75
          ? "warning"
          : "danger";
  const availabilityValue = availabilityPct === null ? "—" : `${availabilityPct.toFixed(1)}%`;

  return (
    <>
      {/* Mobile: compact 3-across cards — no icon (no room), and the
          downtime value is decimal hours ("39.4h") instead of
          formatDuration's "39h 21m", which was clipping/wrapping at this
          width. Desktop keeps the original KpiCard row untouched (hidden
          md:grid below). */}
      <div className="grid grid-cols-3 gap-1 md:hidden">
        <MiniKpiCard
          label="Maintenance events downtime"
          value={`${(totalDowntimeMinutes / 60).toFixed(1)}h`}
          sub="from /maintenance records only, filtered by page filters"
          variant="warning"
        />
        <MiniKpiCard
          label="Repeat Failure Rate"
          value={`${repeatFailureRatePct.toFixed(1)}%`}
          sub="Events whose title recurs ÷ total"
          variant={repeatVariant}
        />
        <MiniKpiCard
          label="Equipment Availability"
          value={availabilityValue}
          sub="Based on mechanical/electrical failures only (MTBF ÷ (MTBF + MTTR))"
          variant={availabilityVariant}
        />
      </div>

      <div className="hidden md:grid md:grid-cols-3 md:gap-4">
        <KpiCard
          label="Maintenance events downtime"
          value={formatDuration(totalDowntimeMinutes * 60_000)}
          sub="from /maintenance records only, filtered by page filters"
          icon={Timer}
          variant="warning"
        />
        <KpiCard
          label="Repeat Failure Rate"
          value={`${repeatFailureRatePct.toFixed(1)}%`}
          sub="Events whose title recurs ÷ total"
          icon={Repeat}
          variant={repeatVariant}
        />
        <KpiCard
          label="Equipment Availability"
          value={availabilityValue}
          sub="Based on mechanical/electrical failures only (MTBF ÷ (MTBF + MTTR))"
          icon={Gauge}
          variant={availabilityVariant}
        />
      </div>
    </>
  );
}

// The 2x2 loss-analysis grid — split out so the desktop sidebar's "Top
// losses" section can render just this, independent of the headline cards
// and the Reliability by Line table. Mean Downtime per Fault / Chronic vs
// Sporadic aren't named in the sidebar spec's 5 destinations, so they stay
// here alongside the 2 charts rather than being split further — this whole
// 2x2 grid was already one visual unit.
function TopLossesGrid({
  topLossesByDowntime,
  topLossesByFrequency,
  meanDowntimePerFault,
  chronicVsSporadic,
}: {
  topLossesByDowntime: TitleAggregate[];
  topLossesByFrequency: TitleAggregate[];
  meanDowntimePerFault: (TitleAggregate & { meanMinutes: number })[];
  chronicVsSporadic: (TitleAggregate & { meanMinutes: number; chronic: boolean })[];
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
  );
}

// Split out so the desktop sidebar's "MTBF / MTTR" section can render this
// alongside MetricsTable, independent of the headline cards / Top Losses.
function ReliabilityByLineTable({ reliabilityByLine }: { reliabilityByLine: LineReliability[] }) {
  return (
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
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
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
  );
}

// Thin composer used only by the mobile collapsible section — same 8 props
// as the old monolithic component, so that call site needed zero changes.
// Desktop calls the 3 pieces above individually instead, one per sidebar
// section.
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
  return (
    <div id="reliability-analytics" className="mt-6 space-y-4 scroll-mt-4">
      <div>
        <h2 className="text-lg font-semibold">Reliability Analytics</h2>
        <p className="text-sm text-muted-foreground">
          Computed from the events matching the filters above.
        </p>
      </div>
      <ReliabilityHeadlineCards
        totalDowntimeMinutes={totalDowntimeMinutes}
        repeatFailureRatePct={repeatFailureRatePct}
        availabilityPct={availabilityPct}
      />
      <TopLossesGrid
        topLossesByDowntime={topLossesByDowntime}
        topLossesByFrequency={topLossesByFrequency}
        meanDowntimePerFault={meanDowntimePerFault}
        chronicVsSporadic={chronicVsSporadic}
      />
      <ReliabilityByLineTable reliabilityByLine={reliabilityByLine} />
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

  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  // Reset to page 1 whenever the row set actually shrinks/grows past the
  // current page (e.g. an orphaned stoppage on this page gets deleted) —
  // not on every render, so paging forward/back itself doesn't get undone.
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
          <Table stickyHeader>
            <TableHeader className="sticky top-16 z-20 bg-card shadow-sm">
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
                    <Inbox className="mx-auto h-6 w-6 text-muted-foreground" />
                    <p className="mt-2">No stoppages recorded yet.</p>
                  </TableCell>
                </TableRow>
              )}
              {pageRows.map((s) => {
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

          {rows.length > 0 && (
            <div className="mt-3 flex items-center justify-end gap-3 text-sm text-muted-foreground">
              <span>
                {rows.length} stoppage{rows.length === 1 ? "" : "s"} · Page {page} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          )}
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

// Used by CreateEventDialog's Title-field autocomplete/near-match hint to
// decide whether two titles are "the same" ignoring case and incidental
// whitespace differences.
function normalizeTitle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function CreateEventDialog({
  open,
  onOpenChange,
  lines,
  stoppage,
  onCreate,
  existingTitles = [],
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
  // Titles of every existing maintenance event (any line), plant-wide — used
  // to drive the Title field's autocomplete dropdown and its "Did you mean…"
  // near-match hint below. Passed down from MaintenancePage's already-loaded
  // allEvents so this dialog doesn't run its own query.
  existingTitles?: string[];
}) {
  const [lineId, setLineId] = useState(stoppage?.lineId ?? "");
  const [type, setType] = useState<MaintenanceType>("mechanical");
  const [title, setTitle] = useState("");
  const [titleFocused, setTitleFocused] = useState(false);
  const [description, setDescription] = useState("");
  const [startedAt, setStartedAt] = useState(() => toDatetimeLocalValue(new Date()));
  const [severityLabel, setSeverityLabel] = useState("");
  const [technicianIds, setTechnicianIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const { data: technicians = [] } = useQuery(techniciansQuery);
  const activeTechnicians = technicians.filter((t) => t.is_active);

  // Deduplicated by normalized form (lowercase + trim + collapsed
  // whitespace), keeping the first-seen literal spelling — existingTitles
  // comes from allEvents which is ordered newest-first, so that's the most
  // recent spelling of each title.
  const uniqueTitles = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of existingTitles) {
      const t = raw.trim();
      if (!t) continue;
      const key = normalizeTitle(t);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }, [existingTitles]);

  const normalizedTitle = normalizeTitle(title);

  // Dropdown suggestions: other titles containing what's typed so far.
  // Excludes anything that already normalizes the same as the current
  // input — that case is the "Did you mean…" hint below instead.
  const titleSuggestions = useMemo(() => {
    if (!normalizedTitle) return [];
    return uniqueTitles
      .filter((t) => {
        const key = normalizeTitle(t);
        return key !== normalizedTitle && key.includes(normalizedTitle);
      })
      .slice(0, 6);
  }, [uniqueTitles, normalizedTitle]);

  // A near-match: same title once normalized, but not literally identical
  // (different case/spacing) — e.g. "conveyor belt slip" vs "Conveyor  Belt
  // Slip". Surfaced separately from titleSuggestions so typos of an existing
  // title get corrected rather than just listed alongside partial matches.
  const titleNearMatch = useMemo(() => {
    if (!normalizedTitle) return null;
    const match = uniqueTitles.find((t) => normalizeTitle(t) === normalizedTitle);
    return match && match !== title ? match : null;
  }, [uniqueTitles, normalizedTitle, title]);

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
          <div className="relative">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={() => setTitleFocused(true)}
              onBlur={() => setTitleFocused(false)}
              autoComplete="off"
              required
            />
            {titleFocused && titleSuggestions.length > 0 && (
              <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
                {titleSuggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-accent"
                      // Keeps the Title input focused on click so this menu
                      // doesn't unmount (via the blur handler above) before
                      // the click itself registers.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setTitle(s);
                        setTitleFocused(false);
                      }}
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {titleNearMatch && (
              <p className="mt-1 text-xs text-muted-foreground">
                Did you mean{" "}
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-2"
                  onClick={() => setTitle(titleNearMatch)}
                >
                  {titleNearMatch}
                </button>
                ?
              </p>
            )}
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
  existingTitles = [],
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
  // Forwarded to the "Add Event" CreateEventDialog below for its Title
  // autocomplete — see existingTitles on CreateEventDialog.
  existingTitles?: string[];
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
          existingTitles={existingTitles}
        />
      )}
    </>
  );
}
