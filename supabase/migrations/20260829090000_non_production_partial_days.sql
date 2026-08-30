-- Partial non-production days.
--
-- 20260828200000 made closure a whole-day fact. The first report imported after
-- it broke that assumption immediately: 27/8 ran its night shift (00:00-08:00,
-- nine faults, 165 minutes) and only then went on holiday. Marking the whole
-- day closed would have deleted a shift that actually happened; leaving it open
-- would have kept counting the holiday. Neither is the truth.
--
-- So closure gets a time window. Both columns NULL means the whole day, which
-- is what every row written before this migration meant — they stay correct
-- with no backfill.
--
--   closed_from NULL, closed_to NULL   -> all day          (the common case)
--   closed_from 08:00, closed_to NULL  -> 08:00 to midnight (the 27/8 case)
--   closed_from NULL, closed_to 06:00  -> midnight to 06:00
--   closed_from 08:00, closed_to 20:00 -> that window only
--
-- Times are LOCAL wall-clock, matching how shifts are written on the paper
-- report and how `day` is already interpreted. They are deliberately `time`
-- and not `timestamptz`: a closure that crosses midnight is two rows, one per
-- day. That keeps the day-keyed unique indexes from 20260828200000 working and
-- keeps the calendar readable as "what happened on this date", which is how
-- the shift reports themselves are organised.
--
-- NOTE: applied by hand in the Supabase SQL Editor (the CLI is not available
-- in this environment). This file exists so the schema stays reproducible.

ALTER TABLE public.non_production_days
  ADD COLUMN closed_from time,
  ADD COLUMN closed_to   time;

-- A window that ends before it starts is not a window. Equal is also rejected:
-- a zero-length closure closes nothing and is always a data-entry slip.
ALTER TABLE public.non_production_days
  ADD CONSTRAINT non_production_days_window_ordered
  CHECK (closed_from IS NULL OR closed_to IS NULL OR closed_from < closed_to);

COMMENT ON COLUMN public.non_production_days.closed_from IS
  'Local time the closure starts. NULL = start of day.';
COMMENT ON COLUMN public.non_production_days.closed_to IS
  'Local time the closure ends. NULL = end of day. Cross-midnight = two rows.';
