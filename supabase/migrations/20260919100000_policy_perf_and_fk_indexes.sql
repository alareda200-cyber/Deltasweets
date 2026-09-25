-- Performance-only migration. No RLS semantics change: every USING/WITH CHECK
-- expression below is byte-identical to its current definition except that
-- each unwrapped `auth.uid()` call becomes `(select auth.uid())`, so Postgres
-- evaluates it once per statement instead of once per row (see
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select).
-- Part 2 adds covering indexes for 15 foreign-key columns that currently
-- force a sequential scan on the referenced side of a join/cascade.
--
-- Nothing here changes who is allowed to do what. The 9 policies on
-- daily_entries / entry_downtimes / entry_area_owners are already wrapped
-- and are intentionally left untouched.
--
-- Rollback: this migration is DROP POLICY + CREATE POLICY (old text, without
-- the `(select ...)` wrap) for the same 54 policies, plus DROP INDEX for the
-- 15 indexes below. There is no separate down-migration file in this repo's
-- convention (plain numbered .sql, forward-only); revert by hand from this
-- file's own "before" text if ever needed.

BEGIN;

-- ============================================================
-- Part 1 — wrap auth.uid() in (select auth.uid()) in 54 policies
-- ============================================================

-- app_settings
DROP POLICY "admin update app settings" ON public.app_settings;
CREATE POLICY "admin update app settings" ON public.app_settings
  FOR UPDATE TO authenticated
  USING (is_admin((select auth.uid())))
  WITH CHECK (is_admin((select auth.uid())));

-- area_owners
DROP POLICY "Admins delete area owners" ON public.area_owners;
CREATE POLICY "Admins delete area owners" ON public.area_owners
  FOR DELETE TO authenticated
  USING (is_admin((select auth.uid())));

DROP POLICY "Admins insert area owners" ON public.area_owners;
CREATE POLICY "Admins insert area owners" ON public.area_owners
  FOR INSERT TO authenticated
  WITH CHECK (is_admin((select auth.uid())));

DROP POLICY "Admins update area owners" ON public.area_owners;
CREATE POLICY "Admins update area owners" ON public.area_owners
  FOR UPDATE TO authenticated
  USING (is_admin((select auth.uid())))
  WITH CHECK (is_admin((select auth.uid())));

-- audit_logs
DROP POLICY "Users can insert their own audit entries" ON public.audit_logs;
CREATE POLICY "Users can insert their own audit entries" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY "Admins can read audit logs" ON public.audit_logs;
CREATE POLICY "Admins can read audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::text))));

-- department_categories
DROP POLICY "Admins delete department categories" ON public.department_categories;
CREATE POLICY "Admins delete department categories" ON public.department_categories
  FOR DELETE TO authenticated
  USING (is_admin((select auth.uid())));

DROP POLICY "Admins insert department categories" ON public.department_categories;
CREATE POLICY "Admins insert department categories" ON public.department_categories
  FOR INSERT TO authenticated
  WITH CHECK (is_admin((select auth.uid())));

DROP POLICY "Admins update department categories" ON public.department_categories;
CREATE POLICY "Admins update department categories" ON public.department_categories
  FOR UPDATE TO authenticated
  USING (is_admin((select auth.uid())))
  WITH CHECK (is_admin((select auth.uid())));

-- departments
DROP POLICY "Admins delete departments" ON public.departments;
CREATE POLICY "Admins delete departments" ON public.departments
  FOR DELETE TO authenticated
  USING (is_admin((select auth.uid())));

DROP POLICY "Admins insert departments" ON public.departments;
CREATE POLICY "Admins insert departments" ON public.departments
  FOR INSERT TO authenticated
  WITH CHECK (is_admin((select auth.uid())));

DROP POLICY "Admins update departments" ON public.departments;
CREATE POLICY "Admins update departments" ON public.departments
  FOR UPDATE TO authenticated
  USING (is_admin((select auth.uid())))
  WITH CHECK (is_admin((select auth.uid())));

-- downtime_reasons
DROP POLICY "Admins delete reasons" ON public.downtime_reasons;
CREATE POLICY "Admins delete reasons" ON public.downtime_reasons
  FOR DELETE TO authenticated
  USING (is_admin((select auth.uid())));

DROP POLICY "Admins insert reasons" ON public.downtime_reasons;
CREATE POLICY "Admins insert reasons" ON public.downtime_reasons
  FOR INSERT TO authenticated
  WITH CHECK (is_admin((select auth.uid())));

