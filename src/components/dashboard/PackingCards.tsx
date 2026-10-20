// Dashboard › Packing (November 2026 monthly upgrade, approved mockup):
//   - Packing OEE: the line's packing machines over the period, with
//     Availability × Performance × Quality and a row per machine;
//   - the month's packed-kg forecast against packing actual.
// The rules are in src/lib/oee.ts.
// Each OEE card shows the period's OEE and, under it, the same OEE for the
// last recorded day of the period (Ala, 19 Oct 2026). Under both cards, that
// day by shift and by operator (ShiftOeeCards, 20 Oct 2026).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/dashboard/DashboardCards";
import { cn } from "@/lib/utils";
import type {
  DailyEntry,
  MaintenanceEvent,
  MaintenanceStoppage,
  ProductionLine,
} from "@/lib/queries";
import { lineCapacitiesQuery, type LineCapacity } from "@/lib/capacity";
import { lineOee, type OeeBasis } from "@/lib/line-oee";
import {
  entryMachinesQuery,
  machineEventsQuery,
  machinesForLine,
  packingMachinesQuery,
} from "@/lib/packing";
import { computeLineOee, oeeTone, type LineOee } from "@/lib/oee";
import { ShiftOeeCards } from "@/components/dashboard/ShiftOeeCards";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const kg = (n: number) => Math.round(n).toLocaleString("en-US");
const mins = (n: number) => Math.round(n).toLocaleString("en-US");

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/** Under the period's OEE: the same OEE for the last day that has a record. */
function LastDayOee({
  day,
  oee,
  A,
  P,
  Q,
  testId,
}: {
  day: string;
  oee: number | null;
  A: number | null;
  P: number | null;
  Q: number | null;
  testId: string;
}) {
  const t = oeeTone(oee);
  return (
    <div
      data-testid={testId}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-[13px]"
    >
      <span className="min-w-0">
        <span className="font-semibold">Last recorded day</span>
        <span className="text-muted-foreground"> · {dayLabel(day)}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 tabular-nums">
        <span className="text-xs text-muted-foreground">
          A {pct(A)} · P {pct(P)} · Q {pct(Q)}
        </span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", TONE_CHIP[t])}>
          {pct(oee)}
        </span>
      </span>
    </div>
  );
}

const TONE_TEXT = {
  good: "text-success-strong",
  warn: "text-warning-strong",
  bad: "text-destructive-strong",
  none: "text-muted-foreground",
} as const;
const TONE_CHIP = {
  good: "bg-success/15 text-success-strong",
  warn: "bg-warning/15 text-warning-strong",
  bad: "bg-destructive/10 text-destructive-strong",
  none: "bg-muted text-muted-foreground",
} as const;
const TONE_RING = {
  good: "var(--color-success)",
  warn: "var(--color-warning)",
  bad: "var(--color-destructive)",
  none: "var(--color-muted-foreground)",
} as const;

export function OeeSection({
  line,
  from,
  to,
  entries,
  events,
  stoppages,
  rangeText,
  lostByDay,
}: {
  line: ProductionLine;
  from: string;
  to: string;
  entries: DailyEntry[];
  events: MaintenanceEvent[];
  stoppages: MaintenanceStoppage[];
  rangeText: string;
  lostByDay: Map<string, number>;
}) {
  const { data: allMachines = [] } = useQuery(packingMachinesQuery);
  const machines = machinesForLine(allMachines, line.id);
  const { data: capacities = [] } = useQuery(lineCapacitiesQuery);
  const hasCapacity = capacities.some((c) => c.line_id === line.id);
  if (machines.length === 0 && !hasCapacity) return null;
  return (
    <div data-pdf-section="oee" className="grid gap-3.5 md:grid-cols-2 md:items-start md:gap-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground md:col-span-2">
        OEE
      </h2>
      {hasCapacity && (
        <div className="flex min-w-0 [&>section]:flex-1">
          <LineOeeCard
            line={line}
            entries={entries}
            capacities={capacities}
            lostByDay={lostByDay}
            rangeText={rangeText}
          />
        </div>
      )}
      {machines.length > 0 && (
        <div className="flex min-w-0 [&>section]:flex-1">
          <PackingOeeCard
            lineId={line.id}
            lineName={line.name}
            machines={machines}
            from={from}
            to={to}
            entries={entries}
            events={events}
            stoppages={stoppages}
            rangeText={rangeText}
          />
        </div>
      )}
      {machines.length > 0 && (
        <ShiftOeeCards
          lineId={line.id}
          machines={machines}
          from={from}
          to={to}
          entries={entries}
          stoppages={stoppages}
        />
      )}
    </div>
  );
}

