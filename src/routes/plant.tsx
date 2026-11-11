import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Info, Maximize2, Minimize2, Moon, Sun } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { PlantLanes } from "@/components/plant/PlantLanes";
import { usePlantLook } from "@/components/plant/use-look";
import { DayScrubber, PlantFeed, PlantTiles } from "@/components/plant/PlantParts";
import { useNow } from "@/hooks/use-now";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { useAuth } from "@/lib/auth-context";
import { capacityFor, lineCapacitiesQuery } from "@/lib/capacity";
import { useCompany } from "@/lib/companies";
import { packingMachinesQuery } from "@/lib/packing";
import { withPackingOnlyDays } from "@/lib/packing-only-day";
import { can } from "@/lib/permissions";
import {
  addDaysIso,
  buildPlant,
  dayLabel,
  hhmm,
  productionDay,
  RECENT_DAYS,
  windowOf,
} from "@/lib/plant-floor";
import { latestReportedEventQuery, plantEventsQuery } from "@/lib/plant-floor-query";
import { allLinesEntriesQuery, linesQuery, nonProductionDaysQuery } from "@/lib/queries";
import { replayApprovalSettingQuery } from "@/lib/replay-approval";
import { requireSession } from "@/lib/require-session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/plant")({
  // ?day=YYYY-MM-DD: a production day. None: the latest day with a fault report.
  validateSearch: (search: Record<string, unknown>): { day?: string } => ({
    day:
      typeof search.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.day)
        ? search.day
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Plant floor · Production Scorecard" },
      { name: "description", content: "Every line as it stands now, and the day so far." },
    ],
  }),
  beforeLoad: requireSession,
  loader: ({ context }) => context.queryClient.ensureQueryData(linesQuery),
  component: () => (
    <RequireAuth requirePermission="dashboard.view">
      <PlantPage />
    </RequireAuth>
  ),
});

/** How long "Replay the day" takes, whatever the hour. */
const REPLAY_MS = 9000;

