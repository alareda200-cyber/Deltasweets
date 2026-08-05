-- 32) Web Push: notify subscribed users when a new maintenance event is
-- logged. Fires the shared `send-push` Edge Function via pg_net (async,
-- fire-and-forget — never blocks or fails the INSERT it's attached to).
--
-- The shared secret the function checks (see supabase/functions/send-push)
-- is intentionally NOT embedded in this file: migrations are committed to
-- git, so it's stored in Supabase Vault instead
-- (`select vault.create_secret(value, 'push_function_secret')`, run once
-- directly against the project, not tracked here). If the secret hasn't
-- been configured yet, the trigger silently no-ops rather than blocking
-- maintenance event creation.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_maintenance_event_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
  v_line_name text;
  v_type_label text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'push_function_secret'
  LIMIT 1;

  IF v_secret IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_line_name FROM public.production_lines WHERE id = NEW.line_id;
  v_type_label := CASE NEW.type
    WHEN 'mechanical' THEN 'ميكانيكي'
    WHEN 'electrical' THEN 'كهربائي'
    ELSE NEW.type
  END;

  PERFORM net.http_post(
    url := 'https://azbsooazusvqkodrlzpi.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-function-secret', v_secret
    ),
    body := jsonb_build_object(
      'title', 'عطل جديد 🔴',
      'body', NEW.title || ' — ' || coalesce(v_line_name, '—') || ' (' || v_type_label || ')',
      'url', '/maintenance'
    )
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER maintenance_events_push_notify
  AFTER INSERT ON public.maintenance_events
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_maintenance_event_push();
