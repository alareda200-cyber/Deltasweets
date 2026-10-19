import type { MachineLine } from "@/lib/entry-form";
import type { PackingMachine } from "@/lib/packing";
import type { MachineOee } from "@/lib/oee";
import { bagsKg } from "@/lib/oee";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const kgFmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

// Packing machines on the daily entry: for each machine, the shifts it ran
// (0–3), the bags it packed and the bag weight. Its OEE for the day is shown
// live from these and the faults logged on it in Maintenance.
export function PackingMachinesBlock({
  machines,
  rows,
  onChange,
  oee,
  errors,
  skuKg,
  disabled,
}: {
  machines: PackingMachine[];
  rows: MachineLine[];
  onChange: (rows: MachineLine[]) => void;
  oee: Map<string, MachineOee>;
  errors?: Record<string, string>;
  skuKg: number | null;
  disabled?: boolean;
}) {
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

  return (
    <div data-testid="packing-machines" className="flex flex-col gap-3 border-t border-border pt-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Packing machines
      </p>
      <div className="flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-4">
        {machines.map((m) => {
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
                <span className="text-xs text-muted-foreground">{m.speed_per_min} bags/min</span>
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
                      Bags
                      <Input
                        type="number"
                        inputMode="numeric"
                        className="h-11 text-base"
                        aria-label={`${m.name} bags`}
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
                        <span className="font-semibold text-foreground">· OEE {pct(o.oee)}</span>
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
      {anyRun && skuKg !== null && skuKg > 0 && (
        <p
          data-testid="machines-vs-skus"
          className={cn(
            "rounded-lg px-3 py-2 text-xs font-medium",
            Math.abs(machinesKg - skuKg) <= skuKg * 0.05
              ? "bg-success/10 text-success-strong"
              : "bg-warning/10 text-warning-strong",
          )}
        >
          Machines {kgFmt(machinesKg)} kg vs SKUs {kgFmt(skuKg)} kg (
          {machinesKg - skuKg >= 0 ? "+" : ""}
          {kgFmt(machinesKg - skuKg)} kg).
        </p>
      )}
    </div>
  );
}
