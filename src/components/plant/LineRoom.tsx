// The Plant floor's line room (/plant/$lineId): one line's period as the
// approved "Jammy Control Room" mockup draws it. Tanks for the four KPI tiles,
// making per day that morphs to cumulative, where the OEE goes, a paragraph
// written from the numbers, and the packing machines by shift (or the fault
// minutes per day for a line without machines). Every figure comes from the
// Dashboard's own maths (useLinePeriod › periodNumbers, kpiTiles, lineOee).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Odometer } from "@/components/motion";
import type { KpiTileProps } from "@/components/dashboard/KpiTiles";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { eachDay, formatDayShort, type DayPoint, type ReasonRow } from "@/lib/dashboard-metrics";
import { isFault, type MachineStop } from "@/lib/machine-downtime";
import type { LineOeeResult } from "@/lib/line-oee";
import { lineQuality, oeeTone } from "@/lib/oee";
import { machineRunsQuery, type PackingMachine } from "@/lib/packing";
import {
  computeShiftOee,
  lastRunDayQuery,
  SHIFT_HOURS,
  shiftEventsQuery,
  type ShiftOee,
} from "@/lib/shift-oee";
import type { DailyEntry, MaintenanceStoppage } from "@/lib/queries";
import { cn } from "@/lib/utils";

const kg = (n: number) => Math.round(n).toLocaleString("en-US");
const WAVE = "M0 10 C50 0 50 0 100 10 S150 20 200 10 S250 0 300 10 S350 20 400 10 V20 H0Z";
const TONE: Record<KpiTileProps["tone"], string> = {
  success: "pf-t-good",
  warning: "pf-t-warn",
  danger: "pf-t-bad",
  neutral: "pf-t-none",
};

/** Adds "on" a frame after mount, so CSS transitions run from their start. */
function useArmed(deps: unknown[] = []): boolean {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return on;
}

function Tank({ level, target, tone }: { level: number; target: number | null; tone: string }) {
  const on = useArmed();
  return (
    <div className={cn("pf-tank", tone)} aria-hidden="true">
      <div
        className={cn("pf-liq", on && "on")}
        style={{ "--lvl": Math.max(0, Math.min(100, level)) } as React.CSSProperties}
      >
        <svg className="pf-wv" viewBox="0 0 400 20" preserveAspectRatio="none">
          <path d={WAVE} />
        </svg>
        <svg className="pf-wv b" viewBox="0 0 400 20" preserveAspectRatio="none">
          <path d={WAVE} />
        </svg>
        <div className="pf-body">
          <span className="pf-bub" />
          <span className="pf-bub" />
          <span className="pf-bub" />
        </div>
      </div>
      {target != null && (
        <u className="pf-tg" style={{ "--tgt": Math.min(96, target) } as React.CSSProperties} />
      )}
    </div>
  );
}

/**
 * The four KPI tiles as tanks. Making and Packing fill to their % of plan with
 * the target line where it is; Time lost and Rework are small numbers, so
 * their tanks are scaled to put the alert / limit at 40% of the height.
 */
export function Tanks({ tiles }: { tiles: KpiTileProps[] }) {
  return (
    <div className="pf-grid pf-g4">
      {tiles.map((t, i) => {
        const v = t.value;
        const tg = t.targetPct ?? null;
        const scaled = t.title === "Time lost" || t.title === "Rework";
        const k = scaled && tg ? 40 / tg : 1;
        return (
          <section
            key={t.title}
            className="pf-card"
            style={{ "--i": i } as React.CSSProperties}
            data-tank={t.title}
          >
            <h2>
              {t.title} <small>{t.target}</small>
            </h2>
            <div className="pf-big pf-num">
              {v == null ? (
                "—"
              ) : (
                <>
                  <Odometer value={v} decimals={1} delay={i * 90} />
                  <small>%</small>
                </>
              )}
            </div>
            <div className="pf-sub">
              <span className="pf-wide">{t.detail}</span>
              <span className="pf-narrow">{t.mobileDetail ?? t.detail}</span>
            </div>
            <Tank
              level={v == null ? 0 : v * k}
              target={tg == null ? null : tg * k}
              tone={TONE[t.tone]}
            />
            <div style={{ marginTop: 9 }}>
              <span className={cn("pf-tag pf-wide", TONE[t.tone])}>{t.status}</span>
              <span className={cn("pf-tag pf-narrow", TONE[t.tone])}>
                {t.mobileStatus ?? t.status}
              </span>
            </div>
          </section>
        );
      })}
    </div>
  );
}

