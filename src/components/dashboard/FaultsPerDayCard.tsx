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
import { formatDayName, num, parseDay } from "@/lib/dashboard-metrics";
import { daysLabel, type FaultDay, type FaultDaysSummary } from "@/lib/faults-per-day";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { Card } from "./DashboardCards";

// Dashboard › Maintenance › Faults per day. One bar per day; the day with the
// most faults is red, the fewest green, today pale (still running), a day
// that tells us nothing (closed, or no entry and no fault) a grey stub. Tap or
// hover a bar for that day's faults and stopped minutes.

// Whole-number axis with 3–5 even steps (0, 20, 40, 60, 80, 100).
function countAxis(max: number): { top: number; ticks: number[] } {
  const raw = Math.max(1, (max * 1.1) / 4);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? 10 * mag);
  const n = Math.max(2, Math.ceil((max * 1.1) / step));
  return { top: n * step, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
}

const avgText = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");

type Mark = "most" | "fewest" | "today" | "blank" | "plain";

interface Row extends FaultDay {
  bar: number;
  mark: Mark;
}

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  payload?: Row;
}

const FILL: Record<Mark, string> = {
  most: "var(--color-destructive)",
  fewest: "var(--color-success)",
  today: "var(--color-chart-1)",
  blank: "var(--color-muted-foreground)",
  plain: "var(--color-chart-1)",
};
const OPACITY: Record<Mark, number> = { most: 1, fewest: 1, today: 0.4, blank: 0.3, plain: 1 };

function dayNote(d: FaultDay): string {
  if (d.closed) return "non-production day";
  if (d.future) return "not yet";
  if (!d.hasEntry && d.faults === 0) return "no entry, no fault logged";
  return "";
}

function caption(d: FaultDay): string {
  const note = dayNote(d);
  const base =
    note && d.faults === 0
      ? `${formatDayName(d.day)}: ${note}`
      : `${formatDayName(d.day)}: ${num(d.faults)} ${d.faults === 1 ? "fault" : "faults"} · ${num(d.minutes)} min stopped`;
  const extras = [
    d.open > 0 ? `${d.open} still open` : "",
    d.isToday ? "today, so far" : "",
    note && d.faults > 0 ? note : "",
    d.hasEntry || d.faults === 0 ? "" : "no entry",
  ].filter(Boolean);
  return extras.length ? `${base} · ${extras.join(" · ")}` : base;
}

