# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Production Scorecard" — an enterprise plant performance dashboard (daily production entries, MTD analytics, downtime pareto) built with TanStack Start (React 19) + Supabase. Originated in Lovable (see `AGENTS.md`: this repo syncs back to the Lovable editor — never force-push or rewrite published history on the connected branch).

## Commands

```
npm run dev              # vite dev server
npm run build             # production build (Nitro, node preset)
npm run build:firebase    # build + generate the static SPA shell for Firebase Hosting (see Deployment)
npm run build:dev         # build in development mode
npm run lint               # eslint .
npm run format              # prettier --write .
npm run sim:kaspersky      # Playwright-driven diagnostic against a running dev server (see below)
```

There is no test suite configured in this repo. `@playwright/test` is a devDependency, but it's used only to drive `scripts/simulate-kaspersky-refresh.mjs` — a diagnostic that simulates Kaspersky-style SSL-inspection latency against `npm run dev` and counts Supabase token-refresh calls, for debugging auth refresh-loop issues. It's not a test runner and there are no `*.spec.ts` files.

Package manager: `bun.lock` is present and `bunfig.toml` configures a 24h supply-chain install guard (new package versions are blocked from install for 24h unless added to `minimumReleaseAgeExcludes`). Ask the user before adding an exclusion.

## Deployment architecture (read before touching vite.config.ts, server.ts, or start.ts)

This is the single most important — and non-obvious — thing about this repo, spelled out in comments across `vite.config.ts`, `scripts/generate-static-shell.mjs`, `src/routes/users.tsx`, and `src/routes/audit-log.tsx`:

- **Actual deployment target is Firebase Hosting, static files only — no server runtime.** TanStack Start builds a real Node server (Nitro `node` preset), but that server is only ever run *once at build time* by `scripts/generate-static-shell.mjs` to capture a real, working `index.html` shell (with correct content-hashed asset filenames and the required `window.$_TSR` hydration bootstrap) into `.output/public/`. That static folder is what actually gets deployed (`firebase deploy --only hosting`, per `firebase.json`, with a catch-all SPA rewrite to `index.html`). Always run `npm run build:firebase` (build + shell generation), not just `npm run build`, before a Firebase deploy.
- TanStack Start's own `spa.enabled` prerender mode was tried and does not work with this project's Nitro/`.output/` setup (hardcodes an incompatible server path) — that's why the custom shell-generation script exists instead. Don't try to "fix" this by re-enabling `spa.enabled`.
- Because there's no server at runtime, any feature that needs real server execution (service-role Supabase operations) **cannot work in production today** and is deliberately gated off with a `SERVER_ACTIONS_AVAILABLE = false` constant and a UI banner in `src/routes/users.tsx` and `src/routes/audit-log.tsx`, even though the underlying `*.server.ts` functions exist and are wired up. Do not silently flip that flag to `true` — it's only safe once the app is actually deployed behind a real server again.
- A `Dockerfile` also exists (Cloud Run–style: builds, then runs `node .output/server/index.mjs`, reading `PORT` from the environment) as the path that *would* re-enable server actions if the deployment target changes. It is not the currently active deployment path — Firebase static hosting is.

If you're asked to add a feature that needs server-side logic (e.g. anything using `supabaseAdmin` from `client.server.ts`), it will work in dev but the UI must not present it as usable in the deployed app unless `SERVER_ACTIONS_AVAILABLE` is also flipped for that route with the deployment story reconciled.

## Routing

TanStack Start file-based routing under `src/routes/` — see `src/routes/README.md` for the full convention table (bare `$id` params, `{-$optional}`, `$` splat, `_layout`, `__root.tsx` as the single app shell). `src/routeTree.gen.ts` is auto-generated; never edit by hand. Do not create `src/pages/` or Next/Remix-style route files.

## Auth & permissions

- `src/lib/auth-context.tsx` (`AuthProvider`/`useAuth`) owns Supabase session + `profiles` row state, and defends against a stale `inactive` profile status by forcing sign-out even if Supabase Auth's own ban didn't catch it.
- `src/lib/permissions.ts` defines `Role` (`admin | production | maintenance | quality | viewer`) and a static `Permission` → role matrix (`can(role, permission)`). Route-level and component-level guards go through this, not ad hoc role checks — e.g. `quality` deliberately lacks `dashboard.viewMaintenanceCard`.
- `src/components/RequireAuth.tsx` wraps protected routes: redirects unauthenticated users to `/login`, force-shows a "set new password" form when `profile.must_change_password`, and renders an access-denied state when `requirePermission` fails `can()`.

## Supabase client layers

