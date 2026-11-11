// "Reading the line": a short paragraph written from one line's numbers for
// the period (Plant floor › line room). It says how making went against its
// target, names the step that misses its target by the most (time lost,
// rework, packing or making), the reason that cost the most time, and where
// the OEE goes. Pure, so it can be tested; every figure is one the page shows.

import type { ReasonRow, TimeSplit, Totals } from "@/lib/dashboard-metrics";
import type { LineOeeResult } from "@/lib/line-oee";
import type { ProductionTargets } from "@/lib/queries";

const kg = (n: number) => Math.round(n).toLocaleString("en-US");
const p1 = (r: number) => `${(r * 100).toFixed(1)}%`;
const pts = (n: number) => `${Math.abs(n).toFixed(1)} points`;
const minText = (m: number) => {
  const r = Math.round(m);
  return r < 60 ? `${r} min` : `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, "0")} min`;
};

export type Weakest = "loss" | "rework" | "packing" | "making" | null;

export interface Reading {
  text: string;
  weakest: Weakest;
}

export function readLine(a: {
  name: string;
  days: number;
  totals: Totals;
  split: TimeSplit;
  reasons: ReasonRow[];
  targets: ProductionTargets;
  oee: LineOeeResult | null;
}): Reading {
  const { name, days, totals: t, split, reasons, targets, oee } = a;
  const out: string[] = [];
  const dayWord = `${days} production day${days === 1 ? "" : "s"}`;

  const mk = t.makingPlan > 0 ? t.makingActual / t.makingPlan : null;
  if (mk == null) {
    out.push(`${name} made ${kg(t.makingActual)} kg in ${dayWord}; no making plan was entered.`);
  } else {
    const gap = mk * 100 - targets.makingPct;
    out.push(
      `${name} made ${p1(mk)} of its making plan in ${dayWord} (${kg(t.makingActual)} of ${kg(t.makingPlan)} kg), ` +
        (Math.abs(gap) < 0.05
          ? `right on the ${targets.makingPct}% target.`
          : `${pts(gap)} ${gap > 0 ? "above" : "below"} the ${targets.makingPct}% target.`),
    );
  }

  // How far each step misses its target, as a ratio (> 1 = missed).
  const lost = t.availableMin > 0 ? split.total / t.availableMin : null;
  const rework = t.reworkCooking + t.reworkMaking + t.reworkPacking;
  const rw = t.makingActual > 0 ? rework / t.makingActual : null;
  const pk = t.packingPlan > 0 ? t.packingActual / t.packingPlan : null;
  const misses: [Exclude<Weakest, null>, number][] = [];
  if (lost != null && targets.lossPct > 0) misses.push(["loss", (lost * 100) / targets.lossPct]);
  if (rw != null && targets.reworkPct != null && targets.reworkPct > 0)
    misses.push(["rework", (rw * 100) / targets.reworkPct]);
  if (pk != null && pk > 0) misses.push(["packing", targets.packingPct / (pk * 100)]);
  if (mk != null && mk > 0) misses.push(["making", targets.makingPct / (mk * 100)]);
  const worst = misses.filter(([, r]) => r > 1).sort((x, y) => y[1] - x[1])[0];
  const weakest: Weakest = worst ? worst[0] : null;

  const top = reasons.find((r) => r.minutes > 0) ?? null;
  const topText = top
    ? `${top.name} took the most time: ${minText(top.minutes)}${top.count > 1 ? ` over ${top.count} stops` : ""}.`
    : "";

  if (weakest === "loss" && lost != null) {
    const unplanned = split.total > 0 ? split.unplanned / split.total : 0;
    out.push(
      `Time lost is the step to look at: ${p1(lost)} of the available minutes, over the ${targets.lossPct}% alert, and ${Math.round(unplanned * 100)}% of it unplanned.`,
    );
    if (topText) out.push(topText);
  } else if (weakest === "rework" && rw != null) {
    out.push(
      `Rework is the step to look at: ${p1(rw)} of making (${kg(rework)} kg), over the ${targets.reworkPct}% limit.`,
    );
    if (topText) out.push(topText);
  } else if (weakest === "packing" && pk != null) {
    out.push(
      `Packing is the step to look at: ${p1(pk)} of its plan against a ${targets.packingPct}% target.`,
    );
    if (topText) out.push(topText);
  } else if (weakest === "making") {
    if (topText) out.push(topText);
  } else {
    out.push(
      lost != null
        ? `Every target is met: time lost is ${p1(lost)} of the available minutes.`
        : "Every target is met.",
    );
    if (topText) out.push(topText);
  }

  if (oee?.oee != null && oee.A != null && oee.P != null && oee.Q != null) {
    const steps: [string, number][] = [
      ["availability", oee.A],
      ["performance", oee.P],
      ["quality", oee.Q],
    ];
    const low = [...steps].sort((x, y) => x[1] - y[1])[0];
    out.push(
      `OEE is ${p1(oee.oee)}: availability ${p1(oee.A)}, performance ${p1(oee.P)}, quality ${p1(oee.Q)}` +
        (low[1] < 1 ? `; ${low[0]} takes the most.` : "."),
    );
  }
  return { text: out.join(" "), weakest };
}
