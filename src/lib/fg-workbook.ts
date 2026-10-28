// The planning team's FG workbook (JammyFG) read for upload on Plan adherence
// (approved mockup "Plan adherence upgrade v2", 28 Oct 2026). Columns are
// found by their header text, so moved or added columns don't matter.
//   Entry          Date · Item code · Actual Qty (Crt) · Production line ·
//                  Local/Export · Country · Client · Note → packed SKUs
//   Items          Item Code · Production Line · Q (kg/Crt) · Jan … Dec
//                  (forecast cartons) → the forecast of each month that has one
//   B2B & Export   Month · Item Code · Order Code · Qty (Crt) · Client ·
//                  Country · Type · Note · Receiving PM Date · Delay Reason
//                  → orders; the workbook row is the order line's place (seq)
// Only typed values are read; the workbook's own formulas (Produced, Status…)
// are worked out again on the page from these (src/lib/orders.ts).
// kg of a packed row = cartons × the SKU's kg per unit in Settings › Packing,
// else the workbook's Q (kg/Crt).
import type { Sku } from "@/lib/packing";
import type { OrderLine } from "@/lib/orders";
import { excelDate, type Cell, type SheetRows, type Workbook } from "@/lib/xlsx-read";

export interface FgEntry {
  row: number;
  day: string;
  code: string;
  qty: number;
  line: string | null;
  kind: "local" | "export";
  country: string | null;
  client: string | null;
  note: string | null;
}
export interface FgItem {
  code: string;
  name: string;
  line: string | null;
  kgPerCrt: number | null;
  /** Forecast cartons, January … December. */
  months: (number | null)[];
}
export interface FgWorkbook {
  entries: FgEntry[];
  items: FgItem[];
  orders: OrderLine[];
  /** The forecast's year: the latest year in Entry. */
  year: number;
  /** Sheets the upload needs but the file lacks. */
  missing: string[];
  /** Entry rows skipped: no date, code or quantity. */
  skipped: number;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const hnorm = (v: Cell) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const text = (v: Cell | undefined) => {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s : null;
};
const num = (v: Cell | undefined) =>
  typeof v === "number"
    ? v
    : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())
      ? Number(v)
      : null;
const codeOf = (v: Cell | undefined) => {
  const s = typeof v === "number" ? String(Math.round(v)) : text(v);
  return s && /^\d{6,}$/.test(s) ? s : null;
};

/** The header row (first 12 rows) holding all the wanted headers → column per header. */
function headers(
  rows: SheetRows,
  want: Record<string, (h: string) => boolean>,
): { row: number; col: Record<string, string> } | null {
  for (let r = 1; r <= 12; r++) {
    const row = rows.get(r);
    if (!row) continue;
    const col: Record<string, string> = {};
    for (const [c, v] of row) {
      const h = hnorm(v);
      for (const [k, test] of Object.entries(want)) if (!(k in col) && test(h)) col[k] = c;
    }
    if (Object.keys(want).every((k) => k in col)) return { row: r, col };
  }
  return null;
}
const is =
  (...names: string[]) =>
  (h: string) =>
    names.includes(h);
const starts = (p: string) => (h: string) => h.startsWith(p);