function PlantPage() {
  const { role } = useAuth();
  const { current: company } = useCompany();
  const reduced = usePrefersReducedMotion();
  const canFaults = can(role, "dashboard.viewMaintenanceCard");
  const { data: allLines } = useSuspenseQuery(linesQuery);
  const lines = useMemo(() => allLines.filter((l) => l.is_active), [allLines]);

  const now = useNow(1000);
  const today = productionDay(now).day;
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/plant" });
  // Faults are imported the day after, so the page opens on the latest day
  // whose report is in; today stays one tap away.
  const latestQ = useQuery(latestReportedEventQuery());
  const latestDay = latestQ.data ? productionDay(new Date(latestQ.data).getTime()).day : null;
  const wanted = search.day && search.day <= today ? search.day : null;
  const shownDay = wanted ?? (latestQ.isPending ? null : (latestDay ?? today));
  const dayKey = shownDay ?? today;
  const win = useMemo(() => windowOf(dayKey), [dayKey]);
  const goDay = (d: string) => navigate({ search: { day: d }, replace: true });

  const eventsQ = useQuery(plantEventsQuery(win.startMs, win.endMs));
  const entriesQ = useQuery({
    ...allLinesEntriesQuery(addDaysIso(win.day, -RECENT_DAYS), win.day),
    refetchInterval: 5 * 60_000,
  });
  const capsQ = useQuery(lineCapacitiesQuery);
  const closedQ = useQuery(nonProductionDaysQuery());
  const machinesQ = useQuery(packingMachinesQuery);
  const approvalQ = useQuery(replayApprovalSettingQuery());
  // Settings › Replay approval: looking back at a day is a replay, so it is
  // asked for on Replay a day, not opened here.
  const locked = approvalQ.isPending || (approvalQ.data === true && role !== "admin");

  const entries = useMemo(() => withPackingOnlyDays(entriesQ.data) ?? [], [entriesQ.data]);
  const rates = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const l of lines) {
      const c = capacityFor(capsQ.data ?? [], l.id, win.day);
      m.set(l.id, c && c.making_kg > 0 ? c.making_kg / (c.basis === "day" ? 1440 : 480) : null);
    }
    return m;
  }, [lines, capsQ.data, win.day]);
  const machineNames = useMemo(
    () => new Map((machinesQ.data ?? []).map((m) => [m.id, m.name])),
    [machinesQ.data],
  );

  const ready = !!shownDay && !!eventsQ.data && !!entriesQ.data && !!capsQ.data && !!closedQ.data;
  const failed = eventsQ.isError || entriesQ.isError || capsQ.isError || closedQ.isError;

  const model = useMemo(
    () =>
      buildPlant({
        nowMs: now,
        day: win.day,
        lines,
        events: eventsQ.data ?? [],
        entries,
        closures: closedQ.data ?? [],
        rates,
        machineNames,
      }),
    [now, win.day, lines, eventsQ.data, entries, closedQ.data, rates, machineNames],
  );

  // null = live. A number = the moment being looked at.
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const t = at ?? model.cap;
  const snap = useMemo(() => model.at(t), [model, t]);
  const live = at == null;
  // A finished day, not being scrubbed: show it whole.
  const summary = live && !model.isToday;

  const stop = () => {
    cancelAnimationFrame(raf.current);
    setPlaying(false);
  };
  const goLive = () => {
    stop();
    setAt(null);
  };
  const play = () => {
    if (playing) return stop();
    if (reduced) return; // no moving replay; the strip can still be dragged
    const from = win.startMs;
    const to = model.cap;
    const t0 = performance.now();
    setPlaying(true);
    const step = (n: number) => {
      const k = Math.min(1, (n - t0) / REPLAY_MS);
      if (k >= 1) {
        setPlaying(false);
        setAt(null);
        return;
      }
      setAt(from + (to - from) * k);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  // A new production day starts at 08:00: whatever was being looked at is gone.
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    setPlaying(false);
    setAt(null);
  }, [win.startMs]);

  // The stage's own look: night by default, remembered on this device.
  const [day, toggleDay] = usePlantLook();

  const stage = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === stage.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen?.().catch(() => {});
  };
  const canFull = typeof document !== "undefined" && !!document.documentElement.requestFullscreen;

  const status = model.isToday
    ? live
      ? "LIVE"
      : `REPLAY ${hhmm(t)}`
    : live
      ? "WHOLE DAY"
      : `REPLAY ${hhmm(t)}`;
  const prevDay = addDaysIso(win.day, -1);
  const nextDay = addDaysIso(win.day, 1);

  return (
    <AppShell>
      <div className="pf-cq mx-auto w-full max-w-[1440px]">
        <div ref={stage} className={cn("pf", day && "pf-day")} data-look={day ? "day" : "night"}>
          <div className="pf-aurora" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>

          <header className="pf-head">
            <div className="pf-title">
              <div className="pf-kicker">{company?.name ?? "Delta Sweets"} · control room</div>
              <h1>Plant floor</h1>
            </div>
            <div className="pf-chips">
              <span
                className={cn("pf-chip pf-num", model.isToday && live ? "live" : "rep")}
                role="status"
              >
                <span className="pf-dot" aria-hidden="true" />
                {status}
              </span>
              <span className="pf-daynav" role="group" aria-label="Production day">
                <button
                  type="button"
                  className="pf-chip"
                  onClick={() => goDay(prevDay)}
                  aria-label={`Previous day, ${dayLabel(windowOf(prevDay).startMs)}`}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <span className="pf-chip pf-num pf-daychip">
                  {model.isToday ? "Today" : dayLabel(win.startMs)}
                  {summary ? "" : ` · ${hhmm(t)}`}
                </span>
                <button
                  type="button"
                  className="pf-chip"
                  onClick={() => goDay(nextDay)}
                  disabled={win.day >= today}
                  aria-label={`Next day, ${dayLabel(windowOf(nextDay).startMs)}`}
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </span>
              {!model.isToday && (
                <button type="button" className="pf-chip" onClick={() => goDay(today)}>
                  Today
                </button>
              )}
              {latestDay && latestDay !== win.day && (
                <button type="button" className="pf-chip" onClick={() => goDay(latestDay)}>
                  Latest report
                </button>
              )}
              <button
                type="button"
                className="pf-chip"
                onClick={toggleDay}
                aria-pressed={day}
                aria-label={day ? "Switch the stage to night" : "Switch the stage to day"}
              >
                {day ? <Moon size={15} aria-hidden="true" /> : <Sun size={15} aria-hidden="true" />}
                {day ? "Night" : "Day"}
              </button>
              {canFull && (
                <button
                  type="button"
                  className="pf-chip pf-fs"
                  onClick={toggleFull}
                  aria-pressed={full}
                  aria-label={full ? "Leave full screen" : "Full screen"}
                >
                  {full ? (
                    <Minimize2 size={15} aria-hidden="true" />
                  ) : (
                    <Maximize2 size={15} aria-hidden="true" />
                  )}
                </button>
              )}
            </div>
          </header>

          {failed ? (
            <p className="pf-empty" role="alert">
              Couldn't load the plant floor. Refresh the page to try again.
            </p>
          ) : !ready ? (
            <div className="pf-grid" role="status" aria-label="Loading the plant floor">
              <div className="pf-skel" style={{ height: 150 }} />
              <div className="pf-skel" />
              <div className="pf-skel" />
              <div className="pf-skel" />
            </div>
          ) : lines.length === 0 ? (
            <p className="pf-empty">No active lines yet. Add them in Settings › Lines.</p>
          ) : (
            <>
              {!model.reported && (
                <p className="pf-banner" role="note">
                  <Info size={16} aria-hidden="true" />
                  <span>
                    <b>
                      No fault has been logged for {model.isToday ? "today" : dayLabel(win.startMs)}{" "}
                      yet.
                    </b>{" "}
                    Fault reports are usually imported the next day, so until then every scheduled
                    line shows Running and no time lost.
                    {latestDay && latestDay !== win.day && (
                      <>
                        {" "}
                        <button type="button" onClick={() => goDay(latestDay)}>
                          Open {dayLabel(windowOf(latestDay).startMs)}, the latest report
                        </button>
                      </>
                    )}
                  </span>
                </p>
              )}
              <PlantTiles model={model} snap={snap} fast={!live} summary={summary} />
              <div className="pf-grid pf-g2">
                <section className="pf-card" style={{ "--i": 4 } as React.CSSProperties}>
                  <h2>
                    Plant floor
                    <small>
                      tap a line to open its room
                      {locked ? "" : " · drag the timeline to look back"}
                    </small>
                  </h2>
                  <PlantLanes
                    model={model}
                    snap={snap}
                    day={day}
                    canFaults={canFaults}
                    fast={!live}
                    summary={summary}
                  />
                  <DayScrubber
                    model={model}
                    t={t}
                    day={day}
                    playing={playing}
                    locked={locked}
                    onSeek={(x) => {
                      stop();
                      setAt(x);
                    }}
                    onPlay={play}
                    onLive={goLive}
                  />
                </section>
                <PlantFeed feed={model.feed} t={snap.t} live={live} canFaults={canFaults} />
              </div>
              <p className="pf-note">
                A line shows Running until a stop is logged in Maintenance, and faults are usually
                imported the next day, so the page opens on the latest day whose fault report is in.
                Today turns live once faults are logged as they happen. The hours a line is
                scheduled come from its entries (the day's own for a finished day, the last{" "}
                {RECENT_DAYS} days for today), less the recorded non-production days; Friday is a
                day off unless the line has an entry or an event that day. On a finished day the
                kilograms are the entry's making, spread over the minutes the line ran. Today, and
                on a day without an entry, they are an estimate: the line's capacity per minute ×
                the minutes it was scheduled and not stopped.
              </p>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
