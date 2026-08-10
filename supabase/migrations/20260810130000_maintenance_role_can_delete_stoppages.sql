-- Extend stoppage deletion from Admin-only to Admin + Maintenance, matching
-- the "maintenance.delete" permission in src/lib/permissions.ts and the
-- identical extension already made for maintenance_events in
-- 20260809130000_maintenance_role_can_delete_events.sql. Needed for the new
-- Stoppages management view (src/routes/maintenance.tsx), which lets
-- Admin/Maintenance delete orphaned (zero-event) stoppages.
--
-- The FK from maintenance_events.stoppage_id has no ON DELETE clause
-- (default NO ACTION), so Postgres itself still blocks deleting a stoppage
-- that still has member events regardless of who's asking — the UI's
-- "orphaned only" restriction is belt-and-suspenders, not the only thing
-- enforcing it.
DROP POLICY IF EXISTS "admin delete stoppages" ON public.maintenance_stoppages;

CREATE POLICY "Admin/Maintenance can delete stoppages" ON public.maintenance_stoppages
  FOR DELETE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'maintenance')
  );