DROP POLICY "Admins update reasons" ON public.downtime_reasons;
CREATE POLICY "Admins update reasons" ON public.downtime_reasons
  FOR UPDATE TO authenticated
  USING (is_admin((select auth.uid())))
  WITH CHECK (is_admin((select auth.uid())));

-- downtime_types
DROP POLICY "Admins delete downtime types" ON public.downtime_types;
CREATE POLICY "Admins delete downtime types" ON public.downtime_types
  FOR DELETE TO authenticated
  USING (is_admin((select auth.uid())));

DROP POLICY "Admins insert downtime types" ON public.downtime_types;
CREATE POLICY "Admins insert downtime types" ON public.downtime_types
  FOR INSERT TO authenticated
  WITH CHECK (is_admin((select auth.uid())));

DROP POLICY "Admins update downtime types" ON public.downtime_types;
CREATE POLICY "Admins update downtime types" ON public.downtime_types
  FOR UPDATE TO authenticated
  USING (is_admin((select auth.uid())))
  WITH CHECK (is_admin((select auth.uid())));

-- line_field_definitions
DROP POLICY "Admins delete fields" ON public.line_field_definitions;
CREATE POLICY "Admins delete fields" ON public.line_field_definitions
  FOR DELETE TO authenticated
  USING (is_admin((select auth.uid())));

DROP POLICY "Admins insert fields" ON public.line_field_definitions;
CREATE POLICY "Admins insert fields" ON public.line_field_definitions
  FOR INSERT TO authenticated
  WITH CHECK (is_admin((select auth.uid())));

DROP POLICY "Admins update fields" ON public.line_field_definitions;
CREATE POLICY "Admins update fields" ON public.line_field_definitions
  FOR UPDATE TO authenticated
  USING (is_admin((select auth.uid())))
  WITH CHECK (is_admin((select auth.uid())));

-- maintenance_events
DROP POLICY "Admin/Maintenance can delete maintenance events" ON public.maintenance_events;
CREATE POLICY "Admin/Maintenance can delete maintenance events" ON public.maintenance_events
  FOR DELETE TO authenticated
  USING (is_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'maintenance'::text)))));

DROP POLICY "Production/Maintenance/Admin can create maintenance events" ON public.maintenance_events;
CREATE POLICY "Production/Maintenance/Admin can create maintenance events" ON public.maintenance_events
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = ANY (ARRAY['production'::text, 'maintenance'::text, 'admin'::text])))));

DROP POLICY "Production/Maintenance/Admin can update maintenance events" ON public.maintenance_events;
CREATE POLICY "Production/Maintenance/Admin can update maintenance events" ON public.maintenance_events
  FOR UPDATE TO authenticated
  USING (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = ANY (ARRAY['production'::text, 'maintenance'::text, 'admin'::text])))))
  WITH CHECK (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = ANY (ARRAY['production'::text, 'maintenance'::text, 'admin'::text])))));

-- maintenance_notes
DROP POLICY "Admins can delete maintenance notes" ON public.maintenance_notes;
CREATE POLICY "Admins can delete maintenance notes" ON public.maintenance_notes
  FOR DELETE TO authenticated
  USING (is_admin((select auth.uid())));

DROP POLICY "Production/Maintenance/Admin can create maintenance notes" ON public.maintenance_notes;
CREATE POLICY "Production/Maintenance/Admin can create maintenance notes" ON public.maintenance_notes
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = ANY (ARRAY['production'::text, 'maintenance'::text, 'admin'::text])))));

-- maintenance_stoppages
DROP POLICY "admin delete stoppages" ON public.maintenance_stoppages;
CREATE POLICY "admin delete stoppages" ON public.maintenance_stoppages
  FOR DELETE TO authenticated
  USING (is_admin((select auth.uid())));

DROP POLICY "maintenance write stoppages" ON public.maintenance_stoppages;
CREATE POLICY "maintenance write stoppages" ON public.maintenance_stoppages
  FOR INSERT TO authenticated
  WITH CHECK (is_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['maintenance'::text, 'production'::text]))))));

DROP POLICY "maintenance update stoppages" ON public.maintenance_stoppages;
CREATE POLICY "maintenance update stoppages" ON public.maintenance_stoppages
  FOR UPDATE TO authenticated
  USING (is_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['maintenance'::text, 'production'::text]))))));

-- non_production_days
DROP POLICY "admin delete non production days" ON public.non_production_days;
CREATE POLICY "admin delete non production days" ON public.non_production_days
  FOR DELETE TO authenticated
  USING (is_admin((select auth.uid())));

