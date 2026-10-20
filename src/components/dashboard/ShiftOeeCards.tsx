// Dashboard › OEE: the last recorded day by shift (A · B · C) and by operator,
// from the machine sheet (approved mockup "Shift & Operator OEE", 20 Oct 2026).
// The rules are in src/lib/shift-oee.ts.
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/dashboard/DashboardCards";
import { cn } from "@/lib/utils";
import type { DailyEntry, MaintenanceStoppage } from "@/lib/queries";
import { machineRunsQuery, type PackingMachine } from "@/lib/packing";
import { lineQuality, oeeTone } from "@/lib/oee";
import {
  computeShiftOee,
  lastRunDayQuery,
  SHIFT_CODES,
  SHIFT_HOURS,
  shiftEventsQuery,
  type ShiftCode,
  type ShiftOee,
} from "@/lib/shift-oee";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const n0 = (n: number) => Math.round(n).toLocaleString("en-US");

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

type Tone = "good" | "warn" | "bad" | "none";
/** Over 100% is a data problem (speed or bags), not a great shift. */
const tone = (v: number | null): Tone => (v !== null && v > 1 ? "warn" : oeeTone(v));
const CHIP: Record<Tone, string> = {
  good: "bg-success/15 text-success-strong",
  warn: "bg-warning/15 text-warning-strong",
  bad: "bg-destructive/10 text-destructive-strong",
  none: "bg-muted text-muted-foreground",
};
const TEXT: Record<Tone, string> = {
  good: "text-success-strong",
  warn: "text-warning-strong",
  bad: "text-destructive-strong",
  none: "text-muted-foreground",
};
const BAR: Record<Tone, string> = {
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  none: "bg-muted-foreground",
};
const SHIFT_BG: Record<ShiftCode, string> = {
  A: "bg-chart-1",
  B: "bg-chart-4",
  C: "bg-chart-2",
};

function ShiftBadge({ s, small }: { s: ShiftCode; small?: boolean }) {
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center font-bold text-white",
        SHIFT_BG[s],
        small ? "h-[18px] w-[18px] rounded text-[10.5px]" : "h-9 w-9 rounded-lg text-[15px]",
      )}
    >
      {s}
    </span>
  );
}

