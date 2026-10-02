import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Odometer } from "@/components/motion";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
import { trendDayLabel, trendRangeLabel, type TrendWindow } from "@/lib/fault-trend";
import {
  outputTrend,
  reworkTrend,
  stopsTrend,
  type OutputStage,
  type StopReason,
  type TrendTone,
} from "@/lib/production-trend";
import type { DailyEntry, EntryDowntime } from "@/lib/queries";
import { CARD } from "./tone";

// Dashboard › "vs usual" (October 2026): three cards that compare every line's
// last 7 days with its usual (the 28 days before). One tile per line in the
// KPI tiles' language — one number, one bar, a black tick for the usual —
// and a tap opens that line's 35 days. Not part of the PDF: the report is
// about the period and line picked, these are about the last week.
//
// Motion is one moment per card: tiles rise in turn, bars fill, the usual
// tick drops in, numbers roll, a red chip shakes once. Changing the lens or
// the filter slides tiles and rows to their new places.

interface Line {
  id: string;
  name: string;
}

export interface TrendData {
  entries: DailyEntry[] | undefined;
  downtimes: EntryDowntime[] | undefined;
  loading: boolean;
  error: boolean;
  window: TrendWindow;
  lines: Line[];
  /** The line the Dashboard is showing — tagged "viewing". */
  viewingLineId: string;
}

const TILE_TONE: Record<TrendTone, string> = {
  worse:
    "border-destructive/35 bg-gradient-to-br from-destructive/10 to-card to-70% [--chip:var(--destructive-strong)] [--fill:var(--destructive)]",
  better:
    "bg-gradient-to-br from-success/10 to-card to-70% [--chip:var(--success-strong)] [--fill:var(--success)]",
  limit:
    "bg-gradient-to-br from-warning/15 to-card to-70% [--chip:var(--warning-strong)] [--fill:var(--warning)]",
  steady: "[--chip:var(--muted-foreground)] [--fill:var(--primary)]",
  none: "border-dashed [--chip:var(--muted-foreground)] [--fill:var(--muted-foreground)]",
};
const CHART_TONE: Record<TrendTone | "gone", string> = {
  worse: "var(--destructive)",
  better: "var(--success)",
  gone: "var(--success)",
  limit: "var(--warning)",
  steady: "var(--primary)",
  none: "var(--muted-foreground)",
};

const d1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const d2 = (v: number) => (v < 1 ? v.toFixed(2) : d1(v));
const kg = (v: number) => Math.round(v).toLocaleString("en-US");
const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/** FLIP: children with data-flip slide from where they were to where they are. */
function useFlip(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(new Map<string, DOMRect>());
  const reduced = usePrefersReducedMotion();
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const next = new Map<string, DOMRect>();
    root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const r = el.getBoundingClientRect();
      next.set(el.dataset.flip!, r);
      const prev = last.current.get(el.dataset.flip!);
      if (!prev || reduced) return;
      const dx = prev.left - r.left;
      const dy = prev.top - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: 650,
        easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      });
    });
    last.current = next;
  }, [dep, reduced]);
  return ref;
}

