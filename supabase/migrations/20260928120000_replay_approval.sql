-- Replay a day by approval (Ala, 28 Sep 2026).
--
-- A switch in Settings (app_settings.replay_needs_approval). ON: anyone who
-- is not an admin asks before watching a line's day; every active admin gets
-- a push; the first admin to answer decides; an approval is for ONE viewing
-- (start_replay marks it used). OFF (the default): Replay opens as before.
--
-- Everything goes through SECURITY DEFINER functions; the table itself only
-- has SELECT for the requester (own rows) and admins. A pending request
-- expires after 30 minutes without an answer.
--
-- Note: the site is static (no server), so this gates the Replay page. The
-- numbers the replay draws (daily_entries, maintenance_events) keep their own
-- RLS and stay readable on the Dashboard as before.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.request_replay(uuid, date), public.decide_replay_request(uuid, boolean),
--     public.start_replay(uuid), public.cancel_replay_request(uuid),
--     public.send_push_users(uuid[], text, text, text);
--   DROP TABLE IF EXISTS public.replay_requests;
--   ALTER TABLE public.app_settings DROP COLUMN IF EXISTS replay_needs_approval;

-- ---------------------------------------------------------------- setting
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS replay_needs_approval boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------- table
CREATE TABLE IF NOT EXISTS public.replay_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  line_id      uuid NOT NULL REFERENCES public.production_lines(id) ON DELETE CASCADE,
  day          date NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'denied', 'used', 'cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at   timestamptz,
  used_at      timestamptz
);

CREATE INDEX IF NOT EXISTS replay_requests_requester_idx
  ON public.replay_requests (requester_id, line_id, day, created_at DESC);
CREATE INDEX IF NOT EXISTS replay_requests_pending_idx
  ON public.replay_requests (created_at DESC) WHERE status = 'pending';

ALTER TABLE public.replay_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.replay_requests FROM anon, authenticated;
GRANT SELECT ON public.replay_requests TO authenticated;

DROP POLICY IF EXISTS "Read own replay requests, admins read all" ON public.replay_requests;
CREATE POLICY "Read own replay requests, admins read all" ON public.replay_requests
  FOR SELECT TO authenticated
  USING (requester_id = (select auth.uid()) OR (select public.my_profile_role()) = 'admin');

-- ------------------------------------------------------- push to users
-- Like send_push, but to chosen users' devices, whatever topics they picked.
CREATE OR REPLACE FUNCTION public.send_push_users(p_user_ids uuid[], p_title text, p_body text, p_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  IF p_user_ids IS NULL OR cardinality(p_user_ids) = 0 THEN
    RETURN;
  END IF;
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'push_function_secret'
  LIMIT 1;
  IF v_secret IS NULL THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := 'https://azbsooazusvqkodrlzpi.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-function-secret', v_secret),
    body := jsonb_build_object('user_ids', to_jsonb(p_user_ids), 'title', p_title, 'body', p_body, 'url', p_url)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.send_push_users(uuid[], text, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- ask
-- Returns the request to wait on. Reuses a fresh pending one (no second push)
-- or an approved one not yet watched. status 'not_needed' = open the replay.
CREATE OR REPLACE FUNCTION public.request_replay(p_line uuid, p_day date)
RETURNS TABLE (id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.replay_requests%ROWTYPE;
  v_needed boolean;
  v_who text;
  v_line text;
  v_admins uuid[];
BEGIN
  IF v_uid IS NULL OR public.my_profile_status() IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(s.replay_needs_approval, false) INTO v_needed FROM public.app_settings s WHERE s.id = true;
  IF NOT coalesce(v_needed, false) OR public.my_profile_role() = 'admin' THEN
    RETURN QUERY SELECT NULL::uuid, 'not_needed'::text;
    RETURN;
  END IF;

  SELECT * INTO v_row FROM public.replay_requests r
  WHERE r.requester_id = v_uid AND r.line_id = p_line AND r.day = p_day
    AND (
      (r.status = 'pending' AND r.created_at > now() - interval '30 minutes')
      OR r.status = 'approved'
    )
  ORDER BY r.created_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT v_row.id, v_row.status;
    RETURN;
  END IF;

  INSERT INTO public.replay_requests (requester_id, line_id, day)
  VALUES (v_uid, p_line, p_day)
  RETURNING * INTO v_row;

  SELECT coalesce(nullif(btrim(p.display_name), ''), p.email) INTO v_who FROM public.profiles p WHERE p.id = v_uid;
  SELECT l.name INTO v_line FROM public.production_lines l WHERE l.id = p_line;
  SELECT array_agg(p.id) INTO v_admins FROM public.profiles p WHERE p.role = 'admin' AND p.status = 'active';

  PERFORM public.send_push_users(
    v_admins,
    'طلب مشاهدة ريبلاي',
    coalesce(v_who, '—') || ' — ' || coalesce(v_line, '—') || ' · ' || to_char(p_day, 'Dy DD Mon'),
    '/replay-requests?id=' || v_row.id
  );

  RETURN QUERY SELECT v_row.id, v_row.status;
END;
$$;

-- ---------------------------------------------------------------- decide
-- Admins only. Returns the request's status after the call: the caller's
-- decision, or what someone else already decided, or 'expired'.
CREATE OR REPLACE FUNCTION public.decide_replay_request(p_id uuid, p_approve boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.replay_requests%ROWTYPE;
BEGIN
  IF public.my_profile_role() IS DISTINCT FROM 'admin' OR public.my_profile_status() IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'admins only' USING ERRCODE = '42501';
  END IF;

  UPDATE public.replay_requests r
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'denied' END,
         decided_by = auth.uid(),
         decided_at = now()
   WHERE r.id = p_id AND r.status = 'pending' AND r.created_at > now() - interval '30 minutes'
  RETURNING * INTO v_row;
  IF FOUND THEN
    RETURN v_row.status;
  END IF;

  SELECT * INTO v_row FROM public.replay_requests r WHERE r.id = p_id;
  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;
  IF v_row.status = 'pending' THEN
    RETURN 'expired';
  END IF;
  RETURN v_row.status;
END;
$$;

-- ---------------------------------------------------------------- watch
-- The requester starts the one viewing: approved → used. false = nothing to
-- watch (not approved, or already watched).
CREATE OR REPLACE FUNCTION public.start_replay(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.replay_requests r
     SET status = 'used', used_at = now()
   WHERE r.id = p_id AND r.requester_id = auth.uid() AND r.status = 'approved';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_replay_request(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.replay_requests r
     SET status = 'cancelled'
   WHERE r.id = p_id AND r.requester_id = auth.uid() AND r.status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.request_replay(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_replay_request(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_replay(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_replay_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_replay(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_replay_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_replay(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_replay_request(uuid) TO authenticated;
