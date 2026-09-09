-- Root causes: the answer to "what is actually costing us this time?"
--
-- WHY THIS EXISTS. A maintenance event records the COMPONENT that was touched
-- (`Servo 1003`) and never the reason it needed touching. So Top Losses ranks
-- `Servo 1003` first — true, and useless, because nobody repairs a servo as a
-- decision. On the Gelatin line that is 957 mechanical events in three weeks,
-- one every ~30 minutes, and per the maintenance lead roughly 95% of them
-- trace to a single unresolved depositor-nozzle problem. The database cannot
-- express that, so the most expensive fact in the plant lives only in one
-- person's head and has to be re-argued from memory every time.
--
-- A CATALOGUE, NOT A LINK TO ANOTHER EVENT. The obvious shortcut is to point
-- each symptom at the open nozzle ticket. That breaks the day the ticket is
-- closed and re-opened as a new row, and it cannot express a cause that is not
-- itself a fault (material variation, ambient humidity, an operator practice).
-- A cause is a taxonomy, so it gets a table — the same shape departments,
-- downtime_types, severity_levels and fault_titles already use here.
--
-- ⚠️ THIS COLUMN MUST NEVER BE BACK-FILLED BY ASSUMPTION.
-- Writing "depositor nozzle blockage" onto the existing 957 servo rows with an
-- UPDATE would make the report say 95% — because we typed 95%, not because
-- anything was measured. That number is going to the equipment manufacturer;
-- the first question will be how it was obtained, and "we assumed it" ends the
-- conversation. Classification is FORWARD-ONLY from
-- app_settings.root_cause_tracking_start_date. Events before it stay NULL, and
-- every figure derived from this column states the date it starts at — the
-- same rule reliability_start_date follows (20260909100000).
--
-- WHERE THE DATA COMES FROM. Not the UI: a technician logging a two-minute
-- servo stop will not open a dropdown, and a field that is tedious stays
-- empty. Faults here arrive by importing the shift report, so the cause is a
-- new COLUMN IN THAT SHEET, written on paper with the rest of the row, and
-- mapped by the import script (see claude/sql-import-playbook.md). The
-- dropdown in the app covers hand-entered events, which are the exception.

CREATE TABLE public.root_causes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text,
  -- Free text on purpose: a cause needs room to say what the evidence is,
  -- and forcing that into an enum would mean inventing a taxonomy nobody has
  -- asked for. Same reasoning as non_production_days.reason.
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness. A plain UNIQUE(name) would happily accept
-- "Nozzle blockage" beside "nozzle blockage", and the count that the whole
-- feature exists to produce would silently split in two.
CREATE UNIQUE INDEX root_causes_name_key ON public.root_causes (lower(name));
CREATE UNIQUE INDEX root_causes_code_key ON public.root_causes (lower(code)) WHERE code IS NOT NULL;

ALTER TABLE public.maintenance_events
  ADD COLUMN root_cause_id uuid REFERENCES public.root_causes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.maintenance_events.root_cause_id IS
  'Why this fault happened, as opposed to title = which component was touched. NULL = unclassified, which is also every event before app_settings.root_cause_tracking_start_date. Never back-fill this by assumption.';

-- Grouping by cause is the only query this column has, and it runs over the
-- whole events table.
CREATE INDEX idx_maintenance_events_root_cause ON public.maintenance_events (root_cause_id)
  WHERE root_cause_id IS NOT NULL;

-- The measurement window, alongside the reliability one it is modelled on.
ALTER TABLE public.app_settings
  ADD COLUMN root_cause_tracking_start_date date;

COMMENT ON COLUMN public.app_settings.root_cause_tracking_start_date IS
  'First date on which root causes were recorded on the shift report. Any percentage derived from root_cause_id must state this date. NULL = not started.';

-- Seeded from the two conditions already logged as open faults, so the first
-- shift report has something to point at. Names match those events; rename or
-- extend from Settings rather than adding rows here.
INSERT INTO public.root_causes (name, code, description, sort_order) VALUES
  ('Depositor nozzle blockage', 'NOZBLK', 'Blocked nozzles on the depositor. Line keeps running; suspected upstream cause of most servo stops. Open with the equipment manufacturer since 1 Jan 2025.', 1),
  ('Nozzle template leakage',   'NOZLEK', 'Leakage at the nozzle template. Line keeps running. Open with the equipment manufacturer since 1 Jan 2025.', 2);

ALTER TABLE public.root_causes ENABLE ROW LEVEL SECURITY;

-- Access shape copied from non_production_days (20260828200000): anon gets
-- nothing, every authenticated user reads, maintenance/production/admin write,
-- admin deletes.
REVOKE ALL ON public.root_causes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.root_causes TO authenticated;
GRANT ALL ON public.root_causes TO service_role;

CREATE POLICY "authenticated read root causes"
ON public.root_causes FOR SELECT TO authenticated USING (true);

CREATE POLICY "maintenance write root causes"
ON public.root_causes FOR INSERT TO authenticated
WITH CHECK (public.is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('maintenance','production')
));

CREATE POLICY "maintenance update root causes"
ON public.root_causes FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('maintenance','production')
))
WITH CHECK (public.is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('maintenance','production')
));

CREATE POLICY "admin delete root causes"
ON public.root_causes FOR DELETE TO authenticated
USING (public.is_admin(auth.uid()));