DROP POLICY "maintenance write non production days" ON public.non_production_days;
CREATE POLICY "maintenance write non production days" ON public.non_production_days
  FOR INSERT TO authenticated
  WITH CHECK (is_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['maintenance'::text, 'production'::text]))))));

DROP POLICY "maintenance update non production days" ON public.non_production_days;
CREATE POLICY "maintenance update non production days" ON public.non_production_days
  FOR UPDATE TO authenticated
  USING (is_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['maintenance'::text, 'production'::text]))))));

-- production_areas
DROP POLICY "Admins delete production areas" ON public.production_areas;
CREATE POLICY "Admins delete production areas" ON public.production_areas
  FOR DELETE TO authenticated
  USING (is_admin((select auth.uid())));

DROP POLICY "Admins insert production areas" ON public.production_areas;
CREATE POLICY "Admins insert production areas" ON public.production_areas
  FOR INSERT TO authenticated
  WITH CHECK (is_admin((select auth.uid())));

DROP POLICY "Admins update production areas" ON public.production_areas;
CREATE POLICY "Admins update production areas" ON public.production_areas
  FOR UPDATE TO authenticated
  USING (is_admin((select auth.uid())))
  WITH CHECK (is_admin((select auth.uid())));

-- production_lines
DROP POLICY "Admins delete lines" ON public.production_lines;
CREATE POLICY "Admins delete lines" ON public.production_lines
  FOR DELETE TO authenticated
  USING (is_admin((select auth.uid())));

DROP POLICY "Admins insert lines" ON public.production_lines;
CREATE POLICY "Admins insert lines" ON public.production_lines
  FOR INSERT TO authenticated
  WITH CHECK (is_admin((select auth.uid())));

DROP POLICY "Admins update lines" ON public.production_lines;
CREATE POLICY "Admins update lines" ON public.production_lines
  FOR UPDATE TO authenticated
  USING (is_admin((select auth.uid())))
  WITH CHECK (is_admin((select auth.uid())));

-- profiles
DROP POLICY "Admins can read all profiles" ON public.profiles;
CREATE POLICY "Admins can read all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (is_admin((select auth.uid())));

DROP POLICY "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = id);

DROP POLICY "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Admins can update all profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (is_admin((select auth.uid())));

DROP POLICY "Users can update own display name" ON public.profiles;
CREATE POLICY "Users can update own display name" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK (((select auth.uid()) = id) AND (role = ( SELECT p.role
   FROM profiles p
  WHERE (p.id = (select auth.uid())))));

-- push_subscriptions
DROP POLICY "Users can delete their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can delete their own push subscriptions" ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY "Users can insert their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can insert their own push subscriptions" ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY "Users can read their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can read their own push subscriptions" ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

-- root_causes
DROP POLICY "admin delete root causes" ON public.root_causes;
CREATE POLICY "admin delete root causes" ON public.root_causes
  FOR DELETE TO authenticated
  USING (is_admin((select auth.uid())));

DROP POLICY "maintenance write root causes" ON public.root_causes;
CREATE POLICY "maintenance write root causes" ON public.root_causes
  FOR INSERT TO authenticated
  WITH CHECK (is_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['maintenance'::text, 'production'::text]))))));

DROP POLICY "maintenance update root causes" ON public.root_causes;
CREATE POLICY "maintenance update root causes" ON public.root_causes
  FOR UPDATE TO authenticated
  USING (is_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['maintenance'::text, 'production'::text]))))))
  WITH CHECK (is_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['maintenance'::text, 'production'::text]))))));

-- severity_levels
DROP POLICY "Admins delete severity levels" ON public.severity_levels;
CREATE POLICY "Admins delete severity levels" ON public.severity_levels
  FOR DELETE TO authenticated
  USING (is_admin((select auth.uid())));

DROP POLICY "Admins insert severity levels" ON public.severity_levels;
CREATE POLICY "Admins insert severity levels" ON public.severity_levels
  FOR INSERT TO authenticated
  WITH CHECK (is_admin((select auth.uid())));

DROP POLICY "Admins update severity levels" ON public.severity_levels;
CREATE POLICY "Admins update severity levels" ON public.severity_levels
  FOR UPDATE TO authenticated
  USING (is_admin((select auth.uid())))
  WITH CHECK (is_admin((select auth.uid())));

-- technicians
DROP POLICY "admin delete technicians" ON public.technicians;
CREATE POLICY "admin delete technicians" ON public.technicians
  FOR DELETE TO authenticated
  USING (is_admin((select auth.uid())));

DROP POLICY "admin maintenance insert technicians" ON public.technicians;
CREATE POLICY "admin maintenance insert technicians" ON public.technicians
  FOR INSERT TO authenticated
  WITH CHECK (is_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'maintenance'::text)))));