function Tile({
  flip,
  index,
  tone,
  name,
  stage,
  chip,
  value,
  fillPct,
  usualPct,
  limitPct,
  footer,
  viewing,
  pressed,
  onClick,
}: {
  flip: string;
  index: number;
  tone: TrendTone;
  name: string;
  stage?: string;
  chip: ReactNode;
  value: ReactNode;
  fillPct: number | null;
  usualPct: number | null;
  limitPct?: number | null;
  footer: ReactNode;
  viewing: boolean;
  pressed: boolean;
  onClick: () => void;
}) {
  const base = index * 80;
  return (
    <button
      type="button"
      data-flip={flip}
      data-trend-tile={name + (stage ? ` ${stage}` : "")}
      aria-pressed={pressed}
      onClick={onClick}
      style={delay(base)}
      className={cn(
        "ds-rise ds-squish relative flex min-h-11 min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card p-3 text-left md:p-3.5",
        TILE_TONE[tone],
        pressed && "outline-2 outline-offset-1 outline-foreground",
      )}
    >
      {viewing && (
        <span className="absolute -top-2 left-2.5 rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-primary-foreground">
          viewing
        </span>
      )}
      <span className="flex flex-col items-start gap-px md:flex-row md:items-baseline md:justify-between md:gap-1.5">
        <span className="min-w-0 text-[13px] font-semibold">
          {name}
          {stage && (
            <span className="block text-[11px] font-medium text-muted-foreground">{stage}</span>
          )}
        </span>
        <span
          className={cn(
            "whitespace-nowrap text-[11px] font-bold tabular-nums text-[var(--chip)]",
            tone === "worse" && "ds-shake",
          )}
          style={tone === "worse" ? delay(base + 1250) : undefined}
        >
          {chip}
        </span>
      </span>
      <span
        className={cn(
          "text-[26px] leading-tight font-bold tracking-tight md:text-[30px]",
          tone === "none" && "text-lg font-semibold text-muted-foreground md:text-lg",
        )}
      >
        {value}
      </span>
      <span className="relative block h-2 rounded-full bg-muted">
        {limitPct != null && (
          <span
            className="absolute -top-[3px] -bottom-[3px] w-0 border-l-2 border-dashed border-warning-strong"
            style={{ left: `${limitPct}%` }}
          />
        )}
        {fillPct != null && (
          <span
            className="ds-fill-x absolute inset-y-0 left-0 rounded-full bg-[var(--fill)] transition-[width] duration-700 ease-[var(--ease-spring)]"
            style={{ width: `${fillPct}%`, ...delay(base + 250) }}
          />
        )}
        {usualPct != null && (
          <span
            className="ds-pop-in absolute -top-1 h-4 w-[3px] -translate-x-1/2 rounded-sm bg-foreground transition-[left] duration-700 ease-[var(--ease-spring)]"
            style={{ left: `${usualPct}%`, ...delay(base + 900) }}
            title="usual"
          />
        )}
      </span>
      <span className="text-[11px] tabular-nums text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground">
        {footer}
      </span>
    </button>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** 35 days of bars, the last 7 in the tile's colour, the usual as a dashed line. */
function TrendBars({
  values,
  days,
  tone,
  usual,
  unit,
  minTop,
  refLine,
}: {
  values: (number | null)[];
  days: string[];
  tone: TrendTone | "gone";
  usual: number | null;
  unit: string;
  minTop: number;
  refLine?: { value: number; label: string } | null;
}) {
  const props = { values, days, tone, usual, unit, minTop, refLine };
  // Two drawings, not one scaled: a 640-wide chart squeezed to a phone would
  // shrink its labels to 5px.
  return (
    <>
      <div className="md:hidden">
        <Bars {...props} W={340} H={170} />
      </div>
      <div className="hidden md:block">
        <Bars {...props} W={640} H={180} />
      </div>
    </>
  );
}

function Bars({
  values,
  days,
  tone,
  usual,
  unit,
  minTop,
  refLine,
  W,
  H,
}: {
  values: (number | null)[];
  days: string[];
  tone: TrendTone | "gone";
  usual: number | null;
  unit: string;
  minTop: number;
  refLine?: { value: number; label: string } | null;
  W: number;
  H: number;
}) {
  const L = 36;
  const R = 8;
  const T = 16;
  const B = 22;
  const n = values.length;
  const base = n - 7;
  const cw = (W - L - R) / n;
  const want = Math.max(minTop, ...values.map((v) => v ?? 0)) * 1.15;
  const step = niceStep(want);
  const top = Math.ceil(want / step) * step;
  const y = (v: number) => T + (H - T - B) * (1 - Math.min(v, top) / top);
  const ticks: number[] = [];
  for (let t = 0; t <= top + 1e-9; t += step) ticks.push(t);
  const fmt = (v: number) => (unit === "%" ? `${d2(v)}%` : `${Math.round(v)} ${unit}`);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block h-auto w-full"
      role="img"
      aria-label={`Per day, ${trendDayLabel(days[0])} to ${trendDayLabel(days[n - 1])}`}
      data-testid="trend-bars"
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
            {+t.toFixed(2)}
          </text>
        </g>
      ))}
      {values.map((v, i) =>
        v == null ? null : (
          <rect
            key={i}
            className="ds-pop-y"
            style={delay(i * 12)}
            x={L + i * cw + cw * 0.18}
            y={y(v) - (v > 0 && y(0) - y(v) < 1.5 ? 1.5 : 0)}
            width={cw * 0.64}
            height={Math.max(v > 0 ? 1.5 : 0, y(0) - y(v))}
            rx={1.5}
            fill={
              i >= base
                ? CHART_TONE[tone]
                : "color-mix(in oklch, var(--muted-foreground) 40%, transparent)"
            }
          >
            <title>{`${trendDayLabel(days[i])}: ${fmt(v)}`}</title>
          </rect>
        ),
      )}
      {refLine && (
        <>
          <line
            x1={L}
            x2={W - R}
            y1={y(refLine.value)}
            y2={y(refLine.value)}
            stroke="var(--warning-strong)"
            strokeWidth={1.3}
          />
          <text
            x={W - R - 2}
            y={y(refLine.value) - 4}
            fontSize={10}
            textAnchor="end"
            fill="var(--warning-strong)"
            fontWeight={600}
          >
            {refLine.label}
          </text>
        </>
      )}
      {usual != null && usual > 0 && (
        <>
          <line
            x1={L}
            x2={L + base * cw}
            y1={y(usual)}
            y2={y(usual)}
            stroke="var(--foreground)"
            strokeWidth={1.3}
            strokeDasharray="4 3"
          />
          <text x={L + 4} y={y(usual) - 4} fontSize={10} fill="var(--foreground)">
            usual {fmt(usual)}
            {unit === "%" ? "" : " a day"}
          </text>
        </>
      )}
      {[0, 7, 14, 21, base, n - 1].map((i) => (
        <text
          key={i}
          x={L + i * cw + cw / 2}
          y={H - 6}
          fontSize={10}
          textAnchor="middle"
          fill="var(--muted-foreground)"
        >
          {trendDayLabel(days[i])}
        </text>
      ))}
    </svg>
  );
}

