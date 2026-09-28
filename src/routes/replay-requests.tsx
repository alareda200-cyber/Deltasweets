import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { linesQuery } from "@/lib/queries";
import { requireSession } from "@/lib/require-session";
import {
  consumeReplayAction,
  decideReplayRequest,
  isExpired,
  replayApprovalSettingQuery,
  replayRequestsQuery,
  type ReplayRequest,
} from "@/lib/replay-approval";
import { cn } from "@/lib/utils";

// /replay-requests?id=<request>&do=approve|deny is what the push
// notification's Approve / Deny buttons open (public/sw.js): the decision is
// made here, with the admin's own session, then the URL is cleaned.
interface RequestsSearch {
  id?: string;
  do?: "approve" | "deny";
  /** One-time token from the service worker (see consumeReplayAction). */
  t?: string;
}

export const Route = createFileRoute("/replay-requests")({
  head: () => ({ meta: [{ title: "Replay requests · Production Scorecard" }] }),
  validateSearch: (search: Record<string, unknown>): RequestsSearch => ({
    id: typeof search.id === "string" && /^[0-9a-f-]{36}$/i.test(search.id) ? search.id : undefined,
    do: search.do === "approve" || search.do === "deny" ? search.do : undefined,
    t: typeof search.t === "string" && /^[0-9a-f-]{36}$/i.test(search.t) ? search.t : undefined,
  }),
  beforeLoad: requireSession,
  loader: ({ context }) => context.queryClient.ensureQueryData(linesQuery),
  component: () => (
    <RequireAuth requirePermission="replay.approve">
      <RequestsPage />
    </RequireAuth>
  ),
});

interface Person {
  id: string;
  name: string;
  role: string;
}

const peopleQuery = (ids: string[]) => ({
  queryKey: ["replay-request-people", [...ids].sort().join(",")],
  enabled: ids.length > 0,
  queryFn: async (): Promise<Person[]> => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, email, role")
      .in("id", ids);
    if (error) throw error;
    return (data ?? []).map((p) => ({
      id: p.id,
      name: p.display_name?.trim() || p.email,
      role: p.role,
    }));
  },
});

const dayName = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

