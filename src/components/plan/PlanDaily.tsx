// Plan adherence › Daily (approved mockup "Plan adherence upgrade v2",
// 28 Oct 2026): the month as a calendar coloured by each day's local tons
// against the forecast's pace a working day, a line filter, and the picked
// day's panel with its lines, where a line-day's packed SKUs are edited or
// removed (the old Packed days calendar).
import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Adherence, DayAdherence } from "@/lib/plan-adherence";
import type { PackedSku, Sku } from "@/lib/packing";
import { Button } from "@/components/ui/button";
import { PackedSkusEditor } from "@/components/entry/PackedSkusEditor";
import { dayNum, longDay, monthShort, shortDay, tons } from "@/components/plan/format";

const WEEK = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

type Tone = "g2" | "g1" | "a1" | "r1" | "r2" | "extra" | "none";
const TONE: Record<Tone, string> = {
  g2: "border-transparent bg-success-strong text-white",
  g1: "border-success/40 bg-success/15 text-success-strong",
  a1: "border-warning/50 bg-warning/15 text-warning-strong",
  r1: "border-destructive/30 bg-destructive/10 text-destructive-strong",
  r2: "border-transparent bg-destructive-strong text-white",
  extra: "border-primary/40 bg-primary/10 text-primary",
  none: "border-border bg-card text-foreground",
};
const LEGEND: { tone: Tone; label: string }[] = [
  { tone: "g2", label: "15%+ above pace" },
  { tone: "g1", label: "at pace" },
  { tone: "a1", label: "up to 15% under" },
  { tone: "r1", label: "15–40% under" },
  { tone: "r2", label: "far under" },
  { tone: "extra", label: "Friday / day off (extra)" },
];
function toneOf(kg: number, pace: number, working: boolean): Tone {
  if (!working) return "extra";
  if (pace <= 0) return "none";
  const r = kg / pace;
  return r >= 1.15 ? "g2" : r >= 1 ? "g1" : r >= 0.85 ? "a1" : r >= 0.6 ? "r1" : "r2";
}

