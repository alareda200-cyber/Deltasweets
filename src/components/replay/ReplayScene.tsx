import { CANDY, GummyBearShape } from "@/components/motion";

export interface SceneState {
  /** Belt and depositor moving. */
  running: boolean;
  /** A fault is stopping the line right now. */
  faultTitle: string | null;
  faultMinutes: number;
  /** Seconds of wall-clock time, for decorative motion. */
  real: number;
  /** Belt travel in px, advances only while running. */
  belt: number;
  gummies: { x: number; y: number; r: number; c: number }[];
  /** 0–1 how full the packing crate is. */
  crate: number;
  clock: string;
}

/**
 * The line drawn as a little factory: cooking kettle → depositor → belt
 * through the cooling tunnel → packing crate. Pure SVG driven by props, so the
 * page owns the clock and the scene has no timers of its own. Decorative for
 * screen readers; the page states the same facts in text.
 */
export function ReplayScene({
  s,
  lineName,
  compact = false,
}: {
  s: SceneState;
  lineName: string;
  /** Phones: crop to the kettle, depositor and first metres of belt, bigger. */
  compact?: boolean;
}) {
  const bob = s.running ? 7 * Math.abs(Math.sin(s.real * 7)) : 0;
  const chipW = s.faultTitle ? Math.max(150, (s.faultTitle.length + 8) * 8 + 24) : 0;
  const chipX = Math.max(170, 327 - chipW / 2);
  const rollers: number[] = [];
  for (let x = 244; x <= 1148; x += 100.4) rollers.push(x);
  const lamp = s.faultTitle
    ? "var(--warning)"
    : s.running
      ? "var(--success)"
      : "var(--muted-foreground)";
  return (
    <svg
      viewBox={compact ? "0 0 760 330" : "0 0 1358 330"}
      aria-hidden="true"
      className="block h-auto w-full"
    >
      <line
        x1="0"
        y1="286"
        x2="1358"
        y2="286"
        strokeWidth="2"
        style={{ stroke: "var(--border)" }}
      />
      <text
        x="24"
        y="38"
        fontSize="30"
        fontWeight="700"
        style={{ fill: "var(--foreground)", fontFamily: "ui-monospace, monospace" }}
      >
        {s.clock}
      </text>
      <text x="24" y="58" fontSize="13" style={{ fill: "var(--muted-foreground)" }}>
        {s.faultTitle ? `stopped — ${s.faultTitle}` : `${lineName} line`}
      </text>

      {/* Cooking */}
      <rect
        x="56"
        y="118"
        width="120"
        height="150"
        rx="26"
        strokeWidth="2"
        style={{ fill: "var(--muted)", stroke: "var(--border)" }}
      />
      <rect
        x="66"
        y="150"
        width="100"
        height="108"
        rx="18"
        opacity="0.85"
        style={{ fill: "var(--warning)" }}
      />
      <text
        x="116"
        y="306"
        textAnchor="middle"
        fontSize="13"
        fontWeight="600"
        style={{ fill: "var(--muted-foreground)" }}
      >
        Cooking
      </text>
      <path
        d="M176 150 H214 V96 H236"
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
        style={{ stroke: "var(--border)" }}
      />

      {/* Depositor */}
      <rect x="232" y="56" width="190" height="112" rx="14" style={{ fill: "var(--primary)" }} />
      <text
        x="301"
        y="97"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        style={{ fill: "var(--primary-foreground)" }}
      >
        DEPOSITOR
      </text>
      <circle
        cx="398"
        cy="80"
        r="9"
        style={{
          fill: lamp,
          animation: s.faultTitle ? "ds-twinkle 600ms ease-in-out infinite" : undefined,
        }}
      />
      <g transform={`translate(0 ${bob.toFixed(1)})`}>
        <rect
          x="252"
          y="168"
          width="150"
          height="22"
          rx="6"
          style={{ fill: "var(--foreground)" }}
        />
        <path
          d="M262 190 l8 10 8 -10 M290 190 l8 10 8 -10 M318 190 l8 10 8 -10 M346 190 l8 10 8 -10 M374 190 l8 10 8 -10"
          style={{ fill: "var(--foreground)" }}
        />
      </g>
      <rect x="232" y="168" width="14" height="60" style={{ fill: "var(--primary)" }} />
      <rect x="408" y="168" width="14" height="60" style={{ fill: "var(--primary)" }} />

      {/* Belt */}
      <rect x="232" y="228" width="928" height="16" rx="8" style={{ fill: "var(--foreground)" }} />
      <line
        x1="244"
        y1="229"
        x2="1148"
        y2="229"
        strokeWidth="2"
        strokeDasharray="14 10"
        strokeDashoffset={(-s.belt).toFixed(1)}
        style={{ stroke: "var(--muted-foreground)" }}
      />
      {rollers.map((x) => (
        <g
          key={x}
          transform={`translate(${x.toFixed(1)} 236) rotate(${((s.belt * 5.7) % 360).toFixed(1)})`}
        >
          <circle r="10" style={{ fill: "var(--muted-foreground)" }} />
          <line x1="-8" x2="8" strokeWidth="2" style={{ stroke: "var(--border)" }} />
        </g>
      ))}
      {[250, 690, 1130].map((x) => (
        <rect key={x} x={x} y="244" width="10" height="42" style={{ fill: "var(--border)" }} />
      ))}

      {s.gummies.map((g, i) => (
        <g
          key={i}
          transform={`translate(${g.x.toFixed(1)} ${g.y.toFixed(1)}) rotate(${g.r.toFixed(0)}) scale(0.8)`}
          style={{ fill: CANDY[g.c % CANDY.length] }}
        >
          <GummyBearShape />
        </g>
      ))}

      {/* Cooling tunnel, drawn over the belt so bears pass through it */}
      <rect
        x="560"
        y="150"
        width="310"
        height="78"
        rx="16"
        opacity="0.75"
        style={{ fill: "color-mix(in oklch, var(--primary) 18%, var(--card))" }}
      />
      <rect
        x="560"
        y="150"
        width="310"
        height="78"
        rx="16"
        fill="none"
        strokeWidth="2"
        style={{ stroke: "color-mix(in oklch, var(--primary) 45%, var(--card))" }}
      />
      <text
        x="715"
        y="176"
        textAnchor="middle"
        fontSize="12"
        fontWeight="700"
        letterSpacing="2"
        style={{ fill: "var(--primary)" }}
      >
        COOLING TUNNEL
      </text>

      {/* Packing crate */}
      <clipPath id="replay-crate">
        <path d="M1168 196 L1180 286 H1318 L1330 196 Z" />
      </clipPath>
      <path
        d="M1168 196 L1180 286 H1318 L1330 196 Z"
        strokeWidth="2"
        style={{ fill: "var(--muted)", stroke: "var(--border)" }}
      />
      <rect
        x="1160"
        y={(286 - 80 * Math.min(1, s.crate)).toFixed(1)}
        width="180"
        height="120"
        opacity="0.85"
        style={{ fill: "var(--warning)", clipPath: "url(#replay-crate)" }}
      />
      <text
        x="1249"
        y="306"
        textAnchor="middle"
        fontSize="13"
        fontWeight="600"
        style={{ fill: "var(--muted-foreground)" }}
      >
        Packing
      </text>

      {s.faultTitle && (
        <g
          className="ds-pop-in"
          style={{ transformBox: "fill-box", transformOrigin: "center bottom" }}
        >
          <rect
            x={chipX}
            y="6"
            width={chipW}
            height="38"
            rx="12"
            style={{ fill: "var(--destructive)" }}
          />
          <path d="M320 44 l7 8 7 -8 Z" style={{ fill: "var(--destructive)" }} />
          <text
            x={chipX + chipW / 2}
            y="30"
            textAnchor="middle"
            fontSize="15"
            fontWeight="700"
            style={{ fill: "var(--destructive-foreground)" }}
          >
            {s.faultTitle} · {s.faultMinutes} min
          </text>
        </g>
      )}
    </svg>
  );
}
