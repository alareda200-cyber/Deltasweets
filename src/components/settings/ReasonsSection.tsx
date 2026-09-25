import { useEffect, useId, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { cn } from "@/lib/utils";
import type {
  Department,
  DowntimeReason,
  DowntimeType,
  ProductionArea,
  SeverityLevel,
} from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ConfirmDialog,
  SectionHeader,
  WarningNote,
  nameOf,
  normalizeCode,
  plural,
  validateMasterDataInput,
  type QC,
} from "./shared";

const PAGE_SIZE = 10;
const NONE = "__none";
const ALL = "__all";

function typeKind(name: string | undefined): "planned" | "unplanned" | "other" | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  if (n === "planned") return "planned";
  if (n === "unplanned") return "unplanned";
  return "other";
}

function TypePill({ name }: { name: string | undefined }) {
  const kind = typeKind(name);
  if (!kind) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
        kind === "planned" && "bg-primary/10 text-primary",
        kind === "unplanned" && "bg-warning/20 text-warning-strong",
        kind === "other" && "bg-muted text-muted-foreground",
      )}
    >
      {name}
    </span>
  );
}

// role="switch" with a 44px hit area around the 44x26 track from the board.
function ActiveSwitch({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex h-11 w-14 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative h-[26px] w-11 rounded-full transition-colors",
          checked ? "bg-success" : "bg-muted-foreground/40",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] h-5 w-5 rounded-full bg-background shadow transition-[left]",
            checked ? "left-[21px]" : "left-[3px]",
          )}
        />
      </span>
    </button>
  );
}

