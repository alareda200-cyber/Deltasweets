BEGIN;
-- Packing machines by shift (Ala, 20 Oct 2026; mockup "Machine Shifts
-- Mockup"). The machine sheet is pasted from Excel on the daily entry:
--   Code · Type · Operator · Bag weight (film, kept only) · Machine ·
--   D-Speed (the speed it was set to run at) · Total Quantity (bags) · Shift.
-- One row per SKU a machine packed in a shift. A machine can pack another
-- line's SKUs (Rovema 4 packs marshmallows), so a row belongs to the machine
-- and the day, not to a line's entry.
--
-- entry_machines stays what the OEE reads. For each machine and day with
-- rows, the Full-day entry of the line the machine packs for gets:
--   shifts = the shifts with rows (A, B, C), bags = their total,
--   bag_g  = the bag weight (g) averaged over the bags, from the SKU names.
-- When the rows go, that summary goes too. Days entered by hand before
-- (no rows) are left as they are.
--
-- Rollback:
--   DROP TRIGGER daily_entries_machine_runs ON public.daily_entries;
--   DROP TABLE public.machine_runs;  -- the summaries it wrote stay
--   DROP FUNCTION public.tg_machine_runs_summary(), public.tg_entry_machine_runs(),
--     public.machine_runs_summarise(uuid, date);

CREATE TABLE public.machine_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL,
  shift text NOT NULL CHECK (shift IN ('A', 'B', 'C')),
  machine_id uuid NOT NULL REFERENCES public.packing_machines(id) ON DELETE CASCADE,
  sku_id uuid REFERENCES public.skus(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL DEFAULT '',
  operator text,
  film_weight numeric CHECK (film_weight IS NULL OR film_weight >= 0),
  set_speed numeric CHECK (set_speed IS NULL OR set_speed >= 0),
  bags numeric NOT NULL CHECK (bags >= 0 AND bags <= 100000000),
  -- weight of one bag in grams, read from the SKU name; NULL when it doesn't say
  bag_g numeric CHECK (bag_g IS NULL OR (bag_g > 0 AND bag_g <= 100000)),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX machine_runs_day_idx ON public.machine_runs(day, machine_id);
CREATE INDEX machine_runs_machine_idx ON public.machine_runs(machine_id);
CREATE INDEX machine_runs_sku_idx ON public.machine_runs(sku_id);
CREATE INDEX machine_runs_created_by_idx ON public.machine_runs(created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.machine_runs TO authenticated;
GRANT ALL ON public.machine_runs TO service_role;
ALTER TABLE public.machine_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read machine runs" ON public.machine_runs
  FOR SELECT TO authenticated USING ((SELECT public.i_am_active()));
CREATE POLICY "production insert machine runs" ON public.machine_runs
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'production')));
CREATE POLICY "production update machine runs" ON public.machine_runs
  FOR UPDATE TO authenticated
  USING ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'production')))
  WITH CHECK ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'production')));
CREATE POLICY "production delete machine runs" ON public.machine_runs
  FOR DELETE TO authenticated
  USING ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'production')));
CREATE POLICY company_scope ON public.machine_runs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (machine_id IN (SELECT pm.id FROM public.packing_machines pm
                        WHERE pm.line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[])))
  WITH CHECK (machine_id IN (SELECT pm.id FROM public.packing_machines pm
                        WHERE pm.line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[])));

-- The machine's summary on its line's Full-day entry for that day.
CREATE OR REPLACE FUNCTION public.machine_runs_summarise(p_machine uuid, p_day date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry uuid;
  v_shifts int;
  v_bags numeric;
  v_g numeric;
BEGIN
  SELECT d.id INTO v_entry
    FROM public.daily_entries d
    JOIN public.packing_machines pm ON pm.line_id = d.line_id
   WHERE pm.id = p_machine AND d.entry_date = p_day AND d.shift = 'DAY';
  IF v_entry IS NULL THEN
    RETURN;
  END IF;
  SELECT count(DISTINCT r.shift), coalesce(sum(r.bags), 0),
         round(sum(r.bags * r.bag_g) FILTER (WHERE r.bag_g IS NOT NULL)
               / nullif(sum(r.bags) FILTER (WHERE r.bag_g IS NOT NULL), 0), 2)
    INTO v_shifts, v_bags, v_g
    FROM public.machine_runs r
   WHERE r.machine_id = p_machine AND r.day = p_day;
  IF v_shifts = 0 THEN
    DELETE FROM public.entry_machines WHERE entry_id = v_entry AND machine_id = p_machine;
  ELSE
    INSERT INTO public.entry_machines (entry_id, machine_id, shifts, bags, bag_g)
    VALUES (v_entry, p_machine, v_shifts, v_bags, v_g)
    ON CONFLICT (entry_id, machine_id)
      DO UPDATE SET shifts = EXCLUDED.shifts, bags = EXCLUDED.bags, bag_g = EXCLUDED.bag_g;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.machine_runs_summarise(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_machine_runs_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.machine_runs_summarise(OLD.machine_id, OLD.day);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.machine_runs_summarise(NEW.machine_id, NEW.day);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_machine_runs_summary() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER machine_runs_summary
  AFTER INSERT OR UPDATE OR DELETE ON public.machine_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_machine_runs_summary();

-- A Full-day entry saved after the sheet was pasted picks the summaries up.
CREATE OR REPLACE FUNCTION public.tg_entry_machine_runs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m uuid;
BEGIN
  IF NEW.shift <> 'DAY' THEN
    RETURN NULL;
  END IF;
  FOR m IN
    SELECT DISTINCT r.machine_id FROM public.machine_runs r
      JOIN public.packing_machines pm ON pm.id = r.machine_id
     WHERE pm.line_id = NEW.line_id AND r.day = NEW.entry_date
  LOOP
    PERFORM public.machine_runs_summarise(m, NEW.entry_date);
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_entry_machine_runs() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER daily_entries_machine_runs
  AFTER INSERT ON public.daily_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_entry_machine_runs();

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261020120000', 'machine_runs') ON CONFLICT (version) DO NOTHING;
COMMIT;
