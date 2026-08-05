import type { MaintenanceType, MaintenanceStatus, MaintenanceMetric } from "@/lib/queries";

// Shared between src/routes/maintenance.tsx and
// src/components/MaintenanceDowntimeCard.tsx (Dashboard's "Open Maintenance
// Events" list) — both render the same event rows and must stay visually
// consistent, so labels/formatting live here once instead of twice.

export const TYPE_LABELS: Record<MaintenanceType, string> = { mechanical: "Mechanical", electrical: "Electrical" };
export const STATUS_LABELS: Record<MaintenanceStatus, string> = { open: "Open", in_progress: "In Progress", resolved: "Resolved" };

export function typeBadgeVariant(t: MaintenanceType) {
  return t === "mechanical" ? "secondary" : "outline";
}

export function statusBadgeVariant(s: MaintenanceStatus): "default" | "secondary" | "destructive" | "outline" {
  if (s === "open") return "destructive";
  if (s === "in_progress") return "secondary";
  return "default";
}

// Fixed choices for maintenance_events.severity_label — a plain text
// column (see 20260804220000_maintenance_events_severity.sql), but the
// create/edit UI constrains input to this list via a Select rather than
// letting it be arbitrary free text, so every event's severity reads the
// same regardless of who logged it.
export const SEVERITY_LABEL_OPTIONS = ["Critical", "Major", "Minor", "Low"] as const;

// Matches by name (Critical/Major/Minor/Low) rather than an id — works the
// same whether the name came from severity_levels (real entry_downtimes
// rows) or maintenance_events.severity_label (free text, constrained to
// SEVERITY_LABEL_OPTIONS by the UI). Unrecognized/missing name (including
// "Unclassified") gets the same neutral treatment as no severity at all.
export function severityBadgeVariant(name: string | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  const n = (name ?? "").trim().toLowerCase();
  if (n === "critical") return "destructive";
  if (n === "major") return "secondary";
  if (n === "minor") return "outline";
  if (n === "low") return "outline";
  return "outline";
}

// Worst (lowest) MTBF first — that's the line+type failing most often, the
// thing an engineer scanning this table actually wants to spot first rather
// than comparing every row by eye against an alphabetical line-name order.
// A null MTBF (fewer than 2 events, so no gap can be computed yet) isn't
// "good" or "bad", just unknown — sorted after every real number. Shared
// between the live /maintenance page's table and the PDF report so both
// present the same ordering.
export function sortByWorstMtbf(metrics: MaintenanceMetric[]): MaintenanceMetric[] {
  return [...metrics].sort((a, b) => {
    if (a.mtbf_hours === null && b.mtbf_hours === null) return 0;
    if (a.mtbf_hours === null) return 1;
    if (b.mtbf_hours === null) return -1;
    return a.mtbf_hours - b.mtbf_hours;
  });
}

export function formatHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export function formatDuration(ms: number): string {
  if (ms < 0) return "—";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

// datetime-local inputs need "YYYY-MM-DDTHH:mm" in the browser's local time
// (no timezone suffix) — building it from getters instead of toISOString()
// avoids a UTC round-trip that would shift the displayed/edited time.
export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
