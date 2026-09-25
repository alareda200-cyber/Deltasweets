import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RightNow } from "@/lib/dashboard-metrics";

// "Is any line stopped right now?" — live, every line, not filtered by the
// line tabs or the period. Derived from open maintenance events (preventive
// left out, stops_line decides) by summarizeRightNow. Replaces the old
// Maintenance card and the hero's "N open faults" chip, which counted
// preventive work as faults and painted everything red while every line ran.

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function sentences(s: RightNow): {
  lead: string;
  mobileLead: string;
  rest: string;
  mobileRest: string;
} {
  const stopped = s.stoppedLineNames;
  const d = s.knownDefects;
  const defects = `${d} known ${d === 1 ? "defect is" : "defects are"} open`;
  if (stopped.length === 0) {
    return {
      lead: "No line is stopped right now.",
      mobileLead: "No line stopped.",
      rest: d === 0 ? "No open faults on any line." : `${defects} on running lines.`,
      mobileRest:
        d === 0 ? "No open faults." : `${d} known ${d === 1 ? "defect" : "defects"} open.`,
    };
  }
  const verb = stopped.length === 1 ? "is" : "are";
  return {
    lead: `${joinNames(stopped)} ${verb} stopped right now.`,
    mobileLead: `${joinNames(stopped)} stopped.`,
    rest: d === 0 ? "" : `${defects} without stopping a line.`,
    mobileRest: d === 0 ? "" : `${d} more known ${d === 1 ? "defect" : "defects"} open.`,
  };
}

export function RightNowStrip({
  summary,
  loading,
  error,
  canOpenMaintenance,
}: {
  summary: RightNow | null;
  loading: boolean;
  error: boolean;
  canOpenMaintenance: boolean;
}) {
  if (loading || error || !summary) {
    return (
      <div
        className="flex min-h-11 items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3 text-sm text-muted-foreground md:px-4"
        role="status"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            Checking whether any line is stopped…
          </>
        ) : (
          <>
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Couldn't load live line status. Refresh the page to try again.
          </>
        )}
      </div>
    );
  }

  const stopped = summary.stoppedLineNames.length > 0;
  const t = sentences(summary);
  const Icon = stopped ? AlertTriangle : CheckCircle2;
  const tone = stopped
    ? "border-destructive/40 bg-destructive/10 text-destructive-strong"
    : "border-success/40 bg-success/10 text-success-strong";

  const body = (
    <>
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      {/* Mobile: one short sentence, whole strip is the link. */}
      <span className="min-w-0 flex-1 md:hidden">
        <span className="font-semibold">{t.mobileLead}</span>
        {t.mobileRest && <span className="text-foreground/80"> {t.mobileRest}</span>}
      </span>
      {/* Desktop */}
      <span className="hidden min-w-0 flex-1 md:inline">
        <span className="font-semibold">{t.lead}</span>
        {t.rest && <span className="text-foreground/80"> {t.rest}</span>}
      </span>
      <span className="hidden shrink-0 rounded-full bg-card/70 px-2 py-0.5 text-xs font-semibold text-muted-foreground md:inline">
        Live · all lines
      </span>
    </>
  );

  const shell = cn(
    "flex min-h-11 items-center gap-2.5 rounded-xl border px-3.5 py-3 text-sm md:gap-3 md:px-4",
    tone,
  );

  if (!canOpenMaintenance) {
    return (
      <div className={shell} role="status">
        {body}
      </div>
    );
  }

  return (
    <>
      <Link
        to="/maintenance"
        data-pdf-variant="mobile"
        className={cn(shell, "md:hidden")}
        aria-label={`${t.mobileLead} ${t.mobileRest} Open Maintenance`}
      >
        {body}
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      </Link>
      {/* The wrapper, not the flex row, carries the variant: PDF export
          forces the desktop variant to display:block. */}
      <div data-pdf-variant="desktop" className="hidden md:block">
        <div className={shell}>
          {body}
          <Link
            to="/maintenance"
            className="shrink-0 text-sm font-semibold text-primary hover:underline"
          >
            Maintenance ›
          </Link>
        </div>
      </div>
    </>
  );
}
