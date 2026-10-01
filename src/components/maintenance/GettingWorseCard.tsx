import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MaintenanceEvent } from "@/lib/queries";
import {
  TREND_BASE_DAYS,
  TREND_RULES,
  rowMeasure,
  rowRatio,
  sortTrend,
  trendDayLabel,
  trendNum,
  trendRangeLabel,
  trendStampLabel,
  trendSummary,
  trendTimes,
  type FaultTrendResult,
  type FaultTrendRow,
  type TrendLens,
} from "@/lib/fault-trend";
import { ScopeChip } from "@/components/maintenance/RightNowSection";

// Maintenance › "Getting worse" (monthly upgrade, October 2026).
// The plant's total can stay flat while one machine quietly gets much worse;
// this lists the faults whose last 7 days run well above their usual week.
// Two layouts of the same card: the phone opens a row in place, the desktop
// shows the list with the picked row in a side panel.

const VISIBLE_ROWS = 8;
const BAD = "var(--destructive)";
const BASE = "color-mix(in oklch, var(--muted-foreground) 45%, transparent)";

function measureValue(row: FaultTrendRow, m: TrendLens, i: number): number {
  return m === "time" ? row.daily[i].minutes : row.daily[i].stops;
}

function RowBadge({ row, lens }: { row: FaultTrendRow; lens: TrendLens }) {
  if (row.isNew)
    return (
      <span className="whitespace-nowrap rounded-full bg-warning/15 px-2 py-0.5 text-xs font-bold text-warning-strong">
        New
      </span>
    );
  const m = rowMeasure(row, lens);
  const ratio = rowRatio(row, m) ?? 0;
  return (
    <span className="whitespace-nowrap rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-bold tabular-nums text-destructive-strong">
      {trendTimes(ratio)} {m === "time" ? "time lost" : "more often"}
    </span>
  );
}

function RowNumbers({ row, lens }: { row: FaultTrendRow; lens: TrendLens }) {
  const m = rowMeasure(row, lens);
  const usual = row.isNew
    ? "none in the 28 days before"
    : m === "time"
      ? `${trendNum(row.usualMinutes)} min a usual week`
      : `${trendNum(row.usualStops)} a usual week`;
  return (
    <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
      <span>
        <b className="font-semibold text-foreground">
          {m === "time"
            ? `${trendNum(row.minutes7)} min`
            : `${row.stops7} stop${row.stops7 === 1 ? "" : "s"}`}
        </b>{" "}
        this week
      </span>
      <span>{usual}</span>
    </span>
  );
}

function Spark({ row, lens }: { row: FaultTrendRow; lens: TrendLens }) {
  const m = rowMeasure(row, lens);
  const vals = row.daily.map((_, i) => measureValue(row, m, i));
  const max = Math.max(1, ...vals);
  return (
    <svg
      viewBox={`0 0 ${vals.length * 6} 26`}
      preserveAspectRatio="none"
      className="block h-6 w-full"
      aria-hidden="true"
    >
      {vals.map((v, i) => {
        const h = v ? Math.max(2, (v / max) * 24) : 1;
        return (
          <rect
            key={i}
            x={i * 6 + 0.5}
            y={26 - h}
            width={5}
            height={h}
            rx={1}
            fill={i >= TREND_BASE_DAYS ? BAD : BASE}
          />
        );
      })}
    </svg>
  );
}

function niceStep(max: number): number {
  const raw = max / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p);
}

