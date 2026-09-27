import { useState, type ReactNode } from "react";
import type { ProductionTargets } from "@/lib/queries";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  KIND_LABEL,
  adherenceTone,
  kg,
  lossTone,
  num,
  pct1,
  ratio,
  type ReasonRow,
  type ScoreRow,
  type TimeSplit,
  type Tone,
  type Totals,
} from "@/lib/dashboard-metrics";
import { CARD, KIND_BAR, TONE_TEXT } from "./tone";
import { faultsByTitle, isFault, type MachineStop } from "@/lib/machine-downtime";

export function Card({
  labelledBy,
  className,
  children,
}: {
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={cn(
        CARD,
        "flex min-w-0 flex-col gap-3 p-3.5 md:gap-3.5 md:px-5 md:py-[18px]",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** A group heading between rows of cards: what the row is about. */
export function SectionHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="text-xs font-semibold uppercase tracking-wider text-muted-foreground md:col-span-2"
    >
      {children}
    </h2>
  );
}

// ---------------------------------------------------------------------------
// Last recorded day
// ---------------------------------------------------------------------------

export interface LastDay {
  dayName: string; // "Wed 23 Sep"
  shiftText: string; // "Full day" / "Shift A + Shift B"
  savedText: string | null; // "saved 24 Sep 10:11"
  totals: Totals;
  time: TimeSplit;
  /** Where "Open this entry" goes: the day's first shift on this line. */
  link: { line: string; date: string; shift: string };
}

function LastDayRow({
  label,
  sub,
  value,
  tone,
}: {
  label: string;
  sub: string;
  value: string;
  tone: Tone | "plain";
}) {
  return (
    <div className="min-w-0 md:flex md:items-baseline md:justify-between md:gap-3 md:border-b md:border-muted md:pb-3">
      <dt className="text-xs text-muted-foreground md:text-sm md:text-foreground">
        {label}
        <span className="hidden text-xs text-muted-foreground md:block">{sub}</span>
      </dt>
      <dd
        className={cn(
          "text-xl font-bold tabular-nums",
          tone === "plain" ? "text-foreground" : TONE_TEXT[tone],
        )}
      >
        {value}
      </dd>
      <dd className="text-xs text-muted-foreground md:hidden">{sub}</dd>
    </div>
  );
}

export function LastDayCard({
  day,
  canOpenEntry,
  targets,
}: {
  day: LastDay;
  canOpenEntry: boolean;
  targets: ProductionTargets;
}) {
  const t = day.totals;
  const making = ratio(t.makingActual, t.makingPlan);
  const packing = ratio(t.packingActual, t.packingPlan);
  const lost = ratio(day.time.total, t.availableMin);
  const reworkParts = [
    t.reworkCooking > 0 ? `cooking ${kg(t.reworkCooking)}` : null,
    `making ${kg(t.reworkMaking)}`,
    `packing ${kg(t.reworkPacking)}`,
  ].filter(Boolean);
  return (
    // Same view-transition name as the entry page's summary: "Open this
    // entry" grows this card into it.
    <Card labelledBy="dash-lastday" className="[view-transition-name:entry-summary]">
      <div>
        <h3 id="dash-lastday" className="text-[15px] font-semibold md:text-base">
          Last recorded day
        </h3>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {day.dayName} · {day.shiftText}
          {day.savedText && <span className="hidden md:inline"> · {day.savedText}</span>}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 md:flex md:flex-col md:gap-3">
        <LastDayRow
          label="Making"
          sub={`${kg(t.makingActual)} of ${kg(t.makingPlan)} kg`}
          value={t.makingPlan > 0 ? pct1(making) : "—"}
          tone={t.makingPlan > 0 ? adherenceTone(making, targets.makingPct) : "plain"}
        />
        <LastDayRow
          label="Packing"
          sub={`${kg(t.packingActual)} of ${kg(t.packingPlan)} kg`}
          value={t.packingPlan > 0 ? pct1(packing) : "—"}
          tone={t.packingPlan > 0 ? adherenceTone(packing, targets.packingPct) : "plain"}
        />
        <LastDayRow
          label="Time lost"
          sub={`${num(day.time.total)} of ${num(t.availableMin)} min · ${num(day.time.unplanned)} unplanned`}
          value={t.availableMin > 0 ? pct1(lost) : "—"}
          tone={t.availableMin > 0 ? lossTone(lost * 100, targets.lossPct) : "plain"}
        />
        <LastDayRow
          label="Rework"
          sub={reworkParts.join(" · ")}
          value={`${kg(t.reworkCooking + t.reworkMaking + t.reworkPacking)} kg`}
          tone="plain"
        />
      </dl>
      <div data-pdf-exclude="true" className="mt-auto flex flex-wrap gap-x-5">
        {canOpenEntry && (
          <Link
            to="/entry"
            search={day.link}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline md:min-h-0"
          >
            Open this entry ›
          </Link>
        )}
        <Link
          to="/replay"
          search={{ line: day.link.line, date: day.link.date }}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline md:min-h-0"
        >
          Replay this day ›
        </Link>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Where the time went
// ---------------------------------------------------------------------------

const TOP_REASONS = 5;

function reasonMeta(r: ReasonRow): string {
  return [KIND_LABEL[r.kind], r.severity, r.area, `${r.count}×`].filter(Boolean).join(" · ");
}

// Reason bars fill once, one after another, after the stacked bar above them.
// Rows revealed later by "All other stops" fill at once (index -1).
const reasonDelay = (i: number) => (i < 0 ? {} : { animationDelay: `${500 + i * 110}ms` });

function ReasonLine({
  r,
  max,
  grey,
  index = 0,
}: {
  r: ReasonRow;
  max: number;
  grey?: boolean;
  index?: number;
}) {
  const width = max > 0 ? (r.minutes / max) * 100 : 0;
  return (
    <li className="flex flex-col gap-1 md:grid md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_5rem] md:items-center md:gap-3">
      <div className="flex min-w-0 items-baseline justify-between gap-2.5 md:block">
        <p className="truncate text-sm font-medium" title={r.name}>
          {r.name}
        </p>
        <p className="shrink-0 text-sm font-semibold tabular-nums md:hidden">
          {num(r.minutes)} min
        </p>
        <p className="hidden text-xs text-muted-foreground md:block">{reasonMeta(r)}</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted md:h-3">
        <div
          className={cn(
            "ds-fill-x h-full rounded-full",
            grey ? KIND_BAR.unclassified : KIND_BAR[r.kind],
          )}
          style={{ width: `${width}%`, ...reasonDelay(index) }}
        />
      </div>
      <p className="text-xs text-muted-foreground md:hidden">{reasonMeta(r)}</p>
      <p className="hidden text-right text-sm font-semibold tabular-nums md:block">
        {num(r.minutes)} min
      </p>
    </li>
  );
}

export interface TimeSources {
  /** Minutes from the daily entries' downtime rows. */
  entryMin: number;
  /** Minutes from faults and preventive work on the Maintenance page. */
  machineMin: number;
  /** The Maintenance page's stops couldn't be read, so they are missing. */
  machineError: boolean;
}

export interface LastDayTime {
  dayName: string;
  split: TimeSplit;
  reasons: ReasonRow[];
}

function KindBar({ split, tall = true }: { split: TimeSplit; tall?: boolean }) {
  const share = (m: number) => (split.total > 0 ? (m / split.total) * 100 : 0);
  const segs = (
    [
      ["planned", split.planned],
      ["unplanned", split.unplanned],
      ["unclassified", split.unclassified],
    ] as const
  ).filter(([, m]) => m > 0);
  return (
    <div
      role="img"
      aria-label={`Planned ${num(split.planned)} minutes, unplanned ${num(split.unplanned)}, unclassified ${num(split.unclassified)}`}
      className={cn(
        "ds-fill-x flex h-2.5 gap-0.5 overflow-hidden rounded-full",
        tall ? "md:h-7 md:rounded-lg" : "md:h-4 md:rounded-md",
      )}
      style={{ animationDelay: "300ms" }}
    >
      {segs.map(([kind, m]) => (
        <div
          key={kind}
          className={cn(
            "flex h-full min-w-0 items-center overflow-hidden whitespace-nowrap text-xs font-semibold",
            KIND_BAR[kind],
            kind === "planned" ? "text-primary-foreground" : "text-foreground",
          )}
          style={{ width: `${share(m)}%` }}
        >
          {tall && share(m) >= 14 && (
            <span className="hidden px-2.5 md:inline">
              {KIND_LABEL[kind]} · {num(m)}
              {kind === "planned" ? " min" : ""}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function TimeLostCard({
  split,
  reasons,
  sources,
}: {
  split: TimeSplit;
  reasons: ReasonRow[];
  sources: TimeSources;
}) {
  const [showAll, setShowAll] = useState(false);
  const top = reasons.slice(0, TOP_REASONS);
  const rest = reasons.slice(TOP_REASONS);
  const restMinutes = rest.reduce((s, r) => s + r.minutes, 0);
  const restStops = rest.reduce((s, r) => s + r.count, 0);
  const max = reasons[0]?.minutes ?? 0;

  return (
    <Card labelledBy="dash-time">
      <div className="md:flex md:items-baseline md:justify-between md:gap-3">
        <h3 id="dash-time" className="text-[15px] font-semibold md:text-base">
          Where the time went
        </h3>
        <p className="text-[13px] text-muted-foreground md:text-xs">
          {num(split.total)} min · daily entries {num(sources.entryMin)} + maintenance{" "}
          {num(sources.machineMin)}
        </p>
      </div>
      {sources.machineError && (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-strong">
          Couldn't load the Maintenance page's faults — they are missing from these minutes.
        </p>
      )}

      {split.total === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          No downtime recorded for this period, in the daily entries or on the Maintenance page.
        </p>
      ) : (
        <>
          <KindBar split={split} />

          <ol className="flex flex-col gap-3 md:gap-2.5">
            {(showAll ? reasons : top).map((r, i) => (
              <ReasonLine key={r.key} r={r} max={max} index={i < TOP_REASONS ? i : -1} />
            ))}
            {!showAll && rest.length > 0 && (
              <li className="hidden md:grid md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_5rem] md:items-center md:gap-3">
                <div>
                  <p className="text-sm font-medium">Other reasons</p>
                  <p className="text-xs text-muted-foreground">
                    {rest.length} {rest.length === 1 ? "reason" : "reasons"} · {restStops}{" "}
                    {restStops === 1 ? "stop" : "stops"}
                  </p>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("ds-fill-x h-full rounded-full", KIND_BAR.unclassified)}
                    style={{
                      width: `${max > 0 ? Math.min(100, (restMinutes / max) * 100) : 0}%`,
                      ...reasonDelay(TOP_REASONS),
                    }}
                  />
                </div>
                <p className="text-right text-sm font-semibold tabular-nums">
                  {num(restMinutes)} min
                </p>
              </li>
            )}
          </ol>

          {rest.length > 0 && (
            <button
              type="button"
              data-pdf-exclude="true"
              aria-expanded={showAll}
              onClick={() => setShowAll((v) => !v)}
              className="h-11 rounded-lg border border-border bg-card text-sm font-semibold text-primary hover:bg-muted md:h-9 md:self-start md:border-0 md:bg-transparent md:px-0 md:hover:bg-transparent md:hover:underline"
            >
              {showAll
                ? "Show top 5 only"
                : `All ${restStops} other ${restStops === 1 ? "stop" : "stops"} · ${num(restMinutes)} min`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

/** Time lost on the last recorded day: the same bar and reasons, one day. */
export function LastDayTimeCard({ lastDay }: { lastDay: LastDayTime }) {
  const dayTop = lastDay.reasons.slice(0, TOP_REASONS);
  const dayMax = dayTop[0]?.minutes ?? 0;
  const rest = lastDay.reasons.slice(TOP_REASONS);
  return (
    <Card labelledBy="dash-time-lastday">
      <div className="md:flex md:items-baseline md:justify-between md:gap-3">
        <h3 id="dash-time-lastday" className="text-[15px] font-semibold md:text-base">
          Last recorded day · {lastDay.dayName}
        </h3>
        <p className="text-[13px] text-muted-foreground md:text-xs">
          {num(lastDay.split.total)} min
          {lastDay.split.total > 0 && (
            <>
              {" "}
              · planned {num(lastDay.split.planned)} · unplanned {num(lastDay.split.unplanned)}
            </>
          )}
        </p>
      </div>
      {lastDay.split.total === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          No time lost on this day.
        </p>
      ) : (
        <>
          <KindBar split={lastDay.split} />
          <ol className="flex flex-col gap-3 md:gap-2.5">
            {dayTop.map((r, i) => (
              <ReasonLine key={r.key} r={r} max={dayMax} index={i + 2} />
            ))}
          </ol>
          {rest.length > 0 && (
            <p className="text-xs text-muted-foreground">
              + {rest.length} more {rest.length === 1 ? "reason" : "reasons"} ·{" "}
              {num(rest.reduce((a, r) => a + r.minutes, 0))} min
            </p>
          )}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Rework by stage
// ---------------------------------------------------------------------------

export function ReworkCard({ totals }: { totals: Totals }) {
  const total = totals.reworkCooking + totals.reworkMaking + totals.reworkPacking;
  const stages = [
    ["Cooking", totals.reworkCooking],
    ["Making", totals.reworkMaking],
    ["Packing", totals.reworkPacking],
  ] as const;
  const max = Math.max(...stages.map(([, v]) => v));
  const share = totals.makingActual > 0 ? pct1(total / totals.makingActual) : "—";
  return (
    <Card labelledBy="dash-rework">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="dash-rework" className="text-[15px] font-semibold md:text-base">
          <span className="md:hidden">Rework</span>
          <span className="hidden md:inline">Rework by stage</span>
        </h3>
        <p className="text-[13px] text-muted-foreground md:text-xs">
          {kg(total)} kg · {share}
          <span className="hidden md:inline"> of making output</span>
        </p>
      </div>
      <div data-pdf-variant="mobile" className="grid grid-cols-3 gap-2 md:hidden">
        {stages.map(([stage, v]) => (
          <div key={stage}>
            <p className="text-xs text-muted-foreground">{stage}</p>
            <p className="text-[17px] font-bold tabular-nums">{kg(v)}</p>
          </div>
        ))}
      </div>
      <div data-pdf-variant="desktop" className="hidden md:block">
        <div className="flex flex-col gap-3">
          {stages.map(([stage, v]) => (
            <div
              key={stage}
              className="grid grid-cols-[6rem_minmax(0,1fr)_6rem] items-center gap-3"
            >
              <span className="text-sm">{stage}</span>
              <div className="h-3 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-muted-foreground"
                  style={{ width: `${max > 0 ? (v / max) * 100 : 0}%` }}
                />
              </div>
              <span className="text-right text-sm font-semibold tabular-nums">{kg(v)} kg</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

function fmtMin(st: MachineStop): string {
  if (st.open) return "open";
  if (st.minutes <= 0) return "line kept running";
  return `${num(st.minutes)} min`;
}

export function MaintenanceCard({
  lineName,
  rangeText,
  stops,
  faultCount,
  loading,
  error,
  canOpenMaintenance,
}: {
  lineName: string;
  rangeText: string;
  /** Every stop in the period (stoppages collapsed), preventive included. */
  stops: MachineStop[];
  /** Fault events logged in the period, preventive left out. */
  faultCount: number;
  loading: boolean;
  error: boolean;
  canOpenMaintenance: boolean;
}) {
  if (loading) {
    return <div className={cn(CARD, "ds-shimmer h-40")} aria-hidden="true" />;
  }
  const faultMin = stops.filter((s) => isFault(s.type)).reduce((a, s) => a + s.minutes, 0);
  const pmMin = stops.filter((s) => !isFault(s.type)).reduce((a, s) => a + s.minutes, 0);
  const top = faultsByTitle(stops)
    .filter((f) => f.minutes > 0)
    .slice(0, 5);
  const topMax = top[0]?.minutes ?? 0;

  return (
    <Card labelledBy="dash-maint">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h3 id="dash-maint" className="text-[15px] font-semibold md:text-base">
            Maintenance on {lineName}
          </h3>
          <p className="text-[13px] text-muted-foreground md:text-xs">
            {rangeText} · from the Maintenance page
          </p>
        </div>
        {canOpenMaintenance && (
          <Link
            to="/maintenance"
            data-pdf-exclude="true"
            className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-primary hover:underline md:min-h-0"
          >
            Maintenance ›
          </Link>
        )}
      </div>

      {error ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-strong">
          Couldn't load the faults for {lineName}.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2">
            <div className="min-w-0 rounded-lg bg-muted/50 px-2.5 py-2">
              <dt className="text-xs text-muted-foreground">Fault downtime</dt>
              <dd className="text-lg font-bold tabular-nums">
                {num(faultMin)}
                <span className="ml-0.5 text-xs font-medium text-muted-foreground">min</span>
              </dd>
            </div>
            <div className="min-w-0 rounded-lg bg-muted/50 px-2.5 py-2">
              <dt className="text-xs text-muted-foreground">Faults</dt>
              <dd className="text-lg font-bold tabular-nums">{num(faultCount)}</dd>
            </div>
            <div className="min-w-0 rounded-lg bg-muted/50 px-2.5 py-2">
              <dt className="text-xs text-muted-foreground">Preventive</dt>
              <dd className="text-lg font-bold tabular-nums">
                {num(pmMin)}
                <span className="ml-0.5 text-xs font-medium text-muted-foreground">min</span>
              </dd>
            </div>
          </dl>
          <p className="-mt-1 text-xs text-muted-foreground">
            Preventive is planned work, not a fault — it is not in the fault count. A stoppage
            counts its window once.
          </p>

          {top.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted-foreground">
                Faults that cost the most time
              </p>
              <ol className="flex flex-col gap-2">
                {top.map((f, i) => (
                  <li
                    key={f.title}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"
                  >
                    <span className="truncate text-sm font-medium" title={f.title}>
                      {f.title}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        {f.count}×
                      </span>
                    </span>
                    <span className="text-right text-sm font-semibold tabular-nums">
                      {num(f.minutes)} min
                    </span>
                    <div className="col-span-2 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("ds-fill-x h-full rounded-full", KIND_BAR.unplanned)}
                        style={{
                          width: `${topMax > 0 ? (f.minutes / topMax) * 100 : 0}%`,
                          animationDelay: `${400 + i * 110}ms`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

const DAY_MIN = 1440;

/**
 * The last recorded day on the Maintenance card: a 24-hour strip showing when
 * the line was stopped (and by what), then the day's faults as bars by
 * downtime. Faults that cost no time — still open, or the line kept running —
 * are listed under the bars rather than drawn as zero-length ones.
 */
function MaintenanceDayChart({
  date,
  faults,
  preventive,
}: {
  date: string;
  faults: MachineStop[];
  preventive: MachineStop[];
}) {
  const dayStart = new Date(`${date}T00:00:00`).getTime();
  const pos = (iso: string) =>
    Math.max(0, Math.min(DAY_MIN, (new Date(iso).getTime() - dayStart) / 60_000));
  const blocks = [...preventive, ...faults]
    .filter((st) => !st.keptRunning)
    .map((st) => {
      const a = pos(st.startedAt);
      const b = st.endedAt ? pos(st.endedAt) : DAY_MIN;
      return { st, a, b: Math.max(b, a) };
    });

  // Bars: faults grouped by title on this day, longest downtime first.
  const byTitle = new Map<string, { title: string; count: number; minutes: number }>();
  for (const st of [...faults, ...preventive]) {
    if (st.minutes <= 0) continue;
    const key = `${isFault(st.type) ? "f" : "p"}:${st.title.toLowerCase()}`;
    const cur = byTitle.get(key);
    if (cur) {
      cur.count += st.members;
      cur.minutes += st.minutes;
    } else byTitle.set(key, { title: st.title, count: st.members, minutes: st.minutes });
  }
  const bars = Array.from(byTitle.entries())
    .map(([key, v]) => ({ key, planned: key.startsWith("p:"), ...v }))
    .sort((x, y) => y.minutes - x.minutes);
  const SHOWN = 6;
  const shown = bars.slice(0, SHOWN);
  const rest = bars.slice(SHOWN);
  const max = shown[0]?.minutes ?? 0;
  const noTime = faults.filter((st) => st.minutes <= 0);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div
          role="img"
          aria-label={`When the line was stopped on this day: ${blocks.length} ${blocks.length === 1 ? "stop" : "stops"}`}
          className="relative h-6 overflow-hidden rounded-md bg-muted md:h-7"
        >
          {[6, 12, 18].map((h) => (
            <span
              key={h}
              aria-hidden="true"
              className="absolute inset-y-0 w-px bg-border"
              style={{ left: `${(h / 24) * 100}%` }}
            />
          ))}
          {blocks.map(({ st, a, b }) => (
            <span
              key={st.id}
              title={`${st.title} · ${fmtMin(st)}`}
              className={cn(
                "absolute inset-y-0.5 rounded-sm",
                !isFault(st.type)
                  ? KIND_BAR.planned
                  : st.open
                    ? "bg-destructive"
                    : KIND_BAR.unplanned,
              )}
              style={{
                left: `${(a / DAY_MIN) * 100}%`,
                width: `max(3px, ${((b - a) / DAY_MIN) * 100}%)`,
              }}
            />
          ))}
        </div>
        <div
          aria-hidden="true"
          className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground"
        >
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className={cn("h-2 w-2 rounded-sm", KIND_BAR.unplanned)} /> fault
          </span>
          {preventive.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className={cn("h-2 w-2 rounded-sm", KIND_BAR.planned)} /> preventive
            </span>
          )}
          {faults.some((st) => st.open) && (
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-destructive" /> still open
            </span>
          )}
        </p>
      </div>

      {shown.length > 0 && (
        <ol className="flex flex-col gap-2">
          {shown.map((b, i) => (
            <li
              key={b.key}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"
            >
              <span className="truncate text-sm font-medium" title={b.title}>
                {b.title}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {b.planned ? "preventive" : `${b.count}×`}
                </span>
              </span>
              <span className="text-right text-sm font-semibold tabular-nums">
                {num(b.minutes)} min
              </span>
              <div className="col-span-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "ds-fill-x h-full rounded-full",
                    b.planned ? KIND_BAR.planned : KIND_BAR.unplanned,
                  )}
                  style={{
                    width: `${max > 0 ? (b.minutes / max) * 100 : 0}%`,
                    animationDelay: `${600 + i * 110}ms`,
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
      {rest.length > 0 && (
        <p className="text-xs text-muted-foreground">
          + {rest.length} more · {num(rest.reduce((a, r) => a + r.minutes, 0))} min
        </p>
      )}

      {noTime.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-muted-foreground">No downtime charged</p>
          <ul className="flex flex-wrap gap-1.5">
            {noTime.map((st) => (
              <li
                key={st.id}
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                  st.open ? "border-destructive/40 bg-destructive/10" : "border-border bg-card",
                )}
              >
                <span className="min-w-0 truncate font-medium">{st.title}</span>
                <span className="shrink-0 font-semibold">{fmtMin(st)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface MaintenanceDay {
  dayName: string;
  /** "YYYY-MM-DD" — the local day the timeline spans. */
  date: string;
  stops: MachineStop[];
  /** Fault events that day, preventive left out. */
  faultCount: number;
}

/** Maintenance on the last recorded day: when the line stopped, and why. */
export function MaintenanceLastDayCard({
  lineName,
  day,
  error,
}: {
  lineName: string;
  day: MaintenanceDay;
  error: boolean;
}) {
  const faults = day.stops
    .filter((s) => isFault(s.type))
    .sort((a, b) => Number(b.open) - Number(a.open) || b.minutes - a.minutes);
  const faultMin = faults.reduce((a, s) => a + s.minutes, 0);
  const pm = day.stops.filter((s) => !isFault(s.type));
  const pmMin = pm.reduce((a, s) => a + s.minutes, 0);
  return (
    <Card labelledBy="dash-maint-lastday">
      <div className="md:flex md:items-baseline md:justify-between md:gap-3">
        <h3 id="dash-maint-lastday" className="text-[15px] font-semibold md:text-base">
          Last recorded day · {day.dayName}
        </h3>
        <p className="text-[13px] text-muted-foreground md:text-xs">
          {num(day.faultCount)} {day.faultCount === 1 ? "fault" : "faults"} · {num(faultMin)} min
          {pmMin > 0 && <> · preventive {num(pmMin)} min</>}
        </p>
      </div>
      {error ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-strong">
          Couldn't load the faults for {lineName}.
        </p>
      ) : faults.length === 0 && pm.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          No faults logged on this day.
        </p>
      ) : (
        <MaintenanceDayChart date={day.date} faults={faults} preventive={pm} />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Area-owner scores
// ---------------------------------------------------------------------------

export function AreaScoresCard({
  rows,
  loading,
  lineName,
}: {
  rows: ScoreRow[];
  loading: boolean;
  lineName: string;
}) {
  if (loading) {
    return <div className={cn(CARD, "ds-shimmer h-20")} aria-hidden="true" />;
  }
  if (rows.length === 0) {
    return (
      <section
        aria-labelledby="dash-scores"
        className="flex items-center gap-4 rounded-2xl border border-dashed border-border bg-muted/30 px-3.5 py-4 md:px-5"
      >
        <div className="min-w-0 flex-1">
          <h3 id="dash-scores" className="mb-1 text-[15px] font-semibold">
            Area-owner scores
          </h3>
          <p className="text-sm text-muted-foreground">
            None entered in this period for {lineName}. Scores appear here once they are added on
            the daily entry.
          </p>
        </div>
      </section>
    );
  }
  return (
    <Card labelledBy="dash-scores">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="dash-scores" className="text-[15px] font-semibold">
          Area-owner scores
        </h3>
        <p className="hidden text-xs text-muted-foreground md:block">
          average score in this period
        </p>
      </div>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li
            key={r.key}
            className="flex items-baseline justify-between gap-3 border-b border-muted py-2 last:border-b-0"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{r.area}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {r.owner} · {r.count} {r.count === 1 ? "entry" : "entries"}
              </span>
            </span>
            <span className="shrink-0 text-base font-semibold tabular-nums">
              {r.average.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