export function ReasonsSection({
  reasons,
  usage,
  usageLoaded,
  productionAreas,
  departments,
  downtimeTypes,
  severityLevels,
  qc,
}: {
  reasons: DowntimeReason[];
  usage: Record<string, number>;
  usageLoaded: boolean;
  productionAreas: ProductionArea[];
  departments: Department[];
  downtimeTypes: DowntimeType[];
  severityLevels: SeverityLevel[];
  qc: QC;
}) {
  const [q, setQ] = useState("");
  const [areaFilter, setAreaFilter] = useState(ALL);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [showOff, setShowOff] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DowntimeReason | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DowntimeReason | null>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const ids = { q: useId(), area: useId(), type: useId(), off: useId() };

  const total = reasons.length;
  const active = reasons.filter((r) => r.is_active).length;
  const off = total - active;
  const usesOf = (r: DowntimeReason) => usage[r.id] ?? 0;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return reasons
      .filter((r) => showOff || r.is_active)
      .filter(
        (r) =>
          !needle ||
          r.name.toLowerCase().includes(needle) ||
          (r.code ?? "").toLowerCase().includes(needle),
      )
      .filter((r) =>
        areaFilter === ALL
          ? true
          : areaFilter === NONE
            ? !r.production_area_id
            : r.production_area_id === areaFilter,
      )
      .filter((r) =>
        typeFilter === ALL
          ? true
          : typeFilter === NONE
            ? !r.downtime_type_id
            : r.downtime_type_id === typeFilter,
      )
      .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0) || a.name.localeCompare(b.name));
  }, [reasons, usage, q, areaFilter, typeFilter, showOff]);

  const visible = showAll ? filtered : filtered.slice(0, PAGE_SIZE);
  const neverUsed = usageLoaded ? reasons.filter((r) => usesOf(r) === 0) : [];

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(r: DowntimeReason) {
    setEditing(r);
    setDialogOpen(true);
  }

  async function toggleActive(r: DowntimeReason, next: boolean) {
    setToggling((s) => new Set(s).add(r.id));
    try {
      const { error } = await supabase
        .from("downtime_reasons")
        .update({ is_active: next })
        .eq("id", r.id);
      if (error) return void toast.error(error.message);
      toast.success(
        next
          ? `“${r.name}” switched on — supervisors can pick it again`
          : `“${r.name}” switched off — hidden from the downtime log, history kept`,
      );
      void logAudit("settings.update", "downtime_reason", r.id, {
        name: r.name,
        is_active: next,
      });
      await qc.invalidateQueries({ queryKey: ["reasons"] });
    } finally {
      setToggling((s) => {
        const n = new Set(s);
        n.delete(r.id);
        return n;
      });
    }
  }

  async function confirmDelete(): Promise<boolean> {
    const r = pendingDelete;
    if (!r) return true;
    // Re-check on the server: the usage numbers on screen may be stale.
    const { count, error: countError } = await supabase
      .from("entry_downtimes")
      .select("id", { count: "exact", head: true })
      .eq("reason_id", r.id);
    if (countError) {
      toast.error(countError.message);
      return false;
    }
    if ((count ?? 0) > 0) {
      toast.error(
        `“${r.name}” is now used by ${plural(count ?? 0, "entry", "entries")} — switch it off instead.`,
      );
      qc.invalidateQueries({ queryKey: ["reason-usage"] });
      return true;
    }
    const { error } = await supabase.from("downtime_reasons").delete().eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success(`Downtime reason “${r.name}” deleted`);
    void logAudit("settings.delete", "downtime_reason", r.id, { name: r.name });
    qc.invalidateQueries({ queryKey: ["reasons"] });
    return true;
  }

  const areaName = (r: DowntimeReason) => nameOf(productionAreas, r.production_area_id);
  const typeName = (r: DowntimeReason) => nameOf(downtimeTypes, r.downtime_type_id);
  const usedLabel = (r: DowntimeReason) => (usageLoaded ? usesOf(r).toLocaleString() : "…");

  return (
    <div className="space-y-4 md:space-y-5">
      <SectionHeader
        id="reasons"
        count={total}
        description={
          <>
            What supervisors pick in the downtime log. {plural(total, "reason")} · {active} active ·{" "}
            {off} switched off.
          </>
        }
        action={
          <Button onClick={openAdd} className="h-11 w-full px-4 sm:w-auto">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add reason
          </Button>
        }
      />

      <WarningNote>
        Type and area are read live. Changing a reason from Planned to Unplanned re-labels every
        past entry that used it.
      </WarningNote>

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="md:min-w-0 md:max-w-80 md:flex-1">
          <Label htmlFor={ids.q} className="sr-only">
            Search reasons
          </Label>
          <Input
            id={ids.q}
            type="search"
            placeholder="Search reasons"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 md:flex md:shrink-0">
          <div>
            <Label htmlFor={ids.area} className="sr-only">
              Area
            </Label>
            <Select value={areaFilter} onValueChange={setAreaFilter}>
              <SelectTrigger id={ids.area} className="h-11 bg-card md:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All areas</SelectItem>
                {productionAreas.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
                <SelectItem value={NONE}>No area</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={ids.type} className="sr-only">
              Type
            </Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger id={ids.type} className="h-11 bg-card md:w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Planned and unplanned</SelectItem>
                {downtimeTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} only
                  </SelectItem>
                ))}
                <SelectItem value={NONE}>No type</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <label
          htmlFor={ids.off}
          className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap text-sm md:ml-auto"
        >
          <input
            id={ids.off}
            type="checkbox"
            checked={showOff}
            onChange={(e) => setShowOff(e.target.checked)}
            className="h-5 w-5 accent-primary"
          />
          Show switched-off
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {/* Desktop table */}
        <table className="hidden w-full border-collapse text-sm md:table">
          <thead>
            <tr className="bg-muted/60 text-left">
              <th scope="col" className="px-4 py-3 text-[13px] font-semibold text-muted-foreground">
                Reason
              </th>
              <th scope="col" className="px-4 py-3 text-[13px] font-semibold text-muted-foreground">
                Area
              </th>
              <th scope="col" className="px-4 py-3 text-[13px] font-semibold text-muted-foreground">
                Department
              </th>
              <th scope="col" className="px-4 py-3 text-[13px] font-semibold text-muted-foreground">
                Type
              </th>
              <th scope="col" className="px-4 py-3 text-[13px] font-semibold text-muted-foreground">
                Severity
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right text-[13px] font-semibold text-muted-foreground"
              >
                Used
              </th>
              <th scope="col" className="px-4 py-3 text-[13px] font-semibold text-muted-foreground">
                Active
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="border-t border-border/60">
                <td className="max-w-[300px] px-4 py-2 font-semibold">
                  <span className={cn(!r.is_active && "text-muted-foreground")}>{r.name}</span>
                  {!r.is_active && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                      Off
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {areaName(r) ?? <span className="text-muted-foreground">No area</span>}
                </td>
                <td className="px-4 py-2">
                  {nameOf(departments, r.department_id) ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <TypePill name={typeName(r)} />
                </td>
                <td className="px-4 py-2">
                  {nameOf(severityLevels, r.severity_id) ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{usedLabel(r)}</td>
                <td className="px-2 py-0">
                  <ActiveSwitch
                    checked={r.is_active}
                    label={`Active: ${r.name}`}
                    disabled={toggling.has(r.id)}
                    onChange={(next) => toggleActive(r, next)}
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <Button
                    variant="outline"
                    className="h-10 px-3.5"
                    aria-label={`Edit ${r.name}`}
                    onClick={() => openEdit(r)}
                  >
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile cards */}
        <ul className="divide-y divide-border/60 md:hidden">
          {visible.map((r) => (
            <li key={r.id} className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={cn("font-semibold", !r.is_active && "text-muted-foreground")}>
                    {r.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      areaName(r) ?? "No area",
                      nameOf(departments, r.department_id),
                      nameOf(severityLevels, r.severity_id),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <ActiveSwitch
                  checked={r.is_active}
                  label={`Active: ${r.name}`}
                  disabled={toggling.has(r.id)}
                  onChange={(next) => toggleActive(r, next)}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <TypePill name={typeName(r)} />
                  <span className="text-muted-foreground">
                    Used <span className="tabular-nums text-foreground">{usedLabel(r)}</span>
                  </span>
                </div>
                <Button
                  variant="outline"
                  className="h-11 px-4"
                  aria-label={`Edit ${r.name}`}
                  onClick={() => openEdit(r)}
                >
                  Edit
                </Button>
              </div>
            </li>
          ))}
        </ul>

        {visible.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No reasons match these filters.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3 text-[13px] text-muted-foreground">
          <span>
            {visible.length} of {filtered.length} {showOff ? "reasons" : "active"} · sorted by most
            used
          </span>
          {filtered.length > PAGE_SIZE && (
            <Button
              variant="outline"
              className="h-11 px-3.5 font-semibold text-primary md:h-10"
              onClick={() => setShowAll((s) => !s)}
            >
              {showAll ? `Show top ${PAGE_SIZE}` : "Show all"}
            </Button>
          )}
        </div>
      </div>

      <p className="text-[13px] text-muted-foreground">
        A reason that has been used can be switched off, not deleted — its history stays.{" "}
        {usageLoaded &&
          (neverUsed.length === 0
            ? "Every reason has been used, so none can be deleted."
            : `Delete is offered only for reasons never used (${neverUsed
                .slice(0, 4)
                .map((r) => r.name)
                .join(", ")}${neverUsed.length > 4 ? `, and ${neverUsed.length - 4} more` : ""}).`)}
      </p>

      <ReasonDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        reason={editing}
        uses={editing ? usesOf(editing) : 0}
        usageLoaded={usageLoaded}
        productionAreas={productionAreas}
        departments={departments}
        downtimeTypes={downtimeTypes}
        severityLevels={severityLevels}
        qc={qc}
        onRequestDelete={(r) => {
          setDialogOpen(false);
          setPendingDelete(r);
        }}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete “${pendingDelete?.name ?? ""}”?`}
        description={
          <p>
            This reason has never been used in a downtime entry, so nothing in the history changes.
            It disappears from the downtime log and from this list.
          </p>
        }
        confirmLabel="Delete reason"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function ReasonDialog({
  open,
  onOpenChange,
  reason,
  uses,
  usageLoaded,
  productionAreas,
  departments,
  downtimeTypes,
  severityLevels,
  qc,
  onRequestDelete,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  reason: DowntimeReason | null;
  uses: number;
  usageLoaded: boolean;
  productionAreas: ProductionArea[];
  departments: Department[];
  downtimeTypes: DowntimeType[];
  severityLevels: SeverityLevel[];
  qc: QC;
  onRequestDelete: (r: DowntimeReason) => void;
}) {
  const isEditing = !!reason;
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [area, setArea] = useState("General");
  const [productionAreaId, setProductionAreaId] = useState(NONE);
  const [departmentId, setDepartmentId] = useState(NONE);
  const [downtimeTypeId, setDowntimeTypeId] = useState(NONE);
  const [severityId, setSeverityId] = useState(NONE);
  const [saving, setSaving] = useState(false);
  const ids = {
    name: useId(),
    code: useId(),
    area: useId(),
    dep: useId(),
    type: useId(),
    sev: useId(),
    legacy: useId(),
  };

  // Re-seed on open / when a different reason is opened — keyed on id so a
  // background refetch while the dialog is open doesn't clobber edits.
  useEffect(() => {
    if (!open) return;
    setName(reason?.name ?? "");
    setCode(reason?.code ?? "");
    setArea(reason?.area ?? "General");
    setProductionAreaId(reason?.production_area_id ?? NONE);
    setDepartmentId(reason?.department_id ?? NONE);
    setDowntimeTypeId(reason?.downtime_type_id ?? NONE);
    setSeverityId(reason?.severity_id ?? NONE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reason?.id]);

  const val = (v: string) => (v === NONE ? null : v);
  const relabels =
    isEditing &&
    uses > 0 &&
    (val(downtimeTypeId) !== reason.downtime_type_id ||
      val(productionAreaId) !== reason.production_area_id);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateMasterDataInput(name, code);
    if (validationError) return void toast.error(validationError);
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        code: normalizeCode(code),
        area: area.trim() || "General",
        production_area_id: val(productionAreaId),
        department_id: val(departmentId),
        downtime_type_id: val(downtimeTypeId),
        severity_id: val(severityId),
      };
      if (isEditing) {
        const { error } = await supabase
          .from("downtime_reasons")
          .update(payload)
          .eq("id", reason.id);
        if (error) return void toast.error(error.message);
        toast.success(`Downtime reason “${payload.name}” updated`);
        void logAudit("settings.update", "downtime_reason", reason.id, { name: payload.name });
      } else {
        const { error } = await supabase.from("downtime_reasons").insert(payload);
        if (error) return void toast.error(error.message);
        toast.success(`Downtime reason “${payload.name}” added`);
        void logAudit("settings.create", "downtime_reason", undefined, { name: payload.name });
      }
      qc.invalidateQueries({ queryKey: ["reasons"] });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  const picker = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    items: { id: string; name: string }[],
    noneLabel: string,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-11 md:h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{noneLabel}</SelectItem>
          {items.map((x) => (
            <SelectItem key={x.id} value={x.id}>
              {x.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-left">
            {isEditing ? `Edit “${reason.name}”` : "Add downtime reason"}
          </DialogTitle>
          <DialogDescription className="text-left">
            {isEditing
              ? usageLoaded
                ? `Used in ${plural(uses, "downtime entry", "downtime entries")}.`
                : "Counting how often this reason was used…"
              : "Supervisors can pick it in the downtime log as soon as it is saved."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <div className="space-y-1.5">
              <Label htmlFor={ids.name}>Reason name</Label>
              <Input
                id={ids.name}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="h-11 md:h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={ids.code}>Code</Label>
              <Input
                id={ids.code}
                value={code}
                placeholder="e.g. CND-DLY"
                onChange={(e) => setCode(e.target.value)}
                className="h-11 md:h-9"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {picker(
              ids.area,
              "Production area",
              productionAreaId,
              setProductionAreaId,
              productionAreas,
              "No area",
            )}
            {picker(ids.dep, "Department", departmentId, setDepartmentId, departments, "None")}
            {picker(ids.type, "Type", downtimeTypeId, setDowntimeTypeId, downtimeTypes, "Not set")}
            {picker(ids.sev, "Severity", severityId, setSeverityId, severityLevels, "Not set")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.legacy}>Legacy area label</Label>
            <Input
              id={ids.legacy}
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="h-11 md:h-9"
            />
            <p className="text-xs text-muted-foreground">
              Free-text area kept for older reports. Production area above is what the app uses.
            </p>
          </div>

          {relabels && (
            <WarningNote>
              Changing the type or area re-labels all {plural(uses, "past entry", "past entries")}{" "}
              that used this reason.
            </WarningNote>
          )}

          {isEditing && usageLoaded && uses > 0 && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              This reason can’t be deleted: {plural(uses, "downtime entry", "downtime entries")}{" "}
              point at it, and deleting it would break their history. Switch it off in the list to
              hide it from the downtime log instead.
            </p>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            {isEditing && usageLoaded && uses === 0 ? (
              <Button
                type="button"
                variant="ghost"
                className="h-11 text-destructive-strong hover:text-destructive-strong md:h-9"
                onClick={() => onRequestDelete(reason)}
              >
                Delete reason
              </Button>
            ) : (
              <span className="hidden sm:block" />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-9"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="h-11 md:h-9" disabled={saving}>
                {saving ? "Saving…" : isEditing ? "Save changes" : "Add reason"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
