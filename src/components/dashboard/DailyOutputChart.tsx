import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Rectangle,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DayPoint } from "@/lib/dashboard-metrics";
import { formatDayName, kg, parseDay, uniformPlan } from "@/lib/dashboard-metrics";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { useEffect, useState, type ReactElement } from "react";

// One bar per calendar day (every shift row of that day summed), a grey stub
// for a day with no entry, and the plan drawn as a labelled dashed line —
// straight across when every recorded day had the same plan, stepping with
// each day's own plan when it varied.

interface Row {
  day: string;
  bar: number;
  plan: number | null;
  hasEntry: boolean;
  /** Recorded day at or above the stage's target (actual ÷ plan). */
  atTarget: boolean;
}

// Five-point star centred on 0,0, outer radius 1 — scaled where it's drawn.
const STAR = Array.from({ length: 10 }, (_, i) => {
  const r = i % 2 === 0 ? 1 : 0.42;
  const a = -Math.PI / 2 + (i * Math.PI) / 5;
  return `${(r * Math.cos(a)).toFixed(3)},${(r * Math.sin(a)).toFixed(3)}`;
}).join(" ");

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  fill?: string;
  fillOpacity?: number;
  payload?: Row;
}

// Round axis top and 3-4 even ticks (0, 10k, 20k, 30k) instead of whatever
// Recharts derives from a padded max.
function niceAxis(max: number): { top: number; ticks: number[] } {
  const raw = (max * 1.08) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const n = Math.ceil((max * 1.08) / step);
  return { top: n * step, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
}

const AXIS_TICK = { fontSize: 12, fill: "var(--color-muted-foreground)" };

function yTick(v: number): string {
  if (v === 0) return "0";
  if (Math.abs(v) >= 1000) return `${Math.round((v / 1000) * 10) / 10}k`;
  return String(v);
}

export function DailyOutputChart({
  points,
  stageLabel,
  targetPct,
}: {
  points: DayPoint[];
  stageLabel: string;
  /** Settings › Targets for this stage (making or packing), in percent. */
  targetPct: number;
}) {
  const isMobile = useIsMobile();
  const reducedMotion = usePrefersReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const flatPlan = uniformPlan(points);
  const maxVal = Math.max(1, ...points.map((p) => Math.max(p.actual ?? 0, p.plan ?? 0)));
  // A visible sliver for "no entry" days, ~1.5% of the axis.
  const stubHeight = maxVal * 0.015;
  const data: Row[] = points.map((p) => ({
    day: p.day,
    // One bar per day: the day's actual, or a short grey stub for no entry.
    bar: p.hasEntry ? (p.actual ?? 0) : stubHeight,
    plan: p.hasEntry && flatPlan == null ? p.plan : null,
    hasEntry: p.hasEntry,
    atTarget:
      p.hasEntry && (p.plan ?? 0) > 0 && ((p.actual ?? 0) / (p.plan ?? 1)) * 100 >= targetPct,
  }));
  const stars = data.filter((d) => d.atTarget).length;
  // Bars pop left to right, 45ms apart, the whole row inside ~0.9s.
  const step = Math.min(45, 900 / Math.max(1, data.length));
  // The pop runs once per data set. Hovering swaps a bar between Recharts'
  // active and resting wrappers, which re-mounts it; once the row has landed
  // the class is gone, so a hovered bar never pops (or sparkles) again.
  const sig = data.map((d) => `${d.day}:${d.bar}:${d.atTarget ? 1 : 0}`).join("|");
  const [landedSig, setLandedSig] = useState<string | null>(null);
  const popping = !reducedMotion && landedSig !== sig;
  useEffect(() => {
    if (!popping) return;
    const t = setTimeout(() => setLandedSig(sig), 120 + data.length * step + 1400);
    return () => clearTimeout(t);
  }, [popping, sig, data.length, step]);

  // One bar: pops up from the axis (new data), dims while another bar is
  // hovered, and carries a star when that day reached the target.
  const barShape = (props: unknown): ReactElement => {
    const { x = 0, y = 0, width = 0, height = 0, index = 0, payload } = props as BarShapeProps;
    const recorded = payload?.hasEntry ?? false;
    const delay = 120 + index * step;
    const size = Math.max(7, Math.min(10, width * 0.6));
    return (
      <g
        data-bar-index={index}
        opacity={hover != null && hover !== index ? 0.35 : 1}
        style={{ transition: "opacity 200ms ease" }}
      >
        <g
          className={recorded && popping ? "ds-pop-y" : undefined}
          style={recorded && popping ? { animationDelay: `${delay}ms` } : undefined}
        >
          <Rectangle {...(props as object)} radius={[3, 3, 0, 0]} />
        </g>
        {payload?.atTarget && (
          <g transform={`translate(${x + width / 2} ${y - size - 4}) scale(${size})`}>
            <polygon
              data-star=""
              aria-hidden="true"
              points={STAR}
              className="ds-sparkle"
              fill="var(--color-warning)"
              stroke="var(--color-card)"
              strokeWidth={1.5 / size}
              // Landed: keep only the twinkle, without the entrance.
              style={
                popping
                  ? { animationDelay: `${delay + 560}ms, ${delay + 1460}ms` }
                  : { animation: "ds-twinkle 1800ms ease-in-out infinite" }
              }
            />
          </g>
        )}
      </g>
    );
  };
  const hasEntryByDay = new Map(data.map((d) => [d.day, d.hasEntry]));
  const { top, ticks } = niceAxis(maxVal);

  return (
    <div>
      <div className="h-[200px] w-full md:h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 22, right: 4, left: isMobile ? -12 : 0, bottom: 0 }}
            barCategoryGap={data.length > 40 ? "10%" : "22%"}
            onMouseMove={(st) => {
              const i = st?.isTooltipActive ? Number(st.activeTooltipIndex) : NaN;
              setHover(Number.isFinite(i) ? i : null);
            }}
            onMouseLeave={() => setHover(null)}
          >
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={{ stroke: "var(--color-border)" }}
              interval={isMobile ? "preserveStartEnd" : data.length > 31 ? "preserveStartEnd" : 0}
              minTickGap={isMobile ? 18 : 4}
              tick={({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => {
                const empty = hasEntryByDay.get(payload.value) === false;
                return (
                  <text
                    x={x}
                    y={y + 14}
                    textAnchor="middle"
                    fontSize={12}
                    fill={empty ? "var(--color-muted-foreground)" : "var(--color-foreground)"}
                    opacity={empty ? 0.7 : 1}
                  >
                    {parseDay(payload.value).getDate()}
                  </text>
                );
              }}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={yTick}
              domain={[0, top]}
              ticks={ticks}
            />
            <Tooltip
              cursor={{ fill: "var(--color-muted)" }}
              isAnimationActive={!reducedMotion}
              // Follows the pointer with a little overshoot instead of a flat ease.
              wrapperStyle={
                reducedMotion ? undefined : { transition: "transform 340ms var(--ease-spring)" }
              }
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as Row;
                const point = points.find((p) => p.day === row.day);
                return (
                  <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-card">
                    <p className="font-semibold">{formatDayName(row.day)}</p>
                    {point?.hasEntry ? (
                      <>
                        <p className="tabular-nums">
                          {stageLabel}: {kg(point.actual ?? 0)} kg
                        </p>
                        <p className="tabular-nums text-muted-foreground">
                          Plan: {kg(point.plan ?? 0)} kg
                          {point.plan
                            ? ` · ${(((point.actual ?? 0) / point.plan) * 100).toFixed(1)}%`
                            : ""}
                        </p>
                      </>
                    ) : (
                      <p className="text-muted-foreground">No entry</p>
                    )}
                  </div>
                );
              }}
            />
            {/* Recharts' own tween is off: the pop is CSS (ds-pop-y, staggered
                per bar), which reduced motion collapses — and the shape skips
                it outright then. */}
            <Bar
              dataKey="bar"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
              shape={barShape}
              activeBar={barShape}
            >
              {data.map((d) => (
                <Cell
                  key={d.day}
                  fill={d.hasEntry ? "var(--color-chart-1)" : "var(--color-muted-foreground)"}
                  fillOpacity={d.hasEntry ? 1 : 0.35}
                />
              ))}
            </Bar>
            {flatPlan != null ? (
              <ReferenceLine
                y={flatPlan}
                stroke="var(--color-foreground)"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                label={{
                  value: isMobile ? `Plan ${kg(flatPlan)}` : `Plan ${kg(flatPlan)} kg / day`,
                  position: "insideTopRight",
                  fontSize: 12,
                  fontWeight: 600,
                  fill: "var(--color-foreground)",
                  dy: -18,
                }}
              />
            ) : (
              // Plans differ from day to day: a short dashed tick across each
              // recorded day's bar at that day's own plan, no connecting line
              // (a line would invent a plan for the days in between).
              <Line
                dataKey="plan"
                stroke="none"
                isAnimationActive={false}
                activeDot={false}
                legendType="none"
                dot={(props: {
                  cx?: number;
                  cy?: number;
                  index?: number;
                  value?: number | null;
                }) => {
                  const { cx, cy, index, value } = props;
                  if (cx == null || cy == null || value == null) return <g key={`p-${index}`} />;
                  const half = isMobile
                    ? 5
                    : Math.max(6, Math.min(14, 300 / Math.max(1, data.length)));
                  return (
                    <line
                      key={`p-${index}`}
                      x1={cx - half}
                      x2={cx + half}
                      y1={cy}
                      y2={cy}
                      stroke="var(--color-foreground)"
                      strokeWidth={2}
                    />
                  );
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {flatPlan != null
          ? "Dashed line = plan, the same on every recorded day · grey stub = no entry"
          : "Plan differs by day: each dark tick is that day's plan · grey stub = no entry"}
        {stars > 0 && ` · ★ = at or above the ${targetPct}% target`}
      </p>
    </div>
  );
}

export default DailyOutputChart;
