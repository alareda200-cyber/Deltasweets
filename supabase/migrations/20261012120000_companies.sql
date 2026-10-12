BEGIN;
-- Companies: Jammy and Delta in one app (12 Oct 2026).
--
-- Delta Sweets has more than one company. Every line belongs to one company
-- and every page shows ONE company at a time.
--
-- 1. public.companies (Jammy, Delta). The 6 existing lines and all their data
--    go to Jammy; Delta gets its 7 lines.
-- 2. profiles.company_id: set by an admin only. NULL = the person may see
--    every company; a company = only that one. The role keeps its
--    permissions; this only narrows WHICH lines they apply to.
-- 3. profiles.active_company_id: the company the person is looking at now
--    (the switcher in the header writes it). Only matters when company_id is
--    NULL.
-- 4. The company in view = company_id, else active_company_id, else the first
--    company. RESTRICTIVE policies (ANDed with every existing policy) keep each
--    line-scoped table to that company's lines, for reads AND writes. Nothing
--    in the existing policies changes.
-- 5. Plant-wide non-production days (line_id NULL) belong to a company too.
-- 6. Push notifications only go to people who may see the line's company.
-- 7. request_replay refuses a line outside the company in view. Replay
--    requests themselves stay as they are (a person sees their own, an admin
--    sees all), so an admin can answer a request whatever company they view.
--
-- Rollback (in this order):
--   DROP POLICY company_scope ON public.<each table below>;
--   DROP POLICY "company scope companies" ON public.companies;
--   DROP TRIGGER production_lines_company_default ON public.production_lines;
--   DROP TRIGGER non_production_days_company_default ON public.non_production_days;
--   restore send_push / notify_* / request_replay / tg_profiles_guard from
--     20260926120000_push_topics.sql, 20260928120000_replay_approval.sql and
--     20260929100000_security_hardening.sql;
--   DROP FUNCTION public.my_scope_line_ids(), public.my_scope_company(),
--     public.my_company_access();
--   ALTER TABLE public.non_production_days DROP COLUMN company_id;
--   ALTER TABLE public.profiles DROP COLUMN company_id, DROP COLUMN active_company_id;
--   DELETE FROM public.production_lines WHERE company_id = (Delta);  -- only if Delta has no data
--   ALTER TABLE public.production_lines DROP COLUMN company_id;
--   DROP TABLE public.companies;

-- ---------------------------------------------------------- 1. companies
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  color text NOT NULL DEFAULT '#64748b',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

INSERT INTO public.companies (name, color, sort_order) VALUES
  ('Jammy', '#d6336c', 1),
  ('Delta', '#0e9aa7', 2);

-- ------------------------------------------------- lines and profiles
ALTER TABLE public.production_lines
  ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT;
UPDATE public.production_lines
  SET company_id = (SELECT id FROM public.companies WHERE name = 'Jammy');
ALTER TABLE public.production_lines ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX production_lines_company_id_idx ON public.production_lines(company_id);

ALTER TABLE public.profiles
  ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN active_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
CREATE INDEX profiles_company_id_idx ON public.profiles(company_id);
CREATE INDEX profiles_active_company_id_idx ON public.profiles(active_company_id);
-- Everyone starts on "all companies", looking at Jammy: nothing changes for
-- anyone until an admin ties a person to a company.
UPDATE public.profiles
  SET active_company_id = (SELECT id FROM public.companies WHERE name = 'Jammy');

ALTER TABLE public.non_production_days
  ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
UPDATE public.non_production_days
  SET company_id = (SELECT id FROM public.companies WHERE name = 'Jammy')
  WHERE line_id IS NULL;
CREATE INDEX non_production_days_company_id_idx ON public.non_production_days(company_id);

