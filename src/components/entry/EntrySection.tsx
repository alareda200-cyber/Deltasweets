import { useId } from "react";
import { cn } from "@/lib/utils";

// One numbered block of the Daily Entry form ("1 · Output (kg)"). A real
// <section> named by its heading, so screen readers can jump between them.
export function EntrySection({
  title,
  unit,
  aside,
  className,
  style,
  children,
}: {
  title: string;
  unit?: string;
  aside?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:gap-3.5 md:px-5",
        className,
      )}
      style={style}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold md:text-lg">
          {title}
          {unit && <span className="font-normal text-muted-foreground"> ({unit})</span>}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
