import { toast } from "sonner";
import { clearLocalSupabaseSession, forceReauth } from "@/lib/auth-error-handler";

const BREAKER_DURATION_MS = 30_000;

let breakerOpenUntil = 0;
let installed = false;

function supabaseOrigin(): string {
  const url = import.meta.env.VITE_SUPABASE_URL || "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

// supabase-js's own retry/cooldown logic (auth-js's `_callRefreshToken`)
// only covers a single client instance's refresh_token calls. It does
// nothing for: multiple tabs each running an independent GoTrueClient
// against the same rate-limited project, or a 429 on the *logout* endpoint
// itself (see forceReauth's doc — that one actually leaves the dead
// session in place instead of clearing it). This wraps the one thing every
// Supabase call funnels through — global fetch — to add a client-side
// circuit breaker that's independent of any single auth-js instance's state.
//
// Installed once, at module scope, from auth-context.tsx — before
// AuthProvider's effect makes its first `supabase.auth.*` call — so no
// Supabase request in the app can bypass it. client.ts's own fetch override
// (createSupabaseFetch) just adjusts headers and delegates to the global
// `fetch` identifier, so patching that identifier here is picked up by it
// without touching the generated file.
export function installAuthCircuitBreaker() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);
  const origin = supabaseOrigin();

  window.fetch = async (input, init) => {
    const url = requestUrl(input);
    const isSupabaseCall = origin !== "" && url.startsWith(origin);

    if (isSupabaseCall && Date.now() < breakerOpenUntil) {
      // Circuit open: fail locally instead of adding one more request to an
      // endpoint that's already telling us to back off.
      return new Response(
        JSON.stringify({ message: "Client-side circuit breaker open after repeated 429s" }),
        { status: 429, statusText: "Too Many Requests (client circuit breaker)" },
      );
    }

    const response = await nativeFetch(input, init);

    if (isSupabaseCall && response.status === 429) {
      breakerOpenUntil = Date.now() + BREAKER_DURATION_MS;

      const isAuthTokenCall = url.includes("/auth/v1/token") || url.includes("/auth/v1/logout");
      if (isAuthTokenCall) {
        // The very first 429 on the refresh or logout endpoint means this
        // session is dead and supabase-js cannot be trusted to clear it
        // itself (logout's own revoke call can hit the same 429 and bail
        // out before clearing anything — see forceReauth). Act immediately
        // rather than waiting for a downstream query to also fail.
        clearLocalSupabaseSession();
        toast.error("انتهت الجلسة، سجل دخول من جديد");
        forceReauth();
      }
    }

    return response;
  };
}
