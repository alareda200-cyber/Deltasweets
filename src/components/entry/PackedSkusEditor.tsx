// One line-day of packed SKUs, editable (approved mockup "SKU Edit Mockup",
// 19 Oct 2026). Used on the daily entry (Full-day, under Packing actual) and
// on the Plan adherence page when a saved day is opened.
//   - one by one: ✎ edits that row's quantity, 🗑 removes it (↺ keeps it);
//   - all at once: "Edit all" opens every quantity, "Select" picks some or all
//     to remove together;
//   - a SKU can be added from the list in Settings › Packing.
// Nothing is written until Save; then only what changed is written and the
// day's Full-day entry takes the new total as packing actual (trigger
// tg_packed_skus_entry_actual).
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { cn } from "@/lib/utils";
import type { PackedSku, Sku } from "@/lib/packing";
import { round2 } from "@/lib/sku-paste";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const kgFmt = (n: number) => Math.round(n).toLocaleString("en-US");

interface Draft {
  key: string;
  row: PackedSku | null; // null = added here
  code: string;
  qty: string;
  gone: boolean;
  open: boolean;
  sel: boolean;
}

const fromRows = (rows: PackedSku[]): Draft[] =>
  rows.map((r) => ({
    key: r.id,
    row: r,
    code: r.code,
    qty: String(r.qty),
    gone: false,
    open: false,
    sel: false,
  }));

