import type { Tone } from "@/lib/dashboard-metrics";

// One mapping from a status tone to the app's colour tokens, shared by every
// dashboard card so "warning" means the same amber everywhere.
export const TONE_TEXT: Record<Tone, string> = {
  success: "text-success-strong",
  warning: "text-warning-strong",
  danger: "text-destructive-strong",
  neutral: "text-muted-foreground",
};

export const TONE_BAR: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  neutral: "bg-muted-foreground",
};

// Planned stops read as the calm chart blue, unplanned as amber, unclassified
// as grey — the same three on the KPI bar, the stacked bar and the reason list.
export const KIND_BAR = {
  planned: "bg-chart-1",
  unplanned: "bg-warning",
  unclassified: "bg-muted-foreground/40",
} as const;

export const CARD = "rounded-2xl border border-border bg-card shadow-card";
