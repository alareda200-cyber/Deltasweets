// Settings › Production lines › Making capacity (approved mockup, 13 Oct 2026).
//
// An admin sets each line's making capacity, per day or per shift, from a
// date. The daily entry's Making plan then comes from it, locked (the database
// sets it; see migration 20261013120000_line_capacities).
import { useEffect, useId, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { cn } from "@/lib/utils";
import type { ProductionLine } from "@/lib/queries";
import {
  capacityFor,
  lineCapacitiesQuery,
  planFromCapacity,
  type CapacityBasis,
  type LineCapacity,
} from "@/lib/capacity";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const kg = (n: number) => Math.round(n).toLocaleString("en-US");
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function CapacitySection({ lines }: { lines: ProductionLine[] }) {
  const { data: capacities = [], isError } = useQuery(lineCapacitiesQuery);
  const [editing, setEditing] = useState<ProductionLine | null>(null);
  const today = isoToday();

  return (
    <Card data-testid="capacity-section">
      <CardContent className="space-y-3 p-4 md:p-6">
        <div className="flex items-start gap-3">
          <Gauge className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Making capacity</h3>
            <p className="text-sm text-muted-foreground">
              The daily entry&rsquo;s Making plan comes from here and is locked. Per day: a shift
              entry gets a third. Per shift: a full-day entry gets three times it.
            </p>
          </div>
        </div>
        {isError && (
          <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-strong">
            Couldn&rsquo;t load the capacities. Try again in a moment.
          </p>
        )}
        <ul className="divide-y divide-border rounded-lg border border-border">
          {lines.map((l) => {
            const cur = capacityFor(capacities, l.id, today);
            const next = capacities
              .filter((c) => c.line_id === l.id && c.effective_from > today)
              .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];
            return (
              <li
                key={l.id}
                data-capacity-line={l.name}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5"
              >
                <span className="h-3 w-3 shrink-0 rounded" style={{ background: l.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{l.name}</span>
                  {cur ? (
                    <span className="block text-sm tabular-nums">
                      <b>{kg(cur.making_kg)} kg</b> per {cur.basis}
                      {cur.making_count != null && l.making_count_unit
                        ? ` · ${num(cur.making_count)} ${l.making_count_unit}`
                        : ""}
                      <span className="text-muted-foreground">
                        {" "}
                        ·{" "}
                        {cur.basis === "day"
                          ? `shift ${kg(cur.making_kg / 3)} kg`
                          : `full day ${kg(cur.making_kg * 3)} kg`}{" "}
                        · since {shortDate(cur.effective_from)}
                      </span>
                    </span>
                  ) : (
                    <span className="block text-sm font-medium text-warning-strong">
                      Not set · supervisors type the plan
                    </span>
                  )}
                  {next && (
                    <span className="block text-xs text-muted-foreground">
                      From {shortDate(next.effective_from)}: {kg(next.making_kg)} kg per{" "}
                      {next.basis}
                    </span>
                  )}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 md:h-9"
                  aria-label={`${cur ? "Change" : "Set"} making capacity for ${l.name}`}
                  onClick={() => setEditing(l)}
                >
                  {cur ? "Change" : "Set capacity"}
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
      <CapacityDialog
        line={editing}
        capacities={capacities}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </Card>
  );
}

function CapacityDialog({
  line,
  capacities,
  onOpenChange,
}: {
  line: ProductionLine | null;
  capacities: LineCapacity[];
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const uid = useId();
  const today = isoToday();
  const history = useMemo(
    () =>
      line
        ? capacities
            .filter((c) => c.line_id === line.id)
            .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
        : [],
    [capacities, line],
  );
  const [kgText, setKgText] = useState("");
  const [basis, setBasis] = useState<CapacityBasis>("day");
  const [countText, setCountText] = useState("");
  const [from, setFrom] = useState(today);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    if (!line) return;
    const cur = capacityFor(capacities, line.id, today) ?? history[0] ?? null;
    setKgText(cur ? String(cur.making_kg) : "");
    setBasis(cur?.basis ?? "day");
    setCountText(cur?.making_count != null ? String(cur.making_count) : "");
    setFrom(today);
    setRemoving(null);
    // Only when the dialog opens for a line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line?.id]);

  const unit = line?.making_count_unit?.trim() || null;
  const kgN = Number(kgText.replace(/,/g, ""));
  const countN = Number(countText.replace(/,/g, ""));
  const kgOk = kgText.trim() !== "" && Number.isFinite(kgN) && kgN > 0;
  const countOk = countText.trim() === "" || (Number.isFinite(countN) && countN > 0);
  const preview = kgOk
    ? {
        day: planFromCapacity(
          { basis, making_kg: kgN, making_count: unit && countText ? countN : null },
          "DAY",
        ),
        shift: planFromCapacity(
          { basis, making_kg: kgN, making_count: unit && countText ? countN : null },
          "A",
        ),
      }
    : null;

  async function invalidate() {
    for (const key of ["line-capacities", "entries", "all-entries", "entries-all-lines", "entry"]) {
      await qc.invalidateQueries({ queryKey: [key] });
    }
  }

  async function save() {
    if (!line || !kgOk || !countOk || !from) return;
    setSaving(true);
    const row = {
      line_id: line.id,
      basis,
      making_kg: kgN,
      making_count: unit && countText.trim() !== "" ? countN : null,
      effective_from: from,
    };
    const { error } = await supabase
      .from("line_capacities")
      .upsert(row, { onConflict: "line_id,effective_from" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`${line.name}: ${kg(kgN)} kg per ${basis} from ${shortDate(from)}`);
    void logAudit("settings.update", "line_capacity", line.id, {
      name: line.name,
      basis,
      making_kg: kgN,
      making_count: row.making_count,
      from,
    });
    await invalidate();
    onOpenChange(false);
  }

  async function remove(c: LineCapacity) {
    if (!line) return;
    if (removing !== c.id) return setRemoving(c.id);
    const { error } = await supabase.from("line_capacities").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success(`Removed the capacity from ${shortDate(c.effective_from)}`);
    void logAudit("settings.delete", "line_capacity", line.id, {
      name: line.name,
      making_kg: c.making_kg,
      basis: c.basis,
      from: c.effective_from,
    });
    setRemoving(null);
    await invalidate();
  }

  return (
    <Dialog open={!!line} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Making capacity · {line?.name}</DialogTitle>
          <DialogDescription>
            The Making plan of every daily entry from this date on comes from it. Earlier days keep
            their plan.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-kg`}>Capacity</Label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Input
                  id={`${uid}-kg`}
                  inputMode="decimal"
                  className="h-11 md:h-9"
                  value={kgText}
                  onChange={(e) => setKgText(e.target.value)}
                  aria-invalid={kgText !== "" && !kgOk}
                />
                <span className="text-sm text-muted-foreground">kg</span>
              </div>
              <div
                role="radiogroup"
                aria-label="Capacity is per"
                className="inline-flex rounded-lg bg-muted p-[3px]"
              >
                {(["day", "shift"] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    role="radio"
                    aria-checked={basis === b}
                    data-basis={b}
                    onClick={() => setBasis(b)}
                    className={cn(
                      "h-11 rounded-md px-3.5 text-sm font-semibold transition-colors md:h-8",
                      basis === b
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    per {b}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {unit && (
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-count`}>
                Capacity in {unit}{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${uid}-count`}
                  inputMode="decimal"
                  className="h-11 md:h-9"
                  value={countText}
                  onChange={(e) => setCountText(e.target.value)}
                  aria-invalid={!countOk}
                />
                <span className="text-sm text-muted-foreground">{unit}</span>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-from`}>Applies from</Label>
            <Input
              id={`${uid}-from`}
              type="date"
              className="h-11 max-w-[14rem] md:h-9"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          {preview && (
            <dl
              data-testid="capacity-preview"
              aria-live="polite"
              className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-muted px-3 py-2.5 text-sm"
            >
              <dt className="text-muted-foreground">Full-day entry</dt>
              <dd className="font-semibold tabular-nums">
                {kg(preview.day.kg)} kg
                {preview.day.count != null && unit ? ` · ${num(preview.day.count)} ${unit}` : ""}
              </dd>
              <dt className="text-muted-foreground">Shift A / B / C entry</dt>
              <dd className="font-semibold tabular-nums">
                {kg(preview.shift.kg)} kg
                {preview.shift.count != null && unit
                  ? ` · ${num(preview.shift.count)} ${unit}`
                  : ""}
              </dd>
            </dl>
          )}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="h-11 md:h-9"
              disabled={saving || !kgOk || !countOk || !from}
            >
              {saving ? "Saving…" : "Save capacity"}
            </Button>
          </DialogFooter>
        </form>
        {history.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              History
            </p>
            <ul className="text-sm" data-testid="capacity-history">
              {history.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 border-t border-border py-1.5 first:border-t-0"
                >
                  <span className="min-w-0 flex-1 tabular-nums">
                    {kg(c.making_kg)} kg per {c.basis}
                    {c.making_count != null && unit ? ` · ${num(c.making_count)} ${unit}` : ""}
                    <span className="text-muted-foreground">
                      {" "}
                      · from {shortDate(c.effective_from)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant={removing === c.id ? "destructive" : "ghost"}
                    className="h-11 px-3 md:h-8"
                    aria-label={
                      removing === c.id
                        ? `Confirm removing the capacity from ${shortDate(c.effective_from)}`
                        : `Remove the capacity from ${shortDate(c.effective_from)}`
                    }
                    onClick={() => void remove(c)}
                  >
                    {removing === c.id ? "Remove" : <Trash2 className="h-4 w-4" />}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
