-- 27) Fix: infinite recursion in profiles RLS policies.
--
-- "Admins can read all profiles" and "Admins can update all profiles" both
-- checked admin status via `EXISTS (SELECT 1 FROM public.profiles p WHERE
-- p.id = auth.uid() AND p.role = 'admin')` — a subquery against the SAME
-- RLS-protected table the policy itself guards. Postgres has to evaluate
-- that table's own RLS policies to run the subquery, which includes this
-- same policy again, causing genuine infinite recursion. Reproduced live:
-- any admin attempting to update another user's role (Users → Edit → Role)
-- fails with "infinite recursion detected in policy for relation profiles".
--
-- Fix: a SECURITY DEFINER helper function. Its internal query runs as the
-- function owner and does not re-trigger RLS on profiles, breaking the
-- recursion cycle. This is the standard, documented fix for this exact
-- Postgres/Supabase pattern.
CREATE OR REPLACE FUNCTION public.is_admin(check_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = check_user_id AND role = 'admin');
$$;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;

CREATE POLICY "Admins can read all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update all profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()));

-- Note: audit_logs' "Admins can read audit logs" policy has a similar-looking
-- EXISTS-subquery-into-profiles shape, but empirically did NOT recurse in
-- testing (Check 8 below) — because that policy guards a *different* table
-- (audit_logs), so evaluating it isn't self-referential the way profiles'
-- own admin policies were. Confirmed by direct testing, not assumed.

