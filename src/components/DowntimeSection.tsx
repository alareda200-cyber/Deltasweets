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

// Recharts renders X-axis ticks as a single <text> node, so a long category
// name can only be rotated or clipped. This splits the label on spaces into at
// most two lines of ~18 characters each, drawn horizontally, and only then
// truncates. Two lines at 10.5px occupy less vertical space than the 70px the
// -30° rotation reserved, and stay readable.
const TICK_LINE_MAX = 18;
function WrappedTick(props: { x?: number; y?: number; payload?: { value?: string } }) {
  const { x = 0, y = 0, payload } = props;
  const label = String(payload?.value ?? "");
  const words = label.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > TICK_LINE_MAX && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === 2) break;
    } else {
      cur = next;
    }
  }
  if (lines.length < 2 && cur) lines.push(cur);
  const shown = lines.slice(0, 2).map((l, i, arr) => {
    const isLast = i === arr.length - 1;
    // Two ways a label can lose text: words that didn't fit on either line,
    // or a single word longer than one line. Both must show the ellipsis —
    // silently clipping to 18 characters is how "Starch unit Maintenance"
    // became "Starch unit M" and read as a different fault.
    const wordsDropped = isLast && label.length > arr.join(" ").length;
    const clipped = l.length > TICK_LINE_MAX ? l.slice(0, TICK_LINE_MAX) : l;
    return wordsDropped || clipped.length < l.length ? `${clipped}…` : clipped;
  });
  return (
    <g transform={`translate(${x},${y})`}>
      {shown.map((line, i) => (
        <text
          key={i}
          x={0}
          y={12 + i * 12}
          textAnchor="middle"
          fontSize={10.5}
          fill="var(--color-foreground)"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

export function DowntimeSection({ entries, downtimes }: Props) {
  const isMobile = useIsMobile();
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
  // Desktop no longer rotates the labels (see WrappedTick below), so it can
  // carry a much longer name across two lines before truncating.
  const nameMaxLen = isMobile ? 8 : 40;
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
                <BarChart data={chartData} margin={{ top: 24, right: 20, left: 0, bottom: 54 }}>
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
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                    vertical={false}
                  />
                  {/* This chart only ever renders at md+ (the parent is
                  `hidden md:block`; mobile gets the horizontal list above), so
                  the axis is tuned for desktop only.
                  Rotated -30° labels truncated at 24 chars produced stubs no
                  one could identify — "Change Over Product shap…", "Starch unit
                  M". A category axis whose categories can't be read is not a
                  Pareto. Labels are now horizontal and wrap onto two lines. */}
                  <XAxis
                    dataKey="name"
                    interval={0}
                    height={54}
                    tickMargin={6}
                    tick={<WrappedTick />}
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