export async function readFgWorkbook(wb: Workbook): Promise<FgWorkbook> {
  const out: FgWorkbook = { entries: [], items: [], orders: [], year: 0, missing: [], skipped: 0 };

  const entry = await wb.sheet("Entry");
  const eh = entry
    ? headers(entry, {
        day: is("date"),
        code: is("item code"),
        qty: starts("actual qty"),
        line: is("production line"),
        kind: is("local export"),
        country: is("country"),
        client: is("client"),
        note: is("note"),
      })
    : null;
  if (!entry || !eh) out.missing.push("Entry");
  else {
    for (const [r, row] of entry) {
      if (r <= eh.row) continue;
      const day = excelDate(row.get(eh.col.day) ?? null);
      const code = codeOf(row.get(eh.col.code));
      const qty = num(row.get(eh.col.qty));
      if (!day || !code || qty === null || qty <= 0) {
        if (day || code || qty) out.skipped++;
        continue;
      }
      out.entries.push({
        row: r,
        day,
        code,
        qty,
        line: text(row.get(eh.col.line)),
        kind: hnorm(row.get(eh.col.kind) ?? null) === "export" ? "export" : "local",
        country: text(row.get(eh.col.country)),
        client: text(row.get(eh.col.client)),
        note: text(row.get(eh.col.note)),
      });
    }
  }
  out.year = Math.max(0, ...out.entries.map((e) => Number(e.day.slice(0, 4))));
  if (!out.year) out.year = new Date().getFullYear();

  const items = await wb.sheet("Items");
  const monthTests = Object.fromEntries(MONTHS.map((m) => [m, is(m)]));
  const ih = items
    ? headers(items, {
        code: is("item code"),
        name: is("description", "item description"),
        line: is("production line"),
        kg: starts("q kg"),
        ...monthTests,
      })
    : null;
  if (!items || !ih) out.missing.push("Items");
  else {
    for (const [r, row] of items) {
      if (r <= ih.row) continue;
      const code = codeOf(row.get(ih.col.code));
      if (!code) continue;
      out.items.push({
        code,
        name: text(row.get(ih.col.name)) ?? "",
        line: text(row.get(ih.col.line)),
        kgPerCrt: num(row.get(ih.col.kg)),
        months: MONTHS.map((m) => num(row.get(ih.col[m]))),
      });
    }
  }

  const b2b = await wb.sheet("B2B & Export");
  const bh = b2b
    ? headers(b2b, {
        month: is("month"),
        code: is("item code"),
        orderCode: is("order code"),
        qty: is("qty crt"),
        client: is("client"),
        country: is("country"),
        type: is("type"),
        note: is("note"),
        pm: is("receiving pm date"),
        reason: is("delay reason"),
      })
    : null;
  if (!b2b || !bh) out.missing.push("B2B & Export");
  else {
    for (const [r, row] of b2b) {
      if (r <= bh.row) continue;
      const day = excelDate(row.get(bh.col.month) ?? null);
      const code = codeOf(row.get(bh.col.code));
      const qty = num(row.get(bh.col.qty));
      if (!day || !code || qty === null) continue;
      const oc = row.get(bh.col.orderCode);
      out.orders.push({
        month: `${day.slice(0, 7)}-01`,
        seq: r,
        code,
        order_code: typeof oc === "number" ? String(oc) : text(oc),
        qty,
        client: text(row.get(bh.col.client)),
        country: text(row.get(bh.col.country)),
        type: text(row.get(bh.col.type)),
        pm_date: excelDate(row.get(bh.col.pm) ?? null),
        delay_reason: text(row.get(bh.col.reason)),
        note: text(row.get(bh.col.note)),
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ to rows
const lnorm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

export interface ImportPacked {
  line_id: string;
  day: string;
  sku_id: string | null;
  code: string;
  qty: number;
  kg: number | null;
  kind: "local" | "export";
  client: string | null;
  country: string | null;
  note: string | null;
}
export interface ImportForecast {
  month: string;
  sku_id: string | null;
  code: string;
  qty: number;
}
export interface ImportOrder extends OrderLine {
  sku_id: string | null;
}
export interface ImportPlan {
  packed: ImportPacked[];
  forecasts: ImportForecast[];
  orders: ImportOrder[];
  /** Days and months each part replaces. */
  days: string[];
  forecastMonths: string[];
  orderMonths: string[];
  /** Line ids the packed rows touch (only their rows of those days are replaced). */
  lineIds: string[];
  /** Codes not in Settings › Packing (kept, with the workbook's weight if any). */
  unknownCodes: string[];
  /** Packed rows with no kg (no weight anywhere). */
  noWeight: string[];
  /** Entry rows whose line can't be told: left out. */
  noLine: FgEntry[];
}

export function planImport(
  fg: FgWorkbook,
  opts: { skus: Sku[]; lines: { id: string; name: string }[] },
): ImportPlan {
  const skuBy = new Map(opts.skus.map((s) => [s.code, s]));
  const itemBy = new Map(fg.items.map((i) => [i.code, i]));
  const lineBy = new Map(opts.lines.map((l) => [lnorm(l.name), l.id]));
  for (const l of opts.lines) if (lnorm(l.name) === "sourtube") lineBy.set("tube", l.id);
  const unknown = new Set<string>();
  const noWeight = new Set<string>();
  const weight = (code: string) => {
    const s = skuBy.get(code);
    if (!s) unknown.add(code);
    return s?.kg_per_unit ?? itemBy.get(code)?.kgPerCrt ?? null;
  };

  const packed: ImportPacked[] = [];
  const noLine: FgEntry[] = [];
  for (const e of fg.entries) {
    const sku = skuBy.get(e.code) ?? null;
    const lineId =
      (e.line ? lineBy.get(lnorm(e.line)) : undefined) ??
      sku?.line_id ??
      (itemBy.get(e.code)?.line ? lineBy.get(lnorm(itemBy.get(e.code)!.line!)) : undefined) ??
      null;
    if (!lineId) {
      noLine.push(e);
      continue;
    }
    const w = weight(e.code);
    if (w === null) noWeight.add(e.code);
    packed.push({
      line_id: lineId,
      day: e.day,
      sku_id: sku?.id ?? null,
      code: e.code,
      qty: e.qty,
      kg: w === null ? null : Math.round(e.qty * w * 100) / 100,
      kind: e.kind,
      client: e.client,
      country: e.country,
      note: e.note,
    });
  }

  const forecasts: ImportForecast[] = [];
  const fcMonths = new Set<string>();
  fg.items.forEach((it) =>
    it.months.forEach((q, i) => {
      if (q === null || q <= 0) return;
      const month = `${fg.year}-${String(i + 1).padStart(2, "0")}-01`;
      fcMonths.add(month);
      weight(it.code);
      forecasts.push({ month, sku_id: skuBy.get(it.code)?.id ?? null, code: it.code, qty: q });
    }),
  );
  // a code listed twice in Items adds up
  const fcBy = new Map<string, ImportForecast>();
  for (const f of forecasts) {
    const k = `${f.month}|${f.code}`;
    const cur = fcBy.get(k);
    if (cur) cur.qty += f.qty;
    else fcBy.set(k, { ...f });
  }

  const orders: ImportOrder[] = fg.orders.map((o) => {
    weight(o.code);
    return { ...o, sku_id: skuBy.get(o.code)?.id ?? null };
  });

  return {
    packed,
    forecasts: [...fcBy.values()],
    orders,
    days: [...new Set(packed.map((p) => p.day))].sort(),
    forecastMonths: [...fcMonths].sort(),
    orderMonths: [...new Set(orders.map((o) => o.month))].sort(),
    lineIds: [...new Set(packed.map((p) => p.line_id))],
    unknownCodes: [...unknown].sort(),
    noWeight: [...noWeight].sort(),
    noLine,
  };
}
