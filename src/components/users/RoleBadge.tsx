import { cn } from "@/lib/utils";
import { roleLabel } from "@/lib/users-format";

const TONE: Record<string, string> = {
  admin: "bg-primary/10 text-primary",
  production: "bg-success/15 text-success-strong",
  maintenance: "bg-warning/15 text-warning-strong",
  quality: "bg-accent/15 text-foreground",
  viewer: "bg-muted text-muted-foreground",
};

/** Pill with the role's name. `role` may be a role the app doesn't know. */
export function RoleBadge({ role, className }: { role: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        TONE[role] ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      {roleLabel(role)}
    </span>
  );
}
