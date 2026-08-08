import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ALL_ROLES, ROLE_LABELS, type Role } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/lib/auth-context";
import { requireSession } from "@/lib/require-session";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  linesQuery,
  reasonsQuery,
  fieldsQuery,
  productionAreasQuery,
  areaOwnersQuery,
  departmentsQuery,
  downtimeTypesQuery,
  severityLevelsQuery,
  departmentCategoriesQuery,
  techniciansQuery,
  type Technician,
} from "@/lib/queries";

// Shared validation for every master-data add-form (Lines, Areas, Owners, Reasons,
// Departments, Downtime Types, Severity Levels). New records require both a name
// and a business code; codes are normalized so ERP exports/reporting never see
// inconsistent casing or stray whitespace. Existing rows are unaffected — this
// only runs on create.
function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function validateMasterDataInput(name: string, code: string): string | null {
  if (!name.trim()) return "Name is required";
  if (!code.trim()) return "Code is required";
  return null;
}

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings · Production Scorecard" }] }),
  beforeLoad: requireSession,
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(linesQuery),
      context.queryClient.ensureQueryData(reasonsQuery),
      context.queryClient.ensureQueryData(productionAreasQuery),
      context.queryClient.ensureQueryData(areaOwnersQuery),
      context.queryClient.ensureQueryData(departmentsQuery),
      context.queryClient.ensureQueryData(downtimeTypesQuery),
      context.queryClient.ensureQueryData(severityLevelsQuery),
      context.queryClient.ensureQueryData(departmentCategoriesQuery),
      context.queryClient.ensureQueryData(techniciansQuery),
    ]),
  component: () => (
    <RequireAuth requirePermission="settings.manage">
      <SettingsPage />
    </RequireAuth>
  ),
});

function SettingsPage() {
  const { data: lines } = useSuspenseQuery(linesQuery);
  const { data: reasons } = useSuspenseQuery(reasonsQuery);
  const { data: productionAreas } = useSuspenseQuery(productionAreasQuery);
  const { data: areaOwners } = useSuspenseQuery(areaOwnersQuery);
  const { data: departments } = useSuspenseQuery(departmentsQuery);
  const { data: downtimeTypes } = useSuspenseQuery(downtimeTypesQuery);
  const { data: severityLevels } = useSuspenseQuery(severityLevelsQuery);
  const { data: departmentCategories } = useSuspenseQuery(departmentCategoriesQuery);
  const { data: technicians } = useSuspenseQuery(techniciansQuery);
  const { data: users = [] } = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").order("email");
      if (error) throw error;
      return data;
    },
  });
  const qc = useQueryClient();
  const [selectedLine, setSelectedLine] = useState(lines[0]?.id ?? "");

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage production lines, custom fields, downtime reasons, production areas, area owners,
          department categories, departments, downtime types, severity levels, and technicians.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LinesCard lines={lines} qc={qc} onSelect={setSelectedLine} selected={selectedLine} />
        <ReasonsCard
          reasons={reasons}
          productionAreas={productionAreas}
          departments={departments}
          downtimeTypes={downtimeTypes}
          severityLevels={severityLevels}
          qc={qc}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ProductionAreasCard areas={productionAreas} qc={qc} />
        <AreaOwnersCard owners={areaOwners} departments={departments} qc={qc} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DepartmentCategoriesCard categories={departmentCategories} qc={qc} />
        <DepartmentsCard departments={departments} categories={departmentCategories} qc={qc} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DowntimeTypesCard downtimeTypes={downtimeTypes} qc={qc} />
        <SeverityLevelsCard severityLevels={severityLevels} qc={qc} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <UsersCard users={users} qc={qc} />
        <TechniciansCard technicians={technicians} qc={qc} />
      </div>

      {selectedLine && (
        <div className="mt-6">
          <FieldsCard lineId={selectedLine} qc={qc} />
        </div>
      )}

      <div className="mt-6">
        <BackupCard qc={qc} />
      </div>
    </AppShell>
  );
}

