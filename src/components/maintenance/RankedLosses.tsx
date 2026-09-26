import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/maintenance-format";

interface Loss {
  title: string;
  totalMinutes: number;
  count: number;
}

const ROWS = 8;
const ROW_H = 44;

// Top losses as one ranked list with two lenses. Switching lens re-ranks the
// same rows: each slides to its new place (spring), so "Servo 1003 is first
// either way" and "Piece bar is one long stop, not a frequent one" are seen,
// not read. Rows that drop out of the top 8 fade away.
export function RankedLosses({
  byDowntime,
  byFrequency,
}: {
  byDowntime: Loss[];
  byFrequency: Loss[];
}) {
  const [lens, setLens] = useState<"time" | "count">("time");
  const all = useMemo(() => {
    const m = new Map<string, Loss>();
    for (const l of [...byDowntime, ...byFrequency]) m.set(l.title.toLowerCase(), l);
    return [...m.values()];
  }, [byDowntime, byFrequency]);

  const ranked = [...all].sort((a, b) =>
    lens === "time" ? b.totalMinutes - a.totalMinutes : b.count - a.count,
  );
  const max = Math.max(
    1,
    ...ranked.slice(0, ROWS).map((l) => (lens === "time" ? l.totalMinutes : l.count)),
  );
  const rankOf = new Map(ranked.map((l, i) => [l.title.toLowerCase(), i]));
  const visible = ranked.slice(0, ROWS);

  if (all.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No losses in this period.</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Switch the lens — the rows re-rank in place.
        </p>
        <div role="group" aria-label="Rank by" className="flex rounded-lg bg-muted p-0.5">
          {(
            [
              ["time", "Time lost"],
              ["count", "How often"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={lens === k}
              onClick={() => setLens(k)}
              className={cn(
                "ds-squish h-11 rounded-md px-3 text-sm md:h-8",
                lens === k ? "bg-card font-semibold shadow-sm" : "text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ol
        className="relative"
        style={{ height: Math.min(ROWS, all.length) * ROW_H }}
        aria-label={`Top losses by ${lens === "time" ? "time lost" : "how often"}`}
      >
        {all.map((l) => {
          const rank = rankOf.get(l.title.toLowerCase()) ?? 0;
          const shown = rank < ROWS;
          const val = lens === "time" ? l.totalMinutes : l.count;
          return (
            <li
              key={l.title.toLowerCase()}
              aria-hidden={!shown}
              className="absolute inset-x-0 top-0 flex items-center gap-3"
              style={{
                height: ROW_H - 6,
                transform: `translateY(${Math.min(rank, ROWS) * ROW_H}px)`,
                opacity: shown ? 1 : 0,
                transition: "transform 700ms var(--ease-spring), opacity 300ms ease",
              }}
            >
              <span className="w-6 shrink-0 text-right text-sm font-bold tabular-nums text-muted-foreground">
                {shown ? rank + 1 : ""}
              </span>
              <span
                className="w-28 shrink-0 truncate text-sm font-semibold md:w-52"
                title={l.title}
              >
                {l.title}
              </span>
              <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted md:h-3">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{
                    width: `${(val / max) * 100}%`,
                    transition: "width 700ms var(--ease-out-soft)",
                  }}
                />
              </span>
              <span className="w-24 shrink-0 text-right text-xs tabular-nums md:w-40 md:text-sm">
                <span className="font-semibold">
                  {lens === "time" ? formatDuration(l.totalMinutes * 60_000) : `${l.count}×`}
                </span>
                <span className="hidden text-muted-foreground md:inline">
                  {" · "}
                  {lens === "time" ? `${l.count}×` : formatDuration(l.totalMinutes * 60_000)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
