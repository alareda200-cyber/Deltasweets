import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { TableSkeletonRows } from "@/components/TableSkeletonRows";
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
  Pencil,
  KeyRound,
  Ban,
  CheckCircle2,
  Trash2,
  Inbox,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { ALL_ROLES, ROLE_LABELS, type Role } from "@/lib/permissions";
import {
  createUserFn,
  resetPasswordFn,
  setUserStatusFn,
  deleteUserFn,
} from "@/lib/users-actions.server";
import { logAudit } from "@/lib/audit";

// This deployment is Firebase Hosting ONLY (a pure static SPA) — there is
// no server to run the service-role operations below (Create/Reset
// Password/Deactivate-Activate/Delete all live in
// src/lib/users-actions.server.ts). Previously these buttons called those
// functions anyway; the request would silently resolve against Firebase's
// static-file fallback instead of throwing a real error, making the UI
// claim success while nothing actually happened server-side — a genuine
// safety risk for a "Delete User" action specifically. Set this to true
// only once this app is deployed somewhere that actually runs a server
// (e.g. Cloud Run) again.
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
  created_at: string;
  departments: { name: string } | null;
}

const PAGE_SIZE = 10;

function initials(row: UserRow) {
  const n =
    `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || row.display_name || row.email;
  return n
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
function fullName(row: UserRow) {
  return `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || row.display_name || "—";
}
function roleColorClass(role: string) {
  switch (role) {
    case "admin":
      return "text-accent";
    case "maintenance":
      return "text-warning";
    case "production":
      return "text-success";
    default:
      return "text-muted-foreground"; // viewer, quality
  }
}

