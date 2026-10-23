BEGIN;
-- What a packing machine counts (Ala, 23 Oct 2026; mockup "Twist Sheet
-- Mockup"). Rovema machines count bags; Twist machines wrap single pieces
-- (7 g each) and their sheet's quantity is pieces. The speed in Settings is
-- in the same unit, so the OEE is unchanged; the unit only names the count.
--
-- Rollback: ALTER TABLE public.packing_machines DROP COLUMN count_unit;

ALTER TABLE public.packing_machines
  ADD COLUMN count_unit text NOT NULL DEFAULT 'bags'
  CHECK (count_unit IN ('bags', 'pieces'));

UPDATE public.packing_machines SET count_unit = 'pieces' WHERE name ILIKE 'twist%';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261023120000', 'machine_count_unit') ON CONFLICT (version) DO NOTHING;
COMMIT;
