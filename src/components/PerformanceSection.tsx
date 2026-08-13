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

  const chartData = entries.map((e) => ({
    date: e.entry_date.slice(5),
    Plan: Number(e[planKey]),
    Actual: Number(e[actualKey]),
  }));

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
          />
          <KpiCard
            label="Adherence"
            value={pct(monthAdh)}
            icon={Percent}
            variant={monthAdh >= 0.9 ? "success" : monthAdh >= 0.7 ? "warning" : "danger"}
            className="p-3 md:p-5"
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
        <p className="mb-3 text-sm font-semibold">Daily Plan vs Actual (kg)</p>
        <div className="h-[200px] w-full md:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <Tooltip
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
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
              <Line
                type="monotone"
                dataKey="Plan"
                stroke="var(--color-muted-foreground)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="Actual"
                stroke={accentColor}
                strokeWidth={2.5}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
