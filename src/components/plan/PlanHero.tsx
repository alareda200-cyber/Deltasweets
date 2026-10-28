// Plan adherence, top of the page (approved mockup "Plan adherence upgrade
// v2", 28 Oct 2026): the month's headline against the forecast with its pace
// track and burn-up chart, the auto insights, and the lines as bullet bars.
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import type { Adherence } from "@/lib/plan-adherence";
import type { OrderGroup } from "@/lib/orders";
import type { Insight } from "@/lib/plan-insights";
import { pctFmt, shortDay, tons } from "@/components/plan/format";

// ------------------------------------------------------------------ hero
export function PlanHero({
  ad,
  groups,
  closedNote,
}: {
  ad: Adherence;
  groups: OrderGroup[];
  closedNote: boolean;
}) {
  const achieved = ad.achieved ?? 0;
  const gapPts = Math.round((achieved - ad.share) * 100);
  const ahead = gapPts >= 0;
  const proj = ad.projectionKg;
  const max = Math.max(proj ?? 0, ad.forecastKg, ad.packedKg, 1) * 1.06;
  const x = (v: number) => Math.min(100, (v / max) * 100);
  const orderedKg = groups.reduce((s, g) => s + g.qtyKg, 0);
  const producedKg = groups.reduce((s, g) => s + g.producedKg, 0);
  const late = groups.filter((g) => g.state === "late").length;
  const rate = ad.daysOver > 0 ? ad.packedKg / ad.daysOver : null;

  const lastCum = [...ad.daily].reverse().find((d) => d.cumKg !== null);
  const lastIdx = lastCum ? ad.daily.indexOf(lastCum) : -1;
  const data = ad.daily.map((d, i) => ({
    i: i + 1,
    day: d.day,
    cum: d.cumKg === null ? null : d.cumKg / 1000,
    pace: d.paceKg / 1000,
    proj:
      proj !== null && lastCum && i >= lastIdx
        ? ((lastCum.cumKg ?? 0) +
            ((proj - (lastCum.cumKg ?? 0)) *
              ad.daily.slice(lastIdx + 1, i + 1).filter((x) => x.working).length) /
              Math.max(1, ad.daily.slice(lastIdx + 1).filter((x) => x.working).length)) /
          1000
        : null,
  }));
  const top = Math.max(ad.forecastKg, proj ?? 0, lastCum?.cumKg ?? 0, 1) / 1000;
  const rough = top / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((f) => f * mag >= rough) ?? 10) * mag;
  const yTicks = Array.from({ length: Math.ceil(top / step) + 1 }, (_, i) => i * step);
  const paceDay = ad.workingDays > 0 ? ad.forecastKg / ad.workingDays : 0;

  return (
    <section
      className="grid overflow-hidden rounded-2xl border border-border bg-card shadow-card md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]"
      data-testid="plan-kpis"
    >
      <div className="flex min-w-0 flex-col gap-3 border-b border-border p-4 md:border-b-0 md:border-r md:p-5">
        {ad.forecastKg > 0 && (
          <span
            className={cn(
              "self-start rounded-full px-2.5 py-0.5 text-xs font-bold",
              ahead
                ? "bg-success/15 text-success-strong"
                : "bg-destructive/10 text-destructive-strong",
            )}
            data-testid="plan-pace"
          >
            {ahead ? "▲ Ahead of pace" : "▼ Behind pace"} · {ahead ? "+" : "−"}
            {Math.abs(gapPts)} pts
          </span>
        )}
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span
            className="text-5xl font-extrabold leading-none tracking-tight tabular-nums md:text-6xl"
            data-testid="plan-achieved"
          >
            {ad.achieved === null ? "—" : (Math.round(achieved * 1000) / 10).toFixed(1)}
            <span className="text-2xl font-bold">%</span>
          </span>
          <span className="text-sm text-muted-foreground">
            of the month&rsquo;s forecast · {tons(ad.packedKg)} of {tons(ad.forecastKg)} t
          </span>
        </p>
        {ad.forecastKg > 0 && (
          <>
            <div className="relative mt-1 h-3.5 rounded-full bg-muted" aria-hidden="true">
              {proj !== null && proj > ad.packedKg && (
                <span
                  className="absolute inset-y-0 rounded-r-full border border-dashed border-primary/60 bg-primary/15"
                  style={{ left: `${x(ad.packedKg)}%`, width: `${x(proj) - x(ad.packedKg)}%` }}
                />
              )}
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                style={{ width: `${x(ad.packedKg)}%` }}
              />
              <span
                className="absolute -inset-y-1.5 w-0.5 rounded bg-foreground"
                style={{ left: `calc(${x(ad.shouldKg)}% - 1px)` }}
              />
              <span
                className="absolute -inset-y-1.5 w-0.5 rounded bg-success-strong"
                style={{ left: `calc(${x(ad.forecastKg)}% - 1px)` }}
              />
            </div>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
              <span>
                <i className="mr-1 inline-block h-2.5 w-0.5 bg-foreground align-middle" />
                Expected by now <b className="text-foreground">{tons(ad.shouldKg)} t</b>
              </span>
              <span>
                <i className="mr-1 inline-block h-2.5 w-0.5 bg-success-strong align-middle" />
                Forecast <b className="text-foreground">{tons(ad.forecastKg)} t</b>
              </span>
              {proj !== null && (
                <span data-testid="plan-projection">
                  <i className="mr-1 inline-block h-2 w-3 border border-dashed border-primary/60 bg-primary/15 align-middle" />
                  Month end{" "}
                  <b className="text-foreground">
                    {tons(proj)} t · {pctFmt(proj / ad.forecastKg)}
                  </b>
                  {rate !== null && <> at {tons(rate)} t a working day</>}
                </span>
              )}
            </p>
          </>
        )}
        <dl className="mt-1 grid grid-cols-3 gap-2">
          <MiniStat label="Export packed" value={`${tons(ad.exportKg)} t`} testId="plan-export" />
          <MiniStat
            label="Orders packed"
            value={orderedKg > 0 ? pctFmt(producedKg / orderedKg) : "—"}
            testId="plan-orders-pct"
          />
          <MiniStat
            label="Late orders"
            value={String(late)}
            tone={late > 0 ? "bad" : undefined}
            testId="plan-late"
          />
        </dl>
        {ad.neededPerDay !== null && ad.forecastKg > ad.packedKg && (
          <p className="text-xs text-muted-foreground">
            {tons(ad.neededPerDay)} t a working day closes the forecast in the {ad.daysLeft}{" "}
            {ad.daysLeft === 1 ? "day" : "days"} left.
          </p>
        )}
      </div>

      <div className="min-w-0 p-3 md:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="text-sm font-semibold md:text-base">Burn-up · packed vs forecast pace</h2>
          <span className="text-xs text-muted-foreground">t, cumulative</span>
        </div>
        <div className="mt-1 h-[200px] w-full md:h-[240px]" data-testid="plan-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              {ad.daily
                .map((d, i) => ({ d, i }))
                .filter(({ d }) => !d.working)
                .map(({ d, i }) => (
                  <ReferenceArea
                    key={d.day}
                    x1={i + 0.5}
                    x2={i + 1.5}
                    fill="var(--color-muted-foreground)"
                    fillOpacity={0.08}
                    strokeOpacity={0}
                    ifOverflow="hidden"
                  />
                ))}
              <XAxis
                dataKey="i"
                type="number"
                domain={[0.5, ad.daily.length + 0.5]}
                ticks={[1, 8, 15, 22, 29].filter((t) => t <= ad.daily.length)}
                tickLine={false}
                axisLine={{ stroke: "var(--color-border)" }}
                tickFormatter={(i: number) => shortDay(ad.daily[i - 1]?.day ?? ad.daily[0].day)}
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              />
              <YAxis
                width={40}
                tickLine={false}
                axisLine={false}
                domain={[0, yTicks[yTicks.length - 1]]}
                ticks={yTicks}
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              />
              <Tooltip
                cursor={{ stroke: "var(--color-foreground)", strokeOpacity: 0.25 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as (typeof data)[number];
                  return (
                    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-card">
                      <p className="font-semibold">{shortDay(row.day)}</p>
                      {row.cum !== null && (
                        <p className="tabular-nums">Packed so far: {tons(row.cum * 1000)} t</p>
                      )}
                      <p className="tabular-nums text-muted-foreground">
                        Forecast pace: {tons(row.pace * 1000)} t
                      </p>
                      {row.cum === null && row.proj !== null && (
                        <p className="tabular-nums text-muted-foreground">
                          At this rate: {tons(row.proj * 1000)} t
                        </p>
                      )}
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="cum"
                stroke="var(--color-primary)"
                strokeWidth={2.25}
                fill="var(--color-primary)"
                fillOpacity={0.1}
                connectNulls={false}
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-card)" }}
              />
              <Line
                type="linear"
                dataKey="pace"
                stroke="var(--color-muted-foreground)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="proj"
                stroke="var(--color-primary)"
                strokeWidth={2}
                strokeDasharray="1 4"
                strokeLinecap="round"
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
          <LegendKey style="solid">Packed</LegendKey>
          <LegendKey style="dashed">{`Forecast pace (${tons(paceDay)} t a working day)`}</LegendKey>
          <LegendKey style="dotted">At this rate</LegendKey>
          <span className="inline-flex items-center gap-1.5">
            <i
              aria-hidden="true"
              className="inline-block h-2.5 w-3 rounded-sm bg-muted-foreground/15"
            />
            Friday / day off
          </span>
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
          Packed = local packing less the B2B orders packed as local
          {ad.b2bLocalKg > 0 ? ` (${tons(ad.b2bLocalKg)} t)` : ""}, like the FG workbook. Export is
          shown apart.
          {closedNote
            ? ""
            : " Fridays are off; record other days off in Settings › Non-production days."}
        </p>
      </div>
    </section>
  );
}

