import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Inbox, Loader2 } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { MaintenanceEvent } from "@/lib/queries";
import {
  eventElapsedMinutes,
  faultKey,
  formatDuration,
  groupEventsByFault,
  STATUS_LABELS,
  statusBadgeVariant,
} from "@/lib/maintenance-format";

const GROUP_PAGE_SIZE = 20;
// Occurrences listed under an expanded group before pointing at the flat
// list — a group of 495 servo stops is summarised, not dumped.
const OCCURRENCES_SHOWN = 10;

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// One row per fault (title trimmed, case-insensitive), newest occurrence
// first inside it. `downtimeByKey` is Top Losses' own per-title downtime
// (stoppage-merged, non-production days excluded) keyed by the same faultKey,
// so the "Time lost" here is the same number the Overview shows.
export function GroupedEventLog({
  events,
  isLoading,
  downtimeByKey,
  resetKey,
  onSelectEvent,
  onShowAll,
}: {
  events: MaintenanceEvent[];
  isLoading: boolean;
  downtimeByKey: Map<string, number>;
  /** Changes whenever the page filters change — returns to page 1. */
  resetKey: string;
  onSelectEvent: (e: MaintenanceEvent) => void;
  /** Switch the log to one row per event. */
  onShowAll: () => void;
}) {
  const groups = useMemo(() => groupEventsByFault(events), [events]);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    setPage(1);
    setExpanded(null);
  }, [resetKey]);

  const totalPages = Math.max(1, Math.ceil(groups.length / GROUP_PAGE_SIZE));
  const pageGroups = groups.slice((page - 1) * GROUP_PAGE_SIZE, page * GROUP_PAGE_SIZE);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2
          className="h-5 w-5 animate-spin text-muted-foreground"
          aria-label="Loading events"
        />
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="py-10 text-center">
        <Inbox className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-sm text-muted-foreground">
          No maintenance events match this filter.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="hidden grid-cols-[36px_minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)] gap-3 border-b border-border px-2 py-2 text-xs text-muted-foreground md:grid">
        <span />
        <span>Fault</span>
        <span>Line</span>
        <span className="text-right">Events</span>
        <span className="text-right">Time lost</span>
        <span className="pl-4">Last seen</span>
        <span>Status</span>
      </div>

      <ul>
        {pageGroups.map((g) => {
          const isOpen = expanded === g.key;
          const minutes = downtimeByKey.get(faultKey(g.title)) ?? 0;
          const lost = minutes > 0 ? formatDuration(minutes * 60_000) : "—";
          const panelId = `fault-${g.key.replace(/[^a-z0-9]+/g, "-")}`;
          const shown = g.events.slice(0, OCCURRENCES_SHOWN);
          const more = g.count - shown.length;
          return (
            <li key={g.key} className="border-b border-border last:border-b-0">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setExpanded(isOpen ? null : g.key)}
                className="flex min-h-[56px] w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid md:min-h-0 md:grid-cols-[36px_minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)]"
              >
                <ChevronRight
                  aria-hidden="true"
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {g.title}
                    {g.spellings > 1 && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                        {g.spellings} spellings merged
                      </span>
                    )}
                  </span>
                  {/* Mobile summary line — the columns below are desktop-only. */}
                  <span className="block truncate text-xs text-muted-foreground md:hidden">
                    {g.lineNames.join(", ")} · {g.count} event{g.count === 1 ? "" : "s"}
                    {minutes > 0 ? ` · ${lost} lost` : ""}
                  </span>
                </span>
                <span className="hidden truncate text-sm md:block">{g.lineNames.join(", ")}</span>
                <span className="hidden text-right text-sm font-semibold tabular-nums md:block">
                  {g.count}
                </span>
                <span className="hidden text-right text-sm tabular-nums md:block">{lost}</span>
                <span className="hidden pl-4 text-xs text-muted-foreground tabular-nums md:block">
                  {whenLabel(g.lastStartedAt)}
                </span>
                <span className="hidden md:block">
                  {g.openCount > 0 ? (
                    <span className={badgeVariants({ variant: "destructive" })}>
                      {g.openCount} open
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-success-strong">All resolved</span>
                  )}
                </span>
                {g.openCount > 0 && (
                  <span
                    className={cn(badgeVariants({ variant: "destructive" }), "shrink-0 md:hidden")}
                  >
                    {g.openCount} open
                  </span>
                )}
              </button>

              {isOpen && (
                <div id={panelId} className="bg-muted/30 px-2 pb-3 pt-1 md:pl-12">
                  <ul>
                    {shown.map((e) => (
                      <li key={e.id} className="border-b border-border/60 last:border-b-0">
                        <button
                          type="button"
                          onClick={() => onSelectEvent(e)}
                          className="flex min-h-[44px] w-full items-center gap-3 py-2 text-left text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="min-w-0 flex-1 tabular-nums">
                            {whenLabel(e.started_at)}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {formatDuration(eventElapsedMinutes(e) * 60_000)}
                          </span>
                          {e.status !== "resolved" && (
                            <span
                              className={cn(
                                badgeVariants({ variant: statusBadgeVariant(e.status) }),
                                "shrink-0",
                              )}
                            >
                              {STATUS_LABELS[e.status]}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {more > 0 && (
                    <p className="pt-2 text-xs text-muted-foreground">
                      {more} more not shown.{" "}
                      <button
                        type="button"
                        onClick={onShowAll}
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        Show every event
                      </button>
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-3 text-sm text-muted-foreground">
        <span>
          {groups.length} fault{groups.length === 1 ? "" : "s"} · {events.length} event
          {events.length === 1 ? "" : "s"} · Page {page} of {totalPages}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-11 md:h-9"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-11 md:h-9"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
