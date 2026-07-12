import { type ReactNode, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { can, type Permission } from "@/lib/permissions";
import { Loader2, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";

export function RequireAuth({ children, requirePermission }: { children: ReactNode; requirePermission?: Permission }) {
  const { session, profile, role, loading, profileLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/login" });
    }
  }, [loading, session, navigate]);

  if (loading || profileLoading) {
    // profileLoading tracks the async profiles-table fetch separately from
    // session loading — without waiting on it too, the permission check below
    // can run once with role still null and render Access denied for a frame
    // before the profile finishes loading.
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    // Redirect effect above will fire; render nothing in the meantime so no
    // protected content is ever painted for an unauthenticated visitor.
    return null;
  }

  if (session && !profile && !profileLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <ShieldAlert className="h-8 w-8 text-destructive" />
        <h1 className="text-lg font-semibold">Access denied</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your account has no profile on record. Contact an administrator if you believe this is a mistake.
        </p>
      </div>
    );
  }

  if (profile?.must_change_password) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Set a new password</CardTitle>
            <CardDescription>Your password was reset by an administrator. You cannot access the app until you set a new one.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm submitLabel="Set Password" onSuccess={() => navigate({ to: "/" })} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (requirePermission && !can(role, requirePermission)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <ShieldAlert className="h-8 w-8 text-destructive" />
        <h1 className="text-lg font-semibold">Access denied</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your role does not have permission to view this page. Contact an administrator if you believe this is a mistake.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