function Facts({ items }: { items: [string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0 rounded-lg bg-muted px-2.5 py-2">
          <div className="text-[11px] text-muted-foreground">{k}</div>
          <div className="text-[13px] font-semibold tabular-nums">{v}</div>
        </div>
      ))}
    </div>
  );
}

function Zoom({
  children,
  note,
  chart,
  facts,
}: {
  children: ReactNode;
  note?: ReactNode;
  chart: ReactNode;
  facts: ReactNode;
}) {
  return (
    <div
      className="ds-slide-in flex flex-col gap-2.5 border-t border-border pt-3"
      data-testid="trend-zoom"
    >
      <p className="text-xs text-muted-foreground [&_b]:text-foreground">{children}</p>
      {note && (
        <p className="rounded-lg bg-warning/15 px-2.5 py-2 text-xs [&_b]:text-warning-strong">
          {note}
        </p>
      )}
      <div className="grid items-start gap-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:gap-4">
        <div className="min-w-0">{chart}</div>
        {facts}
      </div>
    </div>
  );
}

function CardHead({
  id,
  title,
  sub,
  right,
}: {
  id: string;
  title: string;
  sub: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5">
      <div className="min-w-0">
        <h3 id={id} className="text-[15px] font-semibold md:text-base">
          {title}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      </div>
      {right}
    </div>
  );
}

function How({ children }: { children: ReactNode }) {
  return (
    <details className="group">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
        ⓘ How it’s counted
      </summary>
      <p className="mt-1 max-w-[80ch] text-[11px] text-muted-foreground">{children}</p>
    </details>
  );
}

function CardShell({ id, children, testId }: { id: string; children: ReactNode; testId: string }) {
  return (
    <section
      aria-labelledby={id}
      data-testid={testId}
      className={cn(CARD, "flex min-w-0 flex-col gap-3 p-3.5 md:gap-3.5 md:px-5 md:py-[18px]")}
    >
      {children}
    </section>
  );
}

function Placeholder({
  title,
  data,
  id,
  testId,
}: {
  title: string;
  data: TrendData;
  id: string;
  testId: string;
}) {
  return (
    <CardShell id={id} testId={testId}>
      <CardHead id={id} title={title} sub="Last 7 days vs the 28 before" />
      {data.error ? (
        <p className="text-sm text-destructive-strong">Couldn’t load the last 35 days.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ds-shimmer h-[118px] rounded-xl" />
          ))}
        </div>
      )}
    </CardShell>
  );
}

