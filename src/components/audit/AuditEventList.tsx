import { useState } from "react";
import { ChevronRight, Inbox } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { roleLabel } from "@/lib/users-format";
import {
  dayHeading,
  detailLine,
  deviceLine,
  groupsByDay,
  rowActionLabel,
  timeLabel,
  whoOf,
  type AuditGroup,
  type AuditRow,
} from "@/lib/audit-format";

function RolePill({ role }: { role: string | null }) {
  if (!role) return null;
  return (
    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
      {roleLabel(role).toLowerCase()}
    </span>
  );
}

function Who({ row }: { row: AuditRow }) {
  const who = whoOf(row.user_email);
  if (!who) {
    return <span className="text-sm font-semibold text-warning-strong">No user recorded</span>;
  }
  return (
    <span className="truncate text-sm font-semibold" title={row.user_email ?? undefined}>
      {who}
    </span>
  );
}

/**
 * The log, grouped by local day. Repeats of the same event (same person,
 * action, details and device, within 30 minutes) are one row with an "n×"
 * chip; the chevron that lists them is a real <button> with aria-expanded.
 */
export function AuditEventList({
  groups,
  isLoading,
}: {
  groups: AuditGroup[];
  isLoading: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading the audit log">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
        <Inbox className="mx-auto h-6 w-6" aria-hidden="true" />
        <p className="mt-2">No events match these filters.</p>
      </div>
    );
  }

  const now = new Date();
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      {groupsByDay(groups).map(({ day, groups: dayGroups }) => (
        <section
          key={day}
          aria-labelledby={`day-${day}`}
          className="flex flex-col gap-1.5 md:gap-2"
        >
          <h2
            id={`day-${day}`}
            className="text-[13px] font-semibold text-muted-foreground md:text-sm"
          >
            {dayHeading(day, now)}
          </h2>
          <ol className="flex flex-col gap-1.5 md:gap-0 md:overflow-hidden md:rounded-xl md:border md:border-border md:bg-card">
            {dayGroups.map((g, i) => {
              const first = g.events[0];
              const last = g.events[g.events.length - 1];
              const multi = g.events.length > 1;
              const open = expanded.has(first.id);
              const what = rowActionLabel(first);
              const detail = detailLine(first);
              const device = deviceLine(first);
              const time = multi
                ? `${timeLabel(first.created_at)}–${timeLabel(last.created_at)}`
                : timeLabel(first.created_at);
              const listId = `occ-${first.id}`;
              const who = whoOf(first.user_email);
              const expander = multi ? (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={listId}
                  aria-label={`${open ? "Hide" : "Show"} all ${g.events.length} times: ${what}${who ? ` by ${who}` : ""}`}
                  onClick={() => toggle(first.id)}
                  className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8"
                >
                  {g.events.length}×
                  <ChevronRight
                    aria-hidden="true"
                    className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")}
                  />
                </button>
              ) : null;
              return (
                <li
                  key={first.id}
                  className={cn(
                    "rounded-xl border border-border bg-card md:rounded-none md:border-0 md:bg-transparent",
                    i > 0 && "md:border-t md:border-border/60",
                  )}
                >
                  {/* Mobile card */}
                  <div className="flex flex-col gap-1 px-3.5 py-3 md:hidden">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[15px] font-semibold">{what}</span>
                      <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                        {time}
                      </span>
                    </div>
                    {detail && <p className="break-words text-sm">{detail}</p>}
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={cn(
                          "min-w-0 text-[13px]",
                          who ? "text-muted-foreground" : "text-warning-strong",
                        )}
                      >
                        {[who ?? "No user recorded", first.role, first.details?.device]
                          .filter((x) => typeof x === "string" && x)
                          .join(" · ")}
                      </p>
                      {expander}
                    </div>
                  </div>

                  {/* Desktop row */}
                  <div className="hidden items-center gap-4 px-4 py-3 md:grid md:grid-cols-[88px_minmax(0,200px)_minmax(0,1fr)_minmax(0,200px)] lg:grid-cols-[96px_240px_minmax(0,1fr)_220px]">
                    <span className="text-sm tabular-nums">{time}</span>
                    <span className="flex min-w-0 items-center gap-2">
                      <Who row={first} />
                      <RolePill role={first.role} />
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{what}</span>
                        {detail && (
                          <span
                            className="block truncate text-[13px] text-muted-foreground"
                            title={detail}
                          >
                            {detail}
                          </span>
                        )}
                      </span>
                      {expander}
                    </span>
                    <span className="min-w-0 text-right text-[13px] text-muted-foreground">
                      <span className="block truncate">{device || "Device not recorded"}</span>
                      {first.ip_address && (
                        <span className="block truncate text-xs">IP {first.ip_address}</span>
                      )}
                    </span>
                  </div>

                  {multi && open && (
                    <ul
                      id={listId}
                      aria-label={`All ${g.events.length} times`}
                      className="mx-3.5 mb-3 flex flex-col divide-y divide-border/60 rounded-lg bg-muted/50 text-[13px] md:mx-4 md:ml-[112px]"
                    >
                      {[...g.events].reverse().map((ev) => (
                        <li key={ev.id} className="flex flex-wrap gap-x-3 px-3 py-1.5">
                          <span className="tabular-nums">
                            {new Date(ev.created_at).toLocaleTimeString("en-GB")}
                          </span>
                          {ev.ip_address && (
                            <span className="text-muted-foreground">IP {ev.ip_address}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
