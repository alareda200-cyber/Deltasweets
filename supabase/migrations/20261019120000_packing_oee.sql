BEGIN;
-- OEE and plan adherence (19 Oct 2026, November monthly upgrade, approved
-- mockup v4 https://claude.ai/artifact/7ZJKaGy6KeNkJqNpVHBR2W).
--
--   packing_machines  the machines that pack a line (Rovema 1–5 for Gelatin,
--                     Twist 1–3 for Pectin) with their ideal speed per minute.
--   maintenance_events.machine_id
--                     a fault that stopped ONE packing machine, not the line:
--                     stops_line = false (no line downtime), never part of a
--                     stoppage. It lowers that machine's availability only.
--   skus              the company's SKU list with kg per unit (carton, box…).
--   packed_skus       what was packed per SKU, line and day, pasted on the
--                     Plan adherence page; kg is the snapshot at paste time.
--                     The line's Full-day entry takes its packing actual from
--                     it (trigger below).
--   sku_forecasts     the month's forecast per SKU, qty in the SKU's unit.
--   entry_machines    per packing machine on a daily entry: shifts run (0–3),
--                     bags packed and bag weight.
--   production_lines.oee_basis
--                     the line's making OEE in kg or in its count unit.
--   daily_entries.wip_kg
--                     made but not packed yet at the end of the entry, so the
--                     packing difference isn't taken for rework or loss.
--
-- OEE itself is computed by the app (src/lib/oee.ts, src/lib/line-oee.ts).
--
-- Old faults on the packing machines (titles "Rovema N …", "Twist N",
-- "Twist Machine no N") are linked to their machine and moved to the line the
-- machine packs for, with stops_line = false: Ala, 19 Oct — "توقف الماكينه
-- بيوقف الماكينه مش الخط".
--
-- Rollback:
--   UPDATE public.maintenance_events e SET stops_line = b.stops_line, line_id = b.line_id, machine_id = NULL
--     FROM public._packing_oee_backfill b WHERE b.id = e.id;   -- before dropping the table below
--   ALTER TABLE public.maintenance_events DROP CONSTRAINT maintenance_events_machine_stop,
--     DROP COLUMN machine_id;
--   DROP TABLE public.entry_machines, public.packed_skus, public.sku_forecasts,
--     public.skus, public.packing_machines, public._packing_oee_backfill;
--   DROP FUNCTION public.tg_machine_event_line(), public.tg_packed_skus_entry_actual();
--   ALTER TABLE public.production_lines DROP COLUMN oee_basis;
--   ALTER TABLE public.daily_entries DROP COLUMN wip_kg;
--   (and restore tg_daily_entries_column_guard without the wip_kg line)

-- ------------------------------------------------------------ machines
CREATE TABLE public.packing_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES public.production_lines(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  speed_per_min numeric NOT NULL CHECK (speed_per_min > 0),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (line_id, name)
);
CREATE INDEX packing_machines_line_idx ON public.packing_machines(line_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.packing_machines TO authenticated;
GRANT ALL ON public.packing_machines TO service_role;
ALTER TABLE public.packing_machines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read packing machines" ON public.packing_machines
  FOR SELECT TO authenticated USING ((SELECT public.i_am_active()));
CREATE POLICY "admin insert packing machines" ON public.packing_machines
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));
CREATE POLICY "admin update packing machines" ON public.packing_machines
  FOR UPDATE TO authenticated
  USING ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())))
  WITH CHECK ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));
CREATE POLICY "admin delete packing machines" ON public.packing_machines
  FOR DELETE TO authenticated
  USING ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));
CREATE POLICY company_scope ON public.packing_machines
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[]))
  WITH CHECK (line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[]));

-- ---------------------------------------------------- machine stops
ALTER TABLE public.maintenance_events
  ADD COLUMN machine_id uuid REFERENCES public.packing_machines(id) ON DELETE SET NULL;
CREATE INDEX maintenance_events_machine_idx ON public.maintenance_events(machine_id)
  WHERE machine_id IS NOT NULL;

-- A machine stop belongs to the line the machine packs for.
CREATE OR REPLACE FUNCTION public.tg_machine_event_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line uuid;
BEGIN
  IF NEW.machine_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT line_id INTO v_line FROM public.packing_machines WHERE id = NEW.machine_id;
  IF v_line IS DISTINCT FROM NEW.line_id THEN
    RAISE EXCEPTION 'This machine packs for another line.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_machine_event_line() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER maintenance_events_machine_line
  BEFORE INSERT OR UPDATE OF machine_id, line_id ON public.maintenance_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_machine_event_line();