// --- Making per day, daily ↔ cumulative --------------------------------------

// Drawn at the card's real width (one unit = one pixel), so a phone gets a
// full-height chart with readable labels instead of a scaled-down one.
type Dims = { W: number; H: number; L: number; R: number; T: number; B: number };
const dims = (W: number): Dims => ({ W, H: W < 480 ? 220 : 240, L: 4, R: 4, T: 22, B: 24 });
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

interface Bar {
  x: number;
  w: number;
  cx: number;
  y: number;
  h: number;
  py: number | null;
  day: string;
  v: number | null;
  plan: number | null;
  cum: number;
  cumPlan: number;
  low: boolean;
}

function geometry(points: DayPoint[], s: number, target: number, CH: Dims): Bar[] {
  const n = Math.max(1, points.length);
  const bw = (CH.W - CH.L - CH.R) / n;
  const ph = CH.H - CH.T - CH.B;
  let cum = 0;
  let cumPlan = 0;
  const rows = points.map((p) => {
    cum += p.actual ?? 0;
    cumPlan += p.plan ?? 0;
    return { p, cum, cumPlan };
  });
  const dayMax = Math.max(1, ...points.map((p) => Math.max(p.actual ?? 0, p.plan ?? 0))) * 1.08;
  const cumMax = Math.max(1, cum, cumPlan) * 1.04;
  return rows.map(({ p, cum, cumPlan }, i) => {
    const hd = (p.actual ?? 0) / dayMax;
    const hc = cum / cumMax;
    const h = lerp(hd, hc, s);
    const pd = p.plan != null ? p.plan / dayMax : null;
    const pc = cumPlan / cumMax;
    const pp = pd == null ? (s > 0.5 ? pc : null) : lerp(pd, pc, s);
    return {
      x: CH.L + i * bw + bw * 0.14,
      w: bw * 0.72,
      cx: CH.L + i * bw + bw / 2,
      y: CH.T + ph * (1 - h),
      h: ph * h,
      py: pp == null ? null : CH.T + ph * (1 - pp),
      day: p.day,
      v: p.actual,
      plan: p.plan,
      cum,
      cumPlan,
      low: p.plan != null && p.plan > 0 && (p.actual ?? 0) / p.plan < target / 100,
    };
  });
}

