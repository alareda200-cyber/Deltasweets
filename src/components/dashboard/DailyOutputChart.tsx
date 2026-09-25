import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
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

// One bar per calendar day (every shift row of that day summed), a grey stub
// for a day with no entry, and the plan drawn as a labelled dashed line —
// straight across when every recorded day had the same plan, stepping with
// each day's own plan when it varied.

interface Row {
  day: string;
  bar: number;
  plan: number | null;
  hasEntry: boolean;
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
}: {
  points: DayPoint[];
  stageLabel: string;
}) {
  const isMobile = useIsMobile();
  const reducedMotion = usePrefersReducedMotion();
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
  }));
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
            <Bar dataKey="bar" radius={[3, 3, 0, 0]} isAnimationActive={!reducedMotion}>
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
      </p>
    </div>
  );
}

export default DailyOutputChart;
