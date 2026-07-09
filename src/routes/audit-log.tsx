import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ServerCrash } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, type Role } from "@/lib/permissions";

// Same reasoning as src/routes/users.tsx — this deployment is Firebase
// Hosting only (static, no server), and every logAudit() call goes through
// a server function (src/lib/audit.server.ts, for real IP/User-Agent
// capture) that has nothing to run on here. logAudit() fails silently by
// design (it must never block the action it's recording), so nothing
// breaks — but it also means no row is ever actually written to
// audit_logs from this deployment. Surfacing that plainly here instead of
// letting an admin wonder why the log is always empty.
const SERVER_ACTIONS_AVAILABLE = false;

export const Route = createFileRoute("/audit-log")({
  head: () => ({ meta: [{ title: "Audit Log · Production Scorecard" }] }),
  component: () => (
    <RequireAuth requirePermission="users.manage">
      <AuditLogPage />
    </RequireAuth>
  ),
});

interface AuditRow {
  id: string;
  user_email: string | null;
  role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

const PAGE_SIZE = 20;

function actionLabel(action: string) {
  return action.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function actionColor(action: string): "default" | "secondary" | "destructive" {
  if (action.includes("delete")) return "destructive";
  if (action.includes("create") || action === "login") return "default";
  return "secondary";
}

function AuditLogPage() {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async (): Promise<AuditRow[]> => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data as unknown as AuditRow[];
    },
  });

  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const actionTypes = useMemo(() => Array.from(new Set(logs.map((l) => l.action))).sort(), [logs]);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (actionFilter && l.action !== actionFilter) return false;
      if (roleFilter && l.role !== roleFilter) return false;
      if (from && l.created_at.slice(0, 10) < from) return false;
      if (to && l.created_at.slice(0, 10) > to) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [l.user_email, l.action, l.entity_type, l.entity_id].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, search, actionFilter, roleFilter, from, to]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every Login, Entry, User, Settings, and Export action — who did it, when, and from where.</p>
      </div>

      {!SERVER_ACTIONS_AVAILABLE && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <ServerCrash className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">This log will always be empty on this deployment</p>
            <p className="mt-0.5 text-amber-800">
              This is Firebase Hosting only (a static site, no server), and recording an event needs a server to capture
              it safely. This is expected, not a bug — it isn't silently losing data, nothing is being written at all.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>Most recent 1,000 events.</CardDescription>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-5">
            <Input placeholder="Search user, action, entity…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="md:col-span-2" />
            <Select value={actionFilter || "all"} onValueChange={(v) => { setActionFilter(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="All Actions" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {actionTypes.map((a) => <SelectItem key={a} value={a}>{actionLabel(a)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={roleFilter || "all"} onValueChange={(v) => { setRoleFilter(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="All Roles" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                {(["admin", "production", "maintenance", "quality", "viewer"] as Role[]).map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-1">
              <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
              <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden md:table-cell">Entity</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="hidden lg:table-cell">Time</TableHead>
                  <TableHead className="hidden lg:table-cell">IP</TableHead>
                  <TableHead className="hidden xl:table-cell">Device</TableHead>
                  <TableHead className="hidden xl:table-cell">Browser</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={9} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
                )}
                {!isLoading && pageRows.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">No activity matches this filter.</TableCell></TableRow>
                )}
                {pageRows.map((l) => {
                  const dt = new Date(l.created_at);
                  return (
                    <TableRow key={l.id} className="hover:bg-muted/50">
                      <TableCell className="max-w-[160px] truncate text-sm">{l.user_email || "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{l.role ? (ROLE_LABELS[l.role as Role] ?? l.role) : "—"}</Badge></TableCell>
                      <TableCell><Badge variant={actionColor(l.action)}>{actionLabel(l.action)}</Badge></TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{l.entity_type || "—"}</TableCell>
                      <TableCell className="text-sm">{dt.toLocaleDateString()}</TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{dt.toLocaleTimeString()}</TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{l.ip_address || "—"}</TableCell>
                      <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">{(l.details as any)?.device || "—"}</TableCell>
                      <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">{(l.details as any)?.browser || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 flex items-center justify-end gap-3 text-sm text-muted-foreground">
            <span>Page {page} of {totalPages} ({filtered.length} events)</span>
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
