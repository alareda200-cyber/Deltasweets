-- Extend maintenance-event deletion from Admin-only to Admin + Maintenance,
-- matching the "maintenance.delete" permission added to src/lib/permissions.ts
-- (see 20260803120000_maintenance_management.sql, which originally reserved
-- deletion for Admin only). Notes deletion is left Admin-only — out of scope
-- for this change.
DROP POLICY IF EXISTS "Admins can delete maintenance events" ON public.maintenance_events;

CREATE POLICY "Admin/Maintenance can delete maintenance events" ON public.maintenance_events
  FOR DELETE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'maintenance')
  );
