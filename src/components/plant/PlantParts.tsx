import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { Pause, Play } from "lucide-react";
import { Odometer } from "@/components/motion";
import {
  dayLabel,
  hhmm,
  minutesText,
  type FeedItem,
  type FeedKind,
  type PlantModel,
  type PlantSnapshot,
} from "@/lib/plant-floor";
import { laneColor } from "@/components/plant/lane-color";

const kg = (n: number) => Math.round(n).toLocaleString("en-US");
const names = (list: string[]) =>
  list.length <= 2 ? list.join(" and ") : `${list.slice(0, 2).join(", ")} +${list.length - 2}`;

/** The four numbers above the floor. All of them follow the clock. */
export function PlantTiles({
  model,
  snap,
  fast,
  summary,
}: {
  model: PlantModel;
  snap: PlantSnapshot;
  fast: boolean;
  /** A finished day seen whole. */
  summary: boolean;
}) {
  const dur = fast ? 250 : 900;
  const a = snap.availability == null ? null : snap.availability * 100;
  const entered = model.lines.reduce((s, l) => s + (l.entry?.made ?? 0), 0);
  const enteredLines = model.lines.filter((l) => l.entry).length;
  const dayWord = model.isToday ? "today" : dayLabel(model.win.startMs);
  const allMade = snap.madeLines > 0 && snap.estLines === 0;
  const kgNote = allMade
    ? "from the day's entries"
    : snap.madeLines > 0
      ? "entries + estimate"
      : "estimate";
  const stops = model.lines.reduce(
    (n, l) => n + l.windows.filter((w) => !w.planned && w.s <= snap.t).length,
    0,
  );
  const since = hhmm(model.win.startMs);
  return (
    <div className="pf-grid pf-g4">
      <section className="pf-card pf-orbcard" style={{ "--i": 0 } as React.CSSProperties}>
        <h2>
          Availability {model.isToday ? "today" : ""}{" "}
          <small>
            all lines · {model.isToday ? `since ${since}` : `${dayWord}, ${since} to ${since}`}
          </small>
        </h2>
        <div className="pf-orb">
          <div className="pf-orb-mid">
            <svg viewBox="0 0 120 120" width="104" height="104" aria-hidden="true">
              <circle className="bg" cx="60" cy="60" r="50" strokeWidth="10" pathLength={100} />
              <circle
                className="fg"
                cx="60"
                cy="60"
                r="50"
                strokeWidth="10"
                pathLength={100}
                style={{ "--p": a ?? 0 } as React.CSSProperties}
              />
            </svg>
            <div className="pf-num">
              <Odometer value={a} decimals={1} suffix="%" duration={dur} />
            </div>
          </div>
          <div className="pf-rows pf-num">
            <span>
              <i style={{ "--k": "var(--pf-pri)" } as React.CSSProperties}>Scheduled</i>
              <b>{minutesText(snap.schedMin)}</b>
            </span>
            <span>
              <i style={{ "--k": "var(--pf-bad)" } as React.CSSProperties}>Faults</i>
              <b>{minutesText(snap.lostMin)}</b>
            </span>
            <span>
              <i style={{ "--k": "var(--pf-cyan)" } as React.CSSProperties}>Preventive</i>
              <b>{minutesText(snap.plannedMin)}</b>
            </span>
          </div>
        </div>
      </section>

      <section className="pf-card pf-widecard" style={{ "--i": 1 } as React.CSSProperties}>
        <h2>
          {model.isToday ? "Made so far" : "Made by then"} <small>{kgNote}</small>
        </h2>
        <div className="pf-big pf-num">
          <Odometer
            value={Math.round(snap.kg / 10) * 10}
            decimals={0}
            grouping
            duration={dur}
            label={`${kg(snap.kg)} kg${allMade ? "" : ", partly estimated"}`}
          />
          <small>kg</small>
        </div>
        <div className="pf-sub">
          {allMade
            ? "each line's making, spread over the minutes it ran"
            : snap.madeLines > 0
              ? `${snap.madeLines} line${snap.madeLines === 1 ? "" : "s"} from the entry, ${snap.estLines} at capacity × running time`
              : "line rate × running time, not a count"}
          {snap.noRate > 0
            ? ` · ${snap.noRate} line${snap.noRate === 1 ? " has" : "s have"} no capacity set`
            : ""}
        </div>
        <div className="pf-sub" style={{ marginTop: 4 }}>
          {enteredLines > 0 ? (
            <>
              entered for {model.isToday ? "today" : "the day"}:{" "}
              <b className="pf-num">{kg(entered)} kg</b> ({enteredLines} line
              {enteredLines === 1 ? "" : "s"})
            </>
          ) : model.isToday ? (
            "no entry saved for today yet"
          ) : (
            "no entry saved for this day"
          )}
        </div>
      </section>

      <section className="pf-card" style={{ "--i": 2 } as React.CSSProperties}>
        {summary ? (
          (() => {
            const ran = snap.lines.filter((l) => l.schedMin > 0);
            const worst = model.lines
              .map((l, i) => ({ name: l.name, lost: snap.lines[i].lostMin }))
              .filter((x) => x.lost > 0)
              .sort((x, y) => y.lost - x.lost)[0];
            return (
              <>
                <h2>Lines that ran</h2>
                <div className="pf-big pf-num">
                  <Odometer value={ran.length} decimals={0} duration={dur} />
                  <small>of {model.lines.length}</small>
                </div>
                <div className="pf-sub">
                  {worst ? (
                    <>
                      most time lost: <b>{worst.name}</b>, {minutesText(worst.lost)}
                    </>
                  ) : (
                    "no line lost time to a fault"
                  )}
                </div>
              </>
            );
          })()
        ) : (
          <>
            <h2>Lines running</h2>
            <div className="pf-big pf-num">
              <Odometer value={snap.running} decimals={0} duration={dur} />
              <small>of {snap.scheduled} scheduled</small>
            </div>
            <div
              className="pf-sub"
              style={snap.stopped.length ? { color: "var(--pf-bad)", fontWeight: 600 } : undefined}
            >
              {snap.stopped.length
                ? `${names(snap.stopped)} stopped`
                : snap.preventive.length
                  ? `${names(snap.preventive)} on preventive work`
                  : snap.scheduled === 0
                    ? `no line is scheduled ${model.isToday ? "right now" : `at ${hhmm(snap.t)}`}`
                    : "no line is stopped"}
            </div>
            {snap.off > 0 && (
              <div className="pf-sub" style={{ marginTop: 4 }}>
                {snap.off} line{snap.off === 1 ? "" : "s"} off{" "}
                {model.isToday ? "right now" : `at ${hhmm(snap.t)}`}
              </div>
            )}
          </>
        )}
      </section>

      <section className="pf-card" style={{ "--i": 3 } as React.CSSProperties}>
        <h2>
          Time lost {model.isToday ? "today" : ""} <small>faults only</small>
        </h2>
        <div className="pf-big pf-num">
          <Odometer value={Math.round(snap.lostMin)} decimals={0} grouping duration={dur} />
          <small>min</small>
        </div>
        <div className="pf-sub">
          {stops} stop{stops === 1 ? "" : "s"}
          {model.isToday ? " · open stops count up to now" : " · stops share one window"}
        </div>
        <div className="pf-sub" style={{ marginTop: 4 }}>
          preventive work is not a fault
        </div>
      </section>
    </div>
  );
}

