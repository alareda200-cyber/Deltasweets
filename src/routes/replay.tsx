import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReplayScene, type SceneState } from "@/components/replay/ReplayScene";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { iso } from "@/lib/date-utils";
import { requireSession } from "@/lib/require-session";
import {
  entriesQuery,
  entryDowntimesForEntriesQuery,
  linesQuery,
  maintenanceEventsQuery,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

interface ReplaySearch {
  line?: string;
  date?: string;
}

export const Route = createFileRoute("/replay")({
  head: () => ({ meta: [{ title: "Replay a day · Production Scorecard" }] }),
  validateSearch: (search: Record<string, unknown>): ReplaySearch => ({
    line: typeof search.line === "string" && search.line ? search.line : undefined,
    date:
      typeof search.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.date)
        ? search.date
        : undefined,
  }),
  beforeLoad: requireSession,
  loader: ({ context }) => context.queryClient.ensureQueryData(linesQuery),
  component: () => (
    <RequireAuth requirePermission="dashboard.view">
      <ReplayPage />
    </RequireAuth>
  ),
});

const DAY = 1440;
/** Replay speed: day-minutes per wall-clock second. 1× ≈ the day in 48 s. */
const SPEEDS = [
  { label: "1×", v: 30 },
  { label: "2×", v: 60 },
  { label: "4×", v: 120 },
] as const;

interface Fault {
  s: number;
  e: number;
  title: string;
  stops: boolean;
}
interface StopWindow {
  s: number;
  e: number;
  titles: string[];
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return iso(d);
}
const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
const clock = (m: number) => `${pad(Math.min(DAY, m) / 60)}:${pad(Math.min(DAY, m) % 60)}`;
const kgFmt = (n: number) => Math.round(n).toLocaleString("en-US");

function ReplayPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/replay" });
  const { role } = useAuth();
  const reduced = usePrefersReducedMotion();
  const isMobile = useIsMobile();
  const { data: allLines } = useSuspenseQuery(linesQuery);
  const lines = allLines.filter((l) => l.is_active);
  const line = lines.find((l) => l.id === search.line) ?? lines[0];
  const date = search.date ?? shiftDate(iso(new Date()), -1);
  const canFaults = can(role, "dashboard.viewMaintenanceCard");

  const eventsQ = useQuery({
    ...maintenanceEventsQuery(line?.id ?? null, null, null, date, date),
    enabled: !!line && canFaults,
  });
  const entriesQ = useQuery(entriesQuery(line?.id ?? null, date, date));
  const entryIds = (entriesQ.data ?? []).map((e) => e.id);
  const downtimesQ = useQuery(entryDowntimesForEntriesQuery(entryIds));

  // Everything the replay shows is a function of t (minutes into the day).
  const model = useMemo(() => {
    const dayStart = new Date(`${date}T00:00:00`).getTime();
    const now = Date.now();
    const toMin = (ms: number) => Math.max(0, Math.min(DAY, (ms - dayStart) / 60_000));
    const faults: Fault[] = (eventsQ.data ?? [])
      .filter((e) => e.type !== "preventive")
      .map((e) => ({
        s: toMin(new Date(e.started_at).getTime()),
        e: toMin(e.resolved_at ? new Date(e.resolved_at).getTime() : now),
        title: e.title.trim(),
        stops: e.stops_line,
      }))
      .filter((f) => f.s < DAY)
      .sort((a, b) => a.s - b.s);
    // A stoppage is one time window: overlapping line-stopping faults are
    // merged, never added up.
    const windows: StopWindow[] = [];
    for (const f of faults.filter((x) => x.stops && x.e > x.s)) {
      const last = windows[windows.length - 1];
      if (last && f.s <= last.e) {
        last.e = Math.max(last.e, f.e);
        last.titles.push(f.title);
      } else windows.push({ s: f.s, e: f.e, titles: [f.title] });
    }
    const stopMin = windows.reduce((a, w) => a + (w.e - w.s), 0);
    const entries = entriesQ.data ?? [];
    const actual = entries.reduce((a, e) => a + (e.making_actual ?? 0), 0);
    const plan = entries.reduce((a, e) => a + (e.making_plan ?? 0), 0);
    const rate = actual > 0 ? actual / Math.max(1, DAY - stopMin) : 0;
    const stoppedBefore = (t: number) =>
      windows.reduce((a, w) => a + Math.max(0, Math.min(t, w.e) - w.s), 0);
    const windowAt = (t: number) => windows.find((w) => t >= w.s && t < w.e) ?? null;
    const byTitle = new Map<string, number>();
    for (const f of faults) byTitle.set(f.title, (byTitle.get(f.title) ?? 0) + 1);
    const topTitle = [...byTitle.entries()].sort((a, b) => b[1] - a[1])[0];
    const longest = windows.reduce<StopWindow | null>(
      (m, w) => (!m || w.e - w.s > m.e - m.s ? w : m),
      null,
    );
    return {
      faults,
      windows,
      stopMin,
      actual,
      plan,
      rate,
      hasEntry: entries.length > 0,
      kgAt: (t: number) => rate * (t - stoppedBefore(t)),
      stoppedBefore,
      windowAt,
      topTitle,
      longest,
    };
  }, [date, eventsQ.data, entriesQ.data]);

  // The animation loop reads the latest model through a ref, so data that
  // lands mid-replay is used at once instead of a stale closure.
  const modelRef = useRef(model);
  modelRef.current = model;

  // --- the clock -----------------------------------------------------------
  const sim = useRef({
    t: 0,
    playing: false,
    speed: 30,
    real: 0,
    belt: 0,
    spawn: 0,
    gummies: [] as SceneState["gummies"],
  });
  const raf = useRef<number | null>(null);
  const [, setFrame] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const ready = !entriesQ.isPending && (!canFaults || !eventsQ.isPending);

  const loop = () => {
    if (raf.current != null) return;
    let last: number | null = null;
    const step = (now: number) => {
      if (last == null) last = now;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = sim.current;
      const model = modelRef.current;
      s.real += dt;
      const w = model.windowAt(s.t);
      if (s.playing) {
        // While the line is stopped the replay slows down, so a one-minute
        // stop is seen (≥ 0.5 s) and a long one doesn't drag (≤ 2.6 s).
        const len = w ? w.e - w.s : 0;
        const rate = w ? len / Math.max(0.55, Math.min(2.6, len * 0.22)) : s.speed;
        s.t = Math.min(DAY, s.t + rate * dt);
        if (s.t >= DAY) s.playing = false;
      }
      const running = s.playing && !model.windowAt(s.t);
      if (running) {
        s.belt += 150 * dt;
        s.spawn -= dt;
        if (s.spawn <= 0 && model.rate > 0) {
          s.spawn = 0.32;
          s.gummies.push({
            x: 300 + Math.random() * 60,
            y: 196,
            r: (Math.random() - 0.5) * 40,
            c: Math.floor(Math.random() * 7),
          });
        }
      }
      s.gummies = s.gummies
        .map((g) => {
          if (g.y < 214 && g.x < 420) return { ...g, y: Math.min(214, g.y + 180 * dt) };
          if (g.x < 1162) return running ? { ...g, x: g.x + 150 * dt } : g;
          return { ...g, x: g.x + 40 * dt, y: g.y + 260 * dt, r: g.r + 200 * dt };
        })
        .filter((g) => g.y < 300)
        .slice(-80);
      setFrame((f) => f + 1);
      raf.current =
        s.playing || s.gummies.some((g) => g.x >= 1162) ? requestAnimationFrame(step) : null;
    };
    raf.current = requestAnimationFrame(step);
  };

  const play = () => {
    const s = sim.current;
    if (s.t >= DAY) s.t = 0;
    if (reduced) {
      s.t = DAY;
      setFrame((f) => f + 1);
      return;
    }
    s.playing = true;
    loop();
  };
  const pause = () => {
    sim.current.playing = false;
    setFrame((f) => f + 1);
  };
  const seek = (t: number) => {
    sim.current.t = Math.max(0, Math.min(DAY, t));
    setFrame((f) => f + 1);
  };

  // New day or line: start over, and play by itself once the data is in.
  useEffect(() => {
    const s = sim.current;
    s.t = 0;
    s.playing = false;
    s.gummies = [];
    setFrame((f) => f + 1);
    if (!ready) return;
    const id = setTimeout(play, 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, line?.id, date, reduced]);
  useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  const s = sim.current;
  const t = s.t;
  const w = model.windowAt(t);
  const kg = model.kgAt(t);
  const passed = model.faults.filter((f) => f.s <= t);
  const stoppedSoFar = model.stoppedBefore(t);
  const done = t >= DAY && !s.playing;
  const scene: SceneState = {
    running: s.playing && !w,
    faultTitle: w ? w.titles[0] + (w.titles.length > 1 ? ` +${w.titles.length - 1}` : "") : null,
    faultMinutes: w ? Math.max(1, Math.round(w.e - w.s)) : 0,
    real: s.real,
    belt: s.belt,
    gummies: s.gummies,
    crate: model.actual > 0 ? kg / model.actual : 0,
    clock: clock(t),
  };

  // Timeline geometry (viewBox units). Phones get a narrower box so the
  // labels stay readable when it is scaled down to the screen.
  const VBW = isMobile ? 520 : 1358;
  const FS = isMobile ? 22 : 13;
  const X0 = isMobile ? 16 : 60;
  const X1 = VBW - (isMobile ? 16 : 28);
  const xOf = (m: number) => X0 + (m / DAY) * (X1 - X0);
  const yMax = Math.max(model.plan, model.actual, 1);
  const yOf = (k: number) => 120 - (k / yMax) * 96;
  let line_ = "";
  for (let m = 0; m <= t; m += 5)
    line_ += `${m ? " L" : "M"}${xOf(m).toFixed(1)} ${yOf(model.kgAt(m)).toFixed(1)}`;
  line_ += ` L${xOf(t).toFixed(1)} ${yOf(kg).toFixed(1)}`;
  const area = `${line_} L${xOf(t).toFixed(1)} 120 L${X0} 120 Z`;

  const go = (next: Partial<ReplaySearch>) =>
    navigate({ search: { line: line?.id, date, ...next }, replace: true });
  const entryDowntimes = downtimesQ.data ?? [];
  const pctOfPlan = model.plan > 0 ? (kg / model.plan) * 100 : null;

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-3 px-4 py-4 md:gap-4 md:px-6 md:py-6">
        <div className="ds-rise flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold md:text-3xl">Replay a day</h1>
            <p className="text-sm text-muted-foreground">
              {line?.name} ·{" "}
              {new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              })}{" "}
              · the day in about 48 seconds. The line stops for every machine fault that stopped it.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="replay-line" className="text-xs">
                Line
              </Label>
              <select
                id="replay-line"
                value={line?.id}
                onChange={(e) => go({ line: e.target.value })}
                className="h-11 rounded-md border border-input bg-background px-3 text-sm md:h-9"
              >
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-1">
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous day"
                className="h-11 w-11 md:h-9 md:w-9"
                onClick={() => go({ date: shiftDate(date, -1) })}
              >
                <ChevronLeft />
              </Button>
              <div className="flex flex-col gap-1">
                <Label htmlFor="replay-date" className="text-xs">
                  Day
                </Label>
                <Input
                  id="replay-date"
                  type="date"
                  value={date}
                  onChange={(e) => e.target.value && go({ date: e.target.value })}
                  className="h-11 w-40 md:h-9"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next day"
                className="h-11 w-11 md:h-9 md:w-9"
                onClick={() => go({ date: shiftDate(date, 1) })}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </div>

        <div
          className="ds-rise flex flex-wrap items-center gap-2"
          style={{ animationDelay: "60ms" }}
        >
          <Button
            onClick={s.playing ? pause : play}
            disabled={!ready}
            className="h-11 min-w-28 md:h-9"
          >
            {s.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {s.playing ? "Pause" : done ? "Replay" : "Play"}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              seek(0);
              play();
            }}
            disabled={!ready}
            className="h-11 md:h-9"
          >
            <RotateCcw aria-hidden="true" />
            Restart
          </Button>
          <div role="group" aria-label="Speed" className="flex rounded-lg bg-muted p-0.5">
            {SPEEDS.map((sp, i) => (
              <button
                key={sp.label}
                type="button"
                aria-pressed={speedIdx === i}
                onClick={() => {
                  setSpeedIdx(i);
                  sim.current.speed = sp.v;
                }}
                className={cn(
                  "ds-squish h-11 min-w-12 rounded-md px-3 text-sm font-semibold md:h-8",
                  speedIdx === i ? "bg-card shadow-sm" : "text-muted-foreground",
                )}
              >
                {sp.label}
              </button>
            ))}
          </div>
        </div>

        <dl
          className="ds-rise grid grid-cols-2 gap-2 md:grid-cols-5 md:gap-3"
          style={{ animationDelay: "120ms" }}
        >
          {[
            {
              k: "Clock",
              v: clock(t),
              sub: w ? "line stopped" : s.playing ? "running" : "paused",
              tone: w ? "text-destructive-strong" : "",
            },
            {
              k: "Made so far",
              v: model.hasEntry ? `${kgFmt(kg)} kg` : "—",
              sub: model.hasEntry ? `of ${kgFmt(model.actual)} kg that day` : "no entry that day",
              tone: "",
            },
            {
              k: "Of plan",
              v: pctOfPlan == null ? "—" : `${pctOfPlan.toFixed(1)}%`,
              sub: model.plan > 0 ? `plan ${kgFmt(model.plan)} kg` : "no plan",
              tone: "",
            },
            {
              k: "Faults",
              v: canFaults ? String(passed.length) : "—",
              sub: canFaults ? `of ${model.faults.length} that day` : "not in your role",
              tone: passed.length ? "text-destructive-strong" : "",
            },
            {
              k: "Stopped",
              v: canFaults ? `${Math.round(stoppedSoFar)} min` : "—",
              sub: "by machine faults",
              tone: "",
            },
          ].map((x) => (
            <div key={x.k} className="rounded-xl border border-border bg-card px-3 py-2.5 md:px-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {x.k}
              </dt>
              <dd
                className={cn(
                  "mt-1 text-2xl font-extrabold tabular-nums leading-none md:text-3xl",
                  x.tone,
                )}
              >
                {x.v}
              </dd>
              <dd className="mt-1 text-xs text-muted-foreground">{x.sub}</dd>
            </div>
          ))}
        </dl>

        <section
          aria-label="The line"
          className="ds-rise overflow-hidden rounded-2xl border border-border bg-card"
          style={{ animationDelay: "180ms" }}
        >
          <p className="sr-only" aria-live="polite">
            {w ? `${clock(t)}: line stopped by ${scene.faultTitle}` : ""}
          </p>
          <ReplayScene s={scene} lineName={line?.name ?? ""} compact={isMobile} />
        </section>

        <section
          aria-labelledby="replay-timeline"
          className="ds-rise rounded-2xl border border-border bg-card py-3"
          style={{ animationDelay: "240ms" }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 md:px-5">
            <h2 id="replay-timeline" className="text-sm font-semibold md:text-base">
              Kilograms through the day
            </h2>
            <span className="text-xs text-muted-foreground">
              red = faults that stopped the line · amber = faults with the line running · the curve
              is modelled from the day total
            </span>
          </div>
          <svg
            viewBox={`0 0 ${VBW} ${isMobile ? 200 : 170}`}
            className="block h-auto w-full cursor-pointer"
            aria-hidden="true"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const vx = ((e.clientX - r.left) / r.width) * VBW;
              seek(((vx - X0) / (X1 - X0)) * DAY);
            }}
          >
            {model.plan > 0 && (
              <>
                <line
                  x1={X0}
                  y1={yOf(model.plan)}
                  x2={X1}
                  y2={yOf(model.plan)}
                  strokeDasharray="6 4"
                  opacity="0.5"
                  style={{ stroke: "var(--foreground)" }}
                />
                <text
                  x={X1}
                  y={yOf(model.plan) - 6}
                  textAnchor="end"
                  fontSize={FS}
                  fontWeight="600"
                  style={{ fill: "var(--foreground)" }}
                >
                  Plan {kgFmt(model.plan)} kg
                </text>
              </>
            )}
            <line x1={X0} y1="120" x2={X1} y2="120" style={{ stroke: "var(--border)" }} />
            {model.hasEntry && (
              <>
                <path d={area} opacity="0.14" style={{ fill: "var(--primary)" }} />
                <path
                  d={line_}
                  fill="none"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  style={{ stroke: "var(--primary)" }}
                />
              </>
            )}
            {model.faults.map((f, i) => (
              <rect
                key={i}
                x={xOf(f.s)}
                y="128"
                width={Math.max(2.5, xOf(f.e) - xOf(f.s))}
                height="14"
                rx="1.5"
                opacity={f.s <= t ? 1 : 0.3}
                style={{ fill: f.stops ? "var(--destructive)" : "var(--warning)" }}
              />
            ))}
            {(isMobile ? [0, 6, 12, 18, 24] : [0, 3, 6, 9, 12, 15, 18, 21, 24]).map((h) => (
              <text
                key={h}
                x={xOf(h * 60)}
                y={isMobile ? 190 : 162}
                textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"}
                fontSize={FS}
                style={{ fill: "var(--muted-foreground)" }}
              >
                {pad(h)}:00
              </text>
            ))}
            <line
              x1={xOf(t)}
              y1="10"
              x2={xOf(t)}
              y2="146"
              strokeWidth="2"
              style={{ stroke: "var(--foreground)" }}
            />
            <circle
              cx={xOf(t)}
              cy={yOf(kg)}
              r="6"
              strokeWidth="2"
              style={{ fill: "var(--primary)", stroke: "var(--card)" }}
            />
          </svg>
          <div className="px-4 md:px-5">
            <input
              type="range"
              min={0}
              max={DAY}
              step={1}
              value={Math.round(t)}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Time of day"
              aria-valuetext={clock(t)}
              className="h-11 w-full cursor-pointer accent-primary md:h-6"
            />
          </div>
          {entryDowntimes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-4 pt-1 text-xs md:px-5 md:text-sm">
              <span className="font-semibold">Also recorded that day, no clock time:</span>
              {entryDowntimes.map((d) => (
                <span key={d.id} className="rounded-full bg-muted px-2.5 py-1">
                  {d.reason_name} · {d.minutes} min
                </span>
              ))}
            </div>
          )}
        </section>

        {ready && !model.hasEntry && model.faults.length === 0 && (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nothing recorded for {line?.name} on this day — no entry and no machine faults.
          </p>
        )}

        {done && (model.hasEntry || model.faults.length > 0) && (
          <section
            aria-labelledby="replay-summary"
            className="ds-slide-in rounded-2xl border border-border bg-card p-4 shadow-elevated md:p-6"
          >
            <h2 id="replay-summary" className="text-lg font-bold md:text-xl">
              That was the day
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3 md:gap-3">
              <div className="rounded-xl bg-muted p-3">
                <div className="text-2xl font-extrabold tabular-nums">
                  {model.hasEntry ? kgFmt(model.actual) : "—"}
                </div>
                <div className="text-xs text-muted-foreground">
                  kg made
                  {model.plan > 0
                    ? ` · ${((model.actual / model.plan) * 100).toFixed(1)}% of plan`
                    : ""}
                </div>
              </div>
              <div className="rounded-xl bg-destructive/10 p-3">
                <div className="text-2xl font-extrabold tabular-nums text-destructive-strong">
                  {model.faults.length}
                </div>
                <div className="text-xs text-muted-foreground">
                  faults · {Math.round(model.stopMin)} min stopped
                </div>
              </div>
              <div className="rounded-xl bg-muted p-3">
                <div className="text-2xl font-extrabold tabular-nums">
                  {model.topTitle ? `${model.topTitle[1]}×` : "—"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {model.topTitle ? model.topTitle[0] : "no faults"} · most frequent
                </div>
              </div>
            </div>
            {model.longest && (
              <p className="mt-3 text-sm">
                Longest stop: <b>{model.longest.titles[0]}</b>,{" "}
                {Math.round(model.longest.e - model.longest.s)} min at {clock(model.longest.s)}.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {model.hasEntry && (
                <Link
                  to="/entry"
                  search={{ line: line?.id, date, shift: entriesQ.data?.[0]?.shift }}
                  className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted md:min-h-9"
                >
                  Open the entry
                </Link>
              )}
              {canFaults && (
                <Link
                  to="/maintenance"
                  className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted md:min-h-9"
                >
                  Maintenance
                </Link>
              )}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
