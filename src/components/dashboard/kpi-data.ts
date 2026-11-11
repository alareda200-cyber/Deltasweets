// The four KPI tiles' numbers and words (Making, Packing, Time lost, Rework).
// Shared by the Dashboard and the Plant floor's line room, so both show the
// same figures from the same totals. Moved from src/routes/index.tsx as is.
import {
  adherenceTone,
  kg,
  lossTone,
  num,
  packingVariance,
  pct1,
  ratio,
  reworkTone,
  reworkTotal,
  type TimeSplit,
  type Totals,
} from "@/lib/dashboard-metrics";
import type { ProductionTargets } from "@/lib/queries";
import { toneBar, type KpiTileProps } from "@/components/dashboard/KpiTiles";
import { KIND_BAR } from "@/components/dashboard/tone";

// A ratio as the percent the tile shows, rounded exactly as pct1 rounds it.
export const pctNum = (r: number) => Number((r * 100).toFixed(1));

// Three jelly dots beside the period line while numbers already on screen are
// being refreshed. Phone only; the live region says it once.
export function kpiTiles(
  t: Totals,
  split: TimeSplit,
  targets: ProductionTargets,
  count?: KpiTileProps["count"],
): KpiTileProps[] {
  const lossAlert = targets.lossPct;
  const adhTile = (title: string, actual: number, plan: number, target: number): KpiTileProps => {
    if (plan <= 0) {
      return {
        title,
        target: `target ${target}%`,
        value: null,
        detail: `${kg(actual)} kg, no plan entered`,
        segments: [],
        barLabel: "No plan entered",
        status: "No plan entered",
        tone: "neutral",
      };
    }
    const adh = actual / plan;
    const tone = adherenceTone(adh, target);
    const gap = Math.abs(adh * 100 - target);
    const below = adh * 100 < target;
    return {
      title,
      target: `target ${target}%`,
      targetPct: target,
      value: pctNum(adh),
      unit: "of plan",
      detail: `${kg(actual)} of ${kg(plan)} kg`,
      mobileDetail: `${kg(actual)} / ${kg(plan)} kg`,
      segments: [{ pct: adh * 100, className: toneBar(tone) }],
      barLabel: `${(adh * 100).toFixed(1)} percent of plan, target ${target}`,
      status: below
        ? `${gap.toFixed(1)} points below target`
        : gap < 0.05
          ? "On target"
          : `${gap.toFixed(1)} points above target`,
      mobileStatus: below ? `${gap.toFixed(1)} pts under ${target}%` : `At or above ${target}%`,
      tone,
    };
  };

  const avail = t.availableMin;
  const lost = ratio(split.total, avail);
  const share = (m: number) => ratio(m, avail);
  const kinds = [
    ["planned", split.planned],
    ["unplanned", split.unplanned],
    ["unclassified", split.unclassified],
  ] as const;
  const biggest = [...kinds].sort((a, b) => b[1] - a[1])[0];
  const timeStatus =
    split.total === 0
      ? "No downtime recorded"
      : biggest[0] === "planned"
        ? "Mostly planned stops"
        : biggest[0] === "unplanned"
          ? "Mostly unplanned stops"
          : "Mostly unclassified stops";
  const timeTile: KpiTileProps =
    avail <= 0
      ? {
          title: "Time lost",
          target: `alert above ${lossAlert}%`,
          value: null,
          detail: `${num(split.total)} min, no available minutes entered`,
          segments: [],
          barLabel: "No available minutes entered",
          status: "No available minutes entered",
          tone: "neutral",
        }
      : {
          title: "Time lost",
          target: `alert above ${lossAlert}%`,
          targetPct: lossAlert,
          value: pctNum(lost),
          unit: "of available",
          detail:
            `${num(split.total)} of ${num(avail)} min · planned ${pct1(share(split.planned))} · unplanned ${pct1(share(split.unplanned))}` +
            (split.unclassified > 0 ? ` · unclassified ${pct1(share(split.unclassified))}` : ""),
          mobileDetail: `${num(split.total)} min · ${pct1(share(split.unplanned))} unplanned`,
          segments: kinds.map(([k, m]) => ({ pct: share(m) * 100, className: KIND_BAR[k] })),
          barLabel: `Planned ${(share(split.planned) * 100).toFixed(1)} percent, unplanned ${(share(split.unplanned) * 100).toFixed(1)} percent, unclassified ${(share(split.unclassified) * 100).toFixed(1)} percent of available time`,
          status: timeStatus,
          mobileStatus: timeStatus.replace(" stops", ""),
          tone: lossTone(lost * 100, lossAlert),
        };

  const rw = reworkTotal(t);
  const rwParts = [
    t.reworkCooking > 0 ? `cooking ${kg(t.reworkCooking)}` : null,
    `making ${kg(t.reworkMaking)}`,
    `packing ${kg(t.reworkPacking)}`,
  ].filter(Boolean);
  const rwPct = t.makingActual > 0 ? (rw / t.makingActual) * 100 : null;
  const rwTarget = targets.reworkPct;
  const rwTone = rwPct != null ? reworkTone(rwPct, rwTarget) : "neutral";
  const reworkTile: KpiTileProps = {
    title: "Rework",
    target: rwTarget != null ? `at most ${rwTarget}%` : "no target set",
    targetPct: rwTarget,
    value: t.makingActual > 0 ? pctNum(rw / t.makingActual) : null,
    unit: "of making",
    detail: `${kg(rw)} kg · ${rwParts.join(" · ")}`,
    mobileDetail: `${kg(rw)} kg of making`,
    segments: [
      {
        pct: t.makingActual > 0 ? (rw / t.makingActual) * 100 : 0,
        className: rwTone === "neutral" ? "bg-muted-foreground" : toneBar(rwTone),
      },
    ],
    barLabel: `Rework ${t.makingActual > 0 ? ((rw / t.makingActual) * 100).toFixed(1) : 0} percent of making output`,
    status:
      rwTarget == null || rwPct == null
        ? "Share of making output"
        : rwPct <= rwTarget
          ? `Within the ${rwTarget}% limit`
          : `${(rwPct - rwTarget).toFixed(1)} points over the ${rwTarget}% limit`,
    mobileStatus:
      rwTarget == null
        ? "No target set"
        : rwPct != null && rwPct > rwTarget
          ? `Over ${rwTarget}%`
          : `Within ${rwTarget}%`,
    tone: rwTone,
  };

  return [
    { ...adhTile("Making", t.makingActual, t.makingPlan, targets.makingPct), count },
    {
      ...adhTile("Packing", t.packingActual, t.packingPlan, targets.packingPct),
      variance: t.packingPlan > 0 ? varianceStrip(t) : undefined,
    },
    timeTile,
    reworkTile,
  ];
}

