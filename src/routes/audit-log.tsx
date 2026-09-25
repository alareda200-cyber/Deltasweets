import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  NO_USER,
  actionLabel,
  groupAuditRows,
  localZoneName,
  longDate,
  matchesBaseFilters,
  shortDate,
  staleLogNotice,
  tabOf,
  whoOf,
  type AuditFilters as Filters,
  type AuditRow,
  type AuditTab,
} from "@/lib/audit-format";
import { AuditEventList } from "@/components/audit/AuditEventList";
import { AuditFilters } from "@/components/audit/AuditFilters";

// Same reasoning as src/routes/users.tsx — this deployment is Firebase
// Hosting only (static, no server), and every logAudit() call goes through
// a server function (src/lib/audit.server.ts, for real IP/User-Agent
// capture) that has nothing to run on here. logAudit() fails silently by
// design (it must never block the action it's recording), so nothing
// breaks — but it also means no row is ever actually written to
// audit_logs from this deployment. The banner below says so, using the
// dates of the rows that do exist rather than a fixed sentence.
const SERVER_ACTIONS_AVAILABLE = false;

export const Route = createFileRoute("/audit-log")({
  head: () => ({ meta: [{ title: "Audit Log · Production Scorecard" }] }),
  component: () => (
    <RequireAuth requirePermission="users.manage">
      <AuditLogPage />
    </RequireAuth>
  ),
});

const FETCH_LIMIT = 1000;
const PAGE_SIZE = 40;

const TAB_LABELS: Record<AuditTab, { long: string; short: string }> = {
  changes: { long: "Changes", short: "Changes" },
  sessions: { long: "Sign-ins and sign-outs", short: "Sign-ins" },
};

