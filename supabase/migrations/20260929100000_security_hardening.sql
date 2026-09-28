BEGIN;
-- Security hardening (audit 29 Sep 2026).
--
-- 1. Only ACTIVE accounts get data. Every RLS policy (except "read my own
--    profile", which the app needs to see that it was switched off) now also
--    requires public.i_am_active(), and is_admin() requires an active admin.
--    Before: a switched-off user (profiles.status = 'inactive') kept reading
--    and writing everything with the token they still held, and anyone who
--    signed themselves up through /auth/v1/signup (sign-ups are open) became
--    an active viewer who could read all production and maintenance data.
-- 2. New accounts start switched OFF (status 'inactive', role viewer). An
--    admin switches them on in Users. Self sign-ups therefore see nothing
--    even if "Allow new users to sign up" is left on in Supabase Auth.
-- 3. profiles: a user editing their own row can no longer change their
--    email, username, role or status (only an active admin can), and the
--    last active admin can't be demoted or switched off.
-- 4. daily_entries guard also locks line, date, shift and the making counts
--    for roles that can't edit production numbers.
-- 5. created_by on maintenance events / notes / stoppages / non-production
--    days is always the signed-in user (no writing in someone else's name).
-- 6. push_subscriptions endpoints must be a real browser push service (the
--    send-push function posts to them: no pointing it at any URL).
-- 7. request_replay: at most 10 new requests an hour per person.
-- 8. Trigger / event-trigger functions are not callable through the API;
--    touch_last_login / touch_last_seen only for signed-in users.
--
-- Rollback: see the end of supabase/migrations/20260929100000_security_hardening.sql
-- (the policies are ANDed with i_am_active(); remove that term to undo).

-- ------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION public.i_am_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT p.status = 'active' FROM public.profiles p WHERE p.id = auth.uid()), false);
$$;
REVOKE ALL ON FUNCTION public.i_am_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.i_am_active() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_admin(check_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = check_user_id AND role = 'admin' AND status = 'active'
  );
$$;

-- ------------------------------------------- 1. every policy: active only
DO $$
DECLARE
  p record;
  sql text;
BEGIN
  FOR p IN
    SELECT tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND NOT (tablename = 'profiles' AND policyname = 'Users can read own profile')
  LOOP
    IF coalesce(p.qual, '') LIKE '%i_am_active%' OR coalesce(p.with_check, '') LIKE '%i_am_active%' THEN
      CONTINUE; -- already done
    END IF;
    sql := format('ALTER POLICY %I ON public.%I', p.policyname, p.tablename);
    IF p.qual IS NOT NULL THEN
      sql := sql || format(' USING ((SELECT public.i_am_active()) AND (%s))', p.qual);
    END IF;
    IF p.with_check IS NOT NULL THEN
      sql := sql || format(' WITH CHECK ((SELECT public.i_am_active()) AND (%s))', p.with_check);
    END IF;
    EXECUTE sql;
  END LOOP;
END;
$$;

-- ------------------------------------------ 2. new accounts start switched off
CREATE OR REPLACE FUNCTION public.tg_create_profile_for_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role, status)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data ->> 'display_name', 'viewer', 'inactive')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
ALTER TABLE public.profiles ALTER COLUMN status SET DEFAULT 'inactive';

-- ------------------------------------------------- 3. profiles guard
CREATE OR REPLACE FUNCTION public.tg_profiles_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- SQL editor / service role / imports: no signed-in user, nothing to guard.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_admin(v_uid) THEN
    NEW.id     := OLD.id;
    NEW.email  := OLD.email;
    NEW.username := OLD.username;
    NEW.role   := OLD.role;
    NEW.status := OLD.status;
    NEW.created_at := OLD.created_at;
  END IF;

  -- Never leave the app without an active admin.
  IF OLD.role = 'admin' AND OLD.status = 'active'
     AND (NEW.role IS DISTINCT FROM 'admin' OR NEW.status IS DISTINCT FROM 'active')
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id <> OLD.id AND p.role = 'admin' AND p.status = 'active'
     ) THEN
    RAISE EXCEPTION 'this is the last active admin' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tg_profiles_guard ON public.profiles;
