// Pure helpers for the Daily Entry form (src/routes/entry.tsx).
//
// Kept free of React and Supabase imports so the rules that decide whether a
// supervisor's typing survives a line/date/shift switch can be tested on their
// own. Everything here works on the form's string-typed values, exactly as the
// inputs hold them.

export interface DtRow {
  reason_id: string;
  reason_name: string;
  area: string;
  minutes: number;
}

export type OwnerSelections = Record<string, { ownerId: string; score: string }>;

export interface EntryFormValues {
  makingPlan: string;
  makingActual: string;
  packingPlan: string;
  packingActual: string;
  availableMin: string;
  reworkCooking: string;
  reworkMaking: string;
  reworkPacking: string;
  comments: string;
  customValues: Record<string, string>;
  downtimes: DtRow[];
  areaOwners: OwnerSelections;
}

// 1,440 is what 233 of the 234 saved entries use, shift A included — shift A
// is in practice the plant's single daily shift, so this is not derived from
// the shift.
export const DEFAULT_AVAILABLE_MIN = "1440";

export function emptyValues(): EntryFormValues {
  return {
    makingPlan: "",
    makingActual: "",
    packingPlan: "",
    packingActual: "",
    availableMin: DEFAULT_AVAILABLE_MIN,
    reworkCooking: "0",
    reworkMaking: "0",
    reworkPacking: "0",
    comments: "",
    customValues: {},
    downtimes: [],
    areaOwners: {},
  };
}

export interface EntryRowLike {
  making_plan: number;
  making_actual: number;
  packing_plan: number;
  packing_actual: number;
  available_min: number;
  rework_cooking: number;
  rework_making: number;
  rework_packing: number;
  comments: string | null;
  custom_fields: unknown;
}

export interface DowntimeRowLike {
  reason_id: string | null;
  reason_name: string;
  area: string;
  minutes: number | string;
}

export interface OwnerRowLike {
  production_area_id: string;
  owner_id: string | null;
  performance_score: number | string | null;
}

export function valuesFromRows(
  entry: EntryRowLike,
  downtimes: DowntimeRowLike[],
  owners: OwnerRowLike[],
): EntryFormValues {
  return {
    makingPlan: String(entry.making_plan),
    makingActual: String(entry.making_actual),
    packingPlan: String(entry.packing_plan),
    packingActual: String(entry.packing_actual),
    availableMin: String(entry.available_min),
    reworkCooking: String(entry.rework_cooking),
    reworkMaking: String(entry.rework_making),
    reworkPacking: String(entry.rework_packing),
    comments: entry.comments ?? "",
    customValues: Object.fromEntries(
      Object.entries((entry.custom_fields ?? {}) as Record<string, unknown>).map(([k, v]) => [
        k,
        String(v ?? ""),
      ]),
    ),
    downtimes: downtimes.map((d) => ({
      reason_id: d.reason_id ?? "",
      reason_name: d.reason_name,
      area: d.area,
      minutes: Number(d.minutes),
    })),
    areaOwners: Object.fromEntries(
      owners.map((o) => [
        o.production_area_id,
        {
          ownerId: o.owner_id ?? "",
          score: o.performance_score != null ? String(o.performance_score) : "",
        },
      ]),
    ),
  };
}

// "12" and "12.0" are the same number to the database, so they must not count
// as an unsaved change; "" and "0" are not the same to the form (blank plan
// shows "—"), so non-numeric text is compared as trimmed text.
function norm(v: string): string {
  const t = v.trim();
  if (t === "") return "";
  const n = Number(t);
  return Number.isFinite(n) ? String(n) : t;
}

// Only rows Save would actually write: a reason and more than 0 minutes.
export function savableDowntimes(rows: DtRow[]): DtRow[] {
  return rows.filter((d) => d.reason_name && Number(d.minutes) > 0);
}

function downtimeKey(rows: DtRow[]): string {
  return JSON.stringify(
    rows.map((d) => [d.reason_id, d.reason_name, d.area.trim(), Number(d.minutes) || 0]),
  );
}

// Order matters: a supervisor who deletes row 2 and re-adds it at the end has
// changed the list as far as they can see, and Save rewrites all rows anyway.
export function sameDowntimes(a: DtRow[], b: DtRow[]): boolean {
  return downtimeKey(savableDowntimes(a)) === downtimeKey(savableDowntimes(b));
}

function ownersKey(sel: OwnerSelections): string {
  return JSON.stringify(
    Object.entries(sel)
      .filter(([, s]) => !!s.ownerId || s.score.trim() !== "")
      .map(([area, s]) => [area, s.ownerId, norm(s.score)])
      .sort(([x], [y]) => String(x).localeCompare(String(y))),
  );
}

export function sameOwners(a: OwnerSelections, b: OwnerSelections): boolean {
  return ownersKey(a) === ownersKey(b);
}

function customKey(c: Record<string, string>): string {
  return JSON.stringify(
    Object.entries(c)
      .filter(([, v]) => v.trim() !== "")
      .map(([k, v]) => [k, norm(v)])
      .sort(([x], [y]) => String(x).localeCompare(String(y))),
  );
}

