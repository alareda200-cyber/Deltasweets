import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

let handling = false;

// Central, deduped reaction to an auth failure surfacing from any query
// (expired/invalid JWT, or the refresh_token call itself getting
// rate-limited after a burst of concurrent retries). Without this guard,
// every one of the dashboard's parallel queries failing at once would each
// fire their own signOut/redirect; this collapses that to exactly one.
// signOut() flips `session` to null via onAuthStateChange, and
// RequireAuth's existing redirect effect (itself guarded against loops by
// nav-loop-guard) takes it from there.
export async function handleAuthFailure() {
  if (handling) return;
  handling = true;
  toast.error("انتهت الجلسة، سجل دخول من جديد");
  try {
    await supabase.auth.signOut({ scope: "local" });
  } finally {
    // Reset only after signOut resolves: by then `session` is null, so any
    // still-in-flight sibling queries failing for the same reason land
    // here as no-ops rather than each re-triggering the same flow.
    handling = false;
  }
}
