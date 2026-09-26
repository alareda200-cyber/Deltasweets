import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { DtRow } from "@/lib/entry-form";

// Planned is the scheduled kind (CIP, change-overs); anything else named in
// Settings gets a neutral tag.
function typeTagClass(name: string) {
  const n = name.trim().toLowerCase();
  if (n === "planned") return "bg-primary/10 text-primary";
  if (n === "unplanned") return "bg-warning/15 text-warning-strong";
  return "bg-muted text-muted-foreground";
}

// md and up: Reason / Area / Minutes / remove. Shared with the column
// headings in entry.tsx so they line up with the rows.
export const DOWNTIME_GRID_COLS =
  "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem_2.75rem] lg:grid-cols-[minmax(0,1fr)_15rem_7.5rem_2.75rem]";

// One downtime line. Phone: a compact card, reason on top, then area,
// minutes and remove. md and up: one row of the Reason / Area / Minutes grid.
export function DowntimeRowEditor({
  index,
  row,
  reasons,
  areaNames,
  typeName,
  error,
  shakeKey = 0,
  className,
  disabled,
  onReasonChange,
  onAreaChange,
  onMinutesChange,
  onRemove,
}: {
  index: number;
  row: DtRow;
  reasons: { id: string; name: string }[];
  areaNames: string[];
  typeName: string | null;
  error?: string;
  /** Changes each time Save finds this row wrong: the row shakes once. */
  shakeKey?: number;
  className?: string;
  disabled: boolean;
  onReasonChange: (reasonId: string) => void;
  onAreaChange: (area: string) => void;
  onMinutesChange: (minutes: number) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  const errId = `downtime-${n}-err`;
  // A saved row can point at a reason that has since been deactivated, or
  // name an area typed before areas were a list. Keep those as options so
  // opening and saving the entry never changes them behind the user's back.
  const reasonOffList = !!row.reason_id && !reasons.some((r) => r.id === row.reason_id);
  const areaOffList = !!row.area && !areaNames.includes(row.area);

  return (
    <div
      className={cn(
        "rounded-lg border border-border p-2.5 md:rounded-none md:border-0 md:p-0",
        className,
      )}
    >
      <div
        key={shakeKey}
        className={cn(
          "grid grid-cols-[minmax(0,1fr)_5.5rem_2.75rem] items-center gap-2 md:gap-3",
          DOWNTIME_GRID_COLS,
          shakeKey > 0 && "ds-shake",
        )}
      >
        <Select value={row.reason_id} onValueChange={onReasonChange} disabled={disabled}>
          <SelectTrigger
            aria-label={`Downtime ${n} reason`}
            aria-describedby={error ? errId : undefined}
            className="col-span-3 h-11 gap-2 md:col-span-1"
          >
            <span className="min-w-0 flex-1 truncate text-left">
              <SelectValue placeholder={row.reason_name || "Pick reason"} />
            </span>
            {typeName && (
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                  typeTagClass(typeName),
                )}
              >
                {typeName}
              </span>
            )}
          </SelectTrigger>
          <SelectContent>
            {reasonOffList && (
              <SelectItem value={row.reason_id}>{row.reason_name || "Removed reason"}</SelectItem>
            )}
            {reasons.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={row.area} onValueChange={onAreaChange} disabled={disabled}>
          <SelectTrigger aria-label={`Downtime ${n} area`} className="h-11">
            <SelectValue placeholder="Area" />
          </SelectTrigger>
          <SelectContent>
            {areaOffList && <SelectItem value={row.area}>{row.area}</SelectItem>}
            {areaNames.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          inputMode="numeric"
          placeholder="Min"
          aria-label={`Downtime ${n} minutes`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          className="h-11 tabular-nums"
          value={row.minutes || ""}
          onChange={(e) => onMinutesChange(Number(e.target.value))}
          disabled={disabled}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11 text-muted-foreground hover:text-destructive"
          aria-label={`Remove downtime ${n}`}
          onClick={onRemove}
          disabled={disabled}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {error && (
        <p
          id={errId}
          role="alert"
          className="ds-slide-in mt-1.5 text-xs font-medium text-destructive-strong"
        >
          {error}
        </p>
      )}
    </div>
  );
}
