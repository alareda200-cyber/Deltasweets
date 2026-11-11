// The line room: one line of the Plant floor, opened from its lane
// (mockup "Jammy Control Room", phase 2). Same period choices and the same
// numbers as the Dashboard for that line, drawn as the control room draws.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, LayoutDashboard, Moon, Plus, Sun } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { kpiTiles } from "@/components/dashboard/kpi-data";
import {
  MakingChart,
  OeeWaterfall,
  ReadingCard,
  ShiftRings,
  StopsPerDay,
  Tanks,
} from "@/components/plant/LineRoom";
import { laneColor } from "@/components/plant/lane-color";
import { usePlantLook } from "@/components/plant/use-look";
import { useAuth } from "@/lib/auth-context";
import { useCompany } from "@/lib/companies";
import {
  addDays,
  dailySeries,
  formatRange,
  makingCountView,
  todayIso,
} from "@/lib/dashboard-metrics";
import { monthRange } from "@/lib/date-utils";
import { readLine } from "@/lib/line-reading";
import { can } from "@/lib/permissions";
import { linesQuery } from "@/lib/queries";
import { requireSession } from "@/lib/require-session";
import { useLinePeriod } from "@/lib/use-line-period";
import { cn } from "@/lib/utils";

type Period = "month" | "7d";

export const Route = createFileRoute("/plant_/$lineId")({
  validateSearch: (search: Record<string, unknown>): { p?: Period } => ({
    p: search.p === "7d" ? "7d" : undefined,
  }),
  head: () => ({ meta: [{ title: "Line room · Production Scorecard" }] }),
  beforeLoad: requireSession,
  loader: ({ context }) => context.queryClient.ensureQueryData(linesQuery),
  component: () => (
    <RequireAuth requirePermission="dashboard.view">
      <LineRoomPage />
    </RequireAuth>
  ),
});

