// B2B and export orders (FG workbook › B2B & Export) against what was packed,
// worked out the way the workbook's own formulas do it (approved mockup
// "Plan adherence upgrade v2", 28 Oct 2026). For each order line:
//   month packed = the SKU's packed cartons in the order's month, of the kind
//                  the order's type asks for:
//                    Export / B2B Export → export rows · B2B → local rows ·
//                    any other type → both;
//                  with a client: that client's rows, plus the rows with no
//                  client from the order's country when no other client of
//                  that country ordered the SKU that month;
//                  without a client: the rows of the order's country (all, when
//                  the order has no country either).
//   earlier      = cartons of the same SKU, month, client and type on the order
//                  lines above it (seq): they take the packed cartons first.
//   produced     = month packed − earlier, at least 0 and at most the quantity.
//   ship by      = date PM was received + 14 days ('B2B Summary'!I3).
//   late         = not done and today is past the ship-by date.
// Text compares ignore case and extra spaces, as Excel's SUMIFS does.
// Forecast actual (the workbook's Forecast Summary): a SKU's local cartons in
// the month minus the cartons produced for its "B2B" orders (local B2B work
// isn't the forecast's).

export const PM_LEAD_DAYS = 14;

export interface OrderLine {
  id?: string;
  month: string; // YYYY-MM-01
  seq: number;
  code: string;
  order_code: string | null;
  qty: number;
  client: string | null;
  country: string | null;
  type: string | null;
  pm_date: string | null;
  delay_reason: string | null;
  note?: string | null;
}

export interface PackedForOrders {
  day: string;
  code: string;
  qty: number;
  kind: "local" | "export";
  client: string | null;
  country: string | null;
}

export type LineStatus = "done" | "started" | "notstarted";

export interface OrderLineResult extends OrderLine {
  monthPacked: number;
  earlier: number;
  produced: number;
  remaining: number;
  status: LineStatus;
  shipBy: string | null;
  lateDays: number;
}

const key = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const isExportType = (t: string | null) => {
  const k = key(t);
  return k === "export" || k === "b2b export";
};
export const isB2bType = (t: string | null) => key(t) === "b2b";

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export function allocateOrders(
  orders: OrderLine[],
  packed: PackedForOrders[],
  today: string,
): OrderLineResult[] {
  // packed cartons by month|code
  const byMonthCode = new Map<string, PackedForOrders[]>();
  for (const p of packed) {
    const k = `${p.day.slice(0, 7)}|${p.code}`;
    const list = byMonthCode.get(k) ?? [];
    list.push(p);
    byMonthCode.set(k, list);
  }
  return orders.map((o) => {
    const month = o.month.slice(0, 7);
    const rows = byMonthCode.get(`${month}|${o.code}`) ?? [];
    const kindOk = (p: PackedForOrders) =>
      isExportType(o.type) ? p.kind === "export" : isB2bType(o.type) ? p.kind === "local" : true;
    const client = key(o.client);
    const country = key(o.country);
    let monthPacked = 0;
    if (!client) {
      for (const p of rows)
        if (kindOk(p) && (!country || key(p.country) === country)) monthPacked += p.qty;
    } else {
      for (const p of rows) if (kindOk(p) && key(p.client) === client) monthPacked += p.qty;
      if (country) {
        const sameKind = (t: string | null) =>
          isExportType(o.type) ? isExportType(t) : key(t) === key(o.type);
        const others = orders.some(
          (x) =>
            x.code === o.code &&
            x.month.slice(0, 7) === month &&
            key(x.country) === country &&
            key(x.client) !== "" &&
            key(x.client) !== client &&
            sameKind(x.type),
        );
        if (!others)
          for (const p of rows)
            if (kindOk(p) && !key(p.client) && key(p.country) === country) monthPacked += p.qty;
      }
    }
    const earlier = orders
      .filter(
        (x) =>
          x.seq < o.seq &&
          x.code === o.code &&
          x.month.slice(0, 7) === month &&
          (!client || key(x.client) === client) &&
          (!key(o.type) || key(x.type) === key(o.type)),
      )
      .reduce((s, x) => s + x.qty, 0);
    const produced = Math.max(0, Math.min(o.qty, monthPacked - earlier));
    const remaining = o.qty - produced;
    const status: LineStatus =
      o.qty > 0 && remaining <= 0 ? "done" : produced > 0 ? "started" : "notstarted";
    const shipBy = o.pm_date ? addDays(o.pm_date, PM_LEAD_DAYS) : null;
    const lateDays = shipBy && status !== "done" && today > shipBy ? daysBetween(shipBy, today) : 0;
    return { ...o, monthPacked, earlier, produced, remaining, status, shipBy, lateDays };
  });
}

/** Cartons produced for "B2B" orders, by month|code: taken off the forecast actual. */
export function b2bProducedByCode(lines: OrderLineResult[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines)
    if (isB2bType(l.type)) {
      const k = `${l.month.slice(0, 7)}|${l.code}`;
      out.set(k, (out.get(k) ?? 0) + l.produced);
    }
  return out;
}

export interface OrderGroup {
  key: string;
  client: string | null;
  orderCode: string | null;
  country: string | null;
  type: string | null;
  lines: OrderLineResult[];
  doneLines: number;
  qtyKg: number;
  producedKg: number;
  /** produced ÷ ordered, in kg. */
  pct: number;
  shipBy: string | null;
  lateDays: number;
  state: "late" | "open" | "done";
}

/** Order lines grouped by client · order code · type, with kg from the SKU weights. */
export function groupOrders(
  lines: OrderLineResult[],
  kgPerUnit: (code: string) => number | null,
): OrderGroup[] {
  const by = new Map<string, OrderGroup>();
  for (const l of lines) {
    const k = `${key(l.client)}|${key(l.order_code)}|${key(l.type)}|${l.month}`;
    let g = by.get(k);
    if (!g) {
      g = {
        key: k,
        client: l.client,
        orderCode: l.order_code,
        country: l.country,
        type: l.type,
        lines: [],
        doneLines: 0,
        qtyKg: 0,
        producedKg: 0,
        pct: 0,
        shipBy: null,
        lateDays: 0,
        state: "open",
      };
      by.set(k, g);
    }
    const w = kgPerUnit(l.code) ?? 0;
    g.lines.push(l);
    g.qtyKg += l.qty * w;
    g.producedKg += l.produced * w;
    if (l.status === "done") g.doneLines++;
    if (l.shipBy && (!g.shipBy || l.shipBy < g.shipBy)) g.shipBy = l.shipBy;
    g.lateDays = Math.max(g.lateDays, l.lateDays);
    if (!g.country && l.country) g.country = l.country;
  }
  for (const g of by.values()) {
    g.pct = g.qtyKg > 0 ? g.producedKg / g.qtyKg : g.doneLines === g.lines.length ? 1 : 0;
    g.state = g.doneLines === g.lines.length ? "done" : g.lateDays > 0 ? "late" : "open";
  }
  return [...by.values()];
}
