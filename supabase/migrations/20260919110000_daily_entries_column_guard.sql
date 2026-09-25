-- Closes the residual gap documented in 20260918140000_entry_write_rbac.sql:
-- "production update entries" on daily_entries has to admit admin, production,
-- maintenance and quality, because comments lives on the same row and
-- entry.editNotes in src/lib/permissions.ts grants all four. RLS decides per
-- ROW, never per COLUMN, and every application user shares one Postgres role
-- (authenticated), so a maintenance or quality caller could change
-- making_actual / packing_actual / rework_* directly through the REST API
-- even though the UI never offers them that field.
--
-- The UI already enforces the column-level rule client-side (see
-- effectiveMakingActual etc. in src/routes/entry.tsx, ~line 320-341) but a
-- client-side rule is not a security boundary. This migration enforces the
-- same rule in the database: a BEFORE UPDATE trigger that silently restores
-- production-quantity columns to their previous value whenever the caller is
-- not admin or production. "Silently" is deliberate — the UI's upsert always
-- sends the whole row, comments included, with these columns already carrying
-- their original (unchanged) value for non-production/admin callers. Raising
-- an exception here would reject that same, already-correct save. The trigger
-- is a no-op for normal use and closes the API only.
--
-- Not an RPC-for-comments or a comments child table: both would require
-- splitting the save path and touching entry.tsx, and a maintenance user
-- genuinely needs UPDATE on the row to record downtime. That is a UI/data
-- model refactor, not a safe fix for an open write path.
--
-- Columns locked to non-admin/non-production callers:
--   making_plan, making_actual, packing_plan, packing_actual,
--   rework_cooking, rework_making, rework_packing, custom_fields
-- Columns left alone (comments, downtime_min, available_min, supervisor,
-- operator all stay writable per the existing RLS policy's role list).
--
-- This does not touch any RLS policy. It adds a trigger on top of the
-- existing "production update entries" policy from 20260918140000.

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_daily_entries_column_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  caller_role text;
  v_uid       uuid;
BEGIN
  v_uid := (select auth.uid());

  -- No JWT means this is not an application user: a migration, a psql session,
  -- the Supabase SQL editor, or a service_role call. Those already bypass RLS
  -- entirely, so restricting them buys no security -- and restricting them
  -- silently would be actively harmful. Without this early return the trigger
  -- reverts quantity edits made from the SQL editor while reporting success,
  -- so an import or a hand correction would appear to work and change nothing.
  -- Measured before the fix: UPDATE ... SET making_actual = 999 from a direct
  -- SQL session left the row at its old value with no error raised.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role INTO caller_role
  FROM public.profiles
  WHERE id = v_uid;

  IF caller_role IS DISTINCT FROM 'admin' AND caller_role IS DISTINCT FROM 'production' THEN
    NEW.making_plan     := OLD.making_plan;
    NEW.making_actual    := OLD.making_actual;
    NEW.packing_plan     := OLD.packing_plan;
    NEW.packing_actual   := OLD.packing_actual;
    NEW.rework_cooking   := OLD.rework_cooking;
    NEW.rework_making    := OLD.rework_making;
    NEW.rework_packing   := OLD.rework_packing;
    NEW.custom_fields    := OLD.custom_fields;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_daily_entries_column_guard ON public.daily_entries;
CREATE TRIGGER tg_daily_entries_column_guard
  BEFORE UPDATE ON public.daily_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_daily_entries_column_guard();

-- ---------- self-assert ----------
DO $$
DECLARE
  v_tgenabled "char";
  v_is_before boolean;
  v_is_row boolean;
  v_events integer;
BEGIN
  SELECT t.tgenabled,
         (t.tgtype & 2) <> 0,   -- TRIGGER_TYPE_BEFORE bit
         (t.tgtype & 1) <> 0,   -- TRIGGER_TYPE_ROW bit
         (t.tgtype & 16)        -- TRIGGER_TYPE_UPDATE bit
    INTO v_tgenabled, v_is_before, v_is_row, v_events
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.daily_entries'::regclass
    AND t.tgname = 'tg_daily_entries_column_guard'
    AND NOT t.tgisinternal;

  IF v_tgenabled IS NULL THEN
    RAISE EXCEPTION 'daily_entries_column_guard: trigger tg_daily_entries_column_guard was not created on public.daily_entries. Nothing was committed.';
  END IF;

  IF v_tgenabled NOT IN ('O', 'A') THEN
    RAISE EXCEPTION 'daily_entries_column_guard: trigger tg_daily_entries_column_guard exists but is disabled (tgenabled=%). Nothing was committed.', v_tgenabled;
  END IF;

  IF NOT v_is_before OR NOT v_is_row THEN
    RAISE EXCEPTION 'daily_entries_column_guard: trigger tg_daily_entries_column_guard is not a BEFORE ROW trigger. Nothing was committed.';
  END IF;

  IF v_events = 0 THEN
    RAISE EXCEPTION 'daily_entries_column_guard: trigger tg_daily_entries_column_guard is not firing on UPDATE. Nothing was committed.';
  END IF;
END $$;

COMMIT;

-- ROLLBACK:
-- DROP TRIGGER IF EXISTS tg_daily_entries_column_guard ON public.daily_entries;
-- DROP FUNCTION IF EXISTS public.tg_daily_entries_column_guard();