CREATE TRIGGER tg_profiles_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_guard();

-- ------------------------------------------- 4. daily_entries column guard
CREATE OR REPLACE FUNCTION public.tg_daily_entries_column_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
  v_uid       uuid;
BEGIN
  v_uid := (select auth.uid());

  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role INTO caller_role
  FROM public.profiles
  WHERE id = v_uid;

  IF caller_role IS DISTINCT FROM 'admin' AND caller_role IS DISTINCT FROM 'production' THEN
    NEW.line_id              := OLD.line_id;
    NEW.entry_date           := OLD.entry_date;
    NEW.shift                := OLD.shift;
    NEW.making_plan          := OLD.making_plan;
    NEW.making_actual        := OLD.making_actual;
    NEW.making_plan_count    := OLD.making_plan_count;
    NEW.making_actual_count  := OLD.making_actual_count;
    NEW.packing_plan         := OLD.packing_plan;
    NEW.packing_actual       := OLD.packing_actual;
    NEW.rework_cooking       := OLD.rework_cooking;
    NEW.rework_making        := OLD.rework_making;
    NEW.rework_packing       := OLD.rework_packing;
    NEW.custom_fields        := OLD.custom_fields;
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------- 5. created_by = the signer
CREATE OR REPLACE FUNCTION public.tg_stamp_created_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_by := auth.uid();
    ELSE
      NEW.created_by := OLD.created_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['maintenance_events','maintenance_notes','maintenance_stoppages','non_production_days'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tg_stamp_created_by ON public.%I', t);
    EXECUTE format('CREATE TRIGGER tg_stamp_created_by BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_created_by()', t);
  END LOOP;
END;
$$;

-- ------------------------------------------- 6. push endpoints: real services
ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_known;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_known CHECK (
  (subscription ->> 'endpoint') ~ '^https://(fcm\.googleapis\.com|[a-z0-9-]+\.google\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'
);

-- ------------------------------------------------ 7. request_replay limit
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

  -- At most 10 new requests an hour per person: each one pushes every admin.
  IF (SELECT count(*) FROM public.replay_requests r
      WHERE r.requester_id = v_uid AND r.created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'too many replay requests, try again later' USING ERRCODE = '54000';
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
-- ------------------------------------------ 8. functions off the public API
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_create_profile_for_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_daily_entries_column_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_profiles_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_stamp_created_by() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_last_login() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.touch_last_seen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_last_login() TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_last_seen() TO authenticated;

-- ------------------------------------------------------------- checks
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public'
    AND NOT (tablename = 'profiles' AND policyname = 'Users can read own profile')
    AND coalesce(qual, '') NOT LIKE '%i_am_active%'
    AND coalesce(with_check, '') NOT LIKE '%i_am_active%';
  IF n > 0 THEN
    RAISE EXCEPTION '% policies still without the active check', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin' AND status = 'active') THEN
    RAISE EXCEPTION 'no active admin left';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260929100000', 'security_hardening') ON CONFLICT (version) DO NOTHING;
COMMIT;

-- Rollback (by hand, if ever needed):
--   * policies: ALTER POLICY … USING (<old>) — the old text is the part after
--     "(SELECT public.i_am_active()) AND".
--   * ALTER TABLE public.profiles ALTER COLUMN status SET DEFAULT 'active';
--     and tg_create_profile_for_new_user() without the status column.
--   * DROP TRIGGER tg_profiles_guard ON public.profiles;
--     DROP TRIGGER tg_stamp_created_by ON public.maintenance_events (…notes,
--     …stoppages, non_production_days);
--   * ALTER TABLE public.push_subscriptions DROP CONSTRAINT push_subscriptions_endpoint_known;
