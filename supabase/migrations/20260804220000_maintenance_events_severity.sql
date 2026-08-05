-- 31) Free-text severity + technician fields on maintenance_events.
--
-- This documents SQL already applied manually via the Supabase SQL Editor
-- (not run through this migration file) — kept here so the migrations
-- folder stays an accurate record of the live schema. Originally designed
-- as a severity_id FK into severity_levels (matching how
-- downtime_reasons.severity_id works), but the column that actually exists
-- in production is a plain nullable text field instead — no master-data
-- list, no FK, whatever the person logging the event types. `technician`
-- is likewise free text: who actually did the work, which may differ from
-- created_by (whoever was logged in when the event was entered — e.g. a
-- supervisor logging on a technician's behalf).
--
-- No RLS change needed: the existing "Production/Maintenance/Admin can
-- update maintenance events" UPDATE policy already covers every column.
ALTER TABLE public.maintenance_events
  ADD COLUMN severity_label text,
  ADD COLUMN technician text;
