// Plan adherence: the month's forecast per SKU against what was packed, per
// SKU, per line and in total. Pure, so the page and its tests share one
// calculation. Approved mockup "Plan adherence upgrade v2" (28 Oct 2026),
// built on the planning team's FG workbook:
//   forecast kg  = forecast cartons × the SKU's kg per unit (Settings › Packing)
//   packed (fc)  = the SKU's local cartons in the month minus the cartons
//                  produced for its "B2B" orders (src/lib/orders.ts), like the
//                  workbook's Forecast Summary; export packing is shown apart
//   "by now"     = forecast × working days over ÷ working days in the month
//   needed/day   = (forecast − packed) ÷ working days left
//   month end    = packed ÷ working days over × working days in the month
// A working day is Saturday to Thursday, not closed for the whole company in
// Settings › Non-production days. Friday is off: packing on a Friday counts as
// extra, never as a day the plan expected. A working day counts as over once it
// has packed SKUs, or when it is before today.

import type { PackedSku, Sku, SkuForecast } from "@/lib/packing";
import type { NonProductionDay } from "@/lib/queries";
import { iso } from "@/lib/date-utils";
import {
  allocateOrders,
  b2bProducedByCode,
  type OrderLine,
  type OrderLineResult,
} from "@/lib/orders";

/** Where a SKU stands against where it should be by now. */
export type SkuStatus = "ontrack" | "behind" | "notstarted" | "unplanned";

export interface SkuAdherence {
  code: string;
  name: string;
  unit: string | null;
  lineId: string | null;
  forecastQty: number;
  /** Local cartons less B2B orders: what counts against the forecast. */
  packedQty: number;
  forecastKg: number | null;
  packedKg: number;
  exportKg: number;
  /** packed ÷ forecast in the SKU's unit; null without a forecast. */
  achieved: number | null;
  /** unplanned: packed but not in the forecast · notstarted: forecast, nothing
   *  packed · ontrack: achieved ≥ the share of working days over · behind. */
  status: SkuStatus;
}

export interface LineAdherence {
  lineId: string | null;
  forecastKg: number;
  packedKg: number;
  exportKg: number;
  achieved: number | null;
  /** Packed kg at month end at this line's rate a working day. */
  projectionKg: number | null;
  neededPerDay: number | null;
  skus: number;
}

export interface DayAdherence {
  day: string;
  working: boolean;
  friday: boolean;
  /** Packed that day against the forecast (local less B2B, per SKU's share). */
  packedKg: number;
  /** All local kg, B2B orders included. */
  localKg: number;
  exportKg: number;
  /** Local kg by line. */
  byLine: Map<string, number>;
  /** Packed so far against the forecast; null once the day isn't over. */
  cumKg: number | null;
  /** The plan's pace by that day (working days only). */
  paceKg: number;
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
  /** daysOver ÷ workingDays: the part of the forecast due by now. */
  share: number;
  /** Packed kg in SKUs that have no forecast this month. */
  unplannedKg: number;
  unplannedCount: number;
  /** Packed kg at the same rate a working day for the whole month. */
  projectionKg: number | null;
  /** All local kg (B2B orders included), export kg, and kg packed on Fridays. */
  localKg: number;
  exportKg: number;
  b2bLocalKg: number;
  fridayKg: number;
  /** The last day with packed SKUs. */
  lastDay: string | null;
  daily: DayAdherence[];
  orders: OrderLineResult[];
}

export function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => iso(new Date(y, m - 1, i + 1)));
}

export const isFriday = (day: string) => new Date(`${day}T00:00:00`).getDay() === 5;

/** Days closed for the whole company (Settings › Non-production days). */
export function closedDays(closed: NonProductionDay[]): Set<string> {
  return new Set(
    closed.filter((d) => d.line_id === null && !d.closed_from && !d.closed_to).map((d) => d.day),
  );
}

