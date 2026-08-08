import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/lib/auth-context";
import { TechnicianMultiSelect } from "@/components/TechnicianMultiSelect";
import { maintenanceNotesQuery, techniciansQuery, type MaintenanceEvent, type MaintenanceStatus } from "@/lib/queries";
import { TYPE_LABELS, STATUS_LABELS, SEVERITY_LABEL_OPTIONS, typeBadgeVariant, statusBadgeVariant, severityBadgeVariant, formatDuration, toDatetimeLocalValue } from "@/lib/maintenance-format";

// Shared between src/routes/maintenance.tsx (clicking a row in the full
// events table) and src/components/MaintenanceDowntimeCard.tsx (clicking a
// row in the Dashboard's "Open Maintenance Events" list) — one dialog, one
// place to fix bugs, both callers see identical edit/notes/delete behavior.
export function EventDetailDialog({ event, canEdit, userId, onOpenChange, onChanged }: {
  event: MaintenanceEvent | null;
  canEdit: boolean;
  userId: string | null;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<MaintenanceStatus>("open");
  const [startedAt, setStartedAt] = useState("");
  const [resolvedAt, setResolvedAt] = useState("");
  const [severityLabel, setSeverityLabel] = useState("");
  const [technicianIds, setTechnicianIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const { data: notes = [], refetch: refetchNotes } = useQuery(maintenanceNotesQuery(event?.id ?? null));
  const { data: technicians = [] } = useQuery(techniciansQuery);
  // Keep whoever is already assigned selectable even if they've since gone
  // inactive (dropping them from technicianIds just because the roster
  // changed would silently erase a real historical assignment) — only new
  // picks are restricted to is_active technicians.
  const assignableTechnicians = technicians.filter(
    (t) => t.is_active || technicianIds.includes(t.id),
  );

  // Reset the edit form whenever a *different* event is opened — keyed on
  // id (not the whole event object) so a background refetch of the events
  // list while this dialog is open doesn't clobber in-progress edits.
  useEffect(() => {
    if (event) {
      setStatus(event.status);
      setStartedAt(toDatetimeLocalValue(new Date(event.started_at)));
      setResolvedAt(event.resolved_at ? toDatetimeLocalValue(new Date(event.resolved_at)) : "");
      setSeverityLabel(event.severity_label ?? "");
      setTechnicianIds(event.technician_ids);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id]);

  function handleStatusChange(next: MaintenanceStatus) {
    setStatus(next);
    if (next === "resolved" && !resolvedAt) {
      setResolvedAt(toDatetimeLocalValue(new Date()));
    }
  }

  async function handleSave() {
    if (!event) return;
    if (!startedAt) {
      toast.error("Started At is required.");
      return;
    }
    if (status === "resolved" && !resolvedAt) {
      toast.error("Resolved At is required when status is Resolved.");
      return;
    }
    setSaving(true);
    try {
      const becomingResolved = status === "resolved" && event.status !== "resolved";
      const updatePayload: {
        status: MaintenanceStatus;
        started_at: string;
        resolved_at: string | null;
        resolved_by?: string | null;
        severity_label: string | null;
        technician_ids: string[];
      } = {
        status,
        started_at: new Date(startedAt).toISOString(),
        resolved_at: status === "resolved" ? new Date(resolvedAt).toISOString() : null,
        severity_label: severityLabel.trim() || null,
        technician_ids: technicianIds,
      };
      if (becomingResolved) {
        // Attribute the resolution to whoever is saving it right now — only
        // on the open/in_progress -> resolved transition, so re-saving an
        // already-resolved event (e.g. just tweaking its timestamp) doesn't
        // silently reassign credit to the current editor.
        updatePayload.resolved_by = userId;
      } else if (status !== "resolved") {
        updatePayload.resolved_by = null;
      }
      const { error } = await supabase.from("maintenance_events").update(updatePayload).eq("id", event.id);
      if (error) throw error;
      toast.success("Event updated");
      void logAudit("maintenance.update_event", "maintenance_event", event.id, { status, startedAt, resolvedAt });
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update event");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!event) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("maintenance_events").delete().eq("id", event.id);
      if (error) throw error;
      toast.success("Maintenance event deleted");
      void logAudit("maintenance.delete_event", "maintenance_event", event.id, { title: event.title });
      onChanged();
      setConfirmDeleteOpen(false);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete event");
    } finally {
      setDeleting(false);
    }
  }

  async function handleAddNote() {
    if (!event || !noteText.trim()) return;
    setAddingNote(true);
    try {
      const { error } = await supabase
        .from("maintenance_notes")
        .insert({ event_id: event.id, note: noteText.trim(), created_by: userId });
      if (error) throw error;
      setNoteText("");
      void logAudit("maintenance.add_note", "maintenance_event", event.id);
      void refetchNotes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add note");
    } finally {
      setAddingNote(false);
    }
  }

  if (!event) return null;

  const startedDate = startedAt ? new Date(startedAt) : null;
  const resolvedDate = status === "resolved" && resolvedAt ? new Date(resolvedAt) : null;
  const durationMs = startedDate ? (resolvedDate ? resolvedDate.getTime() : Date.now()) - startedDate.getTime() : null;

  return (
    <>
      <Dialog open={!!event} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{event.title}</DialogTitle>
            <DialogDescription>{event.production_lines?.name ?? "—"}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={typeBadgeVariant(event.type)}>{TYPE_LABELS[event.type]}</Badge>
            </div>
            {event.description && <p className="text-muted-foreground">{event.description}</p>}

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Status</Label>
                {canEdit ? (
                  <Select value={status} onValueChange={(v) => handleStatusChange(v as MaintenanceStatus)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="mt-1"><Badge variant={statusBadgeVariant(status)}>{STATUS_LABELS[status]}</Badge></p>
                )}
              </div>
              <div>
                <Label className="text-xs">Severity</Label>
                {canEdit ? (
                  <Select value={severityLabel || "none"} onValueChange={(v) => setSeverityLabel(v === "none" ? "" : v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select severity" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unclassified</SelectItem>
                      {SEVERITY_LABEL_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="mt-1">
                    {severityLabel ? <Badge variant={severityBadgeVariant(severityLabel)}>{severityLabel}</Badge> : <span className="text-muted-foreground">Unclassified</span>}
                  </p>
                )}
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Technicians</Label>
                {canEdit ? (
                  <div className="mt-1">
                    <TechnicianMultiSelect
                      technicians={assignableTechnicians}
                      selectedIds={technicianIds}
                      onChange={setTechnicianIds}
                    />
                  </div>
                ) : (
                  <p className="mt-1">{event.technician_names.length > 0 ? event.technician_names.join(", ") : "—"}</p>
                )}
              </div>
              <div>
                <Label className="text-xs">Started At</Label>
                {canEdit ? (
                  <Input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} required className="mt-1" />
                ) : (
                  <p className="mt-1">{startedDate ? startedDate.toLocaleString() : "—"}</p>
                )}
              </div>
              {status === "resolved" && (
                <div>
                  <Label className="text-xs">Resolved At</Label>
                  {canEdit ? (
                    <Input type="datetime-local" value={resolvedAt} onChange={(e) => setResolvedAt(e.target.value)} required className="mt-1" />
                  ) : (
                    <p className="mt-1">{resolvedDate ? resolvedDate.toLocaleString() : "—"}</p>
                  )}
                </div>
              )}
              {status === "resolved" && (
                <div>
                  <Label className="text-xs">Resolved by</Label>
                  <p className="mt-1">{event.resolved_by_profile?.display_name || event.resolved_by_profile?.email || "—"}</p>
                </div>
              )}
              <div className="col-span-2">
                <Label className="text-xs">Duration</Label>
                <p className="mt-1 font-medium tabular-nums">{durationMs !== null ? formatDuration(durationMs) : "—"}</p>
              </div>
            </div>

            {(canEdit || isAdmin) && (
              <div className="flex gap-2">
                {canEdit && (
                  <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1">
                    {saving ? "Saving…" : "Save Changes"}
                  </Button>
                )}
                {isAdmin && (
                  <Button size="sm" variant="destructive" onClick={() => setConfirmDeleteOpen(true)} aria-label="Delete event">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="mt-2 border-t border-border pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Notes</p>
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {notes.length === 0 && <p className="text-xs text-muted-foreground">No notes yet.</p>}
              {notes.map((n) => (
                <div key={n.id} className="rounded-md border border-border p-2">
                  <p className="text-sm">{n.note}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{new Date(n.created_at).toLocaleString()}</p>
                </div>
              ))}
            </div>
            {canEdit && (
              <div className="mt-2 flex gap-2">
                <Input
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add a note…"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAddNote(); } }}
                />
                <Button size="sm" onClick={handleAddNote} disabled={addingNote || !noteText.trim()}>Add</Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this maintenance event?</AlertDialogTitle>
            <AlertDialogDescription>
              "{event.title}" and all of its notes will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
