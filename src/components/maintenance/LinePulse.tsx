import { cn } from "@/lib/utils";
import type { MaintenanceEvent } from "@/lib/queries";

// One heartbeat per line under "Right now": a moving trace while the line is
// not stopped, a flat red line when a fault is stopping it. The motion says
// "live"; the colour and the words carry the meaning, so reduced motion loses
// nothing but the movement.
const TRACE =
  "M0 14 H40 L46 14 L50 4 L55 22 L60 10 L64 14 H100 L106 14 L110 4 L115 22 L120 10 L124 14 H170";

export function LinePulse({
  lines,
  openFaults,
}: {
  lines: { id: string; name: string; is_active?: boolean }[];
  openFaults: MaintenanceEvent[];
}) {
  const active = lines.filter((l) => l.is_active !== false);
  if (active.length === 0) return null;
  return (
    <ul
      aria-label="Line status"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6 md:gap-3"
    >
      {active.map((l, i) => {
        const faults = openFaults.filter((e) => e.line_id === l.id);
        const stopped = faults.some((e) => e.stops_line);
        const defects = faults.filter((e) => !e.stops_line).length;
        const sub = stopped
          ? "Stopped"
          : defects > 0
            ? `Not stopped · ${defects} known defect${defects === 1 ? "" : "s"}`
            : "No open faults";
        return (
          <li
            key={l.id}
            className={cn(
              "flex min-w-0 flex-col gap-0.5 rounded-lg border px-3 py-2",
              stopped ? "border-destructive/40 bg-destructive/10" : "border-border bg-card",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold">{l.name}</span>
              <span
                aria-hidden="true"
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  stopped ? "ds-pulse-stop bg-destructive" : "bg-success",
                )}
              />
            </span>
            <svg
              viewBox="0 0 170 26"
              aria-hidden="true"
              className="h-5 w-full"
              preserveAspectRatio="none"
            >
              <path
                d={stopped ? "M0 14 H170" : TRACE}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                className={stopped ? undefined : "ds-ekg"}
                style={{
                  stroke: stopped ? "var(--destructive)" : "var(--success)",
                  animationDuration: `${1400 + (i % 5) * 130}ms`,
                }}
              />
            </svg>
            <span
              className={cn(
                "truncate text-xs",
                stopped ? "font-semibold text-destructive-strong" : "text-muted-foreground",
              )}
            >
              {sub}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
