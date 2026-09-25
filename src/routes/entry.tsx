import { createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { EntryHistoryPanel } from "@/components/EntryHistoryPanel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  ChevronRight,
  Recycle,
  Users,
  MessageSquare,
  AlertTriangle,
} from "lucide-react";
import { PieChart, Pie, Cell, Tooltip as RTooltip, ResponsiveContainer, Legend } from "recharts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  linesQuery,
  reasonsQuery,
  fieldsQuery,
  productionAreasQuery,
  areaOwnersQuery,
  type EntryHistoryRow,
} from "@/lib/queries";
import { iso } from "@/lib/date-utils";
import { requireSession } from "@/lib/require-session";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import {
  type DtRow,
  type EntryFormValues,
  type SwitchDecision,
  type ValidationResult,
  decideSwitch,
  emptyValues,
  formatSavedAt,
  sameDowntimes,
  sameOwners,
  sameValues,
  savableDowntimes,
  shiftLabel,
  validateValues,
  valuesFromRows,
} from "@/lib/entry-form";

export const Route = createFileRoute("/entry")({
  head: () => ({ meta: [{ title: "Daily Entry · Production Scorecard" }] }),
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
// is better — thresholds mirror the ones DashboardSummary already uses on
// index.tsx (lossPct < 10/25) rather than reusing the adherence thresholds,
// which would mislabel a low-loss day as "red".
function adherenceColor(pct: number | null) {
  if (pct === null) return "text-muted-foreground";
  return pct >= 90 ? "text-success-strong" : pct >= 70 ? "text-warning-strong" : "text-destructive-strong";
}
function adherenceBarColor(pct: number | null) {
  if (pct === null) return "bg-muted-foreground/40";
  return pct >= 90 ? "bg-success" : pct >= 70 ? "bg-warning" : "bg-destructive";
}
function lossColor(pct: number | null) {
  if (pct === null) return "text-muted-foreground";
  return pct < 10 ? "text-success-strong" : pct < 25 ? "text-warning-strong" : "text-destructive-strong";
}
function lossBarColor(pct: number | null) {
  if (pct === null) return "bg-muted-foreground/40";
  return pct < 10 ? "bg-success" : pct < 25 ? "bg-warning" : "bg-destructive";
}

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

  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const [date, setDate] = useState(iso(new Date()));
  // 212 of the 234 saved entries are "Full day". Opening on shift A sent
  // supervisors to an empty A slot next to that day's real entry.
  const [shift, setShift] = useState("DAY");
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

  const { data: customFields = [] } = useQuery(fieldsQuery(lineId));

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

  // Async handlers read these instead of the render they started in.
  const latest = useRef({ dirty, editingSaved, lineId, date, shift });
  latest.current = { dirty, editingSaved, lineId, date, shift };
  // Only the newest load may write to the form.
  const seq = useRef(0);
  // True while a save or delete is in flight. Switching slots then would let
  // the finishing save write its entry id into the NEW slot's state, and the
  // next Save would update the wrong row.
  const busy = useRef(false);

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

  async function handleSave() {
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
  const saveDisabled =
    saving ||
    deleting ||
    readOnly ||
    switching ||
    slot.status === "loading" ||
    slot.status === "error" ||
    isConflict ||
    (isNew && !canCreate);
  const statusText =
    slot.status === "loading" || switching
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
  const fieldErr = (k: keyof ValidationResult["fields"]) => errors?.fields[k];
  const areaOwnersSummary = `${productionAreas.length} areas · ${
    Object.values(areaOwnerSelections).filter((s) => s.ownerId).length
  } assigned`;

  // Same markup on desktop and mobile; `key` keeps the two copies' element ids
  // apart (only one of them is ever visible).
  function renderAreaOwners(key: "d" | "m") {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {productionAreas.map((area) => {
          const sel = areaOwnerSelections[area.id] ?? { ownerId: "", score: "" };
          const ownerId = `owner-${key}-${area.id}`;
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
                    <SelectTrigger id={ownerId} className="max-md:h-11">
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
                <Field label="Performance Score %" error={errors?.ownerScores[area.id]}>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder="0–100"
                    className="max-md:h-11"
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
      {/* Mobile-only compact header. Save lives in the sticky bar at the
          bottom (with the live numbers), so it is not repeated here. */}
      <div className="mb-3 flex items-center justify-between gap-3 md:hidden">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Daily entry</h1>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {activeLineName} · {date} · {shiftLabel(shift)}
          </p>
          <p
            className={`text-xs font-medium ${
              slot.status === "error" || isConflict ? "text-destructive-strong" : "text-primary"
            }`}
            aria-live="polite"
          >
            {statusText}
            {dirty && !saving ? " · unsaved changes" : ""}
          </p>
        </div>
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

      <div className="mb-6 hidden md:flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Daily Production Entry</h1>
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {activeLineName} · {date} · {shiftLabel(shift)} ·{" "}
            <span
              className={
                slot.status === "error" || isConflict
                  ? "font-medium text-destructive-strong"
                  : "font-medium text-primary"
              }
            >
              {statusText}
            </span>
            {dirty && !saving ? " · unsaved changes" : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canViewHistory && (
            <Button variant="outline" onClick={() => setShowHistory((s) => !s)}>
              {showHistory ? "Hide Entry History" : "Entry History"}
            </Button>
          )}
          <Button
            className="bg-accent text-accent-foreground hover:bg-accent/90"
            onClick={handleSave}
            disabled={saveDisabled}
          >
            <Save className="mr-2 h-4 w-4" /> {saving ? "Saving…" : "Save Entry"}
          </Button>
        </div>
      </div>

      {readOnly && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span>Viewing this entry in read-only mode.</span>
          <Button size="sm" variant="outline" onClick={() => setReadOnly(false)}>
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
        <div className="mb-6">
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

      <Tabs
        value={lineId}
        onValueChange={(v) => void requestSwitch({ lineId: v })}
        className="mb-4"
      >
        <TabsList className="flex w-full items-center justify-start gap-1 overflow-x-auto max-md:h-auto">
          {lines.map((l) => (
            <TabsTrigger
              key={l.id}
              value={l.id}
              className="shrink-0 whitespace-nowrap max-md:min-h-11"
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

      {/* Desktop-only live summary — recomputed from liveSummary on every
          keystroke, mirrors the adherence/loss formulas used by the
          Dashboard so the numbers here never drift from what Save will
          produce. Mobile keeps scrolling straight into the field cards. */}
      <div className="mb-4 hidden grid-cols-4 gap-px overflow-hidden rounded-lg bg-border md:grid">
        <SummaryTile
          label="Making"
          value={liveSummary.makingPct !== null ? `${liveSummary.makingPct.toFixed(0)}%` : "—"}
          sub={`${liveSummary.mActual.toLocaleString()} / ${liveSummary.mPlan.toLocaleString()}`}
          colorClass={adherenceColor(liveSummary.makingPct)}
        />
        <SummaryTile
          label="Packing"
          value={liveSummary.packingPct !== null ? `${liveSummary.packingPct.toFixed(0)}%` : "—"}
          sub={`${liveSummary.pActual.toLocaleString()} / ${liveSummary.pPlan.toLocaleString()}`}
          colorClass={adherenceColor(liveSummary.packingPct)}
        />
        <SummaryTile
          label="Downtime"
          value={`${totalDowntime.toLocaleString()} min`}
          sub={`${validDowntimes.length} stoppage${validDowntimes.length === 1 ? "" : "s"}`}
          colorClass="text-foreground"
        />
        <SummaryTile
          label="Loss"
          value={liveSummary.lossPct !== null ? `${liveSummary.lossPct.toFixed(1)}%` : "—"}
          sub={`of ${liveSummary.avail.toLocaleString()} min`}
          colorClass={lossColor(liveSummary.lossPct)}
        />
      </div>

      {/* A disabled fieldset, not pointer-events: none — read-only must stop
          the keyboard too. m-0/p-0/min-w-0 undo the fieldset defaults so the
          grid lays out exactly as the old div did. */}
      <fieldset
        disabled={readOnly}
        className="m-0 grid min-w-0 grid-cols-1 gap-6 border-0 p-0 lg:grid-cols-3"
        style={readOnly ? { opacity: 0.75 } : undefined}
      >
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Entry Details</CardTitle>
            <CardDescription>Plan & actual figures in kilograms.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Mobile-only: the same 10 fields below, paired up 2-per-row
                (Plan next to Actual, Available next to the first Rework
                field) instead of the desktop 3-column grid. Same state,
                same onChange/disabled — just a different arrangement. */}
            <div className="grid grid-cols-2 gap-x-2 gap-y-3 md:hidden">
              <Field label="Date">
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => e.target.value && void requestSwitch({ date: e.target.value })}
                  className="h-11 rounded-md border bg-muted"
                />
              </Field>
              <Field label="Shift" htmlFor="entry-shift-m">
                <Select value={shift} onValueChange={(v) => void requestSwitch({ shift: v })}>
                  <SelectTrigger id="entry-shift-m" className="h-11 rounded-md border bg-muted">
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
              <Field label="Making Plan (kg)" error={fieldErr("makingPlan")}>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={makingPlan}
                  onChange={(e) => setMakingPlan(e.target.value)}
                  disabled={!canEditProduction}
                  className="h-11 rounded-md border bg-muted"
                />
              </Field>
              <Field label="Making Actual (kg)" error={fieldErr("makingActual")}>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={makingActual}
                  onChange={(e) => setMakingActual(e.target.value)}
                  disabled={!canEditProduction}
                  className="h-11 rounded-md border bg-muted"
                />
              </Field>
              <Field label="Packing Plan (kg)" error={fieldErr("packingPlan")}>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={packingPlan}
                  onChange={(e) => setPackingPlan(e.target.value)}
                  disabled={!canEditProduction}
                  className="h-11 rounded-md border bg-muted"
                />
              </Field>
              <Field label="Packing Actual (kg)" error={fieldErr("packingActual")}>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={packingActual}
                  onChange={(e) => setPackingActual(e.target.value)}
                  disabled={!canEditProduction}
                  className="h-11 rounded-md border bg-muted"
                />
              </Field>
              <Field label="Available Time (min)" error={fieldErr("availableMin")}>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={availableMin}
                  onChange={(e) => setAvailableMin(e.target.value)}
                  className="h-11 rounded-md border bg-muted"
                />
              </Field>
              <Field label="Rework Cooking (kg)" error={fieldErr("reworkCooking")}>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={reworkCooking}
                  onChange={(e) => setReworkCooking(e.target.value)}
                  disabled={!canEditProduction}
                  className="h-11 rounded-md border bg-muted"
                />
              </Field>
              <Field label="Rework Making (kg)" error={fieldErr("reworkMaking")}>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={reworkMaking}
                  onChange={(e) => setReworkMaking(e.target.value)}
                  disabled={!canEditProduction}
                  className="h-11 rounded-md border bg-muted"
                />
              </Field>
              <Field label="Rework Packing (kg)" error={fieldErr("reworkPacking")}>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={reworkPacking}
                  onChange={(e) => setReworkPacking(e.target.value)}
                  disabled={!canEditProduction}
                  className="h-11 rounded-md border bg-muted"
                />
              </Field>
            </div>

            {/* Desktop-only (md:contents unwraps into the grid above at
                md+, exactly as before) — same fields, original 3-column
                layout, completely unchanged. */}
            {/* Desktop-only — Date/Shift/Available Time stay as plain
                fields; Making/Packing move into the paired adherence cards
                below and Rework moves into the collapsible row further
                down. */}
            <div className="hidden gap-4 md:col-span-3 md:grid md:grid-cols-3">
              <Field label="Date">
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => e.target.value && void requestSwitch({ date: e.target.value })}
                />
              </Field>
              <Field label="Shift" htmlFor="entry-shift-d">
                <Select value={shift} onValueChange={(v) => void requestSwitch({ shift: v })}>
                  <SelectTrigger id="entry-shift-d">
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
              <Field label="Available Time (min)" error={fieldErr("availableMin")}>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={availableMin}
                  onChange={(e) => setAvailableMin(e.target.value)}
                />
              </Field>
            </div>

            <div className="hidden gap-4 md:col-span-3 md:grid md:grid-cols-2">
              <AdherenceCard
                title="Making"
                planValue={makingPlan}
                actualValue={makingActual}
                onPlanChange={setMakingPlan}
                onActualChange={setMakingActual}
                disabled={!canEditProduction}
                pct={liveSummary.makingPct}
                planError={fieldErr("makingPlan")}
                actualError={fieldErr("makingActual")}
              />
              <AdherenceCard
                title="Packing"
                planValue={packingPlan}
                actualValue={packingActual}
                onPlanChange={setPackingPlan}
                onActualChange={setPackingActual}
                disabled={!canEditProduction}
                pct={liveSummary.packingPct}
                planError={fieldErr("packingPlan")}
                actualError={fieldErr("packingActual")}
              />
            </div>

            {/* Desktop-only — Rework / Area owners & performance / Comments
                collapsed into rows; mobile keeps its always-expanded
                originals (Rework fields inline above, Area owners &
                Comments blocks below). */}
            <div className="hidden md:col-span-3 md:flex md:flex-col md:gap-3">
              <CollapsibleRow
                icon={Recycle}
                title="Rework"
                summary={`${(
                  (Number(reworkCooking) || 0) +
                  (Number(reworkMaking) || 0) +
                  (Number(reworkPacking) || 0)
                ).toLocaleString()} kg total`}
                open={openRework}
                onToggle={() => setOpenRework((o) => !o)}
              >
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Rework Cooking (kg)" error={fieldErr("reworkCooking")}>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={reworkCooking}
                      onChange={(e) => setReworkCooking(e.target.value)}
                      disabled={!canEditProduction}
                    />
                  </Field>
                  <Field label="Rework Making (kg)" error={fieldErr("reworkMaking")}>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={reworkMaking}
                      onChange={(e) => setReworkMaking(e.target.value)}
                      disabled={!canEditProduction}
                    />
                  </Field>
                  <Field label="Rework Packing (kg)" error={fieldErr("reworkPacking")}>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={reworkPacking}
                      onChange={(e) => setReworkPacking(e.target.value)}
                      disabled={!canEditProduction}
                    />
                  </Field>
                </div>
              </CollapsibleRow>

              {productionAreas.length > 0 && (
                <CollapsibleRow
                  icon={Users}
                  title="Area owners & performance"
                  summary={areaOwnersSummary}
                  open={openAreaOwners}
                  onToggle={() => setOpenAreaOwners((o) => !o)}
                >
                  {renderAreaOwners("d")}
                </CollapsibleRow>
              )}

              <CollapsibleRow
                icon={MessageSquare}
                title="Comments"
                open={openComments}
                onToggle={() => setOpenComments((o) => !o)}
              >
                <Textarea
                  aria-label="Comments"
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={2}
                  disabled={!canEditNotes}
                />
              </CollapsibleRow>
            </div>

            {/* Mobile — Area owners start collapsed like on desktop: they are
                optional, and five always-open area cards pushed the downtime
                log a long scroll away. */}
            {productionAreas.length > 0 && (
              <div className="col-span-1 md:hidden">
                <CollapsibleRow
                  icon={Users}
                  title="Area owners"
                  summary={areaOwnersSummary}
                  open={openAreaOwners}
                  onToggle={() => setOpenAreaOwners((o) => !o)}
                >
                  {renderAreaOwners("m")}
                </CollapsibleRow>
              </div>
            )}

            {customFields.length > 0 && (
              <div className="col-span-1 md:col-span-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Custom fields for this line
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {customFields.map((f) => (
                    <Field key={f.id} label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`}>
                      <Input
                        type="number"
                        inputMode="decimal"
                        className="max-md:h-11"
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

            {/* Mobile — Comments collapsed too; the summary shows whether any
                were written. */}
            <div className="md:hidden">
              <CollapsibleRow
                icon={MessageSquare}
                title="Comments"
                summary={comments.trim() ? "Written" : "Empty"}
                open={openComments}
                onToggle={() => setOpenComments((o) => !o)}
              >
                <Textarea
                  aria-label="Comments"
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={3}
                  disabled={!canEditNotes}
                />
              </CollapsibleRow>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Downtime Log</CardTitle>
              <CardDescription>
                <b>{totalDowntime}</b> min ·{" "}
                {liveSummary.lossPct !== null ? `${liveSummary.lossPct.toFixed(1)}%` : "—"} of
                available
              </CardDescription>
            </div>
            <Button
              size="sm"
              className="bg-accent text-accent-foreground hover:bg-accent/90 max-md:h-11 max-md:px-4"
              onClick={addDowntime}
              disabled={!canEditDowntime}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {downtimes.length === 0 && (
              <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                No downtime logged. Click Add to record stoppages.
              </p>
            )}
            {downtimes.map((d, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                {/* Mobile-only quick-scan summary — the editable Select/
                    Input/Remove controls below are unchanged and still do
                    the actual editing, on every screen size. */}
                <div className="flex items-center justify-between gap-2 rounded-r-md border-l-[3px] border-l-accent bg-card px-2 py-1.5 md:hidden">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium leading-tight">
                      {d.reason_name || "Pick reason"}
                    </p>
                    <p className="truncate text-xs leading-tight text-muted-foreground">
                      {d.area || "—"}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
                    {d.minutes || 0} min
                  </span>
                </div>
                <Select
                  value={d.reason_id}
                  onValueChange={(v) => {
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
                  disabled={!canEditDowntime}
                >
                  <SelectTrigger aria-label={`Downtime ${i + 1} reason`} className="max-md:h-11">
                    <SelectValue placeholder="Pick reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {reasons.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    placeholder="Area"
                    aria-label={`Downtime ${i + 1} area`}
                    className="max-md:h-11"
                    value={d.area}
                    onChange={(e) =>
                      setDowntimes((arr) =>
                        arr.map((row, idx) => (idx === i ? { ...row, area: e.target.value } : row)),
                      )
                    }
                    disabled={!canEditDowntime}
                  />
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="Minutes"
                    aria-label={`Downtime ${i + 1} minutes`}
                    aria-invalid={errors?.downtimes[i] ? true : undefined}
                    className="max-md:h-11"
                    value={d.minutes || ""}
                    onChange={(e) =>
                      setDowntimes((arr) =>
                        arr.map((row, idx) =>
                          idx === i ? { ...row, minutes: Number(e.target.value) } : row,
                        ),
                      )
                    }
                    disabled={!canEditDowntime}
                  />
                </div>
                {errors?.downtimes[i] && (
                  <p className="text-xs font-medium text-destructive-strong" role="alert">
                    {errors.downtimes[i]}
                  </p>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive max-md:h-11"
                  aria-label={`Remove downtime ${i + 1}`}
                  onClick={() => setDowntimes((arr) => arr.filter((_, idx) => idx !== i))}
                  disabled={!canEditDowntime}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                </Button>
              </div>
            ))}

            <EntryPie
              makingActual={Number(makingActual) || 0}
              packingActual={Number(packingActual) || 0}
              rework={
                (Number(reworkCooking) || 0) +
                (Number(reworkMaking) || 0) +
                (Number(reworkPacking) || 0)
              }
              downtimeMin={totalDowntime}
            />

            <div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${lossBarColor(liveSummary.lossPct)}`}
                  style={{ width: `${Math.min(100, Math.max(0, liveSummary.lossPct ?? 0))}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {liveSummary.lossPct !== null ? `${liveSummary.lossPct.toFixed(1)}%` : "—"} of{" "}
                {liveSummary.avail.toLocaleString()} available min
              </p>
            </div>
          </CardContent>
        </Card>
      </fieldset>

      {/* Desktop Save/Delete row — unchanged apart from the guards. */}
      <div className="sticky bottom-4 mt-6 hidden justify-end gap-2 md:flex">
        {slot.status === "existing" && editingSaved && canDelete && (
          <Button
            size="lg"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => handleDelete()}
            disabled={deleting || saving || readOnly}
          >
            <Trash2 className="mr-2 h-4 w-4" /> {deleting ? "Deleting…" : "Delete Entry"}
          </Button>
        )}
        <Button size="lg" onClick={handleSave} disabled={saveDisabled} className="shadow-elevated">
          <Save className="mr-2 h-4 w-4" /> {saving ? "Saving…" : "Save Entry"}
        </Button>
      </div>

      {/* Mobile: Delete sits at the end of the form, away from Save. */}
      {slot.status === "existing" && editingSaved && canDelete && (
        <Button
          variant="ghost"
          className="mt-4 h-11 w-full text-destructive hover:text-destructive md:hidden"
          onClick={() => handleDelete()}
          disabled={deleting || saving || readOnly}
        >
          <Trash2 className="mr-2 h-4 w-4" /> {deleting ? "Deleting…" : "Delete this entry…"}
        </Button>
      )}

      {/* Mobile sticky bar: the live numbers the desktop shows in its summary
          tiles (hidden below md, so adherence was never visible on a phone)
          plus the one Save button. bottom-[72px] clears the fixed bottom nav
          (AppShell.tsx, md:hidden). */}
      <div className="sticky bottom-[72px] z-10 mt-4 rounded-xl border border-border bg-card/95 px-3 py-2 shadow-elevated backdrop-blur md:hidden">
        <div className="flex items-center gap-3">
          <dl className="grid min-w-0 flex-1 grid-cols-3 gap-2">
            {(
              [
                ["Making", liveSummary.makingPct, adherenceColor(liveSummary.makingPct)],
                ["Packing", liveSummary.packingPct, adherenceColor(liveSummary.packingPct)],
                ["Lost", liveSummary.lossPct, lossColor(liveSummary.lossPct)],
              ] as const
            ).map(([label, pct, color]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className={`text-base font-bold tabular-nums ${color}`}>
                  {pct !== null ? `${pct.toFixed(1)}%` : "—"}
                </dd>
              </div>
            ))}
          </dl>
          <Button
            className="h-12 shrink-0 px-6 text-base"
            onClick={handleSave}
            disabled={saveDisabled}
          >
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

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
}: {
  label: string;
  children: React.ReactNode;
  htmlFor?: string;
  error?: string;
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
      <div className="mt-1">{child}</div>
      {error && (
        <p id={errId} role="alert" className="mt-1 text-xs font-medium text-destructive-strong">
          {error}
        </p>
      )}
    </div>
  );
}

// One cell of the desktop-only live summary row under the line tabs.
function SummaryTile({
  label,
  value,
  sub,
  colorClass,
}: {
  label: string;
  value: string;
  sub: string;
  colorClass: string;
}) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${colorClass}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

// Desktop-only paired Making/Packing card: header adherence %, Plan/Actual
// side by side, thin progress bar underneath — replaces the 4 separate
// Field entries the desktop grid used to render for these.
function AdherenceCard({
  title,
  planValue,
  actualValue,
  onPlanChange,
  onActualChange,
  disabled,
  pct,
  planError,
  actualError,
}: {
  title: string;
  planValue: string;
  actualValue: string;
  onPlanChange: (v: string) => void;
  onActualChange: (v: string) => void;
  disabled: boolean;
  pct: number | null;
  planError?: string;
  actualError?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold">{title}</p>
        <p className={`text-xs font-medium ${adherenceColor(pct)}`}>
          {pct !== null ? `${pct.toFixed(0)}% adherence` : "— adherence"}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Plan (kg)" error={planError}>
          <Input
            type="number"
            inputMode="decimal"
            aria-label={`${title} plan, kg`}
            value={planValue}
            onChange={(e) => onPlanChange(e.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label="Actual (kg)" error={actualError}>
          <Input
            type="number"
            inputMode="decimal"
            aria-label={`${title} actual, kg`}
            value={actualValue}
            onChange={(e) => onActualChange(e.target.value)}
            disabled={disabled}
          />
        </Field>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-background">
        <div
          className={`h-full rounded-full ${adherenceBarColor(pct)}`}
          style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }}
        />
      </div>
    </div>
  );
}

// Desktop-only collapsed-by-default row (Rework / Area owners & performance
// / Comments) — bare useState toggle, same reasoning as
// MobileCollapsibleSection in maintenance.tsx: no Radix mount/animation
// machinery needed, and mobile never renders this at all (it keeps its own
// always-expanded originals), so there's no "force back open below md" case
// to handle here.
function CollapsibleRow({
  icon: Icon,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/50">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left max-md:min-h-12"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </span>
        <span className="flex items-center gap-2">
          {summary && <span className="text-xs text-muted-foreground">{summary}</span>}
          <ChevronRight
            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          />
        </span>
      </button>
      {open && <div className="border-t border-border p-3">{children}</div>}
    </div>
  );
}

function EntryPie({
  makingActual,
  packingActual,
  rework,
  downtimeMin,
}: {
  makingActual: number;
  packingActual: number;
  rework: number;
  downtimeMin: number;
}) {
  const data = [
    { name: "Making (kg)", value: makingActual, fill: "var(--color-chart-1)" },
    { name: "Packing (kg)", value: packingActual, fill: "var(--color-chart-2)" },
    { name: "Rework (kg)", value: rework, fill: "var(--color-chart-3)" },
    { name: "Downtime (min)", value: downtimeMin, fill: "var(--color-chart-4)" },
  ].filter((d) => d.value > 0);
  if (data.length === 0) return null;
  return (
    // Desktop only: on a phone it mixed kg with minutes in one pie and pushed
    // the Save bar down; the sticky bar there shows the numbers instead.
    <div className="mt-2 hidden rounded-lg border border-border bg-muted/20 p-3 md:block">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Entry Composition
      </p>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={70}
              innerRadius={35}
              paddingAngle={2}
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Pie>
            <RTooltip
              contentStyle={{
                background: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
