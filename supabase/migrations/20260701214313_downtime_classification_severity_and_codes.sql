-- 11) Departments (master reference)
CREATE TABLE public.departments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO anon, authenticated;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access departments" ON public.departments FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER tg_departments_updated BEFORE UPDATE ON public.departments
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 12) Downtime Types (master reference: Planned / Unplanned)
CREATE TABLE public.downtime_types (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.downtime_types TO anon, authenticated;
GRANT ALL ON public.downtime_types TO service_role;
ALTER TABLE public.downtime_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access downtime types" ON public.downtime_types FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER tg_downtime_types_updated BEFORE UPDATE ON public.downtime_types
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 13) Severity Levels (master reference: Critical / Major / Minor)
CREATE TABLE public.severity_levels (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.severity_levels TO anon, authenticated;
GRANT ALL ON public.severity_levels TO service_role;
ALTER TABLE public.severity_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access severity levels" ON public.severity_levels FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER tg_severity_levels_updated BEFORE UPDATE ON public.severity_levels
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 14) Business codes on existing master tables — nullable, backward compatible.
-- Existing rows keep NULL; application layer enforces "required" only for new records.
ALTER TABLE public.production_lines ADD COLUMN code text UNIQUE;
ALTER TABLE public.production_areas ADD COLUMN code text UNIQUE;
ALTER TABLE public.area_owners ADD COLUMN code text UNIQUE;
ALTER TABLE public.downtime_reasons ADD COLUMN code text UNIQUE;

-- 15) Downtime classification links on downtime_reasons — nullable, additive.
ALTER TABLE public.downtime_reasons ADD COLUMN department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;
ALTER TABLE public.downtime_reasons ADD COLUMN downtime_type_id uuid REFERENCES public.downtime_types(id) ON DELETE SET NULL;
ALTER TABLE public.downtime_reasons ADD COLUMN severity_id uuid REFERENCES public.severity_levels(id) ON DELETE SET NULL;

-- Seed departments
INSERT INTO public.departments (code, name, display_order) VALUES
  ('PROD', 'Production', 1),
  ('MECH', 'Mechanical Maintenance', 2),
  ('ELEC', 'Electrical Maintenance', 3),
  ('UTIL', 'Utilities', 4),
  ('QLTY', 'Quality', 5),
  ('ENGR', 'Engineering', 6);

-- Seed downtime types
INSERT INTO public.downtime_types (code, name, display_order) VALUES
  ('PLN', 'Planned', 1),
  ('UPL', 'Unplanned', 2);

-- Seed severity levels
INSERT INTO public.severity_levels (code, name, display_order) VALUES
  ('CR', 'Critical', 1),
  ('MJ', 'Major', 2),
  ('MN', 'Minor', 3);