/**
 * The production day so far as one strip: a row per line, its scheduled hours,
 * its stops. Drag it to look back; Replay plays the day from 08:00 to now.
 */
export function DayScrubber({
  model,
  t,
  day,
  playing,
  locked,
  onSeek,
  onPlay,
  onLive,
}: {
  model: PlantModel;
  t: number;
  day: boolean;
  playing: boolean;
  /** Replay needs an admin's approval for this user (Settings › Replay approval). */
  locked: boolean;
  onSeek: (t: number) => void;
  onPlay: () => void;
  onLive: () => void;
}) {
  const start = model.win.startMs;
  const end = model.cap;
  const span = Math.max(60_000, end - start);
  const maxMin = Math.max(1, Math.floor(span / 60_000));
  const pos = (ms: number) => (Math.max(0, Math.min(span, ms - start)) / span) * 100;
  const live = t >= end - 30_000;
  const rows = model.lines
    .map((l, i) => ({ l, col: laneColor(l.color, i, day) }))
    .filter(({ l }) => l.sched.length > 0 || l.windows.length > 0);
  // Whole hours along the strip, then "now" (or the day's end) at its right end.
  const HOUR = 3_600_000;
  const stepH = [1, 2, 3, 4, 6].find((h) => span / HOUR / h <= 5) ?? 6;
  const ticks: { at: number; label: string }[] = [];
  for (let h = 0; h * HOUR < span * 0.9; h += stepH) {
    ticks.push({ at: ((h * HOUR) / span) * 100, label: hhmm(start + h * HOUR) });
  }
  ticks.push({ at: 100, label: hhmm(end) });
  return (
    <>
      <div className="pf-scrub">
        <button
          type="button"
          className="pf-btn out pf-play"
          onClick={onPlay}
          disabled={locked}
          aria-pressed={playing}
        >
          {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          {playing ? "Pause" : "Replay the day"}
        </button>
        <div className="pf-sc">
          <div className="pf-sc-map" aria-hidden="true">
            {rows.map(({ l, col }) => (
              <div key={l.id} style={{ "--lc": col } as React.CSSProperties}>
                {l.sched
                  .filter((s) => s.s < end)
                  .map((s) => (
                    <i
                      key={"s" + s.s}
                      className="on"
                      style={{ left: `${pos(s.s)}%`, width: `${pos(s.e) - pos(s.s)}%` }}
                    />
                  ))}
                {l.windows.map((w) => (
                  <i
                    key={"w" + w.s}
                    className={w.planned ? "pm" : "stop"}
                    style={{ left: `${pos(w.s)}%`, width: `${pos(w.e) - pos(w.s)}%` }}
                  />
                ))}
              </div>
            ))}
            {rows.length === 0 && <div />}
          </div>
          <div className="pf-sc-fill" style={{ "--f": `${pos(t)}%` } as React.CSSProperties} />
          <input
            type="range"
            min={0}
            max={maxMin}
            step={1}
            value={Math.round(Math.max(0, Math.min(span, t - start)) / 60_000)}
            onChange={(e) => {
              const m = Number(e.target.value);
              if (m >= maxMin) onLive();
              else onSeek(start + m * 60_000);
            }}
            disabled={locked}
            aria-label="Time of day"
            aria-valuetext={hhmm(t)}
          />
          <div className="pf-sc-ticks pf-num" aria-hidden="true">
            {ticks.map((x) => (
              <span key={x.at} style={{ left: `${x.at}%` }}>
                {x.label}
              </span>
            ))}
          </div>
        </div>
        <b className="pf-sc-time pf-num">{hhmm(t)}</b>
        <button
          type="button"
          className="pf-btn pf-live"
          onClick={onLive}
          disabled={live && !playing}
        >
          {model.isToday ? "LIVE" : "End of day"}
        </button>
      </div>
      <div className="pf-legend">
        <span style={{ "--k": "var(--pf-muted)" } as React.CSSProperties}>scheduled hours</span>
        <span style={{ "--k": "var(--pf-bad)" } as React.CSSProperties}>stopped by a fault</span>
        <span style={{ "--k": "var(--pf-pri)" } as React.CSSProperties}>preventive work</span>
        {locked && (
          <span style={{ "--k": "transparent" } as React.CSSProperties}>
            Looking back needs an admin's approval. <Link to="/replay">Ask on Replay a day</Link>
          </span>
        )}
      </div>
    </>
  );
}

const KIND_COLOR: Record<FeedKind, string> = {
  stop: "var(--pf-bad)",
  resume: "var(--pf-good)",
  preventive: "var(--pf-pri)",
  defect: "var(--pf-warn)",
  machine: "var(--pf-warn)",
  entry: "var(--pf-cyan)",
  shift: "var(--pf-muted)",
};

/** What happened today, newest first, up to the clock. */
export function PlantFeed({
  feed,
  t,
  live,
  canFaults,
}: {
  feed: FeedItem[];
  t: number;
  live: boolean;
  canFaults: boolean;
}) {
  const list = feed
    .filter((f) => f.t <= t)
    .slice(-8)
    .reverse();
  // Items that were not on screen a moment ago slide in; the first paint doesn't.
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (seen.current) for (const f of list) if (!seen.current.has(f.key)) fresh.add(f.key);
  const keys = list.map((f) => f.key).join();
  useEffect(() => {
    seen.current = new Set(keys ? keys.split(",") : []);
  }, [keys]);
  return (
    <section className="pf-card" style={{ "--i": 5 } as React.CSSProperties}>
      <h2>
        What happened <small>{live ? "newest first" : `up to ${hhmm(t)}`}</small>
      </h2>
      {list.length === 0 ? (
        <p className="pf-empty">Nothing logged yet today.</p>
      ) : (
        <ul className="pf-feed">
          {list.map((f) => {
            const detail = [canFaults ? f.fault : null, f.detail].filter(Boolean).join(" · ");
            return (
              <li
                key={f.key}
                className={fresh.has(f.key) ? "new" : undefined}
                style={{ "--k": KIND_COLOR[f.kind] } as React.CSSProperties}
              >
                <time className="pf-num">{hhmm(f.t)}</time>
                <i aria-hidden="true" />
                <span>
                  <b>{f.title}</b>
                  {detail && <span>{detail}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
