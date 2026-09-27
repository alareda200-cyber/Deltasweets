-- Making counted in a unit besides kilograms (pallets, pcs, …), per line.
--
-- production_lines.making_count_unit: the unit a line counts its making in,
--   written the way it should read ("pallets", "pcs"). NULL = kilograms only;
--   the Entry form and the Dashboard show nothing extra for that line.
-- daily_entries.making_plan_count / making_actual_count: that day's (shift's)
--   plan and actual in the line's unit. Optional: NULL = not counted, which the
--   Dashboard shows as "—", never as 0%.
ALTER TABLE public.production_lines
  ADD COLUMN IF NOT EXISTS making_count_unit text
    CHECK (making_count_unit IS NULL OR length(btrim(making_count_unit)) BETWEEN 1 AND 30);

ALTER TABLE public.daily_entries
  ADD COLUMN IF NOT EXISTS making_plan_count numeric CHECK (making_plan_count IS NULL OR making_plan_count >= 0),
  ADD COLUMN IF NOT EXISTS making_actual_count numeric CHECK (making_actual_count IS NULL OR making_actual_count >= 0);

COMMENT ON COLUMN public.production_lines.making_count_unit IS 'Unit the line also counts making in (e.g. pallets, pcs). NULL = kg only.';
COMMENT ON COLUMN public.daily_entries.making_plan_count IS 'Making plan in the line''s making_count_unit. NULL = not counted.';
COMMENT ON COLUMN public.daily_entries.making_actual_count IS 'Making actual in the line''s making_count_unit. NULL = not counted.';

-- Its own adherence target (Settings › Targets), separate from the kilogram
-- target. NULL = no target: the count shows neutral, never amber or red.
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS target_making_count_pct numeric NULL
    CHECK (target_making_count_pct IS NULL OR (target_making_count_pct > 0 AND target_making_count_pct <= 100));

-- Rollback:
--   ALTER TABLE public.app_settings DROP COLUMN IF EXISTS target_making_count_pct;
--   ALTER TABLE public.daily_entries DROP COLUMN IF EXISTS making_plan_count, DROP COLUMN IF EXISTS making_actual_count;
--   ALTER TABLE public.production_lines DROP COLUMN IF EXISTS making_count_unit;