// Presence bands. Deliberately coarse: last_seen_at is only written on
// navigation, throttled to once per 10 minutes, so anything finer than
// these bands would imply a precision the data does not have.
function presenceOf(lastSeenAt: string | null): { dot: string; label: string; tone: string } {
  if (!lastSeenAt) return { dot: "bg-muted-foreground/40", label: "Never seen", tone: "text-muted-foreground" };
  const mins = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 60000);
  if (mins < 5) return { dot: "bg-success", label: "Online now", tone: "text-success" };
  if (mins < 60) return { dot: "bg-warning", label: `${mins}m ago`, tone: "text-muted-foreground" };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { dot: "bg-muted-foreground", label: `${hours}h ago`, tone: "text-muted-foreground" };
  return { dot: "bg-muted-foreground/40", label: new Date(lastSeenAt).toLocaleDateString(), tone: "text-muted-foreground" };
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
  const [deptFilter, setDeptFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sortKey, setSortKey] = useState<"name" | "created_at" | "last_login" | "role">(
    "created_at",
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

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

  const filtered = useMemo(() => {
    let list = users.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (deptFilter && u.department_id !== deptFilter) return false;
      if (statusFilter && u.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [fullName(u), u.username, u.email, u.departments?.name, u.role]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "name") return fullName(a).localeCompare(fullName(b)) * dir;
      if (sortKey === "role") return a.role.localeCompare(b.role) * dir;
      if (sortKey === "last_login")
        return ((a.last_login ?? "") > (b.last_login ?? "") ? 1 : -1) * dir;
      return (a.created_at > b.created_at ? 1 : -1) * dir;
    });
    return list;
  }, [users, search, roleFilter, deptFilter, statusFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const adminCount = users.filter((u) => u.role === "admin").length;

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {users.length} user{users.length === 1 ? "" : "s"} · admin only
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!SERVER_ACTIONS_AVAILABLE}>
          <Plus className="mr-1.5 h-4 w-4" />
          Create User
        </Button>
      </div>

      {!SERVER_ACTIONS_AVAILABLE && (
        <div className="mb-6 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span>
            Create / reset / delete need a backend — manage in Supabase Dashboard. Editing below
            works.
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
            <Input
              placeholder="Search name, username, email, department…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="md:col-span-2"
            />
            <Select
              value={roleFilter || "all"}
              onValueChange={(v) => {
                setRoleFilter(v === "all" ? "" : v);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All Roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                {ALL_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={deptFilter || "all"}
              onValueChange={(v) => {
                setDeptFilter(v === "all" ? "" : v);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter || "all"}
              onValueChange={(v) => {
                setStatusFilter(v === "all" ? "" : v);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            Sort by:
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as typeof sortKey)}>
              <SelectTrigger className="h-7 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="created_at">Created Date</SelectItem>
                <SelectItem value="last_login">Last Login</SelectItem>
                <SelectItem value="role">Role</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            >
              {sortDir === "asc" ? "▲ Asc" : "▼ Desc"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table stickyHeader>
            <TableHeader className="sticky top-16 z-20 bg-card shadow-sm">
              <TableRow>
                <TableHead className="max-md:min-w-[160px]">User</TableHead>
                <TableHead className="hidden md:table-cell">Department</TableHead>
                <TableHead className="max-md:min-w-[110px]">Role</TableHead>
                <TableHead className="max-md:min-w-[130px]">Status</TableHead>
                <TableHead className="hidden xl:table-cell">Created</TableHead>
                <TableHead className="max-md:min-w-[60px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableSkeletonRows columns={6} />}
              {!isLoading && pageRows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    <Inbox className="mx-auto h-6 w-6 text-muted-foreground" />
                    <p className="mt-2">No users match this filter.</p>
                  </TableCell>
                </TableRow>
              )}
              {pageRows.map((u) => {
                const presence = presenceOf(u.last_seen_at);
                return (
                <TableRow key={u.id} className="hover:bg-muted/50">
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>{initials(u)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium leading-tight">{fullName(u)}</p>
                        <p className="text-xs text-muted-foreground leading-tight">{u.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {u.departments?.name || "—"}
                  </TableCell>
                  <TableCell>
                    <span className={`text-sm font-medium ${roleColorClass(u.role)}`}>
                      {ROLE_LABELS[u.role as Role] ?? u.role}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${u.status === "active" ? "bg-success" : "bg-muted-foreground"}`}
                      />
                      <span className="text-sm">
                        {u.status === "active" ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <p className={`mt-0.5 flex items-center gap-1 text-[10px] ${presence.tone}`}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${presence.dot}`} />
                      {presence.label}
                    </p>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setViewRow(u)}>
                          <Eye className="mr-2 h-4 w-4" />
                          View
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEditRow(u)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!SERVER_ACTIONS_AVAILABLE}
                          onClick={() => setResetRow(u)}
                        >
                          <KeyRound className="mr-2 h-4 w-4" />
                          Reset Password
                        </DropdownMenuItem>
                        {u.status === "active" ? (
                          <DropdownMenuItem
                            disabled={!SERVER_ACTIONS_AVAILABLE}
                            onClick={() => setStatusRow({ row: u, next: "inactive" })}
                          >
                            <Ban className="mr-2 h-4 w-4" />
                            Deactivate
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            disabled={!SERVER_ACTIONS_AVAILABLE}
                            onClick={() => setStatusRow({ row: u, next: "active" })}
                          >
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            Activate
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          disabled={
                            !SERVER_ACTIONS_AVAILABLE ||
                            u.id === currentUser?.id ||
                            (u.role === "admin" && adminCount <= 1)
                          }
                          onClick={() => setDeleteRow(u)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                        {!SERVER_ACTIONS_AVAILABLE && (
                          <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                            Requires a server — see banner above
                          </p>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center justify-end gap-3 text-sm text-muted-foreground">
            <span>
              Page {page} of {totalPages} ({filtered.length} users)
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        departments={departments}
        onCreated={refetchAll}
      />
      <ViewUserDialog row={viewRow} onOpenChange={(o) => !o && setViewRow(null)} />
      <EditUserDialog
        row={editRow}
        departments={departments}
        onOpenChange={(o) => !o && setEditRow(null)}
        onSaved={refetchAll}
      />

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
                  void logAudit("user.delete", "user", deleteRow.id, { email: deleteRow.email });
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
              <Label>First Name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div>
              <Label>Last Name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Username</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div>
              <Label>Phone (optional)</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger>
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
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger>
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
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as "active" | "inactive")}>
              <SelectTrigger>
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
              <Label>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Confirm Password</Label>
              <Input
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
        {row && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Username</p>
              <p>{row.username || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <p>{row.phone || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Department</p>
              <p>{row.departments?.name || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Role</p>
              <p>{ROLE_LABELS[row.role as Role] ?? row.role}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <p>{row.status}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last Seen</p>
              <p>{row.last_seen_at ? new Date(row.last_seen_at).toLocaleString() : "Never"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last Login</p>
              <p>{row.last_login ? new Date(row.last_login).toLocaleString() : "Never"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Created</p>
              <p>{new Date(row.created_at).toLocaleString()}</p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  row,
  departments,
  onOpenChange,
  onSaved,
}: {
  row: UserRow | null;
  departments: { id: string; name: string }[];
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [submitting, setSubmitting] = useState(false);

  useMemo(() => {
    if (row) {
      setFirstName(row.first_name ?? "");
      setLastName(row.last_name ?? "");
      setPhone(row.phone ?? "");
      setDepartmentId(row.department_id ?? "");
      setRole(row.role as Role);
      setStatus(row.status as "active" | "inactive");
    }
  }, [row]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
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
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>{row?.email} (email cannot be changed)</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>First Name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div>
              <Label>Last Name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger>
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
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger>
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
            <Label>Status</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as "active" | "inactive")}
              disabled={!SERVER_ACTIONS_AVAILABLE}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            {!SERVER_ACTIONS_AVAILABLE && (
              <p className="mt-1 text-xs text-muted-foreground">
                Requires a server — change this from the Supabase Dashboard instead.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
