import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Role } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  phone: string | null;
  department_id: string | null;
  role: Role;
  status: string;
  must_change_password: boolean;
  last_login: string | null;
  avatar_color: string;
  created_at: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: Role | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string) {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (!error && data) {
      setProfile({
        id: data.id, email: data.email, display_name: data.display_name,
        first_name: data.first_name, last_name: data.last_name, username: data.username,
        phone: data.phone, department_id: data.department_id,
        role: data.role as Role, status: data.status,
        must_change_password: data.must_change_password, last_login: data.last_login,
        avatar_color: data.avatar_color, created_at: data.created_at,
      });
    } else {
      setProfile(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    // Session restore on load/refresh — Supabase's own persisted storage
    // (localStorage, configured in client.ts) already survives a reload;
    // this just brings it into React state.
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      if (data.session?.user) await loadProfile(data.session.user.id);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (cancelled) return;
      setSession(newSession);
      if (newSession?.user) {
        await loadProfile(newSession.user.id);
        if (event === "SIGNED_IN") {
          // Defense in depth: Supabase Auth's ban is the real login block for
          // inactive users, but if a profile's status field ever diverges
          // from that (e.g. manual DB edit), don't let a stale "inactive"
          // session stay signed in silently.
          const { data: fresh } = await supabase.from("profiles").select("status").eq("id", newSession.user.id).maybeSingle();
          if (fresh?.status === "inactive") {
            await supabase.auth.signOut();
            setSession(null);
            setProfile(null);
            setLoading(false);
            return;
          }
          void supabase.rpc("touch_last_login");
          void logAudit("login", "auth", newSession.user.id);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? error.message : null };
  }

  async function signOut() {
    if (session?.user) {
      await logAudit("logout", "auth", session.user.id);
    }
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    profile,
    role: profile?.role ?? null,
    loading,
    signIn,
    signOut,
    refreshProfile: async () => { if (session?.user) await loadProfile(session.user.id); },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
