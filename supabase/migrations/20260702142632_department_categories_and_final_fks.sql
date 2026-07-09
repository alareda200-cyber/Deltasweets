-- 16) Department Categories (master reference)
-- Dashboards filter by CATEGORY (Production / Maintenance / Quality / ...),
-- never by individual Department name, so new Departments (e.g. a future
-- "Automation" or "Instrumentation") automatically appear in the correct
-- dashboard the moment they're tagged with an existing category — zero code
-- changes required.
CREATE TABLE public.department_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.department_categories TO anon, authenticated;
GRANT ALL ON public.department_categories TO service_role;
ALTER TABLE public.department_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access department categories" ON public.department_categories FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER tg_department_categories_updated BEFORE UPDATE ON public.department_categories
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.department_categories (code, name, display_order) VALUES
  ('PROD', 'Production', 1),
  ('MAINT', 'Maintenance', 2),
  ('QLTY', 'Quality', 3),
  ('ENGR', 'Engineering', 4),
  ('UTIL', 'Utilities', 5);

-- 17) Link Departments to Department Categories (nullable, backward compatible)
ALTER TABLE public.departments ADD COLUMN department_category_id uuid REFERENCES public.department_categories(id) ON DELETE SET NULL;

UPDATE public.departments d SET department_category_id = dc.id
FROM public.department_categories dc
WHERE (d.code = 'PROD' AND dc.code = 'PROD')
   OR (d.code IN ('MECH', 'ELEC') AND dc.code = 'MAINT')
   OR (d.code = 'QLTY' AND dc.code = 'QLTY')
   OR (d.code = 'ENGR' AND dc.code = 'ENGR')
   OR (d.code = 'UTIL' AND dc.code = 'UTIL');

-- 18) Area Owner -> Department (closes the free-text gap from the architecture audit)
ALTER TABLE public.area_owners ADD COLUMN department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;
-- Note: area_owners.department (free text) is intentionally NOT dropped or
-- migrated here — it remains readable for backward compatibility. New
-- records should use department_id; the Settings UI stops writing to the
-- text column going forward (see settings.tsx changes).

-- 19) Downtime Reason -> Production Area (closes the free-text `area` gap)
ALTER TABLE public.downtime_reasons ADD COLUMN production_area_id uuid REFERENCES public.production_areas(id) ON DELETE SET NULL;
-- Note: existing reasons whose free-text `area` is "Discharge" or "General"
-- have no equivalent Production Area and are left NULL intentionally — no
-- Production Area rows were invented to force a match. The legacy `area`
-- text column is kept, unchanged, for these and for backward compatibility.
