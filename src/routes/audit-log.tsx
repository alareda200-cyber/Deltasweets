import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { ChevronRight, Inbox, Info } from "lucide-react";
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

// A "group" is one or more AuditRow with the same user+action+role+device+
// browser, all on the same calendar day, each within 30 minutes of the
// previous one — collapsed into a single row in the table. events is kept
// in ascending (oldest-first) order within the group.
interface AuditGroup {
  key: string;
  events: AuditRow[];
}

const PAGE_SIZE = 20;
const GROUP_WINDOW_MS = 30 * 60 * 1000;

function actionLabel(action: string) {
  return action.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function actionColor(action: string): "default" | "secondary" | "destructive" {
  if (action.includes("delete")) return "destructive";
  if (action.includes("create") || action === "login") return "default";
  return "secondary";
}
function deviceOf(row: AuditRow) {
  return ((row.details as Record<string, unknown> | null)?.device as string | undefined) || "—";
}
function browserOf(row: AuditRow) {
  return ((row.details as Record<string, unknown> | null)?.browser as string | undefined) || "—";
}
function groupingKey(row: AuditRow) {
  return `${row.user_email ?? ""}|${row.action}|${row.role ?? ""}|${deviceOf(row)}|${browserOf(row)}`;
}
function initialsFromEmail(email: string | null) {
  if (!email) return "?";
  const name = email.split("@")[0];
  const parts = name.split(/[._-]+/).filter(Boolean);
  const chars = parts.length > 1 ? [parts[0][0], parts[1][0]] : [name[0], name[1] ?? ""];
  return chars.join("").toUpperCase();
}
function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const actionTypes = useMemo(() => Array.from(new Set(logs.map((l) => l.action))).sort(), [logs]);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (actionFilter && l.action !== actionFilter) return false;
      if (roleFilter && l.role !== roleFilter) return false;
      if (from && l.created_at.slice(0, 10) < from) return false;
      if (to && l.created_at.slice(0, 10) > to) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [l.user_email, l.action, l.entity_type, l.entity_id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, search, actionFilter, roleFilter, from, to]);

  // Group consecutive same-key events that land on the same day within 30
  // minutes of each other, then show newest group first (each group's own
  // events stay oldest-first, for the expanded detail rows).
  const groups = useMemo<AuditGroup[]>(() => {
    const sorted = [...filtered].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const result: AuditGroup[] = [];
    for (const row of sorted) {
      const key = groupingKey(row);
      const day = row.created_at.slice(0, 10);
      const current = result[result.length - 1];
      if (current) {
        const lastRow = current.events[current.events.length - 1];
        const sameDay = lastRow.created_at.slice(0, 10) === day;
        const withinWindow =
          new Date(row.created_at).getTime() - new Date(lastRow.created_at).getTime() <=
          GROUP_WINDOW_MS;
        if (current.key === key && sameDay && withinWindow) {
          current.events.push(row);
          continue;
        }
      }
      result.push({ key, events: [row] });
    }
    return result.reverse();
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const pageGroups = groups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every Login, Entry, User, Settings, and Export action — who did it, when, and from where.
        </p>
      </div>

      {!SERVER_ACTIONS_AVAILABLE && (
        <div className="mb-6 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span>Logging needs a backend to run — this log stays empty on this deployment.</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>Most recent 1,000 events.</CardDescription>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-5">
            <Input
              placeholder="Search user, action, entity…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="md:col-span-2"
            />
            <Select
              value={actionFilter || "all"}
              onValueChange={(v) => {
                setActionFilter(v === "all" ? "" : v);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All Actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {actionTypes.map((a) => (
                  <SelectItem key={a} value={a}>
                    {actionLabel(a)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                {(["admin", "production", "maintenance", "quality", "viewer"] as Role[]).map(
                  (r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <div className="flex gap-1">
              <Input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
              />
              <Input
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table stickyHeader>
            <TableHeader className="sticky top-16 z-20 bg-card shadow-sm">
              <TableRow>
                <TableHead className="max-md:min-w-[170px]">User</TableHead>
                <TableHead className="max-md:min-w-[110px]">Action</TableHead>
                <TableHead className="max-md:min-w-[130px]">When</TableHead>
                <TableHead className="hidden md:table-cell">Device · Browser</TableHead>
                <TableHead className="hidden lg:table-cell">IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableSkeletonRows columns={5} />}
              {!isLoading && pageGroups.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    <Inbox className="mx-auto h-6 w-6 text-muted-foreground" />
                    <p className="mt-2">No activity matches this filter.</p>
                  </TableCell>
                </TableRow>
              )}
              {pageGroups.map((group) => {
                const first = group.events[0];
                const last = group.events[group.events.length - 1];
                const isMulti = group.events.length > 1;
                const isOpen = expanded.has(first.id);
                const firstDt = new Date(first.created_at);
                const lastDt = new Date(last.created_at);
                return (
                  <Fragment key={first.id}>
                    <TableRow
                      className={`hover:bg-muted/50 ${isMulti ? "cursor-pointer" : ""}`}
                      onClick={isMulti ? () => toggleExpand(first.id) : undefined}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          {isMulti ? (
                            <ChevronRight
                              className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                            />
                          ) : (
                            <span className="w-3.5 shrink-0" />
                          )}
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="text-[10px]">
                              {initialsFromEmail(first.user_email)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="max-w-[140px] truncate text-sm font-medium leading-tight">
                              {first.user_email || "—"}
                            </p>
                            <p className="text-[11px] text-muted-foreground leading-tight">
                              {first.role ? (ROLE_LABELS[first.role as Role] ?? first.role) : "—"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={actionColor(first.action)}>
                            {actionLabel(first.action)}
                          </Badge>
                          {isMulti && (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {group.events.length}×
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {fmtDate(firstDt)} · {fmtTime(firstDt)}
                        {isMulti ? `–${fmtTime(lastDt)}` : ""}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                        {deviceOf(first)} · {browserOf(first)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {first.ip_address || "—"}
                      </TableCell>
                    </TableRow>
                    {isMulti &&
                      isOpen &&
                      [...group.events].reverse().map((ev) => (
                        <TableRow key={ev.id} className="bg-muted/30 hover:bg-muted/40">
                          <TableCell
                            colSpan={2}
                            className="py-1.5 pl-11 text-xs text-muted-foreground"
                          >
                            {new Date(ev.created_at).toLocaleTimeString()}
                          </TableCell>
                          <TableCell className="py-1.5 text-xs text-muted-foreground" />
                          <TableCell className="hidden md:table-cell py-1.5 text-xs text-muted-foreground" />
                          <TableCell className="hidden lg:table-cell py-1.5 text-xs text-muted-foreground">
                            {ev.ip_address || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center justify-end gap-3 text-sm text-muted-foreground">
            <span>
              Page {page} of {totalPages} ({groups.length} entries, {filtered.length} events)
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
    </AppShell>
  );
}
