// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
//
// DEPLOYMENT TARGET: Firebase Hosting ONLY (static files, no server runtime).
// TanStack Start's built-in SPA mode prerenders a static HTML shell; all
// routing, data fetching (Supabase client), and rendering then happen
// entirely in the browser — no Node server, no Cloud Run, no billing
// account required. This is the tradeoff explicitly accepted: features
// that depend on real server execution (User Management's admin
// operations, and the Audit Log's server-captured IP/User-Agent) cannot
// run without a server and are now disabled in the UI rather than left to
// fail silently — see the banners added in users.tsx and settings.tsx.
// DEPLOYMENT TARGET: Firebase Hosting ONLY (static files, no server runtime).
//
// TanStack Start's built-in `spa.enabled` prerender feature is NOT used here
// — confirmed through direct testing that it hard-codes a "dist/server/
// server.js" module path incompatible with this project's Nitro-based
// build (which outputs to .output/, via @lovable.dev/vite-tanstack-config).
// Three different spa/prerender config permutations all hit the identical
// ERR_MODULE_NOT_FOUND on that hardcoded path — a real tooling
// incompatibility, not a config mistake.
//
// Instead: build with the "node" preset (already proven to work end-to-end
// this session), then generate the static index.html shell by actually
// running that working server once and capturing its real HTML output —
// see scripts/generate-static-shell.md for the exact steps. The resulting
// .output/public/ folder (real static assets + one real HTML shell) is
// then served entirely by Firebase Hosting with a classic SPA rewrite
// (every path → index.html), with zero server needed at runtime.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    // @ts-expect-error - nitro option is injected by the base config's own
    // plugin at a different type layer than defineConfig's public surface.
    nitro: { preset: "node" },
  },
});
