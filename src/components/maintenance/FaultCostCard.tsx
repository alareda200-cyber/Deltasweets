import { useEffect, useId, useMemo, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
import { tonnes, type FaultCost, type FaultCostRow, type LineCost } from "@/lib/fault-cost";
import { ScopeChip } from "@/components/maintenance/RightNowSection";

// Maintenance › What faults cost (upgrade 4, October 2026).
//
// The picked line's plan is drawn as one bar: what was made, the faults, and
// the other losses. The fault pieces then crack, break off and fall, landing
// as the ranking of what each fault cost — the hole each one leaves stays in
// the plan. Below: the top faults of every line in view, by kg or by time.
// Follows the page's filters. Not part of the PDF report.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");
const PIECES = 6;
const SHOW = 10;
const ROW = 56;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

interface Piece {
  name: string;
  kg: number;
  other?: boolean;
}

function piecesOf(line: LineCost, rows: FaultCostRow[]): Piece[] {
  const mine = rows.filter((r) => r.lineId === line.lineId);
  const top: Piece[] = mine.slice(0, PIECES).map((r) => ({ name: r.title, kg: r.kg }));
  const rest = mine.slice(PIECES);
  if (rest.length)
    top.push({
      name: `${rest.length} other fault${rest.length === 1 ? "" : "s"}`,
      kg: rest.reduce((s, r) => s + r.kg, 0),
      other: true,
    });
  return top;
}

/** Plays once, the first time the element is at least a third on screen. */
/** Smallest 1 / 2 / 2.5 / 5 × 10^k at or above `raw`. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p10 = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p10;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p10;
}

function useOnScreen(ref: React.RefObject<Element | null>, key: string) {
  const [seen, setSeen] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(key);
      return;
    }
    const io = new IntersectionObserver(
      (es) => {
        // A third of it in view, or 200px of a tall one (phone).
        if (
          es.some(
            (e) =>
              e.isIntersecting && (e.intersectionRatio >= 0.33 || e.intersectionRect.height >= 200),
          )
        ) {
          setSeen(key);
          io.disconnect();
        }
      },
      { threshold: [0, 0.1, 0.2, 0.33] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, key]);
  return seen === key;
}

// ---------------------------------------------------------------------------
// The plan bar and its falling pieces

function PlanHero({
  line,
  pieces,
  desk,
  counterRef,
}: {
  line: LineCost;
  pieces: Piece[];
  desk: boolean;
  counterRef: React.RefObject<HTMLSpanElement | null>;
}) {
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const reduced = usePrefersReducedMotion();
  const visible = useOnScreen(svgRef, line.lineId + (desk ? "d" : "p"));
  const [done, setDone] = useState(false);

  const W = desk ? 1000 : 360;
  const X0 = desk ? 14 : 10;
  const RW = W - 2 * X0;
  const RY = desk ? 34 : 30;
  const RH = desk ? 50 : 40;
  const R = desk ? 12 : 10;
  const total = Math.max(line.plan, line.made + line.lostKg);
  const sc = RW / total;
  const wMade = line.made * sc;
  const wLost = line.lostKg * sc;
  const xf = X0 + wMade;
  const xo = xf + wLost;
  const rowY0 = desk ? 150 : 128;
  const rowH = desk ? 34 : 44;
  const barX = desk ? 300 : X0;
  const valX = W - X0;
  const maxKg = Math.max(1, ...pieces.map((p) => p.kg));
  const barMax = desk ? valX - barX - 150 : RW - 4;
  const H = rowY0 + pieces.length * rowH + (desk ? 6 : 4);
  // A nice step (1, 2, 2.5 or 5 × 10^k) so the ruler keeps about 4 labels on
  // a phone and 8 on a desktop, whatever the period's plan is.
  const step = niceStep(line.plan / (desk ? 8 : 4));
  const ticks: number[] = [];
  for (let v = 0; v <= line.plan + 1; v += step) ticks.push(v);
  const geo = useMemo(() => {
    let x = xf;
    return pieces.map((p, k) => {
      const w = p.kg * sc;
      const g = { x, w, k };
      x += w;
      return g;
    });
  }, [pieces, sc, xf]);
  const rowsGeo = pieces.map((p, k) => {
    const y = rowY0 + k * rowH;
    const bh = desk ? 18 : 14;
    const yb = desk ? y + (rowH - bh) / 2 - 4 : y + 18;
    const bw = Math.max(6, (p.kg / maxKg) * barMax);
    const cy = desk ? yb + bh / 2 : y + 7;
    return { y, bh, yb, bw, cy };
  });

  useEffect(() => {
    const svg = svgRef.current;
    const counter = counterRef.current;
    if (!svg || !counter) return;
    const setCount = (v: number) => (counter.textContent = tonnes(v));
    const q = <T extends Element>(s: string) => [...svg.querySelectorAll<T>(s)];
    const finish = () => {
      q<SVGElement>(".fc-chunk").forEach((c) => (c.style.opacity = "0"));
      q<SVGElement>(".fc-ghost").forEach((g) => g.setAttribute("opacity", "1"));
      q<SVGElement>(".fc-pbar").forEach((b) => {
        b.setAttribute("opacity", "1");
        b.style.transform = "none";
      });
      setCount(line.lostKg);
      setDone(true);
    };
    if (reduced) return finish();
    if (!visible) {
      // Waiting off screen: hold the start frame. The counter keeps the true
      // number meanwhile; it only counts up from 0 once the motion runs.
      setDone(false);
      setCount(line.lostKg);
      q<SVGElement>(".fc-chunk").forEach((c) => (c.style.opacity = ""));
      q<SVGElement>(".fc-ghost").forEach((g) => g.setAttribute("opacity", "0"));
      q<SVGElement>(".fc-pbar").forEach((b) => b.setAttribute("opacity", "0"));
      return;
    }
    setDone(false);
    setCount(0);
    const anims: Animation[] = [];
    const timers: number[] = [];
    const later = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms));
    const fade = (sel: string, delay: number, duration = 350) =>
      q<SVGElement>(sel).forEach((n) =>
        anims.push(
          n.animate([{ opacity: 0 }, { opacity: 1 }], { duration, delay, fill: "backwards" }),
        ),
      );
    const outline = svg.querySelector<SVGRectElement>(".fc-outline")!;
    const len = 2 * (RW + RH);
    anims.push(
      outline.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
        duration: 700,
        easing: EASE,
        fill: "backwards",
      }),
    );
    fade(".fc-track", 250, 400);
    fade(".fc-tick", 200, 500);
    fade(".fc-tplan", 450);
    const made = svg.querySelector<SVGRectElement>(".fc-made")!;
    anims.push(
      made.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
        duration: 1000,
        delay: 650,
        easing: EASE,
        fill: "backwards",
      }),
    );
    fade(".fc-tmade", 1350);
    fade(".fc-other", 1500, 450);
    fade(".fc-tother", 1650);
    const chunks = q<SVGRectElement>(".fc-chunk");
    chunks.forEach((c, k) => {
      c.style.opacity = "";
      anims.push(
        c.animate(
          [
            { opacity: 0, transform: "scaleX(0)" },
            { opacity: 1, transform: "none" },
          ],
          {
            duration: 420,
            delay: 1550 + k * 40,
            easing: EASE,
            fill: "backwards",
          },
        ),
      );
    });
    const br = svg.querySelector<SVGGElement>(".fc-bracket")!;
    anims.push(
      br.animate(
        [
          { opacity: 0, transform: "translateY(-4px)" },
          { opacity: 1, transform: "none" },
        ],
        {
          duration: 350,
          delay: 1900,
          fill: "backwards",
        },
      ),
    );
    let acc = 0;
    const start = 2300;
    const gap = 360;
    chunks.forEach((c, k) => {
      const bar = svg.querySelector<SVGRectElement>(`.fc-pbar[data-k="${k}"]`)!;
      const ghost = svg.querySelector<SVGRectElement>(`.fc-ghost[data-k="${k}"]`)!;
      const shadow = svg.querySelector<SVGEllipseElement>(`.fc-shadow[data-k="${k}"]`)!;
      const { x, w } = geo[k];
      const { yb, bh, bw } = rowsGeo[k];
      const dx = barX - x;
      const dy = yb - RY;
      const sy = bh / RH;
      const t = start + k * gap;
      bar.setAttribute("opacity", "0");
      ghost.setAttribute("opacity", "0");
      anims.push(
        c.animate(
          [
            { transform: "none" },
            { transform: "translate(-1px,1px) rotate(-2.5deg)" },
            { transform: "translate(1px,-1px) rotate(2.5deg)" },
            { transform: "translate(-1px,0) rotate(-1.5deg)" },
            { transform: "none" },
          ],
          { duration: 240, delay: t },
        ),
      );
      anims.push(
        c.animate(
          [
            { transform: "translate(0,0) rotate(0) scaleY(1)", easing: "cubic-bezier(.3,0,.6,0)" },
            {
              transform: `translate(${dx * 0.2}px,-16px) rotate(-10deg) scaleY(1)`,
              offset: 0.2,
              easing: "cubic-bezier(.55,0,1,.45)",
            },
            {
              transform: `translate(${dx}px,${dy + 2}px) rotate(6deg) scaleY(${sy})`,
              offset: 0.8,
              easing: "ease-out",
            },
            {
              transform: `translate(${dx}px,${dy - 6}px) rotate(-2deg) scaleY(${sy})`,
              offset: 0.9,
              easing: "ease-in",
            },
            { transform: `translate(${dx}px,${dy}px) rotate(0) scaleY(${sy})` },
          ],
          { duration: 880, delay: t + 240, fill: "forwards" },
        ),
      );
      anims.push(
        shadow.animate(
          [
            { opacity: 0, transform: "scaleX(.2)" },
            { opacity: 0.18, transform: `scaleX(${Math.min(1, (w / bw) * 1.4)})`, offset: 0.8 },
            { opacity: 0, transform: `scaleX(${Math.min(1, w / bw)})` },
          ],
          { duration: 880, delay: t + 240, fill: "forwards" },
        ),
      );
      later(t + 240, () => ghost.setAttribute("opacity", "1"));
      later(t + 240 + 880, () => {
        c.style.opacity = "0";
        bar.setAttribute("opacity", "1");
        bar.style.transition = "none";
        const s0 = w / bw;
        bar.style.transform = `scaleX(${s0})`;
        bar.animate(
          [
            { transform: `scaleX(${s0}) scaleY(.7)` },
            { transform: `scaleX(${s0 * 1.15}) scaleY(1.15)` },
            { transform: `scaleX(${s0})` },
          ],
          { duration: 260, easing: "ease-out" },
        );
        const from = acc;
        acc += pieces[k].kg;
        const to = acc;
        const t0 = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / 320);
          setCount(from + (to - from) * (1 - Math.pow(1 - p, 3)));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        counter.animate(
          [{ transform: "scale(1)" }, { transform: "scale(1.14)" }, { transform: "scale(1)" }],
          {
            duration: 280,
            easing: "ease-out",
          },
        );
      });
    });
    const endT = start + (chunks.length - 1) * gap + 240 + 880 + 250;
    later(endT, () =>
      q<SVGRectElement>(".fc-pbar").forEach((b, k) => {
        b.style.transition = `transform 800ms ${SPRING} ${k * 70}ms`;
        b.style.transform = "none";
      }),
    );
    later(endT + 350, () => setDone(true));
    return () => {
      timers.forEach(clearTimeout);
      anims.forEach((a) => a.cancel());
    };
    // geo/rowsGeo derive from the same inputs as the key below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduced, line.lineId, desk]);

  const lbl = { opacity: done ? 1 : 0, transition: "opacity 450ms ease" };
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="block h-auto w-full overflow-visible"
      role="img"
      aria-label={`${line.name}: plan ${tonnes(line.plan)}, made ${tonnes(line.made)}, lost to faults ${tonnes(line.lostKg)}, other losses ${tonnes(line.otherKg)}`}
      data-testid="fault-cost-hero"
    >
      <defs>
        <linearGradient id={`gM${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="color-mix(in oklch, var(--primary) 78%, white)" />
          <stop offset="1" stopColor="var(--primary)" />
        </linearGradient>
        <linearGradient id={`gF${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="color-mix(in oklch, var(--destructive) 80%, white)" />
          <stop offset="1" stopColor="color-mix(in oklch, var(--destructive) 85%, black)" />
        </linearGradient>
        <linearGradient id={`gB${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="color-mix(in oklch, var(--destructive) 85%, black)" />
          <stop offset="1" stopColor="color-mix(in oklch, var(--destructive) 75%, white)" />
        </linearGradient>
        <pattern
          id={`hx${uid}`}
          width="7"
          height="7"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="7" height="7" fill="var(--muted)" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="7"
            stroke="color-mix(in oklch, var(--muted-foreground) 30%, transparent)"
            strokeWidth="2.5"
          />
        </pattern>
        <pattern
          id={`hr${uid}`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-45)"
        >
          <rect
            width="6"
            height="6"
            fill="color-mix(in oklch, var(--destructive) 10%, var(--card))"
          />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            stroke="color-mix(in oklch, var(--destructive) 30%, transparent)"
            strokeWidth="1.5"
          />
        </pattern>
        <clipPath id={`cp${uid}`}>
          <rect x={X0} y={RY} width={RW} height={RH} rx={R} />
        </clipPath>
        <filter id={`sh${uid}`} x="-20%" y="-40%" width="140%" height="200%">
          <feDropShadow
            dx="0"
            dy="3"
            stdDeviation="3"
            floodColor="oklch(0.2 0.04 250)"
            floodOpacity="0.22"
          />
        </filter>
      </defs>
      {ticks.map((v) => {
        const x = X0 + v * sc;
        // Room for the "Plan …" label on the right.
        const show = v === 0 || x < X0 + RW - (desk ? 110 : 105);
        return (
          <g key={v} className="fc-tick">
            <line x1={x} x2={x} y1={RY - 7} y2={RY - 2} stroke="var(--muted-foreground)" />
            {show && (
              <text
                x={x}
                y={RY - 11}
                fontSize={10}
                textAnchor={v === 0 ? "start" : "middle"}
                fill="var(--muted-foreground)"
                className="font-mono"
              >
                {v === 0 ? "0" : v >= 1000 ? `${+(v / 1000).toFixed(1)} t` : `${v} kg`}
              </text>
            )}
          </g>
        );
      })}
      <text
        className="fc-tplan"
        x={X0 + RW}
        y={RY - 11}
        fontSize={desk ? 12 : 11}
        textAnchor="end"
        fill="var(--foreground)"
        fontWeight={700}
      >
        Plan {tonnes(line.plan)}
      </text>
      <rect className="fc-track" x={X0} y={RY} width={RW} height={RH} rx={R} fill="var(--muted)" />
      <g clipPath={`url(#cp${uid})`}>
        <rect
          className="fc-made"
          x={X0}
          y={RY}
          width={wMade}
          height={RH}
          fill={`url(#gM${uid})`}
          style={{ transformBox: "fill-box", transformOrigin: "left center" }}
        />
        <rect
          className="fc-other"
          x={xo}
          y={RY}
          width={Math.max(0, X0 + RW - xo)}
          height={RH}
          fill={`url(#hx${uid})`}
        />
        {geo.map(({ x, w, k }) => (
          <rect
            key={k}
            className="fc-ghost"
            data-k={k}
            x={x}
            y={RY}
            width={w}
            height={RH}
            fill={`url(#hr${uid})`}
            opacity={0}
          />
        ))}
        <rect x={X0} y={RY} width={RW} height={RH * 0.42} fill="white" opacity={0.1} />
      </g>
      <rect
        className="fc-outline"
        x={X0}
        y={RY}
        width={RW}
        height={RH}
        rx={R}
        fill="none"
        stroke="color-mix(in oklch, var(--foreground) 70%, transparent)"
        strokeWidth={1.5}
        strokeDasharray={2 * (RW + RH)}
      />
      <text
        className="fc-tmade"
        x={X0 + (desk ? 16 : 10)}
        y={RY + RH / 2 + (desk ? 5 : 4)}
        fontSize={desk ? 15 : 12}
        fill="var(--primary-foreground)"
        fontWeight={700}
      >
        Made {tonnes(line.made)}
        <tspan fontWeight={500} opacity={0.8}>
          {" "}
          · {pct(line.made, line.plan)}
        </tspan>
      </text>
      {X0 + RW - xo > (desk ? 150 : 9999) && (
        <text
          className="fc-tother"
          x={xo + (X0 + RW - xo) / 2}
          y={RY + RH / 2 + 5}
          fontSize={12}
          textAnchor="middle"
          fill="var(--foreground)"
          fontWeight={600}
        >
          Other losses {tonnes(line.otherKg)}
        </text>
      )}
      {wLost > 0 && (
        <g className="fc-bracket">
          <path
            d={`M${xf} ${RY + RH + 8} v5 H${xo} v-5`}
            fill="none"
            stroke="var(--destructive-strong)"
            strokeWidth={1.5}
          />
          <text
            x={Math.min(Math.max((xf + xo) / 2, X0 + 70), X0 + RW - 70)}
            y={RY + RH + 27}
            fontSize={desk ? 12 : 11}
            textAnchor="middle"
            fill="var(--destructive-strong)"
            fontWeight={700}
          >
            Faults {tonnes(line.lostKg)} · {pct(line.lostKg, line.plan)}
          </text>
        </g>
      )}
      {geo.map(({ x, w, k }) => (
        <rect
          key={k}
          className="fc-chunk"
          data-k={k}
          x={x + 0.75}
          y={RY}
          width={Math.max(1, w - 1.5)}
          height={RH}
          rx={2}
          fill={`url(#gF${uid})`}
          opacity={pieces[k].other ? 0.8 : 1}
          filter={`url(#sh${uid})`}
          style={{ transformBox: "fill-box", transformOrigin: "left center" }}
        />
      ))}
      {pieces.map((p, k) => {
        const g = rowsGeo[k];
        return (
          <g key={k} data-fault-piece={p.name}>
            <line
              style={lbl}
              x1={X0}
              x2={W - X0}
              y1={g.y + rowH - 4}
              y2={g.y + rowH - 4}
              stroke="var(--border)"
            />
            <g style={lbl}>
              <circle
                cx={X0 + 10}
                cy={g.cy}
                r={10}
                fill={
                  p.other
                    ? "var(--muted)"
                    : "color-mix(in oklch, var(--destructive) 12%, var(--card))"
                }
              />
              <text
                x={X0 + 10}
                y={g.cy + 4}
                fontSize={11}
                textAnchor="middle"
                fill={p.other ? "var(--muted-foreground)" : "var(--destructive-strong)"}
                fontWeight={800}
              >
                {p.other ? "+" : k + 1}
              </text>
              <text
                x={X0 + 28}
                y={g.cy + 4.5}
                fontSize={desk ? 14 : 12.5}
                fill="var(--foreground)"
                fontWeight={p.other ? 500 : 700}
              >
                {p.name}
              </text>
            </g>
            <ellipse
              className="fc-shadow"
              data-k={k}
              cx={barX + g.bw / 2}
              cy={g.yb + g.bh + 3}
              rx={Math.max(6, g.bw / 2)}
              ry={3}
              fill="oklch(0.2 0.04 250)"
              opacity={0}
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
            />
            <rect
              className="fc-pbar"
              data-k={k}
              x={barX}
              y={g.yb}
              width={g.bw}
              height={g.bh}
              rx={g.bh / 2}
              fill={`url(#gB${uid})`}
              opacity={0}
              style={{ transformBox: "fill-box", transformOrigin: "left center" }}
            />
            <g style={lbl}>
              <text
                x={valX}
                y={g.cy + 4.5}
                fontSize={desk ? 14 : 12.5}
                textAnchor="end"
                fill="var(--foreground)"
                fontWeight={800}
              >
                {tonnes(p.kg)}
                <tspan fontSize={11} fontWeight={600} fill="var(--muted-foreground)">
                  {"  "}
                  {pct(p.kg, line.plan)}
                </tspan>
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// One fault's days

function FaultDays({
  row,
  line,
  days,
  desk,
}: {
  row: FaultCostRow;
  line: LineCost;
  days: string[];
  desk: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const totalRef = useRef<HTMLElement>(null);
  const reduced = usePrefersReducedMotion();
  const W = desk ? 760 : 340;
  const H = desk ? 170 : 160;
  const L = 40;
  const R = 8;
  const T = 22;
  const B = 22;
  const n = days.length;
  const cw = (W - L - R) / n;
  const vals = days.map((d) => (row.byDay[d] ?? 0) * line.pace);
  const want = Math.max(1, ...vals) * 1.15;
  const raw = want / 4;
  const p10 = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p10;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p10;
  const top = Math.ceil(want / step) * step;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const ticks: number[] = [];
  for (let t = 0; t <= top + 1e-9; t += step) ticks.push(t);
  let wi = 0;
  vals.forEach((v, i) => {
    if (v > vals[wi]) wi = i;
  });
  const lab = `${dayLabel(days[wi])} · ${n0(vals[wi])} kg`;
  const lw = lab.length * 5.6 + 12;
  const lx = Math.min(Math.max(L + wi * cw + cw / 2 - lw / 2, L), W - R - lw);
  const labelIdx =
    n <= 1 ? [0] : [0, Math.round(n * 0.25), Math.round(n * 0.5), Math.round(n * 0.75), n - 1];
  const SWEEP = 1450;

  useEffect(() => {
    const svg = ref.current;
    const tot = totalRef.current;
    if (!svg || !tot || reduced) return;
    const anims: Animation[] = [];
    svg.querySelectorAll<SVGRectElement>(".fc-b").forEach((b) => {
      const i = Number(b.dataset.i);
      anims.push(
        b.animate(
          [
            { transform: "scaleY(0)" },
            { transform: "scaleY(1.08)", offset: 0.65 },
            { transform: "scaleY(1)" },
          ],
          {
            duration: 450,
            delay: (i / n) * SWEEP,
            easing: SPRING,
            fill: "backwards",
          },
        ),
      );
    });
    const scan = svg.querySelector<SVGRectElement>(".fc-scan")!;
    anims.push(
      scan.animate(
        [
          { transform: "translateX(0)", opacity: 1 },
          { opacity: 1, offset: 0.92 },
          { transform: `translateX(${W - R - L}px)`, opacity: 0 },
        ],
        { duration: SWEEP, fill: "forwards" },
      ),
    );
    const call = svg.querySelector<SVGGElement>(".fc-callout")!;
    anims.push(
      call.animate(
        [
          { transform: "scale(.2)", opacity: 0 },
          { transform: "scale(1.12)", opacity: 1, offset: 0.6 },
          { transform: "scale(1)" },
        ],
        {
          duration: 500,
          delay: (wi / n) * SWEEP + 150,
          easing: SPRING,
          fill: "backwards",
        },
      ),
    );
    const cum: number[] = [];
    let c = 0;
    vals.forEach((v) => cum.push((c += v)));
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const q = Math.min(1, (now - t0) / SWEEP);
      const i = Math.min(n - 1, Math.floor(q * n));
      tot.textContent = `${n0(q >= 1 ? row.kg : cum[i])} kg`;
      if (q < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      anims.forEach((a) => a.cancel());
      tot.textContent = `${n0(row.kg)} kg`;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.key, reduced, desk]);

  let worst = days[0];
  for (const d of days) if ((row.byDay[d] ?? 0) > (row.byDay[worst] ?? 0)) worst = d;
  const fact = (k: string, v: string) => (
    <div className="min-w-0 rounded-lg bg-muted px-2.5 py-2">
      <div className="text-[11px] text-muted-foreground">{k}</div>
      <div className="text-[13px] font-semibold tabular-nums">{v}</div>
    </div>
  );
  return (
    <div
      className="ds-slide-in flex flex-col gap-2.5 border-t border-border pt-3"
      data-testid="fault-cost-zoom"
    >
      <p className="text-xs text-muted-foreground [&_b]:text-foreground">
        <b>{row.title}</b> on {row.lineName}: <b>{n0(row.minutes)} min</b> stopped in {row.stops}{" "}
        stop
        {row.stops === 1 ? "" : "s"}. At {row.lineName}’s plan pace of {line.pace.toFixed(1)} kg a
        minute that is about <b ref={totalRef}>{n0(row.kg)} kg</b> of the plan,{" "}
        {pct(row.kg, line.plan)} of it.
      </p>
      <div className="grid items-start gap-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:gap-4">
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          role="img"
          aria-label={`${row.title}, kg lost per day`}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--border)" />
              <text
                x={L - 6}
                y={y(t) + 3.5}
                fontSize={10}
                textAnchor="end"
                fill="var(--muted-foreground)"
                className="font-mono"
              >
                {t >= 1000 ? `${+(t / 1000).toFixed(1)}t` : t}
              </text>
            </g>
          ))}
          {vals.map((v, i) =>
            v > 0 ? (
              <rect
                key={i}
                className="fc-b"
                data-i={i}
                x={L + i * cw + cw * 0.18}
                y={y(v)}
                width={Math.max(1, cw * 0.64)}
                height={Math.max(1.5, y(0) - y(v))}
                rx={1.5}
                fill="var(--destructive)"
                style={{ transformBox: "fill-box", transformOrigin: "bottom" }}
              >
                <title>{`${dayLabel(days[i])}: ${n0(v)} kg (${n0(row.byDay[days[i]] ?? 0)} min)`}</title>
              </rect>
            ) : null,
          )}
          <g
            className="fc-callout"
            style={{ transformBox: "fill-box", transformOrigin: "bottom center" }}
          >
            <rect
              x={lx}
              y={y(vals[wi]) - 21}
              width={lw}
              height={16}
              rx={8}
              fill="var(--foreground)"
            />
            <text
              x={lx + lw / 2}
              y={y(vals[wi]) - 10}
              fontSize={10}
              textAnchor="middle"
              fill="var(--card)"
              fontWeight={600}
            >
              {lab}
            </text>
          </g>
          <rect
            className="fc-scan"
            x={L}
            y={T}
            width={2}
            height={H - T - B}
            fill="var(--destructive)"
            opacity={reduced ? 0 : 1}
          />
          {labelIdx.map((i) => (
            <text
              key={i}
              x={L + i * cw + cw / 2}
              y={H - 6}
              fontSize={10}
              textAnchor="middle"
              fill="var(--muted-foreground)"
            >
              {dayLabel(days[i])}
            </text>
          ))}
        </svg>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
          {fact("kg lost", `${n0(row.kg)} kg`)}
          {fact("Time stopped", `${n0(row.minutes)} min`)}
          {fact("Stops", n0(row.stops))}
          {fact("Worst day", `${dayLabel(worst)} · ${n0((row.byDay[worst] ?? 0) * line.pace)} kg`)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function FaultCostCard({
  data,
  days,
  loading,
  error,
  layout,
  preferLineId,
}: {
  data: FaultCost | null;
  /** Every day of the period, oldest first (for the per-day chart). */
  days: string[];
  loading: boolean;
  error: boolean;
  layout: "phone" | "desktop";
  /** The page's line filter, picked first when it has a cost. */
  preferLineId: string | null;
}) {
  const desk = layout === "desktop";
  const titleId = `fault-cost-${layout}`;
  const priced = useMemo(() => (data ? data.lines.filter((l) => l.lostKg > 0) : []), [data]);
  const [picked, setPicked] = useState<string | null>(null);
  const [lens, setLens] = useState<"kg" | "time">("kg");
  const [open, setOpen] = useState<string | null>(null);
  const prevRank = useRef(new Map<string, number>());
  const counterRef = useRef<HTMLSpanElement>(null);

  const line =
    priced.find((l) => l.lineId === picked) ??
    priced.find((l) => l.lineId === preferLineId) ??
    priced[0] ??
    null;
  const pieces = useMemo(() => (line && data ? piecesOf(line, data.rows) : []), [line, data]);
  const ranked = useMemo(
    () =>
      data
        ? [...data.rows].sort((a, b) => (lens === "kg" ? b.kg - a.kg : b.minutes - a.minutes))
        : [],
    [data, lens],
  );
  const timeRank = useMemo(
    () =>
      new Map(
        (data ? [...data.rows].sort((a, b) => b.minutes - a.minutes) : []).map((r, i) => [
          r.key,
          i,
        ]),
      ),
    [data],
  );
  const moved = useMemo(() => {
    // The two rows that move the most between the lenses flash when you switch.
    if (lens !== "kg") return new Set<string>();
    return new Set(
      ranked
        .slice(0, SHOW)
        .map((r, i) => [r.key, Math.abs((timeRank.get(r.key) ?? i) - i)] as const)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([k]) => k),
    );
  }, [ranked, timeRank, lens]);
  useEffect(() => {
    prevRank.current = new Map(ranked.map((r, i) => [r.key, i]));
  }, [ranked]);

  const shell = (children: React.ReactNode) => (
    <section
      aria-labelledby={titleId}
      data-testid={`fault-cost-${layout}`}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-3.5 shadow-card md:gap-3.5 md:px-5 md:py-[18px]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={titleId} className="text-[15px] font-semibold md:text-base">
            What faults cost
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Where the plan went · machine faults at plan pace · preventive left out
          </p>
        </div>
        <ScopeChip>Follows the filters above</ScopeChip>
      </div>
      {children}
    </section>
  );

  if (error)
    return shell(
      <p className="text-sm text-destructive-strong">
        Couldn’t load the daily entries to price the faults.
      </p>,
    );
  if (loading || !data) return shell(<div className="ds-shimmer h-[260px] rounded-xl" />);
  if (!line)
    return shell(
      <p className="py-4 text-center text-sm text-muted-foreground" data-testid="fault-cost-empty">
        No fault stopped a line on a day with a daily entry in this view
        {data.unpricedMinutes > 0
          ? ` (${n0(data.unpricedMinutes)} min on days with no entry can’t be priced)`
          : ""}
        .
      </p>,
    );

  const maxV = lens === "kg" ? (ranked[0]?.kg ?? 1) : (ranked[0]?.minutes ?? 1);
  const openRow = data.rows.find((r) => r.key === open) ?? null;
  const openLine = openRow ? data.lines.find((l) => l.lineId === openRow.lineId) : null;

  return shell(
    <>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Line">
        {priced.map((l) => (
          <button
            key={l.lineId}
            type="button"
            aria-pressed={l.lineId === line.lineId}
            onClick={() => setPicked(l.lineId)}
            data-cost-line={l.name}
            className={cn(
              "ds-squish flex min-h-11 flex-col items-start gap-px rounded-xl border border-border bg-card px-3 py-2 text-left md:min-h-9",
              l.lineId === line.lineId && "border-foreground ring-1 ring-foreground",
            )}
          >
            <b className="text-[13px]">{l.name}</b>
            <span
              className={cn(
                "text-[11px] font-bold tabular-nums",
                l.lostKg / l.plan < 0.02 ? "text-muted-foreground" : "text-destructive-strong",
              )}
            >
              {tonnes(l.lostKg)} · {pct(l.lostKg, l.plan)} of plan
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-3.5">
        <div
          className="col-span-2 flex flex-col gap-0.5 rounded-xl border border-destructive/30 bg-gradient-to-br from-destructive/10 to-card to-75% px-3 py-2.5 md:col-span-1"
          data-testid="fault-cost-lost"
        >
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Lost to faults · {line.name}
          </span>
          <span className="text-[34px] leading-tight font-extrabold tracking-tight text-destructive-strong tabular-nums md:text-[40px]">
            <span ref={counterRef} className="inline-block">
              {tonnes(line.lostKg)}
            </span>
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {pct(line.lostKg, line.plan)} of the plan · {n0(line.lostMinutes)} min stopped ×{" "}
            {line.pace.toFixed(1)} kg a minute
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-xl border border-border px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <i className="inline-block h-2.5 w-2.5 rounded-sm bg-primary" />
            Made
          </span>
          <span className="text-[22px] font-extrabold tabular-nums md:text-[26px]">
            {tonnes(line.made)}
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {pct(line.made, line.plan)} of {tonnes(line.plan)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-xl border border-border px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <i className="inline-block h-2.5 w-2.5 rounded-sm border border-border bg-[repeating-linear-gradient(45deg,var(--muted)_0_3px,color-mix(in_oklch,var(--muted-foreground)_35%,transparent)_3px_5px)]" />
            Other losses
          </span>
          <span className="text-[22px] font-extrabold tabular-nums md:text-[26px]">
            {tonnes(line.otherKg)}
          </span>
          <span className="text-[11px] text-muted-foreground">entry stops, slower running</span>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-gradient-to-b from-muted/55 to-card to-40% px-2.5 pt-3 pb-1.5 md:px-[18px] md:pt-4 md:pb-2">
        <PlanHero
          key={line.lineId}
          line={line}
          pieces={pieces}
          desk={desk}
          counterRef={counterRef}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">
          Top {Math.min(SHOW, ranked.length)} faults{data.lines.length > 1 ? ", all lines" : ""}, by{" "}
          {lens === "kg" ? "kg lost" : "time lost"}
        </h3>
        <div role="group" aria-label="Rank by" className="flex rounded-lg bg-muted p-0.5">
          {(
            [
              ["kg", "kg lost"],
              ["time", "Time lost"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              aria-pressed={lens === k}
              onClick={() => setLens(k)}
              className={cn(
                "ds-squish h-11 rounded-md px-3.5 text-[13px] md:h-8 md:px-3 md:text-xs",
                lens === k ? "bg-card font-semibold shadow-sm" : "text-muted-foreground",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <ol
        className="relative"
        style={{ height: Math.min(SHOW, ranked.length) * ROW }}
        aria-label="Faults by cost"
      >
        {ranked.map((r, i) => {
          const shown = i < SHOW;
          const prev = prevRank.current.get(r.key) ?? i;
          const mv = (timeRank.get(r.key) ?? i) - i;
          const val = lens === "kg" ? r.kg : r.minutes;
          return (
            <li
              key={r.key}
              data-fault-row={r.title}
              aria-hidden={!shown}
              className="absolute inset-x-0 top-0"
              style={{
                transform: `translateY(${Math.min(i, SHOW) * ROW}px)`,
                opacity: shown ? 1 : 0,
                transition: `transform 700ms var(--ease-spring) ${Math.min(Math.abs(prev - i), 8) * 30}ms, opacity 300ms ease`,
              }}
            >
              <button
                key={lens}
                type="button"
                tabIndex={shown ? 0 : -1}
                aria-pressed={open === r.key}
                onClick={() => setOpen(open === r.key ? null : r.key)}
                className={cn(
                  "grid min-h-11 w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 rounded-lg border border-transparent px-2 py-1.5 text-left hover:bg-muted",
                  "md:grid-cols-[26px_minmax(0,260px)_minmax(0,1fr)_220px]",
                  open === r.key && "border-border bg-muted",
                )}
                style={
                  moved.has(r.key) && shown
                    ? { animation: "ds-pulse-warn 1100ms ease-out 350ms 1" }
                    : undefined
                }
              >
                <span
                  key={`r${lens}`}
                  className="ds-pop-in text-right font-mono text-xs text-muted-foreground"
                >
                  {i + 1}
                  {lens === "kg" && mv !== 0 && shown && (
                    <span
                      title={`${Math.abs(mv)} ${Math.abs(mv) === 1 ? "place" : "places"} ${mv > 0 ? "higher" : "lower"} than by time lost`}
                      className={cn(
                        "ml-0.5 text-[10px] font-bold",
                        mv > 0 ? "text-destructive-strong" : "text-success-strong",
                      )}
                    >
                      {mv > 0 ? "↑" : "↓"}
                      {Math.abs(mv)}
                    </span>
                  )}
                </span>
                <span className="min-w-0 truncate text-[13px] font-semibold">
                  {r.title}{" "}
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {r.lineName}
                  </span>
                </span>
                <span className="col-span-2 col-start-2 block h-[7px] overflow-hidden rounded-full bg-muted md:col-span-1 md:col-start-3 md:row-start-1">
                  <span
                    className={cn(
                      "block h-full rounded-full transition-[width] duration-700 ease-[var(--ease-spring)]",
                      lens === "kg" ? "bg-destructive" : "bg-primary",
                    )}
                    style={{ width: `${(val / maxV) * 100}%` }}
                  />
                </span>
                <span
                  key={`v${lens}`}
                  className="ds-pop-in col-start-3 row-start-1 text-right text-xs whitespace-nowrap tabular-nums text-muted-foreground md:col-start-4"
                >
                  {lens === "kg" ? (
                    <>
                      <b className="text-[13px] text-foreground">{tonnes(r.kg)}</b> ·{" "}
                      {n0(r.minutes)} min
                    </>
                  ) : (
                    <>
                      <b className="text-[13px] text-foreground">{n0(r.minutes)} min</b> ·{" "}
                      {tonnes(r.kg)}
                    </>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {openRow && openLine && (
        <FaultDays key={openRow.key} row={openRow} line={openLine} days={days} desk={desk} />
      )}
      <p className="text-[11px] text-muted-foreground">
        ⓘ Plan pace = the line’s making plan ÷ its available minutes, on the days with a daily entry
        in this view. kg lost = fault minutes × plan pace. Plan = made + faults + other losses. A
        stoppage counts once; a fault where the line kept running counts 0. An estimate, not a
        weighed loss.
        {data.unpricedMinutes > 0 &&
          ` ${n0(data.unpricedMinutes)} fault minutes fell on days with no daily entry and are not priced.`}
      </p>
    </>,
  );
}
