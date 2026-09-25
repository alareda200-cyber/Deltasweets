// Pure helpers for the Users page. No React, no Supabase — everything here
// takes plain rows and returns plain values, so it can be reasoned about (and
// tested) without rendering anything.
import { ALL_ROLES, ROLE_LABELS, can, type Permission, type Role } from "@/lib/permissions";
import { iso } from "@/lib/date-utils";

// Fixed English abbreviations: toLocaleDateString("en-GB") gives "Sept" in
// some engines, the design (and every other date label) says "Sep".
export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "21 Sep 2026, 14:05" — local. */
export function dateTimeLabel(stamp: string) {
  const d = new Date(stamp);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hm}`;
}

/** "21 Sep", or "21 Sep 2025" when it isn't this year. Local time. */
export function shortDay(d: Date, now: Date = new Date()) {
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export interface UserLike {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  username?: string | null;
  role: string;
  status: string;
  last_login: string | null;
  last_seen_at: string | null;
  departments?: { name: string } | null;
}

export function fullName(u: Pick<UserLike, "first_name" | "last_name" | "display_name" | "email">) {
  return (
    `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() ||
    u.display_name?.trim() ||
    u.email.split("@")[0]
  );
}

/** Two letters: first letters of the first two name parts ("Abd-Elbaset" splits too). */
export function userInitials(
  u: Pick<UserLike, "first_name" | "last_name" | "display_name" | "email">,
) {
  const parts = fullName(u)
    .split(/[\s._-]+/)
    .filter(Boolean);
  const chars = parts.length > 1 ? [parts[0][0], parts[1][0]] : [parts[0]?.[0] ?? "?"];
  return chars.join("").toUpperCase();
}

export function roleLabel(role: string | null | undefined) {
  if (!role) return "";
  return ROLE_LABELS[role as Role] ?? role;
}

/**
 * Last time we know this person used the app: last_seen_at (written on
 * navigation) and, when that was never written, last_login. Local time.
 * "Today" / "Yesterday" / "21 Sep" (with the year when it isn't this year),
 * or null when neither was ever recorded.
 */
export function lastSeenLabel(
  u: Pick<UserLike, "last_seen_at" | "last_login">,
  now: Date = new Date(),
): string | null {
  const stamp = u.last_seen_at || u.last_login;
  if (!stamp) return null;
  const d = new Date(stamp);
  if (Number.isNaN(d.getTime())) return null;
  const day = iso(d);
  if (day === iso(now)) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day === iso(y)) return "Yesterday";
  return shortDay(d, now);
}

/** Chips for the role filter: All first, then each role that has anyone in it. */
export function roleChips(users: Pick<UserLike, "role">[]) {
  const counts = new Map<string, number>();
  for (const u of users) counts.set(u.role, (counts.get(u.role) ?? 0) + 1);
  const known = ALL_ROLES.filter((r) => (counts.get(r) ?? 0) > 0).map((r) => ({
    value: r as string,
    label: ROLE_LABELS[r],
    count: counts.get(r) ?? 0,
  }));
  // A role the app doesn't know (bad data) still gets a chip so nobody hides.
  const unknown = [...counts.keys()]
    .filter((r) => !(ALL_ROLES as string[]).includes(r))
    .map((r) => ({ value: r, label: r, count: counts.get(r) ?? 0 }));
  return [{ value: "", label: "All", count: users.length }, ...known, ...unknown];
}

export function matchesUserSearch(u: UserLike, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [fullName(u), u.username, u.email, u.departments?.name, roleLabel(u.role)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

/** Admins who can still sign in. Inactive admins can't rescue anyone. */
export function activeAdminCount(users: Pick<UserLike, "role" | "status">[]) {
  return users.filter((u) => u.role === "admin" && u.status !== "inactive").length;
}

/**
 * Whether changing `target` to `nextRole` is allowed. The only hard block is
 * demoting the last admin who can sign in — that would leave nobody able to
 * open Users, Settings or the audit log.
 */
export function roleChangeBlock(
  target: Pick<UserLike, "role" | "status">,
  nextRole: string,
  users: Pick<UserLike, "role" | "status">[],
): string | null {
  if (target.role !== "admin" || nextRole === "admin") return null;
  if (target.status === "inactive") return null;
  if (activeAdminCount(users) > 1) return null;
  return "This is the only admin. Make someone else an admin first, or nobody will be able to manage users and settings.";
}

/** Rows of the "What each role can do" matrix — marks come from can(). */
export const ROLE_MATRIX_ROWS: { label: string; permission: Permission }[] = [
  { label: "See the dashboard", permission: "dashboard.view" },
  { label: "Enter output and rework", permission: "entry.editProduction" },
  { label: "Log downtime", permission: "entry.editDowntime" },
  { label: "Score area owners", permission: "entry.editAreaOwners" },
  { label: "Open maintenance", permission: "maintenance.view" },
  { label: "Settings", permission: "settings.manage" },
  { label: "Users and audit log", permission: "users.manage" },
];

export function roleMatrix() {
  return ROLE_MATRIX_ROWS.map((row) => ({
    ...row,
    cells: ALL_ROLES.map((r) => ({ role: r, allowed: can(r, row.permission) })),
  }));
}

/** What a role change takes away, in the matrix's own words. */
export function lostAbilities(from: string, to: string) {
  return ROLE_MATRIX_ROWS.filter(
    (row) => can(from as Role, row.permission) && !can(to as Role, row.permission),
  ).map((row) => row.label);
}