function OeeRing({ value, testId }: { value: number | null; testId: string }) {
  const tone = oeeTone(value);
  return (
    <div
      data-testid={`${testId}-ring`}
      className="grid h-24 w-24 shrink-0 place-items-center rounded-full"
      style={{
        background: `conic-gradient(${TONE_RING[tone]} ${Math.min(100, Math.max(0, (value ?? 0) * 100))}%, var(--color-muted) 0)`,
      }}
    >
      <div className="grid h-[74px] w-[74px] place-items-center rounded-full bg-card text-center">
        <div>
          <p
            data-testid={`${testId}-value`}
            className="text-xl font-bold leading-none tabular-nums"
          >
            {pct(value)}
          </p>
          <p className="mt-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground">
            OEE
          </p>
        </div>
      </div>
    </div>
  );
}

function ApqBars({ A, P, Q }: { A: number | null; P: number | null; Q: number | null }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      {(
        [
          ["Availability", A, "bg-chart-1"],
          ["Performance", P, "bg-chart-2"],
          ["Quality", Q, "bg-chart-3"],
        ] as const
      ).map(([label, v, bar]) => (
        <div
          key={label}
          className="grid grid-cols-[5.8rem_minmax(0,1fr)_2.8rem] items-center gap-2 text-[13px]"
        >
          <span>{label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-muted">
            <span
              className={cn("block h-full rounded-full", bar)}
              style={{ width: `${Math.min(100, (v ?? 0) * 100)}%` }}
            />
          </span>
          <span className="text-right font-semibold tabular-nums">{pct(v)}</span>
        </div>
      ))}
    </div>
  );
}

