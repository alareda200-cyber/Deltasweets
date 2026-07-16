import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

let handling = false;

const AUTH_STORAGE_KEY_RE = /^sb-.*-auth-token$/;

// supabase-js's signOut({ scope: "local" }) still makes a network call to
// revoke the access token before clearing anything locally (GoTrueClient
// #_signOut: skipped only if there's no access token at all). If Supabase
// is already rate-limiting this session, that revoke call itself can come
// back 429 — which _signOut does NOT treat as "already signed out, proceed
// to clear" (only 404/401/403 are), so it bails out having cleared
// *nothing* and emitted no SIGNED_OUT event. The dead session then stays in
// localStorage forever, and every subsequent query fails the same way.
// Clearing the storage key directly guarantees the session is gone
// regardless of whether that network call succeeded.
export function clearLocalSupabaseSession() {
  if (typeof window === "undefined") return;
  for (const key of Object.keys(window.localStorage)) {
    if (AUTH_STORAGE_KEY_RE.test(key)) window.localStorage.removeItem(key);
  }
}

// Guaranteed escape hatch to /login, independent of React/router state.
// Used when we can't trust supabase-js to have emitted SIGNED_OUT (so
// AuthProvider's `session` state and RequireAuth's redirect effect may
// never fire) — a hard navigation lands on /login regardless of whatever
// state the in-memory auth client is stuck in.
export function forceReauth() {
  toast.error("انتهت الجلسة، سجل دخول من جديد");
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.assign("/login");
  }
}

// Central, deduped reaction to an auth failure surfacing from any query
// (expired/invalid JWT, or a 403 permission-denied caused by requests
// silently falling back to the anon role once the session died). Without
// this guard, every one of the dashboard's parallel queries failing at
// once would each fire their own signOut/redirect; this collapses that to
// exactly one.
export async function handleAuthFailure() {
  if (handling) return;
  handling = true;
  toast.error("انتهت الجلسة، سجل دخول من جديد");
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      // signOut()'s own revoke call failed (e.g. 429) — it did not clear
      // local storage or notify subscribers, so the normal SPA-level
      // session -> null -> RequireAuth redirect flow will never happen on
      // its own. Force it.
      clearLocalSupabaseSession();
      forceReauth();
    }
    // On success, signOut() already emitted SIGNED_OUT; AuthProvider's
    // listener flips `session` to null and RequireAuth's existing redirect
    // effect (guarded against loops by nav-loop-guard) takes it from there
    // with a normal SPA navigation — no need to force anything here.
  } catch {
    // signOut() itself threw (shouldn't normally happen — errors come back
    // in the result object — but don't leave the dead session in place if
    // it does).
    clearLocalSupabaseSession();
    forceReauth();
  } finally {
    // Reset only after signOut resolves: by then `session` is null (or
    // we've force-cleared it), so any still-in-flight sibling queries
    // failing for the same reason land here as no-ops rather than each
    // re-triggering the same flow.
    handling = false;
  }
}