-- ------------------------------------------------------------- SKUs
CREATE TABLE public.skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE
    DEFAULT public.my_scope_company(),
  code text NOT NULL CHECK (btrim(code) <> ''),
  name text NOT NULL DEFAULT '',
  unit text,
  line_id uuid REFERENCES public.production_lines(id) ON DELETE SET NULL,
  kg_per_unit numeric CHECK (kg_per_unit IS NULL OR kg_per_unit > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX skus_line_idx ON public.skus(line_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.skus TO authenticated;
GRANT ALL ON public.skus TO service_role;
ALTER TABLE public.skus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read skus" ON public.skus
  FOR SELECT TO authenticated USING ((SELECT public.i_am_active()));
CREATE POLICY "admin insert skus" ON public.skus
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));
CREATE POLICY "admin update skus" ON public.skus
  FOR UPDATE TO authenticated
  USING ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())))
  WITH CHECK ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));
CREATE POLICY "admin delete skus" ON public.skus
  FOR DELETE TO authenticated
  USING ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));
CREATE POLICY company_scope ON public.skus
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id = (SELECT public.my_scope_company()))
  WITH CHECK (company_id = (SELECT public.my_scope_company()));

-- ------------------------------------------------- line settings, WIP
ALTER TABLE public.production_lines
  ADD COLUMN oee_basis text NOT NULL DEFAULT 'kg' CHECK (oee_basis IN ('kg', 'count'));
ALTER TABLE public.daily_entries
  ADD COLUMN wip_kg numeric NOT NULL DEFAULT 0 CHECK (wip_kg >= 0 AND wip_kg <= 1000000);

-- WIP is a production figure: same guard as the others (live definition of
-- 29 Sep + wip_kg).
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
    NEW.wip_kg               := OLD.wip_kg;
    NEW.custom_fields        := OLD.custom_fields;
  END IF;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------ packed SKUs
CREATE TABLE public.packed_skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES public.production_lines(id) ON DELETE CASCADE,
  day date NOT NULL,
  sku_id uuid REFERENCES public.skus(id) ON DELETE SET NULL,
  code text NOT NULL,
  qty numeric NOT NULL CHECK (qty >= 0 AND qty <= 10000000),
  -- kg at the weight the SKU had when it was pasted; NULL = unknown SKU
  kg numeric CHECK (kg IS NULL OR (kg >= 0 AND kg <= 10000000)),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX packed_skus_line_day_idx ON public.packed_skus(line_id, day);
CREATE INDEX packed_skus_day_idx ON public.packed_skus(day);
CREATE INDEX packed_skus_sku_idx ON public.packed_skus(sku_id);
CREATE INDEX packed_skus_created_by_idx ON public.packed_skus(created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.packed_skus TO authenticated;
GRANT ALL ON public.packed_skus TO service_role;
ALTER TABLE public.packed_skus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read packed skus" ON public.packed_skus
  FOR SELECT TO authenticated USING ((SELECT public.i_am_active()));
CREATE POLICY "production insert packed skus" ON public.packed_skus
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'production')));
CREATE POLICY "production update packed skus" ON public.packed_skus
  FOR UPDATE TO authenticated
  USING ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'production')))
  WITH CHECK ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'production')));
CREATE POLICY "production delete packed skus" ON public.packed_skus
  FOR DELETE TO authenticated
  USING ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'production')));
CREATE POLICY company_scope ON public.packed_skus
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[]))
  WITH CHECK (line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[]));


-- The line's Full-day entry for that day takes its packing actual from the
-- packed SKUs. Lines entered by shift keep packing actual as typed. A day
-- whose SKUs are all removed keeps the last figure.
CREATE OR REPLACE FUNCTION public.tg_packed_skus_entry_actual()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line uuid;
  v_day date;
  v_kg numeric;
  v_n int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_line := OLD.line_id; v_day := OLD.day;
  ELSE
    v_line := NEW.line_id; v_day := NEW.day;
  END IF;
  SELECT round(coalesce(sum(p.kg), 0), 2), count(*) INTO v_kg, v_n
    FROM public.packed_skus p
   WHERE p.line_id = v_line AND p.day = v_day;
  IF v_n > 0 THEN
    UPDATE public.daily_entries d
       SET packing_actual = v_kg
     WHERE d.line_id = v_line AND d.entry_date = v_day AND d.shift = 'DAY'
       AND d.packing_actual IS DISTINCT FROM v_kg;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_packed_skus_entry_actual() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER packed_skus_entry_actual
  AFTER INSERT OR UPDATE OR DELETE ON public.packed_skus
  FOR EACH ROW EXECUTE FUNCTION public.tg_packed_skus_entry_actual();

-- ---------------------------------------------------- SKU forecasts
CREATE TABLE public.sku_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE
    DEFAULT public.my_scope_company(),
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  sku_id uuid REFERENCES public.skus(id) ON DELETE SET NULL,
  code text NOT NULL,
  -- in the SKU's own unit (carton, box, kg…)
  qty numeric NOT NULL CHECK (qty >= 0 AND qty <= 100000000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, month, code)
);
CREATE INDEX sku_forecasts_sku_idx ON public.sku_forecasts(sku_id);
CREATE INDEX sku_forecasts_created_by_idx ON public.sku_forecasts(created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sku_forecasts TO authenticated;
GRANT ALL ON public.sku_forecasts TO service_role;
ALTER TABLE public.sku_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read sku forecasts" ON public.sku_forecasts
  FOR SELECT TO authenticated USING ((SELECT public.i_am_active()));
CREATE POLICY "admin insert sku forecasts" ON public.sku_forecasts
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));
CREATE POLICY "admin update sku forecasts" ON public.sku_forecasts
  FOR UPDATE TO authenticated
  USING ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())))
  WITH CHECK ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));
