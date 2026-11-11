import { useEffect, useMemo, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { Odometer } from "@/components/motion";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import {
  hhmm,
  minutesText,
  type LineSnapshot,
  type LineState,
  type PlantLine,
  type PlantModel,
  type PlantSnapshot,
} from "@/lib/plant-floor";
import { laneColor } from "@/components/plant/lane-color";
import { cn } from "@/lib/utils";

// One lane per line: a conveyor drawn on a canvas. The belt and the candies
// move only while the line is running; a stop halts them and the three
// stations pulse red (a fault) or blue (preventive work). The drawing is
// decoration: every fact on it is also in the text beside it.

type Shape = "bear" | "cube" | "pill";

const PALETTE = {
  night: {
    bad: "#ff5d6c",
    pri: "#6f9bff",
    muted: "#93a0bf",
    belt: "rgba(255,255,255,.07)",
    chev: "rgba(255,255,255,.12)",
    node: "#121a33",
  },
  day: {
    bad: "#d12f45",
    pri: "#2848c8",
    muted: "#56618a",
    belt: "rgba(20,40,110,.10)",
    chev: "rgba(20,40,110,.16)",
    node: "#ffffff",
  },
};
const CANDIES: Record<Shape, string[]> = {
  bear: ["#6f9bff", "#3fd7e6", "#ff6fa8", "#ffb648", "#3ddc97", "#b08cff"],
  cube: ["#3ddc97", "#b6f36a", "#ffd166"],
  pill: ["#ffd3e6", "#ff9cc8", "#ffffff"],
};
function shapeOf(name: string, index: number): Shape {
  const n = name.toLowerCase();
  if (/gelatin|gum|jell/.test(n)) return "bear";
  if (/pectin|toffee|eclair|glass|mint/.test(n)) return "cube";
  if (/marsh|tube|mawlid|coat/.test(n)) return "pill";
  return (["bear", "cube", "pill"] as const)[index % 3];
}

interface Candy {
  x: number;
  col: string;
  rot: number;
  ph: number;
}
interface Sim {
  w: number;
  h: number;
  off: number;
  speed: number;
  candies: Candy[];
  spawn: number;
  box: number;
  pop: number;
}
interface LaneLook {
  col: string;
  shape: Shape;
  /** 0–1: how fast this line is against the fastest one. */
  pace: number;
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawCandy(c: CanvasRenderingContext2D, shape: Shape, k: Candy, x: number, y: number) {
  c.save();
  c.translate(x, y);
  c.rotate(k.rot);
  c.fillStyle = k.col;
  if (shape === "bear") {
    c.beginPath();
    c.arc(0, 0, 5.6, 0, 7);
    c.fill();
    c.beginPath();
    c.arc(-4.2, -4.6, 2.3, 0, 7);
    c.arc(4.2, -4.6, 2.3, 0, 7);
    c.fill();
    c.fillStyle = "rgba(255,255,255,.55)";
    c.beginPath();
    c.arc(-1.8, -1.6, 1.5, 0, 7);
    c.fill();
  } else if (shape === "cube") {
    rr(c, -5, -5, 10, 10, 2.6);
    c.fill();
    c.fillStyle = "rgba(255,255,255,.5)";
    rr(c, -3.4, -3.6, 4.2, 2.2, 1.1);
    c.fill();
  } else {
    rr(c, -7, -4.4, 14, 8.8, 4.4);
    c.fill();
    c.fillStyle = "rgba(255,255,255,.55)";
    rr(c, -4.6, -3, 5, 2, 1);
    c.fill();
  }
  c.restore();
}

function drawLane(
  c: CanvasRenderingContext2D,
  sim: Sim,
  look: LaneLook,
  state: LineState | "done",
  day: boolean,
  dt: number,
  clock: number,
) {
  const { w, h } = sim;
  if (!w) return;
  const P = day ? PALETTE.day : PALETTE.night;
  c.clearRect(0, 0, w, h);
  const y = h / 2 + 5;
  const x0 = 4;
  const x1 = w - 40;
  const off = state === "off";
  const running = state === "running";
  const target = running ? 58 * (0.75 + look.pace * 0.5) : 0;
  sim.speed += (target - sim.speed) * Math.min(1, dt * 3.2);
  sim.off += sim.speed * dt;

  // belt
  c.globalAlpha = off ? 0.45 : 1;
  c.fillStyle = P.belt;
  rr(c, x0, y - 9, x1 - x0, 18, 9);
  c.fill();
  c.save();
  rr(c, x0, y - 9, x1 - x0, 18, 9);
  c.clip();
  c.strokeStyle = P.chev;
  c.lineWidth = 2;
  for (let x = x0 - 22 + (sim.off % 22); x < x1; x += 22) {
    c.beginPath();
    c.moveTo(x, y + 6);
    c.lineTo(x + 7, y - 6);
    c.stroke();
  }
  c.restore();

  // candies
  if (running && dt > 0) {
    sim.spawn -= dt;
    if (sim.spawn <= 0) {
      const pal = CANDIES[look.shape];
      sim.candies.push({
        x: x0 + 4,
        col: pal[(Math.random() * pal.length) | 0],
        rot: (Math.random() - 0.5) * 0.5,
        ph: Math.random() * 6,
      });
      sim.spawn = 0.34 + Math.random() * 0.22;
    }
  }
  for (const k of sim.candies) {
    k.x += sim.speed * dt;
    const wob = sim.speed > 4 ? Math.sin(k.x * 0.09 + k.ph) * 1.3 : 0;
    drawCandy(c, look.shape, k, k.x, y - 2 + wob);
  }
  while (sim.candies.length && sim.candies[0].x > x1 - 2) {
    sim.candies.shift();
    sim.box = (sim.box + 1) % 9;
    sim.pop = 1;
  }

  // stations
  const names = w > 330 ? ["COOK", "MAKE", "PACK"] : ["", "", ""];
  const halted = state === "stopped" || state === "preventive";
  const hot = state === "preventive" ? P.pri : P.bad;
  [0.18, 0.47, 0.76].forEach((f, i) => {
    const sx = x0 + (x1 - x0) * f;
    const k = halted ? hot : look.col;
    if (halted) {
      const p = (Math.sin(clock * 6 - i * 0.9) + 1) / 2;
      c.strokeStyle = k;
      c.globalAlpha = 0.2 + p * 0.5;
      c.lineWidth = 2;
      rr(c, sx - 20 - p * 4, y - 20 - p * 4, 40 + p * 8, 36 + p * 8, 11);
      c.stroke();
      c.globalAlpha = 1;
    }
    c.fillStyle = P.node;
    rr(c, sx - 17, y - 17, 34, 30, 8);
    c.fill();
    c.strokeStyle = k;
    c.lineWidth = 1.6;
    c.globalAlpha = off ? 0.4 : 1;
    rr(c, sx - 17, y - 17, 34, 30, 8);
    c.stroke();
    c.fillStyle = k;
    const spin = running ? clock * 4 + i : i;
    for (let j = 0; j < 3; j++) {
      const a = spin + (j * Math.PI * 2) / 3;
      c.beginPath();
      c.arc(sx + Math.cos(a) * 5.5, y - 2 + Math.sin(a) * 5.5, 2, 0, 7);
      c.fill();
    }
    if (names[i]) {
      c.globalAlpha = off ? 0.4 : 0.75;
      c.fillStyle = P.muted;
      c.font = "600 8.5px Fira Sans, sans-serif";
      c.textAlign = "center";
      c.fillText(names[i], sx, y - 21);
    }
    c.globalAlpha = off ? 0.45 : 1;
  });

  // carton
  sim.pop = Math.max(0, sim.pop - dt * 4);
  const bx = w - 30;
  const s = 1 + sim.pop * 0.18;
  c.save();
  c.translate(bx + 12, y);
  c.scale(s, s);
  c.strokeStyle = look.col;
  c.lineWidth = 1.8;
  rr(c, -12, -12, 24, 22, 5);
  c.stroke();
  c.fillStyle = look.col;
  c.globalAlpha *= 0.55;
  const fh = (sim.box / 9) * 18;
  rr(c, -10, 8 - fh, 20, Math.max(0.01, fh), 3);
  c.fill();
  c.restore();
  c.globalAlpha = 1;
}

const kg = (n: number) => Math.round(n).toLocaleString("en-US");

function stateText(
  line: PlantLine,
  s: LineSnapshot,
  t: number,
  dayStart: number,
  canFaults: boolean,
): { head: string; more: string } {
  const bits: string[] = [];
  if (s.defects > 0)
    bits.push(`${s.defects} fault${s.defects === 1 ? "" : "s"} open, line running`);
  if (s.machinesDown > 0)
    bits.push(`${s.machinesDown} packing machine${s.machinesDown === 1 ? "" : "s"} down`);
  if (s.state === "running") {
    return { head: "Running", more: bits.join(" · ") || line.hours };
  }
  if (s.state === "off") {
    return { head: s.offReason ?? "Off", more: bits.join(" · ") || line.hours };
  }
  const w = s.window!;
  const since =
    w.since < dayStart
      ? `since ${new Date(w.since).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${hhmm(w.since)}`
      : `since ${hhmm(w.s)}`;
  const dur = minutesText((Math.min(t, w.open ? t : w.e) - w.s) / 60_000);
  const head = s.state === "preventive" ? "Preventive work" : "Stopped";
  const title = canFaults ? w.titles[0] : null;
  return {
    head: `${head} · ${dur}`,
    more: [title, since, ...bits].filter(Boolean).join(" · "),
  };
}

/** A finished day in one line: its stops and the time they cost. */
function summaryText(line: PlantLine, s: LineSnapshot): { head: string; more: string } {
  if (s.schedMin === 0) return { head: line.offReason ?? "Did not run", more: line.hours };
  const pm = s.plannedMin > 0 ? `preventive ${minutesText(s.plannedMin)}` : "";
  const head =
    line.stops > 0
      ? `${line.stops} stop${line.stops === 1 ? "" : "s"} · ${minutesText(s.lostMin)} lost`
      : "No fault stop";
  return { head, more: [line.hours, pm].filter(Boolean).join(" · ") };
}

export function PlantLanes({
  model,
  snap,
  day,
  canFaults,
  fast,
  summary,
}: {
  model: PlantModel;
  snap: PlantSnapshot;
  /** The stage's Day look. */
  day: boolean;
  canFaults: boolean;
  /** The clock is being dragged or replayed: numbers follow at once. */
  fast: boolean;
  /** A finished day seen whole: each lane sums up its day instead of a moment. */
  summary: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const sims = useRef(new Map<string, Sim>());

  const looks = useMemo(() => {
    const top = Math.max(1e-9, ...model.lines.map((l) => l.ratePerMin ?? 0));
    const m = new Map<string, LaneLook>();
    model.lines.forEach((l, i) =>
      m.set(l.id, {
        col: laneColor(l.color, i, day),
        shape: shapeOf(l.name, i),
        pace: l.ratePerMin ? Math.min(1, l.ratePerMin / top) : 0.5,
      }),
    );
    return m;
  }, [model.lines, day]);

  // The loop reads the latest state through refs, so React is not in the frame.
  // In a day summary a line that ran is drawn still, one that didn't is dimmed.
  const drawState = (s: LineSnapshot): LineState | "done" =>
    summary ? (s.schedMin > 0 ? "done" : "off") : s.state;
  const live = useRef({ snap, looks, day, drawState });
  live.current = { snap, looks, day, drawState };
  const still = useRef<() => void>(() => {});

  const lineCount = model.lines.length;

  // Size the canvases, and (unless motion is reduced) run one loop for all lanes.
  useEffect(() => {
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      for (const [id, cv] of canvases.current) {
        const r = cv.getBoundingClientRect();
        if (!r.width) continue;
        let sim = sims.current.get(id);
        if (!sim) {
          sim = { w: 0, h: 0, off: 0, speed: 0, candies: [], spawn: 0, box: 0, pop: 0 };
          sims.current.set(id, sim);
          // A line that is already running starts with candies along its belt,
          // not an empty one that fills over the first ten seconds.
          const look = live.current.looks.get(id);
          const st = live.current.snap.lines.find((l) => l.id === id)?.state;
          if (look && st === "running") {
            const pal = CANDIES[look.shape];
            for (let x = r.width - 50; x > 12; x -= 26 + Math.random() * 22) {
              sim.candies.push({
                x,
                col: pal[(Math.random() * pal.length) | 0],
                rot: (Math.random() - 0.5) * 0.5,
                ph: Math.random() * 6,
              });
            }
            sim.box = (Math.random() * 9) | 0;
          }
        }
        sim.w = r.width;
        sim.h = r.height;
        cv.width = Math.round(r.width * dpr);
        cv.height = Math.round(r.height * dpr);
        cv.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    const frame = (dt: number, clock: number) => {
      const { snap, looks, day, drawState } = live.current;
      for (const s of snap.lines) {
        const cv = canvases.current.get(s.id);
        const sim = sims.current.get(s.id);
        const look = looks.get(s.id);
        const ctx = cv?.getContext("2d");
        if (!ctx || !sim || !look) continue;
        if (reduced) {
          // No motion: a still frame, with candies already on the belt of a
          // running line so the picture still says "running".
          const pal = CANDIES[look.shape];
          sim.candies =
            s.state === "running"
              ? Array.from({ length: Math.max(0, Math.floor((sim.w - 60) / 46)) }, (_, i) => ({
                  x: 24 + i * 46,
                  col: pal[i % pal.length],
                  rot: 0,
                  ph: 0,
                }))
              : [];
        }
        drawLane(ctx, sim, look, drawState(s), day, dt, clock);
      }
    };
    still.current = () => frame(0, 0);
    size();
    const ro = new ResizeObserver(() => {
      size();
      if (reduced) frame(0, 0);
    });
    for (const cv of canvases.current.values()) ro.observe(cv);
    if (reduced) {
      frame(0, 0);
      return () => ro.disconnect();
    }
    let raf = 0;
    let last = performance.now();
    let clock = 0;
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      frame(dt, clock);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reduced, lineCount]);

  // With motion reduced there is no loop, so redraw when something changes.
  const stateKey = snap.lines.map(drawState).join();
  useEffect(() => {
    if (reduced) still.current();
  }, [reduced, stateKey, day]);

  return (
    <div className="pf-lanes">
      {model.lines.map((line, i) => {
        const s = snap.lines[i];
        const look = looks.get(line.id)!;
        const txt = summary
          ? summaryText(line, s)
          : stateText(line, s, snap.t, model.win.startMs, canFaults);
        const cls = summary
          ? s.schedMin === 0
            ? "off"
            : line.stops > 0
              ? "sum-bad"
              : "sum-ok"
          : s.state;
        const shown = s.kg == null ? null : Math.round(s.kg / 10) * 10;
        const made = s.kgKind === "made";
        const pctOfPlan =
          line.entry && line.entry.plan > 0
            ? ` · ${Math.round((line.entry.made / line.entry.plan) * 100)}% of plan`
            : "";
        const under =
          line.entry != null
            ? made
              ? summary
                ? pctOfPlan.replace(" · ", "")
                : `of ${kg(line.entry.made)} kg made${pctOfPlan}`
              : `entered today ${kg(line.entry.made)} kg`
            : !model.isToday
              ? "no entry for this day"
              : line.last && line.last.made > 0
                ? `last day ${kg(line.last.made)} kg${
                    line.last.plan > 0
                      ? ` · ${Math.round((line.last.made / line.last.plan) * 100)}%`
                      : ""
                  }`
                : "";
        return (
          <Link
            key={line.id}
            to="/"
            search={{ line: line.id }}
            className={cn("pf-lane", cls)}
            style={{ "--lc": look.col } as React.CSSProperties}
            aria-label={`${line.name}: ${txt.head}. Open it on the Dashboard`}
            data-line={line.name}
            data-state={summary ? "summary" : s.state}
          >
            <span className="pf-info">
              <span className="pf-name">
                <i aria-hidden="true" />
                <span>{line.name}</span>
              </span>
              <span className="pf-st">
                <span className="pf-dot" aria-hidden="true" />
                <span>{txt.head}</span>
              </span>
              <span className="pf-more">{txt.more}</span>
            </span>
            <canvas
              aria-hidden="true"
              ref={(el) => {
                if (el) canvases.current.set(line.id, el);
                else canvases.current.delete(line.id);
              }}
            />
            <span className="pf-nums">
              {shown == null ? (
                <>
                  <b className="pf-num">—</b>
                  <small>no capacity set</small>
                </>
              ) : (
                <>
                  <b className="pf-num">
                    <Odometer
                      value={shown}
                      decimals={0}
                      grouping
                      duration={fast ? 250 : 900}
                      label={`${kg(shown)} kg${made ? "" : ", estimate"}`}
                    />
                  </b>
                  <small>
                    {made ? (summary ? "kg made" : "kg made by then") : "est. kg so far"}
                  </small>
                </>
              )}
              {under && <small className="pf-num">{under}</small>}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
