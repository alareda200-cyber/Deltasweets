-- 30) Track who resolved a maintenance event.
--
-- Alongside the existing resolved_at timestamp (20260803120000), this lets
-- the UI show "Resolved by: <name>" without inferring it from audit_logs.
-- No RLS change needed: the existing "Production/Maintenance/Admin can
-- update maintenance events" UPDATE policy already covers every column,
-- including this new one.
ALTER TABLE public.maintenance_events
  ADD COLUMN resolved_by uuid REFERENCES public.profiles(id);
