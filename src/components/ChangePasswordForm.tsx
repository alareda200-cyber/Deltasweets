import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

function validateComplexity(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password must include a lowercase letter.";
  if (!/[0-9]/.test(password)) return "Password must include a number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Password must include a special character.";
  return null;
}

export function ChangePasswordForm({ onSuccess, submitLabel = "Update Password" }: { onSuccess: () => void; submitLabel?: string }) {
  const { user, refreshProfile } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!currentPassword) return setError("Enter your current password.");
    const complexityError = validateComplexity(newPassword);
    if (complexityError) return setError(complexityError);
    if (newPassword !== confirm) return setError("New password and confirmation do not match.");
    if (!user?.email) return setError("Could not determine your account email.");

    setSubmitting(true);
    // Re-verify the current password is actually correct before allowing a
    // change — Supabase's updateUser() doesn't require this on its own
    // since it trusts the existing session, so this re-authentication step
    // is what makes "Current Password" a real check rather than a label.
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (verifyErr) {
      setSubmitting(false);
      return setError("Current password is incorrect.");
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
    if (updateErr) {
      setSubmitting(false);
      return setError(updateErr.message);
    }

    await supabase.from("profiles").update({ must_change_password: false }).eq("id", user.id);
    await refreshProfile();
    setSubmitting(false);
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="current-password">Current Password</Label>
        <Input id="current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-password">New Password</Label>
        <Input id="new-password" type="password" autoComplete="new-password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <p className="text-xs text-muted-foreground">At least 8 characters, with uppercase, lowercase, a number, and a special character.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">Confirm Password</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Updating…" : submitLabel}</Button>
    </form>
  );
}
