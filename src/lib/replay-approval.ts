// Replay a day by approval (migration 20260928120000_replay_approval.sql).
//
// Settings › Replay approval switches it on. Then anyone who is not an admin
// asks before watching a line's day, every active admin gets a push, the first
// admin to answer decides, and an approval is for ONE viewing: the page calls
// start_replay when it opens the replay, which marks the request used, so a
// refresh or another visit needs a new request. A request nobody answers in
// 30 minutes expires.
import { useCallback, useEffect, useRef, useState } from "react";
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const REQUEST_TTL_MIN = 30;

/** app_settings.replay_needs_approval. Unreadable → false (Replay as before). */
export const replayApprovalSettingQuery = () =>
  queryOptions({
    queryKey: ["app-settings", "replay-approval"],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("*")
        .eq("id", true)
        .maybeSingle();
      if (error || !data) return false;
      return (
        (data as unknown as { replay_needs_approval?: boolean }).replay_needs_approval === true
      );
    },
  });

export type ReplayRequestStatus = "pending" | "approved" | "denied" | "used" | "cancelled";

export interface ReplayRequest {
  id: string;
  requester_id: string;
  line_id: string;
  day: string;
  status: ReplayRequestStatus;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  used_at: string | null;
}

export function isExpired(r: Pick<ReplayRequest, "status" | "created_at">, now = Date.now()) {
  return (
    r.status === "pending" && now - new Date(r.created_at).getTime() > REQUEST_TTL_MIN * 60_000
  );
}

/** Admin page: requests from the last 3 days, newest first. */
export const replayRequestsQuery = () =>
  queryOptions({
    queryKey: ["replay-requests"],
    queryFn: async (): Promise<ReplayRequest[]> => {
      const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("replay_requests")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as ReplayRequest[];
    },
    refetchInterval: 10_000,
  });

/** "approved" | "denied" | "used" | "cancelled" | "expired" | "missing". */
export async function decideReplayRequest(id: string, approve: boolean): Promise<string> {
  const { data, error } = await supabase.rpc("decide_replay_request", {
    p_id: id,
    p_approve: approve,
  });
  if (error) throw error;
  return String(data);
}

export type GateState =
  "checking" | "locked" | "asking" | "waiting" | "denied" | "expired" | "open" | "error";

/**
 * The Replay page's gate for one line + day. `required` = the switch is on and
 * the viewer is not an admin; when false the gate is simply "open".
 */
export function useReplayGate(
  lineId: string | null,
  day: string,
  userId: string | null,
  required: boolean,
) {
  const [state, setState] = useState<GateState>(required ? "checking" : "open");
  // Which line/day/switch position `state` was worked out for. In the render
  // where one of them changes (e.g. the switch loads as ON), `state` still
  // holds the old answer until the effect below runs — never let that stale
  // "open" through, or the day's data would load for one render.
  const key = `${lineId}|${day}|${userId}|${required}`;
  const [stateKey, setStateKey] = useState(key);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [askedAt, setAskedAt] = useState<string | null>(null);
  // Only the newest line/day may write to the gate.
  const seq = useRef(0);

  const open = useCallback(async (id: string, mine: number) => {
    const { data, error } = await supabase.rpc("start_replay", { p_id: id });
    if (mine !== seq.current) return;
    if (error) return setState("error");
    // false: already watched, or no longer approved → ask again.
    setState(data ? "open" : "locked");
  }, []);

  const apply = useCallback(
    (row: Pick<ReplayRequest, "id" | "status" | "created_at"> | null, mine: number) => {
      if (mine !== seq.current) return;
      if (!row) return setState("locked");
      setRequestId(row.id);
      setAskedAt(row.created_at);
      if (row.status === "approved") return void open(row.id, mine);
      if (row.status === "denied") return setState("denied");
      if (row.status === "pending") return setState(isExpired(row) ? "expired" : "waiting");
      setState("locked"); // used / cancelled
    },
    [open],
  );

  // A new line, day or switch position starts over. A request still waiting
  // (or approved and not watched yet) for this line + day is picked up again,
  // so reloading while waiting keeps waiting instead of asking twice.
  useEffect(() => {
    const mine = ++seq.current;
    setStateKey(key);
    setRequestId(null);
    setAskedAt(null);
    if (!required) return setState("open");
    if (!lineId || !userId) return setState("checking");
    setState("checking");
    void supabase
      .from("replay_requests")
      .select("id, status, created_at")
      .eq("requester_id", userId)
      .eq("line_id", lineId)
      .eq("day", day)
      .in("status", ["pending", "approved"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (mine !== seq.current) return;
        if (error) return setState("error");
        apply((data as ReplayRequest | null) ?? null, mine);
      });
  }, [lineId, day, userId, required, apply, key]);

  // While waiting: look every 3 s for the admin's answer.
  useEffect(() => {
    if (state !== "waiting" || !requestId) return;
    const mine = seq.current;
    const t = setInterval(async () => {
      const { data } = await supabase
        .from("replay_requests")
        .select("id, status, created_at")
        .eq("id", requestId)
        .maybeSingle();
      if (data) apply(data as ReplayRequest, mine);
    }, 3000);
    return () => clearInterval(t);
  }, [state, requestId, apply]);

  const ask = useCallback(async () => {
    if (!lineId) return;
    const mine = seq.current;
    setState("asking");
    const { data, error } = await supabase.rpc("request_replay", { p_line: lineId, p_day: day });
    if (mine !== seq.current) return;
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row) return setState("error");
    if (row.status === "not_needed" || !row.id) return setState("open");
    // Read the row back for its real time (a waiting request is reused).
    const { data: saved } = await supabase
      .from("replay_requests")
      .select("id, status, created_at")
      .eq("id", row.id)
      .maybeSingle();
    apply(
      (saved as ReplayRequest | null) ?? {
        id: row.id,
        status: row.status as ReplayRequestStatus,
        created_at: new Date().toISOString(),
      },
      mine,
    );
  }, [lineId, day, apply]);

  const cancel = useCallback(async () => {
    if (!requestId) return setState("locked");
    await supabase.rpc("cancel_replay_request", { p_id: requestId });
    setState("locked");
  }, [requestId]);

  const current: GateState = stateKey === key ? state : required ? "checking" : "open";
  return { state: current, askedAt, ask, cancel };
}
