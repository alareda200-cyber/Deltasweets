import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  fullName,
  lastSeenLabel,
  roleLabel,
  userInitials,
  type UserLike,
} from "@/lib/users-format";
import { RoleBadge } from "./RoleBadge";

export interface UserListRow extends UserLike {
  avatar_color?: string | null;
}

function UserAvatar({ user, size }: { user: UserListRow; size: "sm" | "lg" }) {
  // avatar_color is the person's own colour from their profile (data, not a
  // design token); without one the primary colour is used.
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-bold text-primary-foreground",
        !user.avatar_color && "bg-primary",
        size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm",
      )}
      style={user.avatar_color ? { backgroundColor: user.avatar_color } : undefined}
    >
      {userInitials(user)}
    </span>
  );
}

export function UserList({
  users,
  isLoading,
  onEdit,
  renderMore,
}: {
  users: UserListRow[];
  isLoading: boolean;
  onEdit: (u: UserListRow) => void;
  /** Extra per-row actions (only passed when the server actions exist). */
  renderMore?: (u: UserListRow) => ReactNode;
}) {
  const now = new Date();
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading users">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (users.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
        <Inbox className="mx-auto h-6 w-6" aria-hidden="true" />
        <p className="mt-2">No one matches this search and role.</p>
      </div>
    );
  }
  return (
    <>
      {/* Mobile: one button per person. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {users.map((u) => {
          const seen = lastSeenLabel(u, now);
          const dep = u.departments?.name;
          return (
            <li key={u.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onEdit(u)}
                aria-label={`Edit ${fullName(u)}, ${roleLabel(u.role)}`}
                className="flex min-h-[68px] min-w-0 flex-1 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <UserAvatar user={u} size="lg" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{fullName(u)}</span>
                  <span
                    className={cn(
                      "block text-[13px]",
                      dep ? "text-muted-foreground" : "text-warning-strong",
                    )}
                  >
                    {dep ?? "No department"} ·{" "}
                    {seen
                      ? `seen ${seen === "Today" || seen === "Yesterday" ? seen.toLowerCase() : seen}`
                      : "no sign-in on record"}
                  </span>
                </span>
                <RoleBadge role={u.role} />
              </button>
              {renderMore?.(u)}
            </li>
          );
        })}
      </ul>

      {/* Desktop: table. */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted text-left">
              <th scope="col" className="px-4 py-3 text-[13px] font-semibold text-muted-foreground">
                Name
              </th>
              <th scope="col" className="px-4 py-3 text-[13px] font-semibold text-muted-foreground">
                Role
              </th>
              <th scope="col" className="px-4 py-3 text-[13px] font-semibold text-muted-foreground">
                Department
              </th>
              <th scope="col" className="px-4 py-3 text-[13px] font-semibold text-muted-foreground">
                Last seen
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const seen = lastSeenLabel(u, now);
              const dep = u.departments?.name;
              return (
                <tr key={u.id} className="border-t border-border/60">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2.5">
                      <UserAvatar user={u} size="sm" />
                      <span className="font-semibold">{fullName(u)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <RoleBadge role={u.role} />
                  </td>
                  <td className={cn("px-4 py-2", !dep && "text-warning-strong")}>
                    {dep ?? "No department"}
                  </td>
                  <td className={cn("px-4 py-2", !seen && "text-muted-foreground")}>
                    {seen ?? "No sign-in on record"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 px-3.5"
                        aria-label={`Edit ${fullName(u)}`}
                        onClick={() => onEdit(u)}
                      >
                        Edit
                      </Button>
                      {renderMore?.(u)}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