/** 35 days, the last 7 shaded, with the usual day as a dashed line. */
export function TrendChart({
  row,
  lens,
  days,
  wide,
}: {
  row: FaultTrendRow;
  lens: TrendLens;
  days: string[];
  wide?: boolean;
}) {
  const m = rowMeasure(row, lens);
  const vals = row.daily.map((_, i) => measureValue(row, m, i));
  const W = wide ? 460 : 340;
  const H = wide ? 200 : 170;
  const L = 34;
  const R = 8;
  const T = 14;
  const B = 24;
  const n = vals.length;
  const cw = (W - L - R) / n;
  const max = Math.max(1, ...vals);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  const usual = (m === "time" ? row.minutes28 : row.stops28) / TREND_BASE_DAYS;
  const unit = m === "time" ? "min" : row.stops28 / TREND_BASE_DAYS === 1 ? "stop" : "stops";
  const label = `usual: ${trendNum(usual)} ${unit} a day`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block h-auto w-full"
      role="img"
      aria-label={`${row.title} per day, ${trendDayLabel(days[0])} to ${trendDayLabel(days[n - 1])}`}
      data-testid="trend-chart"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--border)" />
          <text
            x={L - 6}
            y={y(t) + 3.5}
            fontSize={10}
            textAnchor="end"
            fill="var(--muted-foreground)"
            className="font-mono"
          >
            {t >= 1000 ? `${t / 1000}k` : t}
          </text>
        </g>
      ))}
      <rect
        x={L + TREND_BASE_DAYS * cw}
        y={T}
        width={(n - TREND_BASE_DAYS) * cw}
        height={H - T - B}
        fill="color-mix(in oklch, var(--destructive) 10%, transparent)"
      />
      {vals.map((v, i) => {
        const h = v ? Math.max(1.5, ((H - T - B) * v) / top) : 0;
        return (
          <rect
            key={i}
            x={L + i * cw + cw * 0.15}
            y={y(0) - h}
            width={cw * 0.7}
            height={h}
            rx={1.5}
            fill={i >= TREND_BASE_DAYS ? BAD : BASE}
          >
            <title>{`${trendDayLabel(days[i])}: ${trendNum(v)} ${m === "time" ? "min" : "stops"}`}</title>
          </rect>
        );
      })}
      {usual > 0 && (
        <>
          <line
            x1={L}
            x2={W - R}
            y1={y(usual)}
            y2={y(usual)}
            stroke="var(--foreground)"
            strokeDasharray="4 3"
            strokeWidth={1.2}
          />
          <rect
            x={L + 2}
            y={y(usual) - 15}
            width={label.length * 5.4 + 8}
            height={13}
            rx={3}
            fill="var(--card)"
          />
          <text x={L + 6} y={y(usual) - 5} fontSize={10} fill="var(--foreground)">
            {label}
          </text>
        </>
      )}
      {[0, 7, 14, 21, TREND_BASE_DAYS, n - 1].map((i) => (
        <text
          key={i}
          x={L + i * cw + cw / 2}
          y={H - 8}
          fontSize={10}
          textAnchor="middle"
          fill="var(--muted-foreground)"
        >
          {trendDayLabel(days[i])}
        </text>
      ))}
      <text
        x={L + ((TREND_BASE_DAYS + n) / 2) * cw}
        y={T + 11}
        fontSize={10}
        textAnchor="middle"
        fill="var(--destructive-strong)"
        fontWeight={600}
      >
        last 7 days
      </text>
    </svg>
  );
}

function worstDay(row: FaultTrendRow, m: TrendLens, days: string[]): string {
  let best = 0;
  row.daily.forEach((_, i) => {
    if (measureValue(row, m, i) > measureValue(row, m, best)) best = i;
  });
  const v = measureValue(row, m, best);
  return `${trendDayLabel(days[best])} · ${trendNum(v)} ${m === "time" ? "min" : v === 1 ? "stop" : "stops"}`;
}

