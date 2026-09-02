-- Adds 'refrigeration' as a fourth maintenance_events.type alongside
-- 'mechanical'/'electrical'/'preventive' (see 20260803120000_maintenance_management.sql
-- and 20260809140000_maintenance_events_preventive_type.sql).
-- Refrigeration faults are handled by an external contractor, so recording
-- them as mechanical or electrical misattributes both the failure and the
-- repair time. Unlike preventive, refrigeration events are unplanned
-- failures and DO count in MTBF/MTTR (src/lib/queries.ts maintenanceMetricsQuery
-- only excludes 'preventive'; src/routes/maintenance.tsx mtbfCombinedHours/
-- mttrCombinedHours include 'refrigeration' alongside mechanical/electrical).
-- This migration only relaxes the DB-level CHECK constraint to allow the new value.
ALTER TABLE public.maintenance_events
DROP CONSTRAINT IF EXISTS maintenance_events_type_check;

ALTER TABLE public.maintenance_events
ADD CONSTRAINT maintenance_events_type_check
CHECK (type IN ('mechanical', 'electrical', 'preventive', 'refrigeration'));