function AuditLogPage() {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async (): Promise<AuditRow[]> => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT);
      if (error) throw error;
      return data as unknown as AuditRow[];
    },
  });

  const [tab, setTab] = useState<AuditTab>("changes");
  const [filters, setFilters] = useState<Filters>({
    search: "",
    person: "",
    action: "",
    from: "",
    to: "",
  });
  const [shown, setShown] = useState(PAGE_SIZE);
  const update = (next: Partial<Filters>) => setFilters((f) => ({ ...f, ...next }));
  useEffect(() => setShown(PAGE_SIZE), [filters, tab]);

  const persons = useMemo(() => {
    const emails = [...new Set(logs.map((l) => l.user_email).filter((e): e is string => !!e))];
    const opts = emails
      .sort((a, b) => a.localeCompare(b))
      .map((e) => ({ value: e, label: whoOf(e) ?? e }));
    if (logs.some((l) => !l.user_email)) opts.push({ value: NO_USER, label: "No user recorded" });
    return opts;
  }, [logs]);

  // Everything but the tab and the action filter — the tab counts come from here.
  const base = useMemo(
    () =>
      logs.filter((l) =>
        matchesBaseFilters(l, {
          search: filters.search,
          person: filters.person,
          from: filters.from,
          to: filters.to,
        }),
      ),
    [logs, filters.search, filters.person, filters.from, filters.to],
  );
  const counts = useMemo(() => {
    const c: Record<AuditTab, number> = { changes: 0, sessions: 0 };
    for (const l of base) c[tabOf(l.action)]++;
    return c;
  }, [base]);

  const actions = useMemo(
    () =>
      [...new Set(logs.filter((l) => tabOf(l.action) === tab).map((l) => l.action))]
        .map((a) => ({ value: a, label: actionLabel(a) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [logs, tab],
  );

  const inTab = useMemo(
    () =>
      base.filter(
        (l) => tabOf(l.action) === tab && (!filters.action || l.action === filters.action),
      ),
    [base, tab, filters.action],
  );
  const groups = useMemo(() => groupAuditRows(inTab), [inTab]);
  const visible = groups.slice(0, shown);

  const notice = staleLogNotice(logs, SERVER_ACTIONS_AVAILABLE);
  const zone = localZoneName();
  const hitLimit = logs.length >= FETCH_LIMIT;

  function changeTab(next: AuditTab) {
    setTab(next);
    // Action names belong to one tab; a filter from the other would show nothing.
    update({ action: "" });
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-3 md:gap-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Audit log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who changed what, and when. {zone ? `Times in ${zone}.` : "Times are local."}
          </p>
        </div>

        {!isLoading && notice && (
          <div
            role="note"
            className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm text-destructive-strong md:px-4"
          >
            <TriangleAlert
              className="mt-0.5 hidden h-[18px] w-[18px] shrink-0 md:block"
              aria-hidden="true"
            />
            {notice.empty ? (
              <p>
                <span className="font-semibold">Nothing has been recorded yet.</span> Logging needs
                a server and the site is static, so edits, deletes and sign-ins are not written.
              </p>
            ) : (
              <>
                <p className="md:hidden">
                  <span className="font-semibold">
                    Nothing recorded since {shortDate(notice.since)}.
                  </span>{" "}
                  Logging needs the old server. Events below: {shortDate(notice.oldest)} –{" "}
                  {shortDate(notice.newest)}.
                </p>
                <p className="hidden md:block">
                  <span className="font-semibold">
                    Nothing has been recorded since {longDate(notice.since)}.
                  </span>{" "}
                  Logging ran on the old server; the site is now static, so new edits, deletes and
                  sign-ins are not written. The {hitLimit ? "newest " : ""}
                  {notice.count.toLocaleString("en-GB")} events below cover{" "}
                  {shortDate(notice.oldest)} – {shortDate(notice.newest)}.
                </p>
              </>
            )}
          </div>
        )}

        <TabsPrimitive.Root
          value={tab}
          onValueChange={(v) => changeTab(v as AuditTab)}
          className="flex flex-col gap-3 md:gap-5"
        >
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-4">
            <TabsPrimitive.List
              aria-label="Kind of event"
              className="grid grid-cols-2 gap-[3px] rounded-xl bg-muted p-[3px] md:flex md:gap-1.5 md:rounded-none md:border-b md:border-border md:bg-transparent md:p-0"
            >
              {(Object.keys(TAB_LABELS) as AuditTab[]).map((t) => (
                <TabsPrimitive.Trigger
                  key={t}
                  value={t}
                  className={cn(
                    "h-11 rounded-[10px] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "md:rounded-none md:border-b-[3px] md:border-transparent md:px-3.5",
                    "data-[state=active]:bg-card data-[state=active]:font-semibold data-[state=active]:shadow-sm",
                    "md:data-[state=active]:border-primary md:data-[state=active]:bg-transparent md:data-[state=active]:shadow-none",
                  )}
                >
                  <span className="md:hidden">
                    {TAB_LABELS[t].short} · {isLoading ? "…" : counts[t]}
                  </span>
                  <span className="hidden items-center gap-1.5 md:inline-flex">
                    {TAB_LABELS[t].long}
                    <span className="rounded-full bg-muted px-2 py-px text-xs font-normal text-muted-foreground">
                      {isLoading ? "…" : counts[t]}
                    </span>
                  </span>
                </TabsPrimitive.Trigger>
              ))}
            </TabsPrimitive.List>

            <AuditFilters
              filters={filters}
              onChange={update}
              persons={persons}
              actions={actions}
              tab={tab}
              matchCount={inTab.length}
            />
          </div>

          {(Object.keys(TAB_LABELS) as AuditTab[]).map((t) => (
            <TabsPrimitive.Content
              key={t}
              value={t}
              className="flex flex-col gap-3 focus-visible:outline-none"
            >
              <AuditEventList groups={visible} isLoading={isLoading} />
              {!isLoading && groups.length > 0 && (
                <div className="flex flex-col items-center gap-2 md:flex-row md:justify-between">
                  <p className="text-xs text-muted-foreground">
                    Showing {visible.length} of {groups.length}{" "}
                    {groups.length === 1 ? "row" : "rows"} ({inTab.length}{" "}
                    {inTab.length === 1 ? "event" : "events"}). Role shown is the role at the time
                    of the event.
                  </p>
                  {shown < groups.length && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full md:h-9 md:w-auto"
                      onClick={() => setShown((n) => n + PAGE_SIZE)}
                    >
                      Show {Math.min(PAGE_SIZE, groups.length - shown)} more
                    </Button>
                  )}
                </div>
              )}
            </TabsPrimitive.Content>
          ))}
        </TabsPrimitive.Root>
      </div>
    </AppShell>
  );
}
