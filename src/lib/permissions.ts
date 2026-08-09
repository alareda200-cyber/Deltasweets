export type Role = "admin" | "production" | "maintenance" | "quality" | "viewer";

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
  | "maintenance.view"
  | "maintenance.edit"
  | "maintenance.delete";

const MATRIX: Record<Role, Permission[]> = {
  admin: [
    "settings.manage", "users.manage",
    "entry.view", "entry.create", "entry.delete", "entry.history",
    "entry.editProduction", "entry.editDowntime", "entry.editAreaOwners", "entry.editNotes",
    "dashboard.view", "dashboard.viewMaintenanceCard", "dashboard.exportPdf",
    "maintenance.view", "maintenance.edit", "maintenance.delete",
  ],
  production: [
    "entry.view", "entry.create", "entry.delete", "entry.history",
    "entry.editProduction", "entry.editDowntime", "entry.editAreaOwners", "entry.editNotes",
    "dashboard.view", "dashboard.viewMaintenanceCard", "dashboard.exportPdf",
    "maintenance.view", "maintenance.edit",
  ],
  maintenance: [
    "entry.view", "entry.history",
    "entry.editDowntime", "entry.editNotes",
    "dashboard.view", "dashboard.viewMaintenanceCard", "dashboard.exportPdf",
    "maintenance.view", "maintenance.edit", "maintenance.delete",
  ],
  quality: [
    "entry.view", "entry.history",
    "entry.editAreaOwners", "entry.editNotes",
    "dashboard.view", "dashboard.viewMaintenanceCard", "dashboard.exportPdf",
  ],
  viewer: [
    "dashboard.view", "dashboard.viewMaintenanceCard", "dashboard.exportPdf",
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
};

export const ALL_ROLES: Role[] = ["admin", "production", "maintenance", "quality", "viewer"];
