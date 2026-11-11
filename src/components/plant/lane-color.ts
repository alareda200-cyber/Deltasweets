/** For lines whose colour in Settings is a plain grey. */
const FALLBACK = ["#6f9bff", "#3ddc97", "#ff7ab6", "#ffb648", "#3fd7e6", "#b08cff"];

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * The line's colour from Settings, made readable on the stage: lifted toward
 * white at night, kept as it is by day. A grey gets a colour from the stage's
 * own set, so the lanes stay distinguishable.
 */
export function laneColor(color: string, index: number, day: boolean): string {
  const c = rgb(color);
  const grey = !c || Math.max(...c) - Math.min(...c) < 28;
  const base = grey ? rgb(FALLBACK[index % FALLBACK.length])! : c;
  const k = day ? (grey ? -0.22 : 0) : grey ? 0 : 0.38;
  const mix = (v: number) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
  return `rgb(${mix(base[0])}, ${mix(base[1])}, ${mix(base[2])})`;
}