export function FaultsPerDayCard({
  lineName,
  rangeText,
  summary,
  error,
}: {
  lineName: string;
  rangeText: string;
  summary: FaultDaysSummary;
  error: boolean;
}) {
  const isMobile = useIsMobile();
  const reducedMotion = usePrefersReducedMotion();
  const { days, most, fewest, average } = summary;
  const mostSet = new Set(most?.days ?? []);
  const fewestSet = new Set(fewest?.days ?? []);
  const maxVal = Math.max(1, ...days.map((d) => d.faults));
  const stub = maxVal * 0.02;
  const axis = countAxis(maxVal);
  const data: Row[] = days.map((d) => {
    const mark: Mark = mostSet.has(d.day)
      ? "most"
      : fewestSet.has(d.day)
        ? "fewest"
        : d.isToday
          ? "today"
          : !d.counted && d.faults === 0
            ? "blank"
            : "plain";
    return { ...d, mark, bar: d.faults > 0 ? d.faults : stub };
  });

  // The day the caption talks about: the one tapped, else the worst day,
  // else the latest day. Reset when the line or period changes.
  const sig = `${days[0]?.day}|${days[days.length - 1]?.day}|${lineName}`;
  const [picked, setPicked] = useState<{ sig: string; day: string } | null>(null);
  const fallback = most?.days[0] ?? days[days.length - 1]?.day ?? null;
  const pickedDay = picked && picked.sig === sig ? picked.day : fallback;
  const pickedRow = data.find((d) => d.day === pickedDay) ?? null;
  const [hover, setHover] = useState<number | null>(null);

  // Bars pop once per data set, like the daily output chart.
  const popSig = data.map((d) => `${d.day}:${d.faults}`).join("|");
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
      (payload.mark === "most" || payload.mark === "fewest" || isPicked) &&
      width >= 7;
    return (
      <g
        data-fault-day={payload?.day}
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
                : payload.mark === "fewest"
                  ? "var(--color-success-strong)"
                  : "var(--color-foreground)"
            }
          >
            {payload.faults}
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

  return (
    <Card labelledBy="dash-faults-day">
      <div className="flex flex-col gap-2.5 md:flex-row md:items-start md:justify-between md:gap-5">
        <div className="min-w-0">
          <h3 id="dash-faults-day" className="text-[15px] font-semibold md:text-base">
            Faults per day
          </h3>
          <p className="text-[13px] text-muted-foreground md:text-xs">
            {lineName} · {rangeText} · every fault logged, preventive left out
          </p>
        </div>
        {!error && most && (
          <dl className="grid grid-cols-3 gap-2 md:flex md:shrink-0 md:gap-2.5">
            <div className="min-w-0 rounded-lg bg-destructive/10 px-2.5 py-2 md:min-w-[150px] md:px-3">
              <dt className="text-[11px] font-bold tracking-wide text-destructive-strong">MOST</dt>
              <dd className="flex flex-col md:flex-row md:items-baseline md:gap-1.5">
                <span className="text-lg font-bold tabular-nums md:text-xl">
                  {num(most.faults)}
                </span>
                <span className="truncate text-xs text-muted-foreground md:text-[13px]">
                  {daysLabel(most.days)}
                </span>
              </dd>
            </div>
            <div className="min-w-0 rounded-lg bg-success/10 px-2.5 py-2 md:min-w-[150px] md:px-3">
              <dt className="text-[11px] font-bold tracking-wide text-success-strong">FEWEST</dt>
              <dd className="flex flex-col md:flex-row md:items-baseline md:gap-1.5">
                <span className="text-lg font-bold tabular-nums md:text-xl">
                  {fewest ? num(fewest.faults) : "—"}
                </span>
                <span className="truncate text-xs text-muted-foreground md:text-[13px]">
                  {fewest ? daysLabel(fewest.days) : "every day the same"}
                </span>
              </dd>
            </div>
            <div className="min-w-0 rounded-lg bg-muted/60 px-2.5 py-2 md:min-w-[110px] md:px-3">
              <dt className="text-[11px] font-bold tracking-wide text-muted-foreground">AVERAGE</dt>
              <dd className="flex flex-col md:flex-row md:items-baseline md:gap-1.5">
                <span className="text-lg font-bold tabular-nums md:text-xl">
                  {average != null ? avgText(average) : "—"}
                </span>
                <span className="text-xs text-muted-foreground md:text-[13px]">a day</span>
              </dd>
            </div>
          </dl>
        )}
      </div>

      {error ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-strong">
          Couldn't load the faults for {lineName}.
        </p>
      ) : (
        <>
          <div className="h-[200px] w-full md:h-[260px]" data-testid="faults-per-day-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 20, right: 4, left: isMobile ? -18 : -6, bottom: 0 }}
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
                  allowDecimals={false}
                  domain={[0, axis.top]}
                  ticks={axis.ticks}
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
                        <p className="tabular-nums">
                          {num(row.faults)} {row.faults === 1 ? "fault" : "faults"} ·{" "}
                          {num(row.minutes)} min stopped
                        </p>
                        {(row.isToday || dayNote(row)) && (
                          <p className="text-muted-foreground">
                            {row.isToday ? "Today, so far" : dayNote(row)}
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                {average != null && (
                  <ReferenceLine
                    y={average}
                    stroke="var(--color-muted-foreground)"
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                    label={{
                      value: `avg ${avgText(average)}`,
                      position: "insideTopLeft",
                      fontSize: 11,
                      fontWeight: 700,
                      fill: "var(--color-muted-foreground)",
                      dy: -21,
                    }}
                  />
                )}
                <Bar dataKey="bar" isAnimationActive={false} shape={barShape} activeBar={barShape}>
                  {data.map((d) => (
                    <Cell key={d.day} fill={FILL[d.mark]} fillOpacity={OPACITY[d.mark]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {pickedRow && (
            <p
              data-testid="faults-per-day-caption"
              aria-live="polite"
              className={cn(
                "rounded-lg bg-muted/50 px-3 py-2 text-[13px] tabular-nums md:bg-transparent md:px-0 md:py-0",
              )}
            >
              {caption(pickedRow)}
              <span className="hidden text-muted-foreground md:inline">
                {" "}
                — tap a bar for its day
              </span>
            </p>
          )}
          <p className="-mt-1 text-xs text-muted-foreground">
            Red = most · green = fewest · dashed = average. Today (pale) and days with no entry and
            no fault (grey) are left out of most, fewest and average.
          </p>
        </>
      )}
    </Card>
  );
}

export default FaultsPerDayCard;
