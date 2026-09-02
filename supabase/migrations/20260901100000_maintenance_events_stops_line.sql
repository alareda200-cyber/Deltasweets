-- Does this fault stop the line?
--
-- Until now a maintenance_events row answered two questions with one field:
-- "a fault happened" and "production time was lost". Its duration fed the
-- event count, MTBF and repeat-failure rate AND the downtime total, with no
-- way to separate them.
--
-- Real reports keep producing work that is one but not the other. Room 8 was
-- being installed across three shifts while the line ran; the stalker gate
-- jams on every pallet and the pallets come out by hand and production
-- continues. Those rows had to be DELETED from the imports to stop them
-- inflating downtime — which threw away the fact that the work happened at
-- all, and with it that machine's history.
--
-- stops_line splits the two. Downtime counts only rows where it is true;
-- event counts, MTBF and repeat-failure keep counting every row, because a
-- fault that cost no production time is still a fault that happened.
--
-- DEFAULT true is the existing behaviour: every one of the ~350 rows already
-- in the table was entered under the assumption that its duration was lost
-- production, so they stay correct with no backfill. New rows keep that
-- assumption until someone says otherwise — a fault is presumed to have cost
-- something, and the exception is what gets recorded.
--
-- NOTE: applied by hand in the Supabase SQL Editor (the CLI is not available
-- in this environment). This file exists so the schema stays reproducible.

ALTER TABLE public.maintenance_events
  ADD COLUMN stops_line boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.maintenance_events.stops_line IS
  'False = the fault happened but production kept running. Excluded from downtime totals; still counted in event counts, MTBF and repeat-failure rate.';
