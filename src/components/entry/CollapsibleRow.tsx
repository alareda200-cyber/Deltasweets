import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// A collapsed-by-default block of the Daily Entry form (Rework on a phone,
// Area owners, Notes): a title, a one-line summary of what is inside, and a
// chevron. Plain useState in the parent, no Radix machinery.
//
// The toggle sits OUTSIDE the content's fieldset, so a read-only entry can
// still be opened and read; `contentDisabled` locks only the fields inside.
export function CollapsibleRow({
  title,
  summary,
  open,
  onToggle,
  contentDisabled,
  className,
  style,
  children,
}: {
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  contentDisabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const contentId = useId();
  return (
    <div className={cn("rounded-xl border border-border bg-card", className)} style={style}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex min-h-[60px] w-full cursor-pointer items-center gap-3 rounded-xl px-4 py-2.5 text-left md:min-h-16 md:px-5"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">{title}</span>
          {summary && (
            <span className="block truncate text-sm text-muted-foreground">{summary}</span>
          )}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-5 w-5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <fieldset
          id={contentId}
          disabled={contentDisabled}
          className="m-0 min-w-0 border-x-0 border-t border-b-0 border-border p-4 md:px-5"
          style={contentDisabled ? { opacity: 0.75 } : undefined}
        >
          {children}
        </fieldset>
      )}
    </div>
  );
}
