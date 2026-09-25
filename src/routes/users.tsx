import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreVertical,
  Plus,
  Eye,
  KeyRound,
  Ban,
  CheckCircle2,
  Trash2,
  Info,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { ALL_ROLES, ROLE_LABELS, can, type Role } from "@/lib/permissions";
import {
  createUserFn,
  resetPasswordFn,
  setUserStatusFn,
  deleteUserFn,
} from "@/lib/users-actions.server";
import { logAudit } from "@/lib/audit";
import { cn } from "@/lib/utils";
import {
  activeAdminCount,
  dateTimeLabel,
  fullName,
  lastSeenLabel,
  lostAbilities,
  matchesUserSearch,
  roleChangeBlock,
  roleChips,
  roleLabel,
} from "@/lib/users-format";
import { UserList } from "@/components/users/UserList";
import { RoleMatrix } from "@/components/users/RoleMatrix";

// This deployment is Firebase Hosting ONLY (a pure static SPA) — there is
// no server to run the service-role operations below (Create/Reset
// Password/Deactivate-Activate/Delete all live in
// src/lib/users-actions.server.ts). Previously these buttons called those
// functions anyway; the request would silently resolve against Firebase's
// static-file fallback instead of throwing a real error, making the UI
// claim success while nothing actually happened server-side — a genuine
// safety risk for a "Delete User" action specifically. Set this to true
// only once this app is deployed somewhere that actually runs a server
// (e.g. Cloud Run) again. While it is false those controls are not rendered
// at all (a greyed-out button nobody can use is just noise); their code paths
// stay below, behind this flag.
const SERVER_ACTIONS_AVAILABLE = false;

export const Route = createFileRoute("/users")({
  head: () => ({ meta: [{ title: "Users · Production Scorecard" }] }),
  component: () => (
    <RequireAuth requirePermission="users.manage">
      <UsersPage />
    </RequireAuth>
  ),
});

interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  username: string | null;
  phone: string | null;
  department_id: string | null;
  role: string;
  status: string;
  last_login: string | null;
  last_seen_at: string | null;
  avatar_color: string | null;
  created_at: string;
  departments: { name: string } | null;
}

function roleRank(role: string) {
  const i = (ALL_ROLES as string[]).indexOf(role);
  return i === -1 ? ALL_ROLES.length : i;
}

