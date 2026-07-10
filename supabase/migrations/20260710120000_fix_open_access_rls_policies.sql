-- 28) Critical fix: replace "Open access" RLS policies with role-aware ones.
--
-- Every table below carried a policy of the shape
--   FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)
-- left over from before login was mandatory. Migration 20260707145601
-- revoked anon's grants at the SQL level, but the permissive
-- `authenticated` policies were never replaced — so any logged-in user,
-- regardless of role, could read/write/delete every row in every table
-- directly via the Supabase REST/JS client, bypassing
-- src/lib/permissions.ts entirely (a UI-only check for these tables).
--
-- Two access shapes:
--  A) Day-to-day operational data (daily_entries, entry_downtimes,
--     entry_area_owners): any authenticated user may read and write.
--  B) Reference/master data managed only via Settings (production_lines,
--     production_areas, area_owners, downtime_reasons, departments,
--     department_categories, downtime_types, severity_levels,
--     line_field_definitions): any authenticated user may read (needed to
--     populate dropdowns/labels across the app), but only admins may
--     write — matching Settings being gated behind "settings.manage", an
--     admin-only permission (src/lib/permissions.ts). Uses the existing
--     public.is_admin() SECURITY DEFINER helper (see
--     20260707195553_fix_profiles_rls_recursion.sql).

-- Belt-and-suspenders: anon should already have zero grants on these
-- tables (20260707145601), re-asserted here so this migration is correct
-- on its own even if re-applied to a fresh database.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'daily_entries', 'entry_downtimes', 'entry_area_owners',
      'production_lines', 'production_areas', 'area_owners',
      'downtime_reasons', 'departments', 'department_categories',
      'downtime_types', 'severity_levels', 'line_field_definitions'
    ])
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

-- Group A: operational data — authenticated can read and write freely.

DROP POLICY IF EXISTS "Open access entries" ON public.daily_entries;
CREATE POLICY "Authenticated read entries" ON public.daily_entries
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert entries" ON public.daily_entries
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update entries" ON public.daily_entries
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete entries" ON public.daily_entries
  FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Open access entry downtimes" ON public.entry_downtimes;
CREATE POLICY "Authenticated read entry downtimes" ON public.entry_downtimes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert entry downtimes" ON public.entry_downtimes
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update entry downtimes" ON public.entry_downtimes
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete entry downtimes" ON public.entry_downtimes
  FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Open access entry area owners" ON public.entry_area_owners;
CREATE POLICY "Authenticated read entry area owners" ON public.entry_area_owners
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert entry area owners" ON public.entry_area_owners
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update entry area owners" ON public.entry_area_owners
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete entry area owners" ON public.entry_area_owners
  FOR DELETE TO authenticated USING (true);

-- Group B: reference/master data — authenticated read, admin-only write.

DROP POLICY IF EXISTS "Open access lines" ON public.production_lines;
CREATE POLICY "Authenticated read lines" ON public.production_lines
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert lines" ON public.production_lines
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins update lines" ON public.production_lines
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete lines" ON public.production_lines
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Open access production areas" ON public.production_areas;
CREATE POLICY "Authenticated read production areas" ON public.production_areas
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert production areas" ON public.production_areas
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins update production areas" ON public.production_areas
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete production areas" ON public.production_areas
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Open access area owners" ON public.area_owners;
CREATE POLICY "Authenticated read area owners" ON public.area_owners
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert area owners" ON public.area_owners
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins update area owners" ON public.area_owners
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete area owners" ON public.area_owners
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Open access reasons" ON public.downtime_reasons;
CREATE POLICY "Authenticated read reasons" ON public.downtime_reasons
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert reasons" ON public.downtime_reasons
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins update reasons" ON public.downtime_reasons
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete reasons" ON public.downtime_reasons
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Open access departments" ON public.departments;
CREATE POLICY "Authenticated read departments" ON public.departments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert departments" ON public.departments
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins update departments" ON public.departments
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete departments" ON public.departments
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Open access department categories" ON public.department_categories;
CREATE POLICY "Authenticated read department categories" ON public.department_categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert department categories" ON public.department_categories
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins update department categories" ON public.department_categories
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete department categories" ON public.department_categories
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Open access downtime types" ON public.downtime_types;
CREATE POLICY "Authenticated read downtime types" ON public.downtime_types
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert downtime types" ON public.downtime_types
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins update downtime types" ON public.downtime_types
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete downtime types" ON public.downtime_types
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Open access severity levels" ON public.severity_levels;
CREATE POLICY "Authenticated read severity levels" ON public.severity_levels
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert severity levels" ON public.severity_levels
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins update severity levels" ON public.severity_levels
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete severity levels" ON public.severity_levels
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Open access fields" ON public.line_field_definitions;
CREATE POLICY "Authenticated read fields" ON public.line_field_definitions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert fields" ON public.line_field_definitions
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins update fields" ON public.line_field_definitions
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete fields" ON public.line_field_definitions
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
