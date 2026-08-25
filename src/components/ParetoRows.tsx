import { fmt } from "@/lib/date-utils";

// One hue for every corrective cause, amber for preventive. NOT a ramp:
// colouring each bar darker-where-bigger double-encodes bar length as hue on
// categories with no natural order, and burns the only free channel on
// information the bar already shows. Colour states a category here — fault vs
// scheduled work — nothing else.
export const PARETO_FILL = "linear-gradient(90deg, oklch(0.72 0.16 258), oklch(0.52 0.19 258))";
export const PARETO_FILL_PM = "linear-gradient(90deg, oklch(0.80 0.15 75), oklch(0.60 0.15 75))";

export type ParetoRow = {
  /** Stable React key — must be unique within the list. */
  key: string;
  /** Full cause name, printed whole. */
  label: string;
  /** Extra context for the hover title, e.g. the area. */
  hint?: string;
  minutes: number;
  /** Share of the card's own total — see the note on `cumulative` below. */
  pct: number;
  preventive: boolean;
};

// Pareto as rows rather than columns. Twelve causes across a column axis leaves
// ~65px per label, so every name has to be clipped — a category axis whose
// categories can't be read is not a Pareto. Down the page each name prints
// whole, and the width that frees up pays for the Share and Cumulative columns,
// which had nowhere to live before.
//
// Shared by DowntimeSection and MaintenanceDowntimeCard on purpose: these two
// cards sit on the same dashboard and previously drifted into two different
// colour ramps. One component, one language.
export function ParetoRows({ rows }: { rows: ParetoRow[] }) {
  const max = rows[0]?.minutes ?? 1;
  let cum = 0;
  let cutPlaced = false;
  // Every track is a minmax, not a fixed width. The old template asked for
  // 160px + 72 + 56 + 60 + gaps + padding = 412px of hard minimum before the
  // 3fr bar column got a single pixel, so at 390px the bar collapsed to 0 and
  // the row STILL overflowed into a horizontal scrollbar. Both call sites
  // happen to wrap this in `hidden md:block`, which hid the bug rather than
  // fixing it — and the PDF export path deliberately forces that wrapper
  // visible, so the wrapper is not a guarantee. Floors now total 286px
  // (+32 gap +16 padding = 334), which fits 390px with room for the bar,
  // while the ceilings keep the wide layout pixel-identical to before.
  const cols =
    "grid grid-cols-[minmax(96px,1.1fr)_minmax(40px,3fr)_minmax(54px,72px)_minmax(46px,56px)_minmax(50px,60px)] items-center gap-2";
  return (
    <div className="mt-2">
      <div
        className={`${cols} border-b border-border px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground`}
      >
        <span>Cause</span>
        <span />
        <span className="text-right">Min</span>
        <span className="text-right">Share</span>
        <span className="text-right">Cum.</span>
      </div>
      {rows.map((r, i) => {
        cum += r.pct;
        const cut = !cutPlaced && cum >= 80;
        if (cut) cutPlaced = true;
        return (
          <div key={r.key}>
            <div className={`${cols} rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50`}>
              {/* The name wraps rather than truncating, and the area prints as
                  its own line instead of hiding in a `title` — hover text is
                  unreachable on touch and by keyboard, and this card's mobile
                  sibling had already been fixed the same way. Rows exist here
                  precisely so a cause name can be read whole; clipping it
                  would give back the thing the column chart was replaced for. */}
              <span className="min-w-0 text-xs leading-snug">
                <span className={i === 0 ? "font-semibold" : "text-muted-foreground"}>
                  {r.label}
                </span>
                {r.hint && (
                  <span className="block text-[10px] text-muted-foreground">{r.hint}</span>
                )}
              </span>
              <span className="block h-4 overflow-hidden rounded-r-md bg-muted">
                <span
                  className="block h-full rounded-r-md"
                  style={{
                    width: `${Math.max(1.5, (r.minutes / max) * 100)}%`,
                    background: r.preventive ? PARETO_FILL_PM : PARETO_FILL,
                  }}
                />
              </span>
              <span className="text-right font-mono text-xs tabular-nums">{fmt(r.minutes)}</span>
              <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                {r.pct.toFixed(1)}%
              </span>
              <span className="text-right font-mono text-[11px] font-semibold tabular-nums text-primary">
                {cum.toFixed(1)}%
              </span>
            </div>
            {cut && (
              // `pct` is each card's share of ITS OWN total (all downtime for
              // DowntimeSection, all-sources maintenance minutes for the
              // Maintenance card) — not of the twelve rows shown. So when a card
              // has more causes than it displays, the last row stops short of
              // 100%. That is correct, and each card already carries a
              // "showing top N of M" note saying why.
              <div className="my-1 border-y border-dashed border-border bg-muted/30 px-2 py-1.5 text-[11px] font-semibold text-primary">
                — 80% of all downtime sits above this line · the vital few —
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
