// Rows pasted from Excel on the Plan adherence page.
//
// Packed sheet: Date · Item code · Description · Cartons · … · Line. Nothing
// depends on the column order:
//   - the code is the first cell that is 6+ digits,
//   - the quantity is the first plain number after the code's description,
//   - a cell naming a production line gives the row's line (else the SKU's
//     line from Settings › Packing),
//   - a cell holding a date gives the row's day (else the day picked on the
//     page), so several days can be pasted at once.
// Forecast sheet: Item code · Name · Quantity.
// kg = quantity × the SKU's kg per unit. A code that isn't in the SKU list is
// kept and flagged, with no kg.

import type { Sku } from "@/lib/packing";

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** Day and month of a pasted date cell, or null when the cell isn't a date. */
export function pastedDayMonth(cell: string): { day: number; month: number } | null {
  const t = cell.trim();
  let m = /^(\d{1,2})[-\s/.]([A-Za-z]{3,4})(?:[-\s/.](\d{2,4}))?$/.exec(t);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    return month ? { day: Number(m[1]), month } : null;
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return { day: Number(m[3]), month: Number(m[2]) };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (m) return { day: Number(m[1]), month: Number(m[2]) };
  return null;
}

function plainNumber(cell: string): number | null {
  const t = cell.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
const pad = (n: number) => String(n).padStart(2, "0");

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface PackedRow {
  code: string;
  qty: number;
  name: string;
  kg: number | null;
  sku: Sku | null;
  lineId: string | null;
  day: string;
}

export interface PackedPaste {
  rows: PackedRow[];
  /** Rows whose line can't be told (unknown code, no line cell). */
  noLine: PackedRow[];
  /** Lines without an item code or a quantity (headers, totals…). */
  ignored: number;
}

export function parsePackedSheet(
  text: string,
  opts: {
    skus: Map<string, Sku>;
    lines: { id: string; name: string }[];
    /** "YYYY-MM-DD" for rows without a date cell; its year for those with one. */
    day: string;
  },
): PackedPaste {
  const lineByName = new Map(opts.lines.map((l) => [norm(l.name), l.id]));
  // The SKU list writes some lines short ("Tube", "MawlidSweets").
  for (const l of opts.lines) {
    if (norm(l.name) === "sourtube") lineByName.set("tube", l.id);
  }
  const year = Number(opts.day.slice(0, 4));
  const out: PackedPaste = { rows: [], noLine: [], ignored: 0 };
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = raw.split("\t");
    const ci = cells.findIndex((c) => /^\d{6,}$/.test(c.trim()));
    if (ci < 0) {
      out.ignored++;
      continue;
    }
    let qty: number | null = null;
    for (let i = ci + 2; i < cells.length && qty === null; i++) qty = plainNumber(cells[i]);
    if (qty === null) qty = plainNumber(cells[ci + 1] ?? "");
    if (qty === null) {
      out.ignored++;
      continue;
    }
    const code = cells[ci].trim();
    const sku = opts.skus.get(code) ?? null;
    const lineCell = cells.find((c) => lineByName.has(norm(c)));
    const lineId = (lineCell ? lineByName.get(norm(lineCell)) : null) ?? sku?.line_id ?? null;
    const dm = cells
      .slice(0, ci)
      .map(pastedDayMonth)
      .find((d) => d !== null);
    const day = dm ? `${year}-${pad(dm.month)}-${pad(dm.day)}` : opts.day;
    const row: PackedRow = {
      code,
      qty,
      name: sku?.name ?? (cells[ci + 1] ?? "").trim(),
      kg: sku?.kg_per_unit != null ? round2(qty * sku.kg_per_unit) : null,
      sku,
      lineId,
      day,
    };
    if (lineId) out.rows.push(row);
    else out.noLine.push(row);
  }
  return out;
}

export interface ForecastRow {
  code: string;
  qty: number;
  name: string;
  sku: Sku | null;
  kg: number | null;
}

/** Item code · Name · Quantity, one SKU per line; repeated codes add up. */
export function parseForecastSheet(
  text: string,
  skus: Map<string, Sku>,
): { rows: ForecastRow[]; ignored: number } {
  const byCode = new Map<string, ForecastRow>();
  let ignored = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = raw.split("\t");
    const ci = cells.findIndex((c) => /^\d{6,}$/.test(c.trim()));
    if (ci < 0) {
      ignored++;
      continue;
    }
    let qty: number | null = null;
    for (let i = ci + 2; i < cells.length && qty === null; i++) qty = plainNumber(cells[i]);
    if (qty === null) qty = plainNumber(cells[ci + 1] ?? "");
    if (qty === null) {
      ignored++;
      continue;
    }
    const code = cells[ci].trim();
    const sku = skus.get(code) ?? null;
    const prev = byCode.get(code);
    const total = (prev?.qty ?? 0) + qty;
    byCode.set(code, {
      code,
      qty: total,
      name: sku?.name ?? prev?.name ?? (cells[ci + 1] ?? "").trim(),
      sku,
      kg: sku?.kg_per_unit != null ? round2(total * sku.kg_per_unit) : null,
    });
  }
  return { rows: [...byCode.values()], ignored };
}
