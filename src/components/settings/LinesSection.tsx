import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { cn } from "@/lib/utils";
import { lineEntryCountQuery, type ProductionLine } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CodeChip,
  ConfirmDialog,
  IconButton,
  SectionHeader,
  TextField,
  WarningNote,
  normalizeCode,
  plural,
  validateMasterDataInput,
  type QC,
} from "./shared";

// Default swatch for a new line — a stored data value (production_lines.color),
// not a UI colour.
const DEFAULT_LINE_COLOR = "#0ea5e9";

export function LinesSection({
  lines,
  fieldCounts,
  qc,
}: {
  lines: ProductionLine[];
  fieldCounts: Record<string, number>;
  qc: QC;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [color, setColor] = useState(DEFAULT_LINE_COLOR);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProductionLine | null>(null);
  const colorId = useId();

  const {
    data: entryCount,
    isLoading: counting,
    isError: countFailed,
  } = useQuery(lineEntryCountQuery(pendingDelete?.id ?? null));

  function startEdit(l: ProductionLine) {
    setEditingId(l.id);
    setName(l.name);
    setCode(l.code ?? "");
    setColor(l.color);
  }
  function cancelEdit() {
    setEditingId(null);
    setName("");
    setCode("");
    setColor(DEFAULT_LINE_COLOR);
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

  async function confirmDelete(): Promise<boolean> {
    const l = pendingDelete;
    if (!l) return true;
    const { error } = await supabase.from("production_lines").delete().eq("id", l.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    if (editingId === l.id) cancelEdit();
    toast.success(`Line "${l.name}" deleted`);
    void logAudit("settings.delete", "production_line", l.id, {
      name: l.name,
      daily_entries_deleted: entryCount ?? null,
    });
    // The cascade took the line's entries (and their downtime rows) with it.
    for (const key of [
      "lines",
      "line-field-counts",
      "fields",
      "entries",
      "all-entries",
      "entry-downtimes-for-entries",
      "entry-area-owners-for-entries",
      "reason-usage",
      "line-entry-count",
    ]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
    return true;
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <SectionHeader id="lines" count={lines.length} />
      <Card>
        <CardContent className="space-y-4 p-4 md:p-6">
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem_4.5rem_auto] sm:items-end">
            <TextField
              label="Line name"
              value={name}
              onChange={setName}
              placeholder="e.g. Marshmallow"
            />
            <TextField label="Code" value={code} onChange={setCode} placeholder="e.g. MSH" />
            <div className="space-y-1.5">
              <Label htmlFor={colorId}>Colour</Label>
              <Input
                id={colorId}
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-11 w-16 p-1 md:h-9"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={saveLine} className="h-11 flex-1 md:h-9">
                {editingId ? (
                  "Update"
                ) : (
                  <>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add
                  </>
                )}
              </Button>
              {editingId && (
                <Button variant="ghost" onClick={cancelEdit} className="h-11 md:h-9">
                  Cancel
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {lines.map((l) => (
              <div
                key={l.id}
                className={cn(
                  "flex items-center gap-1 rounded-lg border pr-1",
                  editingId === l.id ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <Link
                  to="/settings"
                  search={{ section: "fields", line: l.id }}
                  className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/50"
                >
                  <span className="h-4 w-4 shrink-0 rounded" style={{ background: l.color }} />
                  <span className="truncate font-medium">{l.name}</span>
                  {l.code && <CodeChip>{l.code}</CodeChip>}
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    {plural(fieldCounts[l.id] ?? 0, "field")}
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                </Link>
                <IconButton icon={Pencil} label={`Edit ${l.name}`} onClick={() => startEdit(l)} />
                <IconButton
                  icon={Trash2}
                  tone="destructive"
                  label={`Delete ${l.name}`}
                  onClick={() => setPendingDelete(l)}
                />
              </div>
            ))}
            {lines.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">No lines yet.</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Open a line to manage its extra fields.</p>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete line “${pendingDelete?.name ?? ""}”?`}
        description={
          <>
            <p>
              {countFailed ? (
                "Couldn’t count this line’s daily entries, so it can’t be deleted right now. Try again."
              ) : counting || entryCount === undefined ? (
                "Counting this line’s daily entries…"
              ) : (
                <>
                  This also deletes{" "}
                  <strong className="text-foreground">
                    {plural(entryCount, "daily entry", "daily entries")}
                  </strong>{" "}
                  recorded on this line, with their downtime rows and area owners.
                </>
              )}
            </p>
            <p>This cannot be undone.</p>
          </>
        }
        confirmLabel="Delete line and entries"
        confirmText={pendingDelete?.name}
        disabled={counting || entryCount === undefined}
        onConfirm={confirmDelete}
      >
        {!!entryCount && (
          <WarningNote>
            Dashboard totals for past dates will drop by everything this line reported.
          </WarningNote>
        )}
      </ConfirmDialog>
    </div>
  );
}