export function planAdherence(args: {
  month: string;
  forecasts: SkuForecast[];
  packed: PackedSku[];
  skus: Sku[];
  closed: NonProductionDay[];
  today: string;
  orders?: OrderLine[];
}): Adherence {
  const skuBy = new Map(args.skus.map((s) => [s.code, s]));
  const orders = allocateOrders(args.orders ?? [], args.packed, args.today);
  const b2b = b2bProducedByCode(orders);
  const mon = args.month.slice(0, 7);

  // local and export by SKU
  const local = new Map<string, { qty: number; kg: number; lineId: string }>();
  const exportKgBy = new Map<string, number>();
  for (const p of args.packed) {
    if (p.kind === "export") {
      exportKgBy.set(p.code, (exportKgBy.get(p.code) ?? 0) + (p.kg ?? 0));
      continue;
    }
    const r = local.get(p.code) ?? { qty: 0, kg: 0, lineId: p.line_id };
    r.qty += p.qty;
    r.kg += p.kg ?? 0;
    local.set(p.code, r);
  }
  // the part of each SKU's local packing that counts against the forecast
  const fcShare = new Map<string, number>();
  for (const [code, r] of local) {
    const fcQty = Math.max(0, r.qty - (b2b.get(`${mon}|${code}`) ?? 0));
    fcShare.set(code, r.qty > 0 ? fcQty / r.qty : 0);
  }

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
        exportKg: 0,
        achieved: null,
        status: "notstarted",
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
  for (const [code, l] of local) {
    const share = fcShare.get(code) ?? 0;
    if (share <= 0 && !rows.has(code)) continue;
    const r = get(code, l.lineId);
    if (r.lineId === null) r.lineId = l.lineId;
    r.packedQty += l.qty * share;
    r.packedKg += l.kg * share;
  }
  for (const [code, kg] of exportKgBy) if (rows.has(code)) rows.get(code)!.exportKg = kg;
  for (const r of rows.values())
    r.achieved = r.forecastQty > 0 ? r.packedQty / r.forecastQty : null;

  // calendar
  const off = closedDays(args.closed);
  const all = monthDays(args.month);
  const isWorking = (d: string) => !off.has(d) && !isFriday(d);
  const days = all.filter(isWorking);
  const packedDays = new Set(args.packed.map((p) => p.day));
  const isOver = (d: string) => d < args.today || packedDays.has(d);
  const daysOver = days.filter(isOver).length;
  const daysLeft = days.length - daysOver;
  const share = days.length > 0 ? daysOver / days.length : 1;

  for (const r of rows.values()) {
    r.status =
      r.forecastQty <= 0
        ? "unplanned"
        : r.packedQty <= 0
          ? "notstarted"
          : (r.achieved ?? 0) >= share
            ? "ontrack"
            : "behind";
  }

  const forecastKg = [...rows.values()].reduce((s, r) => s + (r.forecastKg ?? 0), 0);
  const packedKg = [...rows.values()].reduce((s, r) => s + r.packedKg, 0);
  const shouldKg = forecastKg * share;
  const rate = (kg: number) => (daysOver > 0 ? (kg / daysOver) * days.length : null);

  // lines
  const lineMap = new Map<string | null, LineAdherence>();
  const lineOf = (lineId: string | null) => {
    let l = lineMap.get(lineId);
    if (!l) {
      l = {
        lineId,
        forecastKg: 0,
        packedKg: 0,
        exportKg: 0,
        achieved: null,
        projectionKg: null,
        neededPerDay: null,
        skus: 0,
      };
      lineMap.set(lineId, l);
    }
    return l;
  };
  for (const r of rows.values()) {
    const l = lineOf(r.lineId);
    l.forecastKg += r.forecastKg ?? 0;
    l.packedKg += r.packedKg;
    l.skus += 1;
  }
  for (const p of args.packed)
    if (p.kind === "export") lineOf(skuBy.get(p.code)?.line_id ?? p.line_id).exportKg += p.kg ?? 0;
  for (const l of lineMap.values()) {
    l.achieved = l.forecastKg > 0 ? l.packedKg / l.forecastKg : null;
    l.projectionKg = rate(l.packedKg);
    l.neededPerDay =
      daysLeft > 0 && l.forecastKg > 0 ? Math.max(0, l.forecastKg - l.packedKg) / daysLeft : null;
  }

  const unplanned = [...rows.values()].filter((r) => r.status === "unplanned");

  // days
  const dayMap = new Map<
    string,
    { fc: number; local: number; exp: number; byLine: Map<string, number> }
  >();
  for (const p of args.packed) {
    const d = dayMap.get(p.day) ?? { fc: 0, local: 0, exp: 0, byLine: new Map() };
    const kg = p.kg ?? 0;
    if (p.kind === "export") d.exp += kg;
    else {
      d.local += kg;
      d.fc += kg * (fcShare.get(p.code) ?? 0);
      d.byLine.set(p.line_id, (d.byLine.get(p.line_id) ?? 0) + kg);
    }
    dayMap.set(p.day, d);
  }
  const lastDay = [...packedDays].sort().pop() ?? null;
  const lastOver = [...all].reverse().find(isOver) ?? null;
  let cum = 0;
  let working = 0;
  const daily: DayAdherence[] = all.map((day) => {
    const d = dayMap.get(day);
    cum += d?.fc ?? 0;
    if (isWorking(day)) working++;
    return {
      day,
      working: isWorking(day),
      friday: isFriday(day),
      packedKg: d?.fc ?? 0,
      localKg: d?.local ?? 0,
      exportKg: d?.exp ?? 0,
      byLine: d?.byLine ?? new Map(),
      cumKg: lastOver !== null && day <= lastOver ? cum : null,
      paceKg: days.length > 0 ? (forecastKg * working) / days.length : 0,
    };
  });
  const localKg = daily.reduce((s, d) => s + d.localKg, 0);

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
    share,
    unplannedKg: unplanned.reduce((s, r) => s + r.packedKg, 0),
    unplannedCount: unplanned.length,
    projectionKg: rate(packedKg),
    localKg,
    exportKg: daily.reduce((s, d) => s + d.exportKg, 0),
    b2bLocalKg: Math.max(0, localKg - daily.reduce((s, d) => s + d.packedKg, 0)),
    fridayKg: daily.filter((d) => d.friday).reduce((s, d) => s + d.localKg + d.exportKg, 0),
    lastDay,
    daily,
    orders,
  };
}

