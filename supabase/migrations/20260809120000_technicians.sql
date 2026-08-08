-- 30) Technicians: a standalone master-data list of maintenance staff,
-- assignable to maintenance_events via technician_ids (uuid[]) instead of
-- the old free-text `technician` column (kept in place, unused going
-- forward, so historical events already carrying a name aren't touched).
--
-- Access shape mirrors 20260803120000_maintenance_management.sql:
--  - Any authenticated user may read the list (needed for the Maintenance
--    page's assignment multi-select and read-only roles viewing names).
--  - Only Maintenance and Admin may create/update technicians — narrower
--    than maintenance_events itself (which also allows Production) because
--    this is staff-roster data, not an event log entry.
--  - Only Admin may delete, same reasoning as maintenance_events: no
--    edit-history/audit trail on these rows yet.
CREATE TABLE public.technicians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text CHECK (role IN ('Technician', 'Engineer', 'Supervisor', 'Operator')),
  department text CHECK (department IN ('Mechanical', 'Electrical', 'Production')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_technicians_is_active ON public.technicians (is_active);

ALTER TABLE public.maintenance_events
  ADD COLUMN technician_ids uuid[] NOT NULL DEFAULT '{}';

-- Lets "find events assigned to technician X" use an index instead of a
-- sequential scan once the table grows (e.g. a future technician detail
-- view) — GIN is the standard index type for array containment queries.
CREATE INDEX idx_maintenance_events_technician_ids ON public.maintenance_events USING GIN (technician_ids);

ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: anon gets zero grants (matches every other
-- operational table since 20260707145601 / 20260710120000).
REVOKE ALL ON public.technicians FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.technicians TO authenticated;
GRANT ALL ON public.technicians TO service_role;

CREATE POLICY "Authenticated can read technicians" ON public.technicians
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Maintenance/Admin can create technicians" ON public.technicians
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('maintenance', 'admin')));

CREATE POLICY "Maintenance/Admin can update technicians" ON public.technicians
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('maintenance', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('maintenance', 'admin')));

CREATE POLICY "Admins can delete technicians" ON public.technicians
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
