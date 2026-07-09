
-- 1) Production lines
CREATE TABLE public.production_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  color text NOT NULL DEFAULT '#0ea5e9',
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_lines TO anon, authenticated;
GRANT ALL ON public.production_lines TO service_role;
ALTER TABLE public.production_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access lines" ON public.production_lines FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 2) Per-line dynamic field definitions
CREATE TABLE public.line_field_definitions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  line_id uuid NOT NULL REFERENCES public.production_lines(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  label text NOT NULL,
  section text NOT NULL DEFAULT 'extra', -- making | packing | downtime | rework | extra
  unit text NOT NULL DEFAULT 'kg',
  default_value numeric DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (line_id, field_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.line_field_definitions TO anon, authenticated;
GRANT ALL ON public.line_field_definitions TO service_role;
ALTER TABLE public.line_field_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access fields" ON public.line_field_definitions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 3) Daily entries
CREATE TABLE public.daily_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  line_id uuid NOT NULL REFERENCES public.production_lines(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  shift text NOT NULL DEFAULT 'A',
  supervisor text,
  operator text,
  comments text,
  -- standard metrics (so charts and aggregates are fast)
  making_plan numeric NOT NULL DEFAULT 0,
  making_actual numeric NOT NULL DEFAULT 0,
  packing_plan numeric NOT NULL DEFAULT 0,
  packing_actual numeric NOT NULL DEFAULT 0,
  available_min numeric NOT NULL DEFAULT 1440,
  downtime_min numeric NOT NULL DEFAULT 0,
  rework_cooking numeric NOT NULL DEFAULT 0,
  rework_making numeric NOT NULL DEFAULT 0,
  rework_packing numeric NOT NULL DEFAULT 0,
  -- flexible additional fields per line
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (line_id, entry_date, shift)
);
CREATE INDEX idx_daily_entries_line_date ON public.daily_entries (line_id, entry_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_entries TO anon, authenticated;
GRANT ALL ON public.daily_entries TO service_role;
ALTER TABLE public.daily_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access entries" ON public.daily_entries FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 4) Downtime reasons library
CREATE TABLE public.downtime_reasons (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  line_id uuid REFERENCES public.production_lines(id) ON DELETE CASCADE,
  name text NOT NULL,
  area text NOT NULL DEFAULT 'General',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.downtime_reasons TO anon, authenticated;
GRANT ALL ON public.downtime_reasons TO service_role;
ALTER TABLE public.downtime_reasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access reasons" ON public.downtime_reasons FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 5) Entry downtimes (each entry can have many reasons)
CREATE TABLE public.entry_downtimes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES public.daily_entries(id) ON DELETE CASCADE,
  reason_id uuid REFERENCES public.downtime_reasons(id) ON DELETE SET NULL,
  reason_name text NOT NULL, -- denormalized for history
  area text NOT NULL DEFAULT 'General',
  minutes numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_entry_downtimes_entry ON public.entry_downtimes (entry_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entry_downtimes TO anon, authenticated;
GRANT ALL ON public.entry_downtimes TO service_role;
ALTER TABLE public.entry_downtimes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access entry downtimes" ON public.entry_downtimes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER tg_daily_entries_updated BEFORE UPDATE ON public.daily_entries
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Seed default lines
INSERT INTO public.production_lines (name, color, sort_order) VALUES
  ('Gelatin', '#0ea5e9', 1),
  ('Pectin',  '#10b981', 2);

-- Seed common downtime reasons
INSERT INTO public.downtime_reasons (name, area) VALUES
  ('Mogul starch tray jam', 'Depositing'),
  ('Cooker batch delay (Brix out of spec)', 'Cooking'),
  ('Changeover - flavor / mold change', 'Depositing'),
  ('Conditioning room delay', 'Discharge'),
  ('Preventive maintenance', 'Depositing'),
  ('Servo fault', 'Depositing'),
  ('Platte Belt', 'Depositing'),
  ('Change over roll / cleaning', 'Packing'),
  ('Label sensor', 'Packing'),
  ('Tunnel Cooling inefficiency', 'Cooling Tunnel');
