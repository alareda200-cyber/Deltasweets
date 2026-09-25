-- Production targets, editable in Settings › Targets instead of being fixed in
-- code (90% making/packing adherence, 10% time-lost alert).
--
-- They live on the existing single-row app_settings table (id = true), next
-- to reliability_start_date, so they inherit its RLS as is:
--   "authenticated read app settings"  → everyone reads them
--   "admin update app settings"        → only admins change them
-- No new table, no new policy.
--
-- Defaults are the values the app used until now, so nothing on screen changes
-- the moment this runs. target_rework_pct is NULL = "no target set", which is
-- what the dashboard shows today.
--
-- Rollback:
--   ALTER TABLE public.app_settings DROP CONSTRAINT IF EXISTS app_settings_targets_range,
--     DROP COLUMN IF EXISTS target_making_pct, DROP COLUMN IF EXISTS target_packing_pct,
--     DROP COLUMN IF EXISTS target_loss_pct, DROP COLUMN IF EXISTS target_rework_pct;

BEGIN;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS target_making_pct  numeric NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS target_packing_pct numeric NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS target_loss_pct    numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS target_rework_pct  numeric NULL;

ALTER TABLE public.app_settings DROP CONSTRAINT IF EXISTS app_settings_targets_range;
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_targets_range CHECK (
  target_making_pct  > 0 AND target_making_pct  <= 100 AND
  target_packing_pct > 0 AND target_packing_pct <= 100 AND
  target_loss_pct    > 0 AND target_loss_pct    <= 100 AND
  (target_rework_pct IS NULL OR (target_rework_pct > 0 AND target_rework_pct <= 100))
);

-- ---------- self-assert ----------
DO $$
DECLARE
  v_rows integer;
  v_ok   integer;
BEGIN
  SELECT count(*) INTO v_rows FROM public.app_settings;
  SELECT count(*) INTO v_ok FROM public.app_settings
   WHERE id = true
     AND target_making_pct = 90 AND target_packing_pct = 90
     AND target_loss_pct = 10 AND target_rework_pct IS NULL;
  IF v_rows <> 1 OR v_ok <> 1 THEN
    RAISE EXCEPTION 'production_targets: expected the one app_settings row with default targets (rows=%, ok=%). Nothing was committed.', v_rows, v_ok;
  END IF;
END $$;

COMMIT;
