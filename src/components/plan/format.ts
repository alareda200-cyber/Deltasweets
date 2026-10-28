// Number and date wording shared by the Plan adherence parts.
export const kgFmt = (n: number) => Math.round(n).toLocaleString("en-US");
export const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
export const pctFmt = (v: number) => `${Math.round(v * 100).toLocaleString("en-US")}%`;
/** Tons with one decimal: 452,316 kg → "452.3". */
export const tons = (kg: number) =>
  (Math.round(kg / 100) / 10).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
export const compact = (n: number) =>
  n >= 1000
    ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "")}K`
    : String(Math.round(n));
export const dayNum = (d: string) => Number(d.slice(8, 10));
export const shortDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
export const longDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
export const monthShort = (m: string) =>
  new Date(`${m.slice(0, 7)}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short" });

/** A colour per production line, steady across the page. */
const PALETTE = [
  "var(--color-chart-1)",
  "var(--color-chart-3)",
  "var(--color-chart-2)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];
export function lineColors(lineIds: (string | null)[]): (id: string | null) => string {
  const order = [...new Set(lineIds)];
  return (id) => {
    const i = order.indexOf(id);
    return i < 0 ? "var(--color-muted-foreground)" : PALETTE[i % PALETTE.length];
  };
}
