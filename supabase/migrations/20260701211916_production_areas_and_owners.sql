-- 8) Production Areas (master reference)
CREATE TABLE public.production_areas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_areas TO anon, authenticated;
GRANT ALL ON public.production_areas TO service_role;
ALTER TABLE public.production_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access production areas" ON public.production_areas FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 9) Area Owners (master reference)
CREATE TABLE public.area_owners (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  employee_id text,
  department text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.area_owners TO anon, authenticated;
GRANT ALL ON public.area_owners TO service_role;
ALTER TABLE public.area_owners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access area owners" ON public.area_owners FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 10) Entry Area Owners (per-entry, per-production-area mapping — mirrors entry_downtimes)
CREATE TABLE public.entry_area_owners (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES public.daily_entries(id) ON DELETE CASCADE,
  production_area_id uuid NOT NULL REFERENCES public.production_areas(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES public.area_owners(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, production_area_id)
);
CREATE INDEX idx_entry_area_owners_entry ON public.entry_area_owners (entry_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entry_area_owners TO anon, authenticated;
GRANT ALL ON public.entry_area_owners TO service_role;
ALTER TABLE public.entry_area_owners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access entry area owners" ON public.entry_area_owners FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Seed the three initial areas as data, not schema — freely renamable/extendable via Settings
INSERT INTO public.production_areas (name, display_order) VALUES
  ('Cooking', 1),
  ('Making', 2),
  ('Packing', 3);
