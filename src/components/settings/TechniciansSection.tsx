import { useEffect, useId, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import type { Technician } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { ConfirmDialog, IconButton, InactiveChip, ListRow, SectionHeader, type QC } from "./shared";

// role/department are DB CHECK-constrained (see 20260809120000_technicians.sql)
// rather than driven by a master-data table — a fixed list here is fine.
const TECHNICIAN_ROLES = ["Technician", "Engineer", "Supervisor", "Operator"] as const;
const TECHNICIAN_DEPARTMENTS = ["Mechanical", "Electrical", "Production"] as const;

export function TechniciansSection({ technicians, qc }: { technicians: Technician[]; qc: QC }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Technician | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Technician | null>(null);
  const activeCount = technicians.filter((t) => t.is_active).length;

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(t: Technician) {
    setEditing(t);
    setDialogOpen(true);
  }

  async function confirmDelete(): Promise<boolean> {
    const t = pendingDelete;
    if (!t) return true;
    const { error } = await supabase.from("technicians").delete().eq("id", t.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success(`Technician "${t.name}" deleted`);
    void logAudit("settings.delete", "technician", t.id, { name: t.name });
    qc.invalidateQueries({ queryKey: ["technicians"] });
    return true;
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <SectionHeader
        id="technicians"
        count={technicians.length}
        description={`Maintenance staff you can assign to events. ${activeCount} active — only active technicians can be newly assigned.`}
        action={
          <Button onClick={openAdd} className="h-11 w-full px-4 sm:w-auto">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add technician
          </Button>
        }
      />
      <Card>
        <CardContent className="space-y-1.5 p-4 md:p-6">
          {technicians.map((t) => (
            <ListRow key={t.id}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {t.name}
                  {!t.is_active && <InactiveChip />}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[t.role, t.department].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IconButton icon={Pencil} label={`Edit ${t.name}`} onClick={() => openEdit(t)} />
                <IconButton
                  icon={Trash2}
                  tone="destructive"
                  label={`Delete ${t.name}`}
                  onClick={() => setPendingDelete(t)}
                />
              </div>
            </ListRow>
          ))}
          {technicians.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">No technicians yet.</p>
          )}
        </CardContent>
      </Card>
      <TechnicianDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        technician={editing}
        qc={qc}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete technician “${pendingDelete?.name ?? ""}”?`}
        description={
          <p>
            Events they were assigned to keep the assignment, but without a name. To keep their name
            on past events, edit them and switch off Active instead.
          </p>
        }
        confirmLabel="Delete technician"
        onConfirm={confirmDelete}
      />
    </div>
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
  qc: QC;
}) {
  const isEditing = !!technician;
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("");
  const [department, setDepartment] = useState<string>("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const ids = { name: useId(), role: useId(), dep: useId(), active: useId() };

  // Re-seed on open / for a different technician — keyed on id so a background
  // refetch while open doesn't clobber in-progress edits.
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
        role: (role || null) as Technician["role"],
        department: (department || null) as Technician["department"],
        is_active: isActive,
      };
      if (isEditing) {
        const { error } = await supabase
          .from("technicians")
          .update(payload)
          .eq("id", technician.id);
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
      <DialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-left">
            {isEditing ? `Edit “${technician.name}”` : "Add technician"}
          </DialogTitle>
          <DialogDescription className="text-left">
            {isEditing
              ? "Update this technician’s details, or switch them off without deleting their history."
              : "Add a maintenance staff member. They can be assigned to events once saved."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={ids.name}>Name</Label>
            <Input
              id={ids.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="h-11 md:h-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={ids.role}>Role (optional)</Label>
              <Select value={role || "none"} onValueChange={(v) => setRole(v === "none" ? "" : v)}>
                <SelectTrigger id={ids.role} className="h-11 md:h-9">
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
            <div className="space-y-1.5">
              <Label htmlFor={ids.dep}>Department (optional)</Label>
              <Select
                value={department || "none"}
                onValueChange={(v) => setDepartment(v === "none" ? "" : v)}
              >
                <SelectTrigger id={ids.dep} className="h-11 md:h-9">
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
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <Label htmlFor={ids.active} className="text-sm">
                Active
              </Label>
              <p className="text-xs text-muted-foreground">
                Inactive technicians can’t be newly assigned to events.
              </p>
            </div>
            <Switch id={ids.active} checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="h-11 md:h-9" disabled={saving}>
              {saving ? "Saving…" : isEditing ? "Save changes" : "Add technician"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