CREATE POLICY "admin delete sku forecasts" ON public.sku_forecasts
  FOR DELETE TO authenticated
  USING ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));
CREATE POLICY company_scope ON public.sku_forecasts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id = (SELECT public.my_scope_company()))
  WITH CHECK (company_id = (SELECT public.my_scope_company()));

-- ------------------------------------------------- entry machines
CREATE TABLE public.entry_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.daily_entries(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL REFERENCES public.packing_machines(id) ON DELETE CASCADE,
  shifts integer NOT NULL CHECK (shifts BETWEEN 0 AND 3),
  bags numeric NOT NULL DEFAULT 0 CHECK (bags >= 0 AND bags <= 100000000),
  bag_g numeric CHECK (bag_g IS NULL OR (bag_g > 0 AND bag_g <= 100000)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, machine_id)
);
CREATE INDEX entry_machines_machine_idx ON public.entry_machines(machine_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.entry_machines TO authenticated;
GRANT ALL ON public.entry_machines TO service_role;
ALTER TABLE public.entry_machines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read entry machines" ON public.entry_machines
  FOR SELECT TO authenticated USING ((SELECT public.i_am_active()));
-- Same writers as the production figures of daily_entries.
CREATE POLICY "production insert entry machines" ON public.entry_machines
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'production')));
CREATE POLICY "production update entry machines" ON public.entry_machines
  FOR UPDATE TO authenticated
  USING ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'production')))
  WITH CHECK ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'production')));
CREATE POLICY "production delete entry machines" ON public.entry_machines
  FOR DELETE TO authenticated
  USING ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'production')));
CREATE POLICY company_scope ON public.entry_machines
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (entry_id IN (SELECT d.id FROM public.daily_entries d
                      WHERE d.line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[])))
  WITH CHECK (entry_id IN (SELECT d.id FROM public.daily_entries d
                      WHERE d.line_id = ANY ((SELECT public.my_scope_line_ids())::uuid[])));

-- ------------------------------------------------- Jammy's machines
-- Rovema 1–4 150 bags/min, Rovema 5 35 (Ala); Twist 1–3 450 (Ala).
INSERT INTO public.packing_machines (line_id, name, speed_per_min, sort_order)
SELECT l.id, m.name, m.speed, m.ord
FROM (VALUES
  ('Gelatin', 'Rovema 1', 150, 1), ('Gelatin', 'Rovema 2', 150, 2),
  ('Gelatin', 'Rovema 3', 150, 3), ('Gelatin', 'Rovema 4', 150, 4),
  ('Gelatin', 'Rovema 5', 35, 5),
  ('Pectin', 'Twist 1', 450, 1), ('Pectin', 'Twist 2', 450, 2), ('Pectin', 'Twist 3', 450, 3)
) AS m(line, name, speed, ord)
JOIN public.production_lines l ON l.name = m.line
JOIN public.companies c ON c.id = l.company_id AND c.name = 'Jammy';

-- --------------------------------------- old faults → machine stops
CREATE TABLE public._packing_oee_backfill AS
SELECT e.id, e.line_id, e.stops_line, e.title, pm.id AS machine_id, pm.line_id AS machine_line
FROM public.maintenance_events e
JOIN public.packing_machines pm ON pm.name =
  CASE
    WHEN e.title ~* '^\s*rovema\s*([1-5])\M' THEN 'Rovema ' || substring(e.title FROM '(?i)^\s*rovema\s*([1-5])')
    WHEN e.title ~* '^\s*twist(\s+machine)?(\s+no\.?)?\s*([1-3])\s*$'
      THEN 'Twist ' || substring(e.title FROM '([1-3])\s*$')
  END
JOIN public.production_lines pl ON pl.id = pm.line_id
JOIN public.companies c ON c.id = pl.company_id AND c.name = 'Jammy'
WHERE e.stoppage_id IS NULL;
REVOKE ALL ON public._packing_oee_backfill FROM PUBLIC, anon, authenticated;
ALTER TABLE public._packing_oee_backfill ENABLE ROW LEVEL SECURITY;

UPDATE public.maintenance_events e
   SET machine_id = b.machine_id, line_id = b.machine_line, stops_line = false
  FROM public._packing_oee_backfill b
 WHERE b.id = e.id;

ALTER TABLE public.maintenance_events
  ADD CONSTRAINT maintenance_events_machine_stop
  CHECK (machine_id IS NULL OR (stops_line = false AND stoppage_id IS NULL));

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261019120000', 'packing_oee') ON CONFLICT (version) DO NOTHING;
COMMIT;
