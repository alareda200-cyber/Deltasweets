-- App-wide settings, starting with one field: the date from which maintenance
-- records are complete.
--
-- Why this has to exist. MTBF is the mean gap between consecutive failure
-- start times, and it is only meaningful over an OBSERVATION WINDOW — a
-- period in which every failure that happened was actually recorded. This
-- database does not have one by default: two real faults were logged in
-- January 2025, then nothing until the shift reports began on 18 Aug 2026.
--
-- The 594-day silence in between is not reliability. It is a period with no
-- recording. But MTBF cannot tell the difference: it read that silence as one
-- enormous gap between failures and reported Gelatin mechanical MTBF as
-- 14 hours when the recorded data says roughly 25 minutes — a ~30x error
-- produced entirely by one gap.
--
-- Nor does it heal with time. The gap is a constant added to the numerator
-- forever:  MTBF = (real span + 594 days) / gap count. It is diluted as
-- events accumulate, never removed; at the current recording rate the figure
-- is still ~40% high three years from now.
--
-- So the window is declared, not inferred — the same rule non_production_days
-- follows (20260828200000): absence of data is not data, and anything the
-- maths cannot deduce is stated by a human instead.
--
-- SCOPE — this date affects RELIABILITY MATHS ONLY (MTBF/MTTR and their
-- per-line/per-type counts). It must never hide an event. The two January
-- 2025 faults are real, still open, and waiting on the manufacturer's review;
-- they stay visible in the events table, in the open-fault KPI cards and on
-- the Dashboard exactly as before. They simply stop contributing a gap to a
-- statistic that has no basis to include them.
--
-- NULL means "no window declared" — every event counts, i.e. today's
-- behaviour. Seeded with 2026-08-18, the first day of shift-report data.

CREATE TABLE public.app_settings (
  -- One row, enforced by the type system rather than by convention: the only
  -- value this primary key accepts is true, so a second row cannot be
  -- inserted even by mistake.
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  reliability_start_date date,
  updated_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.app_settings.reliability_start_date IS
  'First date on which maintenance recording is complete. MTBF/MTTR ignore events before it. NULL = no window declared, count everything. Never filters what the UI displays.';

INSERT INTO public.app_settings (id, reliability_start_date) VALUES (true, DATE '2026-08-18');

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Access shape copied from non_production_days (20260828200000), which in turn
-- copied maintenance_stoppages: anon gets nothing, every authenticated user
-- reads, admin writes. Narrower than non_production_days on purpose — this is
-- a single plant-wide number that silently reshapes every reliability figure
-- on the site, so it is not a maintenance/production-level edit.
REVOKE ALL ON public.app_settings FROM anon;
GRANT SELECT, UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

CREATE POLICY "authenticated read app settings"
ON public.app_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin update app settings"
ON public.app_settings FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- No INSERT or DELETE policy on purpose: the single row is created here and
-- is only ever updated. Without those policies the table cannot grow a second
-- row or lose its only one.
