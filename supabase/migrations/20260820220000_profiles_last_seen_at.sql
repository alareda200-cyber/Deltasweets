-- 33) last_seen_at — presence without a background heartbeat.
--
-- Mirrors touch_last_login in 20260707150846_user_management_fields.sql: a
-- SECURITY DEFINER function scoped to exactly one column, for exactly the
-- calling user. This avoids widening the "Users can update own display name"
-- policy, whose WITH CHECK deliberately pins role to its current value so a
-- self-update can never become a privilege escalation.
--
-- Written by the client on route change only, throttled to once per 10
-- minutes per user (src/lib/presence.ts) — no setInterval. A background
-- heartbeat was rejected: repeated background requests are what caused the
-- Kaspersky SSL-inspection refresh storm that the 8h JWT expiry fixed.
--
-- No index: profiles holds fewer than a dozen rows, so an index would cost
-- more to maintain than the sequential scan it replaces.
--
-- NOTE: applied by hand in the Supabase SQL Editor on 2026-08-20 (the CLI is
-- not available in this environment). This file exists so the schema stays
-- reproducible from the migrations folder.

ALTER TABLE public.profiles ADD COLUMN last_seen_at timestamptz;

CREATE OR REPLACE FUNCTION public.touch_last_seen()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles SET last_seen_at = now() WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.touch_last_seen() TO authenticated;
