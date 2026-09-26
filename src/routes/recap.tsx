import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, Share2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Odometer } from "@/components/motion";
import { supabase } from "@/integrations/supabase/client";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { iso } from "@/lib/date-utils";
import { requireSession } from "@/lib/require-session";
import {
  DEFAULT_TARGETS,
  entryDowntimesForEntriesQuery,
  linesQuery,
  maintenanceEventsQuery,
  openMaintenanceEventsQuery,
  productionTargetsQuery,
  type DailyEntry,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

interface RecapSearch {
  month?: string;
}

export const Route = createFileRoute("/recap")({
  head: () => ({ meta: [{ title: "Month recap · Production Scorecard" }] }),
  validateSearch: (search: Record<string, unknown>): RecapSearch => ({
    month:
      typeof search.month === "string" && /^\d{4}-\d{2}$/.test(search.month)
        ? search.month
        : undefined,
  }),
  beforeLoad: requireSession,
  loader: ({ context }) => context.queryClient.ensureQueryData(linesQuery),
  component: () => (
    <RequireAuth requirePermission="dashboard.view">
      <RecapPage />
    </RequireAuth>
  ),
});

// Every line's entries for the month in one request (entriesQuery is per line).
const monthEntriesQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ["entries-all-lines", from, to],
    queryFn: async (): Promise<DailyEntry[]> => {
      const { data, error } = await supabase
        .from("daily_entries")
        .select("*")
        .gte("entry_date", from)
        .lte("entry_date", to)
        .order("entry_date");
      if (error) throw error;
      return (data ?? []) as DailyEntry[];
    },
  });

const CARD_MS = 5200;
const kgFmt = (n: number) => Math.round(n).toLocaleString("en-US");

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const today = new Date();
  const to = last > today ? today : last;
  return {
    from: iso(first),
    to: iso(to),
    label: first.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    short: first.toLocaleDateString("en-GB", { month: "long" }),
    range: `${first.getDate()}–${to.getDate()} ${first.toLocaleDateString("en-GB", { month: "short" })}`,
  };
}
function addMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const dayName = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

function RecapPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/recap" });
  const { role } = useAuth();
  const reduced = usePrefersReducedMotion();
  const thisMonth = iso(new Date()).slice(0, 7);
  const month = search.month ?? thisMonth;
  const b = monthBounds(month);
  const canFaults = can(role, "dashboard.viewMaintenanceCard");

  const { data: lines } = useSuspenseQuery(linesQuery);
  const { data: targets = DEFAULT_TARGETS } = useQuery(productionTargetsQuery());
  const entriesQ = useQuery(monthEntriesQuery(b.from, b.to));
  const entries = useMemo(() => entriesQ.data ?? [], [entriesQ.data]);
  const downtimesQ = useQuery(entryDowntimesForEntriesQuery(entries.map((e) => e.id)));
  const eventsQ = useQuery({
    ...maintenanceEventsQuery(null, null, null, b.from, b.to),
    enabled: canFaults,
  });
  const openQ = useQuery({ ...openMaintenanceEventsQuery(null), enabled: canFaults });
  const critical = useMemo(
    () =>
      (openQ.data ?? [])
        .filter(
          (e) => !e.stops_line && (e.severity_label ?? "").trim().toLowerCase() === "critical",
        )
        .sort((a, c) => a.started_at.localeCompare(c.started_at)),
    [openQ.data],
  );
  const since = critical[0]?.started_at.slice(0, 10) ?? null;
  const sinceQ = useQuery({
    ...maintenanceEventsQuery(null, null, null, since, null),
    enabled: canFaults && !!since,
  });

  const data = useMemo(() => {
    const byLine = lines
      .map((l) => {
        const es = entries.filter((e) => e.line_id === l.id);
        const made = es.reduce((a, e) => a + (e.making_actual ?? 0), 0);
        const plan = es.reduce((a, e) => a + (e.making_plan ?? 0), 0);
        return { name: l.name, made, plan, n: es.length };
      })
      .filter((l) => l.n > 0)
      .sort((a, c) => c.made - a.made);
    const total = byLine.reduce((a, l) => a + l.made, 0);
    // Days at the making target: each line-day (shifts summed).
    const dayMap = new Map<string, { line: string; date: string; a: number; p: number }>();
    for (const e of entries) {
      const k = `${e.line_id}|${e.entry_date}`;
      const row = dayMap.get(k) ?? {
        line: lines.find((l) => l.id === e.line_id)?.name ?? "—",
        date: e.entry_date,
        a: 0,
        p: 0,
      };
      row.a += e.making_actual ?? 0;
      row.p += e.making_plan ?? 0;
      dayMap.set(k, row);
    }
    const lineDays = [...dayMap.values()].filter((d) => d.p > 0);
    const hits = lineDays
      .map((d) => ({ ...d, pct: (d.a / d.p) * 100 }))
      .filter((d) => d.pct >= targets.makingPct)
      .sort((a, c) => c.pct - a.pct);
    const best = [...lineDays].sort((a, c) => c.a - a.a)[0];
    // Downtime from the entries.
    const dts = downtimesQ.data ?? [];
    const dtTotal = dts.reduce((a, d) => a + d.minutes, 0);
    const reasons = new Map<string, number>();
    for (const d of dts) reasons.set(d.reason_name, (reasons.get(d.reason_name) ?? 0) + d.minutes);
    const topReason = [...reasons.entries()].sort((a, c) => c[1] - a[1])[0] ?? null;
    // Machine faults (preventive is not a fault).
    const faults = (eventsQ.data ?? []).filter((e) => e.type !== "preventive");
    const fam = new Map<string, number>();
    for (const f of faults) {
      const k = f.title.trim().split(/\s+/)[0] ?? f.title;
      fam.set(k, (fam.get(k) ?? 0) + 1);
    }
    const topFam = [...fam.entries()].sort((a, c) => c[1] - a[1])[0] ?? null;
    // The open Critical defect followed by the most faults on its line.
    const impact = critical
      .map((d) => ({
        d,
        n: (sinceQ.data ?? []).filter(
          (e) =>
            e.id !== d.id &&
            e.line_id === d.line_id &&
            e.type !== "preventive" &&
            e.started_at >= d.started_at,
        ).length,
      }))
      .sort((a, c) => c.n - a.n)[0];
    const rework = entries.reduce(
      (a, e) => a + (e.rework_cooking ?? 0) + (e.rework_making ?? 0) + (e.rework_packing ?? 0),
      0,
    );
    return {
      byLine,
      total,
      hits,
      lineDays,
      best,
      dtTotal,
      topReason,
      faults,
      topFam,
      impact,
      rework,
    };
  }, [lines, entries, targets.makingPct, downtimesQ.data, eventsQ.data, critical, sinceQ.data]);

  // --- cards --------------------------------------------------------------
  const cards: { key: string; bg: string; body: ReactNode }[] = [];
  cards.push({
    key: "intro",
    bg: "from-[var(--story-1a)] to-[var(--story-1b)]",
    body: (
      <>
        <p className="text-sm font-bold opacity-80">
          {b.range} {b.label.split(" ")[1]}
        </p>
        <p className="mt-2 text-4xl font-black leading-tight">
          Your {b.short}
          <br />
          in {data.impact ? 7 : 6} cards
        </p>
        <p className="mt-3 text-base opacity-85">
          {data.byLine.length} lines · {entries.length} daily entries · every number straight from
          the scorecard.
        </p>
      </>
    ),
  });
  cards.push({
    key: "kg",
    bg: "from-[var(--story-2a)] to-[var(--story-2b)]",
    body: (
      <>
        <p className="text-sm font-bold opacity-80">You made</p>
        <p className="mt-1 text-5xl font-black leading-none">
          <Odometer value={data.total} decimals={0} grouping />
        </p>
        <p className="text-lg font-bold">kilograms of sweets</p>
        <ul className="mt-6 space-y-3">
          {data.byLine.map((l, i) => (
            <li key={l.name}>
              <div className="flex justify-between text-sm">
                <span className="font-bold">{l.name}</span>
                <span className="tabular-nums opacity-85">
                  {kgFmt(l.made)} kg
                  {l.plan > 0 ? ` · ${((l.made / l.plan) * 100).toFixed(1)}%` : ""}
                </span>
              </div>
              <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/20">
                <div
                  className="ds-fill-x h-full rounded-full bg-white"
                  style={{
                    width: `${(l.made / Math.max(1, data.byLine[0].made)) * 100}%`,
                    animationDelay: `${400 + i * 140}ms`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
        {data.byLine[0] && data.total > 0 && (
          <p className="mt-4 text-sm opacity-85">
            {data.byLine[0].name} carried {Math.round((data.byLine[0].made / data.total) * 100)}% of
            it.
          </p>
        )}
      </>
    ),
  });
  cards.push({
    key: "target",
    bg: "from-[var(--story-3a)] to-[var(--story-3b)]",
    body: (
      <>
        <p className="text-sm font-bold opacity-80">
          Days at the {targets.makingPct}% making target
        </p>
        <p className="mt-1 text-8xl font-black leading-none">{data.hits.length}</p>
        <p className="text-lg font-bold">out of {data.lineDays.length} line-days</p>
        <ul className="mt-5 space-y-2">
          {data.hits.slice(0, 4).map((h, i) => (
            <li
              key={h.line + h.date}
              className="flex items-center gap-3 rounded-2xl bg-white/15 px-3 py-2.5"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="ds-pop-in h-7 w-7 shrink-0"
                style={{ animationDelay: `${300 + i * 200}ms` }}
              >
                <path
                  d="M12 2l2.9 6.9L22 9.3l-5.4 4.8L18.2 22 12 18.3 5.8 22l1.6-7.9L2 9.3l7.1-.4z"
                  fill="white"
                />
              </svg>
              <span className="flex-1 text-sm font-bold">
                {h.line} <span className="font-normal opacity-85">· {dayName(h.date)}</span>
              </span>
              <span className="text-lg font-black tabular-nums">{h.pct.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
        {data.hits.length === 0 && (
          <p className="mt-4 text-base opacity-90">
            None yet this month — the next one is the first.
          </p>
        )}
      </>
    ),
  });
  if (data.topReason) {
    const share = data.dtTotal > 0 ? data.topReason[1] / data.dtTotal : 0;
    cards.push({
      key: "time",
      bg: "from-[var(--story-4a)] to-[var(--story-4b)]",
      body: (
        <>
          <p className="text-sm font-bold opacity-80">Where the time went</p>
          <p className="mt-2 text-3xl font-black leading-tight">
            {data.topReason[0]} took the most time
          </p>
          <p className="mt-4 flex items-baseline gap-2">
            <span className="text-7xl font-black leading-none">
              {Math.round(data.topReason[1] / 60)}
            </span>
            <span className="text-xl font-bold">hours</span>
          </p>
          <p className="text-base opacity-85">
            {kgFmt(data.topReason[1])} of {kgFmt(data.dtTotal)} downtime minutes in the entries
          </p>
          <div className="mt-6 h-6 overflow-hidden rounded-lg bg-white/20">
            <div
              className="ds-fill-x h-full bg-white"
              style={{ width: `${share * 100}%`, animationDelay: "300ms" }}
            />
          </div>
          <p className="mt-2 text-sm opacity-80">{Math.round(share * 100)}% of all downtime</p>
        </>
      ),
    });
  }
  if (canFaults && data.faults.length > 0) {
    const n = data.faults.length;
    const top = data.topFam;
    cards.push({
      key: "faults",
      bg: "from-[var(--story-5a)] to-[var(--story-5b)]",
      body: (
        <>
          <p className="text-sm font-bold opacity-80">Machine faults logged</p>
          <p className="mt-1 text-7xl font-black leading-none">
            <Odometer value={n} decimals={0} grouping />
          </p>
          {top && (
            <p className="text-lg font-bold">
              {kgFmt(top[1])} of them “{top[0]} …”
            </p>
          )}
          <div
            className="mt-5 flex max-h-64 flex-wrap gap-[3px] overflow-hidden"
            role="img"
            aria-label={`${n} faults`}
          >
            {Array.from({ length: Math.min(n, 900) }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "ds-pop-in h-1.5 w-1.5 rounded-[2px]",
                  i < (top?.[1] ?? 0) ? "bg-white" : "bg-warning",
                )}
                style={{ animationDelay: `${Math.round(i * 1.6)}ms` }}
              />
            ))}
          </div>
          <p className="mt-2 text-xs opacity-75">
            1 dot = 1 fault{n > 900 ? " (first 900 shown)" : ""} · preventive not counted
          </p>
        </>
      ),
    });
  }
  if (canFaults && data.impact) {
    const d = data.impact.d;
    const days = Math.floor((Date.now() - new Date(d.started_at).getTime()) / 86_400_000);
    cards.push({
      key: "fix",
      bg: "from-[var(--story-6a)] to-[var(--story-6b)]",
      body: (
        <>
          <p className="text-sm font-bold opacity-80">The one to fix</p>
          <p className="mt-2 text-3xl font-black leading-tight">
            {d.title} on {d.production_lines?.name ?? "—"}
          </p>
          <span className="mt-2 inline-flex self-start rounded-full bg-white px-2.5 py-1 text-xs font-extrabold text-destructive-strong">
            CRITICAL · open {days} days
          </span>
          <div className="relative mt-8 grid h-48 w-48 place-items-center self-center">
            <span
              aria-hidden="true"
              className="ds-ripple absolute inset-10 rounded-full border-4 border-white/60"
            />
            <span
              aria-hidden="true"
              className="ds-ripple absolute inset-10 rounded-full border-4 border-white/60"
              style={{ animationDelay: "900ms" }}
            />
            <span className="grid h-32 w-32 place-items-center rounded-full bg-destructive text-center">
              <span>
                <span className="block text-3xl font-black">{kgFmt(data.impact.n)}</span>
                <span className="block text-xs font-bold">faults since</span>
              </span>
            </span>
          </div>
          <p className="mt-6 text-base opacity-90">
            It doesn’t stop the line. But since it opened, {d.production_lines?.name ?? "the line"}{" "}
            logged {kgFmt(data.impact.n)} faults.
          </p>
        </>
      ),
    });
  }
  cards.push({
    key: "end",
    bg: "from-[var(--story-7a)] to-[var(--story-7b)]",
    body: (
      <>
        <p className="text-sm font-bold opacity-80">Next month’s one number</p>
        {data.best ? (
          <>
            <p className="mt-2 text-4xl font-black leading-tight">Beat {kgFmt(data.best.a)} kg</p>
            <p className="mt-2 text-base opacity-90">
              {data.best.line}’s best day — {dayName(data.best.date)},{" "}
              {((data.best.a / data.best.p) * 100).toFixed(1)}% of plan.
            </p>
          </>
        ) : (
          <p className="mt-2 text-3xl font-black">No entries yet this month.</p>
        )}
        <div className="mt-6 grid grid-cols-2 gap-2">
          {[
            [kgFmt(data.total), "kg made"],
            [String(data.hits.length), "days at target"],
            [canFaults ? kgFmt(data.faults.length) : "—", "machine faults"],
            [kgFmt(data.rework), "kg rework"],
          ].map(([v, k]) => (
            <div key={k} className="rounded-2xl bg-white/15 p-3">
              <div className="text-2xl font-black tabular-nums">{v}</div>
              <div className="text-xs opacity-80">{k}</div>
            </div>
          ))}
        </div>
      </>
    ),
  });

  // --- player -------------------------------------------------------------
  const [i, setI] = useState(0);
  const [p, setP] = useState(0);
  const [playing, setPlaying] = useState(true);
  const n = cards.length;
  const idx = Math.min(i, n - 1);
  const ready = !entriesQ.isPending;
  // The clock lives in refs; state only mirrors it for rendering, so no
  // updater has side effects (StrictMode may run updaters twice).
  const clock = useRef({ i: 0, p: 0 });
  clock.current.i = idx;
  useEffect(() => {
    if (!playing || reduced || !ready) return;
    let raf = 0;
    let last: number | null = null;
    const step = (now: number) => {
      if (last == null) last = now;
      const dt = now - last;
      last = now;
      const c = clock.current;
      c.p += dt / CARD_MS;
      if (c.p >= 1) {
        if (c.i >= n - 1) {
          c.p = 1;
          setP(1);
          setPlaying(false);
          return;
        }
        c.i += 1;
        c.p = 0;
        setI(c.i);
      }
      setP(c.p);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, reduced, ready, n]);

  const go = (to: number) => {
    const next = Math.max(0, Math.min(n - 1, to));
    clock.current = { i: next, p: 0 };
    setI(next);
    setP(0);
  };
  const share = async () => {
    const text = `${b.label} at Delta Sweets: ${kgFmt(data.total)} kg made, ${data.hits.length} days at the ${targets.makingPct}% target${canFaults ? `, ${kgFmt(data.faults.length)} machine faults` : ""}.`;
    try {
      if (navigator.share) await navigator.share({ title: `${b.label} recap`, text });
      else {
        await navigator.clipboard.writeText(text);
        toast.success("Summary copied");
      }
    } catch {
      /* user cancelled the share sheet */
    }
  };

  const card = cards[idx];
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-[460px] flex-col gap-3 px-4 py-4 md:py-8">
        <div className="flex items-center justify-between gap-2">
          <Link
            to="/recap"
            search={{ month: addMonth(month, -1) }}
            aria-label="Previous month"
            className="ds-squish grid h-11 w-11 place-items-center rounded-full border border-border bg-card"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-bold">{b.label} recap</h1>
          <Link
            to="/recap"
            search={{ month: addMonth(month, 1) }}
            aria-label="Next month"
            aria-disabled={month >= thisMonth}
            className={cn(
              "ds-squish grid h-11 w-11 place-items-center rounded-full border border-border bg-card",
              month >= thisMonth && "pointer-events-none opacity-40",
            )}
          >
            <ChevronRight className="h-5 w-5" />
          </Link>
        </div>

        <section
          aria-roledescription="story"
          aria-label={`${b.label} recap, card ${idx + 1} of ${n}`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") go(idx + 1);
            if (e.key === "ArrowLeft") go(idx - 1);
            if (e.key === " ") {
              e.preventDefault();
              setPlaying((v) => !v);
            }
          }}
          className={cn(
            "relative h-[640px] max-h-[calc(100dvh-180px)] min-h-[520px] overflow-hidden rounded-3xl bg-gradient-to-br text-white shadow-elevated outline-none focus-visible:ring-2 focus-visible:ring-ring",
            card.bg,
          )}
          style={{ transition: "background 600ms ease" }}
        >
          <div className="absolute inset-x-3 top-3 z-20 flex gap-1" aria-hidden="true">
            {cards.map((c, k) => (
              <span key={c.key} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
                <span
                  className="block h-full bg-white"
                  style={{ width: `${k < idx ? 100 : k === idx ? (reduced ? 100 : p * 100) : 0}%` }}
                />
              </span>
            ))}
          </div>
          <div className="absolute inset-x-3 top-6 z-20 flex items-center justify-between">
            <span className="text-xs font-bold opacity-85">Delta Sweets · {b.short}</span>
            <span className="flex gap-1">
              <button
                type="button"
                onClick={share}
                aria-label="Share summary"
                className="ds-squish grid h-11 w-11 place-items-center rounded-full bg-white/15"
              >
                <Share2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPlaying((v) => !v)}
                aria-label={playing ? "Pause" : "Play"}
                className="ds-squish grid h-11 w-11 place-items-center rounded-full bg-white/15"
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
            </span>
          </div>
          <button
            type="button"
            aria-label="Previous card"
            onClick={() => go(idx - 1)}
            className="absolute bottom-0 left-0 top-20 z-10 w-1/3"
          />
          <button
            type="button"
            aria-label="Next card"
            onClick={() => go(idx + 1)}
            className="absolute bottom-0 right-0 top-20 z-10 w-2/3"
          />
          {ready ? (
            <div
              key={card.key}
              className="ds-slide-in pointer-events-none absolute inset-x-6 bottom-8 top-24 flex flex-col"
            >
              {card.body}
            </div>
          ) : (
            <div className="absolute inset-x-6 top-24 space-y-3">
              <div className="ds-shimmer h-6 w-2/3 rounded" />
              <div className="ds-shimmer h-16 w-full rounded" />
            </div>
          )}
        </section>
        <p className="text-center text-xs text-muted-foreground">
          Tap the right side for the next card, the left side to go back. {b.range}.
        </p>
      </div>
    </AppShell>
  );
}
