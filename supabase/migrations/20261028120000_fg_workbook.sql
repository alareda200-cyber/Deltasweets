BEGIN;
-- FG workbook on Plan adherence (approved mockup "Plan adherence upgrade v2",
-- 28 Oct 2026). The planning team's workbook (JammyFG) is uploaded on the page:
--   Entry          → packed_skus, now with local/export, client, country, note
--   Items          → sku_forecasts (one month per column)
--   B2B & Export   → sku_orders (new): B2B and export orders, in cartons
-- How much of an order is packed is worked out on the page from packed_skus,
-- the same way the workbook does it (src/lib/orders.ts).
--
-- The packed-SKU trigger now writes a Full-day entry's packing actual only from
-- 1 Oct 2026, the day packing actual started coming from Plan adherence
-- (src/lib/packed-actual.ts PACKED_FROM). Older months of the workbook can then
-- be uploaded for the monthly view without touching the entries of those days.
--
-- Rollback:
--   DROP TABLE public.sku_orders;
--   ALTER TABLE public.packed_skus DROP COLUMN kind, DROP COLUMN client,
--     DROP COLUMN country, DROP COLUMN note;
--   and restore tg_packed_skus_entry_actual() from 20261019120000_packing_oee.sql.

ALTER TABLE public.packed_skus
  ADD COLUMN kind text NOT NULL DEFAULT 'local' CHECK (kind IN ('local', 'export')),
  ADD COLUMN client text CHECK (client IS NULL OR length(client) <= 200),
  ADD COLUMN country text CHECK (country IS NULL OR length(country) <= 100),
  ADD COLUMN note text CHECK (note IS NULL OR length(note) <= 500);

CREATE OR REPLACE FUNCTION public.tg_packed_skus_entry_actual()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Before 1 Oct 2026 the entries keep the packing actual typed on them.
  IF v_day < DATE '2026-10-01' THEN
    RETURN NULL;
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
$function$;

CREATE TABLE public.sku_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE
    DEFAULT public.my_scope_company(),
  month date NOT NULL CHECK (EXTRACT(day FROM month) = 1),
  -- the row's place in the workbook: earlier rows of the same SKU take the
  -- packed cartons first
  seq int NOT NULL CHECK (seq >= 0),
  sku_id uuid REFERENCES public.skus(id) ON DELETE SET NULL,
  code text NOT NULL CHECK (length(code) <= 40),
  order_code text CHECK (order_code IS NULL OR length(order_code) <= 100),
  qty numeric NOT NULL CHECK (qty >= 0 AND qty <= 10000000),
  client text CHECK (client IS NULL OR length(client) <= 200),
  country text CHECK (country IS NULL OR length(country) <= 100),
  type text CHECK (type IS NULL OR length(type) <= 40),
  pm_date date,
  delay_reason text CHECK (delay_reason IS NULL OR length(delay_reason) <= 500),
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, month, seq)
);
CREATE INDEX sku_orders_sku_idx ON public.sku_orders(sku_id);
CREATE INDEX sku_orders_created_by_idx ON public.sku_orders(created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sku_orders TO authenticated;
GRANT ALL ON public.sku_orders TO service_role;
ALTER TABLE public.sku_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read sku orders" ON public.sku_orders
  FOR SELECT TO authenticated USING ((SELECT public.i_am_active()));
CREATE POLICY "production insert sku orders" ON public.sku_orders
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles
               WHERE profiles.id = (SELECT auth.uid()) AND profiles.role = 'production')));
CREATE POLICY "production update sku orders" ON public.sku_orders
  FOR UPDATE TO authenticated
  USING ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles
               WHERE profiles.id = (SELECT auth.uid()) AND profiles.role = 'production')))
  WITH CHECK ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles
               WHERE profiles.id = (SELECT auth.uid()) AND profiles.role = 'production')));
CREATE POLICY "production delete sku orders" ON public.sku_orders
  FOR DELETE TO authenticated
  USING ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.profiles
               WHERE profiles.id = (SELECT auth.uid()) AND profiles.role = 'production')));
CREATE POLICY company_scope ON public.sku_orders
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id = (SELECT public.my_scope_company()))
  WITH CHECK (company_id = (SELECT public.my_scope_company()));

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261028120000', 'fg_workbook') ON CONFLICT (version) DO NOTHING;
COMMIT;