function parseQty(v: string): number | null {
  const t = v.replace(/,/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function PackedSkusEditor({
  day,
  lineId,
  lineLabel,
  dayLabel,
  rows,
  skus,
  canEdit,
  title = "Packed SKUs",
  className,
}: {
  day: string;
  lineId: string;
  lineLabel: string;
  dayLabel: string;
  rows: PackedSku[];
  skus: Sku[];
  canEdit: boolean;
  title?: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const skuBy = useMemo(() => new Map(skus.map((s) => [s.code, s])), [skus]);
  const lineSkus = useMemo(
    () => skus.filter((s) => s.line_id === lineId && s.is_active),
    [skus, lineId],
  );
  // Rows as saved; the draft starts from them again after every save.
  const sig = rows.map((r) => `${r.id}:${r.qty}`).join("|");
  const [draftSig, setDraftSig] = useState(sig);
  const [drafts, setDrafts] = useState<Draft[]>(() => fromRows(rows));
  if (draftSig !== sig) {
    // The saved rows changed (saved here, pasted again, or another device):
    // start over from them.
    setDraftSig(sig);
    setDrafts(fromRows(rows));
  }
  const [editAll, setEditAll] = useState(false);
  const [selMode, setSelMode] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newQty, setNewQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [seq, setSeq] = useState(0);

  // kg at today's weight; a SKU without one keeps its saved kg scaled.
  const kgFor = (code: string, q: number, prev: PackedSku | null) => {
    const w = skuBy.get(code)?.kg_per_unit;
    if (w != null) return round2(q * w);
    if (prev?.kg != null && prev.qty > 0) return round2((prev.kg * q) / prev.qty);
    return null;
  };
  const kgOf = (d: Draft) => {
    const q = parseQty(d.qty);
    if (q === null) return d.row?.kg ?? null;
    if (d.row && q === d.row.qty) return d.row.kg;
    return kgFor(d.code, q, d.row);
  };

  const live = drafts.filter((d) => !d.gone);
  const bad = live.some((d) => parseQty(d.qty) === null);
  const removed = drafts.filter((d) => d.gone && d.row);
  const added = live.filter((d) => !d.row);
  const changed = live.filter((d) => d.row && parseQty(d.qty) !== d.row.qty);
  const dirty = removed.length > 0 || added.length > 0 || changed.length > 0;
  const total = live.reduce((s, d) => s + (kgOf(d) ?? 0), 0);
  const nSel = drafts.filter((d) => d.sel && !d.gone).length;

  const patch = (key: string, p: Partial<Draft>) =>
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...p } : d)));

  function reset() {
    setDrafts(fromRows(rows));
    setEditAll(false);
    setSelMode(false);
    setNewCode("");
    setNewQty("");
  }

  function addRow() {
    const code = newCode.trim();
    const q = parseQty(newQty);
    if (!skuBy.has(code)) {
      toast.error(`${code || "That code"} isn't in Settings › Packing. Add it there first.`);
      return;
    }
    if (q === null || q === 0) {
      toast.error("Enter the quantity packed.");
      return;
    }
    setDrafts((list) => [
      ...list,
      {
        key: `new-${seq}`,
        row: null,
        code,
        qty: String(q),
        gone: false,
        open: false,
        sel: false,
      },
    ]);
    setSeq((n) => n + 1);
    setNewCode("");
    setNewQty("");
  }

  async function save() {
    if (bad) {
      toast.error("Every quantity must be a number, 0 or more.");
      return;
    }
    setBusy(true);
    try {
      if (removed.length > 0) {
        const del = await supabase
          .from("packed_skus")
          .delete()
          .in(
            "id",
            removed.map((d) => (d.row as PackedSku).id),
          );
        if (del.error) throw del.error;
      }
      for (const d of changed) {
        const r = d.row as PackedSku;
        const q = parseQty(d.qty) as number;
        const up = await supabase
          .from("packed_skus")
          .update({ qty: q, kg: kgFor(r.code, q, r) })
          .eq("id", r.id);
        if (up.error) throw up.error;
      }
      if (added.length > 0) {
        const ins = await supabase.from("packed_skus").insert(
          added.map((d) => {
            const q = parseQty(d.qty) as number;
            return {
              line_id: lineId,
              day,
              sku_id: skuBy.get(d.code)?.id ?? null,
              code: d.code,
              qty: q,
              kg: kgFor(d.code, q, null),
            };
          }),
        );
        if (ins.error) throw ins.error;
      }
      void logAudit("plan.edit_packed_day", "packed_skus", `${lineId}|${day}`, {
        day,
        changed: changed.map((d) => ({ code: d.code, from: d.row?.qty, to: parseQty(d.qty) })),
        removed: removed.map((d) => ({ code: d.code, qty: d.row?.qty })),
        added: added.map((d) => ({ code: d.code, qty: parseQty(d.qty) })),
      });
      toast.success(`${lineLabel} · ${dayLabel} saved`);
      setEditAll(false);
      setSelMode(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["packed-skus"] }),
        qc.invalidateQueries({ queryKey: ["entries"] }),
        qc.invalidateQueries({ queryKey: ["all-entries"] }),
      ]);
    } catch (err) {
      toast.error(
        `Not saved: ${err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  const listId = `packed-skus-${lineId}-${day}`;
  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="packed-editor">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {title}{" "}
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
            {live.length}
          </span>
        </p>
        {canEdit && drafts.length > 0 && (
          <span className="flex gap-1.5">
            <Button
              type="button"
              variant={selMode ? "default" : "outline"}
              className="h-11 px-3 md:h-8"
              onClick={() => {
                setSelMode((v) => !v);
                setDrafts((list) => list.map((d) => ({ ...d, sel: false })));
              }}
            >
              {selMode ? "Done" : "Select"}
            </Button>
            <Button
              type="button"
              variant={editAll ? "default" : "outline"}
              className="h-11 px-3 md:h-8"
              onClick={() => {
                setEditAll((v) => !v);
                setDrafts((list) => list.map((d) => ({ ...d, open: false })));
              }}
            >
              {editAll ? "Done" : "Edit all"}
            </Button>
          </span>
        )}
      </div>

      {selMode && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5">
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold md:min-h-8">
            <input
              type="checkbox"
              aria-label="Select all"
              className="h-4 w-4"
              checked={live.length > 0 && nSel === live.length}
              onChange={(e) =>
                setDrafts((list) => list.map((d) => ({ ...d, sel: !d.gone && e.target.checked })))
              }
            />
            All
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={nSel === 0}
            className="ml-auto h-11 border-destructive/40 text-destructive-strong md:h-8"
            onClick={() =>
              setDrafts((list) =>
                list.map((d) => (d.sel ? { ...d, gone: true, sel: false, open: false } : d)),
              )
            }
          >
            {nSel === 0
              ? "Remove selected"
              : nSel === live.length
                ? `Remove all ${nSel}`
                : `Remove ${nSel}`}
          </Button>
        </div>
      )}

      {drafts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          No packed SKUs for this day yet. Paste the day&rsquo;s sheet on Plan adherence
          {canEdit ? ", or add them one by one below" : ""}.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {drafts.map((d) => {
            const sku = skuBy.get(d.code);
            const open = (editAll || d.open) && !d.gone && canEdit;
            const q = parseQty(d.qty);
            const isChanged = !!d.row && q !== d.row.qty;
            const k = kgOf(d);
            return (
              <li
                key={d.key}
                data-testid="packed-row"
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-sm",
                  d.gone && "opacity-50",
                  d.sel && "bg-primary/5",
                  !d.row && "bg-primary/5",
                )}
              >
                {selMode && (
                  <input
                    type="checkbox"
                    aria-label={`Select ${d.code}`}
                    className="h-4 w-4 shrink-0"
                    disabled={d.gone}
                    checked={d.sel}
                    onChange={(e) => patch(d.key, { sel: e.target.checked })}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="font-mono">{d.code}</span>
                    {!d.row && (
                      <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                        new
                      </span>
                    )}
                  </span>
                  <span
                    dir="rtl"
                    className={cn(
                      "block truncate text-right sm:text-left",
                      d.gone && "line-through",
                    )}
                  >
                    {sku?.name || "—"}
                  </span>
                </div>
                {open ? (
                  <Input
                    aria-label={`Quantity for ${d.code}`}
                    inputMode="decimal"
                    autoFocus={d.open && !editAll}
                    value={d.qty}
                    onChange={(e) => patch(d.key, { qty: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && patch(d.key, { open: false })}
                    className={cn(
                      "h-11 w-24 shrink-0 text-right tabular-nums md:h-8",
                      q === null && "border-destructive",
                      q !== null && isChanged && "border-primary",
                    )}
                  />
                ) : (
                  <span
                    className={cn(
                      "w-16 shrink-0 text-right font-semibold tabular-nums",
                      isChanged && "text-primary",
                    )}
                  >
                    {q === null ? d.qty : num(q)}
                  </span>
                )}
                <span className="hidden w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">
                  {k === null ? "no kg" : `${num(k)} kg`}
                </span>
                {canEdit &&
                  (d.gone ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Keep ${d.code}`}
                      className="h-11 w-11 shrink-0 text-primary md:h-8 md:w-8"
                      onClick={() => patch(d.key, { gone: false })}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  ) : (
                    <>
                      {!editAll && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={d.open ? `Done with ${d.code}` : `Edit ${d.code}`}
                          className="h-11 w-11 shrink-0 text-muted-foreground md:h-8 md:w-8"
                          onClick={() => patch(d.key, { open: !d.open })}
                        >
                          {d.open ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${d.code}`}
                        className="h-11 w-11 shrink-0 text-muted-foreground hover:text-destructive-strong md:h-8 md:w-8"
                        onClick={() =>
                          d.row
                            ? patch(d.key, { gone: true, open: false, sel: false })
                            : setDrafts((list) => list.filter((x) => x.key !== d.key))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  ))}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 basis-36 flex-col gap-1 text-xs font-semibold">
            Add SKU
            <Input
              aria-label="Item code to add"
              list={listId}
              inputMode="numeric"
              placeholder="Item code"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              className="h-11 md:h-9"
            />
            <datalist id={listId}>
              {lineSkus.map((s) => (
                <option key={s.id} value={s.code}>
                  {s.name}
                </option>
              ))}
            </datalist>
          </label>
          <label className="flex w-24 flex-col gap-1 text-xs font-semibold">
            Quantity
            <Input
              aria-label="Quantity to add"
              inputMode="decimal"
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addRow();
                }
              }}
              className="h-11 text-right tabular-nums md:h-9"
            />
          </label>
          <Button type="button" variant="outline" className="h-11 md:h-9" onClick={addRow}>
            <Plus className="mr-1 h-4 w-4" />
            Add
          </Button>
        </div>
      )}
      {canEdit && newCode.trim() && skuBy.get(newCode.trim()) && (
        <p dir="rtl" className="text-right text-xs text-muted-foreground sm:text-left">
          {skuBy.get(newCode.trim())?.name}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm" data-testid="packed-total">
          Total <span className="font-semibold tabular-nums">{kgFmt(total)} kg</span>
          {dirty && <span className="text-muted-foreground"> · not saved</span>}
        </span>
        {canEdit && dirty && (
          <>
            <Button type="button" variant="outline" className="h-11 md:h-9" onClick={reset}>
              Cancel
            </Button>
            <Button type="button" className="h-11 md:h-9" disabled={busy || bad} onClick={save}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </>
        )}
      </div>
      {canEdit && dirty && live.length === 0 && (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs font-medium text-warning-strong">
          With every SKU removed, the day&rsquo;s packing actual stays at its last figure; type it
          on the entry if it should change.
        </p>
      )}
    </div>
  );
}
