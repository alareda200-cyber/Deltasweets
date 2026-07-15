import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { isAuthError } from "@/lib/supabase-errors";
import { handleAuthFailure } from "@/lib/auth-error-handler";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // 401/403/expired-JWT means the session is dead — retrying the same
        // request can't fix that. Retrying it anyway (default: 3x with
        // backoff, per query) is what turned one dead session into a
        // 500+ request storm against Supabase and a 429 on token refresh.
        // Non-auth failures (network blips, etc.) still get a couple of
        // retries.
        retry: (failureCount, error) => {
          if (isAuthError(error)) return false;
          return failureCount < 2;
        },
        // Reference/dashboard data doesn't need to be refetched on every
        // tab focus — this alone multiplies request volume across every
        // mounted query each time focus fires (including spurious
        // focus/blur churn from injected third-party scripts).
        refetchOnWindowFocus: false,
        staleTime: 60_000,
      },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        if (isAuthError(error)) void handleAuthFailure();
      },
    }),
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
