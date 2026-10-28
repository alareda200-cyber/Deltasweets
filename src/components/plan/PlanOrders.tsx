// Plan adherence › Orders and Data health (approved mockup "Plan adherence
// upgrade v2", 28 Oct 2026). Orders: the month's B2B and export orders from
// the FG workbook, late ones first (most left to pack first), then open and
// done; a card opens to its lines. Data health: what in the uploaded data
// keeps the page from being right, and where to fix it.
import { cn } from "@/lib/utils";
import type { OrderGroup } from "@/lib/orders";
import type { Adherence } from "@/lib/plan-adherence";
import type { PackedSku, Sku } from "@/lib/packing";
import { num, pctFmt, shortDay, tons } from "@/components/plan/format";

function Ring({ pct, tone }: { pct: number; tone: "late" | "open" | "done" }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const stroke =
    tone === "done"
      ? "var(--color-success-strong)"
      : tone === "late"
        ? "var(--color-destructive-strong)"
        : "var(--color-primary)";
  return (
    <svg viewBox="0 0 40 40" className="h-11 w-11 shrink-0" aria-hidden="true">
      <circle cx="20" cy="20" r={r} fill="none" stroke="var(--color-muted)" strokeWidth="4" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke={stroke}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${Math.min(1, pct) * c} ${c}`}
        transform="rotate(-90 20 20)"
      />
      <text
        x="20"
        y="24"
        textAnchor="middle"
        fontSize="11"
        fontWeight="700"
        fill="var(--color-foreground)"
      >
        {Math.floor(pct * 100)}
      </text>
    </svg>
  );
}

function OrderCard({ g, skuName }: { g: OrderGroup; skuName: (code: string) => string }) {
  return (
    <details className="group rounded-xl border border-border bg-card" data-testid="order-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-2.5 [&::-webkit-details-marker]:hidden">
        <Ring pct={g.pct} tone={g.state} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {g.client ?? "(no client)"} · {g.orderCode ?? "(no code)"}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {[g.country, g.type, `${Math.round(g.qtyKg).toLocaleString("en-US")} kg`]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span className="mt-1 flex flex-wrap gap-1 text-[11px] font-semibold">
            {g.lateDays > 0 && (
              <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive-strong">
                {g.lateDays} d late
              </span>
            )}
            <span className="rounded bg-muted px-1.5 py-0.5">
              {g.doneLines}/{g.lines.length} lines
            </span>
            {g.shipBy && (
              <span className="rounded bg-muted px-1.5 py-0.5">ship {shortDay(g.shipBy)}</span>
            )}
          </span>
        </span>
      </summary>
      <ul className="border-t border-border px-2.5 py-1.5 text-xs">
        {g.lines.map((l) => (
          <li key={l.seq} className="flex items-center gap-2 py-1">
            <span
              aria-hidden="true"
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                l.status === "done"
                  ? "bg-success-strong"
                  : l.status === "started"
                    ? "bg-warning-strong"
                    : "bg-destructive-strong",
              )}
            />
            <span className="min-w-0 flex-1">
              <span dir="rtl" className="block truncate">
                {skuName(l.code) || l.code}
              </span>
              <span className="font-mono text-[10.5px] text-muted-foreground">{l.code}</span>
              {l.delay_reason && (
                <span className="block text-[10.5px] text-muted-foreground">
                  Delay: {l.delay_reason}
                </span>
              )}
            </span>
            <span className="shrink-0 tabular-nums">
              {num(l.produced)} / {num(l.qty)} crt
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function PlanOrders({
  groups,
  skus,
  monthLabel,
}: {
  groups: OrderGroup[];
  skus: Sku[];
  monthLabel: string;
}) {
  const skuBy = new Map(skus.map((s) => [s.code, s.name]));
  const skuName = (c: string) => skuBy.get(c) ?? "";
  if (groups.length === 0)
    return (
      <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
        No B2B or export orders for {monthLabel}. They come from the FG workbook&rsquo;s B2B &amp;
        Export sheet.
      </p>
    );
  const left = (g: OrderGroup) => g.qtyKg - g.producedKg;
  const late = groups.filter((g) => g.state === "late").sort((a, b) => left(b) - left(a));
  const open = groups
    .filter((g) => g.state === "open")
    .sort((a, b) => (a.shipBy ?? "9").localeCompare(b.shipBy ?? "9"));
  const done = groups.filter((g) => g.state === "done");
  const lines = groups.reduce((s, g) => s + g.lines.length, 0);
  const ordered = groups.reduce((s, g) => s + g.qtyKg, 0);
  const cols: { key: string; title: string; tone: string; list: OrderGroup[] }[] = [
    {
      key: "late",
      title: "Late · most left to pack first",
      tone: "text-destructive-strong",
      list: late,
    },
    { key: "open", title: "Open · on time", tone: "text-primary", list: open },
    { key: "done", title: "Done", tone: "text-success-strong", list: done },
  ];
  const shownCols = cols.filter((c) => c.list.length > 0 || c.key === "late");
  return (
    <section
      className="min-w-0 rounded-2xl border border-border bg-card p-3 shadow-card md:p-4"
      data-testid="plan-orders"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold md:text-base">
          B2B &amp; export orders · {monthLabel}
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {groups.length} orders · {lines} lines · {tons(ordered)} t · ship-by = PM received + 14
          days
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        <Tile
          label="Left to pack on late orders"
          value={`${tons(late.reduce((s, g) => s + left(g), 0))} t`}
          bad
        />
        <Tile label="Open, still on time" value={String(open.length)} />
        <Tile label="Done" value={`${done.length} of ${groups.length}`} good />
      </dl>
      <div
        className={cn(
          "mt-3 grid grid-cols-1 gap-3",
          shownCols.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2",
        )}
      >
        {shownCols.map((c) => (
          <div
            key={c.key}
            className="flex min-w-0 flex-col gap-2 rounded-xl bg-muted/40 p-2"
            data-testid={`orders-${c.key}`}
          >
            <p
              className={cn(
                "flex justify-between px-1 text-[11px] font-bold uppercase tracking-wider",
                c.tone,
              )}
            >
              <span>{c.title}</span>
              <span className="tabular-nums">{c.list.length}</span>
            </p>
            {c.list.length === 0 ? (
              <p className="px-1 py-3 text-center text-xs text-muted-foreground">None</p>
            ) : (
              c.list.map((g) => <OrderCard key={g.key} g={g} skuName={skuName} />)
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Packed = this month&rsquo;s packed SKUs of the order&rsquo;s SKU for that client (export:
        its country), earlier order lines first, as in the workbook. Tap an order for its lines.
      </p>
    </section>
  );
}

function Tile({
  label,
  value,
  bad,
  good,
}: {
  label: string;
  value: string;
  bad?: boolean;
  good?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/60 px-2.5 py-2 md:px-3">
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-base font-bold tabular-nums md:text-lg",
          bad && "text-destructive-strong",
          good && "text-success-strong",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

// ------------------------------------------------------------------ health
export function DataHealth({
  ad,
  packed,
  forecastCount,
  groups,
}: {
  ad: Adherence;
  packed: PackedSku[];
  forecastCount: number;
  groups: OrderGroup[];
}) {
  const lines = ad.orders;
  const exportNoClient = packed.filter((p) => p.kind === "export" && !p.client).length;
  const lateNoReason = lines.filter((l) => l.lateDays > 0 && !l.delay_reason).length;
  const noPm = lines.filter((l) => !l.pm_date && l.status !== "done").length;
  const noKg = packed.filter((p) => p.kg === null).length;
  const issues = [
    {
      n: exportNoClient,
      of: packed.filter((p) => p.kind === "export").length,
      text: "export rows without a client",
      fix: "can't be matched to a client's order",
    },
    {
      n: lateNoReason,
      of: lines.filter((l) => l.lateDays > 0).length,
      text: "late order lines with no delay reason",
      fix: "add it in the workbook",
    },
    {
      n: noPm,
      of: lines.length,
      text: "open order lines without a PM date",
      fix: "no ship-by date",
    },
    {
      n: noKg,
      of: packed.length,
      text: "packed rows without a kg weight",
      fix: "add the weight in Settings › Packing",
    },
    {
      n: ad.noWeight,
      of: forecastCount,
      text: "forecast SKUs without a kg weight",
      fix: "left out of the forecast kg",
    },
  ].filter((i) => i.n > 0);
  const total = packed.length + lines.length;
  const bad = new Set<string>();
  packed.forEach((p, i) => {
    if ((p.kind === "export" && !p.client) || p.kg === null) bad.add(`p${i}`);
  });
  lines.forEach((l, i) => {
    if ((l.lateDays > 0 && !l.delay_reason) || (!l.pm_date && l.status !== "done"))
      bad.add(`o${i}`);
  });
  const score = total > 0 ? Math.round(((total - bad.size) / total) * 100) : 100;
  const days = [...new Set(packed.map((p) => p.day))].sort();
  const r = 26;
  const c = 2 * Math.PI * r;
  const tone =
    score >= 90
      ? "var(--color-success-strong)"
      : score >= 70
        ? "var(--color-warning-strong)"
        : "var(--color-destructive-strong)";
  const orderedKg = groups.reduce((s, g) => s + g.qtyKg, 0);

  return (
    <section
      className="min-w-0 rounded-2xl border border-border bg-card p-3 shadow-card md:p-4"
      data-testid="plan-health"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold md:text-base">Data health</h2>
        <span className="text-[11px] text-muted-foreground">rows this month that are complete</span>
      </div>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <svg
          viewBox="0 0 64 64"
          className="h-20 w-20 shrink-0"
          role="img"
          aria-label={`${score}% complete`}
        >
          <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-muted)" strokeWidth="7" />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke={tone}
            strokeWidth="7"
            strokeDasharray={`${(score / 100) * c} ${c}`}
            transform="rotate(-90 32 32)"
          />
          <text
            x="32"
            y="37"
            textAnchor="middle"
            fontSize="16"
            fontWeight="800"
            fill="var(--color-foreground)"
          >
            {score}
          </text>
        </svg>
        <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
          {issues.length === 0 ? (
            <li className="rounded-lg bg-success/10 px-3 py-2 text-sm font-medium text-success-strong">
              Nothing missing this month.
            </li>
          ) : (
            issues.map((i) => (
              <li
                key={i.text}
                className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg bg-warning/10 px-3 py-2 text-sm"
              >
                <span>
                  <b className="tabular-nums text-warning-strong">
                    {i.n}
                    {i.of ? ` / ${i.of}` : ""}
                  </b>{" "}
                  {i.text}
                </span>
                <span className="text-xs text-muted-foreground">{i.fix}</span>
              </li>
            ))
          )}
        </ul>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Source
          title="Entry · packed"
          lines={[
            `${packed.length} rows${days.length ? ` · ${Number(days[0].slice(8))}–${shortDay(days[days.length - 1])}` : ""}`,
            `${tons(ad.localKg)} t local · ${tons(ad.exportKg)} t export`,
          ]}
          ok={packed.length > 0}
        />
        <Source
          title="Items · forecast"
          lines={[`${forecastCount} SKUs`, `${tons(ad.forecastKg)} t this month`]}
          ok={forecastCount > 0}
        />
        <Source
          title="B2B & Export · orders"
          lines={[
            `${lines.length} lines · ${groups.length} orders`,
            `${tons(orderedKg)} t ordered · ${groups.length ? pctFmt(groups.reduce((s, g) => s + g.producedKg, 0) / Math.max(1, orderedKg)) : "—"} packed`,
          ]}
          ok={lines.length > 0}
        />
      </div>
    </section>
  );
}

function Source({ title, lines, ok }: { title: string; lines: string[]; ok: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border p-2.5 text-xs">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <span
          aria-hidden="true"
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded text-[10px]",
            ok ? "bg-success/15 text-success-strong" : "bg-muted text-muted-foreground",
          )}
        >
          {ok ? "✓" : "–"}
        </span>
        {title}
      </p>
      {lines.map((l) => (
        <p key={l} className="mt-0.5 text-muted-foreground">
          {l}
        </p>
      ))}
    </div>
  );
}
