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

export function isRateLimitedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as ErrorLike;
  const msg = (e.message ?? "").toLowerCase();
  return e.status === 429 || msg.includes("too many requests");
}
