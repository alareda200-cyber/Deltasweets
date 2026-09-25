// Pure helpers for the Audit log page: human labels, the detail line, local
// dates, filtering and grouping. Every date here is the viewer's LOCAL date —
// the list shows local times, so the filter and the day headings must agree
// with it (comparing created_at.slice(0, 10) used UTC and put late-evening
// events on the wrong day).
import { iso } from "@/lib/date-utils";
import { MONTHS, WEEKDAYS, roleLabel, shortDay } from "@/lib/users-format";

export interface AuditRow {
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

export type AuditTab = "changes" | "sessions";

export const SESSION_ACTIONS = new Set(["login", "logout"]);

export function tabOf(action: string): AuditTab {
  return SESSION_ACTIONS.has(action) ? "sessions" : "changes";
}

const ENTITY_LABELS: Record<string, string> = {
  area_owner: "area owner",
  department: "department",
  department_category: "department category",
  downtime_reason: "downtime reason",
  downtime_type: "downtime type",
  line_field_definition: "line field",
  production_area: "production area",
  production_line: "production line",
  root_cause: "root cause",
  severity_level: "severity level",
  technician: "technician",
  maintenance_event_title: "fault title",
  app_settings: "app settings",
};

const ACTION_LABELS: Record<string, string> = {
  login: "Signed in",
  logout: "Signed out",
  "dashboard.export_pdf": "Exported dashboard PDF",
  "maintenance.export_report": "Exported maintenance report",
  "maintenance.create_event": "Created maintenance event",
  "maintenance.update_event": "Updated maintenance event",
  "maintenance.delete_event": "Deleted maintenance event",
  "maintenance.create_stoppage": "Created stoppage",
  "maintenance.delete_stoppage": "Deleted stoppage",
  "maintenance.add_note": "Added a note to a maintenance event",
  "entry.delete": "Deleted daily entry",
  "settings.create": "Added a setting",
  "settings.update": "Changed a setting",
  "settings.delete": "Removed a setting",
  "settings.export": "Exported settings backup",
  "settings.import": "Imported settings backup",
  "user.create": "Created user",
  "user.edit": "Edited user",
  "user.change_role": "Changed user role",
  "user.reset_password": "Reset a password",
  "user.activate": "Switched account on",
  "user.deactivate": "Switched account off",
  "user.delete": "Deleted user",
};

function prettify(action: string) {
  const s = action.replace(/[._]/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Label for the action filter — one per action, no entity. */
export function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? prettify(action);
}

/** Label for one row — settings actions name what was touched. */
export function rowActionLabel(row: Pick<AuditRow, "action" | "entity_type">) {
  const entity = row.entity_type ? ENTITY_LABELS[row.entity_type] : undefined;
  if (entity) {
    if (row.action === "settings.create") return `Added ${entity}`;
    if (row.action === "settings.update") return `Changed ${entity}`;
    if (row.action === "settings.delete") return `Removed ${entity}`;
  }
  return actionLabel(row.action);
}

export function whoOf(email: string | null) {
  return email ? email.split("@")[0] : null;
}

export function localDay(isoStamp: string) {
  return iso(new Date(isoStamp));
}

export function timeLabel(isoStamp: string) {
  const d = new Date(isoStamp);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "Tue 25 Aug", plus the year when it isn't this year. */
export function dayHeading(day: string, now: Date = new Date()) {
  const date = dateParts(day);
  return `${WEEKDAYS[date.getDay()]} ${shortDay(date, now)}`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function dateParts(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "1–31 Aug", "28 Jul – 3 Aug", "28 Dec 2025 – 3 Jan 2026". */
export function shortRange(from: string, to: string) {
  const a = dateParts(from);
  const b = dateParts(to);
  if (a.getFullYear() !== b.getFullYear()) {
    const f = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    return `${f(a)} – ${f(b)}`;
  }
  if (a.getMonth() === b.getMonth()) {
    return a.getDate() === b.getDate()
      ? `${a.getDate()} ${MONTHS[a.getMonth()]}`
      : `${a.getDate()}–${b.getDate()} ${MONTHS[a.getMonth()]}`;
  }
  return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}

/** "25 Aug 2026" — for the banner. */
export function longDate(isoStamp: string) {
  const d = new Date(isoStamp);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "8 Jul" (year added when it isn't this year). */
export function shortDate(isoStamp: string, now: Date = new Date()) {
  return shortDay(new Date(isoStamp), now);
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function stampTime(v: unknown, eventStamp: string): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  // Same local day as the log row: time only. Otherwise say which day.
  return localDay(s) === localDay(eventStamp) ? timeLabel(s) : `${shortDate(s)} ${timeLabel(s)}`;
}

/**
 * The second line of a row, built from `details`: what was touched, on which
 * line and period, and what changed. device/browser live in their own column
 * and ids (rootCauseId, stoppageId…) mean nothing to a reader, so both are left
 * out. Returns "" when there is nothing worth saying (sign-ins).
 */
export function detailLine(row: Pick<AuditRow, "action" | "details" | "created_at">) {
  const d = row.details ?? {};
  const parts: string[] = [];
  const title = str(d.title) ?? str(d.name);
  if (title) parts.push(`“${title}”`);
  const label = str(d.label);
  if (label) parts.push(label);
  const email = str(d.email);
  if (email && row.action.startsWith("user.")) parts.push(email);

  const lineName = str(d.lineName);
  if (lineName) parts.push(lineName);

  const from = str(d.from);
  const to = str(d.to);
  if (row.action === "user.change_role") {
    if (from || to) parts.push(`${from ? roleLabel(from) : "?"} → ${to ? roleLabel(to) : "?"}`);
  } else if (from && to && DATE_ONLY.test(from) && DATE_ONLY.test(to)) {
    parts.push(shortRange(from, to));
  } else if (from && DATE_ONLY.test(from)) {
    parts.push(`from ${shortRange(from, from)}`);
  } else if (to && DATE_ONLY.test(to)) {
    parts.push(`to ${shortRange(to, to)}`);
  } else if (!from && !to && row.action === "maintenance.export_report") {
    parts.push("all dates");
  }

  const count = d.eventCount;
  if (typeof count === "number") parts.push(`${count} event${count === 1 ? "" : "s"}`);
  const rows = d.totalRows;
  if (typeof rows === "number") parts.push(`${rows} row${rows === 1 ? "" : "s"}`);

  const status = str(d.status);
  if (status) parts.push(`Status → ${status.replace(/_/g, " ")}`);
  const started = stampTime(d.startedAt, row.created_at);
  const resolved = stampTime(d.resolvedAt, row.created_at);
  if (started && resolved) parts.push(`started ${started}, resolved ${resolved}`);
  else if (started) parts.push(`started ${started}`);
  else if (resolved) parts.push(`resolved ${resolved}`);

  const type = str(d.type);
  if (type) parts.push(type.replace(/_/g, " "));

  const reliability = str(d.reliability_start_date);
  if (reliability && DATE_ONLY.test(reliability))
    parts.push(`Reliability start → ${shortRange(reliability, reliability)}`);
  const rootCause = str(d.root_cause_tracking_start_date);
  if (rootCause && DATE_ONLY.test(rootCause))
    parts.push(`Root-cause tracking start → ${shortRange(rootCause, rootCause)}`);

  return parts.join(" · ");
}

export function deviceLine(row: Pick<AuditRow, "details">) {
  const d = row.details ?? {};
  return [str(d.device), str(d.browser)].filter(Boolean).join(" · ");
}

export interface AuditFilters {
  search: string;
  person: string; // "" = everyone, "__none__" = rows with no user
  action: string; // "" = every action in the tab
  from: string; // local YYYY-MM-DD, inclusive
  to: string; // local YYYY-MM-DD, inclusive
}

export const NO_USER = "__none__";

/** Every filter except the tab and the action — the tab counts use this. */
export function matchesBaseFilters(row: AuditRow, f: Omit<AuditFilters, "action">) {
  if (f.person === NO_USER) {
    if (row.user_email) return false;
  } else if (f.person && row.user_email !== f.person) {
    return false;
  }
  if (f.from || f.to) {
    const day = localDay(row.created_at);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
  }
  const q = f.search.trim().toLowerCase();
  if (q) {
    const hay = [
      row.user_email,
      row.role,
      rowActionLabel(row),
      row.action,
      detailLine(row),
      str(row.details?.lineName),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// A group is one or more rows with the same person, action, role, device and
// browser, on the same LOCAL day, each within 30 minutes of the previous one.
// events are oldest-first inside a group; groups come back newest-first.
export interface AuditGroup {
  key: string;
  day: string;
  events: AuditRow[];
}

const GROUP_WINDOW_MS = 30 * 60 * 1000;

function groupingKey(row: AuditRow) {
  const d = row.details ?? {};
  return [
    row.user_email ?? "",
    row.action,
    row.entity_type ?? "",
    row.role ?? "",
    str(d.device) ?? "",
    str(d.browser) ?? "",
    detailLine(row),
  ].join("|");
}

export function groupAuditRows(rows: AuditRow[]): AuditGroup[] {
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const result: AuditGroup[] = [];
  for (const row of sorted) {
    const key = groupingKey(row);
    const day = localDay(row.created_at);
    const current = result[result.length - 1];
    if (current && current.key === key && current.day === day) {
      const last = current.events[current.events.length - 1];
      const gap = new Date(row.created_at).getTime() - new Date(last.created_at).getTime();
      if (gap <= GROUP_WINDOW_MS) {
        current.events.push(row);
        continue;
      }
    }
    result.push({ key, day, events: [row] });
  }
  return result.reverse();
}

/** Consecutive groups on the same local day, newest day first. */
export function groupsByDay(groups: AuditGroup[]) {
  const days: { day: string; groups: AuditGroup[] }[] = [];
  for (const g of groups) {
    const last = days[days.length - 1];
    if (last && last.day === g.day) last.groups.push(g);
    else days.push({ day: g.day, groups: [g] });
  }
  return days;
}

/**
 * Banner shown when logging has visibly stopped: no server to write rows and
 * the newest row is more than two days old. null = show the normal subtitle.
 */
export function staleLogNotice(
  rows: Pick<AuditRow, "created_at">[],
  serverActionsAvailable: boolean,
  now: Date = new Date(),
): { since: string; count: number; oldest: string; newest: string; empty: boolean } | null {
  if (serverActionsAvailable) return null;
  if (rows.length === 0) return { since: "", count: 0, oldest: "", newest: "", empty: true };
  let newest = rows[0].created_at;
  let oldest = rows[0].created_at;
  for (const r of rows) {
    if (r.created_at > newest) newest = r.created_at;
    if (r.created_at < oldest) oldest = r.created_at;
  }
  if (now.getTime() - new Date(newest).getTime() <= 2 * 24 * 60 * 60 * 1000) return null;
  return { since: newest, count: rows.length, oldest, newest, empty: false };
}

/** "Cairo" from "Africa/Cairo"; null when the browser won't say. */
export function localZoneName() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return null;
    return tz.split("/").pop()!.replace(/_/g, " ");
  } catch {
    return null;
  }
}