function UsersCard({
  users,
  qc,
}: {
  users: { id: string; email: string; display_name: string | null; role: string }[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const { user: currentUser } = useAuth();

  async function changeRole(userId: string, role: Role) {
    const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
    if (error) return toast.error(error.message);
    toast.success("Role updated");
    qc.invalidateQueries({ queryKey: ["profiles"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>
          Manage who can access the system and what they can do. New sign-ups start as Viewer until
          promoted here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex flex-col gap-2 rounded-md border border-border p-2 text-sm md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{u.display_name || u.email}</p>
                <p className="truncate text-xs text-muted-foreground">{u.email}</p>
              </div>
              <Select
                value={u.role}
                onValueChange={(v) => changeRole(u.id, v as Role)}
                disabled={u.id === currentUser?.id}
              >
                <SelectTrigger className="w-full md:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          {users.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">No users yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// role/department are DB CHECK-constrained (see
// 20260809120000_technicians.sql) rather than driven by a master-data
// table like Departments above — there's no expectation of adding a fifth
// role or department without a migration, so a fixed list here is fine.
const TECHNICIAN_ROLES = ["Technician", "Engineer", "Supervisor", "Operator"] as const;
const TECHNICIAN_DEPARTMENTS = ["Mechanical", "Electrical", "Production"] as const;

function TechniciansCard({
  technicians,
  qc,
}: {
  technicians: Technician[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Technician | null>(null);

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(t: Technician) {
    setEditing(t);
    setDialogOpen(true);
  }

  async function del(t: Technician) {
    if (!confirm(`Delete technician "${t.name}"? Existing events keep their assignment as a name-less id.`)) return;
    const { error } = await supabase.from("technicians").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    toast.success(`Technician "${t.name}" deleted`);
    void logAudit("settings.delete", "technician", t.id, { name: t.name });
    qc.invalidateQueries({ queryKey: ["technicians"] });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Technicians</CardTitle>
            <CardDescription>
              Maintenance staff assignable to events on the Maintenance page. Only active
              technicians can be newly assigned.
            </CardDescription>
          </div>
          <Button size="sm" onClick={openAdd}>
            <Plus className="mr-1 h-4 w-4" />
            Add Technician
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {technicians.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
            >
              <div>
                <p className="flex items-center gap-2 font-medium">
                  {t.name}
                  {!t.is_active && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      Inactive
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[t.role, t.department].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => openEdit(t)}>
                  <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => del(t)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </div>
          ))}
          {technicians.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">No technicians yet.</p>
          )}
        </div>
      </CardContent>
      <TechnicianDialog open={dialogOpen} onOpenChange={setDialogOpen} technician={editing} qc={qc} />
    </Card>
  );
}

function TechnicianDialog({
  open,
  onOpenChange,
  technician,
  qc,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  technician: Technician | null;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const isEditing = !!technician;
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("");
  const [department, setDepartment] = useState<string>("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Re-seed the form whenever a different technician is opened for editing,
  // or the dialog is opened fresh for "Add" (technician === null) — keyed
  // on id (not the whole object) so a background refetch while open
  // doesn't clobber in-progress edits, same reasoning as EventDetailDialog.
  useEffect(() => {
    if (!open) return;
    setName(technician?.name ?? "");
    setRole(technician?.role ?? "");
    setDepartment(technician?.department ?? "");
    setIsActive(technician?.is_active ?? true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, technician?.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Name is required");
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        role: role || null,
        department: department || null,
        is_active: isActive,
      };
      if (isEditing) {
        const { error } = await supabase.from("technicians").update(payload).eq("id", technician.id);
        if (error) throw error;
        toast.success(`Technician "${name}" updated`);
        void logAudit("settings.update", "technician", technician.id, { name });
      } else {
        const { error } = await supabase.from("technicians").insert(payload);
        if (error) throw error;
        toast.success(`Technician "${name}" added`);
        void logAudit("settings.create", "technician", undefined, { name });
      }
      qc.invalidateQueries({ queryKey: ["technicians"] });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save technician");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Technician" : "Add Technician"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update this technician's details, or deactivate them without deleting their history."
              : "Add a new maintenance staff member, assignable to events once saved."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Role (optional)</Label>
              <Select value={role || "none"} onValueChange={(v) => setRole(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {TECHNICIAN_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Department (optional)</Label>
              <Select value={department || "none"} onValueChange={(v) => setDepartment(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {TECHNICIAN_DEPARTMENTS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <Label className="text-sm">Active</Label>
              <p className="text-xs text-muted-foreground">Inactive technicians can't be newly assigned to events.</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : isEditing ? "Update" : "Add Technician"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const BACKUP_TABLES = [
  "production_lines",
  "production_areas",
  "area_owners",
  "downtime_reasons",
  "departments",
  "department_categories",
  "downtime_types",
  "severity_levels",
  "line_field_definitions",
] as const;

function BackupCard({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const payload: Record<string, unknown> = {
        exported_at: new Date().toISOString(),
        version: 1,
      };
      for (const table of BACKUP_TABLES) {
        const { data, error } = await supabase.from(table).select("*");
        if (error) throw error;
        payload[table] = data;
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `production-scorecard-settings-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Settings exported");
      void logAudit("settings.export", "backup");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (
      !confirm(
        "Importing will add any master-data rows from this file that don't already exist (matched by id). Existing rows with the same id will be updated. Continue?",
      )
    )
      return;
    setImporting(true);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      let totalRows = 0;
      for (const table of BACKUP_TABLES) {
        const rows = payload[table];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });
        if (error) throw error;
        totalRows += rows.length;
      }
      toast.success(`Settings imported (${totalRows} rows)`);
      void logAudit("settings.import", "backup", undefined, { totalRows });
      for (const key of [
        "lines",
        "reasons",
        "production-areas",
        "area-owners",
        "departments",
        "department-categories",
        "downtime-types",
        "severity-levels",
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Import failed — check the file is a valid export from this app.",
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backup &amp; Restore</CardTitle>
        <CardDescription>
          Export all master data (Lines, Areas, Owners, Reasons, Departments, Types, Severity
          Levels, Custom Fields) to a file, or restore it on a new device.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={handleExport} disabled={exporting}>
          {exporting ? "Exporting…" : "Export Settings"}
        </Button>
        <label
          className={`inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground ${importing ? "pointer-events-none opacity-50" : ""}`}
        >
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleImport}
            disabled={importing}
          />
          {importing ? "Importing…" : "Import Settings"}
        </label>
      </CardContent>
    </Card>
  );
}

function LinesCard({
  lines,
  qc,
  selected,
  onSelect,
}: {
  lines: { id: string; name: string; code: string | null; color: string }[];
  qc: ReturnType<typeof useQueryClient>;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [color, setColor] = useState("#0ea5e9");
  const [editingId, setEditingId] = useState<string | null>(null);

  function startEdit(l: { id: string; name: string; code: string | null; color: string }) {
    setEditingId(l.id);
    setName(l.name);
    setCode(l.code ?? "");
    setColor(l.color);
  }
  function cancelEdit() {
    setEditingId(null);
    setName("");
    setCode("");
    setColor("#0ea5e9");
  }

  async function saveLine() {
    const validationError = validateMasterDataInput(name, code);
    if (validationError) return toast.error(validationError);
    if (editingId) {
      const { error } = await supabase
        .from("production_lines")
        .update({ name: name.trim(), code: normalizeCode(code), color })
        .eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success(`Line "${name}" updated`);
      void logAudit("settings.update", "production_line", editingId, { name });
      cancelEdit();
    } else {
      const { error } = await supabase.from("production_lines").insert({
        name: name.trim(),
        code: normalizeCode(code),
        color,
        sort_order: lines.length + 1,
      });
      if (error) return toast.error(error.message);
      toast.success(`Line "${name}" added`);
      void logAudit("settings.create", "production_line", undefined, { name });
      setName("");
      setCode("");
    }
    qc.invalidateQueries({ queryKey: ["lines"] });
  }
  async function delLine(id: string) {
    if (!confirm("Delete this line and all its entries?")) return;
    const { error } = await supabase.from("production_lines").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (editingId === id) cancelEdit();
    qc.invalidateQueries({ queryKey: ["lines"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Production Lines</CardTitle>
        <CardDescription>
          Add unlimited lines. Click a line to manage its custom fields.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex gap-2">
          <Input
            placeholder="Line name (e.g. Marshmallow)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder="Code (e.g. MSH)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-28"
          />
          <Input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-10 w-16 p-1"
          />
          <Button onClick={saveLine}>
            {editingId ? (
              "Update"
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" />
                Add
              </>
            )}
          </Button>
          {editingId && (
            <Button variant="ghost" onClick={cancelEdit}>
              Cancel
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {lines.map((l) => (
            <div
              key={l.id}
              onClick={() => onSelect(l.id)}
              className={`flex w-full cursor-pointer items-center justify-between rounded-lg border p-3 text-left transition-colors ${selected === l.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
            >
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded" style={{ background: l.color }} />
                <span className="font-medium">{l.name}</span>
                {l.code && (
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {l.code}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Pencil
                  className="h-4 w-4 text-muted-foreground hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    startEdit(l);
                  }}
                />
                <Trash2
                  className="h-4 w-4 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    delLine(l.id);
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ReasonsCard({
  reasons,
  productionAreas,
  departments,
  downtimeTypes,
  severityLevels,
  qc,
}: {
  reasons: {
    id: string;
    name: string;
    code: string | null;
    area: string;
    production_area_id: string | null;
    department_id: string | null;
    downtime_type_id: string | null;
    severity_id: string | null;
  }[];
  productionAreas: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  downtimeTypes: { id: string; name: string }[];
  severityLevels: { id: string; name: string }[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [area, setArea] = useState("General");
  const [productionAreaId, setProductionAreaId] = useState<string>("");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [downtimeTypeId, setDowntimeTypeId] = useState<string>("");
  const [severityId, setSeverityId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);

  function nameOf(list: { id: string; name: string }[], id: string | null) {
    return id ? list.find((x) => x.id === id)?.name : undefined;
  }

  function startEdit(r: {
    id: string;
    name: string;
    code: string | null;
    area: string;
    production_area_id: string | null;
    department_id: string | null;
    downtime_type_id: string | null;
    severity_id: string | null;
  }) {
    setEditingId(r.id);
    setName(r.name);
    setCode(r.code ?? "");
    setArea(r.area);
    setProductionAreaId(r.production_area_id ?? "");
    setDepartmentId(r.department_id ?? "");
    setDowntimeTypeId(r.downtime_type_id ?? "");
    setSeverityId(r.severity_id ?? "");
  }
  function cancelEdit() {
    setEditingId(null);
    setName("");
    setCode("");
    setArea("General");
    setProductionAreaId("");
    setDepartmentId("");
    setDowntimeTypeId("");
    setSeverityId("");
  }

  async function save() {
    const validationError = validateMasterDataInput(name, code);
    if (validationError) return toast.error(validationError);
    const payload = {
      name: name.trim(),
      code: normalizeCode(code),
      area,
      production_area_id: productionAreaId || null,
      department_id: departmentId || null,
      downtime_type_id: downtimeTypeId || null,
      severity_id: severityId || null,
    };
    if (editingId) {
      const { error } = await supabase.from("downtime_reasons").update(payload).eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success(`Downtime reason "${name}" updated`);
      void logAudit("settings.update", "downtime_reason", editingId, { name });
      cancelEdit();
    } else {
      const { error } = await supabase.from("downtime_reasons").insert(payload);
      if (error) return toast.error(error.message);
      toast.success(`Downtime reason "${name}" added`);
      void logAudit("settings.create", "downtime_reason", undefined, { name });
      setName("");
      setCode("");
      setProductionAreaId("");
      setDepartmentId("");
      setDowntimeTypeId("");
      setSeverityId("");
    }
    qc.invalidateQueries({ queryKey: ["reasons"] });
  }
  async function del(id: string) {
    const { error } = await supabase.from("downtime_reasons").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (editingId === id) cancelEdit();
    qc.invalidateQueries({ queryKey: ["reasons"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Downtime Reasons</CardTitle>
        <CardDescription>Shared library across all production lines.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Input placeholder="Reason name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            placeholder="Code (e.g. CND-DLY)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Input
            placeholder="Area (legacy text)"
            value={area}
            onChange={(e) => setArea(e.target.value)}
          />
          <Button onClick={save}>
            {editingId ? (
              "Update"
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" />
                Add
              </>
            )}
          </Button>
        </div>
        {editingId && (
          <div className="mb-2">
            <Button size="sm" variant="ghost" onClick={cancelEdit}>
              Cancel edit
            </Button>
          </div>
        )}
        <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-4">
          <Select value={productionAreaId} onValueChange={setProductionAreaId}>
            <SelectTrigger>
              <SelectValue placeholder="Production Area (optional)" />
            </SelectTrigger>
            <SelectContent>
              {productionAreas.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger>
              <SelectValue placeholder="Department (optional)" />
            </SelectTrigger>
            <SelectContent>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={downtimeTypeId} onValueChange={setDowntimeTypeId}>
            <SelectTrigger>
              <SelectValue placeholder="Planned / Unplanned (optional)" />
            </SelectTrigger>
            <SelectContent>
              {downtimeTypes.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={severityId} onValueChange={setSeverityId}>
            <SelectTrigger>
              <SelectValue placeholder="Severity (optional)" />
            </SelectTrigger>
            <SelectContent>
              {severityLevels.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="max-h-80 space-y-1.5 overflow-auto">
          {reasons.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
            >
              <div>
                <p className="font-medium">
                  {r.name}
                  {r.code && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {r.code}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    nameOf(productionAreas, r.production_area_id) ?? r.area,
                    nameOf(departments, r.department_id),
                    nameOf(downtimeTypes, r.downtime_type_id),
                    nameOf(severityLevels, r.severity_id),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => startEdit(r)}>
                  <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => del(r.id)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ProductionAreasCard({
  areas,
  qc,
}: {
  areas: {
    id: string;
    name: string;
    code: string | null;
    display_order: number;
    is_active: boolean;
  }[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  function startEdit(a: { id: string; name: string; code: string | null }) {
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
  async function del(id: string) {
    if (
      !confirm(
        "Delete this production area? Existing owner assignments for it will also be removed.",
      )
    )
      return;
    const { error } = await supabase.from("production_areas").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (editingId === id) cancelEdit();
    qc.invalidateQueries({ queryKey: ["production-areas"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Production Areas</CardTitle>
        <CardDescription>
          Add unlimited areas (e.g. Cooking, Making, Packing, Coating). Each active area gets its
          own Area Owner selector on the Entry screen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex gap-2">
          <Input
            placeholder="Area name (e.g. Coating)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder="Code (e.g. CT)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-28"
          />
          <Button onClick={save}>
            {editingId ? (
              "Update"
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" />
                Add
              </>
            )}
          </Button>
          {editingId && (
            <Button variant="ghost" onClick={cancelEdit}>
              Cancel
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {areas.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-lg border border-border p-3"
            >
              <span className="flex items-center gap-2 font-medium">
                {a.name}
                {a.code && (
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {a.code}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-3">
                <Pencil
                  className="h-4 w-4 text-muted-foreground hover:text-primary"
                  onClick={() => startEdit(a)}
                />
                <Trash2
                  className="h-4 w-4 text-muted-foreground hover:text-destructive"
                  onClick={() => del(a.id)}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AreaOwnersCard({
  owners,
  departments,
  qc,
}: {
  owners: {
    id: string;
    name: string;
    code: string | null;
    employee_id: string | null;
    department: string | null;
    department_id: string | null;
    is_active: boolean;
  }[];
  departments: { id: string; name: string }[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);

  function nameOf(list: { id: string; name: string }[], id: string | null) {
    return id ? list.find((x) => x.id === id)?.name : undefined;
  }

  function startEdit(o: {
    id: string;
    name: string;
    code: string | null;
    employee_id: string | null;
    department_id: string | null;
  }) {
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
  async function del(id: string) {
    const { error } = await supabase.from("area_owners").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (editingId === id) cancelEdit();
    qc.invalidateQueries({ queryKey: ["area-owners"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Area Owners</CardTitle>
        <CardDescription>
          Master list of people who can be assigned as the owner of a production area on an entry.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Input
            placeholder="Employee ID"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          />
          <Button onClick={save}>
            {editingId ? (
              "Update"
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" />
                Add
              </>
            )}
          </Button>
        </div>
        {editingId && (
          <div className="mb-2">
            <Button size="sm" variant="ghost" onClick={cancelEdit}>
              Cancel edit
            </Button>
          </div>
        )}
        <div className="mb-4">
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger>
              <SelectValue placeholder="Department (optional)" />
            </SelectTrigger>
            <SelectContent>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="max-h-80 space-y-1.5 overflow-auto">
          {owners.map((o) => (
            <div
              key={o.id}
              className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
            >
              <div>
                <p className="font-medium">
                  {o.name}
                  {o.code && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {o.code}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[o.employee_id, nameOf(departments, o.department_id) ?? o.department]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => startEdit(o)}>
                  <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => del(o.id)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DepartmentCategoriesCard({
  categories,
  qc,
}: {
  categories: { id: string; name: string; code: string; display_order: number }[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  function startEdit(c: { id: string; name: string; code: string }) {
    setEditingId(c.id);
    setName(c.name);
    setCode(c.code);
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
        .from("department_categories")
        .update({ name: name.trim(), code: normalizeCode(code) })
        .eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success(`Department category "${name}" updated`);
      void logAudit("settings.update", "department_category", editingId, { name });
      cancelEdit();
    } else {
      const { error } = await supabase.from("department_categories").insert({
        name: name.trim(),
        code: normalizeCode(code),
        display_order: categories.length + 1,
      });
      if (error) return toast.error(error.message);
      toast.success(`Department category "${name}" added`);
      void logAudit("settings.create", "department_category", undefined, { name });
      setName("");
      setCode("");
    }
    qc.invalidateQueries({ queryKey: ["department-categories"] });
  }
  async function del(id: string) {
    const { error } = await supabase.from("department_categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (editingId === id) cancelEdit();
    qc.invalidateQueries({ queryKey: ["department-categories"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Department Categories</CardTitle>
        <CardDescription>
          Dashboards filter by category (e.g. Maintenance), never by individual department name —
          new departments join a category and appear automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex gap-2">
          <Input
            placeholder="Name (e.g. Maintenance)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-24"
          />
          <Button size="icon" onClick={save}>
            {editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </Button>
          {editingId && (
            <Button size="sm" variant="ghost" onClick={cancelEdit}>
              Cancel
            </Button>
          )}
        </div>
        <div className="space-y-1.5">
          {categories.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
            >
              <span className="flex items-center gap-2 font-medium">
                {c.name}
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {c.code}
                </span>
              </span>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => startEdit(c)}>
                  <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => del(c.id)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DepartmentsCard({
  departments,
  categories,
  qc,
}: {
  departments: {
    id: string;
    name: string;
    code: string;
    display_order: number;
    department_category_id: string | null;
  }[];
  categories: { id: string; name: string }[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);

  function nameOf(list: { id: string; name: string }[], id: string | null) {
    return id ? list.find((x) => x.id === id)?.name : undefined;
  }

  function startEdit(d: {
    id: string;
    name: string;
    code: string;
    department_category_id: string | null;
  }) {
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
      const { error } = await supabase
        .from("departments")
        .update({
          name: name.trim(),
          code: normalizeCode(code),
          department_category_id: categoryId || null,
        })
        .eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success(`Department "${name}" updated`);
      void logAudit("settings.update", "department", editingId, { name });
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
  async function del(id: string) {
    const { error } = await supabase.from("departments").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (editingId === id) cancelEdit();
    qc.invalidateQueries({ queryKey: ["departments"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Departments</CardTitle>
        <CardDescription>
          Responsible department for downtime reasons and area owners (e.g. Mechanical Maintenance).
          Each belongs to a Department Category.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-2 flex gap-2">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            placeholder="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-24"
          />
          <Button size="icon" onClick={save}>
            {editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </Button>
          {editingId && (
            <Button size="sm" variant="ghost" onClick={cancelEdit}>
              Cancel
            </Button>
          )}
        </div>
        <div className="mb-4">
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger>
              <SelectValue placeholder="Department Category (optional)" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          {departments.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
            >
              <div>
                <span className="flex items-center gap-2 font-medium">
                  {d.name}
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {d.code}
                  </span>
                </span>
                {nameOf(categories, d.department_category_id) && (
                  <p className="text-xs text-muted-foreground">
                    {nameOf(categories, d.department_category_id)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => startEdit(d)}>
                  <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => del(d.id)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DowntimeTypesCard({
  downtimeTypes,
  qc,
}: {
  downtimeTypes: { id: string; name: string; code: string; display_order: number }[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  function startEdit(t: { id: string; name: string; code: string }) {
    setEditingId(t.id);
    setName(t.name);
    setCode(t.code);
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
        .from("downtime_types")
        .update({ name: name.trim(), code: normalizeCode(code) })
        .eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success(`Downtime type "${name}" updated`);
      void logAudit("settings.update", "downtime_type", editingId, { name });
      cancelEdit();
    } else {
      const { error } = await supabase.from("downtime_types").insert({
        name: name.trim(),
        code: normalizeCode(code),
        display_order: downtimeTypes.length + 1,
      });
      if (error) return toast.error(error.message);
      toast.success(`Downtime type "${name}" added`);
      void logAudit("settings.create", "downtime_type", undefined, { name });
      setName("");
      setCode("");
    }
    qc.invalidateQueries({ queryKey: ["downtime-types"] });
  }
  async function del(id: string) {
    const { error } = await supabase.from("downtime_types").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (editingId === id) cancelEdit();
    qc.invalidateQueries({ queryKey: ["downtime-types"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Downtime Types</CardTitle>
        <CardDescription>Planned vs Unplanned classification for downtime reasons.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex gap-2">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            placeholder="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-24"
          />
          <Button size="icon" onClick={save}>
            {editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </Button>
          {editingId && (
            <Button size="sm" variant="ghost" onClick={cancelEdit}>
              Cancel
            </Button>
          )}
        </div>
        <div className="space-y-1.5">
          {downtimeTypes.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
            >
              <span className="flex items-center gap-2 font-medium">
                {t.name}
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {t.code}
                </span>
              </span>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => startEdit(t)}>
                  <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => del(t.id)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SeverityLevelsCard({
  severityLevels,
  qc,
}: {
  severityLevels: { id: string; name: string; code: string; display_order: number }[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  function startEdit(s: { id: string; name: string; code: string }) {
    setEditingId(s.id);
    setName(s.name);
    setCode(s.code);
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
        .from("severity_levels")
        .update({ name: name.trim(), code: normalizeCode(code) })
        .eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success(`Severity level "${name}" updated`);
      void logAudit("settings.update", "severity_level", editingId, { name });
      cancelEdit();
    } else {
      const { error } = await supabase.from("severity_levels").insert({
        name: name.trim(),
        code: normalizeCode(code),
        display_order: severityLevels.length + 1,
      });
      if (error) return toast.error(error.message);
      toast.success(`Severity level "${name}" added`);
      void logAudit("settings.create", "severity_level", undefined, { name });
      setName("");
      setCode("");
    }
    qc.invalidateQueries({ queryKey: ["severity-levels"] });
  }
  async function del(id: string) {
    const { error } = await supabase.from("severity_levels").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (editingId === id) cancelEdit();
    qc.invalidateQueries({ queryKey: ["severity-levels"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Severity Levels</CardTitle>
        <CardDescription>
          Used for Pareto prioritization and future risk/executive dashboards. Colors are a UI
          concern, not stored here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex gap-2">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            placeholder="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-24"
          />
          <Button size="icon" onClick={save}>
            {editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </Button>
          {editingId && (
            <Button size="sm" variant="ghost" onClick={cancelEdit}>
              Cancel
            </Button>
          )}
        </div>
        <div className="space-y-1.5">
          {severityLevels.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
            >
              <span className="flex items-center gap-2 font-medium">
                {s.name}
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {s.code}
                </span>
              </span>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => startEdit(s)}>
                  <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => del(s.id)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FieldsCard({ lineId, qc }: { lineId: string; qc: ReturnType<typeof useQueryClient> }) {
  const { data: fields = [] } = useQuery(fieldsQuery(lineId));
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [section, setSection] = useState<"making" | "packing" | "downtime" | "rework" | "extra">(
    "extra",
  );
  const [unit, setUnit] = useState("kg");

  async function add() {
    if (!key.trim() || !label.trim()) return toast.error("Key and label required");
    const { error } = await supabase.from("line_field_definitions").insert({
      line_id: lineId,
      field_key: key.trim().toLowerCase().replace(/\s+/g, "_"),
      label: label.trim(),
      section,
      unit,
      sort_order: fields.length + 1,
    });
    if (error) return toast.error(error.message);
    toast.success(`Field "${label}" added`);
    void logAudit("settings.create", "line_field_definition", undefined, { label });
    setKey("");
    setLabel("");
    qc.invalidateQueries({ queryKey: ["fields", lineId] });
  }
  async function del(id: string) {
    const { error } = await supabase.from("line_field_definitions").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["fields", lineId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom Fields for Selected Line</CardTitle>
        <CardDescription>
          Add fields beyond the standard schema (e.g. Cooking Brix, Mogul speed). They'll appear in
          the entry form.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
          <Input
            placeholder="Key (cooking_brix)"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <Input
            placeholder="Label (Cooking Brix)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Select value={section} onValueChange={(v) => setSection(v as typeof section)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="making">Making</SelectItem>
              <SelectItem value="packing">Packing</SelectItem>
              <SelectItem value="downtime">Downtime</SelectItem>
              <SelectItem value="rework">Rework</SelectItem>
              <SelectItem value="extra">Extra</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <Button onClick={add}>
            <Plus className="mr-1 h-4 w-4" />
            Add
          </Button>
        </div>
        {fields.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
            No custom fields yet for this line.
          </p>
        ) : (
          <div className="space-y-1.5">
            {fields.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {f.label} <span className="text-xs text-muted-foreground">({f.field_key})</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {f.section} · {f.unit}
                  </p>
                </div>
                <Button size="icon" variant="ghost" onClick={() => del(f.id)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
