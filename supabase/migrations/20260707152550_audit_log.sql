-- 26) Audit Log
-- Records who did what, when, from where. user_id/user_email/role are
-- captured at write time (never re-derived later), so the log stays
-- accurate even if a user is later renamed, reassigned, or deleted.
CREATE TABLE public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email text,
  role text,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  details jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs (user_id);
CREATE INDEX idx_audit_logs_action ON public.audit_logs (action);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

-- Only admins can read the log — this is exactly the data an admin needs
-- to answer "who did what and when," and exactly the data no other role
-- should see (it can reveal other users' activity).
CREATE POLICY "Admins can read audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- Any authenticated user can write a log row, but ONLY attributed to
-- themselves — user_id must equal auth.uid(), so nobody can forge an entry
-- claiming to be someone else.
CREATE POLICY "Users can insert their own audit entries" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
