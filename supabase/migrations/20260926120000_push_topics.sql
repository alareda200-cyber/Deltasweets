-- Push notifications: each device chooses what it hears about — faults,
-- daily entries, or both — and a batch of rows sends one summary instead of
-- one notification per row.
--
-- 1. push_subscriptions.topics ('fault' | 'entry'). Existing devices keep
--    what they had (faults only). Users may change the topics on their own
--    rows (UPDATE policy, topics column only).
-- 2. public.send_push(topic, title, body, url): the one place that reads the
--    Vault secret and calls the send-push Edge Function (pg_net, async,
--    fire-and-forget). Not callable by app users.
-- 3. Faults (maintenance_events): the trigger becomes a deferred constraint
--    trigger, so it runs once the transaction commits and can see every row
--    that transaction added. One new fault → "عطل جديد" with its title; many
--    in one go → one summary ("اتسجل 5 أعطال …"). Kept from the live version:
--    rows that arrive already resolved are history, not alerts, and
--    SET LOCAL app.suppress_push = 'on' silences a bulk load. New: preventive
--    maintenance is not a fault and no longer notifies.
-- 4. Daily entries: the first save of an entry notifies (edits don't), with
--    the same one-or-summary rule.
--
-- Rows "added by this transaction" are found by created_at = now(): both
-- tables default created_at to now(), which is the transaction's start time.

-- ---------------------------------------------------------------- 1. topics
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS topics text[] NOT NULL DEFAULT ARRAY['fault']::text[];

ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_topics_check;
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_topics_check
  CHECK (cardinality(topics) > 0 AND topics <@ ARRAY['fault', 'entry']::text[]);

GRANT UPDATE (topics) ON public.push_subscriptions TO authenticated;

DROP POLICY IF EXISTS "Users can update their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can update their own push subscriptions" ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- ------------------------------------------------------------- 2. send_push
CREATE OR REPLACE FUNCTION public.send_push(p_topic text, p_title text, p_body text, p_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'push_function_secret'
  LIMIT 1;

  -- No secret configured → silently do nothing; never block the insert.
  IF v_secret IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://azbsooazusvqkodrlzpi.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-function-secret', v_secret
    ),
    body := jsonb_build_object(
      'topic', p_topic,
      'title', p_title,
      'body', p_body,
      'url', p_url
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_push(text, text, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 3. faults
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
BEGIN
  -- A fault that arrives already closed is history; preventive maintenance
  -- is planned work, not a fault.
  IF NEW.status = 'resolved' OR NEW.type = 'preventive' THEN
    RETURN NULL;
  END IF;

  -- Explicit opt-out for bulk loads (SET LOCAL app.suppress_push = 'on').
  IF coalesce(current_setting('app.suppress_push', true), 'off') = 'on' THEN
    RETURN NULL;
  END IF;

  -- One notification per transaction: the first row to get here speaks for
  -- all of them.
  IF coalesce(current_setting('app.push_fault_sent', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('app.push_fault_sent', 'on', true);

  SELECT count(*),
         string_agg(DISTINCT coalesce(l.name, '—'), '، ')
    INTO v_count, v_lines
  FROM public.maintenance_events e
  LEFT JOIN public.production_lines l ON l.id = e.line_id
  WHERE e.created_at = now()
    AND e.status <> 'resolved'
    AND e.type <> 'preventive';

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
      '/maintenance'
    );
  ELSE
    SELECT title, n INTO v_top_title, v_top_n
    FROM (
      SELECT btrim(title) AS title, count(*) AS n
      FROM public.maintenance_events
      WHERE created_at = now() AND status <> 'resolved' AND type <> 'preventive'
      GROUP BY btrim(title)
      ORDER BY count(*) DESC, btrim(title)
      LIMIT 1
    ) t;
    PERFORM public.send_push(
      'fault',
      'اتسجل ' || v_count || ' أعطال 🔴',
      v_lines || ' · أكتر عطل: ' || v_top_title || ' (' || v_top_n || ')',
      '/maintenance'
    );
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS maintenance_events_push_notify ON public.maintenance_events;
CREATE CONSTRAINT TRIGGER maintenance_events_push_notify
  AFTER INSERT ON public.maintenance_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_maintenance_event_push();

-- --------------------------------------------------------------- 4. entries
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
BEGIN
  IF coalesce(current_setting('app.suppress_push', true), 'off') = 'on' THEN
    RETURN NULL;
  END IF;

  IF coalesce(current_setting('app.push_entry_sent', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('app.push_entry_sent', 'on', true);

  SELECT count(*), string_agg(DISTINCT coalesce(l.name, '—'), '، ')
    INTO v_count, v_lines
  FROM public.daily_entries d
  LEFT JOIN public.production_lines l ON l.id = d.line_id
  WHERE d.created_at = now();

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
      '/entry?line=' || NEW.line_id || '&date=' || NEW.entry_date || '&shift=' || NEW.shift
    );
  ELSE
    PERFORM public.send_push(
      'entry',
      'اتسجل ' || v_count || ' إدخالات 📋',
      v_lines,
      '/'
    );
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS daily_entries_push_notify ON public.daily_entries;
CREATE CONSTRAINT TRIGGER daily_entries_push_notify
  AFTER INSERT ON public.daily_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_daily_entry_push();

REVOKE ALL ON FUNCTION public.notify_maintenance_event_push() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_daily_entry_push() FROM PUBLIC, anon, authenticated;
