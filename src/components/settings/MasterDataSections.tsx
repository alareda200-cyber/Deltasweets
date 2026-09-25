import { useId, useState, type ReactNode } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import type {
  AreaOwner,
  Department,
  DepartmentCategory,
  ProductionArea,
  RootCause,
} from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CodeChip,
  ConfirmDialog,
  IconButton,
  InactiveChip,
  ListRow,
  LockedTag,
  SectionHeader,
  TextField,
  isLockedName,
  nameOf,
  normalizeCode,
  validateMasterDataInput,
  type QC,
} from "./shared";
import type { SectionId } from "./sections";

const NONE = "__none";

// ---------------------------------------------------------------------------
// Building blocks shared by the list sections below
// ---------------------------------------------------------------------------

function SaveButtons({
  editing,
  onSave,
  onCancel,
}: {
  editing: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2">
      <Button onClick={onSave} className="h-11 flex-1 md:h-9">
        {editing ? (
          "Update"
        ) : (
          <>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </>
        )}
      </Button>
      {editing && (
        <Button variant="ghost" onClick={onCancel} className="h-11 md:h-9">
          Cancel
        </Button>
      )}
    </div>
  );
}

function OptionalSelect({
  label,
  value,
  onChange,
  items,
  noneLabel = "None",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  items: { id: string; name: string }[];
  noneLabel?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
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
}

function RowActions({
  name,
  locked,
  onEdit,
  onDelete,
}: {
  name: string;
  locked?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <IconButton icon={Pencil} label={`Edit ${name}`} onClick={onEdit} />
      {!locked && (
        <IconButton icon={Trash2} tone="destructive" label={`Delete ${name}`} onClick={onDelete} />
      )}
    </div>
  );
}

function SectionCard({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-4 p-4 md:p-6">{children}</CardContent>
    </Card>
  );
}

function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="p-4 text-center text-sm text-muted-foreground">{children}</p>;
}

const LOCKED_HINT = "This name is used in calculations and can’t be changed.";

