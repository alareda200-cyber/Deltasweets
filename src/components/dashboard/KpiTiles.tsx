import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/dashboard-metrics";
import { CARD, TONE_BAR, TONE_TEXT } from "./tone";

export interface KpiSegment {
  /** 0–100, share of the bar's full width. */
  pct: number;
  className: string;
}

export interface KpiTileProps {
  title: string;
  /** "target 90%" — shown next to the title from md up. */
  target?: string;
  value: string;
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
}: KpiTileProps) {
  return (
    <section
      className={cn(CARD, "flex min-w-0 flex-col gap-1.5 p-3.5 md:gap-2.5 md:px-5 md:py-[18px]")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground md:text-[15px]">{title}</h3>
        {target && <span className="hidden text-xs text-muted-foreground md:inline">{target}</span>}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[28px] font-bold leading-tight tabular-nums md:text-4xl">
          {value}
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
        className="flex h-1.5 overflow-hidden rounded-full bg-muted md:h-2"
      >
        {segments.map((s, i) => (
          <div
            key={i}
            className={cn("h-full", s.className)}
            style={{ width: `${Math.max(0, Math.min(100, s.pct))}%` }}
          />
        ))}
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
        <div key={i} className={cn(CARD, "h-[150px] animate-pulse md:h-[170px]")} />
      ))}
    </div>
  );
}