function LineOeeCard({
  line,
  entries,
  capacities,
  lostByDay,
  rangeText,
}: {
  line: ProductionLine;
  entries: DailyEntry[];
  capacities: LineCapacity[];
  lostByDay: Map<string, number>;
  rangeText: string;
}) {
  const unit = line.making_count_unit?.trim() || null;
  const basis: OeeBasis = line.oee_basis === "count" && unit ? "count" : "kg";
  const r = lineOee({ entries, capacities, lineId: line.id, basis, lostByDay });
  const u = basis === "count" ? (unit ?? "") : "kg";
  // The last day of the period this line has a making figure for.
  const lastDay = entries
    .filter(
      (e) =>
        e.line_id === line.id &&
        (basis === "count" ? Number(e.making_actual_count) > 0 : Number(e.making_actual) > 0),
    )
    .reduce<string | null>((d, e) => (d === null || e.entry_date > d ? e.entry_date : d), null);
  const last =
    lastDay === null
      ? null
      : lineOee({
          entries: entries.filter((e) => e.entry_date === lastDay),
          capacities,
          lineId: line.id,
          basis,
          lostByDay,
        });
  return (
    <Card labelledBy="dash-line-oee">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="dash-line-oee" className="text-[15px] font-semibold md:text-base">
          {line.name} · Making
        </h3>
        <p className="text-[13px] text-muted-foreground md:text-xs">
          by {u} · {rangeText}
        </p>
      </div>
      {r.oee === null ? (
        <p data-testid="line-oee-empty" className="text-sm text-muted-foreground">
          No entries with a making capacity{basis === "count" ? ` and a count in ${u}` : ""} in this
          period.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <OeeRing value={r.oee} testId="line-oee" />
            <ApqBars A={r.A} P={r.P} Q={r.Q} />
          </div>
          {lastDay && last && last.oee !== null && (
            <LastDayOee
              day={lastDay}
              oee={last.oee}
              A={last.A}
              P={last.P}
              Q={last.Q}
              testId="line-oee-last"
            />
          )}
          <p data-testid="line-oee-detail" className="text-xs text-muted-foreground">
            {kg(r.made)} {u} made against {kg(r.possible)} possible in {mins(r.runMin)} running
            minutes. {mins(r.lostMin)} min lost, {kg(r.reworkKg)} kg rework.
            {r.skipped > 0
              ? ` ${r.skipped} ${r.skipped === 1 ? "entry" : "entries"} without a capacity left out.`
              : ""}
          </p>
          {(r.P ?? 0) > 1.05 && (
            <p className={cn("text-xs font-medium", TONE_TEXT.warn)}>
              More than 100% performance: the line made more than its capacity
              {basis === "count" ? ` in ${u}` : ""}. Check the capacity in Settings › Production
              lines.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function PackingOeeCard({
  lineId,
  lineName,
  machines,
  from,
  to,
  entries,
  events,
  stoppages,
  rangeText,
}: {
  lineId: string;
  lineName: string;
  machines: ReturnType<typeof machinesForLine>;
  from: string;
  to: string;
  entries: DailyEntry[];
  events: MaintenanceEvent[];
  stoppages: MaintenanceStoppage[];
  rangeText: string;
}) {
  const entryIds = useMemo(() => new Set(entries.map((e) => e.id)), [entries]);
  const machineIds = useMemo(() => machines.map((m) => m.id), [machines]);
  const rowsQ = useQuery(entryMachinesQuery(from, to));
  const mEventsQ = useQuery(machineEventsQuery(machineIds, from, to));
  const oee: LineOee | null = useMemo(() => {
    if (!rowsQ.data) return null;
    const byId = new Map<string, MaintenanceEvent>();
    for (const e of [...events, ...(mEventsQ.data ?? [])]) byId.set(e.id, e);
    return computeLineOee({
      machines,
      machineDays: rowsQ.data.filter((r) => entryIds.has(r.entry_id)),
      events: [...byId.values()],
      stoppages,
      lineId,
      quality: entries.map((e) => ({
        entry_date: e.entry_date,
        packing_actual: Number(e.packing_actual) || 0,
        rework_packing: Number(e.rework_packing) || 0,
      })),
      from,
      to,
    });
  }, [rowsQ.data, mEventsQ.data, events, machines, stoppages, lineId, entries, entryIds, from, to]);

  // The last day of the period with machine shifts entered for this line.
  const lastDay = useMemo(() => {
    if (!rowsQ.data) return null;
    const ids = new Set(machineIds);
    let d: string | null = null;
    for (const r of rowsQ.data)
      if (
        entryIds.has(r.entry_id) &&
        ids.has(r.machine_id) &&
        r.shifts > 0 &&
        (d === null || r.entry_date > d)
      )
        d = r.entry_date;
    return d;
  }, [rowsQ.data, entryIds, machineIds]);
  const lastOee: LineOee | null = useMemo(() => {
    if (!rowsQ.data || !lastDay) return null;
    const byId = new Map<string, MaintenanceEvent>();
    for (const e of [...events, ...(mEventsQ.data ?? [])]) byId.set(e.id, e);
    return computeLineOee({
      machines,
      machineDays: rowsQ.data.filter((r) => entryIds.has(r.entry_id) && r.entry_date === lastDay),
      events: [...byId.values()],
      stoppages,
      lineId,
      quality: entries
        .filter((e) => e.entry_date === lastDay)
        .map((e) => ({
          entry_date: e.entry_date,
          packing_actual: Number(e.packing_actual) || 0,
          rework_packing: Number(e.rework_packing) || 0,
        })),
      from: lastDay,
      to: lastDay,
    });
  }, [rowsQ.data, mEventsQ.data, events, machines, stoppages, lineId, entries, entryIds, lastDay]);

  const tone = oeeTone(oee?.oee ?? null);
  const ran = oee ? oee.machines.some((m) => m.plannedMin > 0) : false;

  return (
    <Card labelledBy="dash-oee">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="dash-oee" className="text-[15px] font-semibold md:text-base">
          {lineName} · Packing machines
        </h3>
        <p className="text-[13px] text-muted-foreground md:text-xs">{rangeText}</p>
      </div>
      {rowsQ.isError ? (
        <p className="text-sm text-destructive-strong">The packing machines didn&rsquo;t load.</p>
      ) : !oee ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !ran ? (
        <p data-testid="oee-empty" className="text-sm text-muted-foreground">
          No machine shifts in the daily entries for this period. They are entered under Packing
          machines on the Daily entry.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <div
              data-testid="oee-ring"
              className="grid h-24 w-24 shrink-0 place-items-center rounded-full"
              style={{
                background: `conic-gradient(${TONE_RING[tone]} ${Math.min(100, Math.max(0, (oee.oee ?? 0) * 100))}%, var(--color-muted) 0)`,
              }}
            >
              <div className="grid h-[74px] w-[74px] place-items-center rounded-full bg-card text-center">
                <div>
                  <p
                    data-testid="oee-value"
                    className="text-xl font-bold leading-none tabular-nums"
                  >
                    {pct(oee.oee)}
                  </p>
                  <p className="mt-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground">
                    OEE
                  </p>
                </div>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {(
                [
                  ["Availability", oee.A, "bg-chart-1"],
                  ["Performance", oee.P, "bg-chart-2"],
                  ["Quality", oee.Q, "bg-chart-3"],
                ] as const
              ).map(([label, v, bar]) => (
                <div
                  key={label}
                  className="grid grid-cols-[5.8rem_minmax(0,1fr)_2.8rem] items-center gap-2 text-[13px]"
                >
                  <span>{label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn("block h-full rounded-full", bar)}
                      style={{ width: `${Math.min(100, (v ?? 0) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right font-semibold tabular-nums">{pct(v)}</span>
                </div>
              ))}
            </div>
          </div>
          {lastDay && lastOee && lastOee.oee !== null && (
            <LastDayOee
              day={lastDay}
              oee={lastOee.oee}
              A={lastOee.A}
              P={lastOee.P}
              Q={lastOee.Q}
              testId="oee-last"
            />
          )}
          <p className="text-xs text-muted-foreground">
            Lost {mins(oee.lostToStopsMin)} min to faults and line stops and{" "}
            {mins(oee.lostToSpeedMin)} min to running below ideal speed, out of{" "}
            {mins(oee.plannedMin)} planned machine minutes.
          </p>
          <ul className="flex flex-col" data-testid="oee-machines">
            {oee.machines.map((m) => {
              const t = oeeTone(m.oee);
              return (
                <li
                  key={m.machine.id}
                  className="flex min-h-11 items-center justify-between gap-2 border-t border-border py-1.5 text-[13px]"
                >
                  <span className="min-w-0">
                    <span className="font-semibold">{m.machine.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {m.plannedMin > 0
                        ? `${m.shifts} ${m.shifts === 1 ? "shift" : "shifts"} · ${m.faults} ${m.faults === 1 ? "fault" : "faults"}${m.faultMin > 0 ? `, ${mins(m.faultMin)} min` : ""}`
                        : m.openFault
                          ? "Open fault · didn't run"
                          : "Didn't run"}
                    </span>
                  </span>
                  {m.plannedMin > 0 && (
                    <span className="flex shrink-0 items-center gap-2 tabular-nums">
                      <span className="text-xs text-muted-foreground">
                        A {pct(m.A)} · P {pct(m.P)}
                      </span>
                      <span
                        className={cn("rounded-full px-2 py-0.5 text-xs font-bold", TONE_CHIP[t])}
                      >
                        {pct(m.oee)}
                      </span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {oee.machines.some((m) => (m.P ?? 0) > 1.05) && (
            <p className={cn("text-xs font-medium", TONE_TEXT.warn)}>
              A machine shows more than 100% performance: check its bags in the entry or its speed
              in Settings › Packing.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
