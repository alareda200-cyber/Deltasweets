BEGIN;
-- Making capacity per line (13 Oct 2026, approved mockup).
--
-- An admin sets each line's making capacity, per DAY or per SHIFT, from a
-- date. The daily entry's making plan then comes from it and nobody types it:
--
--   full day = 1,440 min, a shift (A / B / C) = 480 min → 1 day = 3 shifts
--   capacity per day   → Full-day entry: all of it, shift entry: a third
--   capacity per shift → shift entry: all of it,   Full-day entry: × 3
--
-- Lines that also count making (pallets…) can have a capacity in that unit
-- too; it fills making_plan_count the same way. A capacity without a count
-- leaves making_plan_count to the supervisor.
--
-- A capacity applies to entries dated on or after its effective_from, until
-- the next one. Entries before the first capacity of a line keep the plan
-- they were saved with, and a line with no capacity keeps the plan typed by
-- hand. Saving or removing a capacity re-plans the entries it covers.
--
-- The plan is set by a trigger, so the lock holds whatever the client sends.
--
-- Rollback:
--   DROP TRIGGER tg_zz_making_plan_from_capacity ON public.daily_entries;
--   DROP TRIGGER line_capacities_replan ON public.line_capacities;
--   DROP FUNCTION public.tg_making_plan_from_capacity(), public.tg_line_capacities_replan(),
--     public.making_plan_for(uuid, date, text);
--   DROP TABLE public.line_capacities;
--   (entries keep the plans they have)

CREATE TABLE public.line_capacities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES public.production_lines(id) ON DELETE CASCADE,
  basis text NOT NULL CHECK (basis IN ('day', 'shift')),
  making_kg numeric NOT NULL CHECK (making_kg > 0),
  making_count numeric CHECK (making_count IS NULL OR making_count > 0),
  effective_from date NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (line_id, effective_from)
);
CREATE INDEX line_capacities_line_from_idx ON public.line_capacities(line_id, effective_from DESC);
CREATE INDEX line_capacities_created_by_idx ON public.line_capacities(created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.line_capacities TO authenticated;
GRANT ALL ON public.line_capacities TO service_role;
ALTER TABLE public.line_capacities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read line capacities" ON public.line_capacities
  FOR SELECT TO authenticated
  USING ((SELECT public.i_am_active()));
CREATE POLICY "admin insert line capacities" ON public.line_capacities
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));
CREATE POLICY "admin update line capacities" ON public.line_capacities
  FOR UPDATE TO authenticated
  USING ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())))
  WITH CHECK ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));
CREATE POLICY "admin delete line capacities" ON public.line_capacities
  FOR DELETE TO authenticated
  USING ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));
-- Same company scope as every other line table.
CREATE POLICY company_scope ON public.line_capacities
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[]))
  WITH CHECK (line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[]));

-- The plan for one line, day and shift: NULL when no capacity applies.
CREATE OR REPLACE FUNCTION public.making_plan_for(p_line uuid, p_day date, p_shift text)
RETURNS TABLE(plan_kg numeric, plan_count numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    round(CASE
      WHEN c.basis = 'day'   AND p_shift = 'DAY' THEN c.making_kg
      WHEN c.basis = 'day'                       THEN c.making_kg / 3
      WHEN c.basis = 'shift' AND p_shift = 'DAY' THEN c.making_kg * 3
      ELSE c.making_kg
    END),
    round(CASE
      WHEN c.making_count IS NULL                THEN NULL
      WHEN c.basis = 'day'   AND p_shift = 'DAY' THEN c.making_count
      WHEN c.basis = 'day'                       THEN c.making_count / 3
      WHEN c.basis = 'shift' AND p_shift = 'DAY' THEN c.making_count * 3
      ELSE c.making_count
    END, 1)
  FROM public.line_capacities c
  WHERE c.line_id = p_line AND c.effective_from <= p_day
  ORDER BY c.effective_from DESC
  LIMIT 1;
$$;
-- Only the triggers call it (the app reads line_capacities, which keeps the
-- company scope); not callable through the API.
REVOKE ALL ON FUNCTION public.making_plan_for(uuid, date, text) FROM PUBLIC, anon, authenticated;

-- Runs after tg_daily_entries_column_guard (triggers fire by name).
CREATE OR REPLACE FUNCTION public.tg_making_plan_from_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kg numeric;
  v_count numeric;
BEGIN
  SELECT plan_kg, plan_count INTO v_kg, v_count
  FROM public.making_plan_for(NEW.line_id, NEW.entry_date, NEW.shift);
  IF v_kg IS NOT NULL THEN
    NEW.making_plan := v_kg;
    IF v_count IS NOT NULL THEN
      NEW.making_plan_count := v_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_making_plan_from_capacity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tg_zz_making_plan_from_capacity
  BEFORE INSERT OR UPDATE ON public.daily_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_making_plan_from_capacity();

-- Saving or removing a capacity re-plans the entries it covers.
CREATE OR REPLACE FUNCTION public.tg_line_capacities_replan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line uuid;
  v_from date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_line := OLD.line_id;
    v_from := OLD.effective_from;
  ELSIF TG_OP = 'UPDATE' THEN
    v_line := NEW.line_id;
    v_from := least(OLD.effective_from, NEW.effective_from);
  ELSE
    v_line := NEW.line_id;
    v_from := NEW.effective_from;
  END IF;
  -- A no-op update: the BEFORE trigger on daily_entries sets the plan.
  UPDATE public.daily_entries d
     SET making_plan = d.making_plan
   WHERE d.line_id = v_line AND d.entry_date >= v_from;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_line_capacities_replan() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER line_capacities_replan
  AFTER INSERT OR UPDATE OR DELETE ON public.line_capacities
  FOR EACH ROW EXECUTE FUNCTION public.tg_line_capacities_replan();

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261013120000', 'line_capacities') ON CONFLICT (version) DO NOTHING;
COMMIT;
