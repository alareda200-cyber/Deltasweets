import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// Route `beforeLoad` guard for protected routes. Runs before `loader`, so an
// unauthenticated visit never reaches the loader's Supabase queries — those
// queries run under RLS policies scoped to `authenticated` only, and would
// otherwise fail with "permission denied" instead of redirecting to /login.
export async function requireSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw redirect({ to: "/login" });
  }
}
