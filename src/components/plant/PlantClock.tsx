// The production day as a clock (mockup "Jammy Control Room", phase 3): 24
// hours around, 08:00 at the top, one ring per line. Faint arc = scheduled
// hours, red = stopped by a fault, blue = preventive work, pulsing red = still
// open. The hand is the moment being looked at. Beside it: the "pulse" (a
// spike wherever a fault stop began) and the day's longest stops.
// Everything is drawn from the Plant floor's own model, so it agrees with the
// lanes, the tiles and the strip.
import { useEffect, useMemo, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { laneColor } from "@/components/plant/lane-color";
import { DAY_MIN, hhmm, minutesText, type PlantModel, type PlantSnapshot } from "@/lib/plant-floor";
import { cn } from "@/lib/utils";

const MIN = 60_000;

interface Arc {
  key: string;
  r: number;
  a: number; // minutes from the day's start
  len: number;
  kind: "on" | "stop" | "pm" | "open";
  color: string;
  head: string;
  sub: string;
}

function useArmed(key: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(false);
    let b = 0;
    const a = requestAnimationFrame(() => {
      b = requestAnimationFrame(() => setOn(true));
    });
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, [key]);
  return on;
}

export function PlantClock({
  model,
  snap,
  day,
  canFaults,
}: {
  model: PlantModel;
  snap: PlantSnapshot;
  day: boolean;
  canFaults: boolean;
}) {
  const start = model.win.startMs;
  const [pick, setPick] = useState<Arc | null>(null);
  const on = useArmed(model.win.day);

  const { arcs, rings } = useMemo(() => {
    const rows = model.lines
      .map((l, i) => ({ l, col: laneColor(l.color, i, day) }))
      .filter(({ l }) => l.sched.length > 0 || l.windows.length > 0);
    const step = rows.length > 5 ? 13 : 17;
    const arcs: Arc[] = [];
    const rings: { r: number; name: string; col: string }[] = [];
    rows.forEach(({ l, col }, i) => {
      const r = 132 - i * step;
      rings.push({ r, name: l.name, col });
      const m = (ms: number) => (Math.min(ms, model.cap) - start) / MIN;
      for (const s of l.sched) {
        if (s.s >= model.cap) continue;
        arcs.push({
          key: `on${l.id}${s.s}`,
          r,
          a: m(s.s),
          len: m(s.e) - m(s.s),
          kind: "on",
          color: col,
          head: l.name,
          sub: `scheduled ${hhmm(s.s)}–${hhmm(s.e)}`,
        });
      }
      for (const w of l.windows) {
        const len = m(w.e) - m(w.s);
        if (len <= 0) continue;
        const title = canFaults ? w.titles[0] : w.planned ? "Preventive work" : "Fault stop";
        arcs.push({
          key: `w${l.id}${w.s}`,
          r,
          a: m(w.s),
          // Short stops stay visible: at least 3 minutes of arc.
          len: Math.max(3, len),
          kind: w.planned ? "pm" : w.open ? "open" : "stop",
          color: w.planned ? "var(--pf-pri)" : "var(--pf-bad)",
          head: `${l.name} · ${title}`,
          sub: w.open
            ? `open since ${hhmm(w.s)} · ${minutesText(len)} so far`
            : `${hhmm(w.s)}–${hhmm(w.e)} · ${minutesText(len)}`,
        });
      }
    });
    return { arcs, rings };
  }, [model, day, start, canFaults]);

  const handDeg = ((snap.t - start) / MIN / DAY_MIN) * 360;
  const width = rings.length > 5 ? 8 : 11;
  const dash = (a: Arc) => {
    if (!on) return `0 ${DAY_MIN}`;
    return `${a.len} ${DAY_MIN}`;
  };
  const stoppedNow = snap.stopped.length;

  return (
    <section className="pf-card" style={{ "--i": 6 } as React.CSSProperties}>
      <h2>
        The day as a clock{" "}
        <small>
          {hhmm(start)} → {hhmm(start)} · one ring per line · hand ={" "}
          {model.isToday ? "now" : "the moment shown"}
        </small>
      </h2>
      <div className="pf-clock" onPointerLeave={() => setPick(null)}>
        <svg
          viewBox="0 0 300 300"
          role="img"
          aria-label="The production day as a clock, one ring per line"
        >
          <g transform="rotate(-90 150 150)">
            {rings.map((g) => (
              <circle
                key={g.r}
                cx="150"
                cy="150"
                r={g.r}
                fill="none"
                stroke="var(--pf-panel2)"
                strokeWidth={width}
              />
            ))}
            {arcs.map((a, i) => (
              <circle
                key={a.key}
                className={cn("arc", a.kind)}
                cx="150"
                cy="150"
                r={a.r}
                pathLength={DAY_MIN}
                stroke={a.color}
                strokeWidth={width}
                strokeDasharray={dash(a)}
                strokeDashoffset={-a.a}
                style={{ transitionDelay: a.kind === "on" ? "0ms" : `${400 + (i % 12) * 50}ms` }}
                tabIndex={a.kind === "on" ? -1 : 0}
                aria-label={`${a.head}: ${a.sub}`}
                onPointerEnter={() => setPick(a)}
                onFocus={() => setPick(a)}
                onBlur={() => setPick(null)}
              />
            ))}
          </g>
          {(
            [
              ["08", 150, 9],
              ["14", 294, 154],
              ["20", 150, 298],
              ["02", 6, 154],
            ] as const
          ).map(([t, x, y]) => (
            <text key={t} x={x} y={y} textAnchor="middle">
              {t}
            </text>
          ))}
          <g className="hand" style={{ transform: `rotate(${on ? handDeg : 0}deg)` }}>
            <line x1="150" y1="118" x2="150" y2="14" />
            <circle cx="150" cy="14" r="4" />
          </g>
        </svg>
        <div className="ctr" aria-live="polite">
          {pick ? (
            <>
              <b style={{ fontSize: 13 }}>{pick.head}</b>
              <span>{pick.sub}</span>
            </>
          ) : (
            <>
              <b className="pf-num">{hhmm(snap.t)}</b>
              <span>
                {stoppedNow > 0
                  ? `${stoppedNow} line${stoppedNow === 1 ? "" : "s"} stopped`
                  : `${snap.running} line${snap.running === 1 ? "" : "s"} running`}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="pf-legend" style={{ justifyContent: "center" }}>
        {rings.map((g) => (
          <span key={g.r} style={{ "--k": g.col } as React.CSSProperties}>
            {g.name}
          </span>
        ))}
      </div>
      <div className="pf-legend" style={{ justifyContent: "center" }}>
        <span style={{ "--k": "var(--pf-bad)" } as React.CSSProperties}>fault stop</span>
        <span style={{ "--k": "var(--pf-pri)" } as React.CSSProperties}>preventive</span>
        <span
          style={
            { "--k": "color-mix(in srgb, var(--pf-bad) 50%, transparent)" } as React.CSSProperties
          }
        >
          still open (pulsing)
        </span>
      </div>
    </section>
  );
}

/** A heartbeat line across the day: a spike where each fault stop began. */
export function PlantPulse({ model, day }: { model: PlantModel; day: boolean }) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLCanvasElement>(null);
  // Keyed by the positions themselves: the model is rebuilt every second, and
  // the sweep must not restart with it.
  const span = model.win.endMs - model.win.startMs;
  const spikeKey = model.lines
    .flatMap((l) =>
      l.windows.filter((w) => !w.planned).map((w) => ((w.s - model.win.startMs) / span).toFixed(5)),
    )
    .sort()
    .join();
  const spikes = useMemo(() => (spikeKey ? spikeKey.split(",").map(Number) : []), [spikeKey]);
  const live = useRef({ spikes, day });
  live.current = { spikes, day };

  useEffect(() => {
    const cv = ref.current;
    const c = cv?.getContext("2d");
    if (!cv || !c) return;
    let w = 0;
    let h = 0;
    const size = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width;
      h = r.height;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = (clock: number) => {
      if (!w) return;
      const { spikes, day } = live.current;
      const bad = day ? "#d12f45" : "#ff5d6c";
      const mut = day ? "#56618a" : "#93a0bf";
      c.clearRect(0, 0, w, h);
      const base = h * 0.7;
      const yAt = (x: number) => {
        let y = base + Math.sin(x * 0.05) * 1.2;
        for (const f of spikes) {
          const d = x - f * w;
          if (Math.abs(d) < 12) {
            const u = d / 12;
            y -= (1 - Math.abs(u)) * (h * 0.55) * (Math.abs(u) < 0.25 ? 1 : 0.5);
            if (u > 0.2 && u < 0.6) y += 5;
          }
        }
        return y;
      };
      c.lineWidth = 1.4;
      c.strokeStyle = mut;
      c.globalAlpha = reduced ? 0.8 : 0.4;
      c.beginPath();
      for (let x = 0; x <= w; x += 2) {
        if (x) c.lineTo(x, yAt(x));
        else c.moveTo(x, yAt(x));
      }
      c.stroke();
      c.globalAlpha = 1;
      if (reduced) return;
      const sx = ((clock * 90) % (w + 160)) - 20;
      const from = Math.max(0, sx - 150);
      const g = c.createLinearGradient(sx - 150, 0, sx, 0);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, bad);
      c.strokeStyle = g;
      c.lineWidth = 2.2;
      c.beginPath();
      for (let x = from; x <= Math.min(w, sx); x += 2) {
        if (x === from) c.moveTo(x, yAt(x));
        else c.lineTo(x, yAt(x));
      }
      c.stroke();
      if (sx >= 0 && sx <= w) {
        c.fillStyle = bad;
        c.shadowColor = bad;
        c.shadowBlur = 12;
        c.beginPath();
        c.arc(sx, yAt(sx), 3.2, 0, 7);
        c.fill();
        c.shadowBlur = 0;
      }
    };
    size();
    const ro = new ResizeObserver(() => {
      size();
      if (reduced) draw(0);
    });
    ro.observe(cv);
    if (reduced) {
      draw(0);
      return () => ro.disconnect();
    }
    let raf = 0;
    let last = performance.now();
    let clock = 0;
    const step = (now: number) => {
      clock += Math.min(0.05, (now - last) / 1000);
      last = now;
      draw(clock);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reduced, spikeKey, day]);

  return (
    <section className="pf-card" style={{ "--i": 7 } as React.CSSProperties}>
      <h2>
        Plant pulse{" "}
        <small>
          {spikes.length === 0
            ? "no fault stop in this day"
            : `${spikes.length} fault stop${spikes.length === 1 ? "" : "s"} · a spike where each began`}
        </small>
      </h2>
      <canvas ref={ref} className="pf-ecg" aria-hidden="true" />
      <div className="pf-axis pf-num" aria-hidden="true">
        <span>{hhmm(model.win.startMs)}</span>
        <span>20:00</span>
        <span>{hhmm(model.win.endMs)}</span>
      </div>
    </section>
  );
}

/** The day's longest fault stops, longest first. */
export function LongestStops({ model, canFaults }: { model: PlantModel; canFaults: boolean }) {
  const rows = useMemo(
    () =>
      model.lines
        .flatMap((l) =>
          l.windows
            .filter((w) => !w.planned)
            .map((w) => ({ line: l.name, w, min: (w.e - w.s) / MIN })),
        )
        .sort((a, b) => b.min - a.min)
        .slice(0, 5),
    [model],
  );
  const max = rows[0]?.min ?? 1;
  const on = useArmed(model.win.day);
  return (
    <section className="pf-card" style={{ "--i": 8 } as React.CSSProperties}>
      <h2>
        Longest stops <small>faults only · one window per stop</small>
      </h2>
      {rows.length === 0 ? (
        <p className="pf-empty">No fault stop logged for this day.</p>
      ) : (
        <div className={cn("pf-reasons", on && "on")}>
          {rows.map(({ line, w, min }, i) => (
            <div key={line + w.s} className="pf-hbar">
              <span>
                {line}
                {canFaults ? ` · ${w.titles[0]}` : ""} · {hhmm(w.s)}
              </span>
              <b className="pf-num">
                {minutesText(min)}
                {w.open ? " so far" : ""}
              </b>
              <span className="t">
                <i
                  style={
                    {
                      "--w": `${(min / max) * 100}%`,
                      "--i": i,
                      "--k": "var(--pf-bad)",
                    } as React.CSSProperties
                  }
                />
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
