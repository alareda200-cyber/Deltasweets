-- Non-production days: the explicit record of when a line was NOT scheduled
-- to run.
--
-- Why this table has to exist at all. A maintenance event's downtime was
-- wall-clock: started_at to resolved_at, or to now() while still open. A fault
-- reported at 04:25 on 27/8 read as 41 hours of lost production by the 28th —
-- the plant was on holiday for most of that and was never scheduled to make
-- anything. Counting closed hours as downtime inflates total downtime, Top
-- Losses and (once the event is resolved) MTTR.
--
-- The obvious shortcut is to infer it: a day with no daily_entries row must be
-- a day with no production. That inference is wrong and dangerously so —
-- it cannot tell "the plant was closed" from "nobody has filled the entry in
-- yet", and today's entry is normally filled at the END of the day. Under that
-- rule every fault reported this morning would silently show zero downtime
-- until someone typed the entry. Absence of data is not data.
--
-- So closure is declared, never guessed. A row here means someone stated that
-- this line did not run on this day.
--
-- Per line, not plant-wide: one line can be down while another runs, so
-- line_id NULL means "every line" and a specific line_id means just that one.
-- Both forms can coexist for the same date (a plant holiday plus a line that
-- was already down) — the lookup treats a day as closed for a line if EITHER
-- matches.
--
-- `reason` is free text on purpose. A public holiday, a planned shutdown and
-- "no orders for this line" all stop production; forcing them into an enum
-- would mean guessing a taxonomy nobody has asked for yet.
--
-- Granularity is a whole day. A day that ran one shift instead of three is NOT
-- representable here and still counts its full window. That is a smaller error
-- than the one this fixes, and narrowing it needs per-day shift times, which
-- vary here and would be new daily data entry.
--
-- NOTE: applied by hand in the Supabase SQL Editor (the CLI is not available
-- in this environment). This file exists so the schema stays reproducible.

CREATE TABLE public.non_production_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = all lines.
  line_id uuid REFERENCES public.production_lines(id) ON DELETE CASCADE,
  day date NOT NULL,
  reason text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A plain UNIQUE (line_id, day) would NOT stop duplicate all-lines rows:
-- Postgres treats every NULL as distinct, so ten "all lines, 27/8" rows would
-- all be accepted. Two partial indexes cover the two shapes properly.
CREATE UNIQUE INDEX non_production_days_all_lines_day_key
  ON public.non_production_days (day) WHERE line_id IS NULL;
CREATE UNIQUE INDEX non_production_days_line_day_key
  ON public.non_production_days (line_id, day) WHERE line_id IS NOT NULL;

CREATE INDEX idx_non_production_days_day ON public.non_production_days (day DESC);

ALTER TABLE public.non_production_days ENABLE ROW LEVEL SECURITY;

-- Access shape copied from maintenance_stoppages
-- (20260810120000_maintenance_stoppages.sql): anon gets nothing, every
-- authenticated user reads, maintenance/production/admin write, admin deletes.
REVOKE ALL ON public.non_production_days FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.non_production_days TO authenticated;
GRANT ALL ON public.non_production_days TO service_role;

CREATE POLICY "authenticated read non production days"
ON public.non_production_days FOR SELECT TO authenticated USING (true);

CREATE POLICY "maintenance write non production days"
ON public.non_production_days FOR INSERT TO authenticated
WITH CHECK (public.is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('maintenance','production')
));

CREATE POLICY "maintenance update non production days"
ON public.non_production_days FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('maintenance','production')
));

CREATE POLICY "admin delete non production days"
ON public.non_production_days FOR DELETE TO authenticated
USING (public.is_admin(auth.uid()));
