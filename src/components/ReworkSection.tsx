import type { DailyEntry } from "@/lib/queries";
import { KpiCard } from "./KpiCard";
import { fmt } from "@/lib/date-utils";
import { Percent } from "lucide-react";

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

  // Packing was hue 160 — oklch(0.62 0.18 160) resolves to #00a55e, which is
  // OKLab dE 1.8 from --success (#04ab62). A category slice was wearing the
  // colour this dashboard uses to mean "good", on a card about defects.
  // Magenta carries no status meaning anywhere in the palette. Validated as a
  // triad (validate_palette.py, light/white): all checks pass, worst adjacent
  // dE 9.6 protan / 20.6 normal / 23.6 tritan, and the legend prints each
  // area's name and kg, so colour is never the only channel.
  const data = [
    { area: "Cooking", kg: cooking, hue: 30 },
    { area: "Making / Depositing", kg: making, hue: 260 },
    { area: "Packing", kg: packing, hue: 330 },
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
        {/* Cooking, Making and Packing are three slices of Total. Putting
            Total in a fourth identical box asked the reader to do the
            addition and then check it. One bar says "Cooking is about half
            of rework" at a glance, and the three numbers are still printed.
            % of Output is the only figure here that judges anything, so it
            is the one that keeps a card. */}
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Rework by stage
              </p>
              <p className="font-mono text-lg font-medium tracking-[-0.045em] tabular-nums">
                {fmt(total)} <span className="text-xs text-muted-foreground">kg total</span>
              </p>
            </div>
            {total > 0 ? (
              <>
                <div className="mt-3 flex h-6 overflow-hidden rounded-lg">
                  {data.map((d, i) => (
                    <div
                      key={d.area}
                      className="box-border"
                      style={{
                        width: `${(d.kg / total) * 100}%`,
                        background: `oklch(0.62 0.18 ${d.hue})`,
                        // A card-coloured right edge instead of a flex `gap`:
                        // the widths are percentages that already total 100%,
                        // so a gap would push the last slice past the track.
                        // border-box keeps each slice's share exact.
                        borderRight:
                          i < data.length - 1 ? "2px solid var(--color-card)" : undefined,
                      }}
                    />
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                  {data.map((d) => (
                    <span key={d.area} className="inline-flex items-center gap-1.5 text-xs">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: `oklch(0.62 0.18 ${d.hue})` }}
                      />
                      <span className="text-muted-foreground">{d.area}</span>
                      <span className="font-mono font-semibold tabular-nums">{fmt(d.kg)}</span>
                      <span className="text-muted-foreground">
                        ({total > 0 ? ((d.kg / total) * 100).toFixed(1) : "0.0"}%)
                      </span>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No rework logged in this period.</p>
            )}
          </div>
          <KpiCard
            label="% of Output"
            value={`${reworkPct.toFixed(2)}%`}
            icon={Percent}
            variant={reworkPct < 1 ? "success" : reworkPct < 3 ? "warning" : "danger"}
            // Scaled to 5% full-scale, not 100% — at a 100% scale a 1.13%
            // rework rate would be an invisible sliver.
            meter={Math.min(1, reworkPct / 5)}
            meterLabel={`${fmt(total)} kg of ${fmt(actual)} produced`}
          />
        </div>
      </div>

      {/* Last Day */}
      <div className="mb-6">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {last ? `Last Day · ${last.entry_date}` : "Last Day · (no entries)"}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-5">
          <KpiCard label="Cooking (kg)" value={fmt(dCooking)} className="p-3 md:p-5" />
          <KpiCard label="Making (kg)" value={fmt(dMaking)} className="p-3 md:p-5" />
          <KpiCard label="Packing (kg)" value={fmt(dPacking)} className="p-3 md:p-5" />
          <KpiCard label="Total (kg)" value={fmt(dTotal)} className="p-3 md:p-5" />
          <KpiCard
            label="% of Output"
            value={`${dPct.toFixed(1)}%`}
            variant={dPct < 5 ? "success" : dPct < 15 ? "warning" : "danger"}
            className="p-3 md:p-5"
          />
        </div>
      </div>
    </section>
  );
}
