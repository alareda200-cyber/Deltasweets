// Plan adherence (mockup v4): the month's forecast per SKU against what was
// packed, per SKU, per line and in total. Pure, so the page and its tests
// share one calculation.
//   forecast kg = forecast qty × the SKU's kg per unit (Settings › Packing)
//   packed kg   = the kg saved with each pasted row
//   "by now"    = forecast × working days over ÷ working days in the month
//   needed/day  = (forecast − packed) ÷ working days left
// A working day is a day not closed for the whole company in Settings ›
// Non-production days. A day counts as over once it has packed SKUs, or when
// it is before today.

import type { PackedSku, Sku, SkuForecast } from "@/lib/packing";
import type { NonProductionDay } from "@/lib/queries";
import { iso } from "@/lib/date-utils";

export interface SkuAdherence {
  code: string;
  name: string;
  unit: string | null;
  lineId: string | null;
  forecastQty: number;
  packedQty: number;
  forecastKg: number | null;
  packedKg: number;
  /** packed ÷ forecast in the SKU's unit; null without a forecast. */
  achieved: number | null;
}

export interface LineAdherence {
  lineId: string | null;
  forecastKg: number;
  packedKg: number;
  achieved: number | null;
  skus: number;
}

export interface Adherence {
  forecastKg: number;
  packedKg: number;
  achieved: number | null;
  shouldKg: number;
  neededPerDay: number | null;
  daysOver: number;
  daysLeft: number;
  workingDays: number;
  /** Forecast rows whose SKU has no kg per unit (left out of the kg). */
  noWeight: number;
  skus: SkuAdherence[];
  lines: LineAdherence[];
}

export function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => iso(new Date(y, m - 1, i + 1)));
}

export function planAdherence(args: {
  month: string;
  forecasts: SkuForecast[];
  packed: PackedSku[];
  skus: Sku[];
  closed: NonProductionDay[];
  today: string;
}): Adherence {
  const skuBy = new Map(args.skus.map((s) => [s.code, s]));
  const rows = new Map<string, SkuAdherence>();
  const get = (code: string, lineId: string | null) => {
    let r = rows.get(code);
    if (!r) {
      const s = skuBy.get(code);
      r = {
        code,
        name: s?.name ?? "",
        unit: s?.unit ?? null,
        lineId: s?.line_id ?? lineId,
        forecastQty: 0,
        packedQty: 0,
        forecastKg: 0,
        packedKg: 0,
        achieved: null,
      };
      rows.set(code, r);
    }
    return r;
  };
  let noWeight = 0;
  for (const f of args.forecasts) {
    const r = get(f.code, null);
    r.forecastQty += f.qty;
    const w = skuBy.get(f.code)?.kg_per_unit;
    if (w == null) {
      noWeight++;
      r.forecastKg = null;
    } else if (r.forecastKg !== null) r.forecastKg += f.qty * w;
  }
  for (const p of args.packed) {
    const r = get(p.code, p.line_id);
    r.packedQty += p.qty;
    r.packedKg += p.kg ?? 0;
  }
  for (const r of rows.values())
    r.achieved = r.forecastQty > 0 ? r.packedQty / r.forecastQty : null;

  const lineMap = new Map<string | null, LineAdherence>();
  for (const r of rows.values()) {
    const l = lineMap.get(r.lineId) ?? {
      lineId: r.lineId,
      forecastKg: 0,
      packedKg: 0,
      achieved: null,
      skus: 0,
    };
    l.forecastKg += r.forecastKg ?? 0;
    l.packedKg += r.packedKg;
    l.skus += 1;
    lineMap.set(r.lineId, l);
  }
  for (const l of lineMap.values())
    l.achieved = l.forecastKg > 0 ? l.packedKg / l.forecastKg : null;

  const forecastKg = [...rows.values()].reduce((s, r) => s + (r.forecastKg ?? 0), 0);
  const packedKg = [...rows.values()].reduce((s, r) => s + r.packedKg, 0);
  const off = new Set(
    args.closed
      .filter((d) => d.line_id === null && !d.closed_from && !d.closed_to)
      .map((d) => d.day),
  );
  const days = monthDays(args.month).filter((d) => !off.has(d));
  const packedDays = new Set(args.packed.map((p) => p.day));
  const daysOver = days.filter((d) => d < args.today || packedDays.has(d)).length;
  const daysLeft = days.length - daysOver;
  const shouldKg = days.length > 0 ? (forecastKg * daysOver) / days.length : forecastKg;
  return {
    forecastKg,
    packedKg,
    achieved: forecastKg > 0 ? packedKg / forecastKg : null,
    shouldKg,
    neededPerDay: daysLeft > 0 ? Math.max(0, forecastKg - packedKg) / daysLeft : null,
    daysOver,
    daysLeft,
    workingDays: days.length,
    noWeight,
    skus: [...rows.values()].sort(
      (a, b) => (b.forecastKg ?? 0) - (a.forecastKg ?? 0) || b.packedKg - a.packedKg,
    ),
    lines: [...lineMap.values()].sort((a, b) => b.forecastKg - a.forecastKg),
  };
}
