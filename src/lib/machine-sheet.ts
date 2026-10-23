// The machine sheet pasted on the daily entry. Two layouts, also mixed in one
// paste — read from the right, so the extra Twist column doesn't shift them:
//   Rovema (20 Oct 2026): Code · Type · Operator · Bag weight · Machine ·
//     D-Speed · Total Quantity · Shift. Bag weight is the film's weight (kept
//     only); the quantity is bags, their grams read from the SKU name.
//   Twist (23 Oct 2026): Code · Type · Operator · Paper weight (kg a piece) ·
//     Piece weight (kg) · Machine · D-Speed · Total Quantity · Shift. The code
//     is the wrapper paper's, not a SKU; the quantity is pieces (7 g each).
// D-Speed is the speed the machine was set to run at; the OEE uses the
// machine's speed from Settings. Header rows and blank lines are skipped.
import type { PackingMachine, Sku } from "@/lib/packing";

export interface SheetRow {
  shift: "A" | "B" | "C";
  machineName: string;
  machine: PackingMachine | null;
  code: string;
  name: string;
  sku: Sku | null;
  operator: string;
  film: number | null;
  setSpeed: number | null;
  bags: number;
  bagG: number | null;
}

export interface MachineSheet {
  rows: SheetRow[];
  /** Rows whose machine isn't in Settings › Packing. */
  unknownMachines: string[];
  /** Lines that aren't a sheet row (header, totals, wrong shift…). */
  ignored: number;
}

const num = (s: string | undefined): number | null => {
  const t = (s ?? "").replace(/,/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.]+/g, "");

/** Grams in one bag, from a SKU name: "× 20 جم" → 20, "× 1 كيلو" → 1000. */
export function gramsPerBag(name: string): number | null {
  const g = /(\d+(?:\.\d+)?)\s*(?:جم|جرام|gm|gr|g)(?![a-z])/i.exec(name);
  if (g) return Number(g[1]);
  const k = /(\d+(?:\.\d+)?)\s*(?:كيلو|كجم|kg)/i.exec(name);
  if (k) return Number(k[1]) * 1000;
  return null;
}

export function parseMachineSheet(
  text: string,
  opts: { machines: PackingMachine[]; skus: Map<string, Sku> },
): MachineSheet {
  const byName = new Map(opts.machines.map((m) => [norm(m.name), m]));
  const out: MachineSheet = { rows: [], unknownMachines: [], ignored: 0 };
  const unknown = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const c = raw.split("\t").map((x) => x.trim());
    while (c.length > 0 && c[c.length - 1] === "") c.pop();
    const n = c.length;
    const shift = (c[n - 1] ?? "").toUpperCase();
    const bags = num(c[n - 2]);
    // 8 cells (Rovema) or 9 (Twist): one or two weights between operator and machine.
    const weights = c.slice(3, n - 4);
    if (
      (n !== 8 && n !== 9) ||
      !/^\d{6,}$/.test(c[0] ?? "") ||
      !["A", "B", "C"].includes(shift) ||
      bags === null
    ) {
      out.ignored++;
      continue;
    }
    const machineName = c[n - 4] ?? "";
    const machine = byName.get(norm(machineName)) ?? null;
    if (!machine) unknown.add(machineName || "(empty)");
    const sku = opts.skus.get(c[0]) ?? null;
    const name = (sku?.name || c[1] || "").replace(/\s+/g, " ").trim();
    // Twist: the piece weight in kg (0.007) or grams (7).
    const piece = weights.length === 2 ? num(weights[1]) : null;
    const pieceG = piece !== null && piece > 0 ? (piece < 1 ? piece * 1000 : piece) : null;
    out.rows.push({
      shift: shift as SheetRow["shift"],
      machineName,
      machine,
      code: c[0],
      name,
      sku,
      operator: (c[2] ?? "").replace(/\s+/g, " ").trim(),
      film: num(weights[0]),
      setSpeed: num(c[n - 3]),
      bags,
      bagG:
        pieceG !== null
          ? Math.round(pieceG * 1000) / 1000
          : (gramsPerBag(c[1] || name) ?? gramsPerBag(name)),
    });
  }
  out.unknownMachines = [...unknown];
  return out;
}

/** Shifts and bags per machine, as the database sums them for the entry. */
export function summariseSheet(
  rows: { machineId: string; shift: string; bags: number; bagG: number | null }[],
) {
  const by = new Map<string, { shifts: Set<string>; bags: number; gBags: number; g: number }>();
  for (const r of rows) {
    const s = by.get(r.machineId) ?? { shifts: new Set<string>(), bags: 0, gBags: 0, g: 0 };
    s.shifts.add(r.shift);
    s.bags += r.bags;
    if (r.bagG !== null) {
      s.gBags += r.bags;
      s.g += r.bags * r.bagG;
    }
    by.set(r.machineId, s);
  }
  return new Map(
    [...by.entries()].map(([id, s]) => [
      id,
      {
        shifts: s.shifts.size,
        bags: s.bags,
        bagG: s.gBags > 0 ? Math.round((s.g / s.gBags) * 100) / 100 : null,
      },
    ]),
  );
}
