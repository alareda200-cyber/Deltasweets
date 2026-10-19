// Settings › Packing (November 2026 monthly upgrade, approved mockup):
//   - packing machines and their ideal speed (bags per minute), used by the
//     packing OEE;
//   - the SKU list with kg per unit, used when the forecast and the packed
//     SKUs are pasted on the Plan adherence page. SKUs can be added, pasted,
//     edited, deactivated and deleted here.
// Everything here belongs to the company in view; admins edit it.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { cn } from "@/lib/utils";
import type { ProductionLine } from "@/lib/queries";
import { packingMachinesQuery, skusQuery, type PackingMachine, type Sku } from "@/lib/packing";
import { kgPerUnitFromName } from "@/lib/sku-weight";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CodeChip,
  ConfirmDialog,
  IconButton,
  InactiveChip,
  ListRow,
  SectionHeader,
  TextField,
  type QC,
} from "./shared";

const kgFmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });
const selectCls = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm md:h-9";

export function PackingSection({ lines, qc }: { lines: ProductionLine[]; qc: QC }) {
  return (
    <div className="space-y-4 md:space-y-5" data-testid="packing-section">
      <SectionHeader id="packing" />
      <MachinesCard lines={lines} qc={qc} />
      <SkusCard lines={lines} qc={qc} />
    </div>
  );
}

