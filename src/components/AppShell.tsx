import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, PlusSquare, Settings, Factory, LogOut, Users, User, KeyRound, ChevronDown, ScrollText, Bell, AlertTriangle, Wrench } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MyProfileDialog } from "@/components/MyProfileDialog";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { useNotifications } from "@/lib/notifications";
import { Badge } from "@/components/ui/badge";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view" as const },
  { to: "/entry", label: "Daily Entry", icon: PlusSquare, permission: "entry.view" as const },
  { to: "/maintenance", label: "Maintenance", icon: Wrench, permission: "maintenance.view" as const },
  { to: "/users", label: "Users", icon: Users, permission: "users.manage" as const },
  { to: "/audit-log", label: "Audit Log", icon: ScrollText, permission: "users.manage" as const },
  { to: "/settings", label: "Settings", icon: Settings, permission: "settings.manage" as const },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { role, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const visibleNav = nav.filter((n) => can(role, n.permission));
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const { data: notifications = [] } = useNotifications();

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/login" });
  }

  const initials = `${profile?.first_name?.[0] ?? ""}${profile?.last_name?.[0] ?? ""}`.toLocaleUpperCase() || profile?.email?.[0]?.toUpperCase() || "?";
  const displayName = profile?.display_name || profile?.email || "";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-6 px-4 md:px-8">
          <Link to="/" className="flex shrink-0 items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg gradient-hero shadow-elevated">
              <Factory className="h-5 w-5 text-white" />
            </div>
            <div className="hidden sm:block">
              <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Production Intelligence
              </p>
              <p className="-mt-0.5 text-sm font-bold tracking-tight">Scorecard OS</p>
            </div>
          </Link>
          {/* min-w-0 lets this shrink inside the flex row instead of forcing
              the header wider than the viewport — without it, overflow-x-auto
              never kicks in because the row just grows to fit every item
              (this is what caused the 549px-wide header on a 390px mobile
              viewport once the Maintenance icon pushed nav past 5 items). */}
          <nav className="ml-2 flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-hide">
            {visibleNav.map((n) => {
              const active = n.to === "/" ? pathname === "/" : pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cn(
                    "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <n.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{n.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="relative rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Notifications">
                  <Bell className="h-4 w-4" />
                  {notifications.length > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                      {notifications.length > 9 ? "9+" : notifications.length}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 && (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">No alerts in the last 7 days.</p>
                  )}
                  {notifications.map((n) => (
                    <div key={n.id} className="flex items-start gap-2 px-2 py-2 text-xs">
                      <AlertTriangle className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", n.severity === "critical" ? "text-destructive" : "text-amber-500")} />
                      <div>
                        <p className="font-medium leading-tight">{n.message}</p>
                        <p className="text-[10px] text-muted-foreground">{n.entryDate}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 transition-colors hover:bg-muted">
                  <Avatar className="h-7 w-7" style={{ backgroundColor: profile?.avatar_color || "#0ea5e9" }}>
                    <AvatarFallback style={{ backgroundColor: profile?.avatar_color || "#0ea5e9", color: "white" }} className="text-[11px]">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden text-left md:block">
                    <span className="block max-w-[120px] truncate text-xs font-medium leading-tight">{displayName}</span>
                    <span className="block text-[10px] leading-tight text-muted-foreground">{role ? ROLE_LABELS[role as Role] : ""}</span>
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <p className="truncate text-sm font-medium">{displayName}</p>
                  <p className="truncate text-xs font-normal text-muted-foreground">{profile?.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setProfileOpen(true)}><User className="mr-2 h-4 w-4" />My Profile</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPasswordOpen(true)}><KeyRound className="mr-2 h-4 w-4" />Change Password</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive"><LogOut className="mr-2 h-4 w-4" />Logout</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-6 md:px-8 md:py-8">{children}</main>

      <MyProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </div>
  );
}

function ThemeToggle() {
  return (
    <button
      onClick={() => document.documentElement.classList.toggle("dark")}
      className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      aria-label="Toggle theme"
    >
      Theme
    </button>
  );
}
