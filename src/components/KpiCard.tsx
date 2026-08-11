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
}

export function KpiCard({ label, value, sub, icon: Icon, variant = "default", className }: Props) {
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
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {Icon && <Icon className={cn("h-4 w-4", accent)} />}
      </div>
      <p
        className={cn(
          "mt-2 truncate text-2xl font-bold tracking-tight tabular-nums md:text-3xl",
          accent,
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