// ---------------------------------------------------------------- machines
function MachinesCard({ lines, qc }: { lines: ProductionLine[]; qc: QC }) {
  const { data: machines = [], isError } = useQuery(packingMachinesQuery);
  const [editing, setEditing] = useState<PackingMachine | null>(null);
  const [name, setName] = useState("");
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const [speed, setSpeed] = useState("");
  const [toDelete, setToDelete] = useState<PackingMachine | null>(null);
  const lineName = (id: string) => lines.find((l) => l.id === id)?.name ?? "—";

  function reset() {
    setEditing(null);
    setName("");
    setSpeed("");
  }
  async function save() {
    const n = name.trim();
    const sp = Number(speed);
    if (!n) return toast.error("Enter the machine's name.");
    if (!lineId) return toast.error("Pick the line it packs for.");
    if (!(sp > 0)) return toast.error("Enter its ideal speed in bags per minute.");
    const row = { name: n, line_id: lineId, speed_per_min: sp };
    const { error } = editing
      ? await supabase.from("packing_machines").update(row).eq("id", editing.id)
      : await supabase
          .from("packing_machines")
          .insert({ ...row, sort_order: machines.filter((m) => m.line_id === lineId).length + 1 });
    if (error) {
      toast.error(
        error.code === "23505" ? `${lineName(lineId)} already has a ${n}.` : error.message,
      );
      return;
    }
    void logAudit(
      editing ? "packing.update_machine" : "packing.add_machine",
      "packing_machine",
      editing?.id ?? n,
      row,
    );
    toast.success(editing ? `${n} saved` : `${n} added`);
    reset();
    qc.invalidateQueries({ queryKey: ["packing-machines"] });
  }
  async function toggleActive(m: PackingMachine) {
    const { error } = await supabase
      .from("packing_machines")
      .update({ is_active: !m.is_active })
      .eq("id", m.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["packing-machines"] });
  }

  const grouped = lines
    .map((l) => ({ line: l, list: machines.filter((m) => m.line_id === l.id) }))
    .filter((g) => g.list.length > 0);

  return (
    <Card data-testid="machines-card">
      <CardContent className="space-y-4 p-4 md:p-6">
        <div>
          <h2 className="text-base font-semibold">Packing machines</h2>
          <p className="text-sm text-muted-foreground">
            Each machine&rsquo;s ideal speed sets its Performance in the OEE. Faults logged on a
            machine in Maintenance lower its Availability only, not the line&rsquo;s.
          </p>
        </div>
        {isError && (
          <p className="text-sm text-destructive-strong">The machines didn&rsquo;t load.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_9rem_auto] sm:items-end">
          <TextField label="Machine" value={name} onChange={setName} placeholder="e.g. Rovema 6" />
          <div className="space-y-1.5">
            <Label htmlFor="machine-line">Packs for</Label>
            <select
              id="machine-line"
              className={selectCls}
              value={lineId}
              onChange={(e) => setLineId(e.target.value)}
            >
              {lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <TextField
            label="Bags per minute"
            type="number"
            value={speed}
            onChange={setSpeed}
            placeholder="150"
          />
          <div className="flex gap-2">
            <Button type="button" className="h-11 md:h-9" onClick={save}>
              {editing ? "Save" : "Add"}
            </Button>
            {editing && (
              <Button type="button" variant="outline" className="h-11 md:h-9" onClick={reset}>
                Cancel
              </Button>
            )}
          </div>
        </div>
        {grouped.length === 0 && (
          <p className="text-sm text-muted-foreground">No packing machines yet.</p>
        )}
        {grouped.map(({ line, list }) => (
          <div key={line.id} className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {line.name}
            </p>
            {list.map((m) => (
              <ListRow key={m.id}>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-medium whitespace-nowrap">
                    {m.name}
                    {!m.is_active && <InactiveChip />}
                  </span>
                  <span className="block text-xs tabular-nums text-muted-foreground sm:hidden">
                    {m.speed_per_min} bags / min
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="mr-1 hidden text-sm tabular-nums whitespace-nowrap text-muted-foreground sm:inline">
                    {m.speed_per_min} / min
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 px-2 text-xs md:h-9"
                    onClick={() => toggleActive(m)}
                  >
                    {m.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <IconButton
                    icon={Pencil}
                    label={`Edit ${m.name}`}
                    onClick={() => {
                      setEditing(m);
                      setName(m.name);
                      setLineId(m.line_id);
                      setSpeed(String(m.speed_per_min));
                    }}
                  />
                  <IconButton
                    icon={Trash2}
                    label={`Delete ${m.name}`}
                    tone="destructive"
                    onClick={() => setToDelete(m)}
                  />
                </span>
              </ListRow>
            ))}
          </div>
        ))}
      </CardContent>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete ${toDelete?.name ?? ""}?`}
        description={
          <p>
            Its shifts and bags on past daily entries are deleted too, and its faults in Maintenance
            stay but lose the link to it. To stop using it, deactivate it instead.
          </p>
        }
        onConfirm={async () => {
          if (!toDelete) return;
          const { error } = await supabase.from("packing_machines").delete().eq("id", toDelete.id);
          if (error) {
            toast.error(error.message);
            return false;
          }
          void logAudit("packing.delete_machine", "packing_machine", toDelete.id, {
            name: toDelete.name,
          });
          qc.invalidateQueries({ queryKey: ["packing-machines"] });
        }}
      />
    </Card>
  );
}

// --------------------------------------------------------------------- SKUs
const SHOWN = 40;

function SkusCard({ lines, qc }: { lines: ProductionLine[]; qc: QC }) {
  const { data: skus = [], isError } = useQuery(skusQuery);
  const [find, setFind] = useState("");
  const [lineFilter, setLineFilter] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [editingKg, setEditingKg] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [editing, setEditing] = useState<Sku | null>(null);
  const [toDelete, setToDelete] = useState<Sku | null>(null);
  // Several SKUs at once: pick some (or every one matching), then change the
  // line, set kg per unit, deactivate/activate or delete them together.
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [bulkLine, setBulkLine] = useState("");
  const [bulkKg, setBulkKg] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDelete, setBulkDelete] = useState(false);
  const lineName = (id: string | null) =>
    id ? (lines.find((l) => l.id === id)?.name ?? "—") : "—";
  const missing = skus.filter((s) => s.kg_per_unit == null).length;

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return skus.filter(
      (s) =>
        (!q || s.code.includes(q) || s.name.toLowerCase().includes(q)) &&
        (!lineFilter || s.line_id === lineFilter) &&
        (!onlyMissing || s.kg_per_unit == null),
    );
  }, [skus, find, lineFilter, onlyMissing]);

  const picked = skus.filter((s) => sel.has(s.id));
  const allShownPicked = shown.length > 0 && shown.every((s) => sel.has(s.id));
  function toggle(id: string, on: boolean) {
    setSel((cur) => {
      const n = new Set(cur);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }
  // In chunks: a long id list doesn't fit one request URL.
  async function bulk(
    action: string,
    run: (ids: string[]) => PromiseLike<{ error: { message: string } | null }>,
    detail: Record<string, unknown>,
    done: string,
  ) {
    const ids = picked.map((s) => s.id);
    if (ids.length === 0) return false;
    setBulkBusy(true);
    try {
      for (let i = 0; i < ids.length; i += 100) {
        const { error } = await run(ids.slice(i, i + 100));
        if (error) throw error;
      }
      void logAudit(action, "sku", ids[0], {
        ...detail,
        count: ids.length,
        codes: picked.map((s) => s.code),
      });
      toast.success(done);
      qc.invalidateQueries({ queryKey: ["skus"] });
      return true;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : String((err as { message?: string }).message),
      );
      return false;
    } finally {
      setBulkBusy(false);
    }
  }
  async function bulkSetLine() {
    if (!bulkLine) return toast.error("Pick the line.");
    const ok = await bulk(
      "packing.bulk_line_skus",
      (ids) => supabase.from("skus").update({ line_id: bulkLine }).in("id", ids),
      { line_id: bulkLine },
      `${picked.length} SKUs moved to ${lineName(bulkLine)}`,
    );
    if (ok) setBulkLine("");
  }
  async function bulkSetKg() {
    const k = Number(bulkKg);
    if (!(k > 0)) return toast.error("kg per unit must be more than 0.");
    const ok = await bulk(
      "packing.bulk_kg_skus",
      (ids) => supabase.from("skus").update({ kg_per_unit: k }).in("id", ids),
      { kg_per_unit: k },
      `${picked.length} SKUs set to ${kgFmt(k)} kg`,
    );
    if (ok) setBulkKg("");
  }
  async function bulkActive(active: boolean) {
    await bulk(
      active ? "packing.bulk_activate_skus" : "packing.bulk_deactivate_skus",
      (ids) => supabase.from("skus").update({ is_active: active }).in("id", ids),
      { is_active: active },
      `${picked.length} SKUs ${active ? "activated" : "deactivated"}`,
    );
  }

  async function saveKg(s: Sku) {
    const raw = (editingKg[s.id] ?? "").trim();
    const kg = raw === "" ? null : Number(raw);
    if (kg !== null && !(kg > 0)) return toast.error("kg per unit must be more than 0.");
    const { error } = await supabase.from("skus").update({ kg_per_unit: kg }).eq("id", s.id);
    if (error) return toast.error(error.message);
    void logAudit("packing.update_sku", "sku", s.id, { code: s.code, kg_per_unit: kg });
    setEditingKg((d) => {
      const n = { ...d };
      delete n[s.id];
      return n;
    });
    toast.success(`${s.code} saved`);
    qc.invalidateQueries({ queryKey: ["skus"] });
  }

  return (
    <Card data-testid="skus-card">
      <CardContent className="space-y-4 p-4 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              SKUs
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                {skus.length}
              </span>
            </h2>
            <p className="text-sm text-muted-foreground">
              kg per unit turns the quantities pasted on the Plan adherence page into kg. It is read
              from the name (bags × grams) and can be changed here.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => {
                setPasting((v) => !v);
                setAdding(false);
                setEditing(null);
              }}
            >
              Paste SKUs
            </Button>
            <Button
              type="button"
              className="h-11 md:h-9"
              onClick={() => {
                setAdding((v) => !v);
                setPasting(false);
                setEditing(null);
              }}
            >
              Add SKU
            </Button>
          </div>
        </div>
        {isError && <p className="text-sm text-destructive-strong">The SKUs didn&rsquo;t load.</p>}
        {adding && <SkuForm lines={lines} skus={skus} qc={qc} onDone={() => setAdding(false)} />}
        {editing && (
          <SkuForm
            key={editing.id}
            lines={lines}
            skus={skus}
            qc={qc}
            sku={editing}
            onDone={() => setEditing(null)}
          />
        )}
        {pasting && (
          <PasteSkus lines={lines} skus={skus} qc={qc} onDone={() => setPasting(false)} />
        )}

        <div className="grid gap-2 sm:grid-cols-[1fr_11rem_auto] sm:items-center">
          <Input
            aria-label="Search SKUs by code or name"
            placeholder="Search code or name"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            className="h-11 md:h-9"
          />
          <select
            aria-label="Line"
            className={selectCls}
            value={lineFilter}
            onChange={(e) => setLineFilter(e.target.value)}
          >
            <option value="">All lines</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <label className="flex h-11 items-center gap-2 text-sm md:h-9">
            <input
              type="checkbox"
              checked={onlyMissing}
              onChange={(e) => setOnlyMissing(e.target.checked)}
              className="h-4 w-4"
            />
            No weight ({missing})
          </label>
        </div>

        {sel.size > 0 && (
          <div
            className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2 sm:flex-row sm:flex-wrap sm:items-center"
            data-testid="sku-bulk"
          >
            <span className="flex items-center gap-2 px-1 text-sm font-semibold">
              {sel.size} selected
              <Button
                type="button"
                variant="ghost"
                className="h-11 px-2 text-xs md:h-8"
                onClick={() => setSel(new Set())}
              >
                Clear
              </Button>
            </span>
            <span className="flex gap-1.5 sm:ml-auto">
              <select
                aria-label="Move selected to line"
                className={cn(selectCls, "md:w-36")}
                value={bulkLine}
                onChange={(e) => setBulkLine(e.target.value)}
              >
                <option value="">Change line…</option>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-9"
                disabled={bulkBusy || !bulkLine}
                onClick={bulkSetLine}
              >
                Move
              </Button>
            </span>
            <span className="flex gap-1.5">
              <Input
                aria-label="kg per unit for selected"
                inputMode="decimal"
                placeholder="kg per unit"
                value={bulkKg}
                onChange={(e) => setBulkKg(e.target.value)}
                className="h-11 w-full text-right tabular-nums sm:w-28 md:h-9"
              />
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-9"
                disabled={bulkBusy || !bulkKg.trim()}
                onClick={bulkSetKg}
              >
                Set kg
              </Button>
            </span>
            <span className="flex gap-1.5">
              <Button
                type="button"
                variant="outline"
                className="h-11 flex-1 md:h-9"
                disabled={bulkBusy}
                onClick={() => bulkActive(picked.every((s) => !s.is_active))}
              >
                {picked.every((s) => !s.is_active) ? "Activate" : "Deactivate"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 flex-1 border-destructive/40 text-destructive-strong md:h-9"
                disabled={bulkBusy}
                onClick={() => setBulkDelete(true)}
              >
                Delete {sel.size}
              </Button>
            </span>
          </div>
        )}

        <div className="space-y-1.5" data-testid="sku-list">
          {shown.length > 0 && (
            <label className="flex min-h-11 items-center gap-2 rounded-lg bg-muted/60 px-3 text-sm font-semibold md:min-h-9">
              <input
                type="checkbox"
                aria-label="Select all matching SKUs"
                className="h-4 w-4"
                checked={allShownPicked}
                onChange={(e) =>
                  setSel((cur) => {
                    const n = new Set(cur);
                    for (const s of shown) {
                      if (e.target.checked) n.add(s.id);
                      else n.delete(s.id);
                    }
                    return n;
                  })
                }
              />
              Select all {shown.length === skus.length ? "" : "matching "}({shown.length})
            </label>
          )}
          {shown.slice(0, SHOWN).map((s) => {
            const draft = editingKg[s.id];
            return (
              <div
                key={s.id}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border border-border px-3 py-2 text-sm sm:flex-row sm:items-center",
                  sel.has(s.id) && "border-primary/40 bg-primary/5",
                )}
              >
                <div className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${s.code}`}
                      className="h-4 w-4 shrink-0"
                      checked={sel.has(s.id)}
                      onChange={(e) => toggle(s.id, e.target.checked)}
                    />
                    <CodeChip>{s.code}</CodeChip>
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {lineName(s.line_id)}
                      {s.unit ? ` · ${s.unit}` : ""}
                    </span>
                    {!s.is_active && <InactiveChip />}
                    <span className="ml-auto flex shrink-0 items-center sm:hidden">
                      <SkuActions
                        sku={s}
                        onEdit={() => {
                          setEditing(s);
                          setAdding(false);
                          setPasting(false);
                        }}
                        onDelete={() => setToDelete(s)}
                      />
                    </span>
                  </span>
                  <span dir="rtl" className="mt-0.5 block truncate text-right sm:text-left">
                    {s.name || <span className="text-muted-foreground">no name</span>}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`kg per unit for ${s.code}`}
                    inputMode="decimal"
                    value={draft ?? (s.kg_per_unit == null ? "" : String(s.kg_per_unit))}
                    placeholder="fill in"
                    onChange={(e) => setEditingKg((d) => ({ ...d, [s.id]: e.target.value }))}
                    className={cn(
                      "h-11 w-28 text-right tabular-nums md:h-9",
                      s.kg_per_unit == null && draft === undefined && "border-warning",
                    )}
                  />
                  <span className="text-xs text-muted-foreground">kg</span>
                  <Button
                    type="button"
                    variant={draft !== undefined ? "default" : "outline"}
                    disabled={draft === undefined}
                    className="h-11 md:h-9"
                    onClick={() => saveKg(s)}
                  >
                    Save
                  </Button>
                  <span className="hidden items-center sm:flex">
                    <SkuActions
                      sku={s}
                      onEdit={() => {
                        setEditing(s);
                        setAdding(false);
                        setPasting(false);
                      }}
                      onDelete={() => setToDelete(s)}
                    />
                  </span>
                </div>
              </div>
            );
          })}
          {shown.length > SHOWN && (
            <p className="px-1 text-sm text-muted-foreground">
              {shown.length - SHOWN} more — search to narrow the list.
            </p>
          )}
          {shown.length === 0 && skus.length > 0 && (
            <p className="px-1 text-sm text-muted-foreground">No SKU matches.</p>
          )}
        </div>
      </CardContent>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete ${toDelete?.code ?? ""}?`}
        description={
          <p>
            It leaves the SKU list. Packed rows already saved keep their code and kg; a forecast
            that has it keeps the quantity but no longer counts it in kg. To stop using it and keep
            its weight, deactivate it instead (Edit › Active).
          </p>
        }
        onConfirm={async () => {
          if (!toDelete) return;
          const { error } = await supabase.from("skus").delete().eq("id", toDelete.id);
          if (error) {
            toast.error(error.message);
            return false;
          }
          void logAudit("packing.delete_sku", "sku", toDelete.id, {
            code: toDelete.code,
            name: toDelete.name,
          });
          if (editing?.id === toDelete.id) setEditing(null);
          toggle(toDelete.id, false);
          qc.invalidateQueries({ queryKey: ["skus"] });
        }}
      />
      <ConfirmDialog
        open={bulkDelete}
        onOpenChange={setBulkDelete}
        title={`Delete ${sel.size} SKUs?`}
        description={
          <p>
            They leave the SKU list. Packed rows already saved keep their code and kg; a forecast
            that has them keeps the quantity but no longer counts them in kg. To stop using them and
            keep their weight, deactivate them instead.
          </p>
        }
        onConfirm={async () => {
          const ok = await bulk(
            "packing.bulk_delete_skus",
            (ids) => supabase.from("skus").delete().in("id", ids),
            {},
            `${picked.length} SKUs deleted`,
          );
          if (!ok) return false;
          if (editing && sel.has(editing.id)) setEditing(null);
          setSel(new Set());
        }}
      />
    </Card>
  );
}

function SkuActions({
  sku,
  onEdit,
  onDelete,
}: {
  sku: Sku;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <IconButton icon={Pencil} label={`Edit ${sku.code}`} onClick={onEdit} />
      <IconButton
        icon={Trash2}
        label={`Delete ${sku.code}`}
        tone="destructive"
        onClick={onDelete}
      />
    </>
  );
}

// Add a SKU, or edit one (code fixed: the forecast and packed rows refer to
// it by code).
function SkuForm({
  lines,
  skus,
  qc,
  sku,
  onDone,
}: {
  lines: ProductionLine[];
  skus: Sku[];
  qc: QC;
  sku?: Sku;
  onDone: () => void;
}) {
  const [code, setCode] = useState(sku?.code ?? "");
  const [name, setName] = useState(sku?.name ?? "");
  const [unit, setUnit] = useState(sku ? (sku.unit ?? "") : "كرتونة");
  const [lineId, setLineId] = useState(sku ? (sku.line_id ?? "") : (lines[0]?.id ?? ""));
  const [kg, setKg] = useState(sku?.kg_per_unit == null ? "" : String(sku.kg_per_unit));
  const [active, setActive] = useState(sku?.is_active ?? true);
  const fromName = kgPerUnitFromName(name, unit);

  async function save() {
    const c = code.trim();
    if (!c) return toast.error("Enter the item code.");
    if (!sku && skus.some((s) => s.code === c)) return toast.error(`${c} is already in the list.`);
    const k = kg.trim() === "" ? fromName : Number(kg);
    if (k !== null && !(k > 0)) return toast.error("kg per unit must be more than 0.");
    const row = {
      name: name.trim().replace(/\s+/g, " "),
      unit: unit.trim() || null,
      line_id: lineId || null,
      kg_per_unit: k,
    };
    const { error } = sku
      ? await supabase
          .from("skus")
          .update({ ...row, is_active: active })
          .eq("id", sku.id)
      : await supabase.from("skus").insert({ ...row, code: c });
    if (error) return toast.error(error.message);
    void logAudit(sku ? "packing.update_sku" : "packing.add_sku", "sku", sku?.id ?? c, {
      code: c,
      ...row,
      ...(sku ? { is_active: active } : {}),
    });
    toast.success(sku ? `${c} saved` : `${c} added`);
    qc.invalidateQueries({ queryKey: ["skus"] });
    onDone();
  }

  return (
    <div
      className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
      data-testid={sku ? "sku-edit" : "sku-add"}
    >
      {sku ? (
        <div className="space-y-1.5">
          <Label>Item code</Label>
          <p className="flex h-11 items-center md:h-9">
            <CodeChip>{sku.code}</CodeChip>
          </p>
        </div>
      ) : (
        <TextField label="Item code" value={code} onChange={setCode} placeholder="403009999" />
      )}
      <TextField
        label="Name"
        value={name}
        onChange={setName}
        placeholder="كاندى كولا 32 كيس × 45 جم"
      />
      <TextField label="Unit" value={unit} onChange={setUnit} />
      <div className="space-y-1.5">
        <Label htmlFor={sku ? "sku-edit-line" : "sku-line"}>Line</Label>
        <select
          id={sku ? "sku-edit-line" : "sku-line"}
          className={selectCls}
          value={lineId}
          onChange={(e) => setLineId(e.target.value)}
        >
          {!lineId && <option value="">—</option>}
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <TextField
        label="kg per unit"
        value={kg}
        onChange={setKg}
        placeholder={fromName !== null ? String(fromName) : "fill in"}
        hint={
          fromName !== null ? `From the name: ${kgFmt(fromName)} kg` : "The name doesn't say it"
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        {sku && (
          <label className="mr-2 flex h-11 items-center gap-2 text-sm md:h-9">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4"
            />
            Active
          </label>
        )}
        <Button type="button" className="h-11 md:h-9" onClick={save}>
          {sku ? "Save" : "Add SKU"}
        </Button>
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// Rows copied from the SKU sheet: Code · Name · Unit · Line. New codes are
// added; codes already in the list are left as they are.
function PasteSkus({
  lines,
  skus,
  qc,
  onDone,
}: {
  lines: ProductionLine[];
  skus: Sku[];
  qc: QC;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const known = new Set(skus.map((s) => s.code));
  const lineByName = new Map(lines.map((l) => [l.name.toLowerCase().replace(/\s+/g, ""), l.id]));
  // The SKU sheet writes Sour Tube as "Tube".
  const sour = lineByName.get("sourtube");
  if (sour && !lineByName.has("tube")) lineByName.set("tube", sour);
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.split("\t").map((c) => c.trim()))
    .filter((c) => /^\d{6,}$/.test(c[0] ?? ""))
    .map(([code, name = "", unit = "", line = ""]) => ({
      code,
      name: name.replace(/\s+/g, " "),
      unit: unit || null,
      line_id: lineByName.get(line.toLowerCase().replace(/\s+/g, "")) ?? null,
      kg_per_unit: kgPerUnitFromName(name, unit),
    }));
  const fresh = rows.filter((r) => !known.has(r.code));

  async function save() {
    if (fresh.length === 0) return;
    setBusy(true);
    const { error } = await supabase.from("skus").insert(fresh);
    setBusy(false);
    if (error) return toast.error(error.message);
    void logAudit("packing.paste_skus", "sku", fresh[0].code, { count: fresh.length });
    toast.success(`${fresh.length} SKUs added`);
    qc.invalidateQueries({ queryKey: ["skus"] });
    onDone();
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <Label htmlFor="sku-bulk">Paste rows: Code · Name · Unit · Line</Label>
      <Textarea
        id="sku-bulk"
        dir="ltr"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-24 font-mono text-xs"
      />
      {rows.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {fresh.length} new · {rows.length - fresh.length} already in the list ·{" "}
          {fresh.filter((r) => r.kg_per_unit === null).length} without a weight in the name ·{" "}
          {fresh.filter((r) => r.line_id === null).length} without a known line
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          className="h-11 md:h-9"
          disabled={busy || fresh.length === 0}
          onClick={save}
        >
          Add {fresh.length || ""} SKUs
        </Button>
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
