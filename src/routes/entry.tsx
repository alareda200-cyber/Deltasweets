import { createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Fragment,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { EntryHistoryPanel } from "@/components/EntryHistoryPanel";
import { CollapsibleRow } from "@/components/entry/CollapsibleRow";
import { DOWNTIME_GRID_COLS, DowntimeRowEditor } from "@/components/entry/DowntimeRowEditor";
import { EntrySection } from "@/components/entry/EntrySection";
import { JellyJar, Odometer, useGummyBurst, useTilt, type JarMood } from "@/components/motion";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Trash2,
  Plus,
  Save,
  History,
  ChevronDown,
  AlertTriangle,
  Pencil,
  FilePlus2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  linesQuery,
  reasonsQuery,
  fieldsQuery,
  productionAreasQuery,
  areaOwnersQuery,
  downtimeTypesQuery,
  productionTargetsQuery,
  DEFAULT_TARGETS,
  type EntryHistoryRow,
} from "@/lib/queries";
import { iso } from "@/lib/date-utils";
import { requireSession } from "@/lib/require-session";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  type DtRow,
  type EntryFormValues,
  type SwitchDecision,
  type ValidationResult,
  changedFields,
  decideSwitch,
  emptyValues,
  formatDay,
  formatSavedAt,
  sameDowntimes,
  sameOwners,
  sameValues,
  savableDowntimes,
  shiftLabel,
  validateValues,
  valuesFromRows,
} from "@/lib/entry-form";

// /entry?line=<id>&date=YYYY-MM-DD&shift=DAY opens that entry directly (the
// Dashboard's "Open this entry" link). Only read once, when the page opens.
interface EntrySearch {
  line?: string;
  date?: string;
  shift?: string;
}

const SHIFT_VALUES = ["DAY", "A", "B", "C"];

export const Route = createFileRoute("/entry")({
  head: () => ({ meta: [{ title: "Daily Entry · Production Scorecard" }] }),
  validateSearch: (search: Record<string, unknown>): EntrySearch => ({
    line: typeof search.line === "string" && search.line ? search.line : undefined,
    date:
      typeof search.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.date)
        ? search.date
        : undefined,
    shift:
      typeof search.shift === "string" && SHIFT_VALUES.includes(search.shift)
        ? search.shift
        : undefined,
  }),
  beforeLoad: requireSession,
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(linesQuery),
      context.queryClient.ensureQueryData(reasonsQuery),
      context.queryClient.ensureQueryData(productionAreasQuery),
      context.queryClient.ensureQueryData(areaOwnersQuery),
    ]),
  component: () => (
    <RequireAuth requirePermission="entry.view">
      <EntryPage />
    </RequireAuth>
  ),
});

// Adherence (actual/plan): higher is better. Loss (downtime/available): lower
// is better. Same bands as the Dashboard (adherenceTone / lossTone in
// src/lib/dashboard-metrics.ts), around the targets from Settings › Targets:
// amber from target − 20 points, red below; loss amber up to 2.5 × the alert.
function adherenceColor(pct: number | null, targetPct: number) {
  if (pct === null) return "text-muted-foreground";
  return pct >= targetPct
    ? "text-success-strong"
    : pct >= targetPct - 20
      ? "text-warning-strong"
      : "text-destructive-strong";
}
function lossColor(pct: number | null, alertPct: number) {
  if (pct === null) return "text-muted-foreground";
  return pct < alertPct
    ? "text-success-strong"
    : pct < alertPct * 2.5
      ? "text-warning-strong"
      : "text-destructive-strong";
}
const fmtNum = (n: number) => n.toLocaleString("en-US");

// Desktop shift switch, in the order supervisors use them (Full day first:
// 212 of 234 saved entries).
const SHIFTS = [
  ["DAY", "Full day"],
  ["A", "A"],
  ["B", "B"],
  ["C", "C"],
] as const;

// One line + day + shift. The form always shows exactly one of these.
interface Slot {
  lineId: string;
  date: string;
  shift: string;
}

// What the database holds for the slot on screen. "existing" carries the
// row's updated_at so Save can refuse to overwrite someone else's newer save.
type SlotState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "existing"; id: string; updatedAt: string };

type SlotLookup =
  { kind: "empty" } | { kind: "existing"; id: string; updatedAt: string; values: EntryFormValues };

interface PendingSwitch {
  target: Slot;
  lookup: SlotLookup;
  decision: SwitchDecision;
  readOnly?: boolean;
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String(err.message);
  return String(err);
}

// Every read is checked. Before, a failed read of an existing entry looked
// exactly like "no entry yet": the form came up blank, and Save then replaced
// the real row and deleted its downtimes.
async function fetchSlot(s: Slot): Promise<SlotLookup> {
  const { data, error } = await supabase
    .from("daily_entries")
    .select("*")
    .eq("line_id", s.lineId)
    .eq("entry_date", s.date)
    .eq("shift", s.shift)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { kind: "empty" };
  const [dts, owners] = await Promise.all([
    supabase.from("entry_downtimes").select("*").eq("entry_id", data.id).order("created_at"),
    supabase.from("entry_area_owners").select("*").eq("entry_id", data.id),
  ]);
  if (dts.error) throw dts.error;
  if (owners.error) throw owners.error;
  return {
    kind: "existing",
    id: data.id,
    updatedAt: data.updated_at,
    values: valuesFromRows(data, dts.data ?? [], owners.data ?? []),
  };
}

// Insert the new rows first, then delete the old ones. If the insert fails
// nothing was removed; if the delete fails the new rows are taken back out.
// (Before, the old rows were deleted first and a failed insert lost them.)
// Not a transaction — that needs a database function — but no failure here
// leaves the entry with fewer rows than it had.
async function replaceDowntimeRows(
  entryId: string,
  rows: {
    entry_id: string;
    reason_id: string | null;
    reason_name: string;
    area: string;
    minutes: number;
  }[],
) {
  let newIds: string[] = [];
  if (rows.length > 0) {
    const { data, error } = await supabase.from("entry_downtimes").insert(rows).select("id");
    if (error) throw error;
    newIds = (data ?? []).map((r) => r.id);
  }
  let del = supabase.from("entry_downtimes").delete().eq("entry_id", entryId);
  if (newIds.length > 0) del = del.not("id", "in", `(${newIds.join(",")})`);
  const { error: delErr } = await del;
  if (delErr) {
    if (newIds.length > 0) await supabase.from("entry_downtimes").delete().in("id", newIds);
    throw delErr;
  }
}

async function replaceAreaOwnerRows(
  entryId: string,
  rows: {
    entry_id: string;
    production_area_id: string;
    owner_id: string | null;
    performance_score: number | null;
  }[],
) {
  let newIds: string[] = [];
  if (rows.length > 0) {
    const { data, error } = await supabase.from("entry_area_owners").insert(rows).select("id");
    if (error) throw error;
    newIds = (data ?? []).map((r) => r.id);
  }
  let del = supabase.from("entry_area_owners").delete().eq("entry_id", entryId);
  if (newIds.length > 0) del = del.not("id", "in", `(${newIds.join(",")})`);
  const { error: delErr } = await del;
  if (delErr) {
    if (newIds.length > 0) await supabase.from("entry_area_owners").delete().in("id", newIds);
    throw delErr;
  }
}

function EntryPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { role } = useAuth();
  const canEditProduction = can(role, "entry.editProduction");
  const canEditDowntime = can(role, "entry.editDowntime");
  const canEditAreaOwners = can(role, "entry.editAreaOwners");
  const canEditNotes = can(role, "entry.editNotes");
  const canCreate = can(role, "entry.create");
  const canDelete = can(role, "entry.delete");
  const canViewHistory = can(role, "entry.history");
  const { data: lines } = useSuspenseQuery(linesQuery);
  const { data: reasons } = useSuspenseQuery(reasonsQuery);
  const { data: productionAreas } = useSuspenseQuery(productionAreasQuery);
  const { data: areaOwners } = useSuspenseQuery(areaOwnersQuery);

  const search = Route.useSearch();
  const [lineId, setLineId] = useState(
    search.line && lines.some((l) => l.id === search.line) ? search.line : (lines[0]?.id ?? ""),
  );
  const [date, setDate] = useState(search.date ?? iso(new Date()));
  // 212 of the 234 saved entries are "Full day". Opening on shift A sent
  // supervisors to an empty A slot next to that day's real entry.
  const [shift, setShift] = useState(search.shift ?? "DAY");
  const supervisor = "";
  const operator = "";
  const initial = useMemo(() => emptyValues(), []);
  const [comments, setComments] = useState(initial.comments);
  const [makingPlan, setMakingPlan] = useState(initial.makingPlan);
  const [makingActual, setMakingActual] = useState(initial.makingActual);
  const [packingPlan, setPackingPlan] = useState(initial.packingPlan);
  const [packingActual, setPackingActual] = useState(initial.packingActual);
  const [availableMin, setAvailableMin] = useState(initial.availableMin);
  const [reworkCooking, setReworkCooking] = useState(initial.reworkCooking);
  const [reworkMaking, setReworkMaking] = useState(initial.reworkMaking);
  const [reworkPacking, setReworkPacking] = useState(initial.reworkPacking);
  const [downtimes, setDowntimes] = useState<DtRow[]>(initial.downtimes);
  const [areaOwnerSelections, setAreaOwnerSelections] = useState(initial.areaOwners);
  const [customValues, setCustomValues] = useState<Record<string, string>>(initial.customValues);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Collapsed/expanded state for the Rework / Area owners / Comments rows.
  // Desktop and mobile render different blocks for these, never both at once,
  // so one state per section serves both.
  const [openRework, setOpenRework] = useState(false);
  const [openAreaOwners, setOpenAreaOwners] = useState(false);
  const [openComments, setOpenComments] = useState(false);
  // Phone only: the line / day / shift pickers under the context button.
  const [openWhich, setOpenWhich] = useState(true);

  // What the form was loaded with — the saved entry, or a blank one. The form
  // has unsaved changes whenever it differs from this.
  const [baseline, setBaseline] = useState<EntryFormValues>(initial);
  const [slot, setSlot] = useState<SlotState>({ status: "loading" });
  // true: the form shows the saved entry of the slot on screen. false with an
  // "existing" slot only happens after Duplicate lands on a taken day.
  const [editingSaved, setEditingSaved] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [errors, setErrors] = useState<ValidationResult | null>(null);

  // Motion. errorPulse changes on every Save that finds errors, so each wrong
  // field shakes once (never on a keystroke). savedFlash: the Save button says
  // "Saved" for a moment. party + celebrateKey + the gummy burst only ever run
  // after a save at or above the Making target.
  const [errorPulse, setErrorPulse] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);
  const [party, setParty] = useState(false);
  const [celebrateKey, setCelebrateKey] = useState(0);
  // Index of the downtime row just added with "Add downtime" (it slides in).
  const [newDowntimeIdx, setNewDowntimeIdx] = useState<number | null>(null);
  const gummy = useGummyBurst();
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (partyTimer.current) clearTimeout(partyTimer.current);
    },
    [],
  );

  const { data: customFields = [] } = useQuery(fieldsQuery(lineId));
  // Only for the Planned / Unplanned tags and totals; if it fails they are
  // simply left out.
  const { data: downtimeTypes = [] } = useQuery(downtimeTypesQuery);
  const { data: targets = DEFAULT_TARGETS } = useQuery(productionTargetsQuery());

  const values: EntryFormValues = useMemo(
    () => ({
      makingPlan,
      makingActual,
      packingPlan,
      packingActual,
      availableMin,
      reworkCooking,
      reworkMaking,
      reworkPacking,
      comments,
      customValues,
      downtimes,
      areaOwners: areaOwnerSelections,
    }),
    [
      makingPlan,
      makingActual,
      packingPlan,
      packingActual,
      availableMin,
      reworkCooking,
      reworkMaking,
      reworkPacking,
      comments,
      customValues,
      downtimes,
      areaOwnerSelections,
    ],
  );
  const dirty = useMemo(() => !sameValues(values, baseline), [values, baseline]);
  const changed = useMemo(() => changedFields(values, baseline), [values, baseline]);

  // Async handlers read these instead of the render they started in.
  const latest = useRef({ dirty, editingSaved, lineId, date, shift });
  latest.current = { dirty, editingSaved, lineId, date, shift };
  // Only the newest load may write to the form.
  const seq = useRef(0);
  // True while a save or delete is in flight. Switching slots then would let
  // the finishing save write its entry id into the NEW slot's state, and the
  // next Save would update the wrong row.
  const busy = useRef(false);
  const historyRef = useRef<HTMLDivElement>(null);

  function applyValues(v: EntryFormValues) {
    setMakingPlan(v.makingPlan);
    setMakingActual(v.makingActual);
    setPackingPlan(v.packingPlan);
    setPackingActual(v.packingActual);
    setAvailableMin(v.availableMin);
    setReworkCooking(v.reworkCooking);
    setReworkMaking(v.reworkMaking);
    setReworkPacking(v.reworkPacking);
    setComments(v.comments);
    setCustomValues(v.customValues);
    setDowntimes(v.downtimes);
    setAreaOwnerSelections(v.areaOwners);
    setNewDowntimeIdx(null);
  }

  function applyLookup(target: Slot, lookup: SlotLookup, decision: SwitchDecision) {
    setLineId(target.lineId);
    setDate(target.date);
    setShift(target.shift);
    setErrors(null);
    if (lookup.kind === "existing") {
      applyValues(lookup.values);
      setBaseline(lookup.values);
      setSlot({ status: "existing", id: lookup.id, updatedAt: lookup.updatedAt });
      setEditingSaved(true);
      return;
    }
    setSlot({ status: "empty" });
    setEditingSaved(false);
    if (decision === "carry") return; // keep the unsaved new entry as typed
    const blank = emptyValues();
    applyValues(blank);
    setBaseline(blank);
  }

  function describe(s: Slot) {
    const name = lines.find((l) => l.id === s.lineId)?.name ?? "this line";
    return `${name} · ${s.date} · ${shiftLabel(s.shift)}`;
  }

  // (Re)load the slot on screen, replacing the form. Used on first open,
  // after Save, and by Retry.
  async function reloadSlot() {
    const cur = latest.current;
    const target = { lineId: cur.lineId, date: cur.date, shift: cur.shift };
    if (!target.lineId) {
      setSlot({ status: "empty" });
      return;
    }
    const my = ++seq.current;
    setSlot({ status: "loading" });
    try {
      const lookup = await fetchSlot(target);
      if (my !== seq.current) return;
      applyLookup(target, lookup, lookup.kind === "existing" ? "load" : "reset");
    } catch (err) {
      if (my !== seq.current) return;
      setSlot({ status: "error", message: errMsg(err) });
    }
  }

  useEffect(() => {
    void reloadSlot();
    // First open only; later loads go through requestSwitch / reloadSlot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Point the form at another line/day/shift. Looks the target up first, then
  // decides (decideSwitch) whether to open it, start blank, keep the typing,
  // or ask before throwing typing away.
  async function requestSwitch(next: Partial<Slot>, opts: { readOnly?: boolean } = {}) {
    const cur = latest.current;
    const target: Slot = {
      lineId: next.lineId ?? cur.lineId,
      date: next.date ?? cur.date,
      shift: next.shift ?? cur.shift,
    };
    if (!target.lineId || !target.date) return;
    if (busy.current) {
      toast.info("Wait for the save to finish, then switch.");
      return;
    }
    const same =
      target.lineId === cur.lineId && target.date === cur.date && target.shift === cur.shift;
    if (same) {
      if (opts.readOnly !== undefined) setReadOnly(opts.readOnly);
      return;
    }
    const my = ++seq.current;
    setSwitching(true);
    let lookup: SlotLookup;
    try {
      lookup = await fetchSlot(target);
    } catch (err) {
      if (my !== seq.current) return;
      setSwitching(false);
      toast.error(`Couldn't open ${describe(target)}: ${errMsg(err)}`);
      return;
    }
    if (my !== seq.current) return;
    setSwitching(false);
    const decision = decideSwitch({
      dirty: latest.current.dirty,
      editingSaved: latest.current.editingSaved,
      target: lookup.kind,
    });
    if (decision === "confirm-load" || decision === "confirm-reset") {
      setPendingSwitch({ target, lookup, decision, readOnly: opts.readOnly });
      return;
    }
    applyLookup(target, lookup, decision);
    if (opts.readOnly !== undefined) setReadOnly(opts.readOnly);
  }

  function confirmPendingSwitch() {
    if (!pendingSwitch) return;
    const { target, lookup, decision, readOnly: ro } = pendingSwitch;
    setPendingSwitch(null);
    applyLookup(target, lookup, decision);
    if (ro !== undefined) setReadOnly(ro);
  }

  // Leaving the page (a nav link, back button, closing the tab) with unsaved
  // typing asks first.
  const blocker = useBlocker({
    shouldBlockFn: () => latest.current.dirty,
    enableBeforeUnload: () => latest.current.dirty,
    withResolver: true,
  });

  const validDowntimes = savableDowntimes(downtimes);
  const totalDowntime = validDowntimes.reduce((s, d) => s + Number(d.minutes), 0);

  // Live summary — recomputed from the same form state as the rest of the
  // form on every keystroke. null (not 0) means "no plan/available-time
  // entered yet", so the tiles below can show "—" instead of a misleading
  // 0%/100%.
  const liveSummary = useMemo(() => {
    const mPlan = Number(makingPlan) || 0;
    const mActual = Number(makingActual) || 0;
    const pPlan = Number(packingPlan) || 0;
    const pActual = Number(packingActual) || 0;
    const avail = Number(availableMin) || 0;
    return {
      mPlan,
      mActual,
      pPlan,
      pActual,
      avail,
      makingPct: makingPlan !== "" && mPlan > 0 ? (mActual / mPlan) * 100 : null,
      packingPct: packingPlan !== "" && pPlan > 0 ? (pActual / pPlan) * 100 : null,
      lossPct: availableMin !== "" && avail > 0 ? (totalDowntime / avail) * 100 : null,
    };
  }, [makingPlan, makingActual, packingPlan, packingActual, availableMin, totalDowntime]);

  const isConflict = slot.status === "existing" && !editingSaved;
  const isNew = slot.status === "empty";

  async function refreshDashboards() {
    await qc.invalidateQueries({ queryKey: ["entries"] });
    await qc.invalidateQueries({ queryKey: ["entry-downtimes"] });
    await qc.invalidateQueries({ queryKey: ["entry-area-owners"] });
    await qc.invalidateQueries({ queryKey: ["all-entries"] });
    // invalidateQueries alone only refetches queries that are mounted; the
    // Dashboard's are not while this page is open, so force the refetch now.
    await qc.refetchQueries({ queryKey: ["entries"], type: "all" });
    await qc.refetchQueries({ queryKey: ["entry-downtimes"], type: "all" });
    await qc.refetchQueries({ queryKey: ["entry-area-owners"], type: "all" });
    await qc.refetchQueries({ queryKey: ["all-entries"], type: "all" });
  }

  // `source` is the Save button pressed: a save at target bursts from it.
  async function handleSave(source?: HTMLElement | null) {
    if (saving) return;
    if (!lineId) return toast.error("Pick a production line");
    if (slot.status === "loading" || switching) {
      return toast.error("Still loading this entry — try again in a moment.");
    }
    if (slot.status === "error") {
      return toast.error(
        "This entry didn't load, so saving could overwrite it. Press Retry first.",
      );
    }
    if (isConflict) {
      return toast.error(
        `${describe({ lineId, date, shift })} already has a saved entry. Pick another day or shift for this copy.`,
      );
    }
    if (isNew && !canCreate) {
      return toast.error("Your role does not have permission to create a new entry.");
    }
    const check = validateValues(values, {
      production: canEditProduction,
      downtime: canEditDowntime,
      areaOwners: canEditAreaOwners,
    });
    if (check.count > 0) {
      setErrors(check);
      setErrorPulse((n) => n + 1);
      // Open any collapsed section that holds an error, so it can be seen.
      if (Object.keys(check.ownerScores).length > 0) setOpenAreaOwners(true);
      if (check.fields.reworkCooking || check.fields.reworkMaking || check.fields.reworkPacking) {
        setOpenRework(true);
      }
      return toast.error(
        `Fix ${check.count} ${check.count === 1 ? "field" : "fields"} before saving`,
      );
    }
    setErrors(null);
    setSaving(true);
    busy.current = true;
    try {
      // A restricted role saves the loaded values for every field group it
      // can't edit, never whatever is sitting in that (disabled) field.
      const orig = baseline;
      const pick = (allowed: boolean, cur: string, loaded: string) => (allowed ? cur : loaded);
      const effectiveDowntimes = savableDowntimes(canEditDowntime ? downtimes : orig.downtimes);
      const payload = {
        line_id: lineId,
        entry_date: date,
        shift,
        supervisor: supervisor || null,
        operator: operator || null,
        comments: pick(canEditNotes, comments, orig.comments) || null,
        making_plan: Number(pick(canEditProduction, makingPlan, orig.makingPlan)) || 0,
        making_actual: Number(pick(canEditProduction, makingActual, orig.makingActual)) || 0,
        packing_plan: Number(pick(canEditProduction, packingPlan, orig.packingPlan)) || 0,
        packing_actual: Number(pick(canEditProduction, packingActual, orig.packingActual)) || 0,
        available_min: Number(availableMin) || 0,
        downtime_min: effectiveDowntimes.reduce((s, d) => s + Number(d.minutes), 0),
        rework_cooking: Number(pick(canEditProduction, reworkCooking, orig.reworkCooking)) || 0,
        rework_making: Number(pick(canEditProduction, reworkMaking, orig.reworkMaking)) || 0,
        rework_packing: Number(pick(canEditProduction, reworkPacking, orig.reworkPacking)) || 0,
        custom_fields: Object.fromEntries(
          Object.entries(customValues).map(([k, v]) => [k, isNaN(Number(v)) ? v : Number(v)]),
        ),
      };

      let saved: { id: string; updated_at: string };
      if (slot.status === "empty") {
        // insert, not upsert: if someone created this day's entry after the
        // form loaded, fail instead of silently replacing theirs.
        const { data, error } = await supabase
          .from("daily_entries")
          .insert(payload)
          .select("id, updated_at")
          .single();
        if (error) {
          if (error.code === "23505") {
            throw new Error(
              "someone saved an entry for this day and shift while you were typing. Your typing is still on screen — copy what you need, then open the day again.",
            );
          }
          throw error;
        }
        saved = data;
      } else {
        // Only overwrite the version this form loaded.
        const loadedId = slot.status === "existing" ? slot.id : "";
        const loadedAt = slot.status === "existing" ? slot.updatedAt : "";
        const { data, error } = await supabase
          .from("daily_entries")
          .update(payload)
          .eq("id", loadedId)
          .eq("updated_at", loadedAt)
          .select("id, updated_at")
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          const { data: now } = await supabase
            .from("daily_entries")
            .select("updated_at")
            .eq("id", loadedId)
            .maybeSingle();
          if (!now) throw new Error("this entry was deleted by someone else.");
          if (now.updated_at !== loadedAt) {
            throw new Error(
              "someone else saved this entry after you opened it, so it was not overwritten. Your typing is still on screen — copy what you need, then reload the day.",
            );
          }
          throw new Error("your role can't change this entry.");
        }
        saved = data;
      }
      // From here on the main row is saved: a second Save must update it.
      setSlot({ status: "existing", id: saved.id, updatedAt: saved.updated_at });
      setEditingSaved(true);

      // Child rows are rewritten only when they changed and only by a role
      // allowed to write them — the database refuses the others, which used
      // to fail the whole save for maintenance and quality.
      const failures: string[] = [];
      if (canEditDowntime && !sameDowntimes(downtimes, orig.downtimes)) {
        try {
          await replaceDowntimeRows(
            saved.id,
            effectiveDowntimes.map((d) => ({
              entry_id: saved.id,
              reason_id: d.reason_id || null,
              reason_name: d.reason_name,
              area: d.area,
              minutes: Number(d.minutes),
            })),
          );
        } catch (err) {
          failures.push(`downtime list (${errMsg(err)})`);
        }
      }
      if (canEditAreaOwners && !sameOwners(areaOwnerSelections, orig.areaOwners)) {
        try {
          await replaceAreaOwnerRows(
            saved.id,
            Object.entries(areaOwnerSelections)
              .filter(([, sel]) => !!sel.ownerId || sel.score.trim() !== "")
              .map(([productionAreaId, sel]) => ({
                entry_id: saved.id,
                production_area_id: productionAreaId,
                owner_id: sel.ownerId || null,
                performance_score: sel.score.trim() === "" ? null : Number(sel.score),
              })),
          );
        } catch (err) {
          failures.push(`area owners (${errMsg(err)})`);
        }
      }

      void logAudit(isNew ? "entry.create" : "entry.edit", "entry", saved.id, {
        line_id: lineId,
        entry_date: date,
        shift,
      });
      void refreshDashboards();

      if (failures.length > 0) {
        // Baseline left as it was, so the form still shows unsaved changes
        // and Save retries only what failed.
        toast.error(
          `Entry saved, but not the ${failures.join(" or the ")}. Your changes are still on screen — press Save again.`,
        );
        return;
      }
      // The form stays open on the saved entry (it used to jump to the
      // Dashboard). Not reloaded: that would drop anything typed while the
      // save was in flight, and the new updated_at is already in `slot`.
      setBaseline(values);
      setSavedFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setSavedFlash(false), 1600);
      // Celebrate only what was saved, and only at or above the target.
      const savedMakingPct =
        payload.making_plan > 0 ? (payload.making_actual / payload.making_plan) * 100 : null;
      if (savedMakingPct !== null && savedMakingPct >= targets.makingPct) {
        gummy.burstFrom(source?.isConnected ? source : null);
        setCelebrateKey((k) => k + 1);
        setParty(true);
        if (partyTimer.current) clearTimeout(partyTimer.current);
        partyTimer.current = setTimeout(() => setParty(false), 2500);
      }
      toast.success(`Saved ${describe({ lineId, date, shift })}`, {
        action: { label: "Dashboard", onClick: () => navigate({ to: "/" }) },
      });
    } catch (err) {
      toast.error(`Not saved: ${errMsg(err)}`);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  function addDowntime() {
    setNewDowntimeIdx(downtimes.length);
    setDowntimes((d) => [...d, { reason_id: "", reason_name: "", area: "General", minutes: 0 }]);
  }

  async function handleDelete(target?: { id: string; label: string }) {
    const currentId = slot.status === "existing" ? slot.id : null;
    const targetId = target?.id ?? currentId;
    const targetLabel = target?.label ?? `${date} · ${shiftLabel(shift)}`;
    if (!targetId) return;
    if (!confirm(`Are you sure you want to permanently delete this entry (${targetLabel})?`))
      return;
    setDeleting(true);
    busy.current = true;
    try {
      // entry_downtimes and entry_area_owners both have ON DELETE CASCADE
      // on entry_id, so deleting daily_entries removes them automatically.
      const { error } = await supabase.from("daily_entries").delete().eq("id", targetId);
      if (error) throw error;

      toast.success("Entry deleted successfully.");
      void logAudit("entry.delete", "entry", targetId, { label: targetLabel });
      await refreshDashboards();

      // If the deleted entry is the one currently loaded in the form, clear it.
      if (targetId === currentId) {
        const blank = emptyValues();
        applyValues(blank);
        setBaseline(blank);
        setSlot({ status: "empty" });
        setEditingSaved(false);
        setReadOnly(false);
        setErrors(null);
      }
    } catch (err) {
      toast.error(`Delete failed: ${errMsg(err)}`);
    } finally {
      busy.current = false;
      setDeleting(false);
    }
  }

  // Entry History's View/Edit: the same guarded switch the line tabs and
  // date/shift pickers use.
  function handleViewOrEdit(
    row: { line_id: string; entry_date: string; shift: string },
    mode: "view" | "edit",
  ) {
    setShowHistory(false);
    void requestSwitch(
      { lineId: row.line_id, date: row.entry_date, shift: row.shift },
      { readOnly: mode === "view" },
    );
  }

  // Copies an entry into a NEW unsaved entry for today, same line and shift.
  // The copy stays on screen while the supervisor changes the day or shift
  // (decideSwitch "carry"); before, the first date change wiped it.
  async function handleDuplicate(row: EntryHistoryRow) {
    if (busy.current) return toast.info("Wait for the save to finish first.");
    if (latest.current.dirty && !confirm("Discard your unsaved changes and start a copy?")) return;
    try {
      const [dts, owners] = await Promise.all([
        supabase.from("entry_downtimes").select("*").eq("entry_id", row.id).order("created_at"),
        supabase.from("entry_area_owners").select("*").eq("entry_id", row.id),
      ]);
      if (dts.error) throw dts.error;
      if (owners.error) throw owners.error;
      const copied = valuesFromRows(row, dts.data ?? [], owners.data ?? []);
      const target: Slot = { lineId: row.line_id, date: iso(new Date()), shift: row.shift };
      const my = ++seq.current;
      const lookup = await fetchSlot(target);
      if (my !== seq.current) return;
      setLineId(target.lineId);
      setDate(target.date);
      setShift(target.shift);
      applyValues(copied);
      setBaseline(emptyValues());
      setReadOnly(false);
      setErrors(null);
      setShowHistory(false);
      setEditingSaved(false);
      if (lookup.kind === "existing") {
        setSlot({ status: "existing", id: lookup.id, updatedAt: lookup.updatedAt });
        toast.warning(
          `${describe(target)} already has a saved entry. Pick another day or shift for the copy, then save.`,
        );
      } else {
        setSlot({ status: "empty" });
        toast.success("Copied as a new entry. Check the day and shift, then save.");
      }
    } catch (err) {
      toast.error(`Duplicate failed: ${errMsg(err)}`);
    }
  }

  const activeLineName = lines.find((l) => l.id === lineId)?.name ?? "—";
  const context = `${activeLineName} · ${formatDay(date)} · ${shiftLabel(shift)}`;
  const saveDisabled =
    saving ||
    deleting ||
    readOnly ||
    switching ||
    slot.status === "loading" ||
    slot.status === "error" ||
    isConflict ||
    (isNew && !canCreate);
  const isLoading = slot.status === "loading" || switching;
  const statusText = isLoading
    ? "Loading…"
    : slot.status === "error"
      ? "Couldn't load this entry"
      : isConflict
        ? "Copy — this day already has an entry"
        : slot.status === "existing"
          ? `Editing saved entry · saved ${formatSavedAt(slot.updatedAt)}`
          : canCreate
            ? "New entry"
            : "No entry yet — your role can't create one";
  const statusTone = isLoading
    ? "bg-muted text-muted-foreground"
    : slot.status === "error"
      ? "bg-destructive/10 text-destructive-strong"
      : isConflict
        ? "bg-warning/15 text-warning-strong"
        : slot.status === "existing"
          ? "bg-primary/10 text-primary"
          : "bg-muted text-foreground";
  const StatusIcon = isLoading
    ? Loader2
    : slot.status === "error" || isConflict
      ? AlertTriangle
      : slot.status === "existing"
        ? Pencil
        : FilePlus2;
  const unsavedNote = dirty && !saving;
  const fieldErr = (k: keyof ValidationResult["fields"]) => errors?.fields[k];
  const shakeOf = (err: string | undefined) => (err ? errorPulse : 0);
  // Typing a new number takes the "Saved" off the button at once.
  const savePhase: SavePhase = saving ? "saving" : savedFlash && !dirty ? "saved" : "idle";
  // The jar reacts while typing: a negative or non-numeric Making actual.
  const makingActualInvalid = (() => {
    const t = makingActual.trim();
    if (t === "") return false;
    const n = Number(t);
    return !Number.isFinite(n) || n < 0;
  })();
  const jarPct = makingActualInvalid ? null : liveSummary.makingPct;
  const jarMood: JarMood | undefined = saving
    ? "saving"
    : makingActualInvalid
      ? "error"
      : party
        ? "party"
        : undefined;
  const canDeleteThis = slot.status === "existing" && editingSaved && canDelete;
  const canDuplicateThis =
    slot.status === "existing" && editingSaved && canViewHistory && canCreate;

  // Rework, as the Dashboard counts it: all three stages, against making.
  const reworkTotal =
    (Number(reworkCooking) || 0) + (Number(reworkMaking) || 0) + (Number(reworkPacking) || 0);
  const reworkPctOfMaking =
    liveSummary.mActual > 0 ? (reworkTotal / liveSummary.mActual) * 100 : null;
  const reworkParts = (
    [
      ["cooking", reworkCooking],
      ["making", reworkMaking],
      ["packing", reworkPacking],
    ] as const
  )
    .filter(([, v]) => (Number(v) || 0) > 0)
    .map(([name, v]) => `${name} ${fmtNum(Number(v))}`);

  // Planned / Unplanned comes from the reason's downtime type in Settings.
  const typeNameById = new Map(downtimeTypes.map((t) => [t.id, t.name]));
  const typeNameOfReason = (reasonId: string) => {
    const typeId = reasons.find((r) => r.id === reasonId)?.downtime_type_id;
    return (typeId && typeNameById.get(typeId)) || null;
  };
  const minutesByType = new Map<string, number>();
  let unclassifiedMin = 0;
  for (const d of validDowntimes) {
    const t = typeNameOfReason(d.reason_id);
    if (t) minutesByType.set(t, (minutesByType.get(t) ?? 0) + Number(d.minutes));
    else unclassifiedMin += Number(d.minutes);
  }
  // In Settings order (Planned before Unplanned), not in row order.
  const typeParts = [...new Set(downtimeTypes.map((t) => t.name))]
    .filter((t) => minutesByType.has(t))
    .map((t) => `${fmtNum(minutesByType.get(t) ?? 0)} ${t.toLowerCase()}`);
  if (typeParts.length > 0 && unclassifiedMin > 0) {
    typeParts.push(`${fmtNum(unclassifiedMin)} unclassified`);
  }
  const areaNames = [...new Set(productionAreas.map((a) => a.name))];

  const scoredAreas = productionAreas.filter(
    (a) => (areaOwnerSelections[a.id]?.score ?? "").trim() !== "",
  ).length;
  const assignedAreas = productionAreas.filter((a) => areaOwnerSelections[a.id]?.ownerId).length;
  const areaOwnersSummary = `Optional · ${scoredAreas} of ${productionAreas.length} areas scored${
    assignedAreas > 0 ? ` · ${assignedAreas} owner${assignedAreas === 1 ? "" : "s"} set` : ""
  }`;

  const outputRows = [
    {
      stage: "Making",
      target: targets.makingPct,
      plan: makingPlan,
      setPlan: setMakingPlan,
      actual: makingActual,
      setActual: setMakingActual,
      pct: liveSummary.makingPct,
      planKey: "makingPlan",
      actualKey: "makingActual",
    },
    {
      stage: "Packing",
      target: targets.packingPct,
      plan: packingPlan,
      setPlan: setPackingPlan,
      actual: packingActual,
      setActual: setPackingActual,
      pct: liveSummary.packingPct,
      planKey: "packingPlan",
      actualKey: "packingActual",
    },
  ] as const;

  const reworkFields = [
    ["Cooking", reworkCooking, setReworkCooking, "reworkCooking"],
    ["Making", reworkMaking, setReworkMaking, "reworkMaking"],
    ["Packing", reworkPacking, setReworkPacking, "reworkPacking"],
  ] as const;
  function renderReworkFields() {
    return reworkFields.map(([label, value, set, key]) => (
      <Field key={key} label={label} error={fieldErr(key)} shakeKey={shakeOf(fieldErr(key))}>
        <Input
          type="number"
          inputMode="decimal"
          className="h-11"
          value={value}
          onChange={(e) => set(e.target.value)}
          disabled={!canEditProduction}
        />
      </Field>
    ));
  }

  // "Duplicate to another day…" in the summary opens Entry History, where
  // each row's Duplicate button runs handleDuplicate.
  function openHistoryPanel() {
    setShowHistory(true);
    setTimeout(() => historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function renderAreaOwners() {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {productionAreas.map((area) => {
          const sel = areaOwnerSelections[area.id] ?? { ownerId: "", score: "" };
          const ownerId = `owner-${area.id}`;
          return (
            <div key={area.id} className="rounded-lg border border-border p-3">
              <p className="mb-2 text-sm font-semibold">{area.name}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="Owner" htmlFor={ownerId}>
                  <Select
                    value={sel.ownerId}
                    onValueChange={(v) =>
                      setAreaOwnerSelections((p) => ({
                        ...p,
                        [area.id]: { ownerId: v, score: p[area.id]?.score ?? "" },
                      }))
                    }
                    disabled={!canEditAreaOwners}
                  >
                    <SelectTrigger id={ownerId} className="h-11">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      {areaOwners.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label="Performance Score %"
                  error={errors?.ownerScores[area.id]}
                  shakeKey={shakeOf(errors?.ownerScores[area.id])}
                >
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder="0–100"
                    className="h-11"
                    value={sel.score}
                    onChange={(e) =>
                      setAreaOwnerSelections((p) => ({
                        ...p,
                        [area.id]: {
                          ownerId: p[area.id]?.ownerId ?? "",
                          score: e.target.value,
                        },
                      }))
                    }
                    disabled={!canEditAreaOwners}
                  />
                </Field>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <AppShell>
      {/* Phone header: title + History, then one context button that says
          which entry is open and folds away the line / day / shift pickers.
          Save lives in the sticky bar at the bottom. */}
      <div className="mb-3 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold tracking-tight">Daily entry</h1>
          {canViewHistory && (
            <Button
              variant="outline"
              className="h-11 shrink-0 px-3"
              aria-expanded={showHistory}
              onClick={() => setShowHistory((s) => !s)}
            >
              <History className="h-4 w-4" /> History
            </Button>
          )}
        </div>
        <div className="mt-2 rounded-xl border border-border bg-card">
          <button
            type="button"
            aria-expanded={openWhich}
            aria-controls="entry-which-m"
            onClick={() => setOpenWhich((o) => !o)}
            className="flex min-h-[52px] w-full items-center gap-2 rounded-xl px-3 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-base font-semibold">
              <span className="sr-only">Change line, day or shift: </span>
              {context}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                openWhich && "rotate-180",
              )}
            />
          </button>
          <p
            className={cn(
              "-mt-1 px-3 pb-2 text-xs font-medium",
              slot.status === "error" || isConflict ? "text-destructive-strong" : "text-primary",
            )}
            aria-live="polite"
          >
            {statusText}
            {unsavedNote && (
              <>
                {" · "}
                <UnsavedDot />
                unsaved changes
              </>
            )}
          </p>
          {openWhich && (
            <div id="entry-which-m" className="space-y-3 border-t border-border p-3">
              <Tabs value={lineId} onValueChange={(v) => void requestSwitch({ lineId: v })}>
                <TabsList
                  aria-label="Line"
                  className="flex h-auto w-full items-center justify-start gap-1 overflow-x-auto"
                >
                  {lines.map((l) => (
                    <TabsTrigger
                      key={l.id}
                      value={l.id}
                      className="min-h-11 shrink-0 whitespace-nowrap"
                    >
                      <span
                        className="mr-2 inline-block h-2 w-2 rounded-full"
                        style={{ background: l.color }}
                      />
                      {l.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Day">
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => e.target.value && void requestSwitch({ date: e.target.value })}
                    className="h-11"
                  />
                </Field>
                <Field label="Shift" htmlFor="entry-shift-m">
                  <Select value={shift} onValueChange={(v) => void requestSwitch({ shift: v })}>
                    <SelectTrigger id="entry-shift-m" className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">Shift A</SelectItem>
                      <SelectItem value="B">Shift B</SelectItem>
                      <SelectItem value="C">Shift C</SelectItem>
                      <SelectItem value="DAY">Full Day</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* md and up: title + History, then the "Which entry" card. */}
      <div className="mb-4 hidden items-end justify-between gap-4 md:flex">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Daily entry</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Pick the line, day and shift. If an entry exists you edit it; you are asked before any
            typing is thrown away.
          </p>
        </div>
        {canViewHistory && (
          <Button
            variant="outline"
            className="h-11 shrink-0 px-4"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((s) => !s)}
          >
            <History className="h-4 w-4" />
            <span>
              <span className="sr-only">Entry </span>History
            </span>
          </Button>
        )}
      </div>

      <section
        aria-label="Which entry"
        className="mb-4 hidden flex-wrap items-end gap-4 rounded-xl border border-border bg-card px-5 py-4 md:flex"
      >
        <div className="w-56">
          <Label htmlFor="entry-line-d" className="text-sm font-semibold">
            Line
          </Label>
          <Select value={lineId} onValueChange={(v) => void requestSwitch({ lineId: v })}>
            <SelectTrigger id="entry-line-d" className="mt-1.5 h-11 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {lines.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: l.color }}
                    />
                    {l.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-52">
          <Label htmlFor="entry-date-d" className="text-sm font-semibold">
            Day
          </Label>
          <Input
            id="entry-date-d"
            type="date"
            className="mt-1.5 h-11"
            value={date}
            onChange={(e) => e.target.value && void requestSwitch({ date: e.target.value })}
          />
        </div>
        <div>
          <span id="entry-shift-d-label" className="text-sm font-semibold leading-none">
            Shift
          </span>
          <div
            role="group"
            aria-labelledby="entry-shift-d-label"
            className="mt-1.5 flex gap-0.5 rounded-lg bg-muted p-[3px]"
          >
            {SHIFTS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={shift === value}
                aria-label={value === "DAY" ? undefined : `Shift ${value}`}
                onClick={() => void requestSwitch({ shift: value })}
                className={cn(
                  "h-[38px] rounded-md px-4 text-sm transition-colors",
                  shift === value
                    ? "bg-card font-semibold text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className={cn("ml-auto flex items-center gap-2.5 rounded-lg px-3.5 py-2", statusTone)}>
          <StatusIcon
            aria-hidden="true"
            className={cn("h-[18px] w-[18px] shrink-0", isLoading && "animate-spin")}
          />
          <p aria-live="polite" className="text-sm">
            <span className="block font-semibold">{statusText}</span>
            <span className="block text-xs opacity-90">
              {context}
              {unsavedNote && (
                <span className="font-semibold">
                  {" · "}
                  <UnsavedDot />
                  unsaved changes
                </span>
              )}
            </span>
          </p>
        </div>
      </section>

      {readOnly && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/50 bg-warning/10 px-4 py-2 text-sm">
          <span>Viewing this entry in read-only mode.</span>
          <Button
            size="sm"
            variant="outline"
            className="max-md:h-11"
            onClick={() => setReadOnly(false)}
          >
            Edit this entry
          </Button>
        </div>
      )}

      {slot.status === "error" && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
        >
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive-strong" />
            <span>
              <span className="font-semibold">This entry didn&apos;t load</span> ({slot.message}).
              Saving is off so a blank form can&apos;t overwrite it.
            </span>
          </span>
          <Button variant="outline" className="max-md:h-11" onClick={() => void reloadSlot()}>
            Retry
          </Button>
        </div>
      )}

      {isConflict && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/50 bg-warning/10 px-4 py-3 text-sm"
        >
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" />
            <span>
              <span className="font-semibold">
                {date} · {shiftLabel(shift)} already has a saved entry.
              </span>{" "}
              Change the day or shift for this copy, or open the saved one instead.
            </span>
          </span>
          <Button
            variant="outline"
            className="max-md:h-11"
            onClick={() => {
              const blank = emptyValues();
              applyValues(blank);
              setBaseline(blank);
              void reloadSlot();
            }}
          >
            Discard copy, open saved entry
          </Button>
        </div>
      )}

      {showHistory && canViewHistory && (
        <div ref={historyRef} className="mb-6 scroll-mt-24">
          <EntryHistoryPanel
            lines={lines}
            onView={(row) => handleViewOrEdit(row, "view")}
            onEdit={(row) => handleViewOrEdit(row, "edit")}
            onDuplicate={canCreate ? handleDuplicate : undefined}
            onDelete={
              canDelete
                ? (row) =>
                    handleDelete({
                      id: row.id,
                      label: `${row.entry_date} · Shift ${row.shift} · ${row.production_lines?.name ?? ""}`,
                    })
                : undefined
            }
          />
        </div>
      )}

      <div className="gap-6 md:grid lg:grid-cols-3 lg:items-start">
        <div className="flex min-w-0 flex-col gap-3 md:gap-4 lg:col-span-2">
          {/* Phone: the Making jar above the form, so it fills as you type.
              md and up it lives in the summary beside / below the form. */}
          <section
            aria-labelledby="entry-jar-title-m"
            className="ds-rise rounded-xl border border-border bg-card p-3 md:hidden"
          >
            <h2 id="entry-jar-title-m" className="sr-only">
              This entry
            </h2>
            <MakingHero
              compact
              jarKey={`${lineId}|${date}|${shift}`}
              pct={jarPct}
              target={targets.makingPct}
              mood={jarMood}
              lineName={activeLineName}
              celebrateKey={celebrateKey}
              actual={liveSummary.mActual}
              plan={liveSummary.mPlan}
              actualInvalid={makingActualInvalid}
            />
          </section>
          {/* A disabled fieldset, not pointer-events: none — read-only must
              stop the keyboard too. The collapsible rows below carry their
              own fieldset so they can still be opened and read. */}
          <fieldset
            disabled={readOnly}
            className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0 md:gap-4"
            style={readOnly ? { opacity: 0.75 } : undefined}
          >
            <EntrySection
              title="1 · Output"
              unit="kg"
              className="ds-rise"
              style={{ animationDelay: "80ms" }}
            >
              {/* Phone: each stage with its live % and Plan / Actual side by side. */}
              <div className="flex flex-col gap-3 md:hidden">
                {outputRows.map((o) => (
                  <div key={o.stage}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold">{o.stage}</span>
                      <span
                        className={cn(
                          "text-sm font-bold tabular-nums",
                          adherenceColor(o.pct, o.target),
                        )}
                      >
                        <Pct value={o.pct} /> of plan
                      </span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      <Field
                        label="Plan"
                        error={fieldErr(o.planKey)}
                        shakeKey={shakeOf(fieldErr(o.planKey))}
                      >
                        <Input
                          type="number"
                          inputMode="decimal"
                          aria-label={`${o.stage} plan, kg`}
                          className="h-11"
                          value={o.plan}
                          onChange={(e) => o.setPlan(e.target.value)}
                          disabled={!canEditProduction}
                        />
                      </Field>
                      <Field
                        label="Actual"
                        error={fieldErr(o.actualKey)}
                        shakeKey={shakeOf(fieldErr(o.actualKey))}
                      >
                        <Input
                          type="number"
                          inputMode="decimal"
                          aria-label={`${o.stage} actual, kg`}
                          className="h-11"
                          value={o.actual}
                          onChange={(e) => o.setActual(e.target.value)}
                          disabled={!canEditProduction}
                        />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
              {/* md and up: Making / Packing rows × Plan / Actual / Of plan. */}
              <div className="hidden grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)_7rem] items-start gap-x-4 gap-y-2.5 md:grid">
                <span />
                <span className="text-sm font-semibold text-muted-foreground">Plan</span>
                <span className="text-sm font-semibold text-muted-foreground">Actual</span>
                <span className="text-sm font-semibold text-muted-foreground">Of plan</span>
                {outputRows.map((o) => (
                  <Fragment key={o.stage}>
                    <span className="flex h-11 items-center text-base font-semibold">
                      {o.stage}
                    </span>
                    <GridInput
                      label={`${o.stage} plan, kg`}
                      value={o.plan}
                      onChange={o.setPlan}
                      disabled={!canEditProduction}
                      error={fieldErr(o.planKey)}
                      shakeKey={shakeOf(fieldErr(o.planKey))}
                    />
                    <GridInput
                      label={`${o.stage} actual, kg`}
                      value={o.actual}
                      onChange={o.setActual}
                      disabled={!canEditProduction}
                      error={fieldErr(o.actualKey)}
                      shakeKey={shakeOf(fieldErr(o.actualKey))}
                    />
                    <span
                      className={cn(
                        "flex h-11 items-center text-xl font-bold tabular-nums",
                        adherenceColor(o.pct, o.target),
                      )}
                    >
                      <Pct value={o.pct} />
                    </span>
                  </Fragment>
                ))}
              </div>

              {customFields.length > 0 && (
                <div className="border-t border-border pt-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Custom fields for this line
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
                    {customFields.map((f) => (
                      <Field key={f.id} label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`}>
                        <Input
                          type="number"
                          inputMode="decimal"
                          className="h-11"
                          value={customValues[f.field_key] ?? ""}
                          onChange={(e) =>
                            setCustomValues((p) => ({ ...p, [f.field_key]: e.target.value }))
                          }
                        />
                      </Field>
                    ))}
                  </div>
                </div>
              )}
            </EntrySection>

            <EntrySection
              title="2 · Time and downtime"
              className="ds-rise"
              style={{ animationDelay: "160ms" }}
              aside={
                <span className="text-sm font-semibold tabular-nums md:hidden">
                  {fmtNum(totalDowntime)} min
                </span>
              }
            >
              <div className="flex flex-col gap-1.5 md:flex-row md:items-end md:gap-4">
                <div className="md:w-56">
                  <Field
                    label="Available time (min)"
                    error={fieldErr("availableMin")}
                    shakeKey={shakeOf(fieldErr("availableMin"))}
                  >
                    <Input
                      type="number"
                      inputMode="numeric"
                      className="h-11"
                      value={availableMin}
                      onChange={(e) => setAvailableMin(e.target.value)}
                    />
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground md:mb-3 md:text-sm">
                  Full day = 1,440 · one shift = 480
                </p>
              </div>

              {downtimes.length > 0 && (
                <div
                  className={cn(
                    "hidden gap-3 text-sm font-semibold text-muted-foreground md:grid",
                    DOWNTIME_GRID_COLS,
                  )}
                  aria-hidden="true"
                >
                  <span>Reason</span>
                  <span>Area</span>
                  <span>Minutes</span>
                  <span />
                </div>
              )}
              {downtimes.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  No downtime logged. Press Add downtime to record a stoppage.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {downtimes.map((d, i) => (
                    <DowntimeRowEditor
                      key={i}
                      index={i}
                      row={d}
                      reasons={reasons}
                      areaNames={areaNames}
                      typeName={d.reason_id ? typeNameOfReason(d.reason_id) : null}
                      error={errors?.downtimes[i]}
                      shakeKey={shakeOf(errors?.downtimes[i])}
                      className={i === newDowntimeIdx ? "ds-slide-in" : undefined}
                      disabled={!canEditDowntime}
                      onReasonChange={(v) => {
                        const r = reasons.find((x) => x.id === v);
                        setDowntimes((arr) =>
                          arr.map((row, idx) =>
                            idx === i
                              ? {
                                  ...row,
                                  reason_id: v,
                                  reason_name: r?.name ?? row.reason_name,
                                  area: r?.area ?? row.area,
                                }
                              : row,
                          ),
                        );
                      }}
                      onAreaChange={(v) =>
                        setDowntimes((arr) =>
                          arr.map((row, idx) => (idx === i ? { ...row, area: v } : row)),
                        )
                      }
                      onMinutesChange={(m) =>
                        setDowntimes((arr) =>
                          arr.map((row, idx) => (idx === i ? { ...row, minutes: m } : row)),
                        )
                      }
                      onRemove={() => setDowntimes((arr) => arr.filter((_, idx) => idx !== i))}
                    />
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-2 border-t border-border pt-3 md:flex-row-reverse md:items-center md:justify-between">
                <p className="text-sm">
                  <span className="font-bold tabular-nums">{fmtNum(totalDowntime)} min</span>
                  {liveSummary.lossPct !== null &&
                    ` · ${liveSummary.lossPct.toFixed(1)}% of available`}
                  {typeParts.length > 0 && ` · ${typeParts.join(", ")}`}
                </p>
                <Button
                  variant="outline"
                  className="h-12 w-full border-dashed font-semibold text-primary md:h-11 md:w-auto"
                  onClick={addDowntime}
                  disabled={!canEditDowntime}
                >
                  <Plus className="h-4 w-4" /> Add downtime
                </Button>
              </div>
            </EntrySection>

            {/* md and up: Rework as its own section. */}
            <EntrySection
              title="3 · Rework"
              unit="kg"
              className="ds-rise hidden md:flex"
              style={{ animationDelay: "240ms" }}
            >
              <div className="grid grid-cols-4 items-start gap-4">
                {renderReworkFields()}
                <p className="flex h-11 items-center self-end text-sm">
                  <span>
                    <span className="font-bold tabular-nums">{fmtNum(reworkTotal)} kg</span>
                    {reworkPctOfMaking !== null && ` · ${reworkPctOfMaking.toFixed(1)}% of making`}
                  </span>
                </p>
              </div>
            </EntrySection>
          </fieldset>

          {/* Phone: Rework folds away; the summary keeps the numbers in view. */}
          <CollapsibleRow
            className="ds-rise md:hidden"
            style={{ animationDelay: "240ms" }}
            title="3 · Rework (kg)"
            summary={`${fmtNum(reworkTotal)} kg${reworkParts.length > 0 ? ` · ${reworkParts.join(" · ")}` : ""}`}
            open={openRework}
            onToggle={() => setOpenRework((o) => !o)}
            contentDisabled={readOnly}
          >
            <div className="grid grid-cols-3 gap-2">{renderReworkFields()}</div>
          </CollapsibleRow>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
            {productionAreas.length > 0 && (
              <CollapsibleRow
                className={cn("ds-rise", (openAreaOwners || openComments) && "md:col-span-2")}
                style={{ animationDelay: "320ms" }}
                title="4 · Area owners"
                summary={areaOwnersSummary}
                open={openAreaOwners}
                onToggle={() => setOpenAreaOwners((o) => !o)}
                contentDisabled={readOnly}
              >
                {renderAreaOwners()}
              </CollapsibleRow>
            )}
            <CollapsibleRow
              className={cn("ds-rise", (openAreaOwners || openComments) && "md:col-span-2")}
              style={{ animationDelay: "400ms" }}
              title="5 · Notes"
              summary={comments.trim() || "Empty"}
              open={openComments}
              onToggle={() => setOpenComments((o) => !o)}
              contentDisabled={readOnly}
            >
              <Textarea
                aria-label="Notes"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={3}
                disabled={!canEditNotes}
              />
            </CollapsibleRow>
          </div>
        </div>

        {/* md and up: the live summary and the one Save button. Beside the
            form (sticky) from lg; below it, stuck to the bottom, at md. */}
        <TiltCard
          aria-labelledby="entry-summary-title"
          className="ds-rise z-10 hidden flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-elevated md:sticky md:bottom-4 md:mt-4 md:flex lg:bottom-auto lg:top-24 lg:mt-0"
          style={{ animationDelay: "140ms" }}
        >
          <div>
            <h2 id="entry-summary-title" className="text-lg font-semibold">
              This entry
            </h2>
            <p className="text-sm text-muted-foreground">{context}</p>
          </div>
          {/* md: jar and the other numbers side by side, so the panel stuck
              to the bottom stays short; lg: stacked in the side column. */}
          <div className="flex items-center gap-6 lg:flex-col lg:items-stretch lg:gap-4">
            <MakingHero
              jarKey={`${lineId}|${date}|${shift}`}
              pct={jarPct}
              target={targets.makingPct}
              mood={jarMood}
              lineName={activeLineName}
              celebrateKey={celebrateKey}
              actual={liveSummary.mActual}
              plan={liveSummary.mPlan}
              actualInvalid={makingActualInvalid}
            />
            <dl className="grid min-w-0 flex-1 grid-cols-3 gap-4 lg:grid-cols-1 lg:gap-3">
              {(
                [
                  [
                    "Packing",
                    `target ${targets.packingPct}%`,
                    liveSummary.packingPct,
                    adherenceColor(liveSummary.packingPct, targets.packingPct),
                  ],
                  [
                    "Time lost",
                    `${fmtNum(totalDowntime)} of ${fmtNum(liveSummary.avail)} min`,
                    liveSummary.lossPct,
                    lossColor(liveSummary.lossPct, targets.lossPct),
                  ],
                  [
                    "Rework",
                    `${fmtNum(reworkTotal)} kg · % of making`,
                    reworkPctOfMaking,
                    "text-foreground",
                  ],
                ] as const
              ).map(([label, sub, value, color]) => (
                <div
                  key={label}
                  className="flex flex-col gap-1 lg:flex-row lg:items-baseline lg:justify-between lg:border-b lg:border-border lg:pb-3"
                >
                  <dt className="text-sm">
                    {label}
                    <span className="block text-xs text-muted-foreground">{sub}</span>
                  </dt>
                  <dd className={cn("text-xl font-bold tabular-nums lg:text-2xl", color)}>
                    <Pct value={value} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          {unsavedNote && (
            <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2.5 text-sm text-warning-strong">
              <UnsavedDot className="mt-1.5 shrink-0" />
              <span>
                {changed.length} unsaved {changed.length === 1 ? "change" : "changes"}
                {changed.length > 0 && ` · ${changed.join(", ")}`}
              </span>
            </p>
          )}
          <div className="flex flex-wrap gap-2 lg:flex-col">
            <SaveButton
              phase={savePhase}
              label="Save Entry"
              wrapperClassName="md:w-48 lg:w-full"
              onClick={(e) => void handleSave(e.currentTarget)}
              disabled={saveDisabled}
            />
            {canDuplicateThis && (
              <Button variant="outline" className="h-11 lg:w-full" onClick={openHistoryPanel}>
                Duplicate to another day…
              </Button>
            )}
            {canDeleteThis && (
              <Button
                variant="ghost"
                className="h-11 font-semibold text-destructive-strong hover:text-destructive-strong lg:w-full"
                onClick={() => handleDelete()}
                disabled={deleting || saving || readOnly}
              >
                <Trash2 className="h-4 w-4" /> {deleting ? "Deleting…" : "Delete this entry…"}
              </Button>
            )}
          </div>
        </TiltCard>
      </div>

      {/* Phone: Delete sits at the end of the form, away from Save. */}
      {canDeleteThis && (
        <Button
          variant="ghost"
          className="mt-4 h-11 w-full text-destructive hover:text-destructive md:hidden"
          onClick={() => handleDelete()}
          disabled={deleting || saving || readOnly}
        >
          <Trash2 className="mr-2 h-4 w-4" /> {deleting ? "Deleting…" : "Delete this entry…"}
        </Button>
      )}

      {/* Phone sticky bar: live Making / Packing / Lost plus the one Save
          button. bottom-[72px] clears the fixed bottom nav (AppShell.tsx,
          md:hidden). */}
      <div className="sticky bottom-[72px] z-10 mt-4 rounded-xl border border-border bg-card/95 px-3 py-2 shadow-elevated backdrop-blur md:hidden">
        <div className="flex items-center gap-3">
          <dl className="grid min-w-0 flex-1 grid-cols-3 gap-2">
            {(
              [
                [
                  "Making",
                  liveSummary.makingPct,
                  adherenceColor(liveSummary.makingPct, targets.makingPct),
                ],
                [
                  "Packing",
                  liveSummary.packingPct,
                  adherenceColor(liveSummary.packingPct, targets.packingPct),
                ],
                ["Lost", liveSummary.lossPct, lossColor(liveSummary.lossPct, targets.lossPct)],
              ] as const
            ).map(([label, pct, color]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className={`text-base font-bold tabular-nums ${color}`}>
                  <Pct value={pct} />
                </dd>
              </div>
            ))}
          </dl>
          <SaveButton
            phase={savePhase}
            label="Save"
            wrapperClassName="w-[6.5rem] shrink-0"
            onClick={(e) => void handleSave(e.currentTarget)}
            disabled={saveDisabled}
          />
        </div>
      </div>

      {gummy.layer}

      <AlertDialog
        open={pendingSwitch !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSwitch(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingSwitch?.decision === "confirm-load"
                ? `${pendingSwitch ? describe(pendingSwitch.target) : ""} has a saved entry. Opening it replaces what you typed here, which is not saved.`
                : "You edited this saved entry and haven't saved. Switching discards those changes."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPendingSwitch}>Discard and switch</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.status === "blocked") blocker.reset();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              This entry has changes that are not saved. They will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (blocker.status === "blocked") blocker.proceed();
              }}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

// Label + control + optional error. The label is tied to the control: an
// Input/Textarea child gets a generated id; a Select passes `htmlFor` and puts
// the same id on its SelectTrigger.
function Field({
  label,
  children,
  htmlFor,
  error,
  shakeKey = 0,
}: {
  label: string;
  children: React.ReactNode;
  htmlFor?: string;
  error?: string;
  /** Changes each time Save finds this field wrong: it shakes once. */
  shakeKey?: number;
}) {
  const autoId = useId();
  const errId = `${autoId}-err`;
  let id = htmlFor;
  let child = children;
  if (!htmlFor && isValidElement<{ id?: string }>(children)) {
    id = children.props.id ?? autoId;
    child = cloneElement(children as React.ReactElement<Record<string, unknown>>, {
      id,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? errId : undefined,
    });
  }
  return (
    <div>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div key={shakeKey} className={cn("mt-1", shakeKey > 0 && "ds-shake")}>
        {child}
      </div>
      {error && (
        <p
          id={errId}
          role="alert"
          className="ds-slide-in mt-1 text-xs font-medium text-destructive-strong"
        >
          {error}
        </p>
      )}
    </div>
  );
}

// One cell of the desktop Output grid: the column heading is the visual
// label, so the input names itself ("Making plan, kg").
function GridInput({
  label,
  value,
  onChange,
  disabled,
  error,
  shakeKey = 0,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  error?: string;
  shakeKey?: number;
}) {
  const errId = useId();
  return (
    <div>
      <Input
        key={shakeKey}
        type="number"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        className={cn("h-11 text-base tabular-nums md:text-base", shakeKey > 0 && "ds-shake")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      {error && (
        <p
          id={errId}
          role="alert"
          className="ds-slide-in mt-1 text-xs font-medium text-destructive-strong"
        >
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Motion pieces (see MotionSystem: odometer = a number changed, jar = progress
// to the Making target, pulse = waiting on you, burst = saved at target).
// ---------------------------------------------------------------------------

/** A % that rolls when it changes; "—" (no %) while there is no number. */
function Pct({ value, className }: { value: number | null; className?: string }) {
  return (
    <Odometer
      value={value}
      decimals={1}
      suffix={value === null ? undefined : "%"}
      className={className}
    />
  );
}

/** Pulsing amber dot: this entry has changes that are not saved yet. */
function UnsavedDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "ds-pulse-warn mr-1.5 inline-block h-2 w-2 rounded-full bg-warning align-middle",
        className,
      )}
    />
  );
}

/** The summary card tilts toward the mouse. Its own component, so a mouse
 *  move re-renders only the card shell, not the whole form. */
function TiltCard({ className, style, children, ...rest }: React.HTMLAttributes<HTMLElement>) {
  const tilt = useTilt(6);
  return (
    <aside {...rest} {...tilt.handlers} className={className} style={{ ...style, ...tilt.style }}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={tilt.glareStyle}
      />
      {children}
    </aside>
  );
}

/** Making as a jar of jelly beside the big number, with where it stands
 *  against the Making target. `compact` is the phone version. */
function MakingHero({
  compact = false,
  jarKey,
  pct,
  target,
  mood,
  lineName,
  celebrateKey,
  actual,
  plan,
  actualInvalid,
}: {
  compact?: boolean;
  jarKey: string;
  pct: number | null;
  target: number;
  mood: JarMood | undefined;
  lineName: string;
  celebrateKey: number;
  actual: number;
  plan: number;
  actualInvalid: boolean;
}) {
  const detail = actualInvalid
    ? "Making actual isn't a valid number"
    : plan > 0
      ? `${fmtNum(actual)} of ${fmtNum(plan)} kg`
      : "Enter the Making plan to see the %";
  const gap = pct === null ? null : target - pct;
  const band =
    pct === null
      ? { text: "Waiting for a number", tone: "bg-muted text-muted-foreground" }
      : gap !== null && gap <= 0
        ? { text: "At target", tone: "bg-success/10 text-success-strong" }
        : {
            text: `${(gap ?? 0).toFixed(1)} pts to the ${target}% target`,
            tone:
              (gap ?? 0) <= 20
                ? "bg-warning/15 text-warning-strong"
                : "bg-destructive/10 text-destructive-strong",
          };
  return (
    <div className={cn("flex items-center", compact ? "gap-3" : "gap-4 lg:gap-2")}>
      <JellyJar
        key={jarKey}
        pct={pct}
        target={target}
        mood={mood}
        labelText={lineName}
        celebrateKey={celebrateKey}
        size={compact ? 120 : 184}
        className={compact ? undefined : "h-[112px] w-[112px] lg:h-[184px] lg:w-[184px]"}
      />
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <span className="text-sm font-semibold text-muted-foreground">Making · of plan</span>
        <span
          className={cn(
            "font-extrabold",
            compact ? "text-4xl" : "text-4xl lg:text-[2.5rem]",
            adherenceColor(pct, target),
          )}
        >
          <Pct value={pct} />
        </span>
        <span className="text-sm tabular-nums text-foreground">{detail}</span>
        <span
          className={cn(
            "rounded-lg px-2.5 py-1 text-xs font-semibold leading-snug transition-colors",
            band.tone,
          )}
        >
          {band.text}
        </span>
      </div>
    </div>
  );
}

type SavePhase = "idle" | "saving" | "saved";

/** Save shrinks to a spinning circle while saving, then draws a check and
 *  says "Saved" for a moment. Its accessible name follows the phase. */
function SaveButton({
  phase,
  label,
  wrapperClassName,
  onClick,
  disabled,
}: {
  phase: SavePhase;
  label: string;
  wrapperClassName?: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled: boolean;
}) {
  // Only pop the label back in after a save, not on first render.
  const cycled = useRef(false);
  if (phase !== "idle") cycled.current = true;
  return (
    <div className={cn("flex h-12 justify-center", wrapperClassName)}>
      <Button
        className={cn(
          "h-12 overflow-hidden text-base",
          phase === "saving" ? "w-12 rounded-full px-0 disabled:opacity-100" : "w-full px-4",
          phase === "saved" && "bg-success-strong hover:bg-success-strong",
        )}
        style={{
          transition:
            "width 460ms var(--ease-out-soft), border-radius 320ms ease, background-color 260ms ease, box-shadow 200ms ease, transform 150ms var(--ease-spring)",
        }}
        aria-label={phase === "saving" ? "Saving" : undefined}
        onClick={onClick}
        disabled={disabled}
      >
        {phase === "saving" ? (
          <svg
            viewBox="0 0 26 26"
            aria-hidden="true"
            className="animate-spin"
            style={{ width: 24, height: 24 }}
          >
            <circle
              cx="13"
              cy="13"
              r="10"
              fill="none"
              strokeWidth="3"
              style={{ stroke: "currentColor", opacity: 0.3 }}
            />
            <circle
              cx="13"
              cy="13"
              r="10"
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="20 43"
              style={{ stroke: "currentColor" }}
            />
          </svg>
        ) : phase === "saved" ? (
          <span key="saved" className="ds-pop-in flex items-center gap-2">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ width: 20, height: 20, stroke: "currentColor" }}
            >
              <path
                d="M5 12.5l4.5 4.5L19 7.5"
                strokeDasharray="26"
                style={{ animation: "ds-check 380ms var(--ease-out-soft) 80ms both" }}
              />
            </svg>
            Saved
          </span>
        ) : (
          <span key="idle" className={cn("flex items-center gap-2", cycled.current && "ds-pop-in")}>
            <Save className="h-4 w-4" aria-hidden="true" />
            {label}
          </span>
        )}
      </Button>
    </div>
  );
}
