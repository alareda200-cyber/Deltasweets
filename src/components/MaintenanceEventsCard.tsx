import { useMemo } from "react";
import { Wrench, Zap, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { KpiCard } from "./KpiCard";
import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/maintenance-format";
import type { MaintenanceEvent } from "@/lib/queries";

const STALE_OPEN_HOURS = 4;

// Combined across mechanical+electrical, plant-wide, and computed purely
// client-side from the `events` prop (already the full unfiltered
// maintenance_events list — see the Dashboard's fetch of this card) — no
// extra query needed. Gap/duration math intentionally mirrors
// maintenanceMetricsQuery in queries.ts (average gap between consecutive
// started_at for MTBF, average resolved_at-started_at for MTTR), just
// scoped to one calendar month rather than lifetime, so a month boundary
// resets the "previous event" used for the first gap of the month — a
// deliberate simplification for a glanceable trend indicator, not a
// like-for-like replacement for the lifetime MTBF/MTTR on /maintenance.
function monthStats(events: MaintenanceEvent[], monthsAgo: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1).getTime();
  const end = new Date(now.getFullYear(), now.getMonth() - monthsAgo + 1, 1).getTime();
  const inMonth = events.filter((e) => {
    const t = new Date(e.started_at).getTime();
    return t >= start && t < end;
  });

  const starts = inMonth.map((e) => new Date(e.started_at).getTime()).sort((a, b) => a - b);
  let mtbfHours: number | null = null;
  if (starts.length >= 2) {
    let totalGap = 0;
    for (let i = 1; i < starts.length; i++) totalGap += (starts[i] - starts[i - 1]) / 3_600_000;
    mtbfHours = totalGap / (starts.length - 1);
  }

  const durations = inMonth
    .filter((e) => e.status === "resolved" && e.resolved_at)
    .map((e) => (new Date(e.resolved_at as string).getTime() - new Date(e.started_at).getTime()) / 3_600_000);
  const mttrHours = durations.length > 0 ? durations.reduce((s, v) => s + v, 0) / durations.length : null;

  return { eventCount: inMonth.length, mtbfHours, mttrHours };
}

// Plant-wide, not scoped to the Dashboard's line/date-range filters — an
// open mechanical/electrical event is a live operational concern regardless
// of which line or reporting period is currently selected above it.
export function MaintenanceEventsCard({ events }: { events: MaintenanceEvent[] }) {
  const openMechanical = events.filter((e) => e.type === "mechanical" && e.status !== "resolved");
  const openElectrical = events.filter((e) => e.type === "electrical" && e.status !== "resolved");
  const now = Date.now();
  const hasStaleOpen = [...openMechanical, ...openElectrical].some(
    (e) => now - new Date(e.started_at).getTime() > STALE_OPEN_HOURS * 3_600_000,
  );

  const thisMonth = useMemo(() => monthStats(events, 0), [events]);
  const lastMonth = useMemo(() => monthStats(events, 1), [events]);

  return (
    <section
      className={cn(
        "rounded-2xl border bg-card p-6 shadow-card",
        hasStaleOpen ? "border-2 border-destructive" : "border-border",
      )}
    >
      <header className="mb-4">
        <h2 className="text-lg font-semibold">Maintenance</h2>
        <p className="text-sm text-muted-foreground">Open events across the plant.</p>
        {hasStaleOpen && (
          <p className="mt-1 text-xs font-medium text-destructive">
            An open event has been unresolved for over {STALE_OPEN_HOURS} hours.
          </p>
        )}
      </header>
      <div className="grid grid-cols-2 gap-3">
        <KpiCard
          label="Open Mechanical"
          value={String(openMechanical.length)}
          icon={Wrench}
          variant={openMechanical.length > 0 ? "warning" : "success"}
        />
        <KpiCard
          label="Open Electrical"
          value={String(openElectrical.length)}
          icon={Zap}
          variant={openElectrical.length > 0 ? "warning" : "success"}
        />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-4">
        <TrendStat
          label="Events"
          current={thisMonth.eventCount}
          prior={lastMonth.eventCount}
          higherIsBetter={false}
          format={(v) => String(v)}
        />
        <TrendStat
          label="MTBF"
          current={thisMonth.mtbfHours}
          prior={lastMonth.mtbfHours}
          higherIsBetter
          format={formatHours}
        />
        <TrendStat
          label="MTTR"
          current={thisMonth.mttrHours}
          prior={lastMonth.mttrHours}
          higherIsBetter={false}
          format={formatHours}
        />
      </div>
    </section>
  );
}

// higherIsBetter differs per metric: more events is worse, higher MTBF
// (longer between failures) is better, higher MTTR (slower repairs) is
// worse — so the same up-arrow can be green for one stat and red for
// another. No comparison (and no arrow) when either month lacks enough data
// to compute the metric (e.g. MTBF needs 2+ events in that month).
function TrendStat({
  label,
  current,
  prior,
  higherIsBetter,
  format,
}: {
  label: string;
  current: number | null;
  prior: number | null;
  higherIsBetter: boolean;
  format: (v: number) => string;
}) {
  const hasComparison = current !== null && prior !== null;
  const delta = hasComparison ? current - prior : null;
  const direction = delta === null || delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const good = delta === null || delta === 0 ? null : higherIsBetter ? delta > 0 : delta < 0;
  const Icon = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : Minus;
  const colorClass = good === null ? "text-muted-foreground" : good ? "text-success" : "text-destructive";

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{current === null ? "—" : format(current)}</p>
      <p className={cn("mt-0.5 flex items-center gap-1 text-[11px] font-medium", colorClass)}>
        {hasComparison && <Icon className="h-3 w-3 shrink-0" />}
        <span className="truncate">{hasComparison ? "vs last month" : "vs last month: —"}</span>
      </p>
    </div>
  );
}
