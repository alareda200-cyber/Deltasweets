import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, ChevronDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import type { MachineLine } from "@/lib/entry-form";
import type { MachineRun, PackingMachine, Sku } from "@/lib/packing";
import { unitOfMachines, unitWord } from "@/lib/packing";
import type { MachineOee } from "@/lib/oee";
import { bagsKg } from "@/lib/oee";
import { parseMachineSheet, summariseSheet } from "@/lib/machine-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/settings/shared";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const kgFmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const SHIFTS = ["A", "B", "C"] as const;
const SHIFT_DOT = { A: "bg-chart-1", B: "bg-chart-4", C: "bg-chart-3" } as const;
const n0 = (n: number) => Math.round(n).toLocaleString("en-US");

// Packing machines on the daily entry. On a Full-day entry the machine sheet
// is pasted from Excel (Ala, 20 Oct 2026): each machine then shows its
// shifts A · B · C with the bags, SKUs and operator, and the database sums
// them into the shifts and bags the OEE reads. Without a sheet the shifts
// (0–3), bags and bag weight are typed as before. The OEE for the day is
// shown live, with the faults logged on the machine in Maintenance.
export function PackingMachinesBlock({
  machines,
  rows,
  onChange,
  oee,
  errors,
  skuKg,
  disabled,
  day,
  fullDay,
  allMachines,
  skus,
  runs,
  wrapped,
}: {
  machines: PackingMachine[];
  rows: MachineLine[];
  onChange: (rows: MachineLine[]) => void;
  oee: Map<string, MachineOee>;
  errors?: Record<string, string>;
  skuKg: number | null;
  disabled?: boolean;
  day: string;
  fullDay: boolean;
  allMachines: PackingMachine[];
  skus: Sku[];
  runs: MachineRun[];
  /** Wrapped SKUs ("مغلف") packed for this line that day (Plan adherence). */
  wrapped?: { code: string; name: string; qty: number; kg: number }[];
}) {
  const qc = useQueryClient();
  // Twist machines count wrapped pieces. Their paper is linked to whatever
  // wrapped SKU was packed the same day (Ala, 23 Oct 2026), and their kg is
  // compared with those SKUs, not with every SKU of the line.
  const piecesLine = machines.length > 0 && machines.every((m) => m.count_unit === "pieces");
  const wrappedKg = (wrapped ?? []).reduce((t, w) => t + w.kg, 0);
  const wrappedCodes = (wrapped ?? []).map((w) => w.code);
  const [pasting, setPasting] = useState(false);
  // Delete the whole sheet of the day, or one row of it (Ala, 20 Oct 2026).
  const [confirm, setConfirm] = useState<null | { all: true } | { run: MachineRun }>(null);
  const mineIds = useMemo(() => new Set(machines.map((m) => m.id)), [machines]);
  const myRuns = runs.filter((r) => mineIds.has(r.machine_id));
  const sheetMode = fullDay && myRuns.length > 0;
  const byId = new Map(rows.map((r) => [r.machine_id, r]));
  const rowOf = (id: string): MachineLine =>
    byId.get(id) ?? { machine_id: id, shifts: 0, bags: "", bagG: "" };
  function set(id: string, patch: Partial<MachineLine>) {
    const next = { ...rowOf(id), ...patch };
    onChange([...rows.filter((r) => r.machine_id !== id), next]);
  }
  const machinesKg = machines.reduce((s, m) => {
    const r = rowOf(m.id);
    return s + (r.shifts > 0 ? (bagsKg(Number(r.bags) || 0, Number(r.bagG) || null) ?? 0) : 0);
  }, 0);
  const anyRun = machines.some((m) => rowOf(m.id).shifts > 0);
  // A machine can pack another line's SKUs (Rovema 4 packs Marshmallows). The
  // machine's OEE stays with its line, but those SKUs' kg belong to their own
  // line (Ala, 25 Oct 2026), so they leave this line's machines-vs-SKUs check.
  const lineId = machines[0]?.line_id;
  const skuLine = useMemo(() => new Map(skus.map((x) => [x.id, x.line_id])), [skus]);
  const otherRuns = sheetMode
    ? myRuns.filter((r) => {
        const l = r.sku_id ? skuLine.get(r.sku_id) : null;
        return !!l && l !== lineId;
      })
    : [];
  const otherKg = otherRuns.reduce((t, r) => t + (bagsKg(r.bags, r.bag_g) ?? 0), 0);
  const ownKg = machinesKg - otherKg;

  // The form's machine lines follow the sheet rows that are left, the same
  // way the database sums them, so saving the entry afterwards agrees.
  function followRuns(left: MachineRun[]) {
    const summary = summariseSheet(
      left.map((r) => ({ machineId: r.machine_id, shift: r.shift, bags: r.bags, bagG: r.bag_g })),
    );
    onChange(
      machines.map((m) => {
        const s = summary.get(m.id);
        return s
          ? {
              machine_id: m.id,
              shifts: s.shifts,
              bags: String(s.bags),
              bagG: s.bagG === null ? "" : String(s.bagG),
            }
          : { machine_id: m.id, shifts: 0, bags: "", bagG: "" };
      }),
    );
  }

  async function deleteRuns(): Promise<boolean> {
    if (!confirm) return false;
    const q =
      "all" in confirm
        ? supabase
            .from("machine_runs")
            .delete()
            .eq("day", day)
            .in(
              "machine_id",
              machines.map((m) => m.id),
            )
        : supabase.from("machine_runs").delete().eq("id", confirm.run.id);
    const { error } = await q;
    if (error) {
      toast.error(`Not deleted: ${error.message}`);
      return false;
    }
    const left = "all" in confirm ? [] : myRuns.filter((r) => r.id !== confirm.run.id);
    void logAudit(
      "all" in confirm ? "entry.delete_machine_sheet" : "entry.delete_machine_run",
      "machine_runs",
      "all" in confirm ? day : confirm.run.id,
      "all" in confirm
        ? { day, rows: myRuns.length }
        : { day, shift: confirm.run.shift, code: confirm.run.code, bags: confirm.run.bags },
    );
    toast.success("all" in confirm ? "Machine sheet deleted" : "Row deleted");
    followRuns(left);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["machine-runs", day] }),
      qc.invalidateQueries({ queryKey: ["entry-machines"] }),
    ]);
    return true;
  }
  const confirmRun = confirm && "run" in confirm ? confirm.run : null;
  const confirmMachine = confirmRun ? machines.find((m) => m.id === confirmRun.machine_id) : null;

  return (
    <div data-testid="packing-machines" className="flex flex-col gap-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Packing machines
        </p>
        {fullDay && !disabled && (
          <div className="flex flex-wrap gap-2">
            {sheetMode && !pasting && (
              <Button
                type="button"
                variant="outline"
                className="h-11 text-destructive-strong md:h-9"
                onClick={() => setConfirm({ all: true })}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Delete sheet
              </Button>
            )}
            <Button
              type="button"
              variant={pasting ? "outline" : sheetMode ? "outline" : "default"}
              className="h-11 md:h-9"
              onClick={() => setPasting((v) => !v)}
            >
              <ClipboardPaste className="mr-1.5 h-4 w-4" />
              {pasting ? "Close" : sheetMode ? "Paste the sheet again" : "Paste machine sheet"}
            </Button>
          </div>
        )}
      </div>
      {pasting && (
        <SheetPastePanel
          day={day}
          lineMachines={machines}
          allMachines={allMachines}
          skus={skus}
          onSaved={(saved) => {
            followRuns(saved);
            setPasting(false);
          }}
          onCancel={() => setPasting(false)}
        />
      )}
      <div className="flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-4">
        {sheetMode
          ? machines.map((m) => (
              <SheetMachineCard
                key={m.id}
                machine={m}
                runs={myRuns.filter((r) => r.machine_id === m.id)}
                line={rowOf(m.id)}
                oee={oee.get(m.id)}
                onDelete={disabled ? undefined : (run) => setConfirm({ run })}
                linkedCodes={m.count_unit === "pieces" ? wrappedCodes : undefined}
              />
            ))
          : machines.map((m) => {
              const r = rowOf(m.id);
              const o = oee.get(m.id);
              const kg = bagsKg(Number(r.bags) || 0, Number(r.bagG) || null);
              const err = errors?.[m.id];
              return (
                <div
                  key={m.id}
                  data-testid={`machine-${m.name}`}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border border-border p-3",
                    err && "border-destructive",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{m.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {m.speed_per_min} {m.count_unit}/min
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-semibold">Shifts run</span>
                    <div className="flex gap-1.5" role="group" aria-label={`${m.name} shifts run`}>
                      {[0, 1, 2, 3].map((s) => (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={r.shifts === s}
                          disabled={disabled}
                          onClick={() => set(m.id, { shifts: s })}
                          className={cn(
                            "h-11 min-w-11 flex-1 rounded-md border text-sm font-semibold tabular-nums transition-colors",
                            r.shifts === s
                              ? "border-foreground bg-foreground text-background"
                              : "border-border bg-card hover:bg-muted",
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  {r.shifts > 0 ? (
                    <>
                      <div className="grid grid-cols-[1.3fr_1fr] gap-2">
                        <label className="flex flex-col gap-1 text-xs font-semibold">
                          {m.count_unit === "pieces" ? "Pieces" : "Bags"}
                          <Input
                            type="number"
                            inputMode="numeric"
                            className="h-11 text-base"
                            aria-label={`${m.name} ${m.count_unit}`}
                            value={r.bags}
                            disabled={disabled}
                            onChange={(e) => set(m.id, { bags: e.target.value })}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-semibold">
                          Bag weight (g)
                          <Input
                            type="number"
                            inputMode="decimal"
                            className="h-11 text-base"
                            aria-label={`${m.name} bag weight in grams`}
                            value={r.bagG}
                            disabled={disabled}
                            onChange={(e) => set(m.id, { bagG: e.target.value })}
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {o && o.faultMin > 0 && (
                          <span className="rounded-full bg-warning/15 px-2 py-0.5 font-semibold text-warning-strong">
                            {Math.round(o.faultMin)} min faults
                          </span>
                        )}
                        {kg !== null && <span className="tabular-nums">{kgFmt(kg)} kg</span>}
                        {o && (
                          <>
                            <span>· A {pct(o.A)}</span>
                            <span>· P {pct(o.P)}</span>
                            <span className="font-semibold text-foreground">
                              · OEE {pct(o.oee)}
                            </span>
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {o?.openFault ? (
                        <span className="mr-1 rounded-full bg-destructive/10 px-2 py-0.5 font-semibold text-destructive-strong">
                          Open fault
                        </span>
                      ) : null}
                      Didn&rsquo;t run · left out of the OEE
                    </p>
                  )}
                  {err && <p className="text-xs font-medium text-destructive">{err}</p>}
                </div>
              );
            })}
      </div>
      {sheetMode && (
        <p className="text-xs text-muted-foreground">
          From the machine sheet: a shift with rows counts as run (480 min). P ={" "}
          {unitOfMachines(machines)} ÷ (the machine&rsquo;s speed in Settings × those minutes);
          D-Speed is shown next to each row.
        </p>
      )}
      {piecesLine && anyRun && (
        <div
          data-testid="machines-vs-wrapped"
          className={cn(
            "flex flex-col gap-1.5 rounded-lg px-3 py-2 text-xs font-medium",
            wrappedKg > 0 && Math.abs(machinesKg - wrappedKg) <= wrappedKg * 0.05
              ? "bg-success/10 text-success-strong"
              : "bg-warning/10 text-warning-strong",
          )}
        >
          {wrappedKg > 0 ? (
            <>
              <span>
                Wrapped {kgFmt(machinesKg)} kg on the machines vs wrapped SKUs packed{" "}
                {kgFmt(wrappedKg)} kg ({machinesKg - wrappedKg >= 0 ? "+" : ""}
                {kgFmt(machinesKg - wrappedKg)} kg).
              </span>
              <span className="flex flex-wrap gap-1.5 font-normal text-foreground">
                {(wrapped ?? []).map((w) => (
                  <span
                    key={w.code}
                    className="rounded-md border border-border bg-card px-2 py-0.5 tabular-nums"
                  >
                    {w.code} · <span dir="auto">{w.name}</span> · {n0(w.qty)} · {kgFmt(w.kg)} kg
                  </span>
                ))}
              </span>
            </>
          ) : (
            <span>No wrapped SKU packed this day — paste the packed SKUs on Plan adherence.</span>
          )}
        </div>
      )}
      {!piecesLine && anyRun && skuKg !== null && skuKg > 0 && (
        <p
          data-testid="machines-vs-skus"
          className={cn(
            "rounded-lg px-3 py-2 text-xs font-medium",
            Math.abs(ownKg - skuKg) <= skuKg * 0.05
              ? "bg-success/10 text-success-strong"
              : "bg-warning/10 text-warning-strong",
          )}
        >
          Machines {kgFmt(ownKg)} kg vs SKUs {kgFmt(skuKg)} kg ({ownKg - skuKg >= 0 ? "+" : ""}
          {kgFmt(ownKg - skuKg)} kg).
          {otherKg > 0 && (
            <span data-testid="machines-other-line" className="block font-normal">
              {[...new Set(otherRuns.map((r) => machines.find((m) => m.id === r.machine_id)?.name))]
                .filter(Boolean)
                .join(", ")}{" "}
              also packed {kgFmt(otherKg)} kg of other lines&rsquo; SKUs — counted on their line,
              not here.
            </span>
          )}
        </p>
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirmRun
            ? `Delete this row of ${confirmMachine?.name ?? "the machine"} · shift ${confirmRun.shift}?`
            : `Delete the machine sheet of ${day}?`
        }
        description={
          confirmRun ? (
            <p>
              <span dir="auto">{confirmRun.name || confirmRun.code}</span> · {n0(confirmRun.bags)}{" "}
              {confirmMachine?.count_unit ?? "bags"}
              {confirmRun.operator ? (
                <>
                  {" "}
                  · <span dir="auto">{confirmRun.operator}</span>
                </>
              ) : null}
              . The machine&rsquo;s shifts and bags for the day are worked out again from the rows
              left.
            </p>
          ) : (
            <p>
              All {myRuns.length} rows of this line&rsquo;s machines are deleted, with their shifts
              and bags on the day&rsquo;s entry. Paste the sheet again or type the machines by hand
              afterwards.
            </p>
          )
        }
        onConfirm={deleteRuns}
      />
    </div>
  );
}

function SheetMachineCard({
  machine,
  runs,
  line,
  oee,
  onDelete,
  linkedCodes,
}: {
  machine: PackingMachine;
  runs: MachineRun[];
  line: MachineLine;
  oee: MachineOee | undefined;
  onDelete?: (run: MachineRun) => void;
  /** Twist: the wrapped SKUs packed that day, which its paper rows link to. */
  linkedCodes?: string[];
}) {
  const unit = machine.count_unit;
  const item = unit === "pieces" ? "paper" : "SKU";
  const [open, setOpen] = useState(false);
  const bags = runs.reduce((s, r) => s + r.bags, 0);
  const kg = bagsKg(Number(line.bags) || 0, Number(line.bagG) || null);
  return (
    <div
      data-testid={`machine-${machine.name}`}
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{machine.name}</span>
        <span className="text-xs text-muted-foreground">
          {machine.speed_per_min} {unit}/min
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={`${machine.name} shifts`}>
        {SHIFTS.map((s) => {
          const rs = runs.filter((r) => r.shift === s);
          const b = rs.reduce((t, r) => t + r.bags, 0);
          return (
            <div
              key={s}
              data-testid={`machine-${machine.name}-shift-${s}`}
              className={cn(
                "flex min-h-14 min-w-0 flex-col gap-0.5 rounded-md border p-1.5",
                rs.length ? "border-border" : "border-dashed border-border",
              )}
            >
              <span className="flex items-center gap-1.5 text-xs font-bold">
                <span
                  className={cn("h-2 w-2 rounded-full", rs.length ? SHIFT_DOT[s] : "bg-border")}
                  aria-hidden="true"
                />
                {s}
              </span>
              <span
                className={cn(
                  "text-[13px] font-bold tabular-nums",
                  !rs.length && "font-medium text-muted-foreground",
                )}
              >
                {rs.length ? n0(b) : "Off"}
              </span>
              {rs.length > 0 && (
                <span className="truncate text-[11px] text-muted-foreground">
                  {rs.length} {rs.length === 1 ? item : `${item}s`}
                  {rs[0].operator ? ` · ${rs[0].operator.split(" ")[0]}` : ""}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {runs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {oee?.openFault ? (
            <span className="mr-1 rounded-full bg-destructive/10 px-2 py-0.5 font-semibold text-destructive-strong">
              Open fault
            </span>
          ) : null}
          Not in the sheet · didn&rsquo;t run
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {line.shifts} {line.shifts === 1 ? "shift" : "shifts"} · {n0(bags)}{" "}
              {unitWord(unit, bags)}
            </span>
            {kg !== null && <span className="tabular-nums">· {n0(kg)} kg</span>}
            {oee && oee.faultMin > 0 && (
              <span className="rounded-full bg-warning/15 px-2 py-0.5 font-semibold text-warning-strong">
                {Math.round(oee.faultMin)} min faults
              </span>
            )}
            {oee && (
              <>
                <span>· A {pct(oee.A)}</span>
                <span>· P {pct(oee.P)}</span>
                <span className="font-semibold text-foreground">· OEE {pct(oee.oee)}</span>
              </>
            )}
          </div>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex min-h-11 items-center gap-1 self-start text-xs font-semibold text-primary md:min-h-8"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
            {open
              ? `Hide ${item}s`
              : `${item === "paper" ? "Papers" : "SKUs"} and operators (${runs.length})`}
          </button>
          {open && (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-xs">
              {runs.map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="w-4 shrink-0 font-bold">{r.shift}</span>
                  <span className="min-w-0 flex-1">
                    <span dir="rtl" className="block truncate text-right sm:text-left">
                      {r.name || r.code}
                    </span>
                    <span className="block truncate text-muted-foreground" dir="auto">
                      {r.operator || "—"}
                    </span>
                    {linkedCodes && !r.sku_id && (
                      <span
                        className="block truncate text-muted-foreground tabular-nums"
                        title={`Paper ${r.code}`}
                      >
                        → {linkedCodes.length ? linkedCodes.join(" · ") : "no wrapped SKU packed"}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block font-semibold">{n0(r.bags)}</span>
                    {r.set_speed !== null && (
                      <span
                        className={cn(
                          "block",
                          r.set_speed < machine.speed_per_min
                            ? "text-warning-strong"
                            : "text-muted-foreground",
                        )}
                      >
                        {r.set_speed} / {machine.speed_per_min}
                      </span>
                    )}
                  </span>
                  {onDelete && (
                    <button
                      type="button"
                      aria-label={`Delete ${r.name || r.code}, shift ${r.shift}`}
                      onClick={() => onDelete(r)}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive-strong md:h-8 md:w-8"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function SheetPastePanel({
  day,
  lineMachines,
  allMachines,
  skus,
  onSaved,
  onCancel,
}: {
  day: string;
  lineMachines: PackingMachine[];
  allMachines: PackingMachine[];
  skus: Sku[];
  onSaved: (runs: MachineRun[]) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const skuMap = useMemo(() => new Map(skus.map((s) => [s.code, s])), [skus]);
  const sheet = useMemo(
    () => parseMachineSheet(text, { machines: allMachines, skus: skuMap }),
    [text, allMachines, skuMap],
  );
  const good = sheet.rows.filter((r) => r.machine);

  async function save() {
    if (good.length === 0) return;
    setBusy(true);
    try {
      // The sheet is the whole day: it replaces what these machines had.
      const ids = [
        ...new Set([...lineMachines.map((m) => m.id), ...good.map((r) => r.machine!.id)]),
      ];
      const del = await supabase.from("machine_runs").delete().eq("day", day).in("machine_id", ids);
      if (del.error) throw del.error;
      const ins = await supabase.from("machine_runs").insert(
        good.map((r) => ({
          day,
          shift: r.shift,
          machine_id: r.machine!.id,
          sku_id: r.sku?.id ?? null,
          code: r.code,
          name: r.name,
          operator: r.operator || null,
          film_weight: r.film,
          set_speed: r.setSpeed,
          bags: r.bags,
          bag_g: r.bagG,
        })),
      );
      if (ins.error) throw ins.error;
      void logAudit("entry.paste_machine_sheet", "machine_runs", day, {
        rows: good.length,
        machines: [...new Set(good.map((r) => r.machine!.name))],
      });
      toast.success(`Machine sheet saved: ${good.length} rows`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["machine-runs", day] }),
        qc.invalidateQueries({ queryKey: ["entry-machines"] }),
      ]);
      onSaved(
        good.map((r, i) => ({
          id: `new-${i}`,
          day,
          shift: r.shift,
          machine_id: r.machine!.id,
          sku_id: r.sku?.id ?? null,
          code: r.code,
          name: r.name,
          operator: r.operator || null,
          film_weight: r.film,
          set_speed: r.setSpeed,
          bags: r.bags,
          bag_g: r.bagG,
        })),
      );
    } catch (err) {
      toast.error(
        `Not saved: ${err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex flex-col gap-2.5 rounded-lg border border-primary/40 bg-primary/5 p-3"
      data-testid="machine-sheet-panel"
    >
      <p className="text-xs text-muted-foreground">
        Copy the machine sheet from Excel, every shift at once: Code · Type · Operator · Bag weight
        · Machine · D-Speed · Total Quantity · Shift. Twist sheets have Paper weight · Piece weight
        in place of Bag weight. It replaces what the machines had for this day.
      </p>
      <Textarea
        aria-label="Machine sheet rows"
        dir="ltr"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Code · Type · Operator · Bag weight · Machine · D-Speed · Total Quantity · Shift"
        className="min-h-28 font-mono text-xs"
      />
      {sheet.rows.length > 0 && (
        <div
          className="overflow-x-auto rounded-md border border-border bg-card"
          data-testid="machine-sheet-preview"
        >
          <table className="w-full text-xs">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold">Machine</th>
                <th className="px-2 py-1.5 text-left font-semibold">SKU / paper</th>
                <th className="px-2 py-1.5 text-right font-semibold">Qty</th>
                <th className="px-2 py-1.5 text-right font-semibold">D-Speed</th>
                <th className="px-2 py-1.5 text-left font-semibold">Operator</th>
              </tr>
            </thead>
            <tbody>
              {SHIFTS.map((s) => {
                const rs = sheet.rows.filter((r) => r.shift === s);
                if (rs.length === 0) return null;
                return [
                  <tr key={`h-${s}`} className="border-t border-border bg-muted/40">
                    <td colSpan={5} className="px-2 py-1 font-semibold">
                      Shift {s} · {rs.length} rows · {n0(rs.reduce((t, r) => t + r.bags, 0))}{" "}
                      {unitOfMachines(rs.flatMap((r) => (r.machine ? [r.machine] : [])))}
                    </td>
                  </tr>,
                  ...rs.map((r, i) => (
                    <tr key={`${s}-${i}`} className="border-t border-border">
                      <td
                        className={cn(
                          "whitespace-nowrap px-2 py-1",
                          !r.machine && "font-semibold text-destructive-strong",
                        )}
                      >
                        {r.machine?.name ?? r.machineName}
                      </td>
                      <td dir="rtl" className="max-w-40 truncate px-2 py-1 text-right">
                        {r.name}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{n0(r.bags)}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                        {r.setSpeed ?? "—"}
                        {r.machine && r.setSpeed !== null && r.setSpeed < r.machine.speed_per_min
                          ? ` / ${r.machine.speed_per_min}`
                          : ""}
                      </td>
                      <td dir="auto" className="max-w-32 truncate px-2 py-1">
                        {r.operator}
                      </td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {sheet.unknownMachines.length > 0 && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-xs font-medium text-warning-strong">
          Not in Settings › Packing: {sheet.unknownMachines.join(", ")}. Those rows are left out.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          className="h-11 md:h-9"
          disabled={busy || good.length === 0}
          onClick={save}
        >
          {busy ? "Saving…" : `Save ${good.length || ""} rows`}
        </Button>
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
