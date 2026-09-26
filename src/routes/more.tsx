import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { ChevronRight, KeyRound } from "lucide-react";
import { AppShell, useProfileIdentity } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { MyProfileDialog } from "@/components/MyProfileDialog";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { requireSession } from "@/lib/require-session";
import {
  appSettingsQuery,
  productionTargetsQuery,
  DEFAULT_TARGETS,
  areaOwnersQuery,
  departmentsQuery,
  downtimeTypesQuery,
  linesQuery,
  productionAreasQuery,
  reasonsQuery,
  rootCausesQuery,
  severityLevelsQuery,
  techniciansQuery,
} from "@/lib/queries";

export const Route = createFileRoute("/more")({
  head: () => ({ meta: [{ title: "More · Production Scorecard" }] }),
  beforeLoad: requireSession,
  component: () => (
    <RequireAuth>
      <MorePage />
    </RequireAuth>
  ),
});

// Section ids are the shared contract with /settings?section=<id>.
type SettingsSection =
  | "lines"
  | "areas"
  | "reasons"
  | "fields"
  | "targets"
  | "technicians"
  | "departments"
  | "types"
  | "severity"
  | "rootCauses"
  | "areaOwners"
  | "faultTitles"
  | "backup"
  | "reliability";

type Item =
  | {
      kind: "route";
      key: string;
      name: string;
      sub?: string;
      to: "/users" | "/audit-log" | "/recap" | "/replay";
    }
  | { kind: "settings"; key: string; name: string; sub?: string; section: SettingsSection };

interface Group {
  title: string;
  danger?: boolean;
  items: Item[];
}

// "N active" — every count query below returns (or is filtered to) active
// rows only, so the label says so rather than implying a total.
function activeLabel(rows: { is_active: boolean }[] | undefined): string | undefined {
  if (!rows) return undefined;
  const n = rows.filter((r) => r.is_active).length;
  return `${n} active`;
}

