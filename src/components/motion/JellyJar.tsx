import * as React from "react";

import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

import { CANDY, GummyBearShape } from "./GummyBear";
import { useSpring } from "./useSpring";

export type JarMood = "saving" | "error" | "party";

export interface JellyJarProps {
  /** Actual as % of plan. null = no valid number yet. */
  pct: number | null;
  /** Target %, drawn as the dashed line. Crossing it pops the lid. */
  target: number;
  /** Overrides the face: looking at Save, surprised, or celebrating. */
  mood?: JarMood;
  /** Printed on the jar's label, e.g. the line name. */
  labelText?: string;
  /** Increment to replay the lid pop + hop (e.g. after saving at target). */
  celebrateKey?: number;
  /** Rendered width/height in px. */
  size?: number;
  className?: string;
}

// Jar geometry in a 300×300 viewBox. Inside of the jar: x 60–240, y 64–282.
const BOTTOM = 282;
const SPAN = 196; // px of jar per 100%
const yOf = (pct: number) => BOTTOM - (pct / 100) * SPAN;

const BEAR_SPOTS: Array<[number, number]> = [
  [84, 262],
  [118, 264],
  [152, 262],
  [186, 264],
  [218, 262],
  [100, 238],
  [134, 240],
  [168, 238],
  [202, 240],
  [80, 214],
  [216, 214],
  [84, 188],
  [218, 188],
  [80, 162],
  [218, 162],
  [96, 138],
  [130, 134],
  [166, 136],
  [202, 138],
  [80, 112],
  [114, 108],
  [150, 110],
  [186, 108],
  [218, 112],
  [100, 86],
  [200, 86],
];

let WAVE = "M-120 0";
for (let x = -120, i = 0; x < 420; x += 45, i++) {
  WAVE += i === 0 ? ` Q${x + 22.5} -7 ${x + 45} 0` : ` T${x + 45} 0`;
}
WAVE += " V26 H-120 Z";

const MOUTHS: Record<string, { d: string; filled: boolean }> = {
  party: { d: "M134 190 Q150 216 166 190 Z", filled: true },
  happy: { d: "M137 192 Q150 210 163 192 Z", filled: true },
  ok: { d: "M140 197 Q150 205 160 197", filled: false },
  sad: { d: "M140 204 Q150 195 160 204", filled: false },
  saving: { d: "M142 200 L158 200", filled: false },
  error: { d: "M150 194 C156 194 156 206 150 206 C144 206 144 194 150 194 Z", filled: true },
};
const BROWS: Record<string, [string, string] | undefined> = {
  sad: ["M124 162 L140 158", "M160 158 L176 162"],
  error: ["M125 156 Q133 150 141 156", "M159 156 Q167 150 175 156"],
  saving: ["M125 161 L141 161", "M159 161 L175 161"],
};

/**
 * Progress to target as a jar of jelly. A real spring fills it (it sloshes,
 * the surface tilts with speed), gummy bears pop in as the jelly reaches
 * them, the colour follows the band (below 70 / below target / at target),
 * and crossing the dashed target line pops the lid. The face on the label
 * follows the mouse and shows the mood.
 */