export function PlanDaily({
  ad,
  packed,
  today,
  lineName,
  color,
  skus,
  canEdit,
  onRemoveDay,
  pdf = false,
}: {
  ad: Adherence;
  packed: PackedSku[];
  today: string;
  lineName: (id: string | null) => string;
  color: (id: string | null) => string;
  skus: Sku[];
  canEdit: boolean;
  onRemoveDay: (day: string, lineId: string) => void;
  // PDF export: the calendar and its legend alone, all lines, nothing picked.
  pdf?: boolean;
}) {
  const [line, setLine] = useState("");
  const [sel, setSel] = useState<string | null>(() => (pdf ? null : ad.lastDay));
  const [open, setOpen] = useState<string | null>(null);
  const lineIds = useMemo(() => {
    const kg = new Map<string, number>();
    for (const d of ad.daily) for (const [id, v] of d.byLine) kg.set(id, (kg.get(id) ?? 0) + v);
    return [...kg.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [ad.daily]);
  const lineFc = line ? (ad.lines.find((l) => l.lineId === line)?.forecastKg ?? 0) : ad.forecastKg;
  const pace = ad.workingDays > 0 ? lineFc / ad.workingDays : 0;
  const valueOf = (d: DayAdherence) => (line ? (d.byLine.get(line) ?? 0) : d.localKg);
  const first = ad.daily[0]?.day;
  const lead = first ? (new Date(`${first}T00:00:00`).getDay() + 1) % 7 : 0;
  const picked = sel ? ad.daily.find((d) => d.day === sel) : undefined;

  const calendar = (
    <section
      className="min-w-0 rounded-2xl border border-border bg-card p-3 shadow-card md:p-4"
      data-pdf-section={pdf ? "daily" : undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold md:text-base">
          {first ? monthShort(first) : ""} · tons a day{line ? ` · ${lineName(line)}` : ""}
          {pdf ? " · all lines" : ""}
        </h2>
        <span className="text-[11px] text-muted-foreground">
          colour = local t vs forecast pace {tons(pace)} t{pdf ? "" : " · tap a day"}
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
          const v = valueOf(d);
          const has = d.localKg + d.exportKg > 0;
          const tone = has && v > 0 ? toneOf(v, pace, d.working) : "none";
          return (
            <button
              key={d.day}
              type="button"
              disabled={!has}
              aria-pressed={sel === d.day}
              aria-label={`${shortDay(d.day)}${has ? `, ${tons(v)} t` : d.working ? ", nothing packed" : ", day off"}`}
              onClick={() => {
                setSel(sel === d.day ? null : d.day);
                setOpen(null);
              }}
              data-tone={tone}
              className={cn(
                "flex min-h-12 flex-col justify-between rounded-lg border p-1 text-left md:min-h-14 md:p-1.5",
                has ? TONE[tone] : "border-dashed border-border text-muted-foreground",
                !has && d.day > today && "opacity-50",
                d.day === today && "outline outline-2 outline-offset-1 outline-primary",
                sel === d.day && "ring-2 ring-foreground ring-offset-1 ring-offset-card",
              )}
            >
              <span className="text-[10.5px] font-bold opacity-80">
                {dayNum(d.day)}
                {d.friday ? <span className="hidden sm:inline"> · Fri</span> : null}
              </span>
              <span className="text-xs font-extrabold tabular-nums md:text-base">
                {has ? tons(v) : d.working ? "—" : "off"}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {LEGEND.map((l) => (
          <span key={l.tone} className="inline-flex items-center gap-1">
            <i aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-sm border", TONE[l.tone])} />
            {l.label}
          </span>
        ))}
      </div>
    </section>
  );
  if (pdf) return calendar;

  return (
    <div className="flex flex-col gap-3 md:gap-4" data-testid="plan-daily">
      <div
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5"
        role="group"
        aria-label="Line"
        data-pdf-exclude="true"
      >
        {["", ...lineIds].map((id) => (
          <button
            key={id || "all"}
            type="button"
            aria-pressed={line === id}
            onClick={() => setLine(id)}
            className={cn(
              "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold md:h-8",
              line === id
                ? "border-transparent bg-foreground text-background"
                : "border-border bg-card hover:border-primary/40",
            )}
          >
            {id && (
              <i
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ background: color(id) }}
              />
            )}
            {id ? lineName(id) : "All lines"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:items-start md:gap-4">
        {calendar}

        <section
          className="min-w-0 rounded-2xl border border-border bg-card p-3 shadow-card md:p-4"
          data-testid="packed-day-panel"
        >
          {!picked ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Tap a day to see its lines and packed SKUs.
            </p>
          ) : (
            <DayPanel
              d={picked}
              pace={pace}
              packed={packed}
              lineName={lineName}
              color={color}
              skus={skus}
              canEdit={canEdit}
              open={open}
              setOpen={setOpen}
              onRemoveDay={onRemoveDay}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function DayPanel({
  d,
  pace,
  packed,
  lineName,
  color,
  skus,
  canEdit,
  open,
  setOpen,
  onRemoveDay,
}: {
  d: DayAdherence;
  pace: number;
  packed: PackedSku[];
  lineName: (id: string | null) => string;
  color: (id: string | null) => string;
  skus: Sku[];
  canEdit: boolean;
  open: string | null;
  setOpen: (id: string | null) => void;
  onRemoveDay: (day: string, lineId: string) => void;
}) {
  const rows = packed.filter((r) => r.day === d.day);
  const lines = useMemo(() => {
    const m = new Map<string, { local: number; exp: number; n: number }>();
    for (const r of rows) {
      const x = m.get(r.line_id) ?? { local: 0, exp: 0, n: 0 };
      if (r.kind === "export") x.exp += r.kg ?? 0;
      else x.local += r.kg ?? 0;
      x.n++;
      m.set(r.line_id, x);
    }
    return [...m.entries()].sort((a, b) => b[1].local + b[1].exp - (a[1].local + a[1].exp));
  }, [rows]);
  const skuCount = new Set(rows.map((r) => r.code)).size;
  const total = d.localKg + d.exportKg;
  const delta = d.localKg - pace;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold md:text-base">{longDay(d.day)}</h2>
        {d.working && pace > 0 ? (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
              delta >= 0
                ? "bg-success/15 text-success-strong"
                : "bg-destructive/10 text-destructive-strong",
            )}
          >
            {delta >= 0 ? "▲" : "▼"} {tons(Math.abs(delta))} t vs pace
          </span>
        ) : !d.working ? (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
            Day off · extra
          </span>
        ) : null}
      </div>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-3xl font-extrabold tabular-nums md:text-4xl" data-testid="day-local">
          {tons(d.localKg)} t
        </span>
        <span className="text-sm text-muted-foreground">
          {skuCount} SKUs{d.exportKg > 0 ? ` · ${tons(d.exportKg)} t export` : ""}
        </span>
      </p>
      {total > 0 && (
        <span className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          {lines.map(([id, x]) => (
            <span
              key={id}
              style={{ width: `${((x.local + x.exp) / total) * 100}%`, background: color(id) }}
            />
          ))}
        </span>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {lines.map(([id, x]) => (
          <li key={id} className="flex flex-col gap-2 py-1.5">
            <div className="flex items-center gap-2 text-sm">
              <i
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: color(id) }}
              />
              <span className="min-w-0 flex-1 truncate">
                {lineName(id)}
                {x.exp > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    + {tons(x.exp)} t export
                  </span>
                )}
              </span>
              <span className="font-bold tabular-nums">{tons(x.local)} t</span>
              <Button
                type="button"
                variant={open === id ? "default" : "outline"}
                data-pdf-exclude="true"
                className="h-11 px-3 md:h-8"
                onClick={() => setOpen(open === id ? null : id)}
                aria-label={`${open === id ? "Close" : "Edit"} ${lineName(id)} ${shortDay(d.day)}`}
              >
                {open === id ? "Close" : "SKUs"}
              </Button>
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  data-pdf-exclude="true"
                  size="icon"
                  className="h-11 w-11 shrink-0 text-muted-foreground hover:text-destructive-strong md:h-8 md:w-8"
                  aria-label={`Remove ${lineName(id)} ${shortDay(d.day)}`}
                  onClick={() => onRemoveDay(d.day, id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            {open === id && (
              <PackedSkusEditor
                key={`${d.day}|${id}`}
                day={d.day}
                lineId={id}
                lineLabel={lineName(id)}
                dayLabel={shortDay(d.day)}
                rows={rows.filter((r) => r.line_id === id)}
                skus={skus}
                canEdit={canEdit}
                title="SKUs"
                className="rounded-lg bg-muted/40 p-2.5"
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
