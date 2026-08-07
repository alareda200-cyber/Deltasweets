import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { maintenanceEventsQuery, type EntryDowntime, type Department, type DepartmentCategory, type DowntimeType, type SeverityLevel, type MaintenanceEvent, type DailyEntry } from "@/lib/queries";
import { KpiCard } from "./KpiCard";
import { EventDetailDialog } from "./EventDetailDialog";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fmt } from "@/lib/date-utils";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { TYPE_LABELS, STATUS_LABELS, typeBadgeVariant, statusBadgeVariant, formatDuration } from "@/lib/maintenance-format";
import { Wrench, AlertOctagon, Activity } from "lucide-react";

interface Props {
  downtimes: EntryDowntime[];
  departments: Department[];
  departmentCategories: DepartmentCategory[];
  downtimeTypes: DowntimeType[];
  severityLevels: SeverityLevel[];
  categoryName?: string; // which Department Category this card represents; defaults to "Maintenance"
  // entries + maintenanceEvents (same arrays the Dashboard already fetches
  // for DowntimeSection/the Pareto chart — no new query) back the "Last
  // Day" block below: maintenanceEvents whose started_at falls on
  // entries' most recent entry_date.
  entries: DailyEntry[];
  maintenanceEvents: MaintenanceEvent[];
}

// Matches the duration math used elsewhere for maintenance_events (see
// src/routes/maintenance.tsx and src/lib/maintenance-report.tsx): resolved
// events use resolved_at, still-open events run the clock to now.
function eventDurationMinutes(e: MaintenanceEvent): number {
  const startedMs = new Date(e.started_at).getTime();
  const endMs = e.resolved_at ? new Date(e.resolved_at).getTime() : Date.now();
  return Math.max(0, (endMs - startedMs) / 60_000);
}

