import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { fieldsQuery, type LineFieldDef, type ProductionLine } from "@/lib/queries";
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
import { ConfirmDialog, IconButton, ListRow, SectionHeader, TextField, type QC } from "./shared";

type FieldSection = "making" | "packing" | "downtime" | "rework" | "extra";

export function FieldsSection({
  lines,
  lineId,
  onLineChange,
  totalFields,
  qc,
}: {
  lines: ProductionLine[];
  lineId: string | null;
  onLineChange: (id: string) => void;
  totalFields: number;
  qc: QC;
}) {
  const lineSelectId = useId();
  const sectionSelectId = useId();
  const { data: fields = [] } = useQuery(fieldsQuery(lineId));
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [section, setSection] = useState<FieldSection>("extra");
  const [unit, setUnit] = useState("kg");
  const [pendingDelete, setPendingDelete] = useState<LineFieldDef | null>(null);
  const lineName = lines.find((l) => l.id === lineId)?.name ?? "";

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["fields", lineId] });
    qc.invalidateQueries({ queryKey: ["line-field-counts"] });
  }

  async function add() {
    if (!lineId) return;
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
    invalidate();
  }

  async function confirmDelete(): Promise<boolean> {
    const f = pendingDelete;
    if (!f) return true;
    const { error } = await supabase.from("line_field_definitions").delete().eq("id", f.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success(`Field "${f.label}" deleted`);
    void logAudit("settings.delete", "line_field_definition", f.id, {
      label: f.label,
      line: lineName,
    });
    invalidate();
    return true;
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <SectionHeader id="fields" count={totalFields} />
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No production line yet — add one under Production lines first.
        </p>
      ) : (
        <Card>
          <CardContent className="space-y-4 p-4 md:p-6">
            <div className="space-y-1.5 sm:max-w-xs">
              <Label htmlFor={lineSelectId}>Production line</Label>
              <Select value={lineId ?? ""} onValueChange={onLineChange}>
                <SelectTrigger id={lineSelectId} className="h-11 md:h-9">
                  <SelectValue placeholder="Pick a line" />
                </SelectTrigger>
                <SelectContent>
                  {lines.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_9rem_6rem_auto] md:items-end">
              <TextField label="Key" value={key} onChange={setKey} placeholder="cooking_brix" />
              <TextField
                label="Label"
                value={label}
                onChange={setLabel}
                placeholder="Cooking Brix"
              />
              <div className="space-y-1.5">
                <Label htmlFor={sectionSelectId}>Form section</Label>
                <Select value={section} onValueChange={(v) => setSection(v as FieldSection)}>
                  <SelectTrigger id={sectionSelectId} className="h-11 md:h-9">
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
              </div>
              <TextField label="Unit" value={unit} onChange={setUnit} />
              <Button onClick={add} className="col-span-2 h-11 md:col-span-1 md:h-9">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add field
              </Button>
            </div>

            {fields.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No extra fields yet for {lineName || "this line"}.
              </p>
            ) : (
              <div className="space-y-1.5">
                {fields.map((f) => (
                  <ListRow key={f.id}>
                    <div className="min-w-0">
                      <p className="font-medium">
                        {f.label}{" "}
                        <span className="text-xs text-muted-foreground">({f.field_key})</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {f.section} · {f.unit}
                      </p>
                    </div>
                    <IconButton
                      icon={Trash2}
                      tone="destructive"
                      label={`Delete field ${f.label}`}
                      onClick={() => setPendingDelete(f)}
                    />
                  </ListRow>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete field “${pendingDelete?.label ?? ""}”?`}
        description={
          <p>
            It disappears from the {lineName} entry form. Values already saved on past entries stay
            in the database but are no longer shown.
          </p>
        }
        confirmLabel="Delete field"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
