import { ALL_ROLES, ROLE_LABELS } from "@/lib/permissions";
import { roleMatrix } from "@/lib/users-format";

// Column heads are abbreviated to fit the aside; screen readers get the full name.
const SHORT: Record<string, string> = { production: "Prod.", maintenance: "Maint." };

/** "What each role can do" — every mark comes from can() in permissions.ts. */
export function RoleMatrix() {
  const rows = roleMatrix();
  return (
    <section
      aria-labelledby="role-matrix-title"
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:p-5"
    >
      <h2 id="role-matrix-title" className="text-base font-semibold">
        What each role can do
      </h2>
      <table className="w-full border-collapse text-xs md:text-[13px]">
        <thead>
          <tr>
            <th scope="col" className="px-1 py-1.5 text-left">
              <span className="sr-only">Permission</span>
            </th>
            {ALL_ROLES.map((r) => (
              <th
                key={r}
                scope="col"
                className="px-0.5 py-1.5 text-center font-semibold text-muted-foreground"
              >
                {SHORT[r] ? (
                  <>
                    <span aria-hidden="true">{SHORT[r]}</span>
                    <span className="sr-only">{ROLE_LABELS[r]}</span>
                  </>
                ) : (
                  ROLE_LABELS[r]
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.permission} className="border-t border-border/60">
              <th scope="row" className="px-1 py-2 text-left font-normal">
                {row.label}
              </th>
              {row.cells.map((c) => (
                <td
                  key={c.role}
                  className={
                    c.allowed
                      ? "px-0.5 py-2 text-center font-bold text-success-strong"
                      : "px-0.5 py-2 text-center font-bold text-muted-foreground"
                  }
                >
                  <span aria-hidden="true">{c.allowed ? "✓" : "–"}</span>
                  <span className="sr-only">{c.allowed ? "can" : "cannot"}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">
        ✓ can · – cannot. Taken from the app's permission list.
      </p>
    </section>
  );
}