function windowSub(w: TrendWindow) {
  return `${trendRangeLabel(w.recentFrom, w.to)} vs ${trendRangeLabel(w.from, w.baseTo)}`;
}

function Segment<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg bg-muted p-0.5">
      {options.map(([k, l]) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={cn(
            "ds-squish h-11 rounded-md px-3.5 text-[13px] md:h-8 md:px-3 md:text-xs",
            value === k ? "bg-card font-semibold shadow-sm" : "text-muted-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

const OUT_SCALE = 130;

export function OutputTrendCard({
  data,
  targets,
}: {
  data: TrendData;
  targets: { makingPct: number; packingPct: number };
}) {
  const [stage, setStage] = useState<OutputStage>("making");
  const [open, setOpen] = useState<string | null>(null);
  const tiles = useMemo(
    () => (data.entries ? outputTrend(data.entries, data.lines, data.window, stage) : []),
    [data.entries, data.lines, data.window, stage],
  );
  const flipRef = useFlip(stage);
  const id = "dash-trend-output";
  if (!data.entries)
    return <Placeholder title="Output vs usual" data={data} id={id} testId="trend-output" />;
  if (tiles.length === 0) return null;
  const target = stage === "making" ? targets.makingPct : targets.packingPct;
  const slipping = tiles.filter((t) => t.tone === "worse").length;
  const picked = tiles.find((t) => t.lineId === open) ?? null;
  const pos = (v: number) => Math.min(100, (v / OUT_SCALE) * 100);
  return (
    <CardShell id={id} testId="trend-output">
      <CardHead
        id={id}
        title="Output vs usual"
        sub={`${windowSub(data.window)} · actual ÷ plan · ${slipping === 0 ? "no line slipping" : `${slipping} line${slipping === 1 ? "" : "s"} slipping`}`}
        right={
          <Segment
            label="Output stage"
            value={stage}
            onChange={setStage}
            options={[
              ["making", "Making"],
              ["packing", "Packing"],
            ]}
          />
        }
      />
      <div ref={flipRef} className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3.5">
        {tiles.map((t, i) => {
          const d = t.now != null && t.usual != null ? t.now - t.usual : null;
          return (
            <Tile
              key={t.lineId}
              flip={t.lineId}
              index={i}
              tone={t.tone}
              name={t.name}
              viewing={t.lineId === data.viewingLineId}
              pressed={open === t.lineId}
              onClick={() => setOpen(open === t.lineId ? null : t.lineId)}
              chip={
                t.tone === "none" ? (
                  <span
                    className="ds-pulse-warn inline-block h-2 w-2 rounded-full bg-warning"
                    aria-label="No entries"
                  />
                ) : d == null ? (
                  "new"
                ) : (
                  `${t.tone === "worse" ? "↓ " : t.tone === "better" ? "↑ " : ""}${d >= 0 ? "+" : "−"}${d1(Math.abs(d))} pts`
                )
              }
              value={
                t.now == null ? (
                  "No entries"
                ) : (
                  <Odometer value={t.now} decimals={1} suffix="%" delay={i * 80 + 250} />
                )
              }
              fillPct={t.now == null ? null : pos(t.now)}
              usualPct={t.usual == null ? null : pos(t.usual)}
              footer={
                t.now == null ? (
                  <>
                    since {t.lastEntry ? trendDayLabel(t.lastEntry) : "—"}
                    {t.usual != null && ` · usual ${d1(t.usual)}%`}
                  </>
                ) : (
                  <>
                    usual <b>{t.usual == null ? "—" : `${d1(t.usual)}%`}</b> · {t.days7} day
                    {t.days7 === 1 ? "" : "s"}
                  </>
                )
              }
            />
          );
        })}
      </div>
      {picked && (
        <Zoom
          note={
            picked.zeroDays.length > 0 && (
              <>
                <b>Check the entry · </b>
                {picked.zeroDays.map(trendDayLabel).join(", ")}: plan entered, actual 0 kg. If the
                line did not run, mark it as a non-production day.
              </>
            )
          }
          chart={
            <TrendBars
              values={picked.daily}
              days={data.window.days}
              tone={picked.tone}
              usual={picked.usual}
              unit="%"
              minTop={110}
              refLine={{ value: target, label: `target ${target}%` }}
            />
          }
          facts={
            <Facts
              items={[
                ["Last 7 days", picked.now == null ? "No entries" : `${d1(picked.now)}% of plan`],
                ["Usual", picked.usual == null ? "—" : `${d1(picked.usual)}% of plan`],
                ["Lowest day this week", lowest(picked.daily, data.window)],
                ["Target", `${target}% (Settings)`],
              ]}
            />
          }
        >
          {picked.now == null ? (
            <>
              No daily entry since <b>{picked.lastEntry ? trendDayLabel(picked.lastEntry) : "—"}</b>
              . The card compares again once entries come in.
            </>
          ) : (
            <>
              <b>{picked.name}</b> {stage === "making" ? "made" : "packed"} <b>{d1(picked.now)}%</b>{" "}
              of plan in the last 7 days, against{" "}
              <b>{picked.usual == null ? "—" : `${d1(picked.usual)}%`}</b> usual.
            </>
          )}
        </Zoom>
      )}
      <How>
        Actual ÷ plan from the daily entries, last 7 full days vs the 28 before (today is not
        counted yet). Red = 5 points or more lower, with at least 2 entry days; green = 5 points or
        more higher; dashed = no entry in the last 7 days. The black tick is the line’s usual.
      </How>
    </CardShell>
  );
}

function lowest(daily: (number | null)[], w: TrendWindow): string {
  let lo: number | null = null;
  daily.forEach((v, i) => {
    if (i >= daily.length - 7 && v != null && (lo == null || v < (daily[lo] ?? Infinity))) lo = i;
  });
  return lo == null ? "—" : `${trendDayLabel(w.days[lo])} · ${d1(daily[lo]!)}%`;
}

// ---------------------------------------------------------------------------

export function ReworkTrendCard({ data, limitPct }: { data: TrendData; limitPct: number | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const trend = useMemo(
    () => (data.entries ? reworkTrend(data.entries, data.lines, data.window, limitPct) : null),
    [data.entries, data.lines, data.window, limitPct],
  );
  const id = "dash-trend-rework";
  if (!trend)
    return <Placeholder title="Rework vs usual" data={data} id={id} testId="trend-rework" />;
  const { flagged, better, steady } = trend;
  if (flagged.length === 0 && better.length === 0 && steady === 0) return null;
  const picked = flagged.find((t) => t.key === open) ?? null;
  let worst: number | null = null;
  if (picked)
    picked.dailyKg.forEach((v, i) => {
      if (
        i >= picked.dailyKg.length - 7 &&
        v != null &&
        (worst == null || v > (picked.dailyKg[worst] ?? -1))
      )
        worst = i;
    });
  return (
    <CardShell id={id} testId="trend-rework">
      <CardHead
        id={id}
        title="Rework vs usual"
        sub={`${windowSub(data.window)} · rework kg ÷ making kg${limitPct != null ? ` · limit ${limitPct}%` : ""}`}
      />
      {flagged.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="trend-rework-calm">
          No rework is rising or over the limit this week.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-3.5">
          {flagged.map((t, i) => {
            const max = Math.max((limitPct ?? 0) * 1.6, t.now * 1.15, t.usual * 1.15, 0.5);
            return (
              <Tile
                key={t.key}
                flip={t.key}
                index={i}
                tone={t.tone}
                name={t.name}
                stage={`${t.stage} rework`}
                viewing={t.lineId === data.viewingLineId}
                pressed={open === t.key}
                onClick={() => setOpen(open === t.key ? null : t.key)}
                chip={
                  t.tone === "worse"
                    ? t.usual > 0
                      ? `×${d1(t.now / t.usual)} rising`
                      : "new"
                    : `over ${limitPct}%`
                }
                value={
                  <Odometer
                    value={t.now}
                    decimals={t.now < 1 ? 2 : 1}
                    suffix="%"
                    delay={i * 80 + 250}
                  />
                }
                fillPct={(t.now / max) * 100}
                usualPct={(t.usual / max) * 100}
                limitPct={limitPct != null ? (limitPct / max) * 100 : null}
                footer={
                  <>
                    usual <b>{d2(t.usual)}%</b> · {kg(t.kg7)} kg this week
                  </>
                }
              />
            );
          })}
          {better.length > 0 && (
            <div
              className="ds-rise hidden min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-gradient-to-br from-success/10 to-card to-70% p-3.5 md:flex"
              style={delay(flagged.length * 80)}
            >
              <span className="flex items-baseline justify-between text-[13px] font-semibold">
                Getting better{" "}
                <span className="text-[11px] font-bold text-success-strong">↓ {better.length}</span>
              </span>
              {better.map((b) => (
                <span key={b.key} className="text-[11px] tabular-nums text-muted-foreground">
                  <b className="font-semibold text-foreground">
                    {b.name} {b.stage.toLowerCase()}
                  </b>{" "}
                  {d2(b.now)}% vs {d2(b.usual)}%
                </span>
              ))}
              <span className="text-[11px] text-muted-foreground">{steady} others steady</span>
            </div>
          )}
        </div>
      )}
      {(better.length > 0 || flagged.length > 0) && (
        <p
          className={cn(
            "text-xs text-muted-foreground",
            flagged.length > 0 && better.length > 0 && "md:hidden",
          )}
        >
          {better.length > 0 && (
            <b className="font-semibold text-success-strong">↓ {better.length} getting better</b>
          )}
          {better.length > 0 &&
            ` (${better.map((b) => `${b.name} ${b.stage.toLowerCase()}`).join(", ")})`}
          {` · ${steady} steady`}
        </p>
      )}
      {picked && (
        <Zoom
          chart={
            <TrendBars
              values={picked.daily}
              days={data.window.days}
              tone={picked.tone}
              usual={picked.usual}
              unit="%"
              minTop={(limitPct ?? 1) * 1.2}
              refLine={limitPct != null ? { value: limitPct, label: `limit ${limitPct}%` } : null}
            />
          }
          facts={
            <Facts
              items={[
                ["Last 7 days", `${kg(picked.kg7)} kg · ${d2(picked.now)}%`],
                ["Usual", `${d2(picked.usual)}% of making`],
                [
                  "Worst day this week",
                  worst == null
                    ? "—"
                    : `${trendDayLabel(data.window.days[worst])} · ${kg(picked.dailyKg[worst] ?? 0)} kg`,
                ],
                ["Limit", limitPct != null ? `${limitPct}% (Settings)` : "Not set"],
              ]}
            />
          }
        >
          {picked.tone === "limit" ? (
            <>
              <b>
                {picked.name} {picked.stage.toLowerCase()}
              </b>{" "}
              rework is over {limitPct}% this week and in the 28 days before. Not new, but not going
              away.
            </>
          ) : (
            <>
              <b>
                {picked.name} {picked.stage.toLowerCase()}
              </b>{" "}
              rework is <b>{d2(picked.now)}%</b> of making this week
              {picked.usual > 0
                ? `, ${d1(picked.now / picked.usual)}× its usual ${d2(picked.usual)}%`
                : ", none in the 28 days before"}
              .
            </>
          )}
        </Zoom>
      )}
      <How>
        Rework kg ÷ making kg for each stage, from the daily entries, last 7 full days vs the 28
        before. Red = 1.5× usual or more, up at least 0.3 points and 50 kg. Amber = above the limit
        (Settings › Targets) in both periods. The black tick is the usual, the dashed line the
        limit.
      </How>
    </CardShell>
  );
}

// ---------------------------------------------------------------------------

const PHONE_ROWS = 8;

export function StopsTrendCard({ data }: { data: TrendData }) {
  const [filter, setFilter] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const trend = useMemo(
    () =>
      data.entries && data.downtimes
        ? stopsTrend(data.entries, data.downtimes, data.lines, data.window)
        : null,
    [data.entries, data.downtimes, data.lines, data.window],
  );
  const flipRef = useFlip(filter);
  const id = "dash-trend-stops";
  if (!trend)
    return (
      <Placeholder title="Operational stops vs usual" data={data} id={id} testId="trend-stops" />
    );
  if (trend.lines.length === 0) return null;
  const rows = filter ? trend.reasons.filter((r) => r.lineId === filter) : trend.reasons;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.now, r.usual)));
  const up = rows.filter((r) => r.tone === "worse").length;
  const gone = rows.filter((r) => r.tone === "gone").length;
  const filterName = trend.lines.find((l) => l.lineId === filter)?.name;
  return (
    <CardShell id={id} testId="trend-stops">
      <CardHead
        id={id}
        title="Operational stops vs usual"
        sub={`${windowSub(data.window)} · downtime from the daily entries · minutes lost a production day`}
      />
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3.5">
        {trend.lines.map((l, i) => {
          const mx = Math.max(l.now ?? 0, l.usual, 60) * 1.2;
          const d = l.now == null ? null : l.now - l.usual;
          return (
            <Tile
              key={l.lineId}
              flip={l.lineId}
              index={i}
              tone={l.tone}
              name={l.name}
              viewing={l.lineId === data.viewingLineId}
              pressed={filter === l.lineId}
              onClick={() => {
                setFilter(filter === l.lineId ? null : l.lineId);
                setOpen(null);
              }}
              chip={
                l.now == null ? (
                  <span
                    className="ds-pulse-warn inline-block h-2 w-2 rounded-full bg-warning"
                    aria-label="No entries"
                  />
                ) : (
                  `${l.tone === "worse" ? "↑ " : l.tone === "better" ? "↓ " : ""}${d! >= 0 ? "+" : "−"}${Math.round(Math.abs(d!))} min`
                )
              }
              value={
                l.now == null ? (
                  "No entries"
                ) : (
                  <span className="inline-flex items-baseline gap-1">
                    <Odometer value={l.now} decimals={0} delay={i * 80 + 250} />
                    <span className="text-[13px] font-semibold text-muted-foreground">
                      min a day
                    </span>
                  </span>
                )
              }
              fillPct={l.now == null ? null : (l.now / mx) * 100}
              usualPct={(l.usual / mx) * 100}
              footer={
                l.now == null ? (
                  <>
                    since {l.lastEntry ? trendDayLabel(l.lastEntry) : "—"} · usual{" "}
                    {Math.round(l.usual)} min
                  </>
                ) : (
                  <>
                    usual <b>{Math.round(l.usual)} min</b> · {l.days7} day{l.days7 === 1 ? "" : "s"}
                  </>
                )
              }
            />
          );
        })}
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-[13px] font-semibold">
          {filterName ? `${filterName}: ` : ""}Every reason, {rows.length}
          {filterName ? ` of ${trend.reasons.length}` : ""}
        </h4>
        <span className="text-[11px] text-muted-foreground">
          <b className="text-destructive-strong">{up} up</b> ·{" "}
          <b className="text-success-strong">{gone} gone this week</b> · grey = usual, colour = this
          week · {filterName ? `tap ${filterName} again for all lines` : "tap a line to filter"}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No stops logged in the 35 days.</p>
      ) : (
        <div ref={flipRef}>
          <ul className="flex flex-col gap-0.5" aria-label="Stop reasons">
            {rows.map((r, i) => (
              <ReasonRow
                key={r.key}
                r={r}
                i={i}
                max={max}
                hiddenOnPhone={!all && !filter && i >= PHONE_ROWS}
                open={open === r.key}
                onToggle={() => setOpen(open === r.key ? null : r.key)}
                window={data.window}
              />
            ))}
          </ul>
          {!all && !filter && rows.length > PHONE_ROWS && (
            <button
              type="button"
              onClick={() => setAll(true)}
              className="ds-squish mt-1 min-h-11 px-2 text-sm font-semibold text-primary md:hidden"
            >
              Show all {rows.length} reasons
            </button>
          )}
        </div>
      )}
      <How>
        Minutes from each daily entry’s downtime reasons, divided by the line’s entry days, so a
        short week compares fairly. Last 7 full days vs the 28 before. Up = 1.5× usual or more and
        at least 5 min a day more; new = not logged in the 28 days before; gone = logged before, not
        this week. Spellings that differ only in case are merged; other spellings are pointed out,
        not merged. Machine faults from the Maintenance page are not in this card.
      </How>
    </CardShell>
  );
}

