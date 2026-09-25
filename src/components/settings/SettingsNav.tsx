import { useId } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpRight, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { DESKTOP_GROUPS, MOBILE_GROUPS, SECTION_META, type SectionId } from "./sections";

export type NavKey = SectionId | "users";

export interface NavSummary {
  count?: string;
  // One-line context under the name in the mobile list.
  sub?: string;
}

const USERS_META = {
  title: "Users",
  keywords: "users people accounts roles sign in login admin",
};

function titleOf(key: NavKey) {
  return key === "users" ? USERS_META.title : SECTION_META[key].title;
}

function matches(key: NavKey, needle: string) {
  if (!needle) return true;
  const hay =
    key === "users"
      ? `${USERS_META.title} ${USERS_META.keywords}`
      : `${SECTION_META[key].title} ${SECTION_META[key].group} ${SECTION_META[key].keywords}`;
  return hay.toLowerCase().includes(needle);
}

function useFiltered<G extends { items: NavKey[] }>(groups: G[], find: string) {
  const needle = find.trim().toLowerCase();
  return groups
    .map((g) => ({ ...g, items: g.items.filter((k) => matches(k, needle)) }))
    .filter((g) => g.items.length > 0);
}

function FindBox({
  find,
  onFind,
  className,
}: {
  find: string;
  onFind: (v: string) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div>
      <Label htmlFor={id} className="sr-only">
        Find a setting
      </Label>
      <Input
        id={id}
        type="search"
        placeholder="Find a setting"
        value={find}
        onChange={(e) => onFind(e.target.value)}
        className={cn("h-11 bg-card", className)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop (md+): ~280px sidebar, one section active at a time.
// ---------------------------------------------------------------------------
export function SettingsSidebar({
  active,
  summaries,
  find,
  onFind,
}: {
  active: SectionId;
  summaries: Record<NavKey, NavSummary>;
  find: string;
  onFind: (v: string) => void;
}) {
  const groups = useFiltered(DESKTOP_GROUPS, find);
  return (
    <nav
      aria-label="Settings"
      className="flex flex-col gap-4 rounded-xl border border-border bg-card px-4 py-5"
    >
      <FindBox find={find} onFind={onFind} />
      {groups.map((g) => (
        <div key={g.title} className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {g.title}
          </p>
          {g.items.map((key) => {
            const s = summaries[key];
            const careful = key !== "users" && SECTION_META[key].careful;
            const isActive = key === active;
            const cls = cn(
              "flex min-h-10 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
              isActive
                ? "bg-primary/10 font-semibold text-primary"
                : "text-foreground hover:bg-muted",
            );
            const inner = (
              <>
                <span className="min-w-0 flex-1">
                  {titleOf(key)}
                  {key === "users" && (
                    <ArrowUpRight
                      className="ml-0.5 inline h-3.5 w-3.5 align-[-2px]"
                      aria-hidden="true"
                    />
                  )}
                </span>
                {careful && (
                  <>
                    <AlertTriangle
                      className="h-3.5 w-3.5 shrink-0 text-warning-strong"
                      aria-hidden="true"
                    />
                    <span className="sr-only">(careful: rewrites history)</span>
                  </>
                )}
                {s?.count && (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {s.count}
                  </span>
                )}
              </>
            );
            return key === "users" ? (
              <Link key={key} to="/users" className={cls}>
                {inner}
                <span className="sr-only">(opens the Users page)</span>
              </Link>
            ) : (
              <Link
                key={key}
                to="/settings"
                search={{ section: key }}
                aria-current={isActive ? "page" : undefined}
                className={cls}
              >
                {inner}
              </Link>
            );
          })}
        </div>
      ))}
      {groups.length === 0 && (
        <p className="px-2.5 text-sm text-muted-foreground">No setting matches “{find.trim()}”.</p>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Mobile (below md): grouped list — rows ≥52px — that opens one section.
// ---------------------------------------------------------------------------
export function SettingsMobileList({
  summaries,
  find,
  onFind,
}: {
  summaries: Record<NavKey, NavSummary>;
  find: string;
  onFind: (v: string) => void;
}) {
  const groups = useFiltered(MOBILE_GROUPS, find);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Production setup, maintenance lists, area owners and system options. Users have their own
          page.
        </p>
      </div>
      <FindBox find={find} onFind={onFind} className="h-12 text-base" />
      {groups.map((g) => (
        <section key={g.title} className="space-y-1.5">
          <h2
            className={cn(
              "px-1 text-xs font-semibold uppercase tracking-wider",
              g.careful ? "text-destructive-strong" : "text-muted-foreground",
            )}
          >
            {g.title}
          </h2>
          <div
            className={cn(
              "overflow-hidden rounded-xl border bg-card",
              g.careful ? "border-destructive/30" : "border-border",
            )}
          >
            {g.items.map((key, i) => {
              const s = summaries[key];
              const cls = cn(
                "flex min-h-[52px] items-center gap-2.5 px-3.5 py-2 text-left",
                i > 0 && "border-t border-border/60",
              );
              const inner = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px]">
                      {titleOf(key)}
                      {key === "users" && (
                        <ArrowUpRight
                          className="ml-0.5 inline h-3.5 w-3.5 align-[-2px] text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    {s?.sub && <span className="block text-xs text-muted-foreground">{s.sub}</span>}
                  </span>
                  {s?.count && key !== "reliability" && (
                    <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                      {s.count}
                    </span>
                  )}
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </>
              );
              return key === "users" ? (
                <Link key={key} to="/users" className={cls}>
                  {inner}
                </Link>
              ) : (
                <Link key={key} to="/settings" search={{ section: key }} className={cls}>
                  {inner}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">No setting matches “{find.trim()}”.</p>
      )}
    </div>
  );
}
