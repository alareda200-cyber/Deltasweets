import { useState } from "react";
import type { EntryDowntime, DailyEntry } from "@/lib/queries";
import { KpiCard } from "./KpiCard";
import { fmt } from "@/lib/date-utils";
import { Clock, AlertOctagon, Activity } from "lucide-react";
import { ParetoRows, PARETO_FILL, PARETO_FILL_PM } from "./ParetoRows";

interface Props {
  entries: DailyEntry[];
  downtimes: EntryDowntime[];
}

export function DowntimeSection({ entries, downtimes }: Props) {
  // Mobile-only "Show all N causes" toggle for the horizontal-bar list below
  // (see the md:hidden block) — collapsed to the top 6 by default.
  const [showAllCauses, setShowAllCauses] = useState(false);
  const [expandedChip, setExpandedChip] = useState<string | null>(null);
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
  // Preventive is scheduled work. It belongs in the downtime total — the line
  // really was stopped — but a total that doesn't say how much of it was
  // planned reads as a worse month than it was.
  const plannedDown = downtimes
    .filter((d) => d.pareto_reason_name === "Preventive Maintenance")
    .reduce((s, d) => s + Number(d.minutes), 0);

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
  const byReason = new Map<
    string,
    { reason: string; area: string; minutes: number; preventive: boolean }
  >();
  for (const d of downtimes) {
    const reason = d.pareto_reason_name ?? d.reason_name;
    // Same test MaintenanceDowntimeCard uses, on the same field.
    const isPreventive = d.pareto_reason_name === "Preventive Maintenance";
    const key = `${reason} | ${d.area}`;
    const cur = byReason.get(key);
    if (cur) {
      cur.minutes += Number(d.minutes);
      cur.preventive = cur.preventive && isPreventive;
    } else {
      byReason.set(key, {
        reason,
        area: d.area,
        minutes: Number(d.minutes),
        preventive: isPreventive,
      });
    }
  }
  const allReasons = Array.from(byReason.values()).sort((a, b) => b.minutes - a.minutes);
  const sorted = allReasons.slice(0, 12);
  // No truncated `name` any more: both the mobile list and the desktop rows
  // print `fullName` and let CSS handle overflow, so nothing is cut in the data.
  const chartData = sorted.map((r) => ({
    fullName: r.reason,
    area: r.area,
    minutes: r.minutes,
    // % of Total Downtime (totalDown, the KPI above) rather than % of just
    // the top-12 shown here — otherwise these bars silently re-normalize to
    // sum to 100% even when more than 12 distinct reasons exist, disagreeing
    // with the Total Downtime KPI above.
    pct: totalDown > 0 ? Math.round((r.minutes / totalDown) * 1000) / 10 : 0,
    preventive: r.preventive,
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
            sub={plannedDown > 0 ? `${fmt(Math.round(plannedDown))} planned` : undefined}
            icon={AlertOctagon}
            variant="warning"
            className="p-3 md:p-5"
          />
          <KpiCard
            label="Loss %"
            value={`${lossPct.toFixed(1)}%`}
            icon={Activity}
            variant={lossPct < 10 ? "success" : lossPct < 25 ? "warning" : "danger"}
            meter={Math.min(1, lossPct / 100)}
            meterLabel="of available time"
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
            meter={Math.min(1, dayLossPct / 100)}
            meterLabel="of available time"
            className="p-3 md:p-5"
          />
        </div>
        {dayDowntimes.length > 0 &&
          (() => {
            // Was a loose row of chips floating above the chart with no heading
            // and no container — they read as leftovers from the card above,
            // and a long reason name silently pushed the chart down by a
            // variable amount. Now: a titled box that states what the row is
            // and totals itself, sorted longest-first, tinted by share.
            const sorted = [...dayDowntimes].sort((a, b) => Number(b.minutes) - Number(a.minutes));
            const dayTotal = sorted.reduce((s, d) => s + Number(d.minutes), 0);
            return (
              <div className="mt-3 rounded-xl border border-border bg-muted/25 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {last ? `Last recorded day · ${last.entry_date}` : "Last recorded day"}
                  </span>
                  {/* Announced as one atomic status when the filter changes,
                      rather than a bare number. */}
                  <span
                    role="status"
                    aria-atomic="true"
                    className="rounded-full border border-primary/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary"
                  >
                    {sorted.length} {sorted.length === 1 ? "stoppage" : "stoppages"} ·{" "}
                    {fmt(Math.round(dayTotal))} min
                  </span>
                  <span className="ml-auto text-[11px] font-semibold text-muted-foreground">
                    Sorted by duration
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {sorted.map((d) => {
                    const share = dayTotal > 0 ? Number(d.minutes) / dayTotal : 0;
                    const open = expandedChip === d.id;
                    return (
                      // A real button, not a title-only tooltip: hover text is
                      // unreachable on touch and by keyboard, so the full label
                      // is revealed by an operable control instead.
                      <button
                        key={d.id}
                        type="button"
                        aria-expanded={open}
                        onClick={() => setExpandedChip(open ? null : d.id)}
                        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-left text-xs transition-colors ${
                          share >= 0.3
                            ? "border-destructive/35 bg-destructive/[0.07]"
                            : share >= 0.15
                              ? "border-warning/45 bg-warning/[0.08]"
                              : "border-border bg-card"
                        }`}
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{
                            background:
                              share >= 0.3
                                ? "var(--color-destructive)"
                                : share >= 0.15
                                  ? "var(--color-warning)"
                                  : "var(--color-muted-foreground)",
                          }}
                        />
                        <span
                          className={`min-w-0 font-medium ${open ? "" : "max-w-[220px] truncate"}`}
                        >
                          {d.reason_name}
                        </span>
                        <span className="shrink-0 text-muted-foreground">· {d.area}</span>
                        <span className="shrink-0 font-semibold tabular-nums">
                          {fmt(Number(d.minutes))}m
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
      </div>

      {chartData.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No downtime reasons logged in this period.
        </div>
      ) : (
        <>
          {/* Mobile: horizontal-bar top-6 causes list. Same ranked chartData
              and the same two fills as the desktop rows below — one colour
              language at every width. */}
          <div className="md:hidden">
            <div className="space-y-2">
              {(showAllCauses ? chartData : chartData.slice(0, 6)).map((d, i) => {
                const maxMinutes = Math.max(...chartData.map((x) => x.minutes), 1);
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
                          background: d.preventive ? PARETO_FILL_PM : PARETO_FILL,
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
            <ParetoRows
              rows={chartData.map((r) => ({
                key: `${r.fullName}|${r.area}`,
                label: r.fullName,
                hint: r.area,
                minutes: r.minutes,
                pct: r.pct,
                preventive: r.preventive,
              }))}
            />
          </div>
        </>
      )}
    </section>
  );
}
