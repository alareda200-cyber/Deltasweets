import { useEffect, useState, type MutableRefObject } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/dashboard-metrics";
import { Odometer, useTilt } from "@/components/motion";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { CARD, TONE_BAR, TONE_TEXT } from "./tone";

/** Last value each tile showed, by title — so a new line or period rolls the
 * digits from the old number instead of from 0. Owned by the page. */
export type KpiMemory = MutableRefObject<Record<string, number | null>>;

export interface KpiSegment {
  /** 0–100, share of the bar's full width. */
  pct: number;
  className: string;
}

export interface KpiTileProps {
  title: string;
  /** "target 90%" — shown next to the title from md up. */
  target?: string;
  /** Percent, one decimal (67.7 → "67.7%"); null shows a dash. */
  value: number | null;
  /** Where the target sits on the bar, 0–100. Drawn as a thin tick. */
  targetPct?: number | null;
  unit?: string;
  detail: string;
  mobileDetail?: string;
  segments: KpiSegment[];
  barLabel: string;
  status: string;
  mobileStatus?: string;
  tone: Tone;
}

export function KpiTile({
  title,
  target,
  value,
  unit,
  detail,
  mobileDetail,
  segments,
  barLabel,
  status,
  mobileStatus,
  tone,
  targetPct,
  index = 0,
  memory,
}: KpiTileProps & { index?: number; memory?: KpiMemory }) {
  const tilt = useTilt(8);
  const reduced = usePrefersReducedMotion();
  // First paint shows the previous line/period's number (if any), then the
  // odometer rolls to this one. No previous number: roll up from 0.
  const [from] = useState(() => memory?.current[title]);
  const [armed, setArmed] = useState(from === undefined || from === value);
  useEffect(() => {
    if (armed) return;
    const t = setTimeout(() => setArmed(true), 60);
    return () => clearTimeout(t);
  }, [armed]);
  useEffect(() => {
    if (memory) memory.current[title] = value;
  }, [memory, title, value]);
  const shown = armed || reduced ? value : (from ?? null);
  const rise = 90 * index;
  return (
    <section
      {...tilt.handlers}
      data-kpi-tile={title}
      style={{ ...tilt.style, animationDelay: `${160 + rise}ms` }}
      className={cn(
        CARD,
        "ds-rise relative flex min-w-0 flex-col gap-1.5 p-3.5 md:gap-2.5 md:px-5 md:py-[18px]",
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={tilt.glareStyle}
      />
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground md:text-[15px]">{title}</h3>
        {target && <span className="hidden text-xs text-muted-foreground md:inline">{target}</span>}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[28px] font-bold leading-tight md:text-4xl">
          <Odometer
            value={shown}
            decimals={1}
            suffix="%"
            fromZero={from === undefined}
            delay={rise}
          />
        </span>
        {unit && <span className="hidden text-sm text-muted-foreground md:inline">{unit}</span>}
      </div>
      <p className="text-xs tabular-nums text-muted-foreground md:text-[13px] md:text-foreground">
        {mobileDetail ? (
          <>
            <span className="md:hidden">{mobileDetail}</span>
            <span className="hidden md:inline">{detail}</span>
          </>
        ) : (
          detail
        )}
      </p>
      <div
        role="img"
        aria-label={barLabel}
        className="relative h-1.5 overflow-hidden rounded-full bg-muted md:h-2"
      >
        {/* The fill grows once from the left; the target tick stays put. */}
        <div className="ds-fill-x flex h-full w-full" style={{ animationDelay: `${380 + rise}ms` }}>
          {segments.map((s, i) => (
            <div
              key={i}
              className={cn("h-full", s.className)}
              style={{ width: `${Math.max(0, Math.min(100, s.pct))}%` }}
            />
          ))}
        </div>
        {targetPct != null && targetPct > 0 && targetPct < 100 && (
          <span
            data-target-tick=""
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground/55"
            style={{ left: `${targetPct}%` }}
          />
        )}
      </div>
      <p className={cn("text-xs font-semibold md:text-[13px]", TONE_TEXT[tone])}>
        {mobileStatus ? (
          <>
            <span className="md:hidden">{mobileStatus}</span>
            <span className="hidden md:inline">{status}</span>
          </>
        ) : (
          status
        )}
      </p>
    </section>
  );
}

export function toneBar(tone: Tone): string {
  return TONE_BAR[tone];
}

export function KpiTilesSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-4" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={cn(CARD, "ds-shimmer h-[150px] md:h-[204px]")} />
      ))}
    </div>
  );
}
