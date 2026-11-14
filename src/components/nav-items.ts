// The app's pages, in rail order. Used by the desktop rail, the Ctrl K palette
// and (through `to`) the phone's More list. Permission-filtered where shown, so
// a role never sees a link that dead-ends on RequireAuth's access-denied screen.
import {
  Factory,
  LayoutDashboard,
  ScrollText,
  Settings,
  SquarePlus,
  Target,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

export interface NavItem {
  to:
    | "/"
    | "/plant"
    | "/entry"
    | "/maintenance"
    | "/plan-adherence"
    | "/users"
    | "/audit-log"
    | "/settings";
  label: string;
  /** Under the rail icon: short. */
  short: string;
  icon: LucideIcon;
  permission: Permission;
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: "/",
    label: "Dashboard",
    short: "Dashboard",
    icon: LayoutDashboard,
    permission: "dashboard.view",
  },
  {
    to: "/plant",
    label: "Plant floor",
    short: "Plant",
    icon: Factory,
    permission: "dashboard.view",
  },
  {
    to: "/entry",
    label: "Daily entry",
    short: "Entry",
    icon: SquarePlus,
    permission: "entry.view",
  },
  {
    to: "/maintenance",
    label: "Maintenance",
    short: "Maint.",
    icon: Wrench,
    permission: "maintenance.view",
  },
  {
    to: "/plan-adherence",
    label: "Plan adherence",
    short: "Plan",
    icon: Target,
    permission: "plan.view",
  },
  { to: "/users", label: "Users", short: "Users", icon: Users, permission: "users.manage" },
  {
    to: "/audit-log",
    label: "Audit log",
    short: "Audit",
    icon: ScrollText,
    permission: "users.manage",
  },
  {
    to: "/settings",
    label: "Settings",
    short: "Settings",
    icon: Settings,
    permission: "settings.manage",
  },
];
