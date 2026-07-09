-- 22) Profiles + Role-Based Access Control (Phase 1)
-- One row per Supabase Auth user. Role drives all in-app permission checks
-- (src/lib/permissions.ts) — never hardcoded per-user, always looked up here.
CREATE TABLE public.profiles (
  id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'production', 'maintenance', 'quality', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER tg_profiles_updated BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- A user can always read their own profile (needed to resolve their own role).
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

-- A user can update their own display_name only (role changes are admin-only,
-- enforced below by a separate, more privileged policy — a self-row grant
-- broad enough to change one's own role would defeat the whole RBAC system).
CREATE POLICY "Users can update own display name" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()));

-- Admins can read and manage every profile (Manage Users permission).
CREATE POLICY "Admins can read all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE POLICY "Admins can update all profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- New Supabase Auth signups get a profile row automatically, defaulted to
-- the least-privileged role ('viewer'). An admin must explicitly promote a
-- user to a working role afterward via the Users panel in Settings.
CREATE OR REPLACE FUNCTION public.tg_create_profile_for_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data ->> 'display_name', 'viewer')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.tg_create_profile_for_new_user();

-- 23) Tighten existing tables to authenticated-only (Phase 1 baseline).
-- Every table's RLS previously allowed the "anon" role too ("Open access"
-- policies from earlier phases, when there was no login system at all).
-- With a Login page now mandatory for every other page, anonymous access
-- is no longer needed anywhere. Role-level granularity (e.g. Maintenance
-- cannot edit production quantity) is enforced in the application layer
-- per this phase's explicit scope — see src/lib/permissions.ts — not by
-- per-role RLS policies, which would require threading auth through every
-- SSR loader and is out of scope for "do not change any query."
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('profiles')
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;