-- Delta's lines (Ala, 12 Oct 2026). Same shape as Jammy's for now.
INSERT INTO public.production_lines (name, color, sort_order, company_id)
SELECT v.name, v.color, v.sort_order, c.id
FROM (VALUES
  ('Toffee',        '#b7791f', 1),
  ('Mint',          '#16a34a', 2),
  ('Glass',         '#0891b2', 3),
  ('Sugar Coating', '#a855f7', 4),
  ('Gum',           '#ec4899', 5),
  ('Eclair',        '#92400e', 6),
  ('Manual',        '#64748b', 7)
) AS v(name, color, sort_order)
CROSS JOIN public.companies c
WHERE c.name = 'Delta';

-- ------------------------------------------------------------ helpers
-- The company this person may see: NULL = all.
CREATE OR REPLACE FUNCTION public.my_company_access()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid();
$$;

-- The company in view: the one they are tied to, else the one they picked,
-- else the first company. Never NULL for a signed-in person.
CREATE OR REPLACE FUNCTION public.my_scope_company()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT coalesce(p.company_id, p.active_company_id) FROM public.profiles p WHERE p.id = auth.uid()),
    (SELECT c.id FROM public.companies c ORDER BY c.sort_order, c.name LIMIT 1)
  );
$$;

-- The lines of the company in view. Policies call it once per statement
-- (wrapped in a SELECT), not once per row.
CREATE OR REPLACE FUNCTION public.my_scope_line_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(l.id), '{}'::uuid[])
  FROM public.production_lines l
  WHERE l.company_id = public.my_scope_company();
$$;

REVOKE ALL ON FUNCTION public.my_company_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_scope_company() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_scope_line_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_company_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_scope_company() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_scope_line_ids() TO authenticated;

-- New rows fill in the company in view.
CREATE OR REPLACE FUNCTION public.tg_company_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'production_lines' THEN
    IF NEW.company_id IS NULL THEN
      NEW.company_id := public.my_scope_company();
    END IF;
  ELSIF TG_TABLE_NAME = 'non_production_days' THEN
    IF NEW.line_id IS NOT NULL THEN
      NEW.company_id := NULL;  -- a line's day follows the line
    ELSIF NEW.company_id IS NULL THEN
      NEW.company_id := public.my_scope_company();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_company_default() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER production_lines_company_default
  BEFORE INSERT ON public.production_lines
  FOR EACH ROW EXECUTE FUNCTION public.tg_company_default();
CREATE TRIGGER non_production_days_company_default
  BEFORE INSERT OR UPDATE ON public.non_production_days
  FOR EACH ROW EXECUTE FUNCTION public.tg_company_default();

-- ------------------------------------------------------------ policies
-- companies: who may see which company (the switcher's list).
CREATE POLICY "company scope companies" ON public.companies
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.my_company_access()) IS NULL OR id = (SELECT public.my_company_access()))
  WITH CHECK ((SELECT public.my_company_access()) IS NULL OR id = (SELECT public.my_company_access()));
CREATE POLICY "authenticated read companies" ON public.companies
  FOR SELECT TO authenticated
  USING ((SELECT public.i_am_active()));
CREATE POLICY "admin write companies" ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));
CREATE POLICY "admin update companies" ON public.companies
  FOR UPDATE TO authenticated
  USING ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())))
  WITH CHECK ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));

-- Lines: the company in view.
CREATE POLICY company_scope ON public.production_lines
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id = (SELECT public.my_scope_company()))
  WITH CHECK (company_id = (SELECT public.my_scope_company()));

-- Tables with a line_id.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['daily_entries', 'line_field_definitions', 'maintenance_events',
                           'maintenance_stoppages']
  LOOP
    EXECUTE format($p$
      CREATE POLICY company_scope ON public.%I
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (line_id IS NULL OR line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[]))
        WITH CHECK (line_id IS NULL OR line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[]))
    $p$, t);
  END LOOP;
END $$;

-- Reasons: shared ones (line_id NULL, all 31 today) stay shared.
CREATE POLICY company_scope ON public.downtime_reasons
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (line_id IS NULL OR line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[]))
  WITH CHECK (line_id IS NULL OR line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[]));

