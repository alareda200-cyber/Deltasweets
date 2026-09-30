import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Rectangle,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useState, type ReactElement } from "react";
import { cn } from "@/lib/utils";
import { formatDayName, kg, parseDay } from "@/lib/dashboard-metrics";
import { daysLabel } from "@/lib/faults-per-day";
import type { Extreme, ReworkDay, ReworkDaysSummary } from "@/lib/rework-per-day";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { Card } from "./DashboardCards";
import { compactTick, lineTag } from "./chart-line-tag";

// Dashboard › Rework and area owners › Rework per day. Same reading as the
// Faults per day chart: the most is red, the least green, a day with no entry
// a grey stub; kg or % of making, and in % the dashed line is the rework
// limit from Settings › Targets. Tap or hover a bar for the day's split.

type Mode = "kg" | "pct";
type Mark = "most" | "least" | "blank" | "plain";

interface Row extends ReworkDay {
  bar: number;
  mark: Mark;
  value: number | null;
}

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  index?: number;
  payload?: Row;
}

const FILL: Record<Mark, string> = {
  most: "var(--color-destructive)",
  least: "var(--color-success)",
  blank: "var(--color-muted-foreground)",
  plain: "var(--color-chart-1)",
};
const OPACITY: Record<Mark, number> = { most: 1, least: 1, blank: 0.3, plain: 1 };

const pctText = (n: number) => `${n.toFixed(1)}%`;

// Round axis top with 3–5 even steps.
function niceAxis(max: number): { top: number; ticks: number[] } {
  const raw = Math.max(0.5, (max * 1.1) / 4);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? 10 * mag;
  const n = Math.max(2, Math.ceil((max * 1.1) / step));
  return {
    top: +(n * step).toFixed(6),
    ticks: Array.from({ length: n + 1 }, (_, i) => +(i * step).toFixed(6)),
  };
}

function caption(d: ReworkDay, limit: number | null): string {
  const name = formatDayName(d.day);
  if (!d.hasEntry) return `${name}: ${d.isToday ? "today, no entry yet" : "no entry"}`;
  const parts = [
    d.cooking > 0 ? `cooking ${kg(d.cooking)}` : "",
    `making ${kg(d.making)}`,
    `packing ${kg(d.packing)}`,
  ].filter(Boolean);
  let text = `${name}: ${kg(d.kg)} kg rework (${parts.join(" · ")})`;
  if (d.pct != null) {
    text += ` · ${pctText(d.pct)} of making`;
    if (limit != null)
      text += d.pct > limit ? ` — over the ${limit}% limit` : ` — within ${limit}%`;
  } else {
    text += " · no making output";
  }
  return text;
}

function Chip({
  tone,
  label,
  value,
  sub,
  mobileSub,
}: {
  tone: "most" | "least" | "avg";
  label: string;
  value: string;
  sub: string;
  /** Shorter wording for the narrow phone chip. */
  mobileSub?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg px-2.5 py-2 md:px-3",
        tone === "most" && "bg-destructive/10 md:min-w-[150px]",
        tone === "least" && "bg-success/10 md:min-w-[150px]",
        tone === "avg" && "bg-muted/60 md:min-w-[120px]",
      )}
    >
      <dt
        className={cn(
          "text-[11px] font-bold tracking-wide",
          tone === "most" && "text-destructive-strong",
          tone === "least" && "text-success-strong",
          tone === "avg" && "text-muted-foreground",
        )}
      >
        {label}
      </dt>
      <dd className="flex flex-col md:flex-row md:items-baseline md:gap-1.5">
        <span className="text-lg font-bold tabular-nums md:text-xl">{value}</span>
        <span className="text-xs text-muted-foreground md:whitespace-nowrap md:text-[13px]">
          {mobileSub ? (
            <>
              <span className="md:hidden">{mobileSub}</span>
              <span className="hidden md:inline">{sub}</span>
            </>
          ) : (
            sub
          )}
        </span>
      </dd>
    </div>
  );
}

