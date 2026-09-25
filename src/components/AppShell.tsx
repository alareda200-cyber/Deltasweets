import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  SquarePlus,
  LogOut,
  User,
  KeyRound,
  Bell,
  AlertTriangle,
  Wrench,
  Ellipsis,
  Moon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { touchLastSeen } from "@/lib/presence";
import { can } from "@/lib/permissions";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MyProfileDialog } from "@/components/MyProfileDialog";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { useNotifications } from "@/lib/notifications";
import { PushNotificationToggle } from "@/components/PushNotificationToggle";
import { Input } from "@/components/ui/input";

// Desktop top nav (md and up). Text-only links, per the approved header
// mockup. Permission-filtered below so a role never sees a link that
// dead-ends on RequireAuth's access-denied screen.
const nav = [
  { to: "/", label: "Dashboard", permission: "dashboard.view" as const },
  { to: "/entry", label: "Daily entry", permission: "entry.view" as const },
  { to: "/maintenance", label: "Maintenance", permission: "maintenance.view" as const },
  { to: "/users", label: "Users", permission: "users.manage" as const },
  { to: "/audit-log", label: "Audit log", permission: "users.manage" as const },
  { to: "/settings", label: "Settings", permission: "settings.manage" as const },
];

// Mobile bottom tab bar (below md). Three permission-filtered tabs plus
// "More", which every role gets: it is the only way to reach Users, Audit
// log, Settings, profile, password and sign-out on a phone. `permission:
// null` means "always shown".
const mobileNav = [
  {
    to: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    permission: "dashboard.view" as const,
    match: ["/"],
  },
  {
    to: "/entry",
    label: "Entry",
    icon: SquarePlus,
    permission: "entry.view" as const,
    match: ["/entry"],
  },
  {
    to: "/maintenance",
    label: "Maintenance",
    icon: Wrench,
    permission: "maintenance.view" as const,
    match: ["/maintenance"],
  },
  {
    to: "/more",
    label: "More",
    icon: Ellipsis,
    permission: null,
    match: ["/more", "/users", "/audit-log", "/settings"],
  },
];

function isActive(pathname: string, prefix: string) {
  return prefix === "/"
    ? pathname === "/"
    : pathname === prefix || pathname.startsWith(`${prefix}/`);
}

