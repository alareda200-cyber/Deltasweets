// Search or jump (Ctrl K / ⌘K), from the Control Room design: every page the
// role may open, every line (its room or its Dashboard), and a few actions.
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Factory, LayoutDashboard, Moon, Plus, Sun } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { linesQuery } from "@/lib/queries";
import { useLook } from "@/lib/theme";
import { NAV_ITEMS } from "@/components/nav-items";

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [look, toggleLook] = useLook();
  const linesQ = useQuery({ ...linesQuery, enabled: open });
  const lines = (linesQ.data ?? []).filter((l) => l.is_active);
  const pages = NAV_ITEMS.filter((n) => can(role, n.permission));
  const canDash = can(role, "dashboard.view");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const go = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search a page, a line or an action…" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        <CommandGroup heading="Pages">
          {pages.map((p) => (
            <CommandItem
              key={p.to}
              value={`${p.label} page`}
              onSelect={() => go(() => navigate({ to: p.to }))}
            >
              <p.icon aria-hidden="true" />
              {p.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {canDash && lines.length > 0 && (
          <CommandGroup heading="Lines">
            {lines.map((l) => (
              <CommandItem
                key={`room-${l.id}`}
                value={`${l.name} line room`}
                onSelect={() =>
                  go(() => navigate({ to: "/plant/$lineId", params: { lineId: l.id } }))
                }
              >
                <Factory aria-hidden="true" />
                {l.name}
                <span className="ml-auto text-xs text-muted-foreground">line room</span>
              </CommandItem>
            ))}
            {lines.map((l) => (
              <CommandItem
                key={`dash-${l.id}`}
                value={`${l.name} dashboard`}
                onSelect={() => go(() => navigate({ to: "/", search: { line: l.id } }))}
              >
                <LayoutDashboard aria-hidden="true" />
                {l.name}
                <span className="ml-auto text-xs text-muted-foreground">Dashboard</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Actions">
          {can(role, "entry.create") && (
            <CommandItem value="new entry" onSelect={() => go(() => navigate({ to: "/entry" }))}>
              <Plus aria-hidden="true" />
              New daily entry
            </CommandItem>
          )}
          <CommandItem value="switch look day night theme" onSelect={() => go(toggleLook)}>
            {look === "night" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            Switch to {look === "night" ? "Day" : "Night"}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
