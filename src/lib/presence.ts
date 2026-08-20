import { supabase } from "@/integrations/supabase/client";

// How long a user stays "seen" without writing again. Keeps writes to about
// one per user per active 10 minutes — roughly 5k a month across the plant,
// versus ~52k for a 5-minute background heartbeat.
const THROTTLE_MS = 10 * 60 * 1000;

let lastWrite = 0;

// Deliberately NOT a setInterval: nothing fires while a tab sits idle or
// backgrounded. Kaspersky SSL inspection on the plant machines is sensitive
// to repeated background requests — the reason JWT expiry was raised to 8h —
// so presence rides on real navigation instead.
export function touchLastSeen() {
  const now = Date.now();
  if (now - lastWrite < THROTTLE_MS) return;
  lastWrite = now;
  // Fire and forget; a failed presence write must never surface to the user
  // or block navigation.
  void supabase.rpc("touch_last_seen").then(({ error }) => {
    if (error) lastWrite = 0; // let the next navigation retry
  });
}
