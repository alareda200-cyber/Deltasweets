import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { entriesQuery, linesQuery } from "@/lib/queries";
import { JellyJar } from "@/components/motion";
import { cn } from "@/lib/utils";

type Stage = "making" | "packing";

function monthRange(): { from: string; to: string; label: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${y}-${pad(m + 1)}-01`;
  const to = `${y}-${pad(m + 1)}-${pad(now.getDate())}`;
  const label = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  return { from, to, label };
}

/**
 * Live preview beside the Targets inputs: the same month of one line judged
 * against the target being typed. Moving the target never changes what was
 * made — only which days count as a win — so days that cross the line gain
 * or lose their star as you type.
 */
export function TargetsPreview({
  makingPct,
  packingPct,
}: {
  /** Parsed live values from the form; null while the field is invalid. */
  makingPct: number | null;
  packingPct: number | null;
}) {
  const { data: allLines = [] } = useQuery(linesQuery);
  const lines = allLines.filter((l) => l.is_active);
  const [lineId, setLineId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("making");
  const line = lines.find((l) => l.id === lineId) ?? lines[0];
  const { from, to, label } = useMemo(monthRange, []);
  const entriesQ = useQuery(entriesQuery(line?.id ?? null, from, to));

  const target = stage === "making" ? makingPct : packingPct;
  const days = useMemo(() => {
    const byDay = new Map<string, { actual: number; plan: number }>();
    for (const e of entriesQ.data ?? []) {
      const d = byDay.get(e.entry_date) ?? { actual: 0, plan: 0 };
      d.actual += (stage === "making" ? e.making_actual : e.packing_actual) ?? 0;
      d.plan += (stage === "making" ? e.making_plan : e.packing_plan) ?? 0;
      byDay.set(e.entry_date, d);
    }
    return [...byDay.entries()]
      .filter(([, d]) => d.plan > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, pct: (d.actual / d.plan) * 100 }));
  }, [entriesQ.data, stage]);

  const last = days[days.length - 1];
  const hits = target == null ? 0 : days.filter((d) => d.pct >= target).length;
  const top = Math.max(110, ...days.map((d) => d.pct));
  const stageLabel = stage === "making" ? "Making" : "Packing";

  return (
    <section
      aria-labelledby="targets-preview"
      className="space-y-3 rounded-xl border border-border bg-muted/40 p-3.5 md:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="targets-preview" className="text-sm font-semibold">
          Preview · {label}
        </h3>
        <div role="group" aria-label="Stage" className="flex rounded-lg bg-muted p-0.5">
          {(["making", "packing"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={stage === s}
              onClick={() => setStage(s)}
              className={cn(
                "ds-squish h-11 rounded-md px-3 text-sm md:h-8",
                stage === s ? "bg-card font-semibold shadow-sm" : "text-muted-foreground",
              )}
            >
              {s === "making" ? "Making" : "Packing"}
            </button>
          ))}
        </div>
      </div>

      {lines.length > 1 && (
        <div role="group" aria-label="Line" className="scrollbar-hide -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {lines.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={l.id === line?.id}
              onClick={() => setLineId(l.id)}
              className={cn(
                "ds-squish h-11 shrink-0 rounded-full border px-3 text-sm md:h-8",
                l.id === line?.id
                  ? "border-primary bg-primary/10 font-semibold text-primary"
                  : "border-border bg-card text-foreground",
              )}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}

      {entriesQ.isPending ? (
        <div className="ds-shimmer h-40 rounded-lg" aria-hidden="true" />
      ) : days.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No {stageLabel.toLowerCase()} plan recorded for {line?.name ?? "this line"} this month
          yet — nothing to judge against the target.
        </p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex items-center gap-3 sm:w-56 sm:shrink-0">
            <JellyJar
              pct={last?.pct ?? null}
              target={target ?? 0}
              labelText={line?.name}
              size={104}
            />
            <div className="min-w-0 text-sm">
              <p className="text-xs text-muted-foreground">Last day · {last?.date.slice(8)}</p>
              <p
                className={cn(
                  "text-lg font-bold tabular-nums",
                  target != null && last && last.pct >= target
                    ? "text-success-strong"
                    : "text-warning-strong",
                )}
              >
                {last ? `${last.pct.toFixed(1)}%` : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="text-base font-bold text-foreground tabular-nums">{hits}</span> of{" "}
                {days.length} days at {target == null ? "—" : `${target}%`}
              </p>
            </div>
          </div>

          <div
            role="img"
            aria-label={`${line?.name}, ${label}: ${hits} of ${days.length} days reached the ${stageLabel.toLowerCase()} target of ${target ?? "—"}%`}
            className="relative h-32 min-w-0 flex-1"
          >
            {target != null && (
              <span
                aria-hidden="true"
                data-target-line=""
                className="absolute inset-x-0 z-10 border-t-2 border-dashed border-foreground/55"
                style={{
                  bottom: `${Math.min(100, (target / top) * 100)}%`,
                  transition: "bottom 420ms var(--ease-spring)",
                }}
              />
            )}
            <div className="absolute inset-0 flex items-end gap-[3px]">
              {days.map((d) => {
                const hit = target != null && d.pct >= target;
                return (
                  <div key={d.date} className="relative flex h-full min-w-0 flex-1 items-end">
                    <div
                      className={cn(
                        "w-full rounded-t-sm",
                        hit ? "bg-warning" : "bg-primary/70",
                      )}
                      style={{
                        height: `${Math.min(100, (d.pct / top) * 100)}%`,
                        transition: "background-color 260ms ease",
                      }}
                    />
                    {hit && (
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        data-star=""
                        className="ds-pop-in absolute left-1/2 h-3 w-3 -translate-x-1/2"
                        style={{ bottom: `calc(${Math.min(100, (d.pct / top) * 100)}% + 2px)` }}
                      >
                        <path
                          d="M12 2l2.9 6.9L22 9.3l-5.4 4.8L18.2 22 12 18.3 5.8 22l1.6-7.9L2 9.3l7.1-.4z"
                          fill="var(--color-warning)"
                        />
                      </svg>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Moving a target never changes what was made — only which days count as a win.
      </p>
    </section>
  );
}
