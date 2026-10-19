export type Role = "admin" | "production" | "maintenance" | "quality" | "viewer" | "super_viewer";

export type Permission =
  | "settings.manage"
  | "users.manage"
  | "entry.view"
  | "entry.create"
  | "entry.delete"
  | "entry.history"
  | "entry.editProduction" // making/packing plan+actual, rework
  | "entry.editDowntime" // downtime rows: reason, minutes, area
  | "entry.editAreaOwners" // area owner + performance score
  | "entry.editNotes"
  | "dashboard.view"
  | "dashboard.viewMaintenanceCard"
  | "dashboard.exportPdf"
  | "plan.view" // Plan adherence page
  | "recap.view" // Month recap and Replay a day
  | "maintenance.view"
  | "maintenance.edit"
  | "maintenance.delete"
  | "replay.approve"; // answer Replay requests (Settings › Replay approval)

// Roles (Ala, 19 Oct 2026):
//   admin, production, quality — unchanged (Plan adherence, Recap and Replay
//     were behind dashboard.view; they keep them through plan.view/recap.view).
//   maintenance — the Maintenance page only, read-only (no faults, no
//     downtime on the entry). The database refuses their writes too.
//   viewer — Dashboard and Plan adherence only.
//   super_viewer — Dashboard, Plan adherence and Maintenance, read-only.
// prettier-ignore
const MATRIX: Record<Role, Permission[]> = {
  admin: [
    "settings.manage", "users.manage",
    "entry.view", "entry.create", "entry.delete", "entry.history",
    "entry.editProduction", "entry.editDowntime", "entry.editAreaOwners", "entry.editNotes",
    "dashboard.view", "dashboard.viewMaintenanceCard", "dashboard.exportPdf",
    "plan.view", "recap.view",
    "maintenance.view", "maintenance.edit", "maintenance.delete",
    "replay.approve",
  ],
  production: [
    "entry.view", "entry.create", "entry.delete", "entry.history",
    "entry.editProduction", "entry.editDowntime", "entry.editAreaOwners", "entry.editNotes",
    "dashboard.view", "dashboard.viewMaintenanceCard", "dashboard.exportPdf",
    "plan.view", "recap.view",
    "maintenance.view", "maintenance.edit",
  ],
  maintenance: [
    "maintenance.view",
  ],
  quality: [
    "entry.view", "entry.history",
    "entry.editAreaOwners", "entry.editNotes",
    "dashboard.view", "dashboard.viewMaintenanceCard", "dashboard.exportPdf",
    "plan.view", "recap.view",
  ],
  viewer: [
    "dashboard.view", "dashboard.viewMaintenanceCard", "dashboard.exportPdf",
    "plan.view",
  ],
  super_viewer: [
    "dashboard.view", "dashboard.viewMaintenanceCard", "dashboard.exportPdf",
    "plan.view",
    "maintenance.view",
  ],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return MATRIX[role]?.includes(permission) ?? false;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  production: "Production",
  maintenance: "Maintenance",
  quality: "Quality",
  viewer: "Viewer",
  super_viewer: "Super viewer",
};

export const ALL_ROLES: Role[] = [
  "admin",
  "production",
  "maintenance",
  "quality",
  "super_viewer",
  "viewer",
];

/** Where a role lands after signing in: the first page it may open. */
export function homeFor(role: Role | null | undefined): "/" | "/maintenance" | "/plan-adherence" {
  if (can(role, "dashboard.view")) return "/";
  if (can(role, "maintenance.view")) return "/maintenance";
  return "/plan-adherence";
}