// Packing tile: the shortfall against plan less the entries' rework — the
// part the rework doesn't explain. Only drawn when there is a packing plan.
function varianceStrip(t: Totals): NonNullable<KpiTileProps["variance"]> {
  const v = packingVariance(t);
  const label = "Net variance";
  if (v.state === "none") {
    return {
      label,
      valueText: "0 kg",
      quiet: true,
      detail: "Packed at or above plan — nothing short",
      mobileDetail: "At or above plan",
      segments: [],
      barLabel: "Packed at or above plan",
    };
  }
  const netShare = (v.net / v.short) * 100;
  const segments = [
    { pct: netShare, className: "bg-destructive" },
    { pct: 100 - netShare, className: "bg-warning" },
  ];
  const wipText = v.wip > 0 ? ` − ${kg(v.wip)} WIP` : "";
  const math = `${kg(v.short)} short of plan − ${kg(v.rework)} rework${wipText}`;
  if (v.state === "covered") {
    return {
      label,
      valueText: "0 kg",
      quiet: false,
      detail: `${math} · ${v.wip > 0 ? "rework and WIP cover it" : "rework covers it"}`,
      mobileDetail: `${kg(v.short)} − ${kg(v.rework)} rework${wipText}`,
      segments,
      barLabel: `Short of plan ${kg(v.short)} kilograms, all covered by ${kg(v.rework)} kilograms of rework`,
    };
  }
  return {
    label,
    valueText: `${kg(v.net)} kg`,
    quiet: false,
    detail: `${math} · ${pct1(v.netOfPlan ?? 0)} of plan`,
    mobileDetail: `${kg(v.short)} − ${kg(v.rework)} rework${wipText}`,
    segments,
    barLabel: `Short of plan ${kg(v.short)} kilograms: rework ${kg(v.rework)}${v.wip > 0 ? `, WIP ${kg(v.wip)}` : ""}, not explained ${kg(v.net)}`,
  };
}