function Bar({ v, className }: { v: number | null; className?: string }) {
  return (
    <span className={cn("block h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <span
        className={cn("block h-full rounded-full", BAR[tone(v)])}
        style={{ width: `${Math.min(100, Math.max(0, (v ?? 0) * 100))}%` }}
      />
    </span>
  );
}

function Meter({ label, v }: { label: string; v: number | null }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex justify-between gap-1 text-[11px] text-muted-foreground">
        <span>
          <span className="sm:hidden">{label[0]}</span>
          <span className="hidden sm:inline">{label}</span>
        </span>
        <b className="font-semibold text-foreground tabular-nums">{pct(v)}</b>
      </span>
      <Bar v={v} />
    </span>
  );
}

export function ShiftOeeCards({
  lineId,
  machines,
  from,
  to,
  entries,
  stoppages,
}: {
  lineId: string;
  machines: PackingMachine[];
  from: string;
  to: string;
  entries: DailyEntry[];
  stoppages: MaintenanceStoppage[];
}) {
  const machineIds = useMemo(() => machines.map((m) => m.id), [machines]);
  const dayQ = useQuery(lastRunDayQuery(machineIds, from, to));
  const day = dayQ.data ?? null;
  const runsQ = useQuery({ ...machineRunsQuery(day ?? ""), enabled: !!day });
  const eventsQ = useQuery({ ...shiftEventsQuery(lineId, machineIds, day ?? ""), enabled: !!day });

  const data: ShiftOee | null = useMemo(() => {
    if (!day || !runsQ.data || !eventsQ.data) return null;
    const ids = new Set(machineIds);
    const dayEntries = entries.filter((e) => e.line_id === lineId && e.entry_date === day);
    const Q = dayEntries.length
      ? lineQuality(
          dayEntries.map((e) => ({
            entry_date: e.entry_date,
            packing_actual: Number(e.packing_actual) || 0,
            rework_packing: Number(e.rework_packing) || 0,
          })),
        ).Q
      : null;
    return computeShiftOee({
      day,
      machines,
      runs: runsQ.data.filter((r) => ids.has(r.machine_id)),
      events: eventsQ.data,
      stoppages,
      lineId,
      Q,
    });
  }, [day, runsQ.data, eventsQ.data, machineIds, machines, entries, lineId, stoppages]);

  if (!day || !data || data.shifts.every((s) => s.cells.length === 0)) return null;
  const qPending = data.Q === null;
  const ran = new Set(data.shifts.flatMap((s) => s.cells.map((c) => c.machine.id))).size;

  return (
    <div data-testid="shift-oee" className="flex min-w-0 flex-col gap-3 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="text-[15px] font-semibold md:text-base">
          Last recorded day · shifts & operators
        </h3>
        <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-primary">
            {dayLabel(day)}
          </span>
          <span className="rounded-full border border-border px-2.5 py-1">
            {ran} {ran === 1 ? "machine" : "machines"}
          </span>
          {qPending && (
            <span
              data-testid="shift-oee-q-pending"
              className="rounded-full bg-warning/15 px-2.5 py-1 text-warning-strong"
            >
              Q pending
            </span>
          )}
        </div>
      </div>
      <div className="grid min-w-0 gap-3.5 md:grid-cols-2 md:items-start md:gap-4">
        <ShiftCard data={data} />
        <OperatorCard data={data} />
      </div>
      <Alerts data={data} />
    </div>
  );
}

function ShiftCard({ data }: { data: ShiftOee }) {
  const t = data.total;
  return (
    <Card labelledBy="dash-shift-oee">
      <div className="flex items-baseline justify-between gap-3">
        <h4 id="dash-shift-oee" className="text-[15px] font-semibold">
          By shift
        </h4>
        <span className="text-xs text-muted-foreground">
          {data.Q === null ? "OEE = A × P · Q pending" : "OEE = A × P × Q"}
        </span>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 gap-y-0.5 rounded-xl bg-muted/60 px-3 py-2.5">
        <span
          data-testid="shift-oee-day"
          className="row-span-2 text-[28px] font-extrabold tabular-nums tracking-tight"
        >
          {pct(t.oee)}
        </span>
        <span className="text-xs">
          <b>Day</b> · {n0(t.bags)} bags · {n0(t.kg)} kg
        </span>
        <span className="flex flex-wrap gap-3 text-xs text-muted-foreground tabular-nums">
          <span>
            A <b className="text-foreground">{pct(t.A)}</b>
          </span>
          <span>
            P <b className="text-foreground">{pct(t.P)}</b>
          </span>
          <span>
            Q <b className="text-foreground">{pct(t.Q)}</b>
          </span>
        </span>
      </div>
      {data.shifts.map((s) => (
        <div
          key={s.shift}
          data-testid={`shift-oee-${s.shift}`}
          className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border p-3"
        >
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5">
            <ShiftBadge s={s.shift} />
            <span className="flex min-w-0 flex-col">
              <b className="text-sm">Shift {s.shift}</b>
              <span className="text-xs text-muted-foreground tabular-nums">
                {SHIFT_HOURS[s.shift]}
                {s.shift === "C" ? " (next day)" : ""}
                {s.cells.length > 0 ? ` · ${n0(s.bags)} bags · ${n0(s.kg)} kg` : ""}
              </span>
            </span>
            <span
              className={cn(
                "min-w-16 rounded-lg px-2.5 py-1 text-center text-[15px] font-extrabold tabular-nums",
                CHIP[s.cells.length ? tone(s.oee) : "none"],
              )}
            >
              {s.cells.length ? pct(s.oee) : "—"}
            </span>
          </div>
          {s.cells.length === 0 ? (
            <p className="text-xs text-muted-foreground">No machine ran in this shift.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Meter label="Availability" v={s.A} />
                <Meter label="Performance" v={s.P} />
                <Meter label="Quality" v={s.Q} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {s.cells.map((c) =>
                  c.conflict ? (
                    <span
                      key={c.machine.id}
                      title="An open fault covers the whole shift, but it packed bags"
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-warning/15 px-2 py-0.5 text-xs text-warning-strong"
                    >
                      {c.machine.name} · <b className="tabular-nums">{n0(c.bags)}</b> · excluded
                    </span>
                  ) : (
                    <span
                      key={c.machine.id}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-2 py-0.5 text-xs"
                    >
                      {c.machine.name} · <b className="tabular-nums">{n0(c.bags)}</b> ·{" "}
                      <b className={cn("tabular-nums", TEXT[tone(c.P)])}>P {pct(c.P)}</b>
                    </span>
                  ),
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </Card>
  );
}

function OperatorCard({ data }: { data: ShiftOee }) {
  const [order, setOrder] = useState<"high" | "low">("high");
  const [filter, setFilter] = useState<"all" | ShiftCode>("all");
  const list = useMemo(() => {
    const l = data.operators.filter((o) => filter === "all" || o.shifts.includes(filter));
    return l.sort((a, b) =>
      order === "high" ? (b.oee ?? -1) - (a.oee ?? -1) : (a.oee ?? 99) - (b.oee ?? 99),
    );
  }, [data.operators, filter, order]);
  const seg =
    "inline-flex h-11 items-center px-3 text-xs font-semibold text-muted-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground md:h-8 md:px-2.5";

  return (
    <Card labelledBy="dash-operator-oee">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="dash-operator-oee" className="text-[15px] font-semibold">
          By operator
        </h4>
        <div className="flex flex-wrap gap-1.5">
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {(["all", ...SHIFT_CODES] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={seg}
              >
                {f === "all" ? "All" : f}
              </button>
            ))}
          </div>
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              aria-pressed={order === "high"}
              onClick={() => setOrder("high")}
              className={seg}
            >
              ↓ Highest
            </button>
            <button
              type="button"
              aria-pressed={order === "low"}
              onClick={() => setOrder("low")}
              className={seg}
            >
              ↑ Lowest
            </button>
          </div>
        </div>
      </div>
      <ol data-testid="operator-oee" className="flex flex-col">
        {list.map((o, i) => (
          <li
            key={o.name}
            className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 border-t border-border py-2.5 first:border-t-0"
          >
            <span className="text-center text-xs font-bold text-muted-foreground tabular-nums">
              {i + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span dir="auto" className="truncate text-left text-sm font-bold">
                {o.name}
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
                {o.shifts.map((s) => (
                  <ShiftBadge key={s} s={s} small />
                ))}
                <span>{o.machines.join(" + ")}</span>
                {o.excluded.length > 0 && (
                  <span className="font-semibold text-warning-strong">
                    · {o.excluded.join(", ")} excluded
                  </span>
                )}
              </span>
            </span>
            <span className="flex flex-col items-end gap-0.5">
              <span
                className={cn(
                  "min-w-16 rounded-lg px-2.5 py-1 text-center text-sm font-extrabold tabular-nums",
                  CHIP[tone(o.oee)],
                )}
              >
                {pct(o.oee)}
              </span>
              <span className="whitespace-nowrap text-[11px] text-muted-foreground tabular-nums">
                {n0(o.bags)} bags · {n0(o.kg)} kg
              </span>
            </span>
            <Bar v={o.oee} className="col-start-2 col-end-4" />
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        Operators sharing a machine in a shift split its time by their share of the bags.
      </p>
    </Card>
  );
}

function Alerts({ data }: { data: ShiftOee }) {
  const items: { warn: boolean; node: ReactNode }[] = [];
  const byMachine = new Map<string, { shifts: ShiftCode[]; bags: number }>();
  for (const c of data.conflicts) {
    const r = byMachine.get(c.machine.name) ?? { shifts: [], bags: 0 };
    r.shifts.push(c.shift);
    r.bags += c.bags;
    byMachine.set(c.machine.name, r);
  }
  for (const [name, r] of byMachine)
    items.push({
      warn: true,
      node: (
        <>
          <b>{name}</b> — a fault covers shift{r.shifts.length > 1 ? "s" : ""}{" "}
          {r.shifts.join(" and ")}, but it packed {n0(r.bags)} bags. Left out of the totals until
          the fault is closed or corrected.
        </>
      ),
    });
  for (const c of data.fast)
    items.push({
      warn: true,
      node: (
        <>
          <b>
            {c.machine.name} · {c.shift}
          </b>{" "}
          — P {pct(c.P)}: {n0(c.bags)} bags is faster than {c.machine.speed_per_min} / min. Check
          the speed in Settings › Packing.
        </>
      ),
    });
  if (data.Q === null)
    items.push({
      warn: false,
      node: <>No Full-day entry for this day yet, so Q is pending and the OEE is A × P.</>,
    });
  if (!items.length) return null;
  return (
    <div data-testid="shift-oee-alerts" className="flex flex-col gap-1.5">
      {items.map((it, i) => (
        <p
          key={i}
          className={cn(
            "grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-lg px-3 py-2 text-[12.5px]",
            it.warn ? "bg-warning/15" : "bg-muted",
          )}
        >
          <span className={cn("font-extrabold", it.warn ? "text-warning-strong" : "text-primary")}>
            {it.warn ? "!" : "i"}
          </span>
          <span>{it.node}</span>
        </p>
      ))}
    </div>
  );
}
