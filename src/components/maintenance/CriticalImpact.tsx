import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { MaintenanceEvent } from "@/lib/queries";
import { Odometer } from "@/components/motion";

// "Critical" in this plant means: the defect does not stop the line, but it
// drives other faults on it (decided 26 Sep 2026). So for each open Critical
// defect that isn't stopping its line, show what followed on the same line
// since it opened: how many faults (preventive excluded), and which ones.
// Same line and same period — a link, not a proven cause; the copy says so.

interface Impact {
  defect: MaintenanceEvent;
  count: number;
  top: { title: string; n: number }[];
  topShare: number;
}

export function isCriticalDefect(e: MaintenanceEvent): boolean {
  return !e.stops_line && (e.severity_label ?? "").trim().toLowerCase() === "critical";
}

export function CriticalImpact({
  openFaults,
  allEvents,
}: {
  openFaults: MaintenanceEvent[];
  allEvents: MaintenanceEvent[];
}) {
  const impacts: Impact[] = useMemo(() => {
    const defects = openFaults
      .filter(isCriticalDefect)
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
    return defects.map((d) => {
      const since = new Date(d.started_at).getTime();
      const after = allEvents.filter(
        (e) =>
          e.id !== d.id &&
          e.line_id != null &&
          e.line_id === d.line_id &&
          e.type !== "preventive" &&
          new Date(e.started_at).getTime() >= since,
      );
      const byTitle = new Map<string, { title: string; n: number }>();
      for (const e of after) {
        const k = e.title.trim().toLowerCase();
        const row = byTitle.get(k) ?? { title: e.title.trim(), n: 0 };
        row.n += 1;
        byTitle.set(k, row);
      }
      const top = [...byTitle.values()].sort((a, b) => b.n - a.n).slice(0, 3);
      return {
        defect: d,
        count: after.length,
        top,
        topShare: after.length ? top.reduce((a, t) => a + t.n, 0) / after.length : 0,
      };
    });
  }, [openFaults, allEvents]);

  const [pickId, setPickId] = useState<string | null>(null);
  if (impacts.length === 0) return null;
  const pick = impacts.find((x) => x.defect.id === pickId) ?? impacts[0];
  const per = pick.count > 300 ? 10 : 1;
  const squares = Math.ceil(pick.count / per);
  const topN = pick.top[0]?.n ?? 0;
  const since = new Date(pick.defect.started_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  const lineName = pick.defect.production_lines?.name ?? "this line";

  return (
    <section
      aria-labelledby="critical-impact-heading"
      className="overflow-hidden rounded-xl border border-border bg-card shadow-card"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-3 md:px-5">
        <h3 id="critical-impact-heading" className="text-sm font-semibold md:text-base">
          What the Critical defects are doing
        </h3>
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-destructive-strong">Critical</span> = doesn’t stop the
          line, but drives other faults on it.
        </p>
      </div>

      <div
        role="group"
        aria-label="Critical defect"
        className="flex flex-wrap gap-2 px-4 pt-3 md:px-5"
      >
        {impacts.map((x) => {
          const on = x.defect.id === pick.defect.id;
          return (
            <button
              key={x.defect.id}
              type="button"
              aria-pressed={on}
              onClick={() => setPickId(x.defect.id)}
              className={cn(
                "ds-squish relative min-h-11 overflow-hidden rounded-full border px-3 text-left text-sm",
                on
                  ? "border-destructive/60 bg-destructive/10 font-semibold text-destructive-strong"
                  : "border-border bg-card",
              )}
            >
              {on && x.count > 0 && (
                <span
                  aria-hidden="true"
                  className="ds-ripple pointer-events-none absolute inset-0 rounded-full border-2 border-destructive/40"
                />
              )}
              {x.defect.title} · {x.defect.production_lines?.name ?? "—"}
            </button>
          );
        })}
      </div>

      <div key={pick.defect.id} className="flex flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-5">
        <div className="ds-slide-in flex shrink-0 flex-col gap-1 md:w-72">
          <span className="text-xs text-muted-foreground">
            {lineName} · since {since}
          </span>
          <span className="text-4xl font-extrabold text-destructive-strong md:text-5xl">
            <Odometer value={pick.count} decimals={0} grouping />
          </span>
          <span className="text-sm">
            {pick.count === 0
              ? "No other faults on this line since it opened."
              : `faults logged on ${lineName} since this defect opened`}
          </span>
          {pick.top.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {pick.top.map((t) => (
                <li key={t.title} className="tabular-nums">
                  <span className="font-semibold text-foreground">{t.title}</span> × {t.n}
                </li>
              ))}
            </ul>
          )}
          <span className="mt-1 text-xs text-muted-foreground">
            {pick.count === 0
              ? "Worth asking whether this one should stay Critical."
              : "Same line, same period — a link, not a proven cause."}
          </span>
        </div>
        {pick.count > 0 && (
          <div className="min-w-0 flex-1">
            <div
              role="img"
              aria-label={`${pick.count} faults, ${topN} of them ${pick.top[0]?.title ?? ""}`}
              className="flex max-h-40 flex-wrap content-start gap-1 overflow-hidden"
            >
              {Array.from({ length: squares }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    "ds-pop-in h-2.5 w-2.5 rounded-[3px]",
                    i < Math.round(topN / per) ? "bg-destructive" : "bg-warning",
                  )}
                  style={{ animationDelay: `${Math.min(1400, i * 9)}ms` }}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              1 square = {per} fault{per === 1 ? "" : "s"} · red = {pick.top[0]?.title}, amber =
              everything else
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