// Shared by the header avatar and the More page's profile row so both show
// the same initials, name and colour.
export function useProfileIdentity() {
  const { profile, role } = useAuth();
  const initials =
    `${profile?.first_name?.[0] ?? ""}${profile?.last_name?.[0] ?? ""}`.toLocaleUpperCase() ||
    profile?.email?.[0]?.toUpperCase() ||
    "?";
  const displayName = profile?.display_name || profile?.email || "";
  const avatarColor = profile?.avatar_color || "#0ea5e9";
  const roleLabel = role ? ROLE_LABELS[role as Role] : "";
  return { initials, displayName, avatarColor, roleLabel };
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { role, profile, signOut } = useAuth();
  useEffect(() => {
    touchLastSeen();
  }, [pathname]);
  const navigate = useNavigate();
  const visibleNav = nav.filter((n) => can(role, n.permission));
  const visibleMobileNav = mobileNav.filter(
    (n) => n.permission === null || can(role, n.permission),
  );
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const { data: notifications = [] } = useNotifications();
  const { initials, displayName, avatarColor, roleLabel } = useProfileIdentity();

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/login" });
  }

  const alertCount = notifications.length;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 pl-4 pr-3 md:h-16 md:gap-7 md:px-8 lg:px-10">
          <Link to="/" className="flex min-h-11 min-w-0 shrink items-center gap-2.5 rounded-lg">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-primary text-[13px] font-bold text-primary-foreground md:h-9 md:w-9 md:rounded-[10px] md:text-sm"
            >
              DS
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[15px] font-bold">Delta Sweets</span>
              <span className="block truncate text-xs text-muted-foreground">
                Production scorecard
              </span>
            </span>
          </Link>
          {/* min-w-0 + overflow-x-auto: between md and ~1100px the six links
              scroll inside the nav instead of widening the header. */}
          <nav
            aria-label="Main"
            className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-hide md:flex"
          >
            {visibleNav.map((n) => {
              const active = isActive(pathname, n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-10 shrink-0 items-center whitespace-nowrap rounded-[10px] px-3.5 text-sm transition-colors",
                    active
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-foreground hover:bg-muted",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
            <PushNotificationToggle />
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="relative grid h-11 w-11 place-items-center rounded-[10px] text-foreground transition-colors hover:bg-muted md:border md:border-border md:bg-card"
                  aria-label={
                    alertCount > 0 ? `Alerts, ${alertCount} in the last 7 days` : "Alerts"
                  }
                >
                  <Bell className="h-5 w-5 md:h-[18px] md:w-[18px]" />
                  {alertCount > 0 && (
                    <span className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-bold leading-none text-destructive-foreground">
                      {alertCount > 9 ? "9+" : alertCount}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
                <DropdownMenuLabel>Alerts · last 7 days</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="max-h-80 overflow-y-auto">
                  {alertCount === 0 && (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                      No alerts in the last 7 days.
                    </p>
                  )}
                  {notifications.map((n) => (
                    <div key={n.id} className="flex items-start gap-2 px-2 py-2 text-xs">
                      <AlertTriangle
                        className={cn(
                          "mt-0.5 h-3.5 w-3.5 shrink-0",
                          n.severity === "critical" ? "text-destructive" : "text-warning-strong",
                        )}
                      />
                      <div>
                        <p className="font-medium leading-tight">{n.message}</p>
                        <p className="text-xs text-muted-foreground">{n.entryDate}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Account menu: desktop only. On a phone the same actions
                (profile, password, sign out) live on the More tab. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Account: ${displayName}${roleLabel ? `, ${roleLabel}` : ""}`}
                  className="hidden h-11 items-center gap-2.5 rounded-xl border border-border bg-card pl-1.5 pr-3 text-foreground transition-colors hover:bg-muted md:flex"
                >
                  <Avatar className="h-8 w-8" style={{ backgroundColor: avatarColor }}>
                    <AvatarFallback
                      style={{ backgroundColor: avatarColor, color: "white" }}
                      className="text-[13px] font-bold"
                    >
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-left leading-tight">
                    <span className="block max-w-[140px] truncate text-[13px] font-semibold">
                      {displayName}
                    </span>
                    <span className="block text-xs text-muted-foreground">{roleLabel}</span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <p className="truncate text-sm font-medium">{displayName}</p>
                  <p className="truncate text-xs font-normal text-muted-foreground">
                    {profile?.email}
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setProfileOpen(true)}>
                  <User className="mr-2 h-4 w-4" />
                  My Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPasswordOpen(true)}>
                  <KeyRound className="mr-2 h-4 w-4" />
                  Change Password
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      {/* pb-24 (mobile only) keeps trailing page content clear of the fixed
          68px bottom nav; md:py-8 restores symmetric padding where that nav
          doesn't render. */}
      <main className="mx-auto max-w-[1600px] px-4 pt-6 pb-24 md:px-8 md:py-8">{children}</main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card md:hidden"
      >
        {visibleMobileNav.map((n) => {
          const active = n.match.some((m) => isActive(pathname, m));
          return (
            <Link
              key={n.to}
              to={n.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-[68px] min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs",
                active ? "font-semibold text-primary" : "text-muted-foreground",
              )}
            >
              <n.icon className="h-[22px] w-[22px]" aria-hidden="true" />
              <span className="truncate">{n.label}</span>
            </Link>
          );
        })}
      </nav>

      <MyProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </div>
  );
}

function ThemeToggle() {
  return (
    <button
      type="button"
      onClick={() => document.documentElement.classList.toggle("dark")}
      className="grid h-11 w-11 place-items-center rounded-[10px] text-foreground transition-colors hover:bg-muted md:border md:border-border md:bg-card"
      aria-label="Toggle dark theme"
      title="Toggle dark theme"
    >
      <Moon className="h-5 w-5 md:h-[18px] md:w-[18px]" />
    </button>
  );
}

// Brand panel for the signed-out pages (/login, /reset-password): stacked on top on a phone, the
// left half of a split layout from md up.
export function AuthBrandPanel() {
  return (
    <div className="flex flex-col gap-5 bg-primary px-6 pb-8 pt-10 text-primary-foreground md:min-h-screen md:px-[72px] md:py-16">
      <div className="flex items-center gap-2.5 md:gap-3">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 place-items-center rounded-[11px] bg-primary-foreground text-[15px] font-bold text-primary md:h-11 md:w-11 md:rounded-xl md:text-base"
        >
          DS
        </span>
        <span className="text-[17px] font-bold md:text-lg">Delta Sweets</span>
      </div>
      <div className="flex max-w-[520px] flex-col gap-4 md:my-auto md:pb-16">
        <p className="text-[28px] font-bold leading-[1.15] md:text-[44px] md:leading-[1.1]">
          Production scorecard
        </p>
        <p className="hidden text-lg leading-normal text-primary-foreground/85 md:block">
          Daily output, time lost and machine faults for every line, in one place.
        </p>
      </div>
    </div>
  );
}

// Password field with a Show/Hide toggle. The toggle is a real 44px button
// inside the input's right padding.
export function PasswordInput({
  id,
  autoComplete,
  value,
  onChange,
}: {
  id: string;
  autoComplete: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[52px] rounded-xl pl-3.5 pr-16 text-[17px] md:h-12 md:rounded-[10px] md:text-base"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-controls={id}
        className="absolute right-1 top-1 h-11 rounded-lg px-3 text-[15px] font-semibold text-primary hover:bg-muted md:right-0.5 md:top-0.5 md:text-sm"
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}
