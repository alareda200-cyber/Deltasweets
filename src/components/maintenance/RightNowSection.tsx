import { AlertTriangle, CheckCircle2, ChevronRight, Layers, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { MaintenanceEvent } from "@/lib/queries";
import { TYPE_LABELS, typeBadgeVariant } from "@/lib/maintenance-format";

// "Is anything wrong right now?" — the first question anyone opens
// /maintenance with, answered before any filter, chart or table.
//
// Replaces the 8-card KPI grid, which split "open" across four type cards and
// painted each one red whenever its count was above zero. On 25 Sep 2026 all
// four open faults were long-running known defects with stops_line = false
// (the line was running), so the grid had been red for weeks while no line
// was down — and it never said the one thing that mattered: nothing was
// stopped. Red here is reserved for a fault that is stopping a line.
//
// Always plant-wide and never filtered: it reads the dedicated open-events
// query (openMaintenanceEventsQuery), which can't be lost to a row cap, and
// the full stoppage list. The scope chip says so, because the filter bar sits
// directly below it.

type Tone = "success" | "warning" | "danger" | "neutral";

const TONE: Record<Tone, { tile: string; icon: string; sub: string }> = {
  success: {
    tile: "border-border bg-card",
    icon: "bg-success/15 text-success-strong",
    sub: "text-success-strong",
  },
  warning: {
    tile: "border-warning/40 bg-warning/10",
    icon: "bg-warning/25 text-warning-strong",
    sub: "text-warning-strong",
  },
  danger: {
    tile: "border-destructive/40 bg-destructive/10",
    icon: "bg-destructive/15 text-destructive-strong",
    sub: "text-destructive-strong",
  },
  neutral: {
    tile: "border-border bg-card",
    icon: "bg-muted text-foreground",
    sub: "text-muted-foreground",
  },
};

export function ScopeChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

// "3h", "38 days" — ages here run from minutes to months, and a manager
// reads "116 days" faster than "2,779h".
export function formatAge(fromIso: string, now: number): string {
  const hours = Math.max(0, (now - new Date(fromIso).getTime()) / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)} days`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// Stopping-the-line first, then oldest first: the fault costing production
// right now outranks everything; among the rest, the one that has waited
// longest is the one most likely to have been forgotten.
export function sortOpenFaults(events: MaintenanceEvent[]): MaintenanceEvent[] {
  return [...events].sort((a, b) => {
    if (a.stops_line !== b.stops_line) return a.stops_line ? -1 : 1;
    return new Date(a.started_at).getTime() - new Date(b.started_at).getTime();
  });
}

function StatusTile({
  label,
  mobileLabel,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  mobileLabel?: string;
  value: number;
  sub: string;
  tone: Tone;
  icon: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div className={`flex min-w-0 gap-3 rounded-xl border p-3 shadow-card md:p-5 ${t.tile}`}>
      <div
        className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg md:flex ${t.icon}`}
        aria-hidden="true"
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs leading-tight text-muted-foreground md:text-sm">
          {mobileLabel ? (
            <>
              <span className="md:hidden">{mobileLabel}</span>
              <span className="hidden md:inline">{label}</span>
            </>
          ) : (
            label
          )}
        </p>
        <p className="mt-1 text-2xl font-bold leading-none tabular-nums md:text-3xl">{value}</p>
        <p className={`mt-1 text-xs font-medium leading-tight md:text-sm ${t.sub}`}>{sub}</p>
      </div>
    </div>
  );
}

