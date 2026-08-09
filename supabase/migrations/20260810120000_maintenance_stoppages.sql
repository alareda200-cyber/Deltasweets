-- Maintenance Stoppages: groups several maintenance_events rows (e.g. a
-- line down for several concurrent reasons) into a single downtime window,
-- referenced from maintenance_events.stoppage_id.
--
-- status/resolved_at are never written directly by the UI — they're derived
-- from member events by src/lib/queries.ts's syncStoppageAggregate
-- (resolved, with resolved_at = the latest member's resolved_at, only when
-- every member is resolved; in_progress if any member has started work;
-- open otherwise) and kept current in application code, same as this app's
-- other derived-state tables (no DB trigger).
--
-- Access shape matches maintenance_events (20260803120000_maintenance_management.sql,
-- 20260809130000_maintenance_role_can_delete_events.sql):
--  - Any authenticated user may read (needed for the Dashboard downtime
--    Pareto chart, which folds stoppage-grouped events in — see
--    maintenanceEventsAsDowntimes).
--  - Only Production, Maintenance, and Admin may create/update — matches
--    "maintenance.edit" in src/lib/permissions.ts.
--  - Only Admin may delete — there's no stoppage-deletion UI yet.
CREATE TABLE public.maintenance_stoppages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid REFERENCES public.production_lines(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  status text DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_maintenance_stoppages_line_id ON public.maintenance_stoppages (line_id);
CREATE INDEX idx_maintenance_stoppages_status ON public.maintenance_stoppages (status);
CREATE INDEX idx_maintenance_stoppages_started_at ON public.maintenance_stoppages (started_at DESC);

ALTER TABLE public.maintenance_events
ADD COLUMN IF NOT EXISTS stoppage_id uuid REFERENCES public.maintenance_stoppages(id);

CREATE INDEX idx_maintenance_events_stoppage_id ON public.maintenance_events (stoppage_id);

-- RLS
ALTER TABLE public.maintenance_stoppages ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: anon gets zero grants (matches every other
-- operational table since 20260707145601 / 20260710120000).
REVOKE ALL ON public.maintenance_stoppages FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_stoppages TO authenticated;
GRANT ALL ON public.maintenance_stoppages TO service_role;

CREATE POLICY "authenticated read stoppages"
ON public.maintenance_stoppages FOR SELECT TO authenticated USING (true);

CREATE POLICY "maintenance write stoppages"
ON public.maintenance_stoppages FOR INSERT TO authenticated
WITH CHECK (public.is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('maintenance','production')
));

CREATE POLICY "maintenance update stoppages"
ON public.maintenance_stoppages FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('maintenance','production')
));

CREATE POLICY "admin delete stoppages"
ON public.maintenance_stoppages FOR DELETE TO authenticated
USING (public.is_admin(auth.uid()));
