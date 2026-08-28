interface ErrorLike {
  code?: string;
  status?: number;
  message?: string;
}

// PostgrestError (thrown by every `queries.ts` fetcher on `if (error) throw
// error`) carries {code, message} but no `status`. AuthApiError (thrown by
// supabase.auth.* calls) carries {status, message} but no PostgREST `code`.
// A 401/403, an expired/invalid JWT, or a rejected refresh token all mean
// the session itself is dead — retrying the same request won't fix it, only
// a fresh sign-in will.
export function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as ErrorLike;
  const msg = (e.message ?? "").toLowerCase();
  return (
    e.code === "PGRST301" ||
    e.status === 401 ||
    e.status === 403 ||
    msg.includes("jwt") ||
    msg.includes("refresh_token") ||
    msg.includes("refresh token")
  );
}

// The one JWT rejection that does NOT mean the session is dead. When the token
// is minted by the auth server and validated by PostgREST, a second or two of
// clock drift between those two clocks makes a brand-new token look like it was
// issued in the future — so it is rejected on arrival and then becomes valid on
// its own moments later, with no new sign-in and nothing for the user to fix.
//
// It surfaces on a cold open, because that is when supabase-js refreshes an
// expired token and immediately fires the route loader's queries at PostgREST:
// the smallest possible gap between minting and validating. A warm session
// never refreshes, which is why the error looks intermittent.
//
// isAuthError() still matches these (the message contains "jwt"), and that is
// deliberate: retries are attempted FIRST, and only if the token is still
// rejected after them does it fall through to the normal dead-session handling.
// Transient drift is ridden out; a genuinely broken token still ends at /login.
export function isClockSkewError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const msg = ((error as ErrorLike).message ?? "").toLowerCase();
  return (
    msg.includes("issued at future") ||
    msg.includes("used before issued") ||
    msg.includes("not yet valid") ||
    msg.includes("token used before")
  );
}

export function isRateLimitedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as ErrorLike;
  const msg = (e.message ?? "").toLowerCase();
  return e.status === 429 || msg.includes("too many requests");
}