export function RightNowSection({
  openFaults,
  stoppages,
  onSelectEvent,
  now = Date.now(),
}: {
  openFaults: MaintenanceEvent[];
  stoppages: { status: string }[];
  onSelectEvent: (e: MaintenanceEvent) => void;
  now?: number;
}) {
  const sorted = sortOpenFaults(openFaults);
  const stopping = sorted.filter((e) => e.stops_line);
  const running = sorted.filter((e) => !e.stops_line);
  const linesStopped = new Set(stopping.map((e) => e.line_id ?? "unassigned"));
  const stoppedNames = Array.from(
    new Set(stopping.map((e) => e.production_lines?.name ?? "Unassigned line")),
  );
  const openStoppages = stoppages.filter((s) => s.status !== "resolved").length;
  const oldestRunning = running[0];

  return (
    <section aria-labelledby="right-now-heading" className="mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="right-now-heading" className="text-base font-semibold md:text-lg">
          Right now
        </h2>
        <ScopeChip>Live · all lines · not affected by filters</ScopeChip>
      </div>

      <div className="grid grid-cols-3 gap-2 md:gap-4">
        <StatusTile
          label="Lines stopped"
          value={linesStopped.size}
          sub={linesStopped.size === 0 ? "None" : stoppedNames.join(", ")}
          tone={linesStopped.size === 0 ? "success" : "danger"}
          icon={
            linesStopped.size === 0 ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <AlertTriangle className="h-5 w-5" />
            )
          }
        />
        <StatusTile
          label="Running with a known defect"
          mobileLabel="Known defects"
          value={running.length}
          sub={oldestRunning ? `Oldest ${formatAge(oldestRunning.started_at, now)}` : "None"}
          tone={running.length === 0 ? "neutral" : "warning"}
          icon={<Wrench className="h-5 w-5" />}
        />
        <StatusTile
          label="Open stoppages"
          value={openStoppages}
          sub={openStoppages === 0 ? `${stoppages.length} recorded, all closed` : "Still open"}
          tone={openStoppages === 0 ? "neutral" : "danger"}
          icon={<Layers className="h-5 w-5" />}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 md:px-5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold md:text-base">Open faults</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
              {sorted.length}
            </span>
          </div>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Line-stopping first, then oldest
          </span>
        </div>

        {sorted.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-success-strong md:px-5">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            No open faults.
          </div>
        ) : (
          <>
            {stopping.length === 0 && (
              <div className="flex items-center gap-2 border-b border-border bg-success/10 px-4 py-2.5 text-sm font-medium text-success-strong md:px-5">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                Stopping a line: none
              </div>
            )}

            {/* Header row — desktop only; mobile rows carry their own labels. */}
            <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_24px] gap-3 border-b border-border px-5 py-2 text-xs text-muted-foreground md:grid">
              <span>Fault</span>
              <span>Line</span>
              <span>Type</span>
              <span>Impact</span>
              <span>Open for</span>
              <span />
            </div>

            <ul>
              {sorted.map((e) => (
                <li key={e.id} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onSelectEvent(e)}
                    className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid md:min-h-0 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_24px] md:gap-3 md:px-5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold md:text-base">
                        {e.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground md:hidden">
                        {e.stops_line && (
                          <span className="font-semibold text-destructive-strong">
                            Stopping the line ·{" "}
                          </span>
                        )}
                        {(e.production_lines?.name ?? "—") + " · " + TYPE_LABELS[e.type]}
                      </span>
                      {e.severity_label && (
                        <span className="hidden text-xs text-muted-foreground md:block">
                          Severity: {e.severity_label}
                        </span>
                      )}
                    </span>
                    <span className="hidden truncate text-sm md:block">
                      {e.production_lines?.name ?? "—"}
                    </span>
                    <span className="hidden md:block">
                      <Badge variant={typeBadgeVariant(e.type)}>{TYPE_LABELS[e.type]}</Badge>
                    </span>
                    <span
                      className={`hidden text-sm md:block ${e.stops_line ? "font-semibold text-destructive-strong" : "text-muted-foreground"}`}
                    >
                      {e.stops_line ? "Stopping the line" : "Line running"}
                    </span>
                    <span className="shrink-0 text-right md:text-left">
                      <span className="block text-sm font-semibold tabular-nums">
                        {formatAge(e.started_at, now)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        since {shortDate(e.started_at)}
                      </span>
                    </span>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
