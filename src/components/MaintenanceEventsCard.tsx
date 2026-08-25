import { useMemo } from "react";
import { Wrench, Zap, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { KpiCard } from "./KpiCard";
import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/maintenance-format";
import type { MaintenanceEvent } from "@/lib/queries";

const STALE_OPEN_HOURS = 4;

// Combined across mechanical+electrical, scoped to the selected line, and
// computed purely client-side from the `events` prop (already filtered by
// lineId — see the Dashboard's fetch of this card) — no extra query needed.
// Gap/duration math intentionally mirrors
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
    .map(
      (e) =>
        (new Date(e.resolved_at as string).getTime() - new Date(e.started_at).getTime()) /
        3_600_000,
    );
  const mttrHours =
    durations.length > 0 ? durations.reduce((s, v) => s + v, 0) / durations.length : null;

  return { eventCount: inMonth.length, mtbfHours, mttrHours };
}

// "Open: 4" doesn't say whether to worry — four faults opened this morning
// and four open for a week are the same number and completely different
// situations. The age of the oldest one is what makes the count actionable.
// The card already turns its border red past STALE_OPEN_HOURS; this puts
// the same fact on the card that caused it.
function oldestOpenLabel(list: MaintenanceEvent[], now: number): string | undefined {
  if (list.length === 0) return undefined;
  const oldest = Math.min(...list.map((e) => new Date(e.started_at).getTime()));
  const hours = (now - oldest) / 3_600_000;
  if (!Number.isFinite(hours) || hours < 0) return undefined;
  if (hours < 1) return "oldest under an hour";
  if (hours < 48) return `oldest ${Math.round(hours)}h`;
  return `oldest ${Math.round(hours / 24)} days`;
}

// Scoped to the Dashboard's selected line (the `events` prop is already
// filtered by lineId — see the Dashboard's fetch of this card), but not to
// its date-range filter — an open mechanical/electrical event is a live
// operational concern regardless of which reporting period is currently
// selected above it.
export function MaintenanceEventsCard({ events }: { events: MaintenanceEvent[] }) {
  const openMechanical = events.filter((e) => e.type === "mechanical" && e.status !== "resolved");
  const openElectrical = events.filter((e) => e.type === "electrical" && e.status !== "resolved");
  const now = Date.now();
  const hasStaleOpen = [...openMechanical, ...openElectrical].some(
    (e) => now - new Date(e.started_at).getTime() > STALE_OPEN_HOURS * 3_600_000,
  );

  // Preventive events are scheduled, not failures — excluded here so they
  // don't dilute the MTBF/MTTR trend this card is built around (same
  // reasoning as localMtbfHours/localMttrHours on the /maintenance page).
  const failureEvents = useMemo(() => events.filter((e) => e.type !== "preventive"), [events]);
  const thisMonth = useMemo(() => monthStats(failureEvents, 0), [failureEvents]);
  const lastMonth = useMemo(() => monthStats(failureEvents, 1), [failureEvents]);

  return (
    <section
      className={cn(
        "rounded-2xl border bg-card p-6 shadow-card",
        hasStaleOpen ? "border-2 border-destructive" : "border-border",
      )}
    >
      <header className="mb-4">
        <h2 className="text-lg font-semibold">Maintenance</h2>
        <p className="text-sm text-muted-foreground">Open events for the selected line.</p>
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
          sub={oldestOpenLabel(openMechanical, now)}
          icon={Wrench}
          variant={openMechanical.length > 0 ? "danger" : "success"}
        />
        <KpiCard
          label="Open Electrical"
          value={String(openElectrical.length)}
          sub={oldestOpenLabel(openElectrical, now)}
          icon={Zap}
          variant={openElectrical.length > 0 ? "danger" : "success"}
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
          label="MTBF (this month)"
          current={thisMonth.mtbfHours}
          prior={lastMonth.mtbfHours}
          higherIsBetter
          format={formatHours}
        />
        <TrendStat
          label="MTTR (this month)"
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
  const colorClass =
    good === null ? "text-muted-foreground" : good ? "text-success" : "text-destructive";

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      {/* Same numeral treatment as KpiCard: mono at weight 500 with tighter
          tracking. These three sit directly under two KpiCards in the same
          card, so a different typeface here reads as a different kind of
          number when it is exactly the same kind. */}
      <p className="mt-0.5 font-mono text-lg font-medium tracking-[-0.045em] tabular-nums">
        {current === null ? "—" : format(current)}
      </p>
      <p className={cn("mt-0.5 flex items-center gap-1 text-[11px] font-medium", colorClass)}>
        {hasComparison && <Icon className="h-3 w-3 shrink-0" />}
        <span className="truncate">{hasComparison ? "vs last month" : "vs last month: —"}</span>
      </p>
    </div>
  );
}
