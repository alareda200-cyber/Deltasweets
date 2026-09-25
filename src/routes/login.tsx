import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { shouldSuppressRedirect } from "@/lib/nav-loop-guard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AuthBrandPanel, PasswordInput } from "@/components/AppShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign In · Production Scorecard" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { session, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);

  useEffect(() => {
    if (!loading && session && !shouldSuppressRedirect("/")) navigate({ to: "/" });
  }, [loading, session, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await signIn(email.trim(), password);
    setSubmitting(false);
    if (signInError) {
      setError(signInError);
      return;
    }
    navigate({ to: "/" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground md:grid md:grid-cols-2">
      <AuthBrandPanel />
      <main className="px-6 py-7 md:flex md:items-center md:justify-center md:p-16">
        <form
          onSubmit={handleSubmit}
          className="flex w-full flex-col gap-[18px] md:w-[400px]"
          aria-labelledby="signin-title"
        >
          <div>
            <h1 id="signin-title" className="text-2xl font-bold md:text-3xl">
              Sign in
            </h1>
            <p className="mt-1.5 hidden text-[15px] text-muted-foreground md:block">
              Use the email your admin set up for you.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email" className="text-sm font-semibold">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="name@company.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-[52px] rounded-xl px-3.5 text-[17px] md:h-12 md:rounded-[10px] md:text-base"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-sm font-semibold">
                Password
              </Label>
              <button
                type="button"
                onClick={() => setForgotOpen(true)}
                className="hidden min-h-11 rounded-md px-1 text-sm font-semibold text-primary hover:underline md:block"
              >
                Forgot password?
              </button>
            </div>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
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
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
          <button
            type="button"
            onClick={() => setForgotOpen(true)}
            className="h-12 rounded-xl border border-border bg-card text-[15px] font-semibold text-primary transition-colors hover:bg-muted md:hidden"
          >
            Forgot password?
          </button>
          <p className="text-center text-sm text-muted-foreground md:text-left">
            No account? Ask an admin.
          </p>
        </form>
      </main>
      <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} />
    </div>
  );
}

function ForgotPasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("If an account exists for that email, a reset link has been sent.");
    onOpenChange(false);
    setEmail("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset your password</DialogTitle>
          <DialogDescription>Enter your account email and we'll send you a link to set a new password.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="forgot-email">Email</Label>
            <Input
              id="forgot-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 md:h-9"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-11 md:h-9"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="h-11 md:h-9">
              {submitting ? "Sending…" : "Send Reset Link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