-- Non-production days: a line's day by its line, a plant-wide day by company.
CREATE POLICY company_scope ON public.non_production_days
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    CASE WHEN line_id IS NULL
      THEN company_id IS NULL OR company_id = (SELECT public.my_scope_company())
      ELSE line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[])
    END)
  WITH CHECK (
    CASE WHEN line_id IS NULL
      THEN company_id IS NULL OR company_id = (SELECT public.my_scope_company())
      ELSE line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[])
    END);

-- Children of an entry / an event: through their parent.
CREATE POLICY company_scope ON public.entry_downtimes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (entry_id IN (SELECT d.id FROM public.daily_entries d
                      WHERE d.line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[])))
  WITH CHECK (entry_id IN (SELECT d.id FROM public.daily_entries d
                           WHERE d.line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[])));
CREATE POLICY company_scope ON public.entry_area_owners
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (entry_id IN (SELECT d.id FROM public.daily_entries d
                      WHERE d.line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[])))
  WITH CHECK (entry_id IN (SELECT d.id FROM public.daily_entries d
                           WHERE d.line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[])));
CREATE POLICY company_scope ON public.maintenance_notes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (event_id IN (SELECT e.id FROM public.maintenance_events e
                      WHERE e.line_id IS NULL OR e.line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[])))
  WITH CHECK (event_id IN (SELECT e.id FROM public.maintenance_events e
                           WHERE e.line_id IS NULL OR e.line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[])));

-- ----------------------------------------------------- profiles guard
-- Only an admin ties a person to a company. Anyone may change what they are
-- looking at (active_company_id), within what they may see.
CREATE OR REPLACE FUNCTION public.tg_profiles_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
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
    NEW.company_id := OLD.company_id;
  END IF;

  IF NEW.company_id IS NOT NULL THEN
    NEW.active_company_id := NEW.company_id;
  END IF;

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
$function$;

-- -------------------------------------------------------------- push
-- A company's faults and entries reach only the people who may see it.
CREATE OR REPLACE FUNCTION public.send_push(p_topic text, p_title text, p_body text, p_url text, p_company uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
  v_users uuid[];
  v_body jsonb;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'push_function_secret'
  LIMIT 1;
  IF v_secret IS NULL THEN
    RETURN;
  END IF;
  v_body := jsonb_build_object('topic', p_topic, 'title', p_title, 'body', p_body, 'url', p_url);
  IF p_company IS NOT NULL THEN
    SELECT array_agg(p.id) INTO v_users
    FROM public.profiles p
    WHERE p.status = 'active' AND (p.company_id IS NULL OR p.company_id = p_company);
    -- send-push treats an empty list as "everyone": stop here instead.
    IF v_users IS NULL OR cardinality(v_users) = 0 THEN
      RETURN;
    END IF;
    v_body := v_body || jsonb_build_object('user_ids', to_jsonb(v_users));
  END IF;
  PERFORM net.http_post(
    url := 'https://azbsooazusvqkodrlzpi.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-function-secret', v_secret
    ),
    body := v_body
  );
