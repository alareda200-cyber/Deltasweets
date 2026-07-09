-- 25) Phase 2.5 — one additive column for the editable avatar in My Profile.
-- No role, auth, or user-management logic touched.
ALTER TABLE public.profiles ADD COLUMN avatar_color text NOT NULL DEFAULT '#0ea5e9';
