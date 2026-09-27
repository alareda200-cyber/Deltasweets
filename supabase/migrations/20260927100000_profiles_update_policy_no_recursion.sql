-- Every client-side UPDATE on public.profiles failed with
--   42P17 infinite recursion detected in policy for relation "profiles"
-- (live, 27 Sep 2026). The self-update policy's WITH CHECK read the caller's
-- current role with a subquery on profiles itself; Postgres expands RLS for
-- that subquery while already expanding profiles' policies and gives up.
-- Because permissive UPDATE policies are OR'd, the admin path hit it too, so:
--   - an admin changing someone's role on the Users page,
--   - anyone saving My profile,
--   - clearing must_change_password after the forced password change
-- all errored.
--
-- Fix: read the caller's own row through a SECURITY DEFINER helper (like
-- is_admin), which is not expanded under RLS. The rule is unchanged — users
-- may edit their own row but not their own role — and their own status is now
-- held the same way (activating or deactivating an account is an admin action).

CREATE OR REPLACE FUNCTION public.my_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.my_profile_status()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT status FROM public.profiles WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.my_profile_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_profile_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_profile_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_profile_status() TO authenticated;

DROP POLICY IF EXISTS "Users can update own display name" ON public.profiles;
CREATE POLICY "Users can update own display name" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK (
    (select auth.uid()) = id
    AND role = (select public.my_profile_role())
    AND status = (select public.my_profile_status())
  );
