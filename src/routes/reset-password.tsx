import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { AuthBrandPanel, PasswordInput } from "@/components/AppShell";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset Password · Production Scorecard" }] }),
  component: ResetPasswordPage,
});

function validateComplexity(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password must include a lowercase letter.";
  if (!/[0-9]/.test(password)) return "Password must include a number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Password must include a special character.";
  return null;
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // The recovery link lands here with Supabase firing a PASSWORD_RECOVERY
    // event once it parses the token from the URL and establishes a
    // temporary recovery session. If that never fires and there's also no
    // session at all, the link was invalid or expired.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    const timeout = setTimeout(() => {
      setInvalid((prev) => (ready ? prev : true));
    }, 4000);
    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const complexityError = validateComplexity(password);
    if (complexityError) return setError(complexityError);
    if (password !== confirm) return setError("Passwords do not match.");
    setSubmitting(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    navigate({ to: "/" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground md:grid md:grid-cols-2">
      <AuthBrandPanel />
      <main className="px-6 py-7 md:flex md:items-center md:justify-center md:p-16">
        <div className="flex w-full flex-col gap-[18px] md:w-[400px]">
          <div>
            <h1 className="text-2xl font-bold md:text-3xl">Set a new password</h1>
            <p className="mt-1.5 text-[15px] text-muted-foreground">
              Choose a new password for your account.
            </p>
          </div>
          {invalid && !ready ? (
            <div className="flex flex-col gap-3">
              <p role="alert" className="text-sm text-destructive">
                This reset link is invalid or has expired. Request a new one from the sign-in page.
              </p>
              <Link
                to="/login"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-border bg-card text-[15px] font-semibold text-primary transition-colors hover:bg-muted"
              >
                Back to sign in
              </Link>
            </div>
          ) : !ready ? (
            <div className="flex justify-center py-6">
              <Loader2
                className="h-5 w-5 animate-spin text-muted-foreground"
                aria-label="Checking reset link"
              />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-password" className="text-sm font-semibold">
                  New password
                </Label>
                <PasswordInput
                  id="new-password"
                  autoComplete="new-password"
                  value={password}
                  onChange={setPassword}
                />
                <p className="text-xs text-muted-foreground">
                  At least 8 characters, with uppercase, lowercase, a number, and a special
                  character.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirm-password" className="text-sm font-semibold">
                  Confirm password
                </Label>
                <PasswordInput
                  id="confirm-password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={setConfirm}
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="h-[52px] rounded-xl text-[17px] font-semibold md:h-12 md:text-base"
                disabled={submitting}
              >
                {submitting ? "Updating…" : "Set Password"}
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
