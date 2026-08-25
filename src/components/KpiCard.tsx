import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface Props {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
  variant?: "default" | "primary" | "success" | "warning" | "danger";
  // Optional per-instance override, merged in after the default classes
  // (including p-5) via cn/tailwind-merge below — e.g. a caller passing
  // "p-3 md:p-5" tightens padding on mobile only while leaving every other
  // caller of this shared component unaffected. Omitted entirely by default.
  className?: string;
  // Optional shorter label (+ its own icon) shown only below md — for labels
  // like "Maintenance downtime (all sources)" that wrap to 3-4 lines on a
  // narrow 2-col mobile grid and push the value/sub off balance. Desktop
  // (md:) always renders the full `label`/`icon` unchanged; when omitted,
  // mobile falls back to the same `label` as before (no behavior change for
  // every other caller of this shared component).
  mobileLabel?: string;
  mobileIcon?: LucideIcon;
  /** Signed change vs a named comparison, e.g. "-10.7%". Rendered as a chip. */
  delta?: string;
  /** What the delta means. "good"/"bad" colour it; "neutral" is the default. */
  deltaTone?: "good" | "bad" | "neutral";
  /** 0..1. Draws a meter under the value — for values that have a target. */
  meter?: number;
  /** Caption under the meter, e.g. "target 90.0%". */
  meterLabel?: string;
}

export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  variant = "default",
  className,
  mobileLabel,
  mobileIcon: MobileIcon,
  delta,
  deltaTone,
  meter,
  meterLabel,
}: Props) {
  const hasMobileLabel = !!mobileLabel;
  const tone = {
    default: "from-card to-card",
    primary: "from-primary/10 to-primary/[0.02]",
    success: "from-success/15 to-success/[0.02]",
    warning: "from-warning/15 to-warning/[0.02]",
    danger: "from-destructive/15 to-destructive/[0.02]",
  }[variant];

  const accent = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    danger: "text-destructive",
  }[variant];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-gradient-to-br p-5 shadow-card transition-all hover:shadow-elevated",
        tone,
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {hasMobileLabel ? (
          <>
            <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground md:hidden">
              {MobileIcon && <MobileIcon className="h-3 w-3 shrink-0" />}
              {mobileLabel}
            </p>
            <p className="hidden text-xs font-medium uppercase tracking-wider text-muted-foreground md:block">
              {label}
            </p>
          </>
        ) : (
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          {delta && (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                deltaTone === "good"
                  ? "bg-success/15 text-success"
                  : deltaTone === "bad"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {delta}
            </span>
          )}
          {Icon && <Icon className={cn("h-4 w-4 shrink-0", accent)} />}
        </div>
      </div>
      {/* Mono figures, deliberately. A monospace digit is as wide as a zero, so at
          24px+ the number goes gappy — weight 500 (not 700) and -0.045em tracking
          pull it back together. Any figure >= 20px elsewhere gets the same
          treatment, so a number keeps one shape wherever it appears. */}
      <p
        className={cn(
          "mt-2 font-mono text-2xl font-medium tracking-[-0.045em] tabular-nums md:text-3xl",
          hasMobileLabel ? "whitespace-nowrap md:truncate" : "truncate",
          accent,
        )}
      >
        {value}
      </p>
      {typeof meter === "number" && (
        <div className="mt-2.5">
          {/* Unfilled track is a lighter step of the SAME hue as the fill, not grey,
              so the state reads across the whole bar, not just the filled part. */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
            <div
              className={cn(
                "h-full rounded-full",
                {
                  default: "bg-primary",
                  primary: "bg-primary",
                  success: "bg-success",
                  warning: "bg-warning",
                  danger: "bg-destructive",
                }[variant],
              )}
              style={{ width: `${Math.max(0, Math.min(1, meter)) * 100}%` }}
            />
          </div>
          {meterLabel && <p className="mt-1 text-[10px] text-muted-foreground">{meterLabel}</p>}
        </div>
      )}
      {sub && (
        <p
          className={cn(
            "mt-1 text-xs text-muted-foreground",
            hasMobileLabel && "text-[8px] md:text-xs",
          )}
        >
          {sub}
        </p>
      )}
    </div>
  );
}