function UsersPage() {
  const qc = useQueryClient();
  const { user: currentUser } = useAuth();
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["all-users"],
    queryFn: async (): Promise<UserRow[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*, departments(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as UserRow[];
    },
  });

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");

  const [createOpen, setCreateOpen] = useState(false);
  const [viewRow, setViewRow] = useState<UserRow | null>(null);
  const [editRow, setEditRow] = useState<UserRow | null>(null);
  const [resetRow, setResetRow] = useState<UserRow | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [statusRow, setStatusRow] = useState<{ row: UserRow; next: "active" | "inactive" } | null>(
    null,
  );
  const [deleteRow, setDeleteRow] = useState<UserRow | null>(null);

  function refetchAll() {
    qc.invalidateQueries({ queryKey: ["all-users"] });
  }

  const chips = useMemo(() => roleChips(users), [users]);
  // A chip whose last member just changed role disappears — fall back to All.
  useEffect(() => {
    if (roleFilter && !chips.some((c) => c.value === roleFilter)) setRoleFilter("");
  }, [chips, roleFilter]);

  // Role order (admins first), then name — the order the role chips read in.
  const filtered = useMemo(
    () =>
      users
        .filter((u) => (!roleFilter || u.role === roleFilter) && matchesUserSearch(u, search))
        .sort(
          (a, b) => roleRank(a.role) - roleRank(b.role) || fullName(a).localeCompare(fullName(b)),
        ),
    [users, search, roleFilter],
  );

  const canSignIn = users.filter((u) => u.status !== "inactive").length;
  const adminCount = activeAdminCount(users);

  return (
    <AppShell>
      <div className="flex flex-col gap-4 md:gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Users</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isLoading
                ? "Loading…"
                : `${canSignIn} ${canSignIn === 1 ? "person" : "people"} can sign in. Change a name, department or role here.`}
            </p>
          </div>
          {SERVER_ACTIONS_AVAILABLE && (
            <Button className="h-11 md:h-9" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Create User
            </Button>
          )}
        </div>

        {!SERVER_ACTIONS_AVAILABLE && (
          <div
            role="note"
            className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm text-foreground"
          >
            <Info className="mt-0.5 h-[18px] w-[18px] shrink-0 text-primary" aria-hidden="true" />
            <p>
              <span className="font-semibold">
                Adding people, resetting passwords and switching accounts off happen in the Supabase
                dashboard for now.
              </span>{" "}
              The site has no server to do them safely.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)] lg:gap-5">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="md:w-[240px] md:shrink-0 2xl:w-[300px]">
                <Label htmlFor="user-search" className="sr-only">
                  Search people
                </Label>
                <Input
                  id="user-search"
                  type="search"
                  placeholder="Search name or department"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-12 text-base md:h-11 md:text-sm"
                />
              </div>
              <div
                role="group"
                aria-label="Role"
                className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0"
              >
                {chips.map((c) => {
                  const active = roleFilter === c.value;
                  return (
                    <button
                      key={c.value || "all"}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setRoleFilter(c.value)}
                      className={cn(
                        "h-11 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        active
                          ? "border-primary bg-primary font-semibold text-primary-foreground"
                          : "border-border bg-card text-foreground hover:bg-muted",
                      )}
                    >
                      {c.label} {c.count}
                    </button>
                  );
                })}
              </div>
            </div>

            <UserList
              users={filtered}
              isLoading={isLoading}
              onEdit={(u) => setEditRow(u as UserRow)}
              renderMore={
                SERVER_ACTIONS_AVAILABLE
                  ? (row) => {
                      const u = row as UserRow;
                      return (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-11 w-11 md:h-10 md:w-10"
                              aria-label={`More actions for ${fullName(u)}`}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setViewRow(u)}>
                              <Eye className="mr-2 h-4 w-4" />
                              View
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setResetRow(u)}>
                              <KeyRound className="mr-2 h-4 w-4" />
                              Reset Password
                            </DropdownMenuItem>
                            {u.status === "active" ? (
                              <DropdownMenuItem
                                onClick={() => setStatusRow({ row: u, next: "inactive" })}
                              >
                                <Ban className="mr-2 h-4 w-4" />
                                Deactivate
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => setStatusRow({ row: u, next: "active" })}
                              >
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                Activate
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              disabled={
                                u.id === currentUser?.id || (u.role === "admin" && adminCount <= 1)
                              }
                              onClick={() => setDeleteRow(u)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      );
                    }
                  : undefined
              }
            />
          </div>

          <RoleMatrix />
        </div>
      </div>

      {SERVER_ACTIONS_AVAILABLE && (
        <CreateUserDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          departments={departments}
          onCreated={refetchAll}
        />
      )}
      <ViewUserDialog row={viewRow} onOpenChange={(o) => !o && setViewRow(null)} />
      <EditUserDialog
        row={editRow}
        users={users}
        currentUserId={currentUser?.id ?? null}
        departments={departments}
        onOpenChange={(o) => !o && setEditRow(null)}
        onSaved={refetchAll}
      />

      {SERVER_ACTIONS_AVAILABLE && (
        <>
          <Dialog
            open={!!resetRow}
            onOpenChange={(o) => {
              if (!o) {
                setResetRow(null);
                setTempPassword(null);
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reset Password</DialogTitle>
                <DialogDescription>
                  {tempPassword
                    ? "Share this temporary password with the user. It will not be shown again."
                    : `Generate a temporary password for ${resetRow ? fullName(resetRow) : ""}? They'll be required to change it on next login.`}
                </DialogDescription>
              </DialogHeader>
              {tempPassword ? (
                <div className="rounded-md border border-border bg-muted p-3 text-center font-mono text-lg tracking-wider">
                  {tempPassword}
                </div>
              ) : (
                <DialogFooter>
                  <Button variant="outline" onClick={() => setResetRow(null)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={async () => {
                      if (!resetRow) return;
                      try {
                        const res = await resetPasswordFn({ data: { userId: resetRow.id } });
                        setTempPassword(res.tempPassword);
                        toast.success("Temporary password generated");
                        void logAudit("user.reset_password", "user", resetRow.id, {
                          email: resetRow.email,
                        });
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Reset failed");
                      }
                    }}
                  >
                    Generate Password
                  </Button>
                </DialogFooter>
              )}
            </DialogContent>
          </Dialog>

          <AlertDialog open={!!statusRow} onOpenChange={(o) => !o && setStatusRow(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {statusRow?.next === "inactive" ? "Deactivate user?" : "Activate user?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {statusRow?.next === "inactive"
                    ? `${statusRow ? fullName(statusRow.row) : ""} will no longer be able to sign in. Their account and data are kept — this does not delete anything.`
                    : `${statusRow ? fullName(statusRow.row) : ""} will be able to sign in again.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    if (!statusRow) return;
                    try {
                      await setUserStatusFn({
                        data: { userId: statusRow.row.id, status: statusRow.next },
                      });
                      toast.success(
                        statusRow.next === "inactive" ? "User deactivated" : "User activated",
                      );
                      void logAudit(
                        statusRow.next === "inactive" ? "user.deactivate" : "user.activate",
                        "user",
                        statusRow.row.id,
                        { email: statusRow.row.email },
                      );
                      refetchAll();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Update failed");
                    } finally {
                      setStatusRow(null);
                    }
                  }}
                >
                  Confirm
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Permanently delete this user?</AlertDialogTitle>
                <AlertDialogDescription>
                  {deleteRow ? fullName(deleteRow) : ""} ({deleteRow?.email}) will be permanently
                  removed and can no longer sign in. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    if (!deleteRow) return;
                    try {
                      await deleteUserFn({ data: { userId: deleteRow.id } });
                      toast.success("User deleted successfully");
                      void logAudit("user.delete", "user", deleteRow.id, {
                        email: deleteRow.email,
                      });
                      refetchAll();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Delete failed");
                    } finally {
                      setDeleteRow(null);
                    }
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </AppShell>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  departments,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  departments: { id: string; name: string }[];
  onCreated: () => void;
}) {
  const uid = useId();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setFirstName("");
    setLastName("");
    setUsername("");
    setEmail("");
    setPhone("");
    setDepartmentId("");
    setRole("viewer");
    setStatus("active");
    setPassword("");
    setConfirm("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !username.trim() || !email.trim() || !password) {
      return toast.error("Please fill in all required fields.");
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast.error("Invalid email address.");
    if (
      password.length < 8 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/[0-9]/.test(password)
    ) {
      return toast.error(
        "Password must be at least 8 characters and include uppercase, lowercase, and a number.",
      );
    }
    if (password !== confirm) return toast.error("Passwords do not match.");
    setSubmitting(true);
    try {
      const created = await createUserFn({
        data: {
          email: email.trim(),
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          username: username.trim(),
          phone: phone.trim() || null,
          departmentId: departmentId || null,
          role,
          status,
        },
      });
      toast.success("User created successfully");
      void logAudit("user.create", "user", created.id, { email: email.trim(), role });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create User</DialogTitle>
          <DialogDescription>
            New users can sign in immediately with the password set below.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`${uid}-first`}>First Name</Label>
              <Input
                id={`${uid}-first`}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor={`${uid}-last`}>Last Name</Label>
              <Input
                id={`${uid}-last`}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`${uid}-username`}>Username</Label>
              <Input
                id={`${uid}-username`}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor={`${uid}-phone`}>Phone (optional)</Label>
              <Input id={`${uid}-phone`} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor={`${uid}-email`}>Email</Label>
            <Input
              id={`${uid}-email`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`${uid}-dept`}>Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger id={`${uid}-dept`}>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={`${uid}-role`}>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger id={`${uid}-role`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor={`${uid}-status`}>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as "active" | "inactive")}>
              <SelectTrigger id={`${uid}-status`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`${uid}-password`}>Password</Label>
              <Input
                id={`${uid}-password`}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor={`${uid}-confirm`}>Confirm Password</Label>
              <Input
                id={`${uid}-confirm`}
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create User"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ViewUserDialog({
  row,
  onOpenChange,
}: {
  row: UserRow | null;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row ? fullName(row) : ""}</DialogTitle>
          <DialogDescription>{row?.email}</DialogDescription>
        </DialogHeader>
        {row && <AccountFacts row={row} />}
      </DialogContent>
    </Dialog>
  );
}

// Read-only facts about an account. Shown inside Edit too, so "View" is never
// lost when the row menu isn't rendered.
function AccountFacts({ row }: { row: UserRow }) {
  const fmt = (v: string | null) => (v ? dateTimeLabel(v) : "Never");
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
      <div>
        <dt className="text-xs text-muted-foreground">Username</dt>
        <dd>{row.username || "—"}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Account</dt>
        <dd>{row.status === "inactive" ? "Switched off" : "Can sign in"}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Last seen</dt>
        <dd>{lastSeenLabel(row) ?? "No sign-in on record"}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Last sign-in</dt>
        <dd>{fmt(row.last_login)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Created</dt>
        <dd>{fmt(row.created_at)}</dd>
      </div>
    </dl>
  );
}

function EditUserDialog({
  row,
  users,
  currentUserId,
  departments,
  onOpenChange,
  onSaved,
}: {
  row: UserRow | null;
  users: UserRow[];
  currentUserId: string | null;
  departments: { id: string; name: string }[];
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const { refreshProfile } = useAuth();
  const uid = useId();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (row) {
      setFirstName(row.first_name ?? "");
      setLastName(row.last_name ?? "");
      setPhone(row.phone ?? "");
      setDepartmentId(row.department_id ?? "");
      setRole(row.role as Role);
      setStatus(row.status as "active" | "inactive");
      setConfirmOpen(false);
    }
  }, [row]);

  const roleChanged = !!row && role !== row.role;
  const isSelf = !!row && row.id === currentUserId;
  const block = row ? roleChangeBlock(row, role, users) : null;

  async function save() {
    if (!row || block) return;
    setSubmitting(true);
    // Plain metadata edits (name/phone/department/role) go through RLS's
    // existing "admin can update all profiles" policy directly — no
    // service-role call needed. Status changes to inactive still need to go
    // through setUserStatusFn separately for the real auth-level ban;
    // editing here only updates the visible status label consistently by
    // reusing that same server function when status actually changed.
    try {
      if (SERVER_ACTIONS_AVAILABLE && status !== row.status) {
        const { setUserStatusFn } = await import("@/lib/users-actions.server");
        await setUserStatusFn({ data: { userId: row.id, status } });
      }
      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          display_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
          phone: phone.trim() || null,
          department_id: departmentId || null,
          role,
        })
        .eq("id", row.id);
      if (error) throw error;
      toast.success("User updated");
      void logAudit("user.edit", "user", row.id, { email: row.email });
      if (role !== row.role) {
        void logAudit("user.change_role", "user", row.id, {
          email: row.email,
          from: row.role,
          to: role,
        });
      }
      if (isSelf) void refreshProfile();
      setConfirmOpen(false);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!row || block) return;
    // Any role change is confirmed first; the rest saves straight away.
    if (roleChanged) setConfirmOpen(true);
    else void save();
  }

  const name = row ? fullName(row) : "";
  const lost = row && roleChanged ? lostAbilities(row.role, role) : [];
  const losesThisPage = isSelf && roleChanged && !can(role, "users.manage");

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {name}</DialogTitle>
          <DialogDescription>{row?.email} · the email can't be changed here.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-first`}>First name</Label>
              <Input
                id={`${uid}-first`}
                className="h-11 md:h-9"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-last`}>Last name</Label>
              <Input
                id={`${uid}-last`}
                className="h-11 md:h-9"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-phone`}>Phone</Label>
            <Input
              id={`${uid}-phone`}
              className="h-11 md:h-9"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-dept`}>Department</Label>
              <Select
                value={departmentId || "__none__"}
                onValueChange={(v) => setDepartmentId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger id={`${uid}-dept`} className="h-11 md:h-9">
                  <SelectValue placeholder="No department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No department</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-role`}>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger
                  id={`${uid}-role`}
                  className="h-11 md:h-9"
                  aria-describedby={block ? `${uid}-role-block` : undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {block && (
            <p
              id={`${uid}-role-block`}
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-strong"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {block}
            </p>
          )}
          {SERVER_ACTIONS_AVAILABLE && (
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-status`}>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as "active" | "inactive")}>
                <SelectTrigger id={`${uid}-status`} className="h-11 md:h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {row && (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <AccountFacts row={row} />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="h-11 md:h-9" disabled={submitting || !!block}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>

        <AlertDialog open={confirmOpen} onOpenChange={(o) => !submitting && setConfirmOpen(o)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {isSelf ? "Change your own role?" : `Change ${name}'s role?`}
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    {isSelf ? "You" : name} will become{" "}
                    <span className="font-semibold text-foreground">{roleLabel(role)}</span>
                    {row ? ` (now ${roleLabel(row.role)})` : ""}.
                  </p>
                  {lost.length > 0 && (
                    <p>
                      {isSelf ? "You" : "They"} will no longer be able to: {lost.join(", ")}.
                    </p>
                  )}
                  {losesThisPage && (
                    <p className="font-semibold text-destructive-strong">
                      You will lose access to this page as soon as you save.
                    </p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={submitting}
                onClick={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                {submitting ? "Saving…" : `Make ${isSelf ? "me" : "them"} ${roleLabel(role)}`}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