const ROW_TONE: Record<StopReason["tone"], { bar: string; chip: string }> = {
  worse: { bar: "bg-destructive", chip: "bg-destructive/10 text-destructive-strong" },
  better: { bar: "bg-success", chip: "bg-success/15 text-success-strong" },
  gone: { bar: "bg-success", chip: "bg-success/15 text-success-strong" },
  steady: { bar: "bg-primary", chip: "bg-muted text-muted-foreground" },
};

function ReasonRow({
  r,
  i,
  max,
  hiddenOnPhone,
  open,
  onToggle,
  window: w,
}: {
  r: StopReason;
  i: number;
  max: number;
  hiddenOnPhone: boolean;
  open: boolean;
  onToggle: () => void;
  window: TrendWindow;
}) {
  const t = ROW_TONE[r.tone];
  const base = 300 + Math.min(i, 20) * 45;
  const daysThisWeek = r.daily.slice(-7).filter((v) => v > 0).length;
  return (
    <li
      data-flip={r.key}
      data-reason={r.name}
      className={cn("ds-rise", hiddenOnPhone && "hidden md:block")}
      style={delay(base)}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 rounded-lg border border-transparent p-2 text-left hover:bg-muted",
          "md:grid-cols-[minmax(0,320px)_minmax(0,1fr)_190px_90px] md:gap-x-4",
          open && "border-border bg-muted",
        )}
      >
        <span className="min-w-0 text-[13px] font-semibold [overflow-wrap:anywhere] first-letter:uppercase md:col-start-1 md:row-start-1">
          {r.name}
          <span className="block text-[11px] font-medium text-muted-foreground">
            {r.lineName}
            {r.areas.length > 0 && ` · ${r.areas.join(", ")}`}
          </span>
        </span>
        <span
          className={cn(
            "justify-self-end whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums md:col-start-4 md:row-start-1",
            t.chip,
            r.tone === "worse" && "ds-shake",
          )}
          style={r.tone === "worse" ? delay(base + 1000) : undefined}
        >
          {r.chip}
        </span>
        <span className="col-span-2 flex flex-col gap-[3px] md:col-span-1 md:col-start-2 md:row-start-1">
          <span
            className="ds-fill-x block h-[7px] rounded-full bg-muted-foreground/35 transition-[width] duration-500"
            style={{ width: `${(r.usual / max) * 100}%`, ...delay(base + 200) }}
          />
          <span
            className={cn(
              "ds-fill-x block h-[7px] rounded-full transition-[width] duration-500",
              t.bar,
            )}
            style={{
              width: `${r.now > 0 ? Math.max(1.5, (r.now / max) * 100) : 0}%`,
              ...delay(base + 450),
            }}
          />
        </span>
        <span className="col-span-2 text-[11px] tabular-nums text-muted-foreground md:col-span-1 md:col-start-3 md:row-start-1 md:text-right">
          <b className="font-semibold text-foreground">{d1(r.now)}</b> min a day · usual{" "}
          {d1(r.usual)}
        </span>
      </button>
      {open && (
        <div className="px-2 pb-2.5">
          <Zoom
            note={
              r.lookalikes.length > 0 && (
                <>
                  <b>Other spelling · </b>
                  {r.lookalikes.map((n) => `“${n}”`).join(", ")} on {r.lineName} is probably the
                  same stop. It is listed on its own, not merged.
                </>
              )
            }
            chart={
              <TrendBars
                values={r.daily.map((v) => (v > 0 ? v : null))}
                days={w.days}
                tone={r.tone}
                usual={r.usual}
                unit="min"
                minTop={30}
              />
            }
            facts={
              <Facts
                items={[
                  [
                    "This week",
                    `${Math.round(r.min7)} min on ${daysThisWeek} day${daysThisWeek === 1 ? "" : "s"}`,
                  ],
                  ["Usual week", `${Math.round(r.min28 / 4)} min`],
                  ["Days logged in 35", String(r.daysLogged)],
                  ["Last logged", trendDayLabel(r.lastLogged)],
                ]}
              />
            }
          >
            <b>{r.name}</b> on {r.lineName}: <b>{d1(r.now)} min</b> a production day this week,
            against {d1(r.usual)} usual.
          </Zoom>
        </div>
      )}
    </li>
  );
}
