export function monthRange(d: Date = new Date()): { from: string; to: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  return { from: iso(start), to: iso(end) };
}

export function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const fmt = (n: number, digits = 0) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits });

export const pct = (n: number, digits = 1) =>
  `${(n * 100).toFixed(digits)}%`;
