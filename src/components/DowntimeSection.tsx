import { useState } from "react";
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
import type { EntryDowntime, DailyEntry } from "@/lib/queries";
import { KpiCard } from "./KpiCard";
import { fmt } from "@/lib/date-utils";
import { Clock, AlertOctagon, Activity } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

interface Props {
  entries: DailyEntry[];
  downtimes: EntryDowntime[];
}

export function DowntimeSection({ entries, downtimes }: Props) {
  const isMobile = useIsMobile();
  // Mobile-only "Show all N causes" toggle for the horizontal-bar list below
  // (see the md:hidden block) — collapsed to the top 6 by default.
  const [showAllCauses, setShowAllCauses] = useState(false);
  const totalAvail = entries.reduce((s, e) => s + Number(e.available_min), 0);
  // Summed from the same combined downtimes array (entry_downtimes +
  // maintenance_events, see maintenanceEventsAsDowntimes) that feeds the
  // Pareto chart below — not from entries[].downtime_min, which is a
  // separately-entered daily-entry field that never picks up maintenance
  // events logged from /maintenance. Two numbers in the same section
  // disagreeing about the same total was the bug; this is the single
  // source of truth for both.
  const totalDown = downtimes.reduce((s, d) => s + Number(d.minutes), 0);
  const lossPct = totalAvail > 0 ? (totalDown / totalAvail) * 100 : 0;

  // Last day
  const last = entries[entries.length - 1];
  const lastIds = new Set(
    entries.filter((e) => e.entry_date === last?.entry_date).map((e) => e.id),
  );
  const dayAvail = last
    ? entries
        .filter((e) => e.entry_date === last.entry_date)
        .reduce((s, e) => s + Number(e.available_min), 0)
    : 0;
  // Maintenance-derived rows (source: "maintenance") don't have a real
  // daily_entries id in entry_id — it's the maintenance_events row's own id
  // (see maintenanceEventsAsDowntimes) — so lastIds.has(d.entry_id) never
  // matches them and they'd silently drop out of "Last Day" even though
  // totalDown above correctly includes them. Match those via their own
  // event_date instead; real entry rows keep matching through lastIds.
  const dayDowntimes = downtimes.filter((d) =>
    d.source === "maintenance" ? d.event_date === last?.entry_date : lastIds.has(d.entry_id),
  );
  // Same combined-array reasoning as totalDown above — not entries[].downtime_min,
  // which never picks up maintenance_events, so Last Day would silently
  // under-count relative to the MTD numbers right above it.
  const dayDown = dayDowntimes.reduce((s, d) => s + Number(d.minutes), 0);
  const dayLossPct = dayAvail > 0 ? (dayDown / dayAvail) * 100 : 0;

  // Pareto: group downtimes by reason. Maintenance-derived rows group by
  // pareto_reason_name ("Mechanical Maintenance" / "Electrical Maintenance")
  // instead of their per-event reason_name, so every mechanical (or every
  // electrical) fault rolls into a single bar here — the per-event detail
  // (Servo 1004, Servo 1002, ...) still shows separately in
  // MaintenanceDowntimeCard, which groups by reason_name, not this.
  const byReason = new Map<string, { reason: string; area: string; minutes: number }>();
  for (const d of downtimes) {
    const reason = d.pareto_reason_name ?? d.reason_name;
    const key = `${reason} | ${d.area}`;
    const cur = byReason.get(key);
    if (cur) cur.minutes += Number(d.minutes);
    else byReason.set(key, { reason, area: d.area, minutes: Number(d.minutes) });
  }
  const allReasons = Array.from(byReason.values()).sort((a, b) => b.minutes - a.minutes);
  const sorted = allReasons.slice(0, 12);
  const nameMaxLen = isMobile ? 8 : 24;
  const chartData = sorted.map((r) => ({
    name: r.reason.length > nameMaxLen ? r.reason.slice(0, nameMaxLen) + "…" : r.reason,
    fullName: r.reason,
    area: r.area,
    minutes: r.minutes,
    // % of Total Downtime (totalDown, the KPI above) rather than % of just
    // the top-12 shown here — otherwise these bars silently re-normalize to
    // sum to 100% even when more than 12 distinct reasons exist, disagreeing
    // with the Total Downtime KPI above.
    pct: totalDown > 0 ? Math.round((r.minutes / totalDown) * 1000) / 10 : 0,
  }));

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <header className="mb-6">
        <h2 className="text-xl font-bold tracking-tight md:text-2xl">
          3. Downtime, Stoppages & Loss %
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Pareto breakdown by cause and area</p>
        {allReasons.length > 12 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Showing top 12 of {allReasons.length} causes — bar % is share of Total Downtime.
          </p>
        )}
      </header>

      {/* MTD */}
      <div className="mb-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-primary">
          Month to Date
        </p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3">
          <KpiCard
            label="Total Available Time (min)"
            mobileLabel="Available (min)"
            mobileIcon={Clock}
            value={fmt(totalAvail)}
            icon={Clock}
            variant="primary"
            className="p-3 md:p-5"
          />
          <KpiCard
            label="Total Downtime (min)"
            mobileLabel="Downtime (min)"
            mobileIcon={AlertOctagon}
            value={fmt(totalDown)}
            icon={AlertOctagon}
            variant="warning"
            className="p-3 md:p-5"
          />
          <KpiCard
            label="Loss %"
            value={`${lossPct.toFixed(1)}%`}
            icon={Activity}
            variant={lossPct < 10 ? "success" : lossPct < 25 ? "warning" : "danger"}
            className="p-3 md:p-5"
          />
        </div>
      </div>

      {/* Last Day */}
      <div className="mb-6">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {last ? `Last Day · ${last.entry_date}` : "Last Day · (no entries)"}
        </p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3">
          <KpiCard label="Available (min)" value={fmt(dayAvail)} className="p-3 md:p-5" />
          <KpiCard
            label="Downtime (min)"
            value={fmt(dayDown)}
            variant={dayDown > 0 ? "warning" : "default"}
            className="p-3 md:p-5"
          />
          <KpiCard
            label="Loss %"
            value={`${dayLossPct.toFixed(1)}%`}
            variant={dayLossPct < 10 ? "success" : dayLossPct < 25 ? "warning" : "danger"}
            className="p-3 md:p-5"
          />
        </div>
        {dayDowntimes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {dayDowntimes.map((d) => (
              <span
                key={d.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs"
              >
                <span className="font-medium">{d.reason_name}</span>
                <span className="text-muted-foreground">· {d.area}</span>
                <span className="font-semibold tabular-nums">{fmt(Number(d.minutes))}m</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Mobile height reduced to 160px per user request (2026-08-12) — was
          220px, deliberately taller than the 180px used elsewhere because the
          rotated (-45°) X-axis labels reserve 80px at the bottom (see the
          isMobile-driven margin/height below). Desktop (md:h-96) is untouched. */}
      {chartData.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No downtime reasons logged in this period.
        </div>
      ) : (
        <>
          {/* Mobile: horizontal-bar top-6 causes list — same ranked chartData
              (and gradient) as the full chart below, just laid out so the
              name/%/minutes are all readable instead of the angled 12-label
              Pareto (which stays desktop-only, unchanged, below). */}
          <div className="md:hidden">
            <div className="space-y-2">
              {(showAllCauses ? chartData : chartData.slice(0, 6)).map((d, i) => {
                const maxMinutes = Math.max(...chartData.map((x) => x.minutes), 1);
                const hue = 260 - i * 8;
                return (
                  <div key={d.fullName} className="flex items-center gap-2">
                    <span className="w-[78px] shrink-0 truncate text-xs text-muted-foreground">
                      {d.fullName}
                    </span>
                    <div className="h-4 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(4, (d.minutes / maxMinutes) * 100)}%`,
                          background: `linear-gradient(to right, oklch(0.75 0.18 ${hue}), oklch(0.55 0.18 ${hue}))`,
                        }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums">
                      {fmt(Math.round(d.minutes))}m · {d.pct}%
                    </span>
                  </div>
                );
              })}
            </div>

            {chartData.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllCauses((v) => !v)}
                className="mt-3 text-xs font-medium text-primary"
              >
                {showAllCauses ? "Show fewer causes ↑" : `Show all ${allReasons.length} causes ↓`}
              </button>
            )}
          </div>

          <div className="hidden md:block">
        <div className={isMobile ? "h-[160px] w-full" : "h-96 w-full"}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 24, right: 20, left: isMobile ? 12 : 0, bottom: isMobile ? 80 : 70 }}
            >
              <defs>
                {chartData.map((_, i) => {
                  const hue = 260 - i * 8;
                  return (
                    <linearGradient key={i} id={`dt3d-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={`oklch(0.75 0.18 ${hue})`} />
                      <stop offset="50%" stopColor={`oklch(0.6 0.18 ${hue})`} />
                      <stop offset="100%" stopColor={`oklch(0.4 0.16 ${hue})`} />
                    </linearGradient>
                  );
                })}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="name"
                interval={0}
                angle={isMobile ? -45 : -30}
                textAnchor="end"
                height={isMobile ? 80 : 70}
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
                formatter={(value: number, _name, props) => [
                  `${fmt(value)} min · ${props.payload.pct}%`,
                  props.payload.area,
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
                  <Cell key={i} fill={`url(#dt3d-${i})`} />
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
        </>
      )}
    </section>
  );
}
