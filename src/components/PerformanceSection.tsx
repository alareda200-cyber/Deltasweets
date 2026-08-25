import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { DailyEntry } from "@/lib/queries";
import { KpiCard } from "./KpiCard";
import { fmt, pct } from "@/lib/date-utils";
import { TrendingUp, TrendingDown, Target, Percent } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

interface Props {
  title: string;
  subtitle: string;
  entries: DailyEntry[];
  field: "making" | "packing";
  accentColor: string;
}

// Dot colour = that day's adherence band. Deliberately the same three
// tokens and the same cut-offs as the Adherence KpiCard.
function adhDotColor(adh: number) {
  if (adh >= 0.9) return "var(--color-success)";
  if (adh >= 0.7) return "var(--color-warning)";
  return "var(--color-destructive)";
}

export function PerformanceSection({ title, subtitle, entries, field, accentColor }: Props) {
  const isMobile = useIsMobile();
  const planKey = field === "making" ? "making_plan" : "packing_plan";
  const actualKey = field === "making" ? "making_actual" : "packing_actual";

  const monthPlan = entries.reduce((s, e) => s + Number(e[planKey]), 0);
  const monthActual = entries.reduce((s, e) => s + Number(e[actualKey]), 0);
  const monthVar = monthActual - monthPlan;
  const monthAdh = monthPlan > 0 ? monthActual / monthPlan : 0;

  // "Last day" — every row sharing the most recent entry_date (a line can
  // have more than one shift entered for the same day), not just the single
  // last array element after the ascending sort. Same aggregation
  // DowntimeSection/ReworkSection already use for their own "Last Day"
  // blocks, so all three sections on this dashboard agree on what one
  // calendar day's numbers actually add up to instead of Performance
  // silently showing just one shift's worth.
  const last = entries[entries.length - 1];
  const dayEntries = last ? entries.filter((e) => e.entry_date === last.entry_date) : [];
  const dayPlan = dayEntries.reduce((s, e) => s + Number(e[planKey]), 0);
  const dayActual = dayEntries.reduce((s, e) => s + Number(e[actualKey]), 0);
  const dayVar = dayActual - dayPlan;
  const dayAdh = dayPlan > 0 ? dayActual / dayPlan : 0;

  const chartData = entries.map((e) => {
    const plan = Number(e[planKey]);
    const actual = Number(e[actualKey]);
    return {
      date: e.entry_date.slice(5),
      Plan: plan,
      Actual: actual,
      // Adherence drives the dot colour below. Same 0.9 / 0.7 cut-offs as
      // the Adherence KpiCard above, so the chart and the card can never
      // disagree about what a good day is.
      adh: plan > 0 ? actual / plan : 0,
    };
  });

  // Only meaningful when there is more than one day and they actually
  // differ — otherwise every dot would claim to be both best and worst.
  let worstIdx = -1;
  let bestIdx = -1;
  if (chartData.length > 1) {
    worstIdx = 0;
    bestIdx = 0;
    chartData.forEach((d, i) => {
      if (d.adh < chartData[worstIdx].adh) worstIdx = i;
      if (d.adh > chartData[bestIdx].adh) bestIdx = i;
    });
    if (worstIdx === bestIdx) {
      worstIdx = -1;
      bestIdx = -1;
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight md:text-2xl">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </header>

      {/* MTD line — emphasized */}
      <div className="mb-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-primary">
          Month to Date
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard
            label="Plan (kg)"
            value={fmt(monthPlan)}
            icon={Target}
            variant="primary"
            className="p-3 md:p-5"
          />
          <KpiCard
            label="Actual (kg)"
            value={fmt(monthActual)}
            icon={TrendingUp}
            variant="primary"
            className="p-3 md:p-5"
          />
          <KpiCard
            label="Variance"
            value={fmt(monthVar)}
            icon={monthVar >= 0 ? TrendingUp : TrendingDown}
            variant={monthVar >= 0 ? "success" : "danger"}
            className="p-3 md:p-5"
            delta={monthPlan > 0 ? `${((monthVar / monthPlan) * 100).toFixed(1)}%` : undefined}
            deltaTone={monthVar >= 0 ? "good" : "bad"}
          />
          <KpiCard
            label="Adherence"
            value={pct(monthAdh)}
            icon={Percent}
            variant={monthAdh >= 0.9 ? "success" : monthAdh >= 0.7 ? "warning" : "danger"}
            className="p-3 md:p-5"
            meter={monthAdh}
            meterLabel="target 90.0%"
          />
        </div>
      </div>

      {/* Last day line — secondary */}
      <div className="mb-6">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {last ? `Last Day · ${last.entry_date}` : "Last Day · (no entries)"}
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Plan (kg)" value={fmt(dayPlan)} className="p-3 md:p-5" />
          <KpiCard label="Actual (kg)" value={fmt(dayActual)} className="p-3 md:p-5" />
          <KpiCard
            label="Variance"
            value={fmt(dayVar)}
            variant={dayVar >= 0 ? "success" : "danger"}
            className="p-3 md:p-5"
          />
          <KpiCard
            label="Adherence"
            value={pct(dayAdh)}
            variant={dayAdh >= 0.9 ? "success" : dayAdh >= 0.7 ? "warning" : "danger"}
            className="p-3 md:p-5"
          />
        </div>
      </div>

      {/* Chart */}
      <div>
        <p className="text-sm font-semibold">Daily Plan vs Actual (kg)</p>
        <p className="mb-3 text-xs text-muted-foreground">
          Actual dot colour = that day&apos;s adherence — green ≥ 90%, amber 70–89%, red &lt; 70%.
          The two ringed dots are the best and worst day of the period.
        </p>
        <div className="h-[200px] w-full md:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
              {/* Solid hairline, not dashed. The dashed Plan line is carrying meaning;
                  a dashed grid competes with it for the same visual language. */}
              <CartesianGrid stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              />
              {/* 8% headroom so the Plan line never renders flat against the
                  top edge of the plot area, which made it read as clipped.
                  The headroom is then rounded up to a clean step (not just
                  the nearest integer) so Recharts keeps even tick spacing. */}
              <YAxis
                domain={[
                  0,
                  (dataMax: number) => {
                    const raw = dataMax * 1.08;
                    if (!Number.isFinite(raw) || raw <= 0) return 0;
                    const step = 10 ** Math.max(0, Math.floor(Math.log10(raw)) - 1);
                    return Math.ceil(raw / step) * step;
                  },
                ]}
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number, name: string, item: { payload?: { adh: number } }) =>
                  name === "Actual"
                    ? [`${fmt(value)} kg · ${pct(item.payload?.adh ?? 0)} adherence`, name]
                    : [`${fmt(value)} kg`, name]
                }
              />
              {/* Hidden on mobile to save vertical space — Plan/Actual are
                  still distinguishable via the tooltip and the section's own
                  labeling. Unlike the CSS-only tweaks elsewhere in this
                  redesign, this is a JS conditional (not just display:none),
                  so a PDF export triggered from an actual mobile device won't
                  have this legend in the captured image (pdf-export.ts's
                  forced desktop-width capture can restore a CSS-hidden
                  element, but can't resurrect one React never rendered). */}
              {!isMobile && <Legend wrapperStyle={{ fontSize: 12 }} />}
              <ReferenceLine
                y={monthPlan / Math.max(entries.length, 1)}
                stroke="var(--color-muted-foreground)"
                strokeDasharray="4 4"
              />
              {/* `linear`, not `monotone`. Plan and Actual are one discrete
                  measurement per day; a monotone spline draws a smooth curve
                  *through* values that were never recorded — on a day with a
                  sharp drop it renders a plausible-looking dip either side of
                  the real point, which reads as production data. Straight
                  segments show only what was entered.
                  Plan is also dashed: two solid lines separated by colour
                  alone fail "don't convey information by colour only", and the
                  legend is suppressed on mobile (above), so line style is the
                  only cue a phone user gets. */}
              <Line
                type="linear"
                dataKey="Plan"
                stroke="var(--color-muted-foreground)"
                strokeWidth={2}
                strokeDasharray="6 4"
                // Recharts hands the Line's own props to its dots, so the dash
                // pattern was being applied to each 2.5px circle and rendering
                // them as chevrons. Reset it on the dot only.
                dot={{ r: 2.5, strokeDasharray: "none" }}
                activeDot={{ r: 4, strokeDasharray: "none" }}
              />
              <Line
                type="linear"
                dataKey="Actual"
                stroke={accentColor}
                strokeWidth={2.5}
                // Colour alone can't carry this (colour-blind users, greyscale PDF
                // export), so best/worst also get a bigger radius and a ring.
                dot={(props: {
                  cx?: number;
                  cy?: number;
                  index?: number;
                  payload?: { adh: number };
                }) => {
                  const { cx, cy, index = 0, payload } = props;
                  if (cx == null || cy == null || !payload) return <g key={index} />;
                  const extreme = index === worstIdx || index === bestIdx;
                  return (
                    <circle
                      key={index}
                      cx={cx}
                      cy={cy}
                      r={extreme ? 5.5 : 3.5}
                      fill={adhDotColor(payload.adh)}
                      stroke="var(--color-card)"
                      strokeWidth={extreme ? 2.5 : 1}
                    />
                  );
                }}
                activeDot={{ r: 6, strokeDasharray: "none" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