DROP POLICY "admin maintenance update technicians" ON public.technicians;
CREATE POLICY "admin maintenance update technicians" ON public.technicians
  FOR UPDATE TO authenticated
  USING (is_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'maintenance'::text)))));

-- ============================================================
-- Part 2 — cover 15 unindexed foreign keys
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_app_settings_updated_by ON public.app_settings (updated_by);
CREATE INDEX IF NOT EXISTS idx_area_owners_department_id ON public.area_owners (department_id);
CREATE INDEX IF NOT EXISTS idx_departments_department_category_id ON public.departments (department_category_id);
CREATE INDEX IF NOT EXISTS idx_downtime_reasons_department_id ON public.downtime_reasons (department_id);
CREATE INDEX IF NOT EXISTS idx_downtime_reasons_downtime_type_id ON public.downtime_reasons (downtime_type_id);
CREATE INDEX IF NOT EXISTS idx_downtime_reasons_line_id ON public.downtime_reasons (line_id);
CREATE INDEX IF NOT EXISTS idx_downtime_reasons_production_area_id ON public.downtime_reasons (production_area_id);
CREATE INDEX IF NOT EXISTS idx_downtime_reasons_severity_id ON public.downtime_reasons (severity_id);
CREATE INDEX IF NOT EXISTS idx_entry_area_owners_owner_id ON public.entry_area_owners (owner_id);
CREATE INDEX IF NOT EXISTS idx_entry_area_owners_production_area_id ON public.entry_area_owners (production_area_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_notes_created_by ON public.maintenance_notes (created_by);
CREATE INDEX IF NOT EXISTS idx_maintenance_stoppages_created_by ON public.maintenance_stoppages (created_by);
CREATE INDEX IF NOT EXISTS idx_maintenance_stoppages_line_id ON public.maintenance_stoppages (line_id);
CREATE INDEX IF NOT EXISTS idx_non_production_days_created_by ON public.non_production_days (created_by);
CREATE INDEX IF NOT EXISTS idx_profiles_department_id ON public.profiles (department_id);

-- ============================================================
-- Self-assert — abort (and roll back everything above) if either
-- target condition isn't actually met. Nothing commits on failure.
-- ============================================================

DO $$
DECLARE
  unwrapped_count integer;
  missing_index_count integer;
BEGIN
  -- Same counting method as the diagnostic query this migration was
  -- planned from: count auth.uid() calls not preceded by a SELECT wrapper.
  WITH p AS (
    SELECT tablename, policyname, cmd,
           coalesce(qual,'') || ' ~~ ' || coalesce(with_check,'') AS expr
    FROM pg_policies WHERE schemaname = 'public'
  ), m AS (
    SELECT tablename, policyname, cmd,
           (length(expr) - length(replace(expr,'auth.uid()','')))        / 10 AS total_calls,
           (length(expr) - length(replace(expr,'SELECT auth.uid()',''))) / 17 AS wrapped_calls
    FROM p
  )
  SELECT count(*) INTO unwrapped_count
  FROM m WHERE total_calls - wrapped_calls > 0;

  IF unwrapped_count > 0 THEN
    RAISE EXCEPTION 'policy_perf_and_fk_indexes: % polic(y/ies) still have an unwrapped auth.uid() call after this migration ran — aborting, nothing will be committed.', unwrapped_count;
  END IF;

  WITH targets(tbl, col) AS (
    VALUES
      ('app_settings','updated_by'),
      ('area_owners','department_id'),
      ('departments','department_category_id'),
      ('downtime_reasons','department_id'),
      ('downtime_reasons','downtime_type_id'),
      ('downtime_reasons','line_id'),
      ('downtime_reasons','production_area_id'),
      ('downtime_reasons','severity_id'),
      ('entry_area_owners','owner_id'),
      ('entry_area_owners','production_area_id'),
      ('maintenance_notes','created_by'),
      ('maintenance_stoppages','created_by'),
      ('maintenance_stoppages','line_id'),
      ('non_production_days','created_by'),
      ('profiles','department_id')
  )
  SELECT count(*) INTO missing_index_count
  FROM targets t
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = ('public.' || t.tbl)::regclass
      AND a.attname = t.col
  );

  IF missing_index_count > 0 THEN
    RAISE EXCEPTION 'policy_perf_and_fk_indexes: % of the 15 target foreign-key column(s) still lack a covering index — aborting, nothing will be committed.', missing_index_count;
  END IF;
END $$;

COMMIT;
