// Plan adherence (November 2026 monthly upgrade, approved mockup v4): the
// month's forecast per SKU against what was packed, per SKU, per line and in
// total. Both are pasted here from Excel:
//   - packed SKUs: a day's packing sheet, every line at once (production and
//     admins). A line's Full-day entry takes its packing actual from them.
//     A saved day opens in PackedSkusEditor: change, remove or add SKUs one
//     by one or all at once.
//   - forecast: code · name · quantity for the month (admins).
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronDown, ClipboardPaste, Trash2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { linesQuery, nonProductionDaysQuery } from "@/lib/queries";
import { packedSkusQuery, skuForecastsQuery, skusQuery, type Sku } from "@/lib/packing";
import { parseForecastSheet, parsePackedSheet, type PackedRow } from "@/lib/sku-paste";
import { PackedSkusEditor } from "@/components/entry/PackedSkusEditor";
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
    <RequireAuth requirePermission="dashboard.view">
      <PlanAdherencePage />
    </RequireAuth>
  ),
});

const kg = (n: number) => Math.round(n).toLocaleString("en-US");
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

function tone(achieved: number | null, should: number): string {
  if (achieved === null) return "bg-muted text-muted-foreground";
  if (achieved >= 1) return "bg-success/15 text-success-strong";
  return achieved >= should
    ? "bg-success/15 text-success-strong"
    : "bg-warning/15 text-warning-strong";
}

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

  const { data: lines } = useSuspenseQuery(linesQuery);
  const { data: skus = [] } = useQuery(skusQuery);
  const forecastsQ = useQuery(skuForecastsQuery(monthStart));
  const packedQ = useQuery(packedSkusQuery(monthStart, monthEnd));
  const { data: closed = [] } = useQuery(nonProductionDaysQuery());
  const [lineFilter, setLineFilter] = useState("");
  const [find, setFind] = useState("");
  const [panel, setPanel] = useState<"packed" | "forecast" | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
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
  const share = ad.workingDays > 0 ? ad.daysOver / ad.workingDays : 1;
  const shownSkus = ad.skus.filter(
    (r) =>
      (!lineFilter || r.lineId === lineFilter) &&
      (!find.trim() || r.code.includes(find.trim()) || r.name.includes(find.trim())),
  );
  const packedDays = useMemo(() => {
    const by = new Map<string, { day: string; lineId: string; n: number; kg: number }>();
    for (const p of packedQ.data ?? []) {
      const k = `${p.day}|${p.line_id}`;
      const cur = by.get(k) ?? { day: p.day, lineId: p.line_id, n: 0, kg: 0 };
      cur.n++;
      cur.kg += p.kg ?? 0;
      by.set(k, cur);
    }
    return [...by.values()].sort(
      (a, b) => b.day.localeCompare(a.day) || a.lineId.localeCompare(b.lineId),
    );
  }, [packedQ.data]);

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
    if (openDay === `${day}|${lineId}`) setOpenDay(null);
    qc.invalidateQueries({ queryKey: ["packed-skus"] });
  }

  const loading = forecastsQ.isPending || packedQ.isPending;
  const failed = forecastsQ.isError || packedQ.isError;

  return (
    <AppShell>
      <div
        className="mx-auto flex w-full max-w-6xl flex-col gap-4 md:gap-5"
        data-testid="plan-page"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Forecast against packed, per SKU</p>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Plan adherence</h1>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-semibold">
              Month
              <Input
                type="month"
                aria-label="Month"
                value={month}
                onChange={(e) =>
                  e.target.value && navigate({ search: { month: e.target.value }, replace: true })
                }
                className="h-11 w-44 md:h-9"
              />
            </label>
            {canPastePacked && (
              <Button
                variant={panel === "packed" ? "default" : "outline"}
                className="h-11 md:h-9"
                onClick={() => setPanel(panel === "packed" ? null : "packed")}
              >
                <ClipboardPaste className="mr-2 h-4 w-4" />
                Paste packed SKUs
              </Button>
            )}
            {canForecast && (
              <Button
                variant={panel === "forecast" ? "default" : "outline"}
                className="h-11 md:h-9"
                onClick={() => setPanel(panel === "forecast" ? null : "forecast")}
              >
                <ClipboardPaste className="mr-2 h-4 w-4" />
                Paste forecast
              </Button>
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
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="plan-kpis">
              <Kpi label="Forecast" value={`${kg(ad.forecastKg)} kg`} sub={monthLabel(month)} />
              <Kpi
                label="Packed"
                value={`${kg(ad.packedKg)} kg`}
                sub={ad.achieved === null ? "No forecast yet" : `${pct(ad.achieved)} of forecast`}
              />
              <Kpi
                label="Where it should be by now"
                value={`${kg(ad.shouldKg)} kg`}
                sub={`${ad.daysOver} of ${ad.workingDays} working days`}
              />
              <Kpi
                label="Needed per day"
                value={ad.neededPerDay === null ? "—" : `${kg(ad.neededPerDay)} kg`}
                sub={`${ad.daysLeft} ${ad.daysLeft === 1 ? "day" : "days"} left`}
              />
            </div>
            {ad.forecastKg > 0 && (
              <div
                className="relative h-3 overflow-hidden rounded-full bg-muted"
                aria-hidden="true"
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary"
                  style={{ width: `${Math.min(100, (ad.packedKg / ad.forecastKg) * 100)}%` }}
                />
                <div
                  className="absolute inset-y-0 w-0.5 bg-foreground/60"
                  style={{ left: `${share * 100}%` }}
                />
              </div>
            )}
            {ad.noWeight > 0 && (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs font-medium text-warning-strong">
                {ad.noWeight} forecast {ad.noWeight === 1 ? "SKU has" : "SKUs have"} no kg per unit
                in Settings › Packing, so {ad.noWeight === 1 ? "it is" : "they are"} left out of the
                kg totals.
              </p>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] md:items-start">
              <section
                className="rounded-xl border border-border bg-card"
                aria-labelledby="by-line"
              >
                <h2 id="by-line" className="px-4 pt-3 text-base font-semibold">
                  By line
                </h2>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm" data-testid="plan-lines">
                    <thead className="bg-muted/60 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold sm:px-4">Line</th>
                        <th className="px-1.5 py-2 text-right font-semibold sm:px-2">Forecast</th>
                        <th className="px-1.5 py-2 text-right font-semibold sm:px-2">Packed</th>
                        <th className="px-3 py-2 text-right font-semibold sm:px-4">Achieved</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ad.lines.map((l) => (
                        <tr key={l.lineId ?? "none"} className="border-t border-border">
                          <td className="max-w-28 truncate px-3 py-2 font-semibold sm:max-w-none sm:px-4">
                            {lineName(l.lineId)}
                          </td>
                          <td className="px-1.5 py-2 text-right tabular-nums sm:px-2">
                            {kg(l.forecastKg)}
                          </td>
                          <td className="px-1.5 py-2 text-right tabular-nums sm:px-2">
                            {kg(l.packedKg)}
                          </td>
                          <td className="px-3 py-2 text-right sm:px-4">
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
                                tone(l.achieved, share),
                              )}
                            >
                              {pct(l.achieved)}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {ad.lines.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-4 text-sm text-muted-foreground">
                            No forecast and nothing packed in {monthLabel(month)} yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="px-4 py-2 text-xs text-muted-foreground">
                  kg. Green: at or ahead of where it should be by now.
                </p>
              </section>

              <section className="rounded-xl border border-border bg-card" aria-labelledby="by-sku">
                <div className="flex flex-col gap-2 px-4 pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 id="by-sku" className="text-base font-semibold">
                    By SKU{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      · {shownSkus.length}
                    </span>
                  </h2>
                  <div className="flex gap-2">
                    <Input
                      aria-label="Search SKU"
                      placeholder="Code or name"
                      value={find}
                      onChange={(e) => setFind(e.target.value)}
                      className="h-11 min-w-0 flex-1 md:h-9 md:w-44"
                    />
                    <select
                      aria-label="Line"
                      value={lineFilter}
                      onChange={(e) => setLineFilter(e.target.value)}
                      className="h-11 rounded-md border border-input bg-background px-2 text-sm md:h-9"
                    >
                      <option value="">All lines</option>
                      {lines.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <ul className="mt-2" data-testid="plan-skus">
                  {shownSkus.slice(0, 200).map((r) => (
                    <li
                      key={r.code}
                      className="flex min-h-12 items-center gap-3 border-t border-border px-4 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span className="font-mono">{r.code}</span>
                          <span>{lineName(r.lineId)}</span>
                        </span>
                        <span dir="rtl" className="block truncate text-right text-sm sm:text-left">
                          {r.name || "—"}
                        </span>
                      </div>
                      <div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        <span className="block text-sm font-semibold text-foreground">
                          {num(r.packedQty)} / {num(r.forecastQty)}
                        </span>
                        {r.unit ?? "units"}
                      </div>
                      <span
                        className={cn(
                          "w-14 shrink-0 rounded-full py-0.5 text-center text-xs font-bold tabular-nums",
                          tone(r.achieved, share),
                        )}
                      >
                        {r.achieved === null ? "no fc" : pct(r.achieved)}
                      </span>
                    </li>
                  ))}
                  {shownSkus.length === 0 && (
                    <li className="border-t border-border px-4 py-4 text-sm text-muted-foreground">
                      No SKUs.
                    </li>
                  )}
                </ul>
                {shownSkus.length > 200 && (
                  <p className="px-4 py-2 text-xs text-muted-foreground">
                    {shownSkus.length - 200} more — search to narrow the list.
                  </p>
                )}
              </section>
            </div>

            <section
              className="rounded-xl border border-border bg-card"
              aria-labelledby="packed-days"
            >
              <h2 id="packed-days" className="px-4 pt-3 text-base font-semibold">
                Packed SKUs entered
              </h2>
              <ul data-testid="packed-days" className="mt-2">
                {packedDays.map((d) => {
                  const key = `${d.day}|${d.lineId}`;
                  const open = openDay === key;
                  return (
                    <li key={key} className="border-t border-border">
                      <div className="flex min-h-12 items-center gap-2 px-2 py-1 text-sm sm:px-4">
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-label={`${open ? "Close" : "Open"} ${lineName(d.lineId)} ${dayLabel(d.day)}`}
                          onClick={() => setOpenDay(open ? null : key)}
                          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-2 text-left hover:bg-muted/60 md:min-h-9"
                        >
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                              open && "rotate-180",
                            )}
                          />
                          <span className="w-24 shrink-0 font-medium sm:w-28">
                            {dayLabel(d.day)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{lineName(d.lineId)}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {d.n} · {kg(d.kg)} kg
                          </span>
                        </button>
                        {canPastePacked && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${lineName(d.lineId)} ${dayLabel(d.day)}`}
                            className="h-11 w-11 shrink-0 text-muted-foreground hover:text-destructive-strong md:h-9 md:w-9"
                            onClick={() => setDropDay({ day: d.day, lineId: d.lineId })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      {open && (
                        <PackedSkusEditor
                          key={key}
                          day={d.day}
                          lineId={d.lineId}
                          lineLabel={lineName(d.lineId)}
                          dayLabel={dayLabel(d.day)}
                          rows={(packedQ.data ?? []).filter(
                            (p) => p.day === d.day && p.line_id === d.lineId,
                          )}
                          skus={skus}
                          canEdit={canPastePacked}
                          title="SKUs"
                          className="bg-muted/30 px-3 pb-3 pt-2 sm:px-4"
                        />
                      )}
                    </li>
                  );
                })}
                {packedDays.length === 0 && (
                  <li className="border-t border-border px-4 py-4 text-sm text-muted-foreground">
                    Nothing pasted for {monthLabel(month)} yet.
                  </li>
                )}
              </ul>
            </section>
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

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 md:p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums md:text-xl">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
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
