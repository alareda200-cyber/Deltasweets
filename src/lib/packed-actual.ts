// Packing actual comes from Plan adherence (Ala, 25 Oct 2026): "no line's
// actual packing is counted except from the daily pasted SKUs". The database
// writes the pasted kg into the Full-day entry only, so a line entered by
// shift (Marshmallows: A / B) showed almost no packing — 2,429 kg against
// 21,297 kg packed in 1–24 Oct.
//
// For every line that has pasted SKUs in the data, from PACKED_FROM on, each
// day's packing actual is the day's packed kg: on the Full-day entry when
// there is one, else on the day's first shift (A, then B, then C); the day's
// other entries count 0, and a day with no pasted SKUs counts 0. Lines that
// never paste SKUs (Delta) and days before PACKED_FROM keep what was typed.
export const PACKED_FROM = "2026-10-01";

interface EntryLike {
  line_id: string;
  entry_date: string;
  shift: string;
  packing_actual: number | null;
}

const SHIFT_ORDER: Record<string, number> = { DAY: 0, A: 1, B: 2, C: 3 };

export function withPackedActual<T extends EntryLike>(
  entries: T[] | undefined,
  packed: { line_id: string; day: string; kg: number | null }[] | undefined,
): T[] | undefined {
  if (!entries || !packed || packed.length === 0) return entries;
  const kgByLineDay = new Map<string, number>();
  const lines = new Set<string>();
  for (const p of packed) {
    lines.add(p.line_id);
    const k = `${p.line_id}|${p.day}`;
    kgByLineDay.set(k, (kgByLineDay.get(k) ?? 0) + (Number(p.kg) || 0));
  }
  // the entry that carries each line-day's packed kg
  const carrier = new Map<string, T>();
  for (const e of entries) {
    if (!lines.has(e.line_id) || e.entry_date < PACKED_FROM) continue;
    const k = `${e.line_id}|${e.entry_date}`;
    const cur = carrier.get(k);
    if (!cur || (SHIFT_ORDER[e.shift] ?? 9) < (SHIFT_ORDER[cur.shift] ?? 9)) carrier.set(k, e);
  }
  return entries.map((e) => {
    if (!lines.has(e.line_id) || e.entry_date < PACKED_FROM) return e;
    const k = `${e.line_id}|${e.entry_date}`;
    const kg = carrier.get(k) === e ? Math.round((kgByLineDay.get(k) ?? 0) * 100) / 100 : 0;
    return Number(e.packing_actual) === kg ? e : { ...e, packing_actual: kg };
  });
}