export function MakingChart({
  points,
  color,
  target,
}: {
  points: DayPoint[];
  color: string;
  /** Making target, %: days under it are drawn amber. */
  target: number;
}) {
  const reduced = usePrefersReducedMotion();
  const [mode, setMode] = useState<0 | 1>(0);
  const [s, setS] = useState(0);
  const [grown, setGrown] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const raf = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const segRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ x: 0, w: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(260, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const CH = useMemo(() => dims(width), [width]);
  const g = useMemo(() => geometry(points, s, target, CH), [points, s, target, CH]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    const b = segRef.current?.querySelectorAll("button")[mode] as HTMLElement | undefined;
    if (b) setThumb({ x: b.offsetLeft, w: b.offsetWidth });
  }, [mode]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const morph = (to: 0 | 1) => {
    setMode(to);
    cancelAnimationFrame(raf.current);
    if (reduced) return setS(to);
    const from = s;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 650);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      setS(lerp(from, to, e));
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  const onMove = (e: React.PointerEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || g.length === 0) return;
    const x = ((e.clientX - r.left) / r.width) * CH.W;
    let bi = 0;
    let bd = Infinity;
    g.forEach((b, i) => {
      const d = Math.abs(b.cx - x);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    setHover(bi);
  };

  const planPath = g
    .map((b, i) =>
      b.py == null
        ? null
        : { x: i === 0 ? CH.L : i === g.length - 1 ? CH.W - CH.R : b.cx, y: b.py },
    )
    .reduce<string>((d, pt, i, arr) => {
      if (!pt) return d;
      const prev = i > 0 ? arr[i - 1] : null;
      return `${d}${prev ? "L" : "M"}${pt.x} ${pt.y} `;
    }, "");
  const label = (day: string) => String(Number(day.slice(8)));
  const every = Math.ceil(g.length / Math.max(4, Math.floor(CH.W / 46)));
  const hb = hover == null ? null : g[hover];
  const ph = CH.H - CH.T - CH.B;

  return (
    <section className="pf-card" style={{ "--i": 4 } as React.CSSProperties}>
      <h2>
        Making
        <div className="pf-seg" ref={segRef} role="group" aria-label="Chart">
          <span
            className="thumb"
            style={{ width: thumb.w, transform: `translateX(${thumb.x - 3}px)` }}
            aria-hidden="true"
          />
          <button type="button" aria-pressed={mode === 0} onClick={() => morph(0)}>
            Daily
          </button>
          <button type="button" aria-pressed={mode === 1} onClick={() => morph(1)}>
            Cumulative
          </button>
        </div>
      </h2>
      <div
        className="pf-chart"
        ref={boxRef}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${CH.W} ${CH.H}`}
          role="img"
          aria-label={
            mode === 0 ? "Making per day against plan" : "Making so far against the plan so far"
          }
        >
          <defs>
            <linearGradient id="pf-gb" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} />
              <stop offset="1" stopColor={color} stopOpacity=".45" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1={CH.L}
              x2={CH.W - CH.R}
              y1={CH.T + ph * (1 - f)}
              y2={CH.T + ph * (1 - f)}
              stroke="var(--pf-stroke)"
            />
          ))}
          {g.map((b, i) => (
            <g key={b.day}>
              <rect
                x={b.x}
                y={b.v == null && s < 0.5 ? CH.H - CH.B - 3 : b.y}
                width={b.w}
                height={b.v == null && s < 0.5 ? 3 : Math.max(0, b.h)}
                rx={Math.min(7, b.w / 3)}
                fill={
                  b.v == null && s < 0.5
                    ? "var(--pf-stroke)"
                    : b.low && s < 0.5
                      ? "var(--pf-warn)"
                      : "url(#pf-gb)"
                }
                opacity={hover == null || hover === i ? 1 : 0.45}
                style={{
                  transformBox: "fill-box",
                  transformOrigin: "bottom",
                  transform: grown || reduced ? "scaleY(1)" : "scaleY(0)",
                  transition: reduced
                    ? undefined
                    : `transform .9s cubic-bezier(.34,1.56,.64,1) ${Math.min(i, 30) * 30 + 150}ms`,
                }}
              />
              {i % every === 0 && (
                <text x={b.cx} y={CH.H - 7} textAnchor="middle">
                  {label(b.day)}
                </text>
              )}
            </g>
          ))}
          {planPath && (
            <path
              d={planPath}
              fill="none"
              stroke="var(--pf-ink)"
              strokeOpacity=".7"
              strokeWidth="2"
              strokeDasharray="6 5"
            />
          )}
        </svg>
        {hb && (
          <div
            className="pf-tip show pf-num"
            style={{
              left: `${Math.max(14, Math.min(86, (hb.cx / CH.W) * 100))}%`,
              transform: "translateX(-50%)",
            }}
          >
            {formatDayShort(hb.day)} ·{" "}
            {mode === 0
              ? hb.v == null
                ? "no entry"
                : `${kg(hb.v)} kg`
              : `${kg(hb.cum)} kg so far`}
            <br />
            <span>
              {mode === 0
                ? hb.plan
                  ? `${Math.round(((hb.v ?? 0) / hb.plan) * 100)}% of ${kg(hb.plan)} kg plan`
                  : "no plan"
                : `plan by then ${kg(hb.cumPlan)} kg`}
            </span>
          </div>
        )}
      </div>
      <p className="pf-sub" style={{ margin: "6px 0 0" }}>
        Dashed line: the plan. Amber: a day under the {target}% target.
      </p>
    </section>
  );
}

// --- Where the OEE goes ------------------------------------------------------

export function OeeWaterfall({
  oee,
  color,
  hasCapacity,
}: {
  oee: LineOeeResult | null;
  color: string;
  hasCapacity: boolean;
}) {
  const [note, setNote] = useState<string | null>(null);
  const ready = !!oee && oee.A != null && oee.P != null && oee.Q != null;
  const on = useArmed([ready]);
  if (!ready || !oee) {
    return (
      <section className="pf-card" style={{ "--i": 5 } as React.CSSProperties}>
        <h2>
          Where the OEE goes <small>from 100% down</small>
        </h2>
        <p className="pf-empty">
          {hasCapacity
            ? "No entry in this period has a making capacity on its day, so there is no OEE yet."
            : "This line has no making capacity set (Settings › Production lines), so its OEE can't be worked out."}
        </p>
      </section>
    );
  }
  const A = oee.A as number;
  const P = oee.P as number;
  const Q = oee.Q as number;
  // Bars stop at 100%: a line over its capacity has no performance loss to draw.
  const a = A * 100;
  const ap = a * Math.min(1, P);
  const apq = ap * Q;
  const pc = (n: number) => `${n.toFixed(1)}`;
  const steps = [
    {
      name: "Planned",
      b: 0,
      h: 100,
      k: "var(--pf-muted)",
      o: "bottom",
      v: "100",
      loss: false,
      say: `All the minutes the entries made available: ${kg(oee.availableMin)} min.`,
    },
    {
      name: "Availability",
      b: a,
      h: 100 - a,
      k: "var(--pf-bad)",
      o: "top",
      v: `−${pc(100 - a)}`,
      loss: true,
      say: `Stops took ${pc(100 - a)} points: ${kg(oee.lostMin)} min lost (entry downtime plus maintenance stops).`,
    },
    {
      name: "Performance",
      b: ap,
      h: a - ap,
      k: "var(--pf-warn)",
      o: "top",
      v: `−${pc(a - ap)}`,
      loss: true,
      say:
        P > 1
          ? `While running, the line made ${(P * 100).toFixed(1)}% of what its capacity allows: more than the capacity in Settings, so no loss is drawn here.`
          : `While running, the line made ${(P * 100).toFixed(1)}% of what its capacity allows.`,
    },
    {
      name: "Quality",
      b: apq,
      h: ap - apq,
      k: "var(--pf-candy)",
      o: "top",
      v: `−${pc(ap - apq)}`,
      loss: true,
      say: `Rework took ${pc(ap - apq)} points: ${kg(oee.reworkKg)} kg of ${kg(oee.madeKg)} kg made.`,
    },
    {
      name: "OEE",
      b: 0,
      h: apq,
      k: color,
      o: "bottom",
      v: `${((oee.oee as number) * 100).toFixed(1)}%`,
      loss: false,
      say: `What is left: ${((oee.oee as number) * 100).toFixed(1)}% of the planned time made good product at full speed.`,
    },
  ];
  return (
    <section className="pf-card" style={{ "--i": 5 } as React.CSSProperties}>
      <h2>
        Where the OEE goes <small>from 100% down</small>
      </h2>
      <div className={cn("pf-wf", on && "on")} onPointerLeave={() => setNote(null)}>
        {steps.map((w, i) => (
          <button
            key={w.name}
            type="button"
            className="pf-wc"
            onPointerEnter={() => setNote(w.say)}
            onFocus={() => setNote(w.say)}
            onBlur={() => setNote(null)}
            aria-label={`${w.name}: ${w.v}. ${w.say}`}
            style={
              {
                "--i": i,
                "--b": Math.max(0, w.b),
                "--h": Math.max(0, w.h),
                "--k": w.k,
                "--o": w.o,
              } as React.CSSProperties
            }
          >
            <span className="area">
              <span className={cn("bar", w.loss && "loss")} />
              <span className="v pf-num">{w.v}</span>
            </span>
            <span>{w.name}</span>
          </button>
        ))}
      </div>
      <p className="pf-sub" style={{ margin: "8px 0 0", minHeight: "2.6em" }} aria-live="polite">
        {note ?? "Point at a step to see what it means."}
        {oee.skipped > 0 && !note
          ? ` ${oee.skipped} entr${oee.skipped === 1 ? "y" : "ies"} without a capacity left out.`
          : ""}
      </p>
    </section>
  );
}

// --- Reading the line --------------------------------------------------------

const KIND_COLOR: Record<ReasonRow["kind"], string> = {
  unplanned: "var(--pf-bad)",
  planned: "var(--pf-pri)",
  unclassified: "var(--pf-muted)",
};

export function ReadingCard({ text, reasons }: { text: string; reasons: ReasonRow[] }) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduced ? text.length : 0);
  useEffect(() => {
    if (reduced) {
      setShown(text.length);
      return;
    }
    setShown(0);
    let i = 0;
    const id = setInterval(() => {
      i += 2;
      setShown(i);
      if (i >= text.length) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [text, reduced]);
  const top = reasons.filter((r) => r.minutes > 0).slice(0, 5);
  const max = top[0]?.minutes ?? 1;
  const on = useArmed([text]);
  return (
    <section className="pf-card" style={{ "--i": 6 } as React.CSSProperties}>
      <h2>
        Reading the line <small>written from the numbers</small>
      </h2>
      {/* The whole paragraph for screen readers; the typing is decoration. */}
      <p className="sr-only">{text}</p>
      <p className={cn("pf-typed", shown < text.length && "typing")} aria-hidden="true">
        {text.slice(0, shown)}
      </p>
      <div className={cn("pf-reasons", on && "on")}>
        {top.length === 0 ? (
          <p className="pf-sub" style={{ marginTop: 10 }}>
            No downtime recorded in this period.
          </p>
        ) : (
          top.map((r, i) => (
            <div key={r.key} className="pf-hbar">
              <span title={r.name}>{r.name}</span>
              <b className="pf-num">{Math.round(r.minutes).toLocaleString("en-US")} min</b>
              <span className="t">
                <i
                  style={
                    {
                      "--w": `${(r.minutes / max) * 100}%`,
                      "--i": i,
                      "--k": KIND_COLOR[r.kind],
                    } as React.CSSProperties
                  }
                />
              </span>
            </div>
          ))
        )}
      </div>
      {top.length > 0 && (
        <div className="pf-legend">
          <span style={{ "--k": "var(--pf-bad)" } as React.CSSProperties}>unplanned</span>
          <span style={{ "--k": "var(--pf-pri)" } as React.CSSProperties}>planned</span>
          <span style={{ "--k": "var(--pf-muted)" } as React.CSSProperties}>unclassified</span>
        </div>
      )}
    </section>
  );
}

// --- Packing machines by shift (lines with machines) ------------------------

const SHIFT_TONE: Record<string, string> = {
  good: "var(--pf-good)",
  warn: "var(--pf-warn)",
  bad: "var(--pf-bad)",
  none: "var(--pf-muted)",
};

/** The same data as the Dashboard's "Last machine sheet" (ShiftOeeCards). */
function useShiftOee(
  lineId: string,
  machines: PackingMachine[],
  from: string,
  to: string,
  entries: DailyEntry[],
  stoppages: MaintenanceStoppage[],
): { loading: boolean; data: ShiftOee | null } {
  const machineIds = useMemo(() => machines.map((m) => m.id), [machines]);
  const dayQ = useQuery(lastRunDayQuery(machineIds, from, to));
  const day = dayQ.data ?? null;
  const runsQ = useQuery({ ...machineRunsQuery(day ?? ""), enabled: !!day });
  const eventsQ = useQuery({ ...shiftEventsQuery(lineId, machineIds, day ?? ""), enabled: !!day });
  const data = useMemo(() => {
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
  return { loading: dayQ.isPending || (!!day && (runsQ.isPending || eventsQ.isPending)), data };
}

export function ShiftRings(props: {
  lineId: string;
  machines: PackingMachine[];
  from: string;
  to: string;
  entries: DailyEntry[];
  stoppages: MaintenanceStoppage[];
}) {
  const { loading, data } = useShiftOee(
    props.lineId,
    props.machines,
    props.from,
    props.to,
    props.entries,
    props.stoppages,
  );
  const on = useArmed([data?.day]);
  const has = !!data && !data.shifts.every((s) => s.cells.length === 0);
  const worst = has
    ? [...data!.shifts]
        .filter((s) => s.oee != null && s.cells.length > 0)
        .sort((a, b) => (a.oee ?? 0) - (b.oee ?? 0))[0]
    : null;
  return (
    <section className="pf-card" style={{ "--i": 7 } as React.CSSProperties}>
      <h2>
        Packing machines by shift{" "}
        <small>
          {has
            ? `last sheet · ${new Date(`${data!.day}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`
            : "last sheet"}
        </small>
      </h2>
      {loading ? (
        <div className="pf-skel" style={{ marginTop: 10, height: 110 }} />
      ) : !has ? (
        <p className="pf-empty">No machine sheet in this period.</p>
      ) : (
        <>
          <div className="pf-shifts">
            {data!.shifts.map((s) => {
              const tone = s.oee != null && s.oee > 1 ? "warn" : oeeTone(s.oee);
              const v = s.oee == null ? null : Math.round(s.oee * 100);
              return (
                <div
                  key={s.shift}
                  className="pf-shift"
                  style={{ "--tc": SHIFT_TONE[tone] } as React.CSSProperties}
                >
                  <svg viewBox="0 0 60 60" width="62" height="62" aria-hidden="true">
                    <circle
                      className="bg"
                      cx="30"
                      cy="30"
                      r="24"
                      strokeWidth="6"
                      pathLength={100}
                    />
                    <circle
                      className="fg"
                      cx="30"
                      cy="30"
                      r="24"
                      strokeWidth="6"
                      pathLength={100}
                      style={{ "--p": on ? Math.min(100, v ?? 0) : 0 } as React.CSSProperties}
                    />
                  </svg>
                  <b className="pf-num" style={{ color: SHIFT_TONE[tone] }}>
                    {v == null ? "—" : `${v}%`}
                  </b>
                  <span className="pf-sub">
                    {s.shift} · {SHIFT_HOURS[s.shift]}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="pf-sub" style={{ margin: "10px 0 0" }}>
            {worst
              ? `Shift ${worst.shift} is the lowest at ${Math.round((worst.oee ?? 0) * 100)}% OEE${data!.Q == null ? " (quality pending: no entry for that day yet)" : ""}.`
              : "OEE of the packing machines, by shift."}
          </p>
        </>
      )}
    </section>
  );
}

// --- Fault minutes per day (lines without machines) -------------------------

export function StopsPerDay({
  stops,
  from,
  to,
  entryDays,
}: {
  stops: MachineStop[];
  from: string;
  to: string;
  entryDays: Set<string>;
}) {
  const days = eachDay(from, to);
  const by = new Map<string, { min: number; n: number }>();
  let open = 0;
  for (const st of stops) {
    if (!isFault(st.type) || st.keptRunning) continue;
    // An open stop has no time lost yet (it counts once it is closed).
    if (st.open) {
      open++;
      continue;
    }
    const cur = by.get(st.day) ?? { min: 0, n: 0 };
    cur.min += st.minutes;
    cur.n += 1;
    by.set(st.day, cur);
  }
  const max = Math.max(1, ...[...by.values()].map((v) => v.min));
  const total = [...by.values()].reduce((a, v) => a + v.min, 0);
  const count = [...by.values()].reduce((a, v) => a + v.n, 0);
  const worst = [...by.entries()].sort((a, b) => b[1].min - a[1].min)[0];
  const on = useArmed([from, to]);
  return (
    <section className="pf-card" style={{ "--i": 7 } as React.CSSProperties}>
      <h2>
        Fault stops per day <small>from Maintenance</small>
      </h2>
      <div className={cn("pf-days", on && "on")} role="img" aria-label="Fault minutes per day">
        {days.map((d, i) => {
          const v = by.get(d);
          return (
            <span
              key={d}
              title={`${formatDayShort(d)}: ${v ? `${Math.round(v.min)} min, ${v.n} stop${v.n === 1 ? "" : "s"}` : "no fault stop"}${entryDays.has(d) ? "" : " · no entry"}`}
            >
              <i
                className={v && v.min > 0 ? undefined : "zero"}
                style={{ "--h": v ? (v.min / max) * 100 : 0, "--i": i } as React.CSSProperties}
              />
            </span>
          );
        })}
      </div>
      <div className="pf-axis pf-num" aria-hidden="true">
        <span>{formatDayShort(days[0] ?? from)}</span>
        <span>{formatDayShort(days[days.length - 1] ?? to)}</span>
      </div>
      <p className="pf-sub" style={{ margin: "10px 0 0" }}>
        {count === 0
          ? `No closed fault stop in this period${open ? `; ${open} still open` : ""}.`
          : `${count} fault stop${count === 1 ? "" : "s"}, ${Math.round(total).toLocaleString("en-US")} min in all${worst ? `; the worst day was ${formatDayShort(worst[0])} with ${Math.round(worst[1].min)} min` : ""}${open ? `; ${open} still open` : ""}.`}
      </p>
    </section>
  );
}
