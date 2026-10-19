// kg per unit (carton, box, bag…) read from a SKU name, e.g.
//   "كاندى كولا 48 كيس × 20 جم"            → 48 × 0.020 = 0.96 kg
//   "كاندى كولا 6 علبه× 12 كيس×25جم"        → 6 × 12 × 0.025 = 1.8 kg
//   "كاندى دبدوب 250جم × 36 برطمان"          → 36 × 0.25 = 9 kg
//   "كاندى عروسه علبة 7 كيلو"               → 7 kg
// The weight is the first "<n> جم/جرام" (else "<n> كيلو"); every "<n> كيس /
// علبه / استاند / برطمان / شريط / امبول / ق" multiplies it, and so does a
// trailing "× <n>" after the weight ("برطمان 400 جم × 9"). A SKU sold by the
// kilo (unit كيلو) is 1 kg per unit. Anything else is null: the name doesn't
// say, so someone fills it in once in Settings.

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function westernDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

const COUNT_WORDS = "كيس|علبه|علبة|استاند|برطمان|شريط|امبول|ق";

export function kgPerUnitFromName(name: string, unit?: string | null): number | null {
  if ((unit ?? "").trim() === "كيلو") return 1;
  const s = westernDigits(name).replace(/\s+/g, " ");
  let weightKg: number | null = null;
  let weightEnd = -1;
  const g = /(\d+(?:\.\d+)?)\s*(?:جم|جرام|جرم)/.exec(s);
  if (g) {
    weightKg = Number(g[1]) / 1000;
    weightEnd = g.index + g[0].length;
  } else {
    const k = /(\d+(?:\.\d+)?)\s*كيلو/.exec(s);
    if (k) {
      weightKg = Number(k[1]);
      weightEnd = k.index + k[0].length;
    }
  }
  if (weightKg === null || !(weightKg > 0)) return null;

  let count = 1;
  const counts = new RegExp(`(\\d+)\\s*(?:${COUNT_WORDS})`, "g");
  let m: RegExpExecArray | null;
  while ((m = counts.exec(s))) count *= Number(m[1]);
  // "برطمان 400 جم × 9": a bare count right after the weight.
  const tail = /^\s*[×x*]\s*(\d+)(?!\s*(?:جم|جرام|كيلو|\d))/.exec(s.slice(weightEnd));
  if (tail && !new RegExp(`^\\s*[×x*]\\s*\\d+\\s*(?:${COUNT_WORDS})`).test(s.slice(weightEnd))) {
    count *= Number(tail[1]);
  }
  const kg = count * weightKg;
  return Number.isFinite(kg) && kg > 0 ? Math.round(kg * 1000) / 1000 : null;
}