function LineRoomPage() {
  const { lineId } = Route.useParams();
  const { p } = Route.useSearch();
  const period: Period = p ?? "month";
  const navigate = useNavigate({ from: "/plant/$lineId" });
  const { role } = useAuth();
  const { current: company } = useCompany();
  const { data: allLines } = useSuspenseQuery(linesQuery);
  const index = allLines.findIndex((l) => l.id === lineId);
  const line = index >= 0 ? allLines[index] : null;
  const [day, toggleDay] = usePlantLook();

  const range = useMemo(() => {
    if (period === "month") return monthRange();
    const today = todayIso();
    return { from: addDays(today, -6), to: today };
  }, [period]);
  const lp = useLinePeriod(line, range.from, range.to);

  const color = line ? laneColor(line.color, index, day) : "var(--pf-pri)";
  const tiles = useMemo(() => {
    if (!lp.n || !line) return null;
    const unit = line.making_count_unit?.trim() || null;
    const count = unit
      ? makingCountView(lp.n.totals, unit, lp.targets.makingCountPct, lp.n.days)
      : undefined;
    return kpiTiles(lp.n.totals, lp.n.split, lp.targets, count);
  }, [lp.n, lp.targets, line]);
  const points = useMemo(
    () => dailySeries(lp.list, range.from, lp.shownTo, "making"),
    [lp.list, range.from, lp.shownTo],
  );
  const reading = useMemo(
    () =>
      lp.n && line
        ? readLine({
            name: line.name,
            days: lp.n.days,
            totals: lp.n.totals,
            split: lp.n.split,
            reasons: lp.n.reasons,
            targets: lp.targets,
            oee: lp.oee,
          })
        : null,
    [lp.n, lp.targets, lp.oee, line],
  );

  // The period switch's sliding thumb.
  const segRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ x: 0, w: 0 });
  useEffect(() => {
    const b = segRef.current?.querySelectorAll("button")[period === "month" ? 0 : 1] as
      HTMLElement | undefined;
    if (b) setThumb({ x: b.offsetLeft, w: b.offsetWidth });
  }, [period, line?.id]);

  const canEntry = can(role, "entry.view");

  return (
    <AppShell>
      <div className="pf-cq mx-auto w-full max-w-[1440px]">
        <div className={cn("pf", day && "pf-day")} data-look={day ? "day" : "night"}>
          <div className="pf-aurora" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>

          {!line ? (
            <>
              <Link to="/plant" className="pf-back">
                <ArrowLeft size={15} aria-hidden="true" /> Plant floor
              </Link>
              <p className="pf-empty">This line isn't in the company in view.</p>
            </>
          ) : (
            <>
              <header className="pf-head">
                <div className="pf-title">
                  <Link to="/plant" className="pf-back">
                    <ArrowLeft size={15} aria-hidden="true" /> Plant floor
                  </Link>
                  <h1
                    className="pf-lr-name"
                    style={
                      {
                        "--lc": color,
                        viewTransitionName: `pfl-${line.id}`,
                      } as React.CSSProperties
                    }
                  >
                    <i aria-hidden="true" />
                    {line.name}
                  </h1>
                  <div className="pf-kicker" style={{ marginTop: 4 }}>
                    {company?.name ? `${company.name} · ` : ""}
                    {formatRange(range.from, lp.shownTo)}
                    {lp.n ? ` · ${lp.n.days} production day${lp.n.days === 1 ? "" : "s"}` : ""}
                  </div>
                </div>
                <div className="pf-chips">
                  <div className="pf-seg" ref={segRef} role="group" aria-label="Period">
                    <span
                      className="thumb"
                      style={{ width: thumb.w, transform: `translateX(${thumb.x - 3}px)` }}
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      aria-pressed={period === "month"}
                      onClick={() => navigate({ search: {}, replace: true })}
                    >
                      This month
                    </button>
                    <button
                      type="button"
                      aria-pressed={period === "7d"}
                      onClick={() => navigate({ search: { p: "7d" }, replace: true })}
                    >
                      Last 7 days
                    </button>
                  </div>
                  <Link to="/" search={{ line: line.id }} className="pf-chip">
                    <LayoutDashboard size={15} aria-hidden="true" /> Dashboard
                  </Link>
                  {canEntry && (
                    <Link to="/entry" className="pf-btn">
                      <Plus size={15} aria-hidden="true" /> New entry
                    </Link>
                  )}
                  <button
                    type="button"
                    className="pf-chip"
                    onClick={toggleDay}
                    aria-pressed={day}
                    aria-label={day ? "Switch the stage to night" : "Switch the stage to day"}
                  >
                    {day ? (
                      <Moon size={15} aria-hidden="true" />
                    ) : (
                      <Sun size={15} aria-hidden="true" />
                    )}
                    {day ? "Night" : "Day"}
                  </button>
                </div>
              </header>

              {lp.failed ? (
                <p className="pf-empty" role="alert">
                  Couldn't load {line.name}'s numbers. Refresh the page to try again.
                </p>
              ) : lp.loading || !lp.n || !tiles ? (
                <div className="pf-grid" role="status" aria-label={`Loading ${line.name}`}>
                  <div className="pf-grid pf-g4">
                    <div className="pf-skel" style={{ height: 190 }} />
                    <div className="pf-skel" style={{ height: 190 }} />
                    <div className="pf-skel" style={{ height: 190 }} />
                    <div className="pf-skel" style={{ height: 190 }} />
                  </div>
                  <div className="pf-skel" style={{ height: 280 }} />
                </div>
              ) : lp.list.length === 0 ? (
                <p className="pf-empty">
                  No entries for {line.name}, {formatRange(range.from, lp.shownTo)}. The line room
                  fills in once a daily entry is saved.
                </p>
              ) : (
                <>
                  {lp.machineError && (
                    <p className="pf-banner" role="note">
                      <span>
                        Maintenance couldn't be read: its stops are missing from time lost and the
                        OEE, not zero.
                      </span>
                    </p>
                  )}
                  <Tanks key={`${line.id}|${period}`} tiles={tiles} />
                  <div className="pf-grid pf-g2" key={`c|${line.id}|${period}`}>
                    <MakingChart points={points} color={color} target={lp.targets.makingPct} />
                    <OeeWaterfall oee={lp.oee} color={color} hasCapacity={lp.hasCapacity} />
                  </div>
                  <div className="pf-grid pf-g2" key={`r|${line.id}|${period}`}>
                    <ReadingCard text={reading?.text ?? ""} reasons={lp.n.reasons} />
                    {lp.machines.length > 0 ? (
                      <ShiftRings
                        lineId={line.id}
                        machines={lp.machines}
                        from={range.from}
                        to={range.to}
                        entries={lp.list}
                        stoppages={lp.stoppages}
                      />
                    ) : (
                      <StopsPerDay
                        stops={lp.stops}
                        from={range.from}
                        to={lp.shownTo}
                        entryDays={lp.n.entryDays}
                      />
                    )}
                  </div>
                  <p className="pf-note">
                    The same numbers as the Dashboard for {line.name},{" "}
                    {period === "month" ? "this month" : "the last 7 days"}: adherence = actual ÷
                    plan; time lost = the entries' downtime plus Maintenance stops on days with an
                    entry ÷ available minutes; rework ÷ making. Targets from Settings › Targets. OEE
                    = availability × performance × quality, from the line's making capacity.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