export function sameValues(a: EntryFormValues, b: EntryFormValues): boolean {
  const scalar: (keyof EntryFormValues)[] = [
    "makingPlan",
    "makingActual",
    "packingPlan",
    "packingActual",
    "availableMin",
    "reworkCooking",
    "reworkMaking",
    "reworkPacking",
  ];
  for (const k of scalar) {
    if (norm(a[k] as string) !== norm(b[k] as string)) return false;
  }
  if (a.comments.trim() !== b.comments.trim()) return false;
  if (customKey(a.customValues) !== customKey(b.customValues)) return false;
  // A half-filled downtime row (a reason but no minutes yet, or the reverse)
  // is typing the supervisor would lose, so it counts. A row added and left
  // completely blank does not — Save would skip it anyway.
  const touched = (rows: DtRow[]) => rows.filter((d) => d.reason_name || Number(d.minutes) > 0);
  if (downtimeKey(touched(a.downtimes)) !== downtimeKey(touched(b.downtimes))) return false;
  return sameOwners(a.areaOwners, b.areaOwners);
}

// ---------------------------------------------------------------------------
// Switching line / date / shift
// ---------------------------------------------------------------------------

export type SwitchDecision = "load" | "reset" | "carry" | "confirm-load" | "confirm-reset";

/**
 * What to do with the form when the supervisor points it at another
 * line/date/shift ("slot").
 *
 * - The target already has a saved entry: open it. If the form holds unsaved
 *   typing, ask first — opening it would replace that typing.
 * - The target is empty and nothing was typed: start a blank entry.
 * - The target is empty and the form is an unsaved NEW entry: keep what was
 *   typed. This is the "I picked the wrong date" case; before, it wiped the
 *   form, and it is also what makes Duplicate usable.
 * - The target is empty and the form is an edited SAVED entry: ask. Carrying
 *   those edits to another day would silently fork the saved entry.
 */
export function decideSwitch(args: {
  dirty: boolean;
  editingSaved: boolean;
  target: "existing" | "empty";
}): SwitchDecision {
  const { dirty, editingSaved, target } = args;
  if (target === "existing") return dirty ? "confirm-load" : "load";
  if (!dirty) return "reset";
  return editingSaved ? "confirm-reset" : "carry";
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type NumericField =
  | "makingPlan"
  | "makingActual"
  | "packingPlan"
  | "packingActual"
  | "availableMin"
  | "reworkCooking"
  | "reworkMaking"
  | "reworkPacking";

export interface ValidationResult {
  fields: Partial<Record<NumericField, string>>;
  downtimes: Record<number, string>;
  ownerScores: Record<string, string>;
  count: number;
}

const MAX_DAY_MIN = 1440;

function checkNonNegative(v: string): string | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return "Enter a number";
  if (n < 0) return "Can't be negative";
  return null;
}

/**
 * Checks only the parts the current role may edit — a restricted role saves
 * the loaded values for everything else, and must not be blocked by them.
 */
export function validateValues(
  v: EntryFormValues,
  can: { production: boolean; downtime: boolean; areaOwners: boolean },
): ValidationResult {
  const fields: ValidationResult["fields"] = {};
  if (can.production) {
    for (const k of [
      "makingPlan",
      "makingActual",
      "packingPlan",
      "packingActual",
      "reworkCooking",
      "reworkMaking",
      "reworkPacking",
    ] as const) {
      const err = checkNonNegative(v[k]);
      if (err) fields[k] = err;
    }
  }
  {
    const t = v.availableMin.trim();
    const n = Number(t);
    if (t === "" || !Number.isFinite(n) || n <= 0 || n > MAX_DAY_MIN) {
      fields.availableMin = "Enter 1 to 1,440 minutes";
    }
  }

  const downtimes: Record<number, string> = {};
  if (can.downtime) {
    v.downtimes.forEach((d, i) => {
      const mins = Number(d.minutes) || 0;
      if (!d.reason_name && mins <= 0) return; // untouched row: skipped on save
      if (!d.reason_name) downtimes[i] = "Pick a reason";
      else if (mins <= 0) downtimes[i] = "Enter the minutes";
      else if (mins > MAX_DAY_MIN) downtimes[i] = "More than a whole day";
    });
  }

  const ownerScores: Record<string, string> = {};
  if (can.areaOwners) {
    for (const [areaId, sel] of Object.entries(v.areaOwners)) {
      const t = sel.score.trim();
      if (t === "") continue;
      const n = Number(t);
      if (!Number.isFinite(n) || n < 0 || n > 100) ownerScores[areaId] = "0 to 100";
    }
  }

  return {
    fields,
    downtimes,
    ownerScores,
    count:
      Object.keys(fields).length + Object.keys(downtimes).length + Object.keys(ownerScores).length,
  };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function shiftLabel(shift: string): string {
  return shift === "DAY" ? "Full day" : `Shift ${shift}`;
}

export function formatSavedAt(isoTs: string): string {
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDate();
  // Fixed names: en-GB in newer ICU spells September "Sept".
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][d.getMonth()];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${hh}:${mm}`;
}
