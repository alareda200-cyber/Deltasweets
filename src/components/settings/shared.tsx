import { useEffect, useId, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, Lock, type LucideIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SECTION_META, type SectionId } from "./sections";

export type QC = ReturnType<typeof useQueryClient>;

// Shared validation for every master-data add-form (Lines, Areas, Owners, Reasons,
// Departments, Downtime Types, Severity Levels). New records require both a name
// and a business code; codes are normalized so ERP exports/reporting never see
// inconsistent casing or stray whitespace.
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function validateMasterDataInput(name: string, code: string): string | null {
  if (!name.trim()) return "Name is required";
  if (!code.trim()) return "Code is required";
  return null;
}

export function nameOf(list: { id: string; name: string }[], id: string | null) {
  return id ? list.find((x) => x.id === id)?.name : undefined;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Locked names. Code looks these rows up BY NAME (case-insensitive), so a
// rename silently breaks a metric and a delete makes it read "Unclassified":
//  - departments: maintenanceEventsAsDowntimes in src/lib/queries.ts
//  - downtime types: same function (Planned / Unplanned)
//  - severity "Critical": MaintenanceDowntimeCard's Critical minutes
//  - category "Maintenance": MaintenanceDowntimeCard's default categoryName
// The name field is disabled when editing one, and delete is not offered.
// ---------------------------------------------------------------------------
export const LOCKED_NAMES = {
  departments: [
    "mechanical maintenance",
    "electrical maintenance",
    "preventive maintenance",
    "refrigeration maintenance",
  ],
  types: ["planned", "unplanned"],
  severity: ["critical"],
  categories: ["maintenance"],
} as const;

export function isLockedName(list: readonly string[], name: string) {
  return list.includes(name.trim().toLowerCase());
}

export function LockedTag() {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
      <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      Used in calculations
    </span>
  );
}

// ---------------------------------------------------------------------------
// Section header: group eyebrow, title (the page's h1), one-line description
// and count — plus, below md, a back link to the grouped list.
// ---------------------------------------------------------------------------
export function SectionHeader({
  id,
  count,
  description,
  action,
}: {
  id: SectionId;
  count?: number | string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  const meta = SECTION_META[id];
  return (
    <div>
      <Link
        to="/settings"
        search={{}}
        className="-ml-2 mb-1 inline-flex h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary md:hidden"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        All settings
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {meta.group}
            {meta.careful && <CarefulTag />}
          </p>
          <h1 className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-bold tracking-tight md:text-3xl">
            {meta.title}
            {count !== undefined && count !== "" && (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-sm font-semibold tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{description ?? meta.description}</p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

export function CarefulTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-strong">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      Careful — rewrites history
    </span>
  );
}

export function WarningNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-strong",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

// Icon-only button: always a real <button> with an aria-label, 44px on
// mobile, 36px from md: up.
export function IconButton({
  icon: Icon,
  label,
  onClick,
  tone = "default",
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tone?: "default" | "destructive";
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-11 w-11 text-muted-foreground md:h-9 md:w-9",
        tone === "destructive" ? "hover:text-destructive-strong" : "hover:text-primary",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

export function CodeChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
      {children}
    </span>
  );
}

export function InactiveChip() {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Inactive</span>
  );
}

// A labelled text input for the inline add/edit forms.
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  hint,
  className,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  hint?: ReactNode;
  className?: string;
  type?: string;
}) {
  const id = useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 md:h-9"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// Same look as the list rows every master-data section uses.
export function ListRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog used for every delete and every history rewrite on this
// page. Names the item in the title; optional typed-name guard. The confirm
// button stays enabled only once `confirmText` (if given) is typed exactly,
// and the dialog stays open while `onConfirm` runs.
// ---------------------------------------------------------------------------
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  destructive = true,
  confirmText,
  disabled,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  confirmText?: string;
  disabled?: boolean;
  onConfirm: () => Promise<boolean | void> | boolean | void;
  children?: ReactNode;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const typedOk = !confirmText || typed.trim() === confirmText.trim();

  async function run() {
    setBusy(true);
    try {
      const result = await onConfirm();
      if (result !== false) onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-left">{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-left text-sm text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {confirmText && (
          <div className="space-y-1.5">
            <Label htmlFor={inputId}>
              Type <span className="font-semibold">{confirmText}</span> to confirm
            </Label>
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="h-11 md:h-9"
            />
          </div>
        )}
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="mt-0 h-11 md:h-9" disabled={busy}>
            Cancel
          </AlertDialogCancel>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            className="h-11 md:h-9"
            disabled={busy || disabled || !typedOk}
            onClick={run}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