function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function MorePage() {
  const navigate = useNavigate();
  const { role, profile, signOut } = useAuth();
  const { initials, displayName, avatarColor, roleLabel } = useProfileIdentity();
  const canUsers = can(role, "users.manage");
  const canSettings = can(role, "settings.manage");
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const searchId = useId();

  const { data: departments } = useQuery(departmentsQuery);
  const departmentName = departments?.find((d) => d.id === profile?.department_id)?.name;

  // Counts: small lookup tables, fetched only for roles that see Settings.
  const { data: lines } = useQuery({ ...linesQuery, enabled: canSettings });
  const { data: areas } = useQuery({ ...productionAreasQuery, enabled: canSettings });
  const { data: reasons } = useQuery({ ...reasonsQuery, enabled: canSettings });
  const { data: technicians } = useQuery({ ...techniciansQuery, enabled: canSettings });
  const { data: types } = useQuery({ ...downtimeTypesQuery, enabled: canSettings });
  const { data: severity } = useQuery({ ...severityLevelsQuery, enabled: canSettings });
  const { data: rootCauses } = useQuery({ ...rootCausesQuery(), enabled: canSettings });
  const { data: areaOwners } = useQuery({ ...areaOwnersQuery, enabled: canSettings });
  const { data: appSettings } = useQuery({ ...appSettingsQuery(), enabled: canSettings });
  const { data: targets = DEFAULT_TARGETS } = useQuery({
    ...productionTargetsQuery(),
    enabled: canSettings,
  });

  const groups = useMemo<Group[]>(() => {
    const out: Group[] = [
      {
        title: "Stories",
        items: [
          {
            kind: "route",
            key: "recap",
            name: "Month recap",
            sub: "This month in 7 cards",
            to: "/recap",
          },
          {
            kind: "route",
            key: "replay",
            name: "Replay a day",
            sub: "Watch a line's day, faults and all",
            to: "/replay",
          },
        ],
      },
    ];
    if (canUsers) {
      out.push({
        title: "Admin",
        items: [
          { kind: "route", key: "users", name: "Users", sub: "Accounts and roles", to: "/users" },
          {
            kind: "route",
            key: "audit",
            name: "Audit log",
            sub: "Who changed what, and when",
            to: "/audit-log",
          },
        ],
      });
    }
    if (canSettings) {
      const reliabilitySub = appSettings
        ? appSettings.reliability_start_date
          ? `MTBF/MTTR count from ${formatDay(appSettings.reliability_start_date)}`
          : "Not set · MTBF/MTTR use all history"
        : undefined;
      out.push(
        {
          title: "Production setup",
          items: [
            {
              kind: "settings",
              key: "lines",
              name: "Production lines",
              sub: activeLabel(lines),
              section: "lines",
            },
            {
              kind: "settings",
              key: "areas",
              name: "Production areas",
              sub: activeLabel(areas),
              section: "areas",
            },
            {
              kind: "settings",
              key: "reasons",
              name: "Downtime reasons",
              sub: activeLabel(reasons),
              section: "reasons",
            },
            {
              kind: "settings",
              key: "fields",
              name: "Line fields",
              sub: "Extra fields per line",
              section: "fields",
            },
            {
              kind: "settings",
              key: "targets",
              name: "Targets",
              sub: `Making ${targets.makingPct}% · packing ${targets.packingPct}% · time lost ${targets.lossPct}%`,
              section: "targets",
            },
          ],
        },
        {
          title: "Maintenance lists",
          items: [
            {
              kind: "settings",
              key: "technicians",
              name: "Technicians",
              sub: activeLabel(technicians),
              section: "technicians",
            },
            {
              kind: "settings",
              key: "departments",
              name: "Departments",
              sub: activeLabel(departments),
              section: "departments",
            },
            {
              kind: "settings",
              key: "types",
              name: "Downtime types",
              sub: activeLabel(types),
              section: "types",
            },
            {
              kind: "settings",
              key: "severity",
              name: "Severity levels",
              sub: activeLabel(severity),
              section: "severity",
            },
            {
              kind: "settings",
              key: "rootCauses",
              name: "Root causes",
              sub: activeLabel(rootCauses),
              section: "rootCauses",
            },
          ],
        },
        {
          title: "People",
          items: [
            {
              kind: "settings",
              key: "areaOwners",
              name: "Area owners",
              sub: activeLabel(areaOwners),
              section: "areaOwners",
            },
          ],
        },
        {
          title: "Careful — changes history",
          danger: true,
          items: [
            {
              kind: "settings",
              key: "faultTitles",
              name: "Fault titles: rename or merge",
              sub: "Rewrites past maintenance events",
              section: "faultTitles",
            },
            {
              kind: "settings",
              key: "backup",
              name: "Restore from backup",
              sub: "Overwrites rows with the same id",
              section: "backup",
            },
            {
              kind: "settings",
              key: "reliability",
              name: "Reliability window",
              sub: reliabilitySub,
              section: "reliability",
            },
          ],
        },
      );
    }
    return out;
  }, [
    canUsers,
    canSettings,
    lines,
    areas,
    reasons,
    technicians,
    departments,
    types,
    severity,
    rootCauses,
    areaOwners,
    appSettings,
    targets,
  ]);

  const q = filter.trim().toLocaleLowerCase();
  const shownGroups = q
    ? groups
        .map((g) => ({
          ...g,
          items: g.items.filter((i) =>
            `${i.name} ${i.sub ?? ""} ${g.title}`.toLocaleLowerCase().includes(q),
          ),
        }))
        .filter((g) => g.items.length > 0)
    : groups;

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/login" });
  }

  const profileSub = [roleLabel, departmentName, "My profile"].filter(Boolean).join(" · ");

  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-[18px]">
        <h1 className="text-xl font-bold md:text-3xl">More</h1>

        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          className="flex min-h-16 items-center gap-3 rounded-[14px] border border-border bg-card px-3.5 py-3 text-left transition-colors hover:bg-muted"
        >
          <Avatar className="h-10 w-10" style={{ backgroundColor: avatarColor }}>
            <AvatarFallback
              style={{ backgroundColor: avatarColor, color: "white" }}
              className="text-[15px] font-bold"
            >
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold">{displayName}</span>
            <span className="block truncate text-[13px] text-muted-foreground">{profileSub}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>

        {groups.length > 0 && (
          <div>
            <label htmlFor={searchId} className="sr-only">
              Find a setting
            </label>
            <Input
              id={searchId}
              type="search"
              placeholder="Find a setting"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-12 rounded-xl text-base md:text-base"
            />
          </div>
        )}

        {shownGroups.map((g) => (
          <section key={g.title} className="flex flex-col gap-1.5">
            <h2
              className={cn(
                "px-1 text-xs font-semibold uppercase tracking-[0.06em]",
                g.danger ? "text-destructive-strong" : "text-muted-foreground",
              )}
            >
              {g.title}
            </h2>
            <div
              className={cn(
                "divide-y overflow-hidden rounded-[14px] border bg-card",
                g.danger
                  ? "divide-destructive/15 border-destructive/30"
                  : "divide-border/60 border-border",
              )}
            >
              {g.items.map((i) => (
                <ItemLink key={i.key} item={i} />
              ))}
            </div>
          </section>
        ))}

        {q && shownGroups.length === 0 && (
          <p className="px-1 text-sm text-muted-foreground">
            No setting matches “{filter.trim()}”.
          </p>
        )}

        <section className="flex flex-col gap-1.5">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Account
          </h2>
          <div className="overflow-hidden rounded-[14px] border border-border bg-card">
            <button
              type="button"
              onClick={() => setPasswordOpen(true)}
              className="flex min-h-[52px] w-full items-center gap-2.5 px-3.5 text-left transition-colors hover:bg-muted"
            >
              <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1 text-[15px]">Change password</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </div>
        </section>

        <button
          type="button"
          onClick={handleSignOut}
          className="h-12 rounded-xl border border-border bg-card text-[15px] font-semibold text-destructive-strong transition-colors hover:bg-destructive/5"
        >
          Sign out
        </button>
      </div>

      <MyProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </AppShell>
  );
}

function ItemLink({ item }: { item: Item }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">{item.name}</span>
        {item.sub && <span className="block text-xs text-muted-foreground">{item.sub}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    </>
  );
  const className =
    "flex min-h-[52px] items-center gap-2.5 px-3.5 py-2 text-foreground transition-colors hover:bg-muted";
  if (item.kind === "route") {
    return (
      <Link to={item.to} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <Link to="/settings" search={{ section: item.section }} className={className}>
      {body}
    </Link>
  );
}
