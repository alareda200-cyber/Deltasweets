// The parts of the Plan adherence page (approved mockup "Plan Adherence
// Redesign", 19 Oct 2026): pace hero with the cumulative chart, line cards,
// the sortable SKU board and the packed-days calendar.
import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Adherence, SkuAdherence, SkuStatus } from "@/lib/plan-adherence";
import type { PackedSku, Sku } from "@/lib/packing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PackedSkusEditor } from "@/components/entry/PackedSkusEditor";

const kgFmt = (n: number) => Math.round(n).toLocaleString("en-US");
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const pctFmt = (v: number) => `${Math.round(v * 100).toLocaleString("en-US")}%`;
const compact = (n: number) =>
  n >= 1000
    ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "")}K`
    : String(Math.round(n));
const dayNum = (d: string) => Number(d.slice(8, 10));
const shortDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// ------------------------------------------------------------------ hero
export function PaceHero({
  ad,
  periodLabel,
  monthHasClosedDays,
}: {
  ad: Adherence;
  periodLabel: string;
  monthHasClosedDays: boolean;
}) {
  const achieved = ad.achieved ?? 0;
  const gapPts = Math.round((achieved - ad.share) * 100);
  const ahead = gapPts >= 0;
  const projPct =
    ad.projectionKg !== null && ad.forecastKg > 0 ? ad.projectionKg / ad.forecastKg : null;
  const lastCum = [...ad.daily].reverse().find((d) => d.cumKg !== null);
  const lastIdx = lastCum ? ad.daily.indexOf(lastCum) : -1;
  const data = ad.daily.map((d, i) => ({
    day: d.day,
    cum: d.cumKg,
    pace: Math.round(d.paceKg),
    proj:
      ad.projectionKg !== null && lastCum && i >= lastIdx
        ? Math.round(
            (lastCum.cumKg ?? 0) +
              ((ad.projectionKg - (lastCum.cumKg ?? 0)) * (i - lastIdx)) /
                Math.max(1, ad.daily.length - 1 - lastIdx),
          )
        : null,
  }));
  const top = Math.max(ad.forecastKg, ad.projectionKg ?? 0, lastCum?.cumKg ?? 0, 1);
  // Four even steps on a round number (1, 2, 2.5 or 5 × 10ⁿ).
  const rough = top / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((f) => f * mag >= rough) ?? 10) * mag;
  const yTicks = Array.from({ length: Math.ceil(top / step) + 1 }, (_, i) => i * step);

  return (
    <section
      className="grid overflow-hidden rounded-2xl border border-border bg-card shadow-card md:grid-cols-[300px_minmax(0,1fr)]"
      data-testid="plan-kpis"
    >
      <div className="flex flex-col gap-3 border-b border-border p-4 md:border-b-0 md:border-r md:p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Achieved · {periodLabel}
        </p>
        <p className="text-5xl font-extrabold leading-none tracking-tight tabular-nums md:text-6xl">
          {ad.achieved === null ? "—" : Math.round(achieved * 100)}
          <span className="ml-0.5 text-xl font-bold">%</span>
        </p>
        {ad.forecastKg > 0 && (
          <span
            className={cn(
              "self-start rounded-full px-2.5 py-0.5 text-xs font-bold",
              ahead ? "bg-success/15 text-success-strong" : "bg-warning/15 text-warning-strong",
            )}
          >
            {ahead ? "▲" : "▼"} {Math.abs(gapPts)} pts {ahead ? "ahead of" : "behind"} pace
          </span>
        )}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          <HeroStat
            value={`${kgFmt(ad.packedKg)}`}
            label={`kg packed of ${kgFmt(ad.forecastKg)}`}
          />
          <HeroStat value={kgFmt(ad.shouldKg)} label="kg it should be by now" />
          <HeroStat
            value={ad.neededPerDay === null ? "—" : kgFmt(ad.neededPerDay)}
            label={`kg per day needed · ${ad.daysLeft} ${ad.daysLeft === 1 ? "day" : "days"} left`}
          />
          <HeroStat
            value={projPct === null ? "—" : pctFmt(projPct)}
            label="month end at this pace"
          />
        </dl>
        {ad.unplannedCount > 0 && (
          <p className="text-xs text-primary" data-testid="plan-unplanned">
            ● {kgFmt(ad.unplannedKg)} kg
            {ad.packedKg > 0 ? ` (${Math.round((ad.unplannedKg / ad.packedKg) * 100)}%)` : ""}{" "}
            packed in {ad.unplannedCount}{" "}
            {ad.unplannedCount === 1 ? "SKU that isn't" : "SKUs that aren't"} in the forecast
          </p>
        )}
      </div>
      <div className="min-w-0 p-3 md:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="text-sm font-semibold md:text-base">Cumulative packed vs plan</h2>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <LegendKey style="solid">Packed</LegendKey>
            <LegendKey style="dashed">Plan pace</LegendKey>
            <LegendKey style="dotted">At this pace</LegendKey>
          </div>
        </div>
        <div className="mt-1 h-[190px] w-full md:h-[230px]" data-testid="plan-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 8, left: -6, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={{ stroke: "var(--color-border)" }}
                tickFormatter={(d: string) => String(dayNum(d))}
                interval="preserveStartEnd"
                minTickGap={18}
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              />
              <YAxis
                width={44}
                tickLine={false}
                axisLine={false}
                domain={[0, yTicks[yTicks.length - 1]]}
                ticks={yTicks}
                tickFormatter={compact}
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              />
              <Tooltip
                cursor={{ stroke: "var(--color-foreground)", strokeOpacity: 0.25 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as (typeof data)[number];
                  return (
                    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-card">
                      <p className="font-semibold">{shortDay(row.day)}</p>
                      {row.cum !== null && (
                        <p className="tabular-nums">Packed so far: {kgFmt(row.cum)} kg</p>
                      )}
                      <p className="tabular-nums text-muted-foreground">
                        Plan by then: {kgFmt(row.pace)} kg
                      </p>
                      {row.cum === null && row.proj !== null && (
                        <p className="tabular-nums text-muted-foreground">
                          At this pace: {kgFmt(row.proj)} kg
                        </p>
                      )}
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="cum"
                stroke="var(--color-primary)"
                strokeWidth={2}
                fill="var(--color-primary)"
                fillOpacity={0.1}
                connectNulls={false}
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-card)" }}
              />
              <Line
                type="linear"
                dataKey="pace"
                stroke="var(--color-muted-foreground)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="proj"
                stroke="var(--color-primary)"
                strokeWidth={2}
                strokeDasharray="1 4"
                strokeLinecap="round"
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {!monthHasClosedDays && (
          <p className="px-1 text-[11px] text-muted-foreground">
            No non-production days recorded this month, so the pace counts all {ad.workingDays}{" "}
            days. Record days off in Settings › Non-production days.
          </p>
        )}
      </div>
    </section>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <dd className="text-base font-bold tabular-nums">{value}</dd>
      <dt className="text-[11.5px] leading-tight text-muted-foreground">{label}</dt>
    </div>
  );
}

function LegendKey({
  style,
  children,
}: {
  style: "solid" | "dashed" | "dotted";
  children: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i
        aria-hidden="true"
        className={cn(
          "inline-block w-3.5 border-t-2",
          style === "dashed"
            ? "border-dashed border-muted-foreground"
            : style === "dotted"
              ? "border-dotted border-primary"
              : "border-primary",
        )}
      />
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ lines
export function LineCards({
  ad,
  lineName,
  selected,
  onPick,
}: {
  ad: Adherence;
  lineName: (id: string | null) => string;
  selected: string;
  onPick: (lineId: string) => void;
}) {
  const lines = ad.lines.filter((l) => l.forecastKg > 0 || l.packedKg > 0);
  if (lines.length === 0) return null;
  return (
    <div
      className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 md:gap-3"
      data-testid="plan-lines"
    >
      {lines.map((l) => {
        const a = l.achieved;
        const gap = a === null ? null : Math.round((a - ad.share) * 100);
        const on = selected === (l.lineId ?? "");
        return (
          <button
            key={l.lineId ?? "none"}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(l.lineId ?? "")}
            className={cn(
              "flex min-w-0 flex-col gap-2 rounded-2xl border bg-card p-3.5 text-left shadow-card transition-colors md:p-4",
              on
                ? "border-primary ring-2 ring-primary/20"
                : "border-border hover:border-primary/40",
            )}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-semibold">{lineName(l.lineId)}</span>
              <span className="text-2xl font-extrabold tracking-tight tabular-nums">
                {a === null ? "—" : pctFmt(a)}
              </span>
            </span>
            <span className="relative block h-2.5 rounded-full bg-muted" aria-hidden="true">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                style={{ width: `${Math.min(100, (a ?? 0) * 100)}%` }}
              />
              <span
                className="absolute -inset-y-1 w-0.5 rounded bg-foreground"
                style={{ left: `calc(${ad.share * 100}% - 1px)` }}
              />
            </span>
            <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate tabular-nums">
                {kgFmt(l.packedKg)} / {kgFmt(l.forecastKg)} kg
              </span>
              {gap !== null && (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 font-bold",
                    gap >= 0
                      ? "bg-success/15 text-success-strong"
                      : "bg-warning/15 text-warning-strong",
                  )}
                >
                  {gap >= 0 ? "▲" : "▼"} {Math.abs(gap)} pts
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ SKUs
type Tab = "all" | SkuStatus;
type SortKey = "name" | "forecast" | "packed" | "left" | "achieved";
const TABS: { key: Tab; label: string; dot?: string }[] = [
  { key: "all", label: "All" },
  { key: "behind", label: "Behind", dot: "bg-warning-strong" },
  { key: "ontrack", label: "On track", dot: "bg-success-strong" },
  { key: "notstarted", label: "Not started", dot: "bg-destructive-strong" },
  { key: "unplanned", label: "Not in forecast", dot: "bg-primary" },
];
const STATUS_PILL: Record<SkuStatus, string> = {
  ontrack: "bg-success/15 text-success-strong",
  behind: "bg-warning/15 text-warning-strong",
  notstarted: "bg-destructive/10 text-destructive-strong",
  unplanned: "bg-primary/10 text-primary",
};
const STATUS_BAR: Record<SkuStatus, string> = {
  ontrack: "bg-success-strong",
  behind: "bg-warning-strong",
  notstarted: "bg-destructive-strong",
  unplanned: "bg-primary",
};
const PER_PAGE = 8;

export function SkuBoard({
  ad,
  lineName,
  lineFilter,
  onClearLine,
}: {
  ad: Adherence;
  lineName: (id: string | null) => string;
  lineFilter: string;
  onClearLine: () => void;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<SortKey>("achieved");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [find, setFind] = useState("");
  const [page, setPage] = useState(0);

  const base = useMemo(() => {
    const q = find.trim();
    return ad.skus.filter(
      (r) =>
        (!lineFilter || r.lineId === lineFilter) &&
        (!q || r.code.includes(q) || r.name.includes(q)),
    );
  }, [ad.skus, lineFilter, find]);
  const counts = useMemo(() => {
    const c: Record<Tab, number> = {
      all: base.length,
      behind: 0,
      ontrack: 0,
      notstarted: 0,
      unplanned: 0,
    };
    for (const r of base) c[r.status]++;
    return c;
  }, [base]);
  const rows = useMemo(() => {
    const list = base.filter((r) => tab === "all" || r.status === tab);
    const val = (r: SkuAdherence): number | string =>
      sort === "name"
        ? r.name || r.code
        : sort === "forecast"
          ? (r.forecastKg ?? 0)
          : sort === "packed"
            ? r.packedKg
            : sort === "left"
              ? Math.max(0, (r.forecastKg ?? 0) - r.packedKg)
              : (r.achieved ?? 0);
    return [...list].sort((a, b) => {
      // SKUs without a forecast have no % : always after the others.
      if (sort === "achieved" && (a.achieved === null) !== (b.achieved === null))
        return a.achieved === null ? 1 : -1;
      const A = val(a);
      const B = val(b);
      const c =
        typeof A === "string" ? A.localeCompare(String(B), "ar") : (A as number) - (B as number);
      return dir === "asc" ? c : -c;
    });
  }, [base, tab, sort, dir]);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const p = Math.min(page, pages - 1);
  const shown = rows.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);

  function sortBy(k: SortKey) {
    if (sort === k) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(k);
      setDir(k === "name" || k === "achieved" ? "asc" : "desc");
    }
    setPage(0);
  }
  const head = (k: SortKey, label: string, align: "left" | "right" = "right") => (
    <button
      type="button"
      onClick={() => sortBy(k)}
      aria-label={`Sort by ${label}${sort === k ? (dir === "asc" ? ", lowest first" : ", highest first") : ""}`}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground",
        align === "right" ? "justify-end" : "justify-start",
        sort === k && "text-foreground",
      )}
    >
      {label}
      <span className="inline-flex flex-col leading-none" aria-hidden="true">
        <ArrowUp
          className={cn(
            "h-2.5 w-2.5",
            sort === k && dir === "desc" ? "text-primary" : "opacity-30",
          )}
        />
        <ArrowDown
          className={cn(
            "-mt-0.5 h-2.5 w-2.5",
            sort === k && dir === "asc" ? "text-primary" : "opacity-30",
          )}
        />
      </span>
    </button>
  );

  return (
    <section
      className="min-w-0 rounded-2xl border border-border bg-card shadow-card"
      aria-labelledby="by-sku"
    >
      <div className="flex flex-col gap-2.5 border-b border-border p-3 md:p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="by-sku" className="text-sm font-semibold md:text-base">
            By SKU
            {lineFilter && (
              <button
                type="button"
                onClick={onClearLine}
                className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
              >
                {lineName(lineFilter)} ✕
              </button>
            )}
          </h2>
          <span className="text-xs text-muted-foreground tabular-nums">{rows.length} SKUs</span>
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => {
                setTab(t.key);
                setPage(0);
              }}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold md:h-8",
                tab === t.key
                  ? "border-transparent bg-foreground text-background"
                  : "border-border bg-card hover:border-primary/40",
              )}
            >
              {t.dot && <span className={cn("h-2 w-2 rounded-full", t.dot)} aria-hidden="true" />}
              {t.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] tabular-nums",
                  tab === t.key ? "bg-background/20" : "bg-muted text-muted-foreground",
                )}
              >
                {counts[t.key]}
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search SKU"
              placeholder="Code or name"
              value={find}
              onChange={(e) => {
                setFind(e.target.value);
                setPage(0);
              }}
              className="h-11 pl-9 md:h-9"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0 md:hidden"
            onClick={() => {
              setSort("achieved");
              setDir((d) => (sort === "achieved" && d === "asc" ? "desc" : "asc"));
              setPage(0);
            }}
          >
            {sort === "achieved" && dir === "desc" ? "Highest % ▲" : "Lowest % ▼"}
          </Button>
        </div>
      </div>

      <div className="hidden grid-cols-[minmax(0,1fr)_96px_96px_96px_88px] gap-2 bg-muted/60 px-4 py-1.5 text-[11.5px] font-semibold text-muted-foreground md:grid">
        {head("name", "SKU", "left")}
        {head("forecast", "Forecast kg")}
        {head("packed", "Packed kg")}
        {head("left", "Still to pack")}
        {head("achieved", "Achieved")}
      </div>
      <ul data-testid="plan-skus">
        {shown.map((r) => (
          <li
            key={r.code}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border px-3 py-2 first:border-t-0 md:grid-cols-[minmax(0,1fr)_96px_96px_96px_88px] md:px-4"
          >
            <div className="min-w-0">
              <span dir="rtl" className="block truncate text-right text-sm md:text-left">
                {r.name || "—"}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground">
                <span className="font-mono">{r.code}</span>
                <span>{lineName(r.lineId)}</span>
                <span className="tabular-nums">
                  {num(r.packedQty)} / {num(r.forecastQty)} {r.unit ?? ""}
                </span>
              </span>
              <span className="relative mt-1 block h-1.5 rounded-full bg-muted" aria-hidden="true">
                <span
                  className={cn("absolute inset-y-0 left-0 rounded-full", STATUS_BAR[r.status])}
                  style={{
                    width: `${r.achieved === null ? 100 : Math.min(100, r.achieved * 100)}%`,
                  }}
                />
                {r.achieved !== null && (
                  <span
                    className="absolute inset-y-0 w-0.5 bg-foreground/50"
                    style={{ left: `calc(${ad.share * 100}% - 1px)` }}
                  />
                )}
              </span>
            </div>
            <span className="hidden text-right text-sm tabular-nums md:block">
              {kgFmt(r.forecastKg ?? 0)}
            </span>
            <span className="hidden text-right text-sm tabular-nums md:block">
              {kgFmt(r.packedKg)}
            </span>
            <span className="hidden text-right text-sm tabular-nums md:block">
              {kgFmt(Math.max(0, (r.forecastKg ?? 0) - r.packedKg))}
            </span>
            <span className="text-right">
              <span
                className={cn(
                  "inline-flex min-w-14 justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
                  STATUS_PILL[r.status],
                )}
              >
                {r.achieved === null
                  ? "no fc"
                  : `${r.achieved >= 1 ? "▲ " : r.status === "ontrack" ? "" : "▼ "}${pctFmt(r.achieved)}`}
              </span>
            </span>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">No SKUs here.</li>
        )}
      </ul>
      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground md:px-4">
        <span className="tabular-nums">
          {rows.length === 0 ? 0 : p * PER_PAGE + 1}–
          {Math.min(rows.length, p * PER_PAGE + PER_PAGE)} of {rows.length}
        </span>
        <span className="flex gap-1.5">
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-8"
            disabled={p === 0}
            onClick={() => setPage(p - 1)}
            aria-label="Previous SKUs"
          >
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-8"
            disabled={p >= pages - 1}
            onClick={() => setPage(p + 1)}
            aria-label="Next SKUs"
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </span>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ calendar
const WEEK = ["Sa", "Su", "Mo", "Tu", "We", "Th", "Fr"];

export function PackedCalendar({
  ad,
  packed,
  today,
  lineName,
  skus,
  canEdit,
  onRemoveDay,
}: {
  ad: Adherence;
  packed: PackedSku[];
  today: string;
  lineName: (id: string | null) => string;
  skus: Sku[];
  canEdit: boolean;
  onRemoveDay: (day: string, lineId: string) => void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null); // lineId being edited
  const byDay = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const r of packed) {
      const d = m.get(r.day) ?? new Map<string, number>();
      d.set(r.line_id, (d.get(r.line_id) ?? 0) + (r.kg ?? 0));
      m.set(r.day, d);
    }
    return m;
  }, [packed]);
  const max = Math.max(1, ...ad.daily.map((d) => d.packedKg));
  const first = ad.daily[0]?.day;
  // Saturday-first week (Egypt): Sat=0 … Fri=6.
  const lead = first ? (new Date(`${first}T00:00:00`).getDay() + 1) % 7 : 0;
  const selLines = sel ? [...(byDay.get(sel) ?? new Map()).entries()] : [];

  return (
    <section
      className="min-w-0 rounded-2xl border border-border bg-card p-3 shadow-card md:p-4"
      aria-labelledby="packed-days"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="packed-days" className="text-sm font-semibold md:text-base">
          Packed days
        </h2>
        <span className="text-xs text-muted-foreground">
          {byDay.size} {byDay.size === 1 ? "day" : "days"} entered · tap a day to edit
        </span>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 md:gap-1.5" data-testid="packed-days">
        {WEEK.map((w) => (
          <span key={w} className="text-center text-[11px] font-semibold text-muted-foreground">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {ad.daily.map((d) => {
          const has = byDay.has(d.day);
          const future = d.day > today;
          return (
            <button
              key={d.day}
              type="button"
              disabled={!has}
              aria-pressed={sel === d.day}
              aria-label={`${shortDay(d.day)}${has ? `, ${kgFmt(d.packedKg)} kg packed` : ", nothing packed"}`}
              onClick={() => {
                setSel(sel === d.day ? null : d.day);
                setOpen(null);
              }}
              className={cn(
                "flex min-h-11 flex-col justify-between rounded-lg border p-1 text-left md:min-h-12 md:p-1.5",
                has
                  ? "border-border bg-card hover:border-primary/50"
                  : "border-dashed border-border",
                future && !has && "opacity-40",
                !d.working && "bg-muted/60",
                d.day === today && "outline outline-2 outline-offset-1 outline-primary",
                sel === d.day && "border-primary bg-primary/10",
              )}
            >
              <span className="text-[10.5px] font-bold text-muted-foreground">{dayNum(d.day)}</span>
              {has && (
                <>
                  <span className="text-[10px] font-bold tabular-nums md:text-[11px]">
                    {compact(d.packedKg)}
                  </span>
                  <span
                    className="h-1 rounded-full bg-primary"
                    style={{ width: `${Math.max(10, (d.packedKg / max) * 100)}%` }}
                  />
                </>
              )}
            </button>
          );
        })}
      </div>
      {sel && (
        <div
          className="mt-3 flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/5 p-2.5"
          data-testid="packed-day-panel"
        >
          <p className="text-sm font-semibold">{shortDay(sel)}</p>
          {selLines.map(([lineId, kg]) => (
            <div key={lineId} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {lineName(lineId)} · <span className="tabular-nums">{kgFmt(kg)} kg</span>
                </span>
                <Button
                  type="button"
                  variant={open === lineId ? "default" : "outline"}
                  className="h-11 md:h-8"
                  onClick={() => setOpen(open === lineId ? null : lineId)}
                  aria-label={`${open === lineId ? "Close" : "Edit"} ${lineName(lineId)} ${shortDay(sel)}`}
                >
                  {open === lineId ? "Close" : "Edit"}
                </Button>
                {canEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 text-muted-foreground hover:text-destructive-strong md:h-8 md:w-8"
                    aria-label={`Remove ${lineName(lineId)} ${shortDay(sel)}`}
                    onClick={() => onRemoveDay(sel, lineId)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {open === lineId && (
                <PackedSkusEditor
                  key={`${sel}|${lineId}`}
                  day={sel}
                  lineId={lineId}
                  lineLabel={lineName(lineId)}
                  dayLabel={shortDay(sel)}
                  rows={packed.filter((r) => r.day === sel && r.line_id === lineId)}
                  skus={skus}
                  canEdit={canEdit}
                  title="SKUs"
                  className="rounded-lg bg-card p-2.5"
                />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