Four distinct Supabase entry points under `src/integrations/supabase/` — pick the right one, they are not interchangeable:

- `client.ts` — browser/SSR client using the publishable key (`VITE_SUPABASE_*` on client, `process.env.SUPABASE_*` fallback on server). Safe to import anywhere.
- `client.server.ts` — service-role client (`SUPABASE_SERVICE_ROLE_KEY`), bypasses RLS. **Only import inside other `*.server.ts` modules**, and lazily (`await import(...)`) inside handlers — a top-level import in a route file would ship the service-role path into the client bundle.
- `auth-attacher.ts` — client-side `functionMiddleware` (registered globally in `src/start.ts`) that attaches the current session's bearer token to server-fn RPCs. Without this being registered, server functions never see the caller's auth.
- `auth-middleware.ts` — server-side `requireSupabaseAuth` middleware: validates the bearer JWT via `supabase.auth.getClaims`, and injects `{ supabase, userId, claims }` into handler context. Server functions that need an authenticated caller use `.middleware([requireSupabaseAuth])`.

All four files are marked "automatically generated, do not edit directly" — they're regenerated from the Supabase integration, so hand edits will be lost; change behavior around them instead of in them where possible.

Admin-only server functions (`src/lib/users-actions.server.ts`) additionally call an `assertAdmin()` check against the *caller's own profile row* server-side — never trust the client UI's role-based hiding as the actual authorization boundary.

## Audit logging

`src/lib/audit.ts` (`logAudit`) → `src/lib/audit.server.ts` (`logAuditEventFn`, a server fn requiring auth) inserts into the `audit_logs` table, capturing browser/device parsed from the user-agent and IP from `cf-connecting-ip` / `x-forwarded-for` / `x-real-ip` headers. `logAudit` swallows its own errors by design — audit logging must never block or break the action it's recording. Note the Firebase static-hosting caveat above: this path needs a real server to work, same as user-management actions.

## Data model

Domain types live in `src/lib/queries.ts` (production lines, per-line field defs, downtime reasons, production areas, area owners, entry rows). Downtime-reason classification (`department_id`/`downtime_type_id`/`severity_id`/`production_area_id`) lives on the `downtime_reasons` record and is resolved via embedded Supabase selects — it is intentionally never duplicated onto `entry_downtimes` rows, so reclassifying a reason in Settings doesn't require touching historical entries. Migrations are in `supabase/migrations/` (plain numbered SQL files, applied in filename order).

## Styling / UI

Tailwind v4 (via `@tailwindcss/vite`, injected by the base Lovable config) + shadcn/radix components under `src/components/ui/`. Path alias `@/*` → `src/*` (configured in both `tsconfig.json` and injected by the base vite config — don't re-add it manually).

## Do not modify without care

`vite.config.ts` is deliberately minimal: `@lovable.dev/vite-tanstack-config` already wires up TanStack Start, React, Tailwind, tsconfig paths, Nitro, the dev-only component tagger, `VITE_*` env injection, error-logger plugins, and sandbox port/host detection. Adding any of those plugins manually will produce duplicate-plugin breakage — extend via the `vite: {...}` / `tanstackStart: {...}` options passed to `defineConfig`, not by importing plugins directly.

## My Roles & Skills

When working on this project, consider yourself:

### Technical Roles
- **Senior Frontend Engineer**: React 19, TypeScript, TanStack, Tailwind CSS
- **QA/QC Engineer**: Test every change visually on 390px and 1280px before deploying
- **Software Architect**: Think about scalability, maintainability, and code quality

### Business Roles
- **Maintenance Manager**: Understand MTBF, MTTR, Equipment Availability, Chronic vs Sporadic failures
- **Manufacturing Director**: Focus on OEE, Line Availability, Production Adherence, Loss %
- **COO**: See the big picture — does the dashboard give decision makers what they need?
- **Production Manager**: Understand shift operations, downtime impact, daily targets
- **QA/QC Manager**: Data integrity, number consistency across all screens

### Design Principles
- Mobile-first: default classes = mobile, md: = desktop
- Professional UI matching approved mockups
- Never break desktop when fixing mobile
- Touch targets minimum 44px on mobile
- Bottom navigation on mobile (md:hidden)
- KPI cards: grid-cols-2 on mobile
- Charts: height 200px on mobile

### Before Every Deploy
1. npx tsc --noEmit → must be clean
2. Screenshot on 390px → check mobile layout
3. Screenshot on 1280px → verify desktop unchanged
4. npm run build:firebase → must succeed
5. firebase deploy --only hosting
6. git commit && git push origin master
