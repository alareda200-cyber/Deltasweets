import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import type { DailyEntry } from "@/lib/queries";
import { KpiCard } from "./KpiCard";
import { fmt } from "@/lib/date-utils";
import { RotateCcw, Percent } from "lucide-react";

interface Props {
  entries: DailyEntry[];
}

export function ReworkSection({ entries }: Props) {
  const cooking = entries.reduce((s, e) => s + Number(e.rework_cooking), 0);
  const making = entries.reduce((s, e) => s + Number(e.rework_making), 0);
  const packing = entries.reduce((s, e) => s + Number(e.rework_packing), 0);
  const total = cooking + making + packing;
  const actual = entries.reduce((s, e) => s + Number(e.making_actual), 0);
  const reworkPct = actual > 0 ? (total / actual) * 100 : 0;

  // Last day
  const last = entries[entries.length - 1];
  const dayEntries = last ? entries.filter((e) => e.entry_date === last.entry_date) : [];
  const dCooking = dayEntries.reduce((s, e) => s + Number(e.rework_cooking), 0);
  const dMaking = dayEntries.reduce((s, e) => s + Number(e.rework_making), 0);
  const dPacking = dayEntries.reduce((s, e) => s + Number(e.rework_packing), 0);
  const dTotal = dCooking + dMaking + dPacking;
  const dActual = dayEntries.reduce((s, e) => s + Number(e.making_actual), 0);
  const dPct = dActual > 0 ? (dTotal / dActual) * 100 : 0;

  const data = [
    { area: "Cooking", kg: cooking, hue: 30 },
    { area: "Making / Depositing", kg: making, hue: 260 },
    { area: "Packing", kg: packing, hue: 160 },
  ];

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <header className="mb-6">
        <h2 className="text-xl font-bold tracking-tight md:text-2xl">
          4. Rework Quantities by Area
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Material returned to process for reprocessing
        </p>
      </header>

      {/* MTD */}
      <div className="mb-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-primary">
          Month to Date
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
          <KpiCard label="Cooking (kg)" value={fmt(cooking)} variant="primary" />
          <KpiCard label="Making (kg)" value={fmt(making)} variant="primary" />
          <KpiCard label="Packing (kg)" value={fmt(packing)} variant="primary" />
          <KpiCard label="Total (kg)" value={fmt(total)} icon={RotateCcw} variant="primary" />
          <KpiCard
            label="% of Output"
            value={`${reworkPct.toFixed(1)}%`}
            icon={Percent}
            variant={reworkPct < 5 ? "success" : reworkPct < 15 ? "warning" : "danger"}
          />
        </div>
      </div>

      {/* Last Day */}
      <div className="mb-6">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {last ? `Last Day · ${last.entry_date}` : "Last Day · (no entries)"}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
          <KpiCard label="Cooking (kg)" value={fmt(dCooking)} />
          <KpiCard label="Making (kg)" value={fmt(dMaking)} />
          <KpiCard label="Packing (kg)" value={fmt(dPacking)} />
          <KpiCard label="Total (kg)" value={fmt(dTotal)} />
          <KpiCard
            label="% of Output"
            value={`${dPct.toFixed(1)}%`}
            variant={dPct < 5 ? "success" : dPct < 15 ? "warning" : "danger"}
          />
        </div>
      </div>

      <div className="h-[180px] w-full md:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 24, right: 8, bottom: 0, left: -8 }}>
            <defs>
              {data.map((d, i) => (
                <linearGradient key={i} id={`rw3d-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={`oklch(0.78 0.17 ${d.hue})`} />
                  <stop offset="50%" stopColor={`oklch(0.62 0.18 ${d.hue})`} />
                  <stop offset="100%" stopColor={`oklch(0.42 0.16 ${d.hue})`} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="area" tick={{ fontSize: 12, fill: "var(--color-foreground)" }} />
            <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
            <Tooltip
              contentStyle={{
                background: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(v: number) => [`${fmt(v)} kg`, "Rework"]}
            />
            <Bar dataKey="kg" radius={[8, 8, 0, 0]} stroke="rgba(0,0,0,0.15)" strokeWidth={1}>
              {data.map((_, i) => (
                <Cell key={i} fill={`url(#rw3d-${i})`} />
              ))}
              <LabelList
                dataKey="kg"
                position="top"
                formatter={(v: number) => fmt(v)}
                style={{ fontSize: 11, fill: "var(--color-foreground)", fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