// ------------------------------------------------------------------ months
export interface MonthTons {
  month: string; // YYYY-MM
  byLine: Map<string, number>;
  localKg: number;
  exportKg: number;
  totalKg: number;
  /** Working days with data: the whole month, or up to the last packed day. */
  workingDays: number;
  /** True when the month isn't over (counted to its last packed day). */
  partial: boolean;
  lastDay: string | null;
}

/** Packed tons month by month (all lines, local and export), for the Monthly tab. */
export function monthlyTons(args: {
  months: string[];
  packed: PackedSku[];
  closed: NonProductionDay[];
  today: string;
}): MonthTons[] {
  const off = closedDays(args.closed);
  return args.months.map((month) => {
    const rows = args.packed.filter((p) => p.day.startsWith(month));
    const byLine = new Map<string, number>();
    let localKg = 0;
    let exportKg = 0;
    for (const p of rows) {
      const kg = p.kg ?? 0;
      byLine.set(p.line_id, (byLine.get(p.line_id) ?? 0) + kg);
      if (p.kind === "export") exportKg += kg;
      else localKg += kg;
    }
    const lastDay = rows.reduce<string | null>((m, p) => (!m || p.day > m ? p.day : m), null);
    const days = monthDays(month);
    const monthOver = days[days.length - 1] < args.today;
    const until = monthOver ? days[days.length - 1] : lastDay;
    const workingDays = until
      ? days.filter((d) => d <= until && !off.has(d) && !isFriday(d)).length
      : 0;
    return {
      month,
      byLine,
      localKg,
      exportKg,
      totalKg: localKg + exportKg,
      workingDays,
      partial: !monthOver,
      lastDay,
    };
  });
}
