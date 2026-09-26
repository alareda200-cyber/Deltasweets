import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

export type JarGaze =
  | { kind: "look"; x: number; y: number }
  | { kind: "closed" }
  | { kind: "peek" }
  | { kind: "happy" };

export type JarMouth = "ok" | "curious" | "wait" | "sad" | "happy";

const MOUTHS: Record<JarMouth, { d: string; filled: boolean }> = {
  ok: { d: "M140 199 Q150 206 160 199", filled: false },
  curious: { d: "M146 200 C150 196 154 200 150 206 C146 204 146 202 146 200 Z", filled: true },
  wait: { d: "M143 202 L157 202", filled: false },
  sad: { d: "M140 206 Q150 196 160 206", filled: false },
  happy: { d: "M134 192 Q150 216 166 192 Z", filled: true },
};

/**
 * The Delta Sweets jar as a sign-in companion: it follows the email as it is
 * typed, shuts its eyes while the password is typed (peeks with one eye when
 * the password is shown), and fills while signing in. Decoration only — the
 * form works the same without it; aria-hidden.
 */
export function WatchingJar({
  gaze,
  mouth,
  fillPct,
  tone = "warning",
  hopKey = 0,
  size = 120,
  className,
}: {
  gaze: JarGaze;
  mouth: JarMouth;
  /** 0–100, how full the jar is. */
  fillPct: number;
  tone?: "warning" | "success" | "destructive";
  /** Change to replay the little hop. */
  hopKey?: number;
  size?: number;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const y = 282 - (Math.max(0, Math.min(100, fillPct)) / 100) * 196;
  const toneVar = `var(--${tone})`;
  const m = MOUTHS[mouth];
  const look = gaze.kind === "look" ? gaze : { x: 0, y: 0 };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 300 300"
      aria-hidden="true"
      className={cn("shrink-0 overflow-visible", className)}
    >
      <defs>
        <clipPath id="watching-jar-clip">
          <rect x="60" y="64" width="180" height="218" rx="34" />
        </clipPath>
      </defs>
      <g
        key={hopKey}
        style={{
          transformBox: "fill-box",
          transformOrigin: "50% 100%",
          animation: hopKey && !reduced ? "ds-hop 820ms var(--ease-out-soft)" : undefined,
        }}
      >
        <rect x="78" y="16" width="144" height="28" rx="10" style={{ fill: "var(--destructive)" }} />
        <rect
          x="78"
          y="16"
          width="144"
          height="9"
          rx="6"
          style={{ fill: "color-mix(in oklch, var(--destructive) 60%, white)" }}
        />
        <rect x="86" y="42" width="128" height="18" rx="5" style={{ fill: "var(--muted)" }} />
        <rect
          x="54"
          y="58"
          width="192"
          height="230"
          rx="40"
          strokeWidth="3"
          style={{ fill: "var(--card)", stroke: "var(--border)" }}
        />
        <rect
          x="60"
          y={y}
          width="180"
          height="240"
          opacity="0.9"
          style={{
            fill: toneVar,
            clipPath: "url(#watching-jar-clip)",
            transition: "y 900ms var(--ease-spring), fill 400ms ease",
          }}
        />
        <rect
          x="100"
          y="146"
          width="100"
          height="78"
          rx="16"
          strokeWidth="1.5"
          style={{ fill: "var(--card)", stroke: "var(--border)" }}
        />
        <g fill="none" strokeLinecap="round" style={{ stroke: "var(--foreground)" }}>
          {gaze.kind === "look" && (
            <g
              style={{
                transformBox: "fill-box",
                transformOrigin: "center",
                animation: "ds-blink 4200ms ease-in-out infinite",
              }}
            >
              {[133, 167].map((cx) => (
                <circle key={cx} cx={cx} cy="176" r="10" strokeWidth="2" style={{ fill: "var(--card)" }} />
              ))}
              {[133, 167].map((cx) => (
                <circle
                  key={"p" + cx}
                  cx={cx}
                  cy="176"
                  r="4.8"
                  stroke="none"
                  style={{
                    fill: "var(--foreground)",
                    transform: `translate(${look.x.toFixed(1)}px, ${look.y.toFixed(1)}px)`,
                    transition: "transform 160ms ease-out",
                  }}
                />
              ))}
            </g>
          )}
          {gaze.kind === "closed" && (
            <path d="M123 178 Q133 186 143 178 M157 178 Q167 186 177 178" strokeWidth="3" />
          )}
          {gaze.kind === "peek" && (
            <>
              <path d="M123 178 Q133 186 143 178" strokeWidth="3" />
              <circle cx="167" cy="176" r="10" strokeWidth="2" style={{ fill: "var(--card)" }} />
              <circle cx="169" cy="178" r="4.8" stroke="none" style={{ fill: "var(--foreground)" }} />
            </>
          )}
          {gaze.kind === "happy" && (
            <path d="M124 180 Q133 169 142 180 M158 180 Q167 169 176 180" strokeWidth="3.2" />
          )}
          <path
            d={m.d}
            strokeWidth="2.6"
            strokeLinejoin="round"
            style={{ fill: m.filled ? "var(--foreground)" : "none" }}
          />
        </g>
      </g>
    </svg>
  );
}
