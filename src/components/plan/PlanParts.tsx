// Plan adherence › Forecast: the sortable SKU board with status tabs and pages
// (approved mockup "Plan Adherence Redesign", 19 Oct 2026). Packed is local
// packing less B2B orders, as in the hero (mockup "Plan adherence upgrade v2").
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Adherence, SkuAdherence, SkuStatus } from "@/lib/plan-adherence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { kgFmt, num, pctFmt } from "@/components/plan/format";

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
        <div
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5"
          role="tablist"
          data-pdf-exclude="true"
        >
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
        <div className="flex gap-2" data-pdf-exclude="true">
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

      <div className={HEAD_GRID}>
        {head("name", "SKU", "left")}
        {head("forecast", "Forecast kg")}
        {head("packed", "Packed kg")}
        {head("left", "Still to pack")}
        {head("achieved", "Achieved")}
      </div>
      <ul data-testid="plan-skus">
        {shown.map((r) => (
          <SkuRow key={r.code} r={r} share={ad.share} lineName={lineName} />
        ))}
        {shown.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">No SKUs here.</li>
        )}
      </ul>
      <div
        className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground md:px-4"
        data-pdf-exclude="true"
      >
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

const HEAD_GRID =
  "hidden grid-cols-[minmax(0,1fr)_96px_96px_96px_88px] gap-2 bg-muted/60 px-4 py-1.5 text-[11.5px] font-semibold text-muted-foreground md:grid";

function SkuRow({
  r,
  share,
  lineName,
}: {
  r: SkuAdherence;
  share: number;
  lineName: (id: string | null) => string;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border px-3 py-2 first:border-t-0 md:grid-cols-[minmax(0,1fr)_96px_96px_96px_88px] md:px-4">
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
              style={{ left: `calc(${share * 100}% - 1px)` }}
            />
          )}
        </span>
      </div>
      <span className="hidden text-right text-sm tabular-nums md:block">
        {kgFmt(r.forecastKg ?? 0)}
      </span>
      <span className="hidden text-right text-sm tabular-nums md:block">{kgFmt(r.packedKg)}</span>
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
  );
}

const PDF_CHUNK = 25;

// The board for the PDF export: every SKU of the month, Achieved lowest
// first (no forecast last, as on screen), no tabs, search or pages. Each
// chunk of rows is its own PDF section with the column header repeated, so a
// page break never falls inside a row.
export function SkuBoardPdf({
  ad,
  lineName,
}: {
  ad: Adherence;
  lineName: (id: string | null) => string;
}) {
  const rows = [...ad.skus].sort((a, b) => {
    if ((a.achieved === null) !== (b.achieved === null)) return a.achieved === null ? 1 : -1;
    return (a.achieved ?? 0) - (b.achieved ?? 0);
  });
  const chunks: SkuAdherence[][] = [];
  for (let i = 0; i < rows.length; i += PDF_CHUNK) chunks.push(rows.slice(i, i + PDF_CHUNK));
  return (
    <>
      {chunks.map((chunk, i) => (
        <section
          key={i}
          data-pdf-section={`skus-${i + 1}`}
          className="min-w-0 rounded-2xl border border-border bg-card shadow-card"
        >
          <div className="flex items-baseline justify-between gap-2 border-b border-border p-3 md:p-4">
            <h2 className="text-sm font-semibold md:text-base">
              By SKU · Achieved, lowest first{i > 0 ? " (continued)" : ""}
            </h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {i * PDF_CHUNK + 1}–{i * PDF_CHUNK + chunk.length} of {rows.length} SKUs
            </span>
          </div>
          <div className={HEAD_GRID}>
            <span className="px-1 py-0.5">SKU</span>
            <span className="px-1 py-0.5 text-right">Forecast kg</span>
            <span className="px-1 py-0.5 text-right">Packed kg</span>
            <span className="px-1 py-0.5 text-right">Still to pack</span>
            <span className="px-1 py-0.5 text-right">Achieved</span>
          </div>
          <ul>
            {chunk.map((r) => (
              <SkuRow key={r.code} r={r} share={ad.share} lineName={lineName} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
