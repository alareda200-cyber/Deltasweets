// Settings › Packing (November 2026 monthly upgrade, approved mockup):
//   - packing machines and their ideal speed (bags per minute), used by the
//     packing OEE;
//   - the SKU list with kg per unit, used when SKUs are pasted into the daily
//     entry.
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
              kg per unit turns the cartons pasted in the daily entry into packed kg. It is read
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
              }}
            >
              Add SKU
            </Button>
          </div>
        </div>
        {isError && <p className="text-sm text-destructive-strong">The SKUs didn&rsquo;t load.</p>}
        {adding && <AddSku lines={lines} skus={skus} qc={qc} onDone={() => setAdding(false)} />}
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

        <div className="space-y-1.5" data-testid="sku-list">
          {shown.slice(0, SHOWN).map((s) => {
            const draft = editingKg[s.id];
            return (
              <div
                key={s.id}
                className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2 text-sm sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <CodeChip>{s.code}</CodeChip>
                    <span className="text-xs text-muted-foreground">
                      {lineName(s.line_id)}
                      {s.unit ? ` · ${s.unit}` : ""}
                    </span>
                    {!s.is_active && <InactiveChip />}
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
    </Card>
  );
}

function AddSku({
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
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("كرتونة");
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const [kg, setKg] = useState("");
  const fromName = kgPerUnitFromName(name, unit);

  async function save() {
    const c = code.trim();
    if (!c) return toast.error("Enter the item code.");
    if (skus.some((s) => s.code === c)) return toast.error(`${c} is already in the list.`);
    const k = kg.trim() === "" ? fromName : Number(kg);
    if (k !== null && !(k > 0)) return toast.error("kg per unit must be more than 0.");
    const { error } = await supabase.from("skus").insert({
      code: c,
      name: name.trim(),
      unit: unit.trim() || null,
      line_id: lineId || null,
      kg_per_unit: k,
    });
    if (error) return toast.error(error.message);
    void logAudit("packing.add_sku", "sku", c, { name, kg_per_unit: k });
    toast.success(`${c} added`);
    qc.invalidateQueries({ queryKey: ["skus"] });
    onDone();
  }

  return (
    <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
      <TextField label="Item code" value={code} onChange={setCode} placeholder="403009999" />
      <TextField
        label="Name"
        value={name}
        onChange={setName}
        placeholder="كاندى كولا 32 كيس × 45 جم"
      />
      <TextField label="Unit" value={unit} onChange={setUnit} />
      <div className="space-y-1.5">
        <Label htmlFor="sku-line">Line</Label>
        <select
          id="sku-line"
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
        label="kg per unit"
        value={kg}
        onChange={setKg}
        placeholder={fromName !== null ? String(fromName) : "fill in"}
        hint={
          fromName !== null ? `From the name: ${kgFmt(fromName)} kg` : "The name doesn't say it"
        }
      />
      <div className="flex items-end gap-2">
        <Button type="button" className="h-11 md:h-9" onClick={save}>
          Add SKU
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