END;
$$;
REVOKE ALL ON FUNCTION public.send_push(text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_maintenance_event_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_lines text;
  v_top_title text;
  v_top_n int;
  v_line_name text;
  v_type_label text;
  v_company uuid;
BEGIN
  IF NEW.status = 'resolved' OR NEW.type = 'preventive' THEN
    RETURN NULL;
  END IF;
  IF coalesce(current_setting('app.suppress_push', true), 'off') = 'on' THEN
    RETURN NULL;
  END IF;

  SELECT company_id INTO v_company FROM public.production_lines WHERE id = NEW.line_id;

  -- One notification per transaction and company.
  IF coalesce(current_setting('app.push_fault_sent_' || coalesce(replace(v_company::text, '-', ''), 'none'), true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('app.push_fault_sent_' || coalesce(replace(v_company::text, '-', ''), 'none'), 'on', true);

  SELECT count(*),
         string_agg(DISTINCT coalesce(l.name, '—'), '، ')
    INTO v_count, v_lines
  FROM public.maintenance_events e
  LEFT JOIN public.production_lines l ON l.id = e.line_id
  WHERE e.created_at = now()
    AND e.status <> 'resolved'
    AND e.type <> 'preventive'
    AND l.company_id IS NOT DISTINCT FROM v_company;

  IF coalesce(v_count, 0) <= 1 THEN
    SELECT name INTO v_line_name FROM public.production_lines WHERE id = NEW.line_id;
    v_type_label := CASE NEW.type
      WHEN 'mechanical'    THEN 'ميكانيكي'
      WHEN 'electrical'    THEN 'كهربائي'
      WHEN 'refrigeration' THEN 'تبريد'
      ELSE NEW.type
    END;
    PERFORM public.send_push(
      'fault',
      'عطل جديد 🔴',
      NEW.title || ' — ' || coalesce(v_line_name, '—') || ' (' || v_type_label || ')',
      '/maintenance',
      v_company
    );
  ELSE
    SELECT title, n INTO v_top_title, v_top_n
    FROM (
      SELECT btrim(e.title) AS title, count(*) AS n
      FROM public.maintenance_events e
      LEFT JOIN public.production_lines l ON l.id = e.line_id
      WHERE e.created_at = now() AND e.status <> 'resolved' AND e.type <> 'preventive'
        AND l.company_id IS NOT DISTINCT FROM v_company
      GROUP BY btrim(e.title)
      ORDER BY count(*) DESC, btrim(e.title)
      LIMIT 1
    ) t;
    PERFORM public.send_push(
      'fault',
      'اتسجل ' || v_count || ' أعطال 🔴',
      v_lines || ' · أكتر عطل: ' || v_top_title || ' (' || v_top_n || ')',
      '/maintenance',
      v_company
    );
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_daily_entry_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_lines text;
  v_line_name text;
  v_shift text;
  v_pct text;
  v_company uuid;
BEGIN
  IF coalesce(current_setting('app.suppress_push', true), 'off') = 'on' THEN
    RETURN NULL;
  END IF;

  SELECT company_id INTO v_company FROM public.production_lines WHERE id = NEW.line_id;

  IF coalesce(current_setting('app.push_entry_sent_' || coalesce(replace(v_company::text, '-', ''), 'none'), true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('app.push_entry_sent_' || coalesce(replace(v_company::text, '-', ''), 'none'), 'on', true);

  SELECT count(*), string_agg(DISTINCT coalesce(l.name, '—'), '، ')
    INTO v_count, v_lines
  FROM public.daily_entries d
  LEFT JOIN public.production_lines l ON l.id = d.line_id
  WHERE d.created_at = now()
    AND l.company_id IS NOT DISTINCT FROM v_company;

  IF coalesce(v_count, 0) <= 1 THEN
    SELECT name INTO v_line_name FROM public.production_lines WHERE id = NEW.line_id;
    v_shift := CASE WHEN NEW.shift = 'DAY' THEN 'Full day' ELSE 'Shift ' || NEW.shift END;
    v_pct := CASE
      WHEN NEW.making_plan > 0
        THEN ' — Making ' || to_char(round(NEW.making_actual / NEW.making_plan * 100, 1), 'FM990.0') || '%'
      ELSE ''
    END;
    PERFORM public.send_push(
      'entry',
      'إدخال جديد 📋',
      coalesce(v_line_name, '—') || ' · ' || to_char(NEW.entry_date, 'Dy DD Mon') || ' · ' || v_shift || v_pct,
      '/entry?line=' || NEW.line_id || '&date=' || NEW.entry_date || '&shift=' || NEW.shift,
      v_company
    );
  ELSE
    PERFORM public.send_push(
      'entry',
      'اتسجل ' || v_count || ' إدخالات 📋',
      v_lines,
      '/',
      v_company
    );
  END IF;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_maintenance_event_push() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_daily_entry_push() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------- replay
CREATE OR REPLACE FUNCTION public.request_replay(p_line uuid, p_day date)
RETURNS TABLE(id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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

  -- Only a line of the company in view.
  IF NOT (p_line = ANY (public.my_scope_line_ids())) THEN
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
$function$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261012120000', 'companies') ON CONFLICT (version) DO NOTHING;
COMMIT;
