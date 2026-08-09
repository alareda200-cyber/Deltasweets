-- Adds 'preventive' as a third maintenance_events.type alongside the
-- original 'mechanical'/'electrical' (see 20260803120000_maintenance_management.sql).
-- Preventive events are scheduled maintenance, not unplanned failures — the
-- application layer (src/lib/queries.ts maintenanceMetricsQuery /
-- src/routes/maintenance.tsx localMtbfHours/localMttrHours) excludes them
-- from MTBF/MTTR reliability math accordingly; this migration only relaxes
-- the DB-level CHECK constraint to allow the new value.
ALTER TABLE public.maintenance_events
DROP CONSTRAINT IF EXISTS maintenance_events_type_check;

ALTER TABLE public.maintenance_events
ADD CONSTRAINT maintenance_events_type_check
CHECK (type IN ('mechanical', 'electrical', 'preventive'));
