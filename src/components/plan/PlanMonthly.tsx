// Plan adherence › Monthly (approved mockup "Plan adherence upgrade v2",
// 28 Oct 2026): packed tons month by month for the plant and each line. The
// cards compare tons per working day, so a month that isn't over compares
// fairly with whole ones.
import { cn } from "@/lib/utils";
import type { MonthTons } from "@/lib/plan-adherence";
import { monthShort, shortDay, tons } from "@/components/plan/format";

const perDay = (kg: number, days: number) => (days > 0 ? kg / 1000 / days : null);

function Spark({ values, color }: { values: (number | null)[]; color: string }) {
  const pts = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length === 0) return <div className="h-14" />;
  const max = Math.max(...pts.map((p) => p.v)) * 1.1 || 1;
  const n = Math.max(1, values.length - 1);
  const X = (i: number) => 4 + (i / n) * 192;
  const Y = (v: number) => 52 - (v / max) * 46;
  const line = pts.map((p) => `${X(p.i)},${Y(p.v)}`).join(" ");
  const area = `${X(pts[0].i)},56 ${line} ${X(pts[pts.length - 1].i)},56`;
  const last = pts[pts.length - 1];
  return (
    <svg viewBox="0 0 200 58" className="h-14 w-full" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={area} fill={color} opacity={0.12} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      {pts.map((p) => (
        <circle key={p.i} cx={X(p.i)} cy={Y(p.v)} r={p === last ? 3.5 : 2} fill={color} />
      ))}
    </svg>
  );
}

export function PlanMonthly({
  months,
  lineName,
  color,
}: {
  months: MonthTons[];
  lineName: (id: string | null) => string;
  color: (id: string | null) => string;
}) {
  const shown = months.filter((m) => m.totalKg > 0);
  if (shown.length === 0)
    return (
      <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
        No packed SKUs in these months. Upload the FG workbook to fill them.
      </p>
    );
  const lineTotals = new Map<string, number>();
  for (const m of shown)
    for (const [id, kg] of m.byLine) lineTotals.set(id, (lineTotals.get(id) ?? 0) + kg);
  const lineIds = [...lineTotals.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const cards: { id: string | null; label: string; color: string; values: (number | null)[] }[] = [
    {
      id: null,
      label: "Plant",
      color: "var(--color-foreground)",
      values: shown.map((m) => perDay(m.totalKg, m.workingDays)),
    },
    ...lineIds.slice(0, 3).map((id) => ({
      id,
      label: lineName(id),
      color: color(id),
      values: shown.map((m) => perDay(m.byLine.get(id) ?? 0, m.workingDays)),
    })),
  ];
  const totalKg = shown.reduce((s, m) => s + m.totalKg, 0);
  const totalDays = shown.reduce((s, m) => s + m.workingDays, 0);
  const best = [...shown].filter((m) => !m.partial).sort((a, b) => b.totalKg - a.totalKg)[0];
  const partial = shown.find((m) => m.partial);
  const maxTotal = Math.max(...shown.map((m) => m.totalKg), 1);

  return (
    <section
      className="min-w-0 rounded-2xl border border-border bg-card p-3 shadow-card md:p-4"
      data-testid="plan-monthly"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold md:text-base">
          {monthShort(shown[0].month)} – {monthShort(shown[shown.length - 1].month)} · month by
          month
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {tons(totalKg)} t · {totalDays} working days
          {best ? ` · best ${monthShort(best.month)} ${tons(best.totalKg)} t` : ""}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        {cards.map((c) => {
          const vals = c.values;
          const last = vals[vals.length - 1];
          const prev = vals.length > 1 ? vals[vals.length - 2] : null;
          const diff = last !== null && prev !== null ? last - prev : null;
          return (
            <div
              key={c.id ?? "plant"}
              className="min-w-0 rounded-xl border border-border p-2.5 md:p-3"
            >
              <p className="flex items-baseline justify-between gap-1">
                <span className="truncate text-xs font-semibold">{c.label} · t / working day</span>
              </p>
              <p className="flex items-baseline gap-2">
                <span className="text-lg font-extrabold tabular-nums md:text-xl">
                  {last === null ? "—" : `${last.toFixed(1)} t`}
                </span>
                {diff !== null && (
                  <span
                    className={cn(
                      "text-[11px] font-bold tabular-nums",
                      diff >= 0 ? "text-success-strong" : "text-destructive-strong",
                    )}
                  >
                    {diff >= 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)} vs{" "}
                    {monthShort(shown[shown.length - 2].month)}
                  </span>
                )}
              </p>
              <Spark values={vals} color={c.color} />
            </div>
          );
        })}
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] text-sm" data-testid="plan-monthly-table">
          <thead className="bg-muted/60 text-[11.5px] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Month</th>
              {lineIds.map((id) => (
                <th key={id} className="px-2 py-2 text-right font-semibold">
                  {lineName(id)}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-semibold">Total t</th>
              <th className="px-2 py-2 text-left font-semibold">Local / export</th>
              <th className="px-2 py-2 text-right font-semibold">Days</th>
              <th className="px-3 py-2 text-right font-semibold">t / day</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.month} className="border-t border-border">
                <td className="px-3 py-2 font-semibold">
                  {monthShort(m.month)}
                  {m.partial ? "*" : ""}
                </td>
                {lineIds.map((id) => (
                  <td key={id} className="px-2 py-2 text-right tabular-nums">
                    {m.byLine.get(id) ? tons(m.byLine.get(id)!) : "—"}
                  </td>
                ))}
                <td className="px-2 py-2 text-right font-bold tabular-nums">{tons(m.totalKg)}</td>
                <td className="px-2 py-2">
                  <span
                    className="flex h-2 w-28 overflow-hidden rounded-full bg-muted"
                    aria-hidden="true"
                  >
                    <span
                      className="bg-primary"
                      style={{ width: `${(m.localKg / maxTotal) * 100}%` }}
                    />
                    <span
                      className="bg-warning-strong"
                      style={{ width: `${(m.exportKg / maxTotal) * 100}%` }}
                    />
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {tons(m.exportKg)} t export
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{m.workingDays}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {m.workingDays > 0 ? (m.totalKg / 1000 / m.workingDays).toFixed(1) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {partial && partial.lastDay
          ? `* ${monthShort(partial.month)} to ${shortDay(partial.lastDay)}. `
          : ""}
        Working days are Saturday to Thursday less days off; all lines, local and export.
      </p>
    </section>
  );
}
