-- 20) Area Owner Performance Score
-- Lives on entry_area_owners because it describes the relationship between
-- one Entry, one Production Area, and one Owner — not a fact about the
-- entry alone (daily_entries is intentionally not touched) and not a fact
-- about the owner alone (area_owners is intentionally not touched).
ALTER TABLE public.entry_area_owners
  ADD COLUMN performance_score numeric;

ALTER TABLE public.entry_area_owners
  ADD CONSTRAINT entry_area_owners_performance_score_range
  CHECK (performance_score IS NULL OR (performance_score >= 0 AND performance_score <= 100));

-- Nullable: existing rows (and any owner assignment left blank going
-- forward) remain valid with no score, per "Default: Empty".
