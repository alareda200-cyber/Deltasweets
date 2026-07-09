import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function parseDevice(userAgent: string): { browser: string; device: string } {
  const ua = userAgent || "";
  let browser = "Unknown";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua) && !/OPR|Brave/.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = "Safari";
  else if (/OPR\//.test(ua)) browser = "Opera";

  let device = "Desktop";
  if (/iPhone/.test(ua)) device = "iPhone";
  else if (/iPad/.test(ua)) device = "iPad";
  else if (/Android/.test(ua)) device = /Mobile/.test(ua) ? "Android Phone" : "Android Tablet";
  else if (/Macintosh/.test(ua)) device = "Mac";
  else if (/Windows/.test(ua)) device = "Windows PC";
  else if (/Linux/.test(ua)) device = "Linux";

  return { browser, device };
}

export const logAuditEventFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { action: string; entityType?: string; entityId?: string; details?: Record<string, unknown> }) => d)
  .handler(async ({ data, context }) => {
    const request = getRequest();
    const headers = request?.headers;
    const ip =
      headers?.get("cf-connecting-ip") ||
      headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      headers?.get("x-real-ip") ||
      null;
    const userAgent = headers?.get("user-agent") || "";
    const { browser, device } = parseDevice(userAgent);

    const { data: caller } = await context.supabase
      .from("profiles").select("email, role").eq("id", context.userId).maybeSingle();

    await context.supabase.from("audit_logs").insert({
      user_id: context.userId,
      user_email: caller?.email ?? null,
      role: caller?.role ?? null,
      action: data.action,
      entity_type: data.entityType ?? null,
      entity_id: data.entityId ?? null,
      details: { ...(data.details ?? {}), browser, device },
      ip_address: ip,
      user_agent: userAgent,
    });

    return { ok: true };
  });
