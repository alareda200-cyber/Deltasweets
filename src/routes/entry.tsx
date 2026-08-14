import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useRef } from "react";
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
  Trash2,
  Plus,
  Save,
  History,
  ChevronRight,
  Recycle,
  Users,
  MessageSquare,
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
} from "@/lib/queries";
import { iso } from "@/lib/date-utils";
import { requireSession } from "@/lib/require-session";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";

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

interface DtRow {
  reason_id: string;
  reason_name: string;
  area: string;
  minutes: number;
}

// Adherence (actual/plan): higher is better. Loss (downtime/available): lower
// is better — thresholds mirror the ones DashboardSummary already uses on
// index.tsx (lossPct < 10/25) rather than reusing the adherence thresholds,
// which would mislabel a low-loss day as "red".
function adherenceColor(pct: number | null) {
  if (pct === null) return "text-muted-foreground";
  return pct >= 90 ? "text-success" : pct >= 70 ? "text-warning" : "text-destructive";
}
function adherenceBarColor(pct: number | null) {
  if (pct === null) return "bg-muted-foreground/40";
  return pct >= 90 ? "bg-success" : pct >= 70 ? "bg-warning" : "bg-destructive";
}
function lossColor(pct: number | null) {
  if (pct === null) return "text-muted-foreground";
  return pct < 10 ? "text-success" : pct < 25 ? "text-warning" : "text-destructive";
}
function lossBarColor(pct: number | null) {
  if (pct === null) return "bg-muted-foreground/40";
  return pct < 10 ? "bg-success" : pct < 25 ? "bg-warning" : "bg-destructive";
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
  const [shift, setShift] = useState("A");
  const supervisor = "";
  const operator = "";
  const [comments, setComments] = useState("");
  const [makingPlan, setMakingPlan] = useState("");
  const [makingActual, setMakingActual] = useState("");
  const [packingPlan, setPackingPlan] = useState("");
  const [packingActual, setPackingActual] = useState("");
  const [availableMin, setAvailableMin] = useState("1440");
  const [reworkCooking, setReworkCooking] = useState("0");
  const [reworkMaking, setReworkMaking] = useState("0");
  const [reworkPacking, setReworkPacking] = useState("0");
  const [downtimes, setDowntimes] = useState<DtRow[]>([]);
  const [areaOwnerSelections, setAreaOwnerSelections] = useState<
    Record<string, { ownerId: string; score: string }>
  >({});
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [existingEntryId, setExistingEntryId] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Desktop-only collapsed/expanded state for the Rework / Area owners /
  // Comments rows. Mobile keeps these sections permanently expanded (see the
  // md:hidden blocks below), so there's no mobile equivalent of this state.
  const [openRework, setOpenRework] = useState(false);
  const [openAreaOwners, setOpenAreaOwners] = useState(false);
  const [openComments, setOpenComments] = useState(false);
  const duplicatingRef = useRef(false);

  const { data: customFields = [] } = useQuery(fieldsQuery(lineId));

  // Prefill from existing entry if exists for this line+date+shift
  const originalEntryRef = useRef<{
    making_plan: number;
    making_actual: number;
    packing_plan: number;
    packing_actual: number;
    rework_cooking: number;
    rework_making: number;
    rework_packing: number;
    comments: string | null;
  } | null>(null);
  const originalDowntimesRef = useRef<DtRow[]>([]);
  const originalAreaOwnersRef = useRef<Record<string, { ownerId: string; score: string }>>({});

  useEffect(() => {
    if (!lineId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("daily_entries")
        .select("*")
        .eq("line_id", lineId)
        .eq("entry_date", date)
        .eq("shift", shift)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        if (duplicatingRef.current) {
          toast.warning(
            "An entry already exists for this Line/Date/Shift — loaded the existing entry instead of your duplicate.",
          );
        }
        setExistingEntryId(data.id);
        originalEntryRef.current = {
          making_plan: data.making_plan,
          making_actual: data.making_actual,
          packing_plan: data.packing_plan,
          packing_actual: data.packing_actual,
          rework_cooking: data.rework_cooking,
          rework_making: data.rework_making,
          rework_packing: data.rework_packing,
          comments: data.comments,
        };
        setMakingPlan(String(data.making_plan));
        setMakingActual(String(data.making_actual));
        setPackingPlan(String(data.packing_plan));
        setPackingActual(String(data.packing_actual));
        setAvailableMin(String(data.available_min));
        setReworkCooking(String(data.rework_cooking));
        setReworkMaking(String(data.rework_making));
        setReworkPacking(String(data.rework_packing));
        setComments(data.comments ?? "");
        setCustomValues(
          Object.fromEntries(
            Object.entries((data.custom_fields ?? {}) as Record<string, unknown>).map(([k, v]) => [
              k,
              String(v ?? ""),
            ]),
          ),
        );
        const { data: dts } = await supabase
          .from("entry_downtimes")
          .select("*")
          .eq("entry_id", data.id);
        setDowntimes(
          (dts ?? []).map((d) => ({
            reason_id: d.reason_id ?? "",
            reason_name: d.reason_name,
            area: d.area,
            minutes: Number(d.minutes),
          })),
        );
        originalDowntimesRef.current = (dts ?? []).map((d) => ({
          reason_id: d.reason_id ?? "",
          reason_name: d.reason_name,
          area: d.area,
          minutes: Number(d.minutes),
        }));
        const { data: owners } = await supabase
          .from("entry_area_owners")
          .select("*")
          .eq("entry_id", data.id);
        setAreaOwnerSelections(
          Object.fromEntries(
            (owners ?? []).map((o) => [
              o.production_area_id,
              {
                ownerId: o.owner_id ?? "",
                score: o.performance_score != null ? String(o.performance_score) : "",
              },
            ]),
          ),
        );
        originalAreaOwnersRef.current = Object.fromEntries(
          (owners ?? []).map((o) => [
            o.production_area_id,
            {
              ownerId: o.owner_id ?? "",
              score: o.performance_score != null ? String(o.performance_score) : "",
            },
          ]),
        );
        duplicatingRef.current = false;
      } else {
        setExistingEntryId(null);
        originalEntryRef.current = null;
        originalDowntimesRef.current = [];
        originalAreaOwnersRef.current = {};
        setMakingPlan("");
        setMakingActual("");
        setPackingPlan("");
        setPackingActual("");
        setAvailableMin("1440");
        setReworkCooking("0");
        setReworkMaking("0");
        setReworkPacking("0");
        setComments("");
        setCustomValues({});
        setDowntimes([]);
        setAreaOwnerSelections({});
        duplicatingRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lineId, date, shift]);

  const validDowntimes = downtimes.filter((d) => d.reason_name && Number(d.minutes) > 0);
  const totalDowntime = validDowntimes.reduce((s, d) => s + Number(d.minutes), 0);

  // Live, desktop-only summary — recomputed from the same form state as the
  // rest of the form on every keystroke. null (not 0) means "no plan/
  // available-time entered yet", so the tiles below can show "—" instead of
  // a misleading 0%/100%.
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

  async function handleSave() {
    if (saving) return;
    if (!lineId) return toast.error("Pick a production line");
    if (!existingEntryId && !canCreate) {
      return toast.error("Your role does not have permission to create a new entry.");
    }
    for (const [, sel] of Object.entries(areaOwnerSelections)) {
      if (sel.score === "") continue;
      const n = Number(sel.score);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        return toast.error("Performance Score must be between 0 and 100");
      }
    }
    setSaving(true);
    try {
      // Enforce role permissions server-side of the UI: even if a disabled
      // input were somehow tampered with, the actual saved values for a
      // restricted field group always fall back to what was originally
      // loaded (or a safe default for a brand-new entry) rather than
      // whatever is currently sitting in that field's state.
      const orig = originalEntryRef.current;
      const effectiveMakingPlan = canEditProduction ? makingPlan : String(orig?.making_plan ?? 0);
      const effectiveMakingActual = canEditProduction
        ? makingActual
        : String(orig?.making_actual ?? 0);
      const effectivePackingPlan = canEditProduction
        ? packingPlan
        : String(orig?.packing_plan ?? 0);
      const effectivePackingActual = canEditProduction
        ? packingActual
        : String(orig?.packing_actual ?? 0);
      const effectiveReworkCooking = canEditProduction
        ? reworkCooking
        : String(orig?.rework_cooking ?? 0);
      const effectiveReworkMaking = canEditProduction
        ? reworkMaking
        : String(orig?.rework_making ?? 0);
      const effectiveReworkPacking = canEditProduction
        ? reworkPacking
        : String(orig?.rework_packing ?? 0);
      const effectiveComments = canEditNotes ? comments : (orig?.comments ?? "");
      const effectiveDowntimes = canEditDowntime
        ? validDowntimes
        : originalDowntimesRef.current.filter((d) => d.reason_name && Number(d.minutes) > 0);
      const effectiveDowntimeMin = effectiveDowntimes.reduce((s, d) => s + Number(d.minutes), 0);
      const effectiveAreaOwnerSelections = canEditAreaOwners
        ? areaOwnerSelections
        : originalAreaOwnersRef.current;

      const payload = {
        line_id: lineId,
        entry_date: date,
        shift,
        supervisor: supervisor || null,
        operator: operator || null,
        comments: effectiveComments || null,
        making_plan: Number(effectiveMakingPlan) || 0,
        making_actual: Number(effectiveMakingActual) || 0,
        packing_plan: Number(effectivePackingPlan) || 0,
        packing_actual: Number(effectivePackingActual) || 0,
        available_min: Number(availableMin) || 0,
        downtime_min: effectiveDowntimeMin,
        rework_cooking: Number(effectiveReworkCooking) || 0,
        rework_making: Number(effectiveReworkMaking) || 0,
        rework_packing: Number(effectiveReworkPacking) || 0,
        custom_fields: Object.fromEntries(
          Object.entries(customValues).map(([k, v]) => [k, isNaN(Number(v)) ? v : Number(v)]),
        ),
      };
      const wasExisting = !!existingEntryId;
      const { data: upserted, error } = await supabase
        .from("daily_entries")
        .upsert(payload, { onConflict: "line_id,entry_date,shift" })
        .select()
        .single();
      if (error) throw error;

      // Replace downtimes for this entry
      await supabase.from("entry_downtimes").delete().eq("entry_id", upserted.id);
      if (effectiveDowntimes.length > 0) {
        const rows = effectiveDowntimes.map((d) => ({
          entry_id: upserted.id,
          reason_id: d.reason_id || null,
          reason_name: d.reason_name,
          area: d.area,
          minutes: Number(d.minutes),
        }));
        const { error: dtErr } = await supabase.from("entry_downtimes").insert(rows);
        if (dtErr) throw dtErr;
      }

      // Replace area-owner assignments for this entry
      await supabase.from("entry_area_owners").delete().eq("entry_id", upserted.id);
      const ownerRows = Object.entries(effectiveAreaOwnerSelections)
        .filter(([, sel]) => !!sel.ownerId || sel.score !== "")
        .map(([productionAreaId, sel]) => ({
          entry_id: upserted.id,
          production_area_id: productionAreaId,
          owner_id: sel.ownerId || null,
          performance_score: sel.score === "" ? null : Number(sel.score),
        }));
      if (ownerRows.length > 0) {
        const { error: aoErr } = await supabase.from("entry_area_owners").insert(ownerRows);
        if (aoErr) throw aoErr;
      }

      toast.success(`Saved entry for ${date} · Shift ${shift}`);
      void logAudit(wasExisting ? "entry.edit" : "entry.create", "entry", upserted.id, {
        line_id: lineId,
        entry_date: date,
        shift,
      });
      await qc.invalidateQueries({ queryKey: ["entries"] });
      await qc.invalidateQueries({ queryKey: ["entry-downtimes"] });
      await qc.invalidateQueries({ queryKey: ["entry-area-owners"] });
      await qc.invalidateQueries({ queryKey: ["all-entries"] });
      await qc.refetchQueries({ queryKey: ["entries"], type: "all" });
      await qc.refetchQueries({ queryKey: ["entry-downtimes"], type: "all" });
      await qc.refetchQueries({ queryKey: ["entry-area-owners"], type: "all" });
      await qc.refetchQueries({ queryKey: ["all-entries"], type: "all" });
      navigate({ to: "/" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  function addDowntime() {
    setDowntimes((d) => [...d, { reason_id: "", reason_name: "", area: "General", minutes: 0 }]);
  }

  async function handleDelete(target?: { id: string; label: string }) {
    const targetId = target?.id ?? existingEntryId;
    const targetLabel = target?.label ?? `${date} · Shift ${shift}`;
    if (!targetId) return;
    if (!confirm(`Are you sure you want to permanently delete this entry (${targetLabel})?`))
      return;
    setDeleting(true);
    try {
      // entry_downtimes and entry_area_owners both have ON DELETE CASCADE
      // on entry_id, so deleting daily_entries removes them automatically.
      const { error } = await supabase.from("daily_entries").delete().eq("id", targetId);
      if (error) throw error;

      toast.success("Entry deleted successfully.");
      void logAudit("entry.delete", "entry", targetId, { label: targetLabel });
      // invalidateQueries alone only force-refetches queries that are
      // currently mounted/active; the Dashboard's entries/downtimes/
      // area-owners queries are not active while on this page, so without
      // an explicit refetch they'd just be marked stale and only refresh
      // whenever next observed. refetchQueries forces the actual network
      // refetch now, regardless of mount state, so every dashboard reflects
      // the deletion immediately without needing a manual page reload.
      await qc.invalidateQueries({ queryKey: ["entries"] });
      await qc.invalidateQueries({ queryKey: ["entry-downtimes"] });
      await qc.invalidateQueries({ queryKey: ["entry-area-owners"] });
      await qc.invalidateQueries({ queryKey: ["all-entries"] });
      await qc.refetchQueries({ queryKey: ["entries"], type: "all" });
      await qc.refetchQueries({ queryKey: ["entry-downtimes"], type: "all" });
      await qc.refetchQueries({ queryKey: ["entry-area-owners"], type: "all" });
      await qc.refetchQueries({ queryKey: ["all-entries"], type: "all" });

      // If the deleted entry is the one currently loaded in the form, clear it.
      if (targetId === existingEntryId) {
        setExistingEntryId(null);
        setReadOnly(false);
        setMakingPlan("");
        setMakingActual("");
        setPackingPlan("");
        setPackingActual("");
        setAvailableMin("1440");
        setReworkCooking("0");
        setReworkMaking("0");
        setReworkPacking("0");
        setComments("");
        setCustomValues({});
        setDowntimes([]);
        setAreaOwnerSelections({});
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Delete failed: ${msg}`);
    } finally {
      setDeleting(false);
    }
  }

  // Used by the Entry History panel's View/Edit actions — reuses the exact
  // same load-by-line/date/shift effect the form already has, just by
  // pointing the pickers at a different row instead of duplicating any
  // load logic.
  function handleViewOrEdit(
    row: { line_id: string; entry_date: string; shift: string },
    mode: "view" | "edit",
  ) {
    setReadOnly(mode === "view");
    setLineId(row.line_id);
    setDate(row.entry_date);
    setShift(row.shift);
    setShowHistory(false);
  }

  async function handleDuplicate(row: {
    id: string;
    line_id: string;
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
  }) {
    try {
      const { data: dts } = await supabase
        .from("entry_downtimes")
        .select("*")
        .eq("entry_id", row.id);
      const { data: owners } = await supabase
        .from("entry_area_owners")
        .select("*")
        .eq("entry_id", row.id);

      duplicatingRef.current = true;
      setReadOnly(false);
      setExistingEntryId(null);
      setLineId(row.line_id);
      setDate(iso(new Date()));
      setShift("A");
      setMakingPlan(String(row.making_plan));
      setMakingActual(String(row.making_actual));
      setPackingPlan(String(row.packing_plan));
      setPackingActual(String(row.packing_actual));
      setAvailableMin(String(row.available_min));
      setReworkCooking(String(row.rework_cooking));
      setReworkMaking(String(row.rework_making));
      setReworkPacking(String(row.rework_packing));
      setComments(row.comments ?? "");
      setCustomValues(
        Object.fromEntries(
          Object.entries((row.custom_fields ?? {}) as Record<string, unknown>).map(([k, v]) => [
            k,
            String(v ?? ""),
          ]),
        ),
      );
      setDowntimes(
        (dts ?? []).map((d) => ({
          reason_id: d.reason_id ?? "",
          reason_name: d.reason_name,
          area: d.area,
          minutes: Number(d.minutes),
        })),
      );
      setAreaOwnerSelections(
        Object.fromEntries(
          (owners ?? []).map((o) => [
            o.production_area_id,
            {
              ownerId: o.owner_id ?? "",
              score: o.performance_score != null ? String(o.performance_score) : "",
            },
          ]),
        ),
      );
      setShowHistory(false);
      toast.success("Entry duplicated successfully. Choose a Date, Shift, and Line, then Save.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Duplicate failed: ${msg}`);
    }
  }

  const activeLineName = lines.find((l) => l.id === lineId)?.name ?? "—";
  const saveDisabled = saving || deleting || readOnly || (!existingEntryId && !canCreate);
  // Purely decorative — no gating, nothing else reads these. "Basics" is
  // always considered done since Line/Date/Shift always have a default
  // value; the other two light up once their section has something entered.
  const step2Done = makingActual !== "" || packingActual !== "";
  const step3Done = downtimes.length > 0;

  return (
    <AppShell>
      {/* Mobile-only compact header — title + line/date + a single accent
          Save action in one row. Full desktop header (with Entry History)
          below is unchanged, just gated to md+. */}
      <div className="mb-3 flex items-center justify-between gap-3 md:hidden">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Daily entry</h1>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {activeLineName} · {date}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Not in the approved mobile mockup for this header, but kept
              accessible (icon-only, same toggle as the desktop button below)
              rather than dropping History access entirely on mobile. */}
          {canViewHistory && (
            <Button
              size="icon"
              variant="outline"
              aria-label={showHistory ? "Hide Entry History" : "Entry History"}
              onClick={() => setShowHistory((s) => !s)}
            >
              <History className="h-4 w-4" />
            </Button>
          )}
          <Button
            size="sm"
            className="bg-accent text-accent-foreground hover:bg-accent/90"
            onClick={handleSave}
            disabled={saveDisabled}
          >
            <Save className="mr-1 h-4 w-4" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Mobile-only step indicator — 3 segments: Basics / Production / Downtime. */}
      <div className="mb-4 flex gap-1 md:hidden">
        <div className="h-[3px] flex-1 rounded-full bg-accent" />
        <div className={`h-[3px] flex-1 rounded-full ${step2Done ? "bg-accent" : "bg-muted"}`} />
        <div className={`h-[3px] flex-1 rounded-full ${step3Done ? "bg-accent" : "bg-muted"}`} />
      </div>

      <div className="mb-6 hidden md:flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Daily Production Entry</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeLineName} · {date} · Shift {shift}
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

      <Tabs value={lineId} onValueChange={setLineId} className="mb-4">
        <TabsList className="flex w-full items-center justify-start gap-1 overflow-x-auto">
          {lines.map((l) => (
            <TabsTrigger key={l.id} value={l.id} className="shrink-0 whitespace-nowrap">
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

      <div
        className="grid grid-cols-1 gap-6 lg:grid-cols-3"
        style={readOnly ? { pointerEvents: "none", opacity: 0.75 } : undefined}
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
            <div className="grid grid-cols-2 gap-2 md:hidden">
              <Field label="Date">
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded-md border bg-muted"
                />
              </Field>
              <Field label="Shift">
                <Select value={shift} onValueChange={setShift}>
                  <SelectTrigger className="rounded-md border bg-muted">
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
              <Field label="Making Plan (kg)">
                <Input
                  type="number"
                  value={makingPlan}
                  onChange={(e) => setMakingPlan(e.target.value)}
                  disabled={!canEditProduction}
                  className="rounded-md border bg-muted"
                />
              </Field>
              <Field label="Making Actual (kg)">
                <Input
                  type="number"
                  value={makingActual}
                  onChange={(e) => setMakingActual(e.target.value)}
                  disabled={!canEditProduction}
                  className="rounded-md border bg-muted"
                />
              </Field>
              <Field label="Packing Plan (kg)">
                <Input
                  type="number"
                  value={packingPlan}
                  onChange={(e) => setPackingPlan(e.target.value)}
                  disabled={!canEditProduction}
                  className="rounded-md border bg-muted"
                />
              </Field>
              <Field label="Packing Actual (kg)">
                <Input
                  type="number"
                  value={packingActual}
                  onChange={(e) => setPackingActual(e.target.value)}
                  disabled={!canEditProduction}
                  className="rounded-md border bg-muted"
                />
              </Field>
              <Field label="Available Time (min)">
                <Input
                  type="number"
                  value={availableMin}
                  onChange={(e) => setAvailableMin(e.target.value)}
                  className="rounded-md border bg-muted"
                />
              </Field>
              <Field label="Rework Cooking (kg)">
                <Input
                  type="number"
                  value={reworkCooking}
                  onChange={(e) => setReworkCooking(e.target.value)}
                  disabled={!canEditProduction}
                  className="rounded-md border bg-muted"
                />
              </Field>
              <Field label="Rework Making (kg)">
                <Input
                  type="number"
                  value={reworkMaking}
                  onChange={(e) => setReworkMaking(e.target.value)}
                  disabled={!canEditProduction}
                  className="rounded-md border bg-muted"
                />
              </Field>
              <Field label="Rework Packing (kg)">
                <Input
                  type="number"
                  value={reworkPacking}
                  onChange={(e) => setReworkPacking(e.target.value)}
                  disabled={!canEditProduction}
                  className="rounded-md border bg-muted"
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
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Shift">
                <Select value={shift} onValueChange={setShift}>
                  <SelectTrigger>
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
              <Field label="Available Time (min)">
                <Input
                  type="number"
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
              />
              <AdherenceCard
                title="Packing"
                planValue={packingPlan}
                actualValue={packingActual}
                onPlanChange={setPackingPlan}
                onActualChange={setPackingActual}
                disabled={!canEditProduction}
                pct={liveSummary.packingPct}
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
                  <Field label="Rework Cooking (kg)">
                    <Input
                      type="number"
                      value={reworkCooking}
                      onChange={(e) => setReworkCooking(e.target.value)}
                      disabled={!canEditProduction}
                    />
                  </Field>
                  <Field label="Rework Making (kg)">
                    <Input
                      type="number"
                      value={reworkMaking}
                      onChange={(e) => setReworkMaking(e.target.value)}
                      disabled={!canEditProduction}
                    />
                  </Field>
                  <Field label="Rework Packing (kg)">
                    <Input
                      type="number"
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
                  summary={`${productionAreas.length} areas · ${
                    Object.values(areaOwnerSelections).filter((s) => s.ownerId).length
                  } assigned`}
                  open={openAreaOwners}
                  onToggle={() => setOpenAreaOwners((o) => !o)}
                >
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {productionAreas.map((area) => {
                      const sel = areaOwnerSelections[area.id] ?? { ownerId: "", score: "" };
                      return (
                        <div key={area.id} className="rounded-lg border border-border p-3">
                          <p className="mb-2 text-sm font-semibold">{area.name}</p>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <Field label="Owner">
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
                                <SelectTrigger>
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
                            <Field label="Performance Score %">
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                placeholder="0–100"
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
                </CollapsibleRow>
              )}

              <CollapsibleRow
                icon={MessageSquare}
                title="Comments"
                open={openComments}
                onToggle={() => setOpenComments((o) => !o)}
              >
                <Textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={2}
                  disabled={!canEditNotes}
                />
              </CollapsibleRow>
            </div>

            {/* Mobile-only — unchanged, always-expanded Area owners block. */}
            {productionAreas.length > 0 && (
              <div className="col-span-1 md:hidden">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Area owners &amp; performance
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {productionAreas.map((area) => {
                    const sel = areaOwnerSelections[area.id] ?? { ownerId: "", score: "" };
                    return (
                      <div key={area.id} className="rounded-lg border border-border p-3">
                        <p className="mb-2 text-sm font-semibold">{area.name}</p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <Field label="Owner">
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
                              <SelectTrigger>
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
                          <Field label="Performance Score %">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step="0.01"
                              placeholder="0–100"
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

            {/* Mobile-only — unchanged, always-expanded Comments block. */}
            <div className="md:hidden">
              <Label className="text-xs">Comments</Label>
              <Textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={2}
                className="mt-1"
                disabled={!canEditNotes}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Downtime Log</CardTitle>
              <CardDescription>
                <b>{totalDowntime}</b> min ·{" "}
                {liveSummary.lossPct !== null ? liveSummary.lossPct.toFixed(1) : "0"}% of available
              </CardDescription>
            </div>
            <Button
              size="sm"
              className="bg-accent text-accent-foreground hover:bg-accent/90"
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
                  <SelectTrigger>
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
                    placeholder="Minutes"
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
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
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
                {liveSummary.lossPct !== null ? liveSummary.lossPct.toFixed(1) : "0"}% of{" "}
                {liveSummary.avail.toLocaleString()} available min
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* max-md:bottom-[72px]: clears the fixed mobile bottom nav
          (AppShell.tsx, md:hidden) — bottom-4 on its own would sit under
          it. No-op at md+, where that nav doesn't render and the original
          bottom-4 offset applies. */}
      <div className="sticky bottom-4 max-md:bottom-[72px] mt-6 flex justify-end gap-2">
        {existingEntryId && canDelete && (
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
        <Button
          size="lg"
          onClick={handleSave}
          disabled={saving || deleting || readOnly || (!existingEntryId && !canCreate)}
          className="shadow-elevated"
        >
          <Save className="mr-2 h-4 w-4" /> {saving ? "Saving…" : "Save Entry"}
        </Button>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
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
}: {
  title: string;
  planValue: string;
  actualValue: string;
  onPlanChange: (v: string) => void;
  onActualChange: (v: string) => void;
  disabled: boolean;
  pct: number | null;
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
        <Field label="Plan (kg)">
          <Input
            type="number"
            value={planValue}
            onChange={(e) => onPlanChange(e.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label="Actual (kg)">
          <Input
            type="number"
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
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left"
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
    <div className="mt-2 rounded-lg border border-border bg-muted/20 p-3">
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