export function JellyJar({
  pct,
  target,
  mood,
  labelText = "",
  celebrateKey = 0,
  size = 220,
  className,
}: JellyJarProps) {
  const reduced = usePrefersReducedMotion();
  const id = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const goal = pct == null ? 0 : Math.max(0, Math.min(112, pct));
  const { value, velocity } = useSpring(goal, { delay: 250 });

  // Lid pop + hop when the target line is crossed upward, or on demand.
  const [pop, setPop] = React.useState(0);
  // No number yet (null) is "unknown", not "below": a day that loads at
  // target, or a first valid number, is not a crossing.
  const wasAt = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    const at = pct != null && pct >= target;
    if (wasAt.current === false && at) setPop((n) => n + 1);
    wasAt.current = pct == null ? null : at;
  }, [pct, target]);
  // Only a change replays it — mounting with a non-zero key (the jar remounts
  // when another entry opens) must not celebrate.
  const lastCelebrate = React.useRef(celebrateKey);
  React.useEffect(() => {
    if (celebrateKey === lastCelebrate.current) return;
    lastCelebrate.current = celebrateKey;
    if (celebrateKey > 0) setPop((n) => n + 1);
  }, [celebrateKey]);

  // Eyes follow a mouse pointer anywhere on the page.
  const eyesRef = React.useRef<SVGGElement>(null);
  const [look, setLook] = React.useState({ x: 0, y: 0 });
  React.useEffect(() => {
    if (reduced || typeof window === "undefined") return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let frame: number | null = null;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || frame != null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const el = eyesRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height * 0.36);
        const d = Math.hypot(dx, dy) || 1;
        const m = Math.min(4.2, d / 28);
        setLook({ x: (dx / d) * m, y: (dy / d) * m });
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [reduced]);

  const lvl = Math.max(0, Math.min(112, value));
  const lvlY = yOf(lvl);
  const amp = 1 + Math.min(2.4, Math.abs(velocity) / 45);
  const rot = Math.max(-9, Math.min(9, velocity * 0.05));
  // Same bands as the app (adherenceColor): amber from target − 20 points.
  const band = pct == null ? "none" : pct >= target ? "good" : pct >= target - 20 ? "warn" : "bad";
  const tone =
    band === "good"
      ? "var(--success)"
      : band === "warn"
        ? "var(--warning)"
        : band === "bad"
          ? "var(--destructive)"
          : "var(--muted-foreground)";
  const face =
    mood ?? (band === "good" ? "happy" : band === "warn" ? "ok" : band === "bad" ? "sad" : "ok");
  const happy = face === "happy" || face === "party";
  const mouth = MOUTHS[face];
  const brows = BROWS[face];
  const pupil = face === "saving" ? { x: 2.4, y: 3.6 } : look;
  const targetY = yOf(Math.min(112, target));
  // At most 12 letters fit the label; cut at a word ("Packing Machines" →
  // "PACKING", not "PACKING MACH").
  const upper = labelText.trim().toUpperCase();
  const cut = upper.lastIndexOf(" ", 12);
  const label = upper.length <= 12 ? upper : upper.slice(0, cut > 0 ? cut : 12);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 300 300"
      role="img"
      data-mood={face}
      aria-label={
        pct == null
          ? `Jar is empty — no valid actual yet. Target ${target}%.`
          : `Jar filled to ${pct.toFixed(1)}% of plan. The dashed line is the ${target}% target.`
      }
      className={cn("shrink-0 overflow-visible", className)}
    >
      <defs>
        <clipPath id={`jar${id}`}>
          <rect x="60" y="64" width="180" height="218" rx="34" />
        </clipPath>
        <clipPath id={`jel${id}`}>
          <rect x="60" y={lvlY - 2} width="180" height="260" />
        </clipPath>
      </defs>
      <ellipse
        cx="150"
        cy="292"
        rx="92"
        ry="7"
        style={{ fill: "var(--foreground)" }}
        opacity="0.08"
      />
      <g
        key={`hop${pop}`}
        style={{
          transformBox: "fill-box",
          transformOrigin: "50% 100%",
          animation: pop ? "ds-hop 820ms var(--ease-out-soft)" : undefined,
        }}
      >
        <g
          style={{
            transformBox: "fill-box",
            transformOrigin: "50% 100%",
            animation: pop ? "ds-lid-pop 900ms var(--ease-out-soft) 120ms" : undefined,
          }}
        >
          <rect
            x="78"
            y="16"
            width="144"
            height="28"
            rx="10"
            style={{ fill: "var(--destructive)" }}
          />
          <rect
            x="78"
            y="16"
            width="144"
            height="9"
            rx="6"
            style={{ fill: "color-mix(in oklch, var(--destructive) 60%, white)" }}
          />
          {[96, 124, 152, 180].map((x) => (
            <rect key={x} x={x} y="30" width="10" height="10" rx="3" fill="white" opacity="0.35" />
          ))}
        </g>
        <rect x="86" y="42" width="128" height="18" rx="5" style={{ fill: "var(--muted)" }} />
        <rect
          x="54"
          y="58"
          width="192"
          height="230"
          rx="40"
          strokeWidth="3"
          style={{
            fill: "color-mix(in oklch, var(--primary) 4%, var(--card))",
            stroke: "var(--border)",
          }}
        />
        <g style={{ clipPath: `url(#jar${id})` }}>
          <g
            transform={`translate(0 ${(lvlY - 3).toFixed(1)}) rotate(${(-rot * 0.6).toFixed(2)} 150 0) scale(1 ${(amp * 1.1).toFixed(3)})`}
          >
            <path
              d={WAVE}
              opacity="0.55"
              style={{
                fill: `color-mix(in oklch, ${tone} 80%, black)`,
                transition: "fill 450ms ease",
                animation: "ds-wave-rev 3400ms linear infinite",
              }}
            />
          </g>
          <rect
            x="60"
            y={(lvlY + 8).toFixed(1)}
            width="180"
            height="260"
            opacity="0.92"
            style={{ fill: tone, transition: "fill 450ms ease" }}
          />
          <g
            transform={`translate(0 ${lvlY.toFixed(1)}) rotate(${rot.toFixed(2)} 150 0) scale(1 ${amp.toFixed(3)})`}
          >
            <path
              d={WAVE}
              style={{
                fill: `color-mix(in oklch, ${tone} 65%, white)`,
                transition: "fill 450ms ease",
                animation: "ds-wave 2400ms linear infinite",
              }}
            />
          </g>
          <g style={{ clipPath: `url(#jel${id})` }} fill="white">
            <circle
              cx="92"
              cy="276"
              r="3"
              style={{ animation: "ds-bubble 3200ms linear infinite" }}
            />
            <circle
              cx="148"
              cy="280"
              r="2.2"
              style={{ animation: "ds-bubble 2600ms linear 900ms infinite" }}
            />
            <circle
              cx="204"
              cy="278"
              r="3.4"
              style={{ animation: "ds-bubble 3600ms linear 1700ms infinite" }}
            />
          </g>
          {BEAR_SPOTS.map(([x, y], i) => {
            const inJelly = y > lvlY + 6;
            return (
              <g
                key={i}
                style={{
                  transform: `translate(${x}px, ${y}px) rotate(${((i * 47) % 50) - 25}deg) scale(${inJelly ? 1 : 0})`,
                  opacity: inJelly ? 0.95 : 0,
                  transition: "transform 520ms var(--ease-spring), opacity 180ms ease",
                }}
              >
                <g
                  style={{
                    fill: CANDY[i % CANDY.length],
                    animation: `ds-bob ${2200 + (i % 5) * 300}ms ease-in-out ${i * 130}ms infinite`,
                  }}
                >
                  <GummyBearShape />
                </g>
              </g>
            );
          })}
        </g>
        <line
          x1="60"
          y1={targetY}
          x2="240"
          y2={targetY}
          strokeWidth="1.6"
          strokeDasharray="5 4"
          opacity="0.6"
          style={{ stroke: "var(--foreground)" }}
        />
        <text
          x="252"
          y={targetY + 4.5}
          fontSize="13"
          fontWeight="700"
          style={{ fill: "var(--foreground)" }}
        >
          {target}%
        </text>
        <path
          d="M76 100 Q70 180 78 256"
          fill="none"
          stroke="white"
          strokeWidth="7"
          strokeLinecap="round"
          opacity="0.7"
        />
        <g ref={eyesRef}>
          <rect
            x="100"
            y="146"
            width="100"
            height="82"
            rx="16"
            strokeWidth="1.5"
            style={{ fill: "var(--card)", stroke: "var(--border)" }}
          />
          {[116, 184].map((cx) => (
            <ellipse
              key={cx}
              cx={cx}
              cy="196"
              rx="7"
              ry="4.5"
              style={{
                fill: "var(--candy-5)",
                opacity: happy ? 0.75 : face === "ok" ? 0.35 : 0,
                transition: "opacity 300ms ease",
              }}
            />
          ))}
          {brows ? (
            <g
              fill="none"
              strokeWidth="2.6"
              strokeLinecap="round"
              style={{ stroke: "var(--foreground)" }}
            >
              <path d={brows[0]} />
              <path d={brows[1]} />
            </g>
          ) : null}
          {happy ? (
            <g
              fill="none"
              strokeWidth="3.2"
              strokeLinecap="round"
              style={{ stroke: "var(--foreground)" }}
            >
              <path d="M124 177 Q133 166 142 177" />
              <path d="M158 177 Q167 166 176 177" />
            </g>
          ) : (
            <g
              style={{
                transformBox: "fill-box",
                transformOrigin: "center",
                animation: "ds-blink 4600ms ease-in-out infinite",
              }}
            >
              {[133, 167].map((cx) => (
                <circle
                  key={cx}
                  cx={cx}
                  cy="174"
                  r="9.5"
                  strokeWidth="1.8"
                  style={{ fill: "var(--card)", stroke: "var(--foreground)" }}
                />
              ))}
              {[133, 167].map((cx) => (
                <circle
                  key={"p" + cx}
                  cx={cx}
                  cy="174"
                  r="4.6"
                  style={{
                    fill: "var(--foreground)",
                    transform: `translate(${pupil.x.toFixed(2)}px, ${pupil.y.toFixed(2)}px)`,
                    transition: "transform 140ms ease-out",
                  }}
                />
              ))}
            </g>
          )}
          <path
            d={mouth.d}
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              stroke: "var(--foreground)",
              fill: mouth.filled ? "var(--foreground)" : "none",
            }}
          />
          {label ? (
            <text
              x="150"
              y="221"
              textAnchor="middle"
              fontSize="9"
              fontWeight="700"
              letterSpacing="2"
              style={{ fill: "var(--muted-foreground)" }}
            >
              {label}
            </text>
          ) : null}
        </g>
      </g>
      {pop > 0 ? (
        <g key={`stars${pop}`}>
          {[
            {
              d: "M40 44l3.2 7.6 8.2.5-6.3 5.3 2 8-7.1-4.4-7.1 4.4 2-8-6.3-5.3 8.2-.5z",
              c: "var(--warning)",
              delay: 160,
            },
            {
              d: "M262 22l3.2 7.6 8.2.5-6.3 5.3 2 8-7.1-4.4-7.1 4.4 2-8-6.3-5.3 8.2-.5z",
              c: "var(--candy-5)",
              delay: 260,
            },
            {
              d: "M272 140l2.4 5.7 6.2.4-4.7 4 1.5 6-5.4-3.3-5.4 3.3 1.5-6-4.7-4 6.2-.4z",
              c: "var(--success)",
              delay: 360,
            },
          ].map((s) => (
            <path
              key={s.delay}
              d={s.d}
              style={{
                fill: s.c,
                opacity: 0,
                transformBox: "fill-box",
                transformOrigin: "center",
                animation: `ds-spark-out 1100ms var(--ease-spring) ${s.delay}ms backwards`,
              }}
            />
          ))}
        </g>
      ) : null}
    </svg>
  );
}