export function ReworkPerDayCard({
  lineName,
  rangeText,
  summary,
}: {
  lineName: string;
  rangeText: string;
  summary: ReworkDaysSummary;
}) {
  const isMobile = useIsMobile();
  const reducedMotion = usePrefersReducedMotion();
  const [mode, setMode] = useState<Mode>("kg");
  const { days, limitPct } = summary;
  const pct = mode === "pct";
  const ext: { most: Extreme | null; least: Extreme | null } = pct ? summary.pct : summary.kg;
  const mostSet = new Set(ext.most?.days ?? []);
  const leastSet = new Set(ext.least?.days ?? []);
  const valueOf = (d: ReworkDay) => (pct ? d.pct : d.hasEntry ? d.kg : null);
  const maxVal = Math.max(
    pct ? (limitPct ?? 0) : 0,
    ...days.map((d) => valueOf(d) ?? 0),
    pct ? 1 : 10,
  );
  const axis = niceAxis(maxVal);
  const stub = axis.top * 0.015;
  const data: Row[] = days.map((d) => {
    const v = valueOf(d);
    const mark: Mark =
      v == null ? "blank" : mostSet.has(d.day) ? "most" : leastSet.has(d.day) ? "least" : "plain";
    return { ...d, value: v, mark, bar: v != null && v > 0 ? v : stub };
  });
  const line = pct ? (limitPct ?? summary.pct.period) : summary.kg.average;
  const lineLabel = pct
    ? limitPct != null
      ? `limit ${limitPct}%`
      : `period ${pctText(summary.pct.period ?? 0)}`
    : `avg ${kg(summary.kg.average ?? 0)} kg`;
  const lineColor =
    pct && limitPct != null ? "var(--color-warning-strong)" : "var(--color-muted-foreground)";
  const fmt = (v: number) => (pct ? pctText(v) : `${kg(v)} kg`);

  // The day the caption talks about: the one tapped, else the worst day,
  // else the latest recorded day. Reset when the line or period changes.
  const sig = `${days[0]?.day}|${days[days.length - 1]?.day}|${lineName}`;
  const [picked, setPicked] = useState<{ sig: string; day: string } | null>(null);
  const lastRecorded = [...days].reverse().find((d) => d.hasEntry)?.day;
  const fallback = summary.kg.most?.days[0] ?? lastRecorded ?? days[days.length - 1]?.day ?? null;
  const pickedDay = picked && picked.sig === sig ? picked.day : fallback;
  const pickedRow = data.find((d) => d.day === pickedDay) ?? null;
  const [hover, setHover] = useState<number | null>(null);

  // Bars pop once per data set (and per view).
  const popSig = `${mode}|` + data.map((d) => `${d.day}:${d.value ?? "-"}`).join("|");
  const step = Math.min(35, 800 / Math.max(1, data.length));
  const [landed, setLanded] = useState<string | null>(null);
  const popping = !reducedMotion && landed !== popSig;
  useEffect(() => {
    if (!popping) return;
    const t = setTimeout(() => setLanded(popSig), 120 + data.length * step + 900);
    return () => clearTimeout(t);
  }, [popping, popSig, data.length, step]);

  const barShape = (props: unknown): ReactElement => {
    const { x = 0, y = 0, width = 0, index = 0, payload } = props as BarShapeProps;
    const isPicked = payload?.day === pickedDay;
    const showNum =
      payload != null &&
      payload.value != null &&
      (payload.mark === "most" || payload.mark === "least" || isPicked) &&
      width >= 9;
    return (
      <g
        data-rework-day={payload?.day}
        data-mark={payload?.mark}
        opacity={hover != null && hover !== index && !isPicked ? 0.45 : 1}
        style={{ transition: "opacity 200ms ease" }}
      >
        <g
          className={popping ? "ds-pop-y" : undefined}
          style={popping ? { animationDelay: `${120 + index * step}ms` } : undefined}
        >
          <Rectangle
            {...(props as object)}
            radius={[3, 3, 0, 0]}
            stroke={isPicked ? "var(--color-foreground)" : "none"}
            strokeWidth={isPicked ? 1.5 : 0}
          />
        </g>
        {showNum && (
          <text
            x={x + width / 2}
            y={y - 5}
            textAnchor="middle"
            fontSize={11}
            fontWeight={700}
            fill={
              payload.mark === "most"
                ? "var(--color-destructive-strong)"
                : payload.mark === "least"
                  ? "var(--color-success-strong)"
                  : "var(--color-foreground)"
            }
          >
            {pct ? pctText(payload.value as number) : kg(payload.value as number)}
          </text>
        )}
      </g>
    );
  };

  const pick = (i: unknown) => {
    const n = Number(i);
    if (!Number.isFinite(n) || !data[n]) return;
    setPicked({ sig, day: data[n].day });
  };

  const recorded = days.some((d) => d.hasEntry);

  return (
    <Card labelledBy="dash-rework-day">
      <div className="flex flex-col gap-2.5 md:flex-row md:items-start md:justify-between md:gap-5">
        <div className="flex min-w-0 flex-col gap-2">
          <div>
            <h3 id="dash-rework-day" className="text-[15px] font-semibold md:text-base">
              Rework per day
            </h3>
            <p className="text-[13px] text-muted-foreground md:text-xs">
              {lineName} · {rangeText} · cooking + making + packing, from the daily entries
            </p>
          </div>
          <div
            role="group"
            aria-label="Show rework as"
            data-pdf-exclude="true"
            className="grid grid-cols-2 gap-0.5 rounded-[10px] bg-muted p-[3px] md:flex md:w-fit"
          >
            {(
              [
                ["kg", "kg"],
                ["pct", "% of making"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={mode === k}
                onClick={() => setMode(k)}
                className={cn(
                  "h-11 rounded-lg px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-[34px]",
                  mode === k
                    ? "bg-card font-semibold text-foreground shadow-sm"
                    : "text-foreground/80 hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {ext.most && (
          <dl className="grid grid-cols-3 gap-2 md:flex md:shrink-0 md:gap-2.5">
            <Chip
              tone="most"
              label="MOST"
              value={fmt(ext.most.value)}
              sub={daysLabel(ext.most.days)}
            />
            <Chip
              tone="least"
              label="LEAST"
              value={ext.least ? fmt(ext.least.value) : "—"}
              sub={ext.least ? daysLabel(ext.least.days) : "every day the same"}
            />
            {pct ? (
              <Chip
                tone="avg"
                label="PERIOD"
                value={summary.pct.period != null ? pctText(summary.pct.period) : "—"}
                sub={
                  limitPct != null
                    ? `${summary.pct.over} of ${summary.pct.counted} days over ${limitPct}%`
                    : "of making"
                }
                mobileSub={
                  limitPct != null
                    ? `${summary.pct.over}/${summary.pct.counted} days over ${limitPct}%`
                    : undefined
                }
              />
            ) : (
              <Chip
                tone="avg"
                label="AVERAGE"
                value={summary.kg.average != null ? `${kg(summary.kg.average)} kg` : "—"}
                sub="a day"
              />
            )}
          </dl>
        )}
      </div>

      {!recorded ? (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          No daily entry in this period yet.
        </p>
      ) : (
        <>
          <div className="h-[200px] w-full md:h-[260px]" data-testid="rework-per-day-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 20, right: 4, left: isMobile ? -2 : 0, bottom: 0 }}
                barCategoryGap={data.length > 40 ? "10%" : "20%"}
                onMouseMove={(st) => {
                  const i = st?.isTooltipActive ? Number(st.activeTooltipIndex) : NaN;
                  setHover(Number.isFinite(i) ? i : null);
                }}
                onMouseLeave={() => setHover(null)}
                onClick={(st) => pick(st?.activeTooltipIndex ?? hover)}
                style={{ cursor: "pointer" }}
              >
                <CartesianGrid vertical={false} stroke="var(--color-border)" />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={{ stroke: "var(--color-border)" }}
                  interval={
                    isMobile ? "preserveStartEnd" : data.length > 31 ? "preserveStartEnd" : 0
                  }
                  minTickGap={isMobile ? 14 : 4}
                  tick={({
                    x,
                    y,
                    payload,
                  }: {
                    x: number;
                    y: number;
                    payload: { value: string };
                  }) => (
                    <text
                      x={x}
                      y={y + 14}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight={payload.value === pickedDay ? 800 : 400}
                      fill="var(--color-foreground)"
                    >
                      {parseDay(payload.value).getDate()}
                    </text>
                  )}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  domain={[0, axis.top]}
                  ticks={axis.ticks}
                  tickFormatter={(v: number) => (pct ? `${v}%` : compactTick(v))}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)" }}
                  isAnimationActive={!reducedMotion}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0].payload as Row;
                    return (
                      <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-card">
                        <p className="font-semibold">{formatDayName(row.day)}</p>
                        {row.hasEntry ? (
                          <>
                            <p className="tabular-nums">
                              {kg(row.kg)} kg · making {kg(row.making)} · packing {kg(row.packing)}
                              {row.cooking > 0 ? ` · cooking ${kg(row.cooking)}` : ""}
                            </p>
                            <p className="tabular-nums text-muted-foreground">
                              {row.pct != null
                                ? `${pctText(row.pct)} of making`
                                : "no making output"}
                            </p>
                          </>
                        ) : (
                          <p className="text-muted-foreground">
                            {row.isToday ? "Today, no entry yet" : "No entry"}
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="bar" isAnimationActive={false} shape={barShape} activeBar={barShape}>
                  {data.map((d) => (
                    <Cell key={d.day} fill={FILL[d.mark]} fillOpacity={OPACITY[d.mark]} />
                  ))}
                </Bar>
                {/* After the bars, so the line and its name sit on top of them. */}
                {line != null && (
                  <ReferenceLine
                    y={line}
                    stroke={lineColor}
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                    label={lineTag(lineLabel, lineColor)}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
          {pickedRow && (
            <p
              data-testid="rework-per-day-caption"
              aria-live="polite"
              className="rounded-lg bg-muted/50 px-3 py-2 text-[13px] tabular-nums md:bg-transparent md:px-0 md:py-0"
            >
              {caption(pickedRow, limitPct)}
              <span className="hidden text-muted-foreground md:inline">
                {" "}
                — tap a bar for its day
              </span>
            </p>
          )}
          <p className="-mt-1 text-xs text-muted-foreground">
            Red = most · green = least · dashed ={" "}
            {pct
              ? limitPct != null
                ? `the ${limitPct}% rework limit (Settings › Targets)`
                : "the period's rework %"
              : "average"}
            . Grey stub = no entry that day, left out of most, least and average.
          </p>
        </>
      )}
    </Card>
  );
}

export default ReworkPerDayCard;