// ---------------------------------------------------------------------------
// Production areas
// ---------------------------------------------------------------------------
export function ProductionAreasSection({ areas, qc }: { areas: ProductionArea[]; qc: QC }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProductionArea | null>(null);

  function startEdit(a: ProductionArea) {
    setEditingId(a.id);
    setName(a.name);
    setCode(a.code ?? "");
  }
  function cancelEdit() {
    setEditingId(null);
    setName("");
    setCode("");
  }

  async function save() {
    const validationError = validateMasterDataInput(name, code);
    if (validationError) return toast.error(validationError);
    if (editingId) {
      const { error } = await supabase
        .from("production_areas")
        .update({ name: name.trim(), code: normalizeCode(code) })
        .eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success(`Production area "${name}" updated`);
      void logAudit("settings.update", "production_area", editingId, { name });
      cancelEdit();
    } else {
      const { error } = await supabase
        .from("production_areas")
        .insert({ name: name.trim(), code: normalizeCode(code), display_order: areas.length + 1 });
      if (error) return toast.error(error.message);
      toast.success(`Production area "${name}" added`);
      void logAudit("settings.create", "production_area", undefined, { name });
      setName("");
      setCode("");
    }
    qc.invalidateQueries({ queryKey: ["production-areas"] });
  }

  async function confirmDelete(): Promise<boolean> {
    const a = pendingDelete;
    if (!a) return true;
    const { error } = await supabase.from("production_areas").delete().eq("id", a.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    if (editingId === a.id) cancelEdit();
    toast.success(`Production area "${a.name}" deleted`);
    void logAudit("settings.delete", "production_area", a.id, { name: a.name });
    qc.invalidateQueries({ queryKey: ["production-areas"] });
    return true;
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <SectionHeader id="areas" count={areas.length} />
      <SectionCard>
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
          <TextField label="Area name" value={name} onChange={setName} placeholder="e.g. Coating" />
          <TextField label="Code" value={code} onChange={setCode} placeholder="e.g. CT" />
          <SaveButtons editing={!!editingId} onSave={save} onCancel={cancelEdit} />
        </div>
        <div className="space-y-1.5">
          {areas.map((a) => (
            <ListRow key={a.id}>
              <span className="flex min-w-0 items-center gap-2 font-medium">
                {a.name}
                {a.code && <CodeChip>{a.code}</CodeChip>}
              </span>
              <RowActions
                name={a.name}
                onEdit={() => startEdit(a)}
                onDelete={() => setPendingDelete(a)}
              />
            </ListRow>
          ))}
          {areas.length === 0 && <EmptyRow>No production areas yet.</EmptyRow>}
        </div>
      </SectionCard>
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete production area “${pendingDelete?.name ?? ""}”?`}
        description={
          <p>
            Owner assignments for this area on past entries are removed too. Downtime reasons that
            point at it will show “No area”.
          </p>
        }
        confirmLabel="Delete area"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Area owners
// ---------------------------------------------------------------------------
export function AreaOwnersSection({
  owners,
  departments,
  qc,
}: {
  owners: AreaOwner[];
  departments: Department[];
  qc: QC;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AreaOwner | null>(null);

  function startEdit(o: AreaOwner) {
    setEditingId(o.id);
    setName(o.name);
    setCode(o.code ?? "");
    setEmployeeId(o.employee_id ?? "");
    setDepartmentId(o.department_id ?? "");
  }
  function cancelEdit() {
    setEditingId(null);
    setName("");
    setCode("");
    setEmployeeId("");
    setDepartmentId("");
  }

  async function save() {
    const validationError = validateMasterDataInput(name, code);
    if (validationError) return toast.error(validationError);
    const payload = {
      name: name.trim(),
      code: normalizeCode(code),
      employee_id: employeeId.trim() || null,
      department_id: departmentId || null,
    };
    if (editingId) {
      const { error } = await supabase.from("area_owners").update(payload).eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success(`Area owner "${name}" updated`);
      void logAudit("settings.update", "area_owner", editingId, { name });
      cancelEdit();
    } else {
      const { error } = await supabase.from("area_owners").insert(payload);
      if (error) return toast.error(error.message);
      toast.success(`Area owner "${name}" added`);
      void logAudit("settings.create", "area_owner", undefined, { name });
      setName("");
      setCode("");
      setEmployeeId("");
      setDepartmentId("");
    }
    qc.invalidateQueries({ queryKey: ["area-owners"] });
  }

  async function confirmDelete(): Promise<boolean> {
    const o = pendingDelete;
    if (!o) return true;
    const { error } = await supabase.from("area_owners").delete().eq("id", o.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    if (editingId === o.id) cancelEdit();
    toast.success(`Area owner "${o.name}" deleted`);
    void logAudit("settings.delete", "area_owner", o.id, { name: o.name });
    qc.invalidateQueries({ queryKey: ["area-owners"] });
    return true;
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <SectionHeader id="areaOwners" count={owners.length} />
      <SectionCard>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_7rem_8rem_12rem_auto] md:items-end">
          <TextField
            label="Name"
            value={name}
            onChange={setName}
            className="col-span-2 md:col-span-1"
          />
          <TextField label="Code" value={code} onChange={setCode} />
          <TextField label="Employee ID" value={employeeId} onChange={setEmployeeId} />
          <div className="col-span-2 md:col-span-1">
            <OptionalSelect
              label="Department"
              value={departmentId}
              onChange={setDepartmentId}
              items={departments}
            />
          </div>
          <div className="col-span-2 md:col-span-1">
            <SaveButtons editing={!!editingId} onSave={save} onCancel={cancelEdit} />
          </div>
        </div>
        <div className="space-y-1.5">
          {owners.map((o) => (
            <ListRow key={o.id}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {o.name}
                  {o.code && <CodeChip>{o.code}</CodeChip>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[o.employee_id, nameOf(departments, o.department_id) ?? o.department]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
              <RowActions
                name={o.name}
                onEdit={() => startEdit(o)}
                onDelete={() => setPendingDelete(o)}
              />
            </ListRow>
          ))}
          {owners.length === 0 && <EmptyRow>No area owners yet.</EmptyRow>}
        </div>
      </SectionCard>
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete area owner “${pendingDelete?.name ?? ""}”?`}
        description={
          <p>They can no longer be picked as an area owner on the Daily entry screen.</p>
        }
        confirmLabel="Delete owner"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Departments (four names are locked — see LOCKED_NAMES)
// ---------------------------------------------------------------------------
export function DepartmentsSection({
  departments,
  categories,
  lockedNames,
  qc,
}: {
  departments: Department[];
  categories: DepartmentCategory[];
  lockedNames: readonly string[];
  qc: QC;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Department | null>(null);
  const editing = departments.find((d) => d.id === editingId) ?? null;
  const editingLocked = !!editing && isLockedName(lockedNames, editing.name);
  const lockedCount = departments.filter((d) => isLockedName(lockedNames, d.name)).length;

  function startEdit(d: Department) {
    setEditingId(d.id);
    setName(d.name);
    setCode(d.code);
    setCategoryId(d.department_category_id ?? "");
  }
  function cancelEdit() {
    setEditingId(null);
    setName("");
    setCode("");
    setCategoryId("");
  }

  async function save() {
    const validationError = validateMasterDataInput(name, code);
    if (validationError) return toast.error(validationError);
    if (editingId) {
      // A locked name is never sent changed, even if the field was tampered with.
      const nextName = editingLocked && editing ? editing.name : name.trim();
      const { error } = await supabase
        .from("departments")
        .update({
          name: nextName,
          code: normalizeCode(code),
          department_category_id: categoryId || null,
        })
        .eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success(`Department "${nextName}" updated`);
      void logAudit("settings.update", "department", editingId, { name: nextName });
      cancelEdit();
    } else {
      const { error } = await supabase.from("departments").insert({
        name: name.trim(),
        code: normalizeCode(code),
        department_category_id: categoryId || null,
        display_order: departments.length + 1,
      });
      if (error) return toast.error(error.message);
      toast.success(`Department "${name}" added`);
      void logAudit("settings.create", "department", undefined, { name });
      setName("");
      setCode("");
      setCategoryId("");
    }
    qc.invalidateQueries({ queryKey: ["departments"] });
  }

  async function confirmDelete(): Promise<boolean> {
    const d = pendingDelete;
    if (!d) return true;
    const { error } = await supabase.from("departments").delete().eq("id", d.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    if (editingId === d.id) cancelEdit();
    toast.success(`Department "${d.name}" deleted`);
    void logAudit("settings.delete", "department", d.id, { name: d.name });
    qc.invalidateQueries({ queryKey: ["departments"] });
    return true;
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <SectionHeader
        id="departments"
        count={departments.length}
        description={
          <>
            Who is responsible for a downtime reason or an area owner. Each belongs to a department
            category.
            {lockedCount > 0 &&
              ` ${lockedCount} are locked because calculations look them up by name.`}
          </>
        }
      />
      <SectionCard>
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem] md:grid-cols-[1fr_7rem_14rem_auto] md:items-end">
          <TextField
            label="Name"
            value={name}
            onChange={setName}
            disabled={editingLocked}
            hint={editingLocked ? LOCKED_HINT : undefined}
          />
          <TextField label="Code" value={code} onChange={setCode} />
          <OptionalSelect
            label="Department category"
            value={categoryId}
            onChange={setCategoryId}
            items={categories}
          />
          <SaveButtons editing={!!editingId} onSave={save} onCancel={cancelEdit} />
        </div>
        <div className="space-y-1.5">
          {departments.map((d) => {
            const locked = isLockedName(lockedNames, d.name);
            return (
              <ListRow key={d.id}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {d.name}
                    <CodeChip>{d.code}</CodeChip>
                  </p>
                  <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    {nameOf(categories, d.department_category_id)}
                    {locked && <LockedTag />}
                  </p>
                </div>
                <RowActions
                  name={d.name}
                  locked={locked}
                  onEdit={() => startEdit(d)}
                  onDelete={() => setPendingDelete(d)}
                />
              </ListRow>
            );
          })}
          {departments.length === 0 && <EmptyRow>No departments yet.</EmptyRow>}
        </div>
      </SectionCard>
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete department “${pendingDelete?.name ?? ""}”?`}
        description={
          <p>
            Downtime reasons and area owners that point at it will show no department, and their
            downtime reads as “Unclassified” on the dashboards.
          </p>
        }
        confirmLabel="Delete department"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Name + code lists: department categories, downtime types, severity levels.
// Identical apart from the table, their wording and which names are locked.
// ---------------------------------------------------------------------------
type SimpleTable = "department_categories" | "downtime_types" | "severity_levels";

interface SimpleRow {
  id: string;
  name: string;
  code: string;
  display_order: number;
}

export function SimpleCodeListSection({
  sectionId,
  table,
  auditEntity,
  queryKey,
  noun,
  rows,
  lockedNames,
  deleteConsequence,
  namePlaceholder,
  qc,
}: {
  sectionId: SectionId;
  table: SimpleTable;
  auditEntity: string;
  queryKey: string;
  noun: string;
  rows: SimpleRow[];
  lockedNames: readonly string[];
  deleteConsequence: string;
  namePlaceholder?: string;
  qc: QC;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SimpleRow | null>(null);
  const editing = rows.find((r) => r.id === editingId) ?? null;
  const editingLocked = !!editing && isLockedName(lockedNames, editing.name);
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);

  function startEdit(r: SimpleRow) {
    setEditingId(r.id);
    setName(r.name);
    setCode(r.code);
  }
  function cancelEdit() {
    setEditingId(null);
    setName("");
    setCode("");
  }

  async function save() {
    const validationError = validateMasterDataInput(name, code);
    if (validationError) return toast.error(validationError);
    if (editingId) {
      const nextName = editingLocked && editing ? editing.name : name.trim();
      const { error } = await supabase
        .from(table)
        .update({ name: nextName, code: normalizeCode(code) })
        .eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success(`${Noun} "${nextName}" updated`);
      void logAudit("settings.update", auditEntity, editingId, { name: nextName });
      cancelEdit();
    } else {
      const { error } = await supabase.from(table).insert({
        name: name.trim(),
        code: normalizeCode(code),
        display_order: rows.length + 1,
      });
      if (error) return toast.error(error.message);
      toast.success(`${Noun} "${name}" added`);
      void logAudit("settings.create", auditEntity, undefined, { name });
      setName("");
      setCode("");
    }
    qc.invalidateQueries({ queryKey: [queryKey] });
  }

  async function confirmDelete(): Promise<boolean> {
    const r = pendingDelete;
    if (!r) return true;
    const { error } = await supabase.from(table).delete().eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    if (editingId === r.id) cancelEdit();
    toast.success(`${Noun} "${r.name}" deleted`);
    void logAudit("settings.delete", auditEntity, r.id, { name: r.name });
    qc.invalidateQueries({ queryKey: [queryKey] });
    return true;
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <SectionHeader id={sectionId} count={rows.length} />
      <SectionCard>
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem_auto] sm:items-end">
          <TextField
            label="Name"
            value={name}
            onChange={setName}
            placeholder={namePlaceholder}
            disabled={editingLocked}
            hint={editingLocked ? LOCKED_HINT : undefined}
          />
          <TextField label="Code" value={code} onChange={setCode} />
          <SaveButtons editing={!!editingId} onSave={save} onCancel={cancelEdit} />
        </div>
        <div className="space-y-1.5">
          {rows.map((r) => {
            const locked = isLockedName(lockedNames, r.name);
            return (
              <ListRow key={r.id}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {r.name}
                    <CodeChip>{r.code}</CodeChip>
                  </p>
                  {locked && <LockedTag />}
                </div>
                <RowActions
                  name={r.name}
                  locked={locked}
                  onEdit={() => startEdit(r)}
                  onDelete={() => setPendingDelete(r)}
                />
              </ListRow>
            );
          })}
          {rows.length === 0 && <EmptyRow>Nothing here yet.</EmptyRow>}
        </div>
      </SectionCard>
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete ${noun} “${pendingDelete?.name ?? ""}”?`}
        description={<p>{deleteConsequence}</p>}
        confirmLabel={`Delete ${noun}`}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root causes — code optional, name case-insensitively unique (see
// 20260909120000_root_causes.sql). Deleting one un-classifies the events that
// used it (ON DELETE SET NULL) rather than touching them otherwise.
// ---------------------------------------------------------------------------
export function RootCausesSection({ rootCauses, qc }: { rootCauses: RootCause[]; qc: QC }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RootCause | null>(null);

  function startEdit(r: RootCause) {
    setEditingId(r.id);
    setName(r.name);
    setCode(r.code ?? "");
  }
  function cancelEdit() {
    setEditingId(null);
    setName("");
    setCode("");
  }

  // Postgres unique_violation — root_causes_name_key (lower(name)) or
  // root_causes_code_key (lower(code), only enforced when code is set).
  function friendlyError(error: { code?: string; message: string }): string {
    if (error.code === "23505") {
      if (error.message.includes("root_causes_name_key")) {
        return `A root cause named "${name.trim()}" already exists (names are case-insensitive).`;
      }
      if (error.message.includes("root_causes_code_key")) {
        return `Code "${code.trim()}" is already used by another root cause.`;
      }
    }
    return error.message;
  }

  async function save() {
    if (!name.trim()) return toast.error("Name is required");
    const codeValue = code.trim() ? normalizeCode(code) : null;
    if (editingId) {
      const { error } = await supabase
        .from("root_causes")
        .update({ name: name.trim(), code: codeValue })
        .eq("id", editingId);
      if (error) return toast.error(friendlyError(error));
      toast.success(`Root cause "${name}" updated`);
      void logAudit("settings.update", "root_cause", editingId, { name });
      cancelEdit();
    } else {
      const { error } = await supabase.from("root_causes").insert({
        name: name.trim(),
        code: codeValue,
        sort_order: rootCauses.length + 1,
      });
      if (error) return toast.error(friendlyError(error));
      toast.success(`Root cause "${name}" added`);
      void logAudit("settings.create", "root_cause", undefined, { name });
      setName("");
      setCode("");
    }
    qc.invalidateQueries({ queryKey: ["root-causes"] });
  }

  async function confirmDelete(): Promise<boolean> {
    const r = pendingDelete;
    if (!r) return true;
    const { error } = await supabase.from("root_causes").delete().eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    if (editingId === r.id) cancelEdit();
    toast.success(`Root cause "${r.name}" deleted`);
    void logAudit("settings.delete", "root_cause", r.id, { name: r.name });
    qc.invalidateQueries({ queryKey: ["root-causes"] });
    return true;
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <SectionHeader id="rootCauses" count={rootCauses.length} />
      <SectionCard>
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
          <TextField label="Name" value={name} onChange={setName} />
          <TextField label="Code (optional)" value={code} onChange={setCode} />
          <SaveButtons editing={!!editingId} onSave={save} onCancel={cancelEdit} />
        </div>
        <div className="space-y-1.5">
          {rootCauses.map((r) => (
            <ListRow key={r.id}>
              <span className="flex min-w-0 flex-wrap items-center gap-2 font-medium">
                {r.name}
                {r.code && <CodeChip>{r.code}</CodeChip>}
                {!r.is_active && <InactiveChip />}
              </span>
              <RowActions
                name={r.name}
                onEdit={() => startEdit(r)}
                onDelete={() => setPendingDelete(r)}
              />
            </ListRow>
          ))}
          {rootCauses.length === 0 && <EmptyRow>No root causes yet.</EmptyRow>}
        </div>
      </SectionCard>
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete root cause “${pendingDelete?.name ?? ""}”?`}
        description={
          <p>
            Events already classified with it keep their full history — they just become
            unclassified again, as if no cause had been picked.
          </p>
        }
        confirmLabel="Delete root cause"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
