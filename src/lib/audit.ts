import { logAuditEventFn } from "@/lib/audit.server";

export async function logAudit(action: string, entityType?: string, entityId?: string, details?: Record<string, unknown>) {
  try {
    await logAuditEventFn({ data: { action, entityType, entityId, details } });
  } catch (err) {
    // Audit logging must never block or break the action it's recording.
    console.error("Audit log failed:", err);
  }
}
