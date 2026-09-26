import { useState, type ReactNode } from "react";
import type { ProductionTargets } from "@/lib/queries";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
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
    <Card labelledBy="dash-lastday">
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
      {canOpenEntry && (
        <Link
          to="/entry"
          search={day.link}
          data-pdf-exclude="true"
          className="mt-auto inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline md:min-h-0"
        >
          Open this entry ›
        </Link>
      )}
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

export function TimeLostCard({ split, reasons }: { split: TimeSplit; reasons: ReasonRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const top = reasons.slice(0, TOP_REASONS);
  const rest = reasons.slice(TOP_REASONS);
  const restMinutes = rest.reduce((s, r) => s + r.minutes, 0);
  const restStops = rest.reduce((s, r) => s + r.count, 0);
  const max = reasons[0]?.minutes ?? 0;
  const share = (m: number) => (split.total > 0 ? (m / split.total) * 100 : 0);
  const segs = (
    [
      ["planned", split.planned],
      ["unplanned", split.unplanned],
      ["unclassified", split.unclassified],
    ] as const
  ).filter(([, m]) => m > 0);

  return (
    <Card labelledBy="dash-time">
      <div className="md:flex md:items-baseline md:justify-between md:gap-3">
        <h3 id="dash-time" className="text-[15px] font-semibold md:text-base">
          Where the time went
        </h3>
        <p className="text-[13px] text-muted-foreground md:text-xs">
          {num(split.total)} min from daily entries
          <span className="md:hidden">
            {" "}
            · planned {num(split.planned)} · unplanned {num(split.unplanned)}
          </span>
        </p>
      </div>

      {split.total === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          No downtime recorded in the daily entries for this period.
        </p>
      ) : (
        <>
          <div
            role="img"
            aria-label={`Planned ${num(split.planned)} minutes, unplanned ${num(split.unplanned)}, unclassified ${num(split.unclassified)}`}
            className="ds-fill-x flex h-2.5 gap-0.5 overflow-hidden rounded-full md:h-7 md:rounded-lg"
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
                {share(m) >= 14 && (
                  <span className="hidden px-2.5 md:inline">
                    {KIND_LABEL[kind]} · {num(m)}
                    {kind === "planned" ? " min" : ""}
                  </span>
                )}
              </div>
            ))}
          </div>

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
// Machine faults
// ---------------------------------------------------------------------------

export function MachineFaultsCard({
  lineName,
  rangeText,
  count,
  loading,
  error,
  canOpenMaintenance,
}: {
  lineName: string;
  rangeText: string;
  count: number | undefined;
  loading: boolean;
  error: boolean;
  canOpenMaintenance: boolean;
}) {
  const noun = (kind: string) =>
    loading
      ? "Counting faults…"
      : error || count == null
        ? "Couldn't load the fault count"
        : `${num(count)} ${kind} ${count === 1 ? "fault" : "faults"}`;
  const countText = noun("unplanned");
  const mobileCountText = noun("machine");
  return (
    <>
      {/* Mobile: the whole card is the link. */}
      <div data-pdf-variant="mobile" className="md:hidden">
        {canOpenMaintenance ? (
          <Link
            to="/maintenance"
            className={cn(CARD, "ds-lift flex min-h-11 items-center gap-3 p-3.5 text-foreground")}
          >
            <MobileFaultsText
              countText={mobileCountText}
              lineName={lineName}
              rangeText={rangeText}
            />
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        ) : (
          <div className={cn(CARD, "flex items-center gap-3 p-3.5")}>
            <MobileFaultsText
              countText={mobileCountText}
              lineName={lineName}
              rangeText={rangeText}
            />
          </div>
        )}
      </div>
      <div data-pdf-variant="desktop" className="hidden md:block">
        <section
          aria-labelledby="dash-faults"
          className={cn(CARD, "flex items-start gap-4 px-5 py-[18px]")}
        >
          <div className="min-w-0 flex-1">
            <h3 id="dash-faults" className="mb-1.5 text-base font-semibold">
              Machine faults on {lineName}
            </h3>
            <p className="text-sm text-foreground">
              <span className="font-semibold tabular-nums">{countText}</span>, {rangeText}. Logged
              on the Maintenance page and <span className="font-semibold">not added</span> to the
              time lost above — the same stop can be in both.
            </p>
          </div>
          {canOpenMaintenance && (
            <Link
              to="/maintenance"
              className="shrink-0 pt-0.5 text-sm font-semibold text-primary hover:underline"
            >
              Faults ›
            </Link>
          )}
        </section>
      </div>
    </>
  );
}

function MobileFaultsText({
  countText,
  lineName,
  rangeText,
}: {
  countText: string;
  lineName: string;
  rangeText: string;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-[15px] font-semibold">{countText}</span>
      <span className="block text-[13px] text-muted-foreground">
        {lineName}, {rangeText} · not added to time lost
      </span>
    </span>
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
