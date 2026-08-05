-- 29) Maintenance Management: mechanical/electrical maintenance events + notes.
--
-- Access shape mirrors 20260710120000_fix_open_access_rls_policies.sql:
--  - Any authenticated user (viewer/quality included) may read both tables —
--    needed for the Dashboard maintenance card and read-only roles.
--  - Only Production, Maintenance, and Admin may create/update events or add
--    notes — matches the "maintenance.edit" permission in
--    src/lib/permissions.ts.
--  - Only Admin may delete — there is no edit history/audit trail on these
--    rows yet, so deletion is kept to the most trusted role.
CREATE TABLE public.maintenance_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  line_id uuid REFERENCES public.production_lines(id),
  type text NOT NULL CHECK (type IN ('mechanical', 'electrical')),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  started_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_maintenance_events_line_id ON public.maintenance_events (line_id);
CREATE INDEX idx_maintenance_events_type ON public.maintenance_events (type);
CREATE INDEX idx_maintenance_events_status ON public.maintenance_events (status);
CREATE INDEX idx_maintenance_events_started_at ON public.maintenance_events (started_at DESC);

CREATE TABLE public.maintenance_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.maintenance_events(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_maintenance_notes_event_id ON public.maintenance_notes (event_id);

ALTER TABLE public.maintenance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_notes ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: anon gets zero grants (matches every other
-- operational table since 20260707145601 / 20260710120000).
REVOKE ALL ON public.maintenance_events FROM anon;
REVOKE ALL ON public.maintenance_notes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_notes TO authenticated;
GRANT ALL ON public.maintenance_events TO service_role;
GRANT ALL ON public.maintenance_notes TO service_role;

CREATE POLICY "Authenticated can read maintenance events" ON public.maintenance_events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can read maintenance notes" ON public.maintenance_notes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Production/Maintenance/Admin can create maintenance events" ON public.maintenance_events
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('production', 'maintenance', 'admin')));

CREATE POLICY "Production/Maintenance/Admin can update maintenance events" ON public.maintenance_events
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('production', 'maintenance', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('production', 'maintenance', 'admin')));

CREATE POLICY "Production/Maintenance/Admin can create maintenance notes" ON public.maintenance_notes
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('production', 'maintenance', 'admin')));

CREATE POLICY "Admins can delete maintenance events" ON public.maintenance_events
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete maintenance notes" ON public.maintenance_notes
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