function MiniStat({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: "bad";
  testId?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/60 px-2.5 py-2 md:px-3" data-testid={testId}>
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-base font-bold tabular-nums md:text-lg",
          tone === "bad" && "text-destructive-strong",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function LegendKey({
  style,
  children,
}: {
  style: "solid" | "dashed" | "dotted";
  children: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i
        aria-hidden="true"
        className={cn(
          "inline-block w-3.5 border-t-2",
          style === "dashed"
            ? "border-dashed border-muted-foreground"
            : style === "dotted"
              ? "border-dotted border-primary"
              : "border-primary",
        )}
      />
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ insights
const INSIGHT_STYLE: Record<Insight["kind"], { label: string; bar: string; text: string }> = {
  behind: { label: "Behind", bar: "border-l-destructive-strong", text: "text-destructive-strong" },
  over: { label: "Over forecast", bar: "border-l-warning-strong", text: "text-warning-strong" },
  order: {
    label: "Order risk",
    bar: "border-l-destructive-strong",
    text: "text-destructive-strong",
  },
  calendar: { label: "Calendar", bar: "border-l-primary", text: "text-primary" },
};

export function InsightCards({ items }: { items: Insight[] }) {
  if (items.length === 0) return null;
  return (
    <div
      className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:grid-cols-4 md:gap-3 md:overflow-visible md:px-0 md:pb-0"
      data-testid="plan-insights"
    >
      {items.map((it) => {
        const st = INSIGHT_STYLE[it.kind];
        return (
          <article
            key={it.kind}
            className={cn(
              "w-[82%] min-w-0 shrink-0 snap-start rounded-2xl border border-border border-l-4 bg-card p-3.5 shadow-card sm:w-[46%] md:w-auto md:p-4",
              st.bar,
            )}
          >
            <p className={cn("text-[11px] font-bold uppercase tracking-wider", st.text)}>
              {st.label}
            </p>
            <h3 className="mt-1 text-sm font-semibold">{it.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{it.body}</p>
          </article>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ lines
export function LineBullets({
  ad,
  lineName,
  color,
  selected,
  onPick,
}: {
  ad: Adherence;
  lineName: (id: string | null) => string;
  color: (id: string | null) => string;
  selected: string;
  onPick: (lineId: string) => void;
}) {
  const lines = ad.lines.filter((l) => l.forecastKg > 0 || l.packedKg > 0);
  if (lines.length === 0) return null;
  const max =
    Math.max(1, ...lines.map((l) => Math.max(l.forecastKg, l.projectionKg ?? 0, l.packedKg))) *
    1.04;
  const x = (v: number) => Math.min(100, (v / max) * 100);
  return (
    <section
      className="min-w-0 rounded-2xl border border-border bg-card p-3 shadow-card md:p-4"
      aria-labelledby="by-line"
      data-testid="plan-lines"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="by-line" className="text-sm font-semibold md:text-base">
          By line · packed vs forecast
        </h2>
        <span className="text-[11px] text-muted-foreground">
          bar = packed · light = month end · ▮ forecast · ┆ expected by now · tap to filter SKUs
        </span>
      </div>
      <ul className="mt-2 divide-y divide-border">
        {lines.map((l) => {
          const on = selected !== "" && selected === (l.lineId ?? "");
          const a = l.achieved;
          const tone =
            a === null ? "none" : a >= ad.share ? "good" : a >= ad.share - 0.12 ? "warn" : "bad";
          return (
            <li key={l.lineId ?? "none"}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onPick(l.lineId ?? "")}
                className={cn(
                  "grid w-full grid-cols-1 items-center gap-2 rounded-xl px-1.5 py-2.5 text-left md:grid-cols-[200px_minmax(0,1fr)_300px] md:gap-4",
                  on ? "bg-primary/5 ring-1 ring-primary/40" : "hover:bg-muted/50",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <i
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: color(l.lineId) }}
                  />
                  <span className="truncate text-sm font-semibold">{lineName(l.lineId)}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                      tone === "good" && "bg-success/15 text-success-strong",
                      tone === "warn" && "bg-warning/15 text-warning-strong",
                      tone === "bad" && "bg-destructive/10 text-destructive-strong",
                      tone === "none" && "bg-muted text-muted-foreground",
                    )}
                  >
                    {a === null ? "no forecast" : pctFmt(a)}
                  </span>
                </span>
                <span className="relative block h-3.5 rounded-full bg-muted" aria-hidden="true">
                  {l.projectionKg !== null && l.projectionKg > l.packedKg && (
                    <span
                      className="absolute inset-y-0 rounded-r-full opacity-35"
                      style={{
                        left: `${x(l.packedKg)}%`,
                        width: `${x(l.projectionKg) - x(l.packedKg)}%`,
                        background: color(l.lineId),
                      }}
                    />
                  )}
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${x(l.packedKg)}%`, background: color(l.lineId) }}
                  />
                  {l.forecastKg > 0 && (
                    <>
                      <span
                        className="absolute -inset-y-1 border-l-2 border-dashed border-foreground/60"
                        style={{ left: `${x(l.forecastKg * ad.share)}%` }}
                      />
                      <span
                        className="absolute -inset-y-1.5 w-[3px] rounded bg-foreground"
                        style={{ left: `calc(${x(l.forecastKg)}% - 1.5px)` }}
                      />
                    </>
                  )}
                </span>
                <span className="grid grid-cols-4 gap-2 text-xs">
                  <Stat label="Forecast" value={`${tons(l.forecastKg)} t`} />
                  <Stat label="Packed" value={`${tons(l.packedKg)} t`} />
                  <Stat
                    label="Month end"
                    value={
                      l.projectionKg === null
                        ? "—"
                        : l.forecastKg > 0
                          ? pctFmt(l.projectionKg / l.forecastKg)
                          : `${tons(l.projectionKg)} t`
                    }
                    tone={
                      l.projectionKg !== null && l.forecastKg > 0
                        ? l.projectionKg >= l.forecastKg
                          ? "good"
                          : "bad"
                        : undefined
                    }
                  />
                  <Stat
                    label="Need / day"
                    value={
                      l.neededPerDay !== null && l.neededPerDay > 0
                        ? `${tons(l.neededPerDay)} t`
                        : "—"
                    }
                    tone={l.neededPerDay !== null && l.neededPerDay > 0 ? "bad" : undefined}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <span className="min-w-0">
      <span className="block truncate text-[11px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "block font-bold tabular-nums",
          tone === "good" && "text-success-strong",
          tone === "bad" && "text-destructive-strong",
        )}
      >
        {value}
      </span>
    </span>
  );
}