// This card is driven by master data — it never hardcodes a department name
// (Mechanical/Electrical/etc) for entry_downtimes rows. It resolves each
// downtime's department via the classification already joined in
// entryDowntimesQuery, then keeps only the ones whose department belongs to
// the requested Department Category. Adding a new department (e.g.
// "Automation") under the "Maintenance" category makes it appear here
// automatically — no code change required.
// The one exception: rows synthesized from maintenance_events (source ===
// "maintenance", see maintenanceEventsAsDowntimes) have no department_id —
// there's no per-event department to classify them by — so they're always
// included here rather than filtered by category membership.
export function MaintenanceDowntimeCard({ downtimes, departments, departmentCategories, downtimeTypes, severityLevels, categoryName = "Maintenance", entries, maintenanceEvents }: Props) {
  // "Open Maintenance Events" below is a separate feature (the
  // maintenance_events table) from the downtime-by-department data above —
  // gated on its own permission since this card is embedded both on the
  // Dashboard (gated by dashboard.viewMaintenanceCard, which viewer/quality
  // also have) and on /maintenance (gated by maintenance.view). Only
  // maintenance.view holders should see live open events either place.
  const { role, user } = useAuth();
  const canSeeOpenEvents = can(role, "maintenance.view");
  const canEdit = can(role, "maintenance.edit");
  const qc = useQueryClient();
  const { data: allMaintenanceEvents = [] } = useQuery({
    ...maintenanceEventsQuery(null, null, null, null, null),
    enabled: canSeeOpenEvents,
  });
  const openEvents = allMaintenanceEvents.filter((e) => e.status === "open" || e.status === "in_progress");
  const [selectedEvent, setSelectedEvent] = useState<MaintenanceEvent | null>(null);

  // entries is ordered by entry_date ascending (see entriesQuery), so the
  // last element is the most recent day — same "last day" the Dashboard's
  // other sections (Making/Packing/Downtime) key off of.
  const lastEntryDate = entries.length > 0 ? entries[entries.length - 1].entry_date : null;
  const lastDayMaintenanceEvents = lastEntryDate
    ? maintenanceEvents.filter((e) => e.started_at.slice(0, 10) === lastEntryDate)
    : [];
  const lastDayMaintenanceMinutes = lastDayMaintenanceEvents.reduce((s, e) => s + eventDurationMinutes(e), 0);

  function invalidateMaintenanceEvents() {
    qc.invalidateQueries({ queryKey: ["maintenance-events"] });
    qc.invalidateQueries({ queryKey: ["maintenance-metrics"] });
  }

  const category = departmentCategories.find((c) => c.name.trim().toLowerCase() === categoryName.trim().toLowerCase());
  const categoryDepartmentIds = new Set(
    departments.filter((d) => d.department_category_id === category?.id).map((d) => d.id),
  );

  const scoped = category
    ? downtimes.filter(
        (d) => d.source === "maintenance" || (d.department_id && categoryDepartmentIds.has(d.department_id)),
      )
    : [];

  function nameOf<T extends { id: string; name: string }>(list: T[], id: string | null): string {
    return (id && list.find((x) => x.id === id)?.name) || "Unclassified";
  }

  const totalMinutes = scoped.reduce((s, d) => s + Number(d.minutes), 0);
  const eventCount = scoped.length;
  const criticalMinutes = scoped
    .filter((d) => severityLevels.find((s) => s.id === d.severity_id)?.name.toLowerCase() === "critical")
    .reduce((s, d) => s + Number(d.minutes), 0);

  // By reason/event title, not by department — a single "Mechanical
  // Maintenance" bar swallowing every individual fault was the bug; this
  // now groups the same way the Top Reasons list below already does, so
  // the chart and the list agree on what a "reason" is.
  const byReason = new Map<string, { reason: string; minutes: number }>();
  for (const d of scoped) {
    const cur = byReason.get(d.reason_name);
    if (cur) cur.minutes += Number(d.minutes);
    else byReason.set(d.reason_name, { reason: d.reason_name, minutes: Number(d.minutes) });
  }
  const sortedReasons = Array.from(byReason.values()).sort((a, b) => b.minutes - a.minutes).slice(0, 12);
  const chartTotal = sortedReasons.reduce((s, r) => s + r.minutes, 0);
  const chartData = sortedReasons.map((r) => ({
    name: r.reason.length > 18 ? `${r.reason.slice(0, 18)}…` : r.reason,
    fullName: r.reason,
    minutes: r.minutes,
    pct: chartTotal > 0 ? Math.round((r.minutes / chartTotal) * 1000) / 10 : 0,
  }));

  const rankedReasons = (() => {
    const byReason = new Map<string, { reason: string; department: string; severity: string; type: string; minutes: number }>();
    for (const d of scoped) {
      const key = d.reason_name;
      const cur = byReason.get(key);
      if (cur) cur.minutes += Number(d.minutes);
      else byReason.set(key, {
        reason: d.reason_name,
        department: nameOf(departments, d.department_id),
        severity: d.severity_label ?? nameOf(severityLevels, d.severity_id),
        type: nameOf(downtimeTypes, d.downtime_type_id),
        minutes: Number(d.minutes),
      });
    }
    return Array.from(byReason.values()).sort((a, b) => b.minutes - a.minutes).slice(0, 10);
  })();

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <header className="mb-6">
        <h2 className="text-xl font-bold tracking-tight md:text-2xl">Maintenance Dashboard</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every Department under the "{categoryName}" category, resolved automatically — no hardcoded department list.
        </p>
      </header>

      {!category ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No Department Category named "{categoryName}" exists yet — create it in Settings.
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
            <KpiCard
              label="Maintenance downtime (all sources)"
              value={fmt(totalMinutes)}
              sub="maintenance events + daily entry"
              icon={Wrench}
              variant="primary"
            />
            <KpiCard label="Events" value={String(eventCount)} icon={AlertOctagon} variant="default" />
            <KpiCard label="Critical Minutes" value={fmt(criticalMinutes)} icon={Activity} variant={criticalMinutes > 0 ? "danger" : "success"} />
          </div>

          <div className="mb-6">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {lastEntryDate ? `Last Day · ${lastEntryDate}` : "Last Day · (no entries)"}
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <KpiCard
                label="Maintenance Downtime (min)"
                value={fmt(Math.round(lastDayMaintenanceMinutes))}
                variant={lastDayMaintenanceMinutes > 0 ? "warning" : "default"}
              />
              <KpiCard label="Maintenance Events" value={String(lastDayMaintenanceEvents.length)} />
            </div>
            {lastDayMaintenanceEvents.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {lastDayMaintenanceEvents.map((e) => (
                  <span key={e.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs">
                    <span className="font-medium">{e.title}</span>
                    <span className="text-muted-foreground">· {TYPE_LABELS[e.type]}</span>
                    <span className="font-semibold tabular-nums">{fmt(Math.round(eventDurationMinutes(e)))}m</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {chartData.length === 0 ? (
            <div className="mb-6 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No downtime classified under "{categoryName}" in this period.
            </div>
          ) : (
            <div className="mb-6 h-[240px] w-full md:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 24, right: 20, left: 0, bottom: 60 }}>
                  <defs>
                    {chartData.map((_, i) => {
                      const hue = 25 + i * 20;
                      return (
                        <linearGradient key={i} id={`maint-${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={`oklch(0.75 0.18 ${hue})`} />
                          <stop offset="50%" stopColor={`oklch(0.6 0.18 ${hue})`} />
                          <stop offset="100%" stopColor={`oklch(0.4 0.16 ${hue})`} />
                        </linearGradient>
                      );
                    })}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="name" interval={0} angle={-30} textAnchor="end" height={70} tick={{ fontSize: 11, fill: "var(--color-foreground)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                  <Tooltip
                    contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number, _name, props): [string, string] => [`${fmt(value)} min · ${props.payload.pct}%`, "Downtime"]}
                    labelFormatter={(_l, payload) => payload?.[0]?.payload?.fullName ?? ""}
                  />
                  <Bar dataKey="minutes" radius={[6, 6, 0, 0]} stroke="rgba(0,0,0,0.15)" strokeWidth={1}>
                    {chartData.map((_, i) => <Cell key={i} fill={`url(#maint-${i})`} />)}
                    <LabelList dataKey="pct" position="top" formatter={(v: number) => `${v}%`} style={{ fontSize: 11, fill: "var(--color-foreground)", fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {rankedReasons.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Top Reasons — Department · Severity · Type</p>
              <div className="space-y-1.5">
                {rankedReasons.map((r) => (
                  <div key={r.reason} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                    <div>
                      <p className="font-medium">{r.reason}</p>
                      <p className="text-xs text-muted-foreground">{r.department} · {r.severity} · {r.type}</p>
                    </div>
                    <span className="font-semibold tabular-nums">{fmt(r.minutes)}m</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {canSeeOpenEvents && (
        <div className="mt-6 border-t border-border pt-6">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Open Maintenance Events</p>
          {openEvents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No open maintenance events
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead className="hidden md:table-cell">Line</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Started</TableHead>
                    <TableHead>Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openEvents.map((e) => {
                    const durationMs = Date.now() - new Date(e.started_at).getTime();
                    return (
                      <TableRow key={e.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedEvent(e)}>
                        <TableCell className="text-sm font-medium">{e.title}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{e.production_lines?.name ?? "—"}</TableCell>
                        <TableCell><Badge variant={typeBadgeVariant(e.type)}>{TYPE_LABELS[e.type]}</Badge></TableCell>
                        <TableCell><Badge variant={statusBadgeVariant(e.status)}>{STATUS_LABELS[e.status]}</Badge></TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{new Date(e.started_at).toLocaleString()}</TableCell>
                        <TableCell className="text-sm tabular-nums">{formatDuration(durationMs)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <EventDetailDialog
            event={selectedEvent}
            canEdit={canEdit}
            userId={user?.id ?? null}
            onOpenChange={(o) => !o && setSelectedEvent(null)}
            onChanged={invalidateMaintenanceEvents}
          />
        </div>
      )}
    </section>
  );
}
