// Upload the FG workbook on Plan adherence (approved mockup "Plan adherence
// upgrade v2", 28 Oct 2026). The file is read in the browser
// (src/lib/xlsx-read.ts, src/lib/fg-workbook.ts), shown for a check, then
// saved part by part; each part replaces what the app had for the same days
// or months, so uploading the same workbook again changes nothing:
//   packed SKUs  → the days in Entry, on the lines in the file
//   forecast     → each month with a forecast in Items (admins)
//   orders       → each month in B2B & Export
// A Full-day entry from 1 Oct 2026 takes its packing actual from its line's
// packed SKUs (the database trigger); older days keep theirs.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { logAudit } from "@/lib/audit";
import type { Sku } from "@/lib/packing";
import { Workbook } from "@/lib/xlsx-read";
import { planImport, readFgWorkbook, type ImportPlan } from "@/lib/fg-workbook";
import { monthShort, shortDay, tons } from "@/components/plan/format";

const chunk = <T,>(list: T[], n: number) =>
  Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

export function FgUploadPanel({
  skus,
  lines,
  canForecast,
  onDone,
}: {
  skus: Sku[];
  lines: { id: string; name: string }[];
  canForecast: boolean;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [file, setFile] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [parts, setParts] = useState({ packed: true, forecast: canForecast, orders: true });
  const lineName = (id: string) => lines.find((l) => l.id === id)?.name ?? "—";

  async function pick(f: File | undefined) {
    if (!f) return;
    setFile(f.name);
    setPlan(null);
    setErr(null);
    setReading(true);
    try {
      const wb = await Workbook.open(await f.arrayBuffer());
      const fg = await readFgWorkbook(wb);
      setMissing(fg.missing);
      setSkipped(fg.skipped);
      setPlan(planImport(fg, { skus, lines }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  }

  async function save() {
    if (!plan) return;
    let step = "saving";
    const at = (s: string) => {
      step = s;
      setBusy(s);
    };
    try {
      if (parts.packed && plan.packed.length > 0) {
        const dayChunks = chunk(plan.days, 20);
        for (const [i, days] of dayChunks.entries()) {
          at(`Packed SKUs ${i + 1} / ${dayChunks.length}…`);
          const del = await supabase
            .from("packed_skus")
            .delete()
            .in("day", days)
            .in("line_id", plan.lineIds);
          if (del.error) throw del.error;
          const set = new Set(days);
          for (const rows of chunk(
            plan.packed.filter((p) => set.has(p.day)),
            500,
          )) {
            const ins = await supabase.from("packed_skus").insert(rows);
            if (ins.error) throw ins.error;
          }
        }
      }
      if (parts.forecast && canForecast) {
        for (const month of plan.forecastMonths) {
          at(`Forecast ${monthShort(month)}…`);
          const del = await supabase.from("sku_forecasts").delete().eq("month", month);
          if (del.error) throw del.error;
          const ins = await supabase
            .from("sku_forecasts")
            .insert(plan.forecasts.filter((f) => f.month === month));
          if (ins.error) throw ins.error;
        }
      }
      if (parts.orders) {
        for (const month of plan.orderMonths) {
          at(`Orders ${monthShort(month)}…`);
          const del = await supabase.from("sku_orders").delete().eq("month", month);
          if (del.error) throw del.error;
          const ins = await supabase.from("sku_orders").insert(
            plan.orders
              .filter((o) => o.month === month)
              .map((o) => ({
                month: o.month,
                seq: o.seq,
                sku_id: o.sku_id,
                code: o.code,
                order_code: o.order_code,
                qty: o.qty,
                client: o.client,
                country: o.country,
                type: o.type,
                pm_date: o.pm_date,
                delay_reason: o.delay_reason,
                note: o.note ?? null,
              })),
          );
          if (ins.error) throw ins.error;
        }
      }
      void logAudit("plan.upload_fg", "packed_skus", file ?? "workbook", {
        days: plan.days.length,
        packed: parts.packed ? plan.packed.length : 0,
        forecastMonths: parts.forecast ? plan.forecastMonths : [],
        orders: parts.orders ? plan.orders.length : 0,
      });
      toast.success("FG workbook saved");
      await Promise.all(
        ["packed-skus", "sku-forecasts", "sku-orders", "entries", "all-entries"].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      );
      onDone();
    } catch (e) {
      toast.error(
        `Stopped at ${step}: ${e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)}. Upload the file again to finish; it replaces the same days.`,
      );
    } finally {
      setBusy(null);
    }
  }

  // preview by month
  const months = plan
    ? [
        ...new Set([
          ...plan.days.map((d) => `${d.slice(0, 7)}-01`),
          ...plan.forecastMonths,
          ...plan.orderMonths,
        ]),
      ].sort()
    : [];
  const kgOf = (rows: { kg: number | null }[]) => rows.reduce((s, r) => s + (r.kg ?? 0), 0);
  const nothing =
    !plan ||
    (!(parts.packed && plan.packed.length) &&
      !(parts.forecast && canForecast && plan.forecasts.length) &&
      !(parts.orders && plan.orders.length));

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-card p-4"
      data-testid="fg-panel"
      data-pdf-exclude="true"
    >
      <div>
        <h2 className="text-base font-semibold">Upload FG workbook</h2>
        <p className="text-sm text-muted-foreground">
          The planning team&rsquo;s .xlsx (Entry, Items, B2B &amp; Export). Check what it brings,
          then save. Each part replaces what the app has for the same days or months.
        </p>
      </div>
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border p-3 hover:border-primary/50">
        <FileSpreadsheet className="h-6 w-6 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-sm">
          <span className="block truncate font-medium">{file ?? "Choose the workbook"}</span>
          <span className="text-xs text-muted-foreground">
            {reading ? "Reading…" : ".xlsx, as saved by Excel"}
          </span>
        </span>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label="FG workbook file"
          className="sr-only"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </label>
      {err && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive-strong">
          {err}
        </p>
      )}
      {plan && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm" data-testid="fg-preview">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 text-left font-semibold">Month</th>
                  <th className="py-1 text-right font-semibold">Packed rows</th>
                  <th className="py-1 text-right font-semibold">Local t</th>
                  <th className="py-1 text-right font-semibold">Export t</th>
                  <th className="py-1 text-right font-semibold">Forecast SKUs</th>
                  <th className="py-1 text-right font-semibold">Order lines</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const rows = plan.packed.filter((p) => p.day.startsWith(m.slice(0, 7)));
                  return (
                    <tr key={m} className="border-t border-border">
                      <td className="py-1.5 font-medium">
                        {monthShort(m)} {m.slice(0, 4)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{rows.length || "—"}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {rows.length ? tons(kgOf(rows.filter((r) => r.kind === "local"))) : "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {rows.length ? tons(kgOf(rows.filter((r) => r.kind === "export"))) : "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {plan.forecasts.filter((f) => f.month === m).length || "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {plan.orders.filter((o) => o.month === m).length || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <fieldset className="flex flex-col gap-1.5 text-sm">
            <legend className="mb-1 text-xs font-semibold text-muted-foreground">Save</legend>
            <Check
              on={parts.packed}
              set={(v) => setParts((p) => ({ ...p, packed: v }))}
              label={`Packed SKUs · ${plan.packed.length} rows, ${plan.days.length} days (${plan.days.length ? `${shortDay(plan.days[0])} – ${shortDay(plan.days[plan.days.length - 1])}` : "—"}) on ${plan.lineIds.map(lineName).join(", ")}`}
            />
            <Check
              on={parts.forecast && canForecast}
              disabled={!canForecast}
              set={(v) => setParts((p) => ({ ...p, forecast: v }))}
              label={
                canForecast
                  ? `Forecast · ${plan.forecastMonths.map(monthShort).join(", ") || "none"} (replaces each month's forecast)`
                  : "Forecast · only an admin can save it"
              }
            />
            <Check
              on={parts.orders}
              set={(v) => setParts((p) => ({ ...p, orders: v }))}
              label={`Orders · ${plan.orders.length} lines in ${plan.orderMonths.map(monthShort).join(", ") || "no month"}`}
            />
          </fieldset>
          {(missing.length > 0 ||
            plan.unknownCodes.length > 0 ||
            plan.noWeight.length > 0 ||
            plan.noLine.length > 0 ||
            skipped > 0) && (
            <ul className="flex flex-col gap-1 rounded-lg bg-warning/10 px-3 py-2 text-xs font-medium text-warning-strong">
              {missing.length > 0 && <li>Sheets not found: {missing.join(", ")}.</li>}
              {plan.unknownCodes.length > 0 && (
                <li>
                  {plan.unknownCodes.length} codes not in Settings › Packing (saved, with the
                  workbook&rsquo;s weight): {plan.unknownCodes.slice(0, 8).join(", ")}
                  {plan.unknownCodes.length > 8 ? "…" : ""}
                </li>
              )}
              {plan.noWeight.length > 0 && (
                <li>No kg per carton anywhere: {plan.noWeight.join(", ")} (saved without kg).</li>
              )}
              {plan.noLine.length > 0 && (
                <li>
                  {plan.noLine.length} Entry rows with no line we know: left out (rows{" "}
                  {plan.noLine
                    .slice(0, 6)
                    .map((e) => e.row)
                    .join(", ")}
                  ).
                </li>
              )}
              {skipped > 0 && (
                <li>{skipped} Entry rows without a date, code or quantity skipped.</li>
              )}
            </ul>
          )}
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button className="h-11 md:h-9" disabled={!!busy || nothing} onClick={save}>
          {busy ?? "Save workbook"}
        </Button>
        <Button variant="outline" className="h-11 md:h-9" onClick={onDone} disabled={!!busy}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

function Check({
  on,
  set,
  label,
  disabled,
}: {
  on: boolean;
  set: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex min-h-11 items-start gap-2 md:min-h-0 ${disabled ? "opacity-60" : ""}`}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
        checked={on}
        disabled={disabled}
        onChange={(e) => set(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
