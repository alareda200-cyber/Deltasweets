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
import type { ProductionArea, AreaOwner, EntryAreaOwner } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

interface Props {
  productionAreas: ProductionArea[];
  areaOwners: AreaOwner[];
  entryAreaOwners: EntryAreaOwner[];
}

// Ranking is based entirely on the Performance Score entered per (Production
// Area, Owner) on the Entry screen — a manual, official KPI. No rework, no
// derived percentage of any kind is used here; this card only averages
// numbers a person already typed in.
export function TopQualityAreaCard({ productionAreas, areaOwners, entryAreaOwners }: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const scored = entryAreaOwners.filter((o) => o.performance_score != null);

  const ranked = (() => {
    const byPair = new Map<
      string,
      { area: ProductionArea; owner: AreaOwner | null; total: number; count: number }
    >();
    for (const row of scored) {
      const area = productionAreas.find((a) => a.id === row.production_area_id);
      if (!area) continue; // area may have been deleted/deactivated since the entry was logged
      const owner = row.owner_id ? (areaOwners.find((o) => o.id === row.owner_id) ?? null) : null;
      const key = `${row.production_area_id}|${row.owner_id ?? "unassigned"}`;
      const cur = byPair.get(key);
      if (cur) {
        cur.total += Number(row.performance_score);
        cur.count += 1;
      } else byPair.set(key, { area, owner, total: Number(row.performance_score), count: 1 });
    }
    return Array.from(byPair.values())
      .map((r) => ({ ...r, avg: r.total / r.count }))
      .sort((a, b) => b.avg - a.avg);
  })();

  const best = ranked[0];
  const chartData = ranked.slice(0, 8).map((r) => ({
    name: `${r.area.name} · ${r.owner?.name ?? "Unassigned"}`,
    score: Math.round(r.avg * 100) / 100,
  }));

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <header className="mb-6">
        <h2 className="text-xl font-bold tracking-tight md:text-2xl">Top Quality Area Owner</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Ranked by average entered Performance Score for the selected period
        </p>
      </header>

      {!best ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No Performance Score has been entered for any area/owner in this period yet.
        </div>
      ) : (
        <>
          {/* Four identical boxes held four unrelated things: a person, a place,
              a percentage and a count. They are not four KPIs — they are one
              fact split across four containers that all shout equally. And
              "best" means nothing without the field, which the ranked chart
              below already shows, so the boxes were competing with it. */}
          <div className="mb-6 rounded-xl border border-border bg-gradient-to-br from-primary/10 to-primary/[0.02] p-4 md:p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Best area owner
            </p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xl font-bold tracking-tight md:text-2xl">
                  {best.owner?.name ?? "Unassigned"}
                </p>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {best.area.name} · <span className="font-mono tabular-nums">{best.count}</span>{" "}
                  {best.count === 1 ? "entry" : "entries"}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={cn(
                    "font-mono text-3xl font-medium tracking-[-0.045em] tabular-nums md:text-4xl",
                    best.avg >= 95
                      ? "text-success-strong"
                      : best.avg >= 85
                        ? "text-warning-strong"
                        : "text-destructive-strong",
                  )}
                >
                  {best.avg.toFixed(2)}%
                </p>
                <p className="text-[11px] text-muted-foreground">average performance</p>
              </div>
            </div>
            {ranked.length > 1 && (
              // The count is not a KPI — it is how much evidence this average
              // rests on. The gap to second place is the part that is actually
              // interesting, and it had nowhere to live before.
              <p className="mt-3 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                Leads by{" "}
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {(best.avg - ranked[1].avg).toFixed(2)} pt
                </span>{" "}
                over {ranked[1].owner?.name ?? "Unassigned"} · {ranked.length} owners ranked
              </p>
            )}
          </div>

          <div className="h-[200px] w-full md:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 8, right: 30, left: 8, bottom: 8 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={160}
                  tick={{ fontSize: 11, fill: "var(--color-foreground)" }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [`${v}%`, "Avg. Performance"]}
                />
                <Bar
                  isAnimationActive={!reducedMotion}
                  dataKey="score"
                  radius={[0, 6, 6, 0]}
                  fill="var(--color-success)"
                >
                  <LabelList
                    dataKey="score"
                    position="right"
                    formatter={(v: number) => `${v}%`}
                    style={{ fontSize: 11, fill: "var(--color-foreground)", fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </section>
  );
}
