-- Root causes: WHY a fault happened, as distinct from maintenance_events.title
-- (WHICH component was touched — "Servo 1003", "Gelatin pump seal"). Without
-- this, Top Losses ranks components, not causes: 957 mechanical events on
-- Gelatin in three weeks read as 957 different problems because the part
-- named in the title differs event to event, even when the plant floor
-- believes they share one upstream cause. root_causes lets that cause be
-- recorded once it's actually known, without renaming or merging the titles
-- that already exist.
--
-- A catalogue like departments/downtime_types/severity_levels, not a
-- free-text field — so it can be reported on later without a text-matching
-- exercise, and so a cause can be renamed in one place instead of edited on
-- every event that used it.
--
-- SCOPE — this migration only adds the ability to record a cause. It adds no
-- chart, no percentage, no grouped view, and it assigns no cause to any
-- existing row. See the app_settings column below for why classification is
-- forward-only.
CREATE TABLE public.root_causes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_root_causes_is_active ON public.root_causes (is_active);

CREATE TRIGGER tg_root_causes_updated BEFORE UPDATE ON public.root_causes
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.root_causes ENABLE ROW LEVEL SECURITY;

-- Access shape mirrors technicians (20260809120000): anon gets nothing, any
-- authenticated user reads (needed so Production/Maintenance can classify an
-- event from the create/edit dialogs), only Admin writes — this table is
-- only ever managed from Settings, which already requires "settings.manage"
-- (admin-only, src/lib/permissions.ts). Narrower than technicians' own
-- create/update policy (which also allows the maintenance role) on purpose:
-- unlike technicians, there is no equivalent "maintenance manages this
-- roster" workflow for root causes today.
REVOKE ALL ON public.root_causes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.root_causes TO authenticated;
GRANT ALL ON public.root_causes TO service_role;

CREATE POLICY "Authenticated can read root causes" ON public.root_causes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can create root causes" ON public.root_causes
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update root causes" ON public.root_causes
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete root causes" ON public.root_causes
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- Nullable, additive, ON DELETE SET NULL: deleting a root cause (Settings)
-- must never delete or orphan the event it was assigned to — the event keeps
-- its full history and simply becomes unclassified again, same as a
-- downtime_reason going inactive under entry_downtimes.
ALTER TABLE public.maintenance_events
  ADD COLUMN root_cause_id uuid REFERENCES public.root_causes(id) ON DELETE SET NULL;

CREATE INDEX idx_maintenance_events_root_cause_id ON public.maintenance_events (root_cause_id);

-- Declares the date from which root-cause classification is actually being
-- recorded — the same "state it, don't infer it" rule
-- reliability_start_date already follows on this table (see
-- 20260909100000_app_settings_reliability_start.sql). Every event before
-- this date is unclassified because nobody was filling in a cause yet, not
-- because it had none; any future percentage/breakdown built from root_causes
-- must read as "of events since this date", never as "of all events".
-- NULL = not yet declared.
ALTER TABLE public.app_settings
  ADD COLUMN root_cause_tracking_start_date date;

COMMENT ON COLUMN public.app_settings.root_cause_tracking_start_date IS
  'First date on which root-cause classification is actually being recorded on the shift report. Events before it are unclassified because nobody was recording the cause yet, not because they had none. NULL = not yet declared.';

-- Seed two starter causes so the Settings card and the event Select aren't
-- empty on first load — not a claim that these are the plant's only causes,
-- just a starting catalogue an admin extends from Settings.
INSERT INTO public.root_causes (code, name, description, sort_order) VALUES
  ('WEAR', 'Normal Wear and Tear', 'Expected degradation from use — bearings, belts, seals, or similar wearing out over normal operating life.', 1),
  ('OPERR', 'Operator Error', 'Incorrect operation, setup, or handling caused or worsened the fault.', 2);
