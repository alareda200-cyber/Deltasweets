BEGIN;
-- Roles (Ala, 19 Oct 2026):
--   admin, production, quality — unchanged.
--   maintenance — sees the Maintenance page only and can't change anything:
--     no faults, stoppages, notes, technicians, root causes or days off, and
--     no downtime / entry edits. (Only admin and production log faults now.)
--   viewer — Dashboard and Plan adherence only (app side; reads unchanged).
--   super_viewer (new) — Dashboard, Plan adherence and Maintenance, read-only.
-- Reads stay as they are (any active user in the company); this migration only
-- takes 'maintenance' out of every write policy and allows the new role name.
--
-- Rollback: put 'maintenance' back in the same policies (the expressions this
-- file replaces are in 20260929100000_security_hardening.sql and earlier), and
--   ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check,
--     ADD CONSTRAINT profiles_role_check CHECK (role = ANY (ARRAY['admin','production','maintenance','quality','viewer']));
-- (after moving any super_viewer profile to another role).

-- ------------------------------------------------------------ role name
ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'production'::text, 'maintenance'::text,
                           'quality'::text, 'viewer'::text, 'super_viewer'::text]));

-- ------------------------------------------------------------ daily entries
ALTER POLICY "production update entries" ON public.daily_entries
  USING ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid())) OR EXISTS (
    SELECT 1 FROM public.profiles WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['production'::text, 'quality'::text]))))
  WITH CHECK ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid())) OR EXISTS (
    SELECT 1 FROM public.profiles WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['production'::text, 'quality'::text]))));

-- ------------------------------------------------------------ entry downtime
ALTER POLICY "downtime write" ON public.entry_downtimes
  WITH CHECK ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid())) OR EXISTS (
    SELECT 1 FROM public.profiles WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'production'::text)));
ALTER POLICY "downtime update" ON public.entry_downtimes
  USING ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid())) OR EXISTS (
    SELECT 1 FROM public.profiles WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'production'::text)))
  WITH CHECK ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid())) OR EXISTS (
    SELECT 1 FROM public.profiles WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'production'::text)));
ALTER POLICY "downtime delete" ON public.entry_downtimes
  USING ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid())) OR EXISTS (
    SELECT 1 FROM public.profiles WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'production'::text)));

-- ------------------------------------------------------------ faults
ALTER POLICY "Production/Maintenance/Admin can create maintenance events" ON public.maintenance_events
  WITH CHECK ((SELECT public.i_am_active()) AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid())
      AND p.role = ANY (ARRAY['production'::text, 'admin'::text])));
ALTER POLICY "Production/Maintenance/Admin can update maintenance events" ON public.maintenance_events
  USING ((SELECT public.i_am_active()) AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid())
      AND p.role = ANY (ARRAY['production'::text, 'admin'::text])))
  WITH CHECK ((SELECT public.i_am_active()) AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid())
      AND p.role = ANY (ARRAY['production'::text, 'admin'::text])));
ALTER POLICY "Admin/Maintenance can delete maintenance events" ON public.maintenance_events
  USING ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));

ALTER POLICY "Production/Maintenance/Admin can create maintenance notes" ON public.maintenance_notes
  WITH CHECK ((SELECT public.i_am_active()) AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid())
      AND p.role = ANY (ARRAY['production'::text, 'admin'::text])));

-- ------------------------------------------------------------ stoppages
ALTER POLICY "maintenance write stoppages" ON public.maintenance_stoppages
  WITH CHECK ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid())) OR EXISTS (
    SELECT 1 FROM public.profiles WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'production'::text)));
ALTER POLICY "maintenance update stoppages" ON public.maintenance_stoppages
  USING ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid())) OR EXISTS (
    SELECT 1 FROM public.profiles WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'production'::text)));
ALTER POLICY "Admin/Maintenance can delete stoppages" ON public.maintenance_stoppages
  USING ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));

-- ------------------------------------------------------------ lists
ALTER POLICY "maintenance write non production days" ON public.non_production_days
  WITH CHECK ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid())) OR EXISTS (
    SELECT 1 FROM public.profiles WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'production'::text)));
ALTER POLICY "maintenance update non production days" ON public.non_production_days
  USING ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid())) OR EXISTS (
    SELECT 1 FROM public.profiles WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'production'::text)));

ALTER POLICY "maintenance write root causes" ON public.root_causes
  WITH CHECK ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid())) OR EXISTS (
    SELECT 1 FROM public.profiles WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'production'::text)));
ALTER POLICY "maintenance update root causes" ON public.root_causes
  USING ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid())) OR EXISTS (
    SELECT 1 FROM public.profiles WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'production'::text)))
  WITH CHECK ((SELECT public.i_am_active()) AND (public.is_admin((SELECT auth.uid())) OR EXISTS (
    SELECT 1 FROM public.profiles WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'production'::text)));

ALTER POLICY "admin maintenance insert technicians" ON public.technicians
  WITH CHECK ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));
ALTER POLICY "admin maintenance update technicians" ON public.technicians
  USING ((SELECT public.i_am_active()) AND public.is_admin((SELECT auth.uid())));

-- Nothing that writes may still name the maintenance role.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND cmd <> 'SELECT'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%''maintenance''%';
  IF n > 0 THEN RAISE EXCEPTION '% write policies still allow the maintenance role', n; END IF;
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261019130000', 'roles') ON CONFLICT (version) DO NOTHING;
COMMIT;