function Detail({
  row,
  lens,
  days,
  wide,
  onSelectEvent,
}: {
  row: FaultTrendRow;
  lens: TrendLens;
  days: string[];
  wide?: boolean;
  onSelectEvent: (e: MaintenanceEvent) => void;
}) {
  const m = rowMeasure(row, lens);
  const fact = (k: string, v: string) => (
    <div className="min-w-0 rounded-lg bg-muted px-2.5 py-2">
      <div className="text-[11px] text-muted-foreground">{k}</div>
      <div className="text-sm font-semibold tabular-nums">{v}</div>
    </div>
  );
  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-testid="trend-detail">
      {wide && (
        <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
          {row.title}{" "}
          <span className="text-xs font-medium text-muted-foreground">{row.lineName}</span>
          <RowBadge row={row} lens={lens} />
        </div>
      )}
      <TrendChart row={row} lens={lens} days={days} wide={wide} />
      <div className="grid grid-cols-2 gap-2">
        {fact(
          "This week",
          `${row.stops7} stop${row.stops7 === 1 ? "" : "s"} · ${trendNum(row.minutes7)} min`,
        )}
        {fact(
          "Usual week",
          row.isNew
            ? "Not seen"
            : `${trendNum(row.usualStops)} stops · ${trendNum(row.usualMinutes)} min`,
        )}
        {fact("Worst day", worstDay(row, m, days))}
        {fact("Last seen", trendStampLabel(row.lastSeen))}
      </div>
      {row.lookalikes.map((o) => (
        <p
          key={o.title}
          className="rounded-lg bg-warning/15 px-2.5 py-2 text-xs"
          data-testid="trend-lookalike"
        >
          <b className="text-warning-strong">Other spelling · </b>
          {o.stops} more stop{o.stops === 1 ? "" : "s"} ({trendNum(o.minutes)} min, last{" "}
          {trendDayLabel(isoDayOf(o.lastSeen))}) logged as “{o.title}”. Probably the same machine
          under another name, so not counted here.
        </p>
      ))}
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Latest stops</p>
        <ul className="flex flex-col">
          {row.latest.map(({ event, minutes }) => (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => onSelectEvent(event)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm hover:bg-muted md:min-h-9"
              >
                <span className="tabular-nums">{trendStampLabel(event.started_at)}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {event.resolved_at ? `${trendNum(minutes)} min` : "still open"} ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function isoDayOf(ts: string): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function BetterList({ rows, lens }: { rows: FaultTrendRow[]; lens: TrendLens }) {
  if (rows.length === 0) return null;
  return (
    <details className="group mx-3.5 border-t border-border pb-2" data-testid="trend-better">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-medium text-success-strong [&::-webkit-details-marker]:hidden">
        <span>
          ↓ {rows.length} fault{rows.length === 1 ? "" : "s"} getting better
        </span>
        <span aria-hidden="true" className="transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const now = lens === "time" ? r.minutes7 : r.stops7;
          const usual = lens === "time" ? r.usualMinutes : r.usualStops;
          const pct = Math.round((1 - now / usual) * 100);
          return (
            <li
              key={r.key}
              className="flex flex-wrap justify-between gap-x-2 text-xs tabular-nums text-muted-foreground"
            >
              <span>
                <b className="font-semibold text-foreground">{r.title}</b> · {r.lineName}
              </span>
              <span>
                {lens === "time"
                  ? `${trendNum(now)} min vs ${trendNum(usual)}`
                  : `${now} vs ${trendNum(usual)} stops`}{" "}
                <span className="rounded-full bg-success/15 px-2 py-0.5 font-bold text-success-strong">
                  −{pct}%
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function GettingWorseCard({
  result,
  isLoading,
  lineLabel,
  layout,
  onSelectEvent,
}: {
  result: FaultTrendResult | null;
  isLoading: boolean;
  lineLabel: string;
  layout: "phone" | "desktop";
  onSelectEvent: (e: MaintenanceEvent) => void;
}) {
  const [lens, setLens] = useState<TrendLens>("time");
  const [openKey, setOpenKey] = useState<string | null | undefined>(undefined);
  const [showAll, setShowAll] = useState(false);
  const phone = layout === "phone";
  const titleId = `getting-worse-${layout}`;

  const rows = result ? sortTrend(result.rising, lens) : [];
  const visible = showAll ? rows : rows.slice(0, VISIBLE_ROWS);
  // First row starts open on the phone and picked on the desktop.
  const current = openKey === undefined ? (rows[0]?.key ?? null) : openKey;
  const picked = rows.find((r) => r.key === current) ?? (phone ? null : rows[0]);
  const w = result?.window;
  const summary = result ? trendSummary(result) : null;

  const head = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-3.5 pt-3.5 pb-2">
        <h2 id={titleId} className="flex items-center gap-2 text-[15px] font-semibold">
          <TrendingUp className="h-[18px] w-[18px] text-destructive" aria-hidden="true" />
          Getting worse
        </h2>
        <ScopeChip>Last 7 days vs 28 before · {lineLabel}</ScopeChip>
      </div>
      {w && (
        <p className="px-3.5 text-xs text-muted-foreground">
          {trendRangeLabel(w.recentFrom, w.to)} vs {trendRangeLabel(w.from, w.baseTo)} · preventive
          left out · today not counted yet
        </p>
      )}
      {summary && (
        <p
          className="mx-3.5 mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-lg bg-muted px-3 py-2.5 text-[13px]"
          data-testid="trend-summary"
        >
          <span>
            All faults: <b className="font-semibold tabular-nums">{summary.total}</b>,{" "}
            {summary.verdict}.
          </span>
          <b className="font-semibold">{summary.rising}</b>
        </p>
      )}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 pt-3 pb-1.5">
          <div role="group" aria-label="Rank by" className="flex rounded-lg bg-muted p-0.5">
            {(
              [
                ["time", "Time lost"],
                ["count", "How often"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={lens === k}
                onClick={() => setLens(k)}
                className={cn(
                  "h-11 rounded-md px-3.5 text-[13px] md:h-8 md:px-3 md:text-xs",
                  lens === k ? "bg-card font-semibold shadow-sm" : "text-muted-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {!phone && (
            <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BASE }} />
                28 days before
              </span>
              <span className="flex items-center gap-1">
                <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BAD }} />
                last 7 days
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );

  const list = (
    <>
      {isLoading && !result ? (
        <p className="px-3.5 py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p
          className="px-3.5 py-6 text-center text-sm text-muted-foreground"
          data-testid="trend-empty"
        >
          Nothing is getting worse this week.
        </p>
      ) : (
        <ol className="flex flex-col px-1.5 pb-1.5" aria-label="Faults getting worse">
          {visible.map((row, i) => {
            const on = row.key === picked?.key;
            return (
              <li key={row.key} data-trend-row={row.title}>
                <button
                  type="button"
                  {...(phone ? { "aria-expanded": on } : { "aria-pressed": on })}
                  onClick={() => setOpenKey(phone && on ? null : row.key)}
                  className={cn(
                    "grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 rounded-lg border border-transparent px-2 py-2.5 text-left transition-colors hover:bg-muted",
                    on && "border-border bg-muted",
                  )}
                >
                  <span className="w-4 text-right font-mono text-xs text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 font-semibold">
                    <span className="min-w-0 break-words">{row.title}</span>
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {row.lineName}
                    </span>
                  </span>
                  <span className="justify-self-end">
                    <RowBadge row={row} lens={lens} />
                  </span>
                  <span className="col-span-2 col-start-2">
                    <Spark row={row} lens={lens} />
                  </span>
                  <span className="col-span-2 col-start-2">
                    <RowNumbers row={row} lens={lens} />
                  </span>
                </button>
                {phone && on && w && (
                  <div className="mx-2 mb-2.5 mt-0.5 sm:ml-8">
                    <Detail row={row} lens={lens} days={w.days} onSelectEvent={onSelectEvent} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {rows.length > VISIBLE_ROWS && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="mx-3.5 mb-1 min-h-11 text-sm font-semibold text-primary md:min-h-8"
        >
          {showAll ? "Show fewer" : `Show ${rows.length - VISIBLE_ROWS} more`}
        </button>
      )}
      {result && <BetterList rows={result.better} lens={lens} />}
      <p className="mt-1 border-t border-border px-3.5 pt-2 pb-3.5 text-[11px] text-muted-foreground">
        {TREND_RULES}
      </p>
    </>
  );

  return (
    <section
      aria-labelledby={titleId}
      data-testid={`getting-worse-${layout}`}
      className="rounded-xl border border-border bg-card shadow-card"
    >
      {phone || !picked || !w ? (
        <>
          {head}
          {list}
        </>
      ) : (
        <div className="grid grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            {head}
            {list}
          </div>
          <div className="min-w-0 border-l border-border px-4 py-4">
            <Detail row={picked} lens={lens} days={w.days} wide onSelectEvent={onSelectEvent} />
          </div>
        </div>
      )}
    </section>
  );
}
