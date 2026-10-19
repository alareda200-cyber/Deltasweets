// Plan adherence (November 2026 monthly upgrade, approved mockup v4): the
// month's forecast per SKU against what was packed, per SKU, per line and in
// total. Both are pasted here from Excel:
//   - packed SKUs: a day's packing sheet, every line at once (production and
//     admins). A line's Full-day entry takes its packing actual from them.
//     A saved day opens from the Packed days calendar in PackedSkusEditor.
// Layout (approved mockup "Plan Adherence Redesign", 19 Oct 2026): pace hero
// with the cumulative chart, line cards (filter), sortable SKU board with
// status tabs and pages, packed-days calendar. Paste panels sit behind one
// "Update data" menu.
//   - forecast: code · name · quantity for the month (admins).
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ClipboardPaste } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { iso } from "@/lib/date-utils";
import { logAudit } from "@/lib/audit";
import { requireSession } from "@/lib/require-session";
import { linesQuery, nonProductionDaysQuery } from "@/lib/queries";
import { packedSkusQuery, skuForecastsQuery, skusQuery, type Sku } from "@/lib/packing";
import { parseForecastSheet, parsePackedSheet, type PackedRow } from "@/lib/sku-paste";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LineCards, PackedCalendar, PaceHero, SkuBoard } from "@/components/plan/PlanParts";
import { ConfirmDialog } from "@/components/settings/shared";
import { planAdherence } from "@/lib/plan-adherence";

interface Search {
  month?: string;
}

export const Route = createFileRoute("/plan-adherence")({
  head: () => ({ meta: [{ title: "Plan adherence · Production Scorecard" }] }),
  validateSearch: (search: Record<string, unknown>): Search => ({
    month:
      typeof search.month === "string" && /^\d{4}-\d{2}$/.test(search.month)
        ? search.month
        : undefined,
  }),
  beforeLoad: requireSession,
  loader: ({ context }) => context.queryClient.ensureQueryData(linesQuery),
  component: () => (
    <RequireAuth requirePermission="plan.view">
      <PlanAdherencePage />
    </RequireAuth>
  ),
});

const kg = (n: number) => Math.round(n).toLocaleString("en-US");
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

function PlanAdherencePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { role } = useAuth();
  const canPastePacked = can(role, "entry.editProduction");
  const canForecast = can(role, "settings.manage");
  const qc = useQueryClient();
  const today = iso(new Date());
  const month = search.month ?? today.slice(0, 7);
  const monthStart = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const monthEnd = iso(new Date(y, m, 0));
  const shiftMonth = (by: number) => iso(new Date(y, m - 1 + by, 1)).slice(0, 7);

  const { data: lines } = useSuspenseQuery(linesQuery);
  const { data: skus = [] } = useQuery(skusQuery);
  const forecastsQ = useQuery(skuForecastsQuery(monthStart));
  const packedQ = useQuery(packedSkusQuery(monthStart, monthEnd));
  const { data: closed = [] } = useQuery(nonProductionDaysQuery());
  const [lineFilter, setLineFilter] = useState("");
  const [panel, setPanel] = useState<"packed" | "forecast" | null>(null);
  const [dropDay, setDropDay] = useState<{ day: string; lineId: string } | null>(null);

  const lineName = (id: string | null) =>
    id ? (lines.find((l) => l.id === id)?.name ?? "—") : "No line";
  const ad = useMemo(
    () =>
      planAdherence({
        month,
        forecasts: forecastsQ.data ?? [],
        packed: packedQ.data ?? [],
        skus,
        closed,
        today,
      }),
    [month, forecastsQ.data, packedQ.data, skus, closed, today],
  );
  const monthHasClosedDays = closed.some(
    (d) => d.line_id === null && d.day >= monthStart && d.day <= monthEnd,
  );
  const lastOver = [...ad.daily].reverse().find((d) => d.cumKg !== null)?.day;
  const periodLabel = lastOver
    ? `1–${Number(lastOver.slice(8, 10))} ${new Date(`${monthStart}T00:00:00`).toLocaleDateString("en-GB", { month: "short" })}`
    : monthLabel(month);

  async function removeDay(day: string, lineId: string) {
    const { error } = await supabase
      .from("packed_skus")
      .delete()
      .eq("day", day)
      .eq("line_id", lineId);
    if (error) {
      toast.error(error.message);
      return false;
    }
    void logAudit("plan.remove_packed_day", "packed_skus", `${lineId}|${day}`, { day });
    toast.success(`Removed ${lineName(lineId)} · ${dayLabel(day)}`);
    qc.invalidateQueries({ queryKey: ["packed-skus"] });
  }

  const loading = forecastsQ.isPending || packedQ.isPending;
  const failed = forecastsQ.isError || packedQ.isError;
  const canUpdate = canPastePacked || canForecast;

  return (
    <AppShell>
      <div
        className="mx-auto flex w-full max-w-6xl flex-col gap-3 md:gap-4"
        data-testid="plan-page"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Forecast vs packed
            </p>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Plan adherence</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex h-11 items-center rounded-lg border border-border bg-card md:h-9">
              <button
                type="button"
                aria-label="Previous month"
                className="flex h-full w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                onClick={() => navigate({ search: { month: shiftMonth(-1) }, replace: true })}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <label className="relative">
                <span className="block min-w-[5.5rem] text-center text-sm font-semibold">
                  {new Date(`${monthStart}T00:00:00`).toLocaleDateString("en-GB", {
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <input
                  type="month"
                  aria-label="Month"
                  value={month}
                  onChange={(e) =>
                    e.target.value && navigate({ search: { month: e.target.value }, replace: true })
                  }
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </label>
              <button
                type="button"
                aria-label="Next month"
                className="flex h-full w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                onClick={() => navigate({ search: { month: shiftMonth(1) }, replace: true })}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {canUpdate && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="h-11 md:h-9">
                    <ClipboardPaste className="mr-1.5 h-4 w-4" />
                    <span className="hidden sm:inline">Update data</span>
                    <span className="sm:hidden">Update</span>
                    <ChevronDown className="ml-1 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  {canPastePacked && (
                    <DropdownMenuItem
                      onSelect={() => setPanel("packed")}
                      className="flex-col items-start"
                    >
                      <span className="font-medium">Paste packed SKUs</span>
                      <span className="text-xs text-muted-foreground">
                        A day&rsquo;s sheet, every line at once
                      </span>
                    </DropdownMenuItem>
                  )}
                  {canForecast && (
                    <DropdownMenuItem
                      onSelect={() => setPanel("forecast")}
                      className="flex-col items-start"
                    >
                      <span className="font-medium">Paste forecast</span>
                      <span className="text-xs text-muted-foreground">
                        Code · name · line · qty for {monthLabel(month)}
                      </span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {panel === "packed" && (
          <PackedPastePanel
            skus={skus}
            lines={lines}
            defaultDay={today.slice(0, 7) === month ? today : monthEnd}
            onDone={() => setPanel(null)}
          />
        )}
        {panel === "forecast" && (
          <ForecastPastePanel
            skus={skus}
            month={month}
            hasForecast={(forecastsQ.data ?? []).length > 0}
            onDone={() => setPanel(null)}
          />
        )}

        {failed ? (
          <p className="rounded-xl border border-border bg-card p-6 text-sm text-destructive-strong">
            The forecast or the packed SKUs didn&rsquo;t load. Reload the page to try again.
          </p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : ad.forecastKg === 0 && ad.packedKg === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            No forecast and nothing packed in {monthLabel(month)} yet.
            {canUpdate ? " Use Update data to paste them." : ""}
          </div>
        ) : (
          <>
            <PaceHero ad={ad} periodLabel={periodLabel} monthHasClosedDays={monthHasClosedDays} />
            {ad.noWeight > 0 && (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs font-medium text-warning-strong">
                {ad.noWeight} forecast {ad.noWeight === 1 ? "SKU has" : "SKUs have"} no kg per unit
                in Settings › Packing, so {ad.noWeight === 1 ? "it is" : "they are"} left out of the
                kg totals.
              </p>
            )}
            <LineCards
              ad={ad}
              lineName={lineName}
              selected={lineFilter}
              onPick={(id) => setLineFilter((cur) => (cur === id ? "" : id))}
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)] md:items-start md:gap-4">
              <SkuBoard
                ad={ad}
                lineName={lineName}
                lineFilter={lineFilter}
                onClearLine={() => setLineFilter("")}
              />
              <PackedCalendar
                ad={ad}
                packed={packedQ.data ?? []}
                today={today}
                lineName={lineName}
                skus={skus}
                canEdit={canPastePacked}
                onRemoveDay={(day, lineId) => setDropDay({ day, lineId })}
              />
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        open={!!dropDay}
        onOpenChange={(o) => !o && setDropDay(null)}
        title={dropDay ? `Remove ${lineName(dropDay.lineId)} · ${dayLabel(dropDay.day)}?` : ""}
        description={
          <p>
            All its packed SKUs are removed. The day&rsquo;s entry keeps the packing actual it has
            now; change it there if it should change too.
          </p>
        }
        confirmLabel="Remove"
        onConfirm={() => (dropDay ? removeDay(dropDay.day, dropDay.lineId) : undefined)}
      />
    </AppShell>
  );
}

function PackedPastePanel({
  skus,
  lines,
  defaultDay,
  onDone,
}: {
  skus: Sku[];
  lines: { id: string; name: string }[];
  defaultDay: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [day, setDay] = useState(defaultDay);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const skuMap = useMemo(() => new Map(skus.map((s) => [s.code, s])), [skus]);
  const res = useMemo(
    () => parsePackedSheet(text, { skus: skuMap, lines, day }),
    [text, skuMap, lines, day],
  );
  const groups = useMemo(() => {
    const by = new Map<string, { day: string; lineId: string; rows: PackedRow[] }>();
    for (const r of res.rows) {
      const k = `${r.day}|${r.lineId}`;
      const g = by.get(k) ?? { day: r.day, lineId: r.lineId as string, rows: [] };
      g.rows.push(r);
      by.set(k, g);
    }
    return [...by.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [res.rows]);
  const unknown = [...new Set(res.rows.filter((r) => !r.sku || r.kg === null).map((r) => r.code))];
  const lineName = (id: string) => lines.find((l) => l.id === id)?.name ?? "—";

  async function save() {
    if (groups.length === 0) return;
    setBusy(true);
    try {
      for (const g of groups) {
        // The pasted rows replace what that line had for that day.
        const del = await supabase
          .from("packed_skus")
          .delete()
          .eq("day", g.day)
          .eq("line_id", g.lineId);
        if (del.error) throw del.error;
        const ins = await supabase.from("packed_skus").insert(
          g.rows.map((r) => ({
            line_id: g.lineId,
            day: g.day,
            sku_id: r.sku?.id ?? null,
            code: r.code,
            qty: r.qty,
            kg: r.kg,
          })),
        );
        if (ins.error) throw ins.error;
      }
      void logAudit("plan.paste_packed", "packed_skus", groups[0].day, {
        days: [...new Set(groups.map((g) => g.day))],
        rows: res.rows.length,
      });
      toast.success(`Saved ${res.rows.length} rows for ${groups.length} line-days`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["packed-skus"] }),
        qc.invalidateQueries({ queryKey: ["entries"] }),
        qc.invalidateQueries({ queryKey: ["all-entries"] }),
      ]);
      onDone();
    } catch (err) {
      toast.error(
        `Not saved: ${err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-card p-4"
      data-testid="packed-panel"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Paste packed SKUs</h2>
          <p className="text-sm text-muted-foreground">
            Copy the day&rsquo;s packing sheet from Excel, every line at once. Rows with a date use
            it; the others go on the day below. They replace what each line had for that day, and
            its Full-day entry takes the total as packing actual.
          </p>
        </div>
        <label className="flex shrink-0 flex-col gap-1 text-xs font-semibold">
          Day
          <Input
            type="date"
            aria-label="Day"
            value={day}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="h-11 w-44 md:h-9"
          />
        </label>
      </div>
      <Textarea
        aria-label="Packed SKUs rows"
        dir="ltr"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Date · Item code · Description · Cartons · Line"
        className="min-h-28 font-mono text-xs"
      />
      {groups.length > 0 && (
        <table className="w-full text-sm" data-testid="packed-preview">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-semibold">Day</th>
              <th className="py-1 text-left font-semibold">Line</th>
              <th className="py-1 text-right font-semibold">SKUs</th>
              <th className="py-1 text-right font-semibold">kg</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={`${g.day}|${g.lineId}`} className="border-t border-border">
                <td className="py-1.5">{dayLabel(g.day)}</td>
                <td className="py-1.5 font-medium">{lineName(g.lineId)}</td>
                <td className="py-1.5 text-right tabular-nums">{g.rows.length}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {kg(g.rows.reduce((s, r) => s + (r.kg ?? 0), 0))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {unknown.length > 0 && (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs font-medium text-warning-strong">
          Not in Settings › Packing or without a weight: {unknown.join(", ")}. They are saved but
          left out of the kg until the weight is added there and the day is pasted again.
        </p>
      )}
      {res.noLine.length > 0 && (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs font-medium text-warning-strong">
          {res.noLine.length} {res.noLine.length === 1 ? "row has" : "rows have"} no line (unknown
          code and no line column): {res.noLine.map((r) => r.code).join(", ")}. Left out.
        </p>
      )}
      <div className="flex gap-2">
        <Button className="h-11 md:h-9" disabled={busy || groups.length === 0} onClick={save}>
          {busy ? "Saving…" : `Save ${res.rows.length || ""} rows`}
        </Button>
        <Button variant="outline" className="h-11 md:h-9" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

function ForecastPastePanel({
  skus,
  month,
  hasForecast,
  onDone,
}: {
  skus: Sku[];
  month: string;
  hasForecast: boolean;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const skuMap = useMemo(() => new Map(skus.map((s) => [s.code, s])), [skus]);
  const res = useMemo(() => parseForecastSheet(text, skuMap), [text, skuMap]);
  const unknown = res.rows.filter((r) => !r.sku).map((r) => r.code);
  const noWeight = res.rows.filter((r) => r.sku && r.kg === null).map((r) => r.code);
  const totalKg = res.rows.reduce((s, r) => s + (r.kg ?? 0), 0);

  async function save() {
    if (res.rows.length === 0) return;
    setBusy(true);
    try {
      // The pasted list is the month's forecast: it replaces the old one.
      const del = await supabase.from("sku_forecasts").delete().eq("month", `${month}-01`);
      if (del.error) throw del.error;
      const ins = await supabase.from("sku_forecasts").insert(
        res.rows.map((r) => ({
          month: `${month}-01`,
          sku_id: r.sku?.id ?? null,
          code: r.code,
          qty: r.qty,
        })),
      );
      if (ins.error) throw ins.error;
      void logAudit("plan.paste_forecast", "sku_forecasts", month, {
        skus: res.rows.length,
        kg: Math.round(totalKg),
      });
      toast.success(`Forecast saved: ${res.rows.length} SKUs, ${kg(totalKg)} kg`);
      await qc.invalidateQueries({ queryKey: ["sku-forecasts"] });
      onDone();
    } catch (err) {
      toast.error(
        `Not saved: ${err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-card p-4"
      data-testid="forecast-panel"
    >
      <div>
        <h2 className="text-base font-semibold">Paste forecast · {monthLabel(month)}</h2>
        <p className="text-sm text-muted-foreground">
          Item code · Name · Quantity, the quantity in the SKU&rsquo;s unit from Settings › Packing.
          {hasForecast ? " It replaces this month's forecast." : ""}
        </p>
      </div>
      <Textarea
        aria-label="Forecast rows"
        dir="ltr"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Item code · Name · Quantity"
        className="min-h-28 font-mono text-xs"
      />
      {res.rows.length > 0 && (
        <p className="text-sm" data-testid="forecast-preview">
          <span className="font-semibold">{res.rows.length} SKUs</span> · {kg(totalKg)} kg
          {res.ignored > 0 ? ` · ${res.ignored} lines without a code or quantity skipped` : ""}
        </p>
      )}
      {(unknown.length > 0 || noWeight.length > 0) && (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs font-medium text-warning-strong">
          {unknown.length > 0 && <>Not in Settings › Packing: {unknown.join(", ")}. </>}
          {noWeight.length > 0 && <>No kg per unit: {noWeight.join(", ")}. </>}
          They are saved, and count in kg once their weight is added.
        </p>
      )}
      <div className="flex gap-2">
        <Button className="h-11 md:h-9" disabled={busy || res.rows.length === 0} onClick={save}>
          {busy ? "Saving…" : "Save forecast"}
        </Button>
        <Button variant="outline" className="h-11 md:h-9" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