function ago(iso: string, now: number): string {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function RequestsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/replay-requests" });
  const qc = useQueryClient();
  const { data: lines } = useSuspenseQuery(linesQuery);
  const { data: approvalOn } = useQuery(replayApprovalSettingQuery());
  const requestsQ = useQuery(replayRequestsQuery());
  const requests = requestsQ.data ?? [];
  const ids = [
    ...new Set(requests.flatMap((r) => [r.requester_id, r.decided_by].filter(Boolean))),
  ] as string[];
  const { data: people = [] } = useQuery(peopleQuery(ids));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const personName = (id: string | null) =>
    (id && people.find((p) => p.id === id)?.name) || "someone";
  const personRole = (id: string) => people.find((p) => p.id === id)?.role;
  const lineName = (id: string) => lines.find((l) => l.id === id)?.name ?? "a line";

  async function decide(r: Pick<ReplayRequest, "id">, approve: boolean) {
    setBusyId(r.id);
    try {
      const result = await decideReplayRequest(r.id, approve);
      if (result === (approve ? "approved" : "denied")) {
        toast.success(approve ? "Approved — they can watch it now" : "Denied");
      } else if (result === "expired") {
        toast.error("Too late — the request expired after 30 minutes");
      } else if (result === "missing") {
        toast.error("That request no longer exists");
      } else {
        toast.info(`Already answered: ${result}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the answer");
    } finally {
      setBusyId(null);
      void qc.invalidateQueries({ queryKey: ["replay-requests"] });
    }
  }

  // Approve / Deny tapped in the notification: act once, then drop the
  // params so a reload doesn't repeat it.
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current || !search.id || !search.do) return;
    handled.current = true;
    const id = search.id;
    const approve = search.do === "approve";
    void consumeReplayAction(search.t, id, search.do).then(async (fromNotification) => {
      if (fromNotification) {
        await decide({ id }, approve);
        void navigate({ search: {}, replace: true });
      } else {
        // Not from this device's notification: show the request, answer by hand.
        toast.info("Check the request below, then tap Approve or Deny.");
        void navigate({ search: { id }, replace: true });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.id, search.do]);

  const waiting = requests.filter((r) => r.status === "pending" && !isExpired(r, now));
  const earlier = requests.filter((r) => !(r.status === "pending" && !isExpired(r, now)));

  const statusText = (r: ReplayRequest) => {
    if (r.status === "pending")
      return { text: "no answer · expired", tone: "text-muted-foreground" };
    if (r.status === "cancelled")
      return { text: "cancelled by them", tone: "text-muted-foreground" };
    const by = r.decided_by ? ` by ${personName(r.decided_by)}` : "";
    if (r.status === "denied") return { text: `denied${by}`, tone: "text-destructive-strong" };
    if (r.status === "used")
      return { text: `approved${by} · watched`, tone: "text-success-strong" };
    return { text: `approved${by} · not watched yet`, tone: "text-success-strong" };
  };

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4 md:gap-5 md:px-6 md:py-6">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold md:text-3xl">Replay requests</h1>
            <p className="text-sm text-muted-foreground">
              Who wants to watch a day on Replay. The first admin to answer decides; an approval is
              for one viewing.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
            {waiting.length} waiting
          </span>
        </div>

        {approvalOn === false && (
          <p className="rounded-xl border border-border bg-muted/50 p-3 text-sm">
            Replay approval is <b>off</b> — Replay opens for everyone.{" "}
            <Link
              to="/settings"
              search={{ section: "replay" }}
              className="font-semibold text-primary hover:underline"
            >
              Turn it on in Settings
            </Link>
          </p>
        )}

        {requestsQ.isPending ? (
          <div className="ds-shimmer h-32 rounded-2xl" />
        ) : requestsQ.isError ? (
          <p className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive-strong">
            Couldn&rsquo;t load the requests. Pull to refresh or try again in a moment.
          </p>
        ) : waiting.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nobody is waiting right now.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {waiting.map((r) => (
              <section
                key={r.id}
                data-request={r.id}
                className={cn(
                  "flex flex-col gap-3 rounded-2xl border-2 bg-card p-4 md:flex-row md:items-center md:justify-between",
                  search.id === r.id ? "border-primary" : "border-primary/40",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-base font-bold">{personName(r.requester_id)}</span>
                    <span className="text-xs text-muted-foreground">{ago(r.created_at, now)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {personRole(r.requester_id) ? `${personRole(r.requester_id)} · ` : ""}wants{" "}
                    <span className="font-medium text-foreground">
                      {lineName(r.line_id)} · {dayName(r.day)}
                    </span>
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 md:flex">
                  <Button
                    variant="outline"
                    disabled={busyId === r.id}
                    onClick={() => void decide(r, false)}
                    className="h-12 text-destructive-strong md:h-9"
                  >
                    Deny
                  </Button>
                  <Button
                    disabled={busyId === r.id}
                    onClick={() => void decide(r, true)}
                    className="h-12 md:h-9"
                  >
                    {busyId === r.id && <Loader2 className="animate-spin" aria-hidden="true" />}
                    Approve
                  </Button>
                </div>
              </section>
            ))}
          </div>
        )}

        {earlier.length > 0 && (
          <div className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Last 3 days
            </h2>
            {earlier.map((r) => {
              const st = statusText(r);
              return (
                <div
                  key={r.id}
                  className="flex flex-col gap-0.5 rounded-xl border border-border bg-card px-4 py-3 text-sm md:flex-row md:items-center md:justify-between"
                >
                  <span>
                    <span className="font-medium">{personName(r.requester_id)}</span> ·{" "}
                    {lineName(r.line_id)} · {dayName(r.day)}
                  </span>
                  <span className={cn("text-xs font-semibold md:text-sm", st.tone)}>
                    {st.text} · {ago(r.created_at, now)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
