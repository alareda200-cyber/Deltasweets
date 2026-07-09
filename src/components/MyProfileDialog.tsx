import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const AVATAR_COLORS = ["#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f59e0b", "#10b981", "#14b8a6"];

export function MyProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { profile, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [avatarColor, setAvatarColor] = useState("#0ea5e9");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (profile && open) {
      setFirstName(profile.first_name ?? "");
      setLastName(profile.last_name ?? "");
      setPhone(profile.phone ?? "");
      setDepartmentId(profile.department_id ?? "");
      setAvatarColor(profile.avatar_color);
    }
  }, [profile, open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSubmitting(true);
    const { error } = await supabase.from("profiles").update({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      display_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
      phone: phone.trim() || null,
      department_id: departmentId || null,
      avatar_color: avatarColor,
    }).eq("id", profile.id);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refreshProfile();
    qc.invalidateQueries({ queryKey: ["all-users"] }); // keep the admin Users list in sync if it's open
    toast.success("Profile updated");
    onOpenChange(false);
  }

  const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toLocaleUpperCase() || profile?.email?.[0]?.toUpperCase() || "?";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>My Profile</DialogTitle>
          <DialogDescription>Update your personal details.</DialogDescription>
        </DialogHeader>
        {profile && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12" style={{ backgroundColor: avatarColor }}>
                <AvatarFallback style={{ backgroundColor: avatarColor, color: "white" }}>{initials}</AvatarFallback>
              </Avatar>
              <div className="flex flex-wrap gap-1.5">
                {AVATAR_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setAvatarColor(c)}
                    className="h-5 w-5 rounded-full ring-offset-2"
                    style={{ backgroundColor: c, outline: avatarColor === c ? "2px solid currentColor" : "none" }}
                    aria-label={`Choose avatar color ${c}`}
                  />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><Label>First Name</Label><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required /></div>
              <div><Label>Last Name</Label><Input value={lastName} onChange={(e) => setLastName(e.target.value)} required /></div>
            </div>
            <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div>
              <Label>Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Email</p><p className="truncate">{profile.email}</p></div>
              <div><p className="text-xs text-muted-foreground">Username</p><p>{profile.username || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Role</p><p>{ROLE_LABELS[profile.role as Role] ?? profile.role}</p></div>
              <div><p className="text-xs text-muted-foreground">Created</p><p>{new Date(profile.created_at).toLocaleDateString()}</p></div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : "Save Changes"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
