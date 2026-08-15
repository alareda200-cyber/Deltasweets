import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import {
  maintenanceEventsQuery,
  type EntryDowntime,
  type Department,
  type DepartmentCategory,
  type DowntimeType,
  type SeverityLevel,
  type MaintenanceEvent,
  type DailyEntry,
} from "@/lib/queries";
import { KpiCard } from "./KpiCard";
import { EventDetailDialog } from "./EventDetailDialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fmt, iso } from "@/lib/date-utils";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import {
  TYPE_LABELS,
  STATUS_LABELS,
  typeBadgeVariant,
  statusBadgeVariant,
  formatDuration,
} from "@/lib/maintenance-format";
import { Wrench, AlertOctagon, Activity, TimerOff } from "lucide-react";

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
export function MaintenanceDowntimeCard({
  downtimes,
  departments,
  departmentCategories,
  downtimeTypes,
  severityLevels,
  categoryName = "Maintenance",
  entries,
  maintenanceEvents,
}: Props) {
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
  const openEvents = allMaintenanceEvents.filter(
    (e) => e.status === "open" || e.status === "in_progress",
  );
  const [selectedEvent, setSelectedEvent] = useState<MaintenanceEvent | null>(null);
  // Mobile-only "Show all N causes" toggle for the horizontal-bar list below
  // the donut (see the md:hidden block) — collapsed to the top 4 by default.
  const [showAllCauses, setShowAllCauses] = useState(false);

  // entries is ordered by entry_date ascending (see entriesQuery), so the
  // last element is the most recent day — same "last day" the Dashboard's
  // other sections (Making/Packing/Downtime) key off of.
  const lastEntryDate = entries.length > 0 ? entries[entries.length - 1].entry_date : null;
  // entry_date is a plain local calendar date, but started_at is a UTC ISO
  // timestamp — comparing via .slice(0, 10) compares against the UTC
  // calendar date instead, which misclassifies events near local midnight
  // in any non-UTC timezone. iso() converts to the local calendar date
  // first, matching how entry_date itself is produced (see date-utils.ts).
  const lastDayMaintenanceEvents = lastEntryDate
    ? maintenanceEvents.filter((e) => iso(new Date(e.started_at)) === lastEntryDate)
    : [];
  const lastDayMaintenanceMinutes = lastDayMaintenanceEvents.reduce(
    (s, e) => s + eventDurationMinutes(e),
    0,
  );

  function invalidateMaintenanceEvents() {
    qc.invalidateQueries({ queryKey: ["maintenance-events"] });
    qc.invalidateQueries({ queryKey: ["maintenance-metrics"] });
    // EventDetailDialog (opened below) resyncs the parent stoppage row
    // itself when a member event changes — these three cover every query
    // key shape a stoppage can be cached under (see
    // src/routes/maintenance.tsx's invalidateAll for the same list).
    qc.invalidateQueries({ queryKey: ["maintenance-stoppages"] });
    qc.invalidateQueries({ queryKey: ["maintenance-stoppage"] });
    qc.invalidateQueries({ queryKey: ["maintenance-stoppage-events"] });
  }

  const category = departmentCategories.find(
    (c) => c.name.trim().toLowerCase() === categoryName.trim().toLowerCase(),
  );
  const categoryDepartmentIds = new Set(
    departments.filter((d) => d.department_category_id === category?.id).map((d) => d.id),
  );

  const scoped = category
    ? downtimes.filter(
        (d) =>
          d.source === "maintenance" ||
          (d.department_id && categoryDepartmentIds.has(d.department_id)),
      )
    : [];

  function nameOf<T extends { id: string; name: string }>(list: T[], id: string | null): string {
    return (id && list.find((x) => x.id === id)?.name) || "Unclassified";
  }

  const totalMinutes = scoped.reduce((s, d) => s + Number(d.minutes), 0);
  // "Events" is a failure-count/reliability stat (same framing as the
  // Dashboard's MaintenanceEventsCard and /maintenance page's MTBF/MTTR,
  // both of which already exclude preventive — see maintenanceMetricsQuery
  // and localMtbfHours/localMttrHours in src/routes/maintenance.tsx), so a
  // scheduled preventive visit shouldn't inflate it the way it legitimately
  // does inflate totalMinutes/criticalMinutes/the chart below (preventive
  // still stops the line, so it still counts as real downtime — see
  // maintenanceEventsAsDowntimes). pareto_reason_name is only set on
  // source: "maintenance" rows and is exactly "Preventive Maintenance" for
  // preventive-type events (see typeMeta), so this can't accidentally
  // exclude a real entry_downtimes row.
  const eventCount = scoped.filter((d) => d.pareto_reason_name !== "Preventive Maintenance").length;
  const criticalMinutes = scoped
    .filter(
      (d) => severityLevels.find((s) => s.id === d.severity_id)?.name.toLowerCase() === "critical",
    )
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
  const allReasons = Array.from(byReason.values()).sort((a, b) => b.minutes - a.minutes);
  const sortedReasons = allReasons.slice(0, 12);
  const chartData = sortedReasons.map((r) => ({
    name: r.reason.length > 18 ? `${r.reason.slice(0, 18)}…` : r.reason,
    fullName: r.reason,
    minutes: r.minutes,
    // % of totalMinutes (the "Maintenance downtime (all sources)" KPI above)
    // rather than % of just the top-12 shown — keeps this chart's
    // percentages from silently re-normalizing to 100% when more than 12
    // distinct reasons exist, so they stay comparable to that KPI.
    pct: totalMinutes > 0 ? Math.round((r.minutes / totalMinutes) * 1000) / 10 : 0,
  }));

  // Mobile-only donut split (see the md:hidden block below) — same `scoped`
  // rows as everything above, bucketed into the 4 groups a maintenance
  // manager actually thinks in: mechanical/electrical/preventive failures
  // (from maintenance_events, distinguished via pareto_reason_name — see
  // maintenanceEventsAsDowntimes) vs. downtime logged directly on the daily
  // entry form under a Maintenance-category department (source !==
  // "maintenance", the non-event "Production stoppages" bucket).
  const donutBuckets = [
    {
      key: "mechanical",
      label: "Mechanical",
      color: "var(--color-destructive)",
      minutes: scoped
        .filter((d) => d.pareto_reason_name === "Mechanical Maintenance")
        .reduce((s, d) => s + Number(d.minutes), 0),
    },
    {
      key: "electrical",
      label: "Electrical",
      color: "var(--color-primary)",
      minutes: scoped
        .filter((d) => d.pareto_reason_name === "Electrical Maintenance")
        .reduce((s, d) => s + Number(d.minutes), 0),
    },
    {
      key: "preventive",
      label: "Preventive",
      color: "var(--color-warning)",
      minutes: scoped
        .filter((d) => d.pareto_reason_name === "Preventive Maintenance")
        .reduce((s, d) => s + Number(d.minutes), 0),
    },
    {
      key: "production",
      label: "Production stoppages",
      color: "var(--color-accent)",
      minutes: scoped
        .filter((d) => d.source !== "maintenance")
        .reduce((s, d) => s + Number(d.minutes), 0),
    },
  ];
  const donutCircumference = 2 * Math.PI * 15.9;
  let donutCumulative = 0;
  const donutSegments = donutBuckets
    .filter((b) => b.minutes > 0)
    .map((b) => {
      const len = totalMinutes > 0 ? (b.minutes / totalMinutes) * donutCircumference : 0;
      const seg = { ...b, len, offset: -donutCumulative, pct: totalMinutes > 0 ? Math.round((b.minutes / totalMinutes) * 100) : 0 };
      donutCumulative += len;
      return seg;
    });

  const rankedReasons = (() => {
    const byReason = new Map<
      string,
      { reason: string; department: string; severity: string; type: string; minutes: number }
    >();
    for (const d of scoped) {
      const key = d.reason_name;
      const cur = byReason.get(key);
      if (cur) cur.minutes += Number(d.minutes);
      else
        byReason.set(key, {
          reason: d.reason_name,
          department: nameOf(departments, d.department_id),
          severity: d.severity_label ?? nameOf(severityLevels, d.severity_id),
          type: nameOf(downtimeTypes, d.downtime_type_id),
          minutes: Number(d.minutes),
        });
    }
    return Array.from(byReason.values())
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10);
  })();

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <header className="mb-6">
        <h2 className="text-xl font-bold tracking-tight md:text-2xl">Maintenance Dashboard</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every Department under the "{categoryName}" category, resolved automatically — no
          hardcoded department list.
        </p>
      </header>

      {!category ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No Department Category named "{categoryName}" exists yet — create it in Settings.
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3">
            <KpiCard
              label="Maintenance downtime (all sources)"
              mobileLabel="Downtime"
              mobileIcon={TimerOff}
              value={fmt(totalMinutes)}
              sub="maintenance events + daily entry"
              icon={Wrench}
              variant="primary"
              className="p-3 md:p-5"
            />
            <KpiCard
              label="Events"
              value={String(eventCount)}
              icon={AlertOctagon}
              variant="default"
              className="p-3 md:p-5"
            />
            <KpiCard
              label="Critical Minutes"
              value={fmt(criticalMinutes)}
              icon={Activity}
              variant={criticalMinutes > 0 ? "danger" : "success"}
              className="p-3 md:p-5"
            />
          </div>

          <div className="mb-6">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {lastEntryDate ? `Last Day · ${lastEntryDate}` : "Last Day · (no entries)"}
            </p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-2 md:gap-3">
              <KpiCard
                label="Maintenance Downtime (min)"
                mobileLabel="Downtime (min)"
                value={fmt(Math.round(lastDayMaintenanceMinutes))}
                variant={lastDayMaintenanceMinutes > 0 ? "warning" : "default"}
                className="p-3 md:p-5"
              />
              <KpiCard
                label="Maintenance Events"
                value={String(lastDayMaintenanceEvents.length)}
                className="p-3 md:p-5"
              />
            </div>
            {lastDayMaintenanceEvents.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {lastDayMaintenanceEvents.map((e) => (
                  <span
                    key={e.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs"
                  >
                    <span className="font-medium">{e.title}</span>
                    <span className="text-muted-foreground">· {TYPE_LABELS[e.type]}</span>
                    <span className="font-semibold tabular-nums">
                      {fmt(Math.round(eventDurationMinutes(e)))}m
                    </span>
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
            <div className="mb-6">
              {allReasons.length > 12 && (
                <p className="mb-2 text-xs text-muted-foreground">
                  Showing top 12 of {allReasons.length} causes — bar % is share of "all sources"
                  downtime.
                </p>
              )}

              {/* Mobile: donut split by type (Mechanical/Electrical/Preventive/
                  Production stoppages) + a compact horizontal-bar top-4 causes
                  list, instead of the angled 12-label Pareto (which stays
                  desktop-only, unchanged, below). */}
              <div className="md:hidden">
                <div className="flex items-center gap-4">
                  <div className="relative h-24 w-24 shrink-0">
                    <svg viewBox="0 0 42 42" className="h-24 w-24 -rotate-90">
                      <circle
                        cx="21"
                        cy="21"
                        r="15.9"
                        fill="none"
                        stroke="var(--color-border)"
                        strokeWidth="5"
                      />
                      {donutSegments.map((s) => (
                        <circle
                          key={s.key}
                          cx="21"
                          cy="21"
                          r="15.9"
                          fill="none"
                          stroke={s.color}
                          strokeWidth="5"
                          strokeDasharray={`${s.len} ${donutCircumference - s.len}`}
                          strokeDashoffset={s.offset}
                        />
                      ))}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-lg font-bold tabular-nums leading-none">
                        {fmt(totalMinutes)}
                      </span>
                      <span className="mt-0.5 text-[9px] text-muted-foreground">min</span>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    {donutBuckets.map((b) => (
                      <div key={b.key} className="flex items-center gap-1.5 text-xs">
                        <span
                          className="h-[7px] w-[7px] shrink-0 rounded-sm"
                          style={{ background: b.color }}
                        />
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {b.label}
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums">
                          {totalMinutes > 0 ? Math.round((b.minutes / totalMinutes) * 100) : 0}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {(showAllCauses ? chartData : chartData.slice(0, 4)).map((d, i) => {
                    const maxMinutes = Math.max(...chartData.map((x) => x.minutes), 1);
                    const hue = 25 + i * 20;
                    return (
                      <div key={d.fullName} className="flex items-center gap-2">
                        <span className="w-[78px] shrink-0 truncate text-xs text-muted-foreground">
                          {d.fullName}
                        </span>
                        <div className="h-[13px] flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(4, (d.minutes / maxMinutes) * 100)}%`,
                              background: `linear-gradient(to right, oklch(0.75 0.18 ${hue}), oklch(0.55 0.18 ${hue}))`,
                            }}
                          />
                        </div>
                        <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums">
                          {fmt(Math.round(d.minutes))}m
                        </span>
                      </div>
                    );
                  })}
                </div>

                {chartData.length > 4 && (
                  <button
                    type="button"
                    onClick={() => setShowAllCauses((v) => !v)}
                    className="mt-3 text-xs font-medium text-primary"
                  >
                    {showAllCauses ? "Show fewer causes ↑" : `Show all ${allReasons.length} causes ↓`}
                  </button>
                )}
              </div>

              <div className="hidden h-80 w-full md:block">
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
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="name"
                      interval={0}
                      angle={-30}
                      textAnchor="end"
                      height={70}
                      tick={{ fontSize: 11, fill: "var(--color-foreground)" }}
                    />
                    <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-popover)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value: number, _name, props): [string, string] => [
                        `${fmt(value)} min · ${props.payload.pct}%`,
                        "Downtime",
                      ]}
                      labelFormatter={(_l, payload) => payload?.[0]?.payload?.fullName ?? ""}
                    />
                    <Bar
                      dataKey="minutes"
                      radius={[6, 6, 0, 0]}
                      stroke="rgba(0,0,0,0.15)"
                      strokeWidth={1}
                    >
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={`url(#maint-${i})`} />
                      ))}
                      <LabelList
                        dataKey="pct"
                        position="top"
                        formatter={(v: number) => `${v}%`}
                        style={{ fontSize: 11, fill: "var(--color-foreground)", fontWeight: 600 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {rankedReasons.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Top Reasons — Department · Severity · Type
              </p>
              <div className="space-y-1.5">
                {rankedReasons.map((r) => (
                  <div
                    key={r.reason}
                    className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">{r.reason}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.department} · {r.severity} · {r.type}
                      </p>
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
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Open Maintenance Events
          </p>
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
                      <TableRow
                        key={e.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedEvent(e)}
                      >
                        <TableCell className="text-sm font-medium">{e.title}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                          {e.production_lines?.name ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={typeBadgeVariant(e.type)}>{TYPE_LABELS[e.type]}</Badge>
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
