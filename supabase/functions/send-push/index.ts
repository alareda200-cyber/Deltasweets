// Supabase Edge Function: send-push
//
// Fans a web-push notification out to `push_subscriptions` rows. Called
// from the maintenance_events INSERT trigger (see migration
// 20260805121000_maintenance_events_push_trigger.sql), and can also be
// invoked directly (e.g. from an admin tool) with a JSON body:
//   { title: string, body: string, url?: string, user_ids?: string[] }
//
// This function is NOT meant to be reachable from the browser: it can
// message any user, so `verify_jwt = false` in config.toml plus the
// shared-secret check below (rather than a per-user JWT) is what gates
// access — only the DB trigger (and anyone holding PUSH_FUNCTION_SECRET)
// can call it.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

interface SendPushRequest {
  title: string;
  body: string;
  url?: string;
  user_ids?: string[];
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-function-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const functionSecret = Deno.env.get("PUSH_FUNCTION_SECRET");
  if (!functionSecret || req.headers.get("x-function-secret") !== functionSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload: SendPushRequest;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!payload.title || !payload.body) {
    return new Response(JSON.stringify({ error: "title and body are required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidEmail = Deno.env.get("VAPID_EMAIL");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!vapidPublicKey || !vapidPrivateKey || !vapidEmail || !supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Missing server configuration" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let query = supabase.from("push_subscriptions").select("id, subscription");
  if (payload.user_ids && payload.user_ids.length > 0) {
    query = query.in("user_id", payload.user_ids);
  }
  const { data: rows, error } = await query;

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const notificationPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/maintenance",
  });

  let sent = 0;
  let failed = 0;
  const staleIds: string[] = [];

  await Promise.all(
    (rows ?? []).map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, notificationPayload);
        sent++;
      } catch (err) {
        failed++;
        // 404/410 mean the browser dropped the subscription (uninstalled,
        // permission revoked, storage cleared) — clean it up so future
        // sends don't keep failing against it.
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          staleIds.push(row.id);
        }
      }
    }),
  );

  if (staleIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
  }

  return new Response(JSON.stringify({ sent, failed, removed: staleIds.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
