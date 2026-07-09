-- 24) User Management (Phase 2) — additive profile fields only.
-- Does not touch the role CHECK constraint, the auth mechanism, or any
-- existing table/policy from Phase 1.
ALTER TABLE public.profiles ADD COLUMN first_name text;
ALTER TABLE public.profiles ADD COLUMN last_name text;
ALTER TABLE public.profiles ADD COLUMN username text UNIQUE;
ALTER TABLE public.profiles ADD COLUMN phone text;
ALTER TABLE public.profiles ADD COLUMN department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'));
ALTER TABLE public.profiles ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN last_login timestamptz;

-- Lets any authenticated user stamp their own last_login on sign-in without
-- loosening the existing "update own profile" RLS policy (which restricts
-- self-updates to keep the same role). SECURITY DEFINER scopes this to
-- exactly one column, for exactly the calling user.
CREATE OR REPLACE FUNCTION public.touch_last_login()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles SET last_login = now() WHERE id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.touch_last_login() TO authenticated;
