// Plan adherence auto insights (approved mockup "Plan adherence upgrade v2",
// 28 Oct 2026): up to four cards from the month's numbers.
//   Behind         the line furthest under the share of the month over
//   Over forecast  the line furthest over 100%
//   Order risk     the late order with the most left to pack
//   Calendar       packing on Fridays (off days: extra, not in the pace)
import type { Adherence } from "@/lib/plan-adherence";
import type { OrderGroup } from "@/lib/orders";
import { dayNum, monthShort, pctFmt, shortDay, tons } from "@/components/plan/format";

export interface Insight {
  kind: "behind" | "over" | "order" | "calendar";
  title: string;
  body: string;
}
export function buildInsights(
  ad: Adherence,
  groups: OrderGroup[],
  lineName: (id: string | null) => string,
): Insight[] {
  const out: Insight[] = [];
  const withFc = ad.lines.filter((l) => l.forecastKg > 0 && l.achieved !== null);
  const behind = withFc
    .filter((l) => (l.achieved ?? 0) < ad.share - 0.02)
    .sort((a, b) => (a.achieved ?? 0) - ad.share - ((b.achieved ?? 0) - ad.share))[0];
  if (behind) {
    const left = Math.max(0, behind.forecastKg - behind.packedKg);
    const rate = ad.daysOver > 0 ? behind.packedKg / ad.daysOver : 0;
    out.push({
      kind: "behind",
      title:
        behind.neededPerDay !== null
          ? `${lineName(behind.lineId)} needs ${tons(behind.neededPerDay)} t a day`
          : `${lineName(behind.lineId)} at ${pctFmt(behind.achieved ?? 0)}`,
      body:
        `${pctFmt(behind.achieved ?? 0)} done vs ${pctFmt(ad.share)} expected. ${tons(left)} t left` +
        (ad.daysLeft > 0
          ? ` in ${ad.daysLeft} working ${ad.daysLeft === 1 ? "day" : "days"}; it runs ${tons(rate)} t a day` +
            (behind.projectionKg !== null
              ? ` → ends near ${pctFmt(behind.projectionKg / behind.forecastKg)}.`
              : ".")
          : "."),
    });
  }
  const over = withFc
    .filter((l) => (l.achieved ?? 0) >= 1)
    .sort((a, b) => (b.achieved ?? 0) - (a.achieved ?? 0))[0];
  if (over) {
    out.push({
      kind: "over",
      title: `${lineName(over.lineId)} already ${pctFmt(over.achieved ?? 0)}`,
      body:
        `${tons(over.packedKg - over.forecastKg)} t above the month's forecast` +
        (over.projectionKg !== null
          ? `; heading for ${pctFmt(over.projectionKg / over.forecastKg)}.`
          : ".") +
        " Forecast too low, or orders packed as local?",
    });
  }
  const risk = groups
    .filter((g) => g.state === "late")
    .sort((a, b) => b.qtyKg - b.producedKg - (a.qtyKg - a.producedKg))[0];
  if (risk) {
    const notStarted = risk.lines.filter((l) => l.status === "notstarted").length;
    out.push({
      kind: "order",
      title: `${risk.client ?? "No client"} · ${tons(risk.qtyKg - risk.producedKg)} t, ${pctFmt(risk.pct)} packed`,
      body:
        `${risk.orderCode ?? "No order code"} · ${notStarted} of ${risk.lines.length} lines not started` +
        (risk.shipBy ? ` · ship-by ${shortDay(risk.shipBy)} passed ${risk.lateDays} d ago.` : "."),
    });
  }
  if (ad.fridayKg > 0) {
    const fris = ad.daily
      .filter((d) => d.friday && d.localKg + d.exportKg > 0)
      .map((d) => dayNum(d.day));
    out.push({
      kind: "calendar",
      title: `${tons(ad.fridayKg)} t packed on Fridays`,
      body: `${fris.join(", ")} ${monthShort(ad.daily[0].day)} ${fris.length === 1 ? "is an off day" : "are off days"} in the plan, so it counts as extra, not as days the forecast expected.`,
    });
  }
  return out;
}
