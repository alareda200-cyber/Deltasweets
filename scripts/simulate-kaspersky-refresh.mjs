// Simulates Kaspersky-style SSL inspection (per-request latency on Supabase
// token refresh + HTML script re-injection) against a running dev server,
// logs in, and counts auth/v1/token?grant_type=refresh_token calls over a
// monitoring window. Run once per JWT-expiry setting and compare refreshCount
// / loopDetected between runs.
//
// Usage:
//   TEST_EMAIL=you@example.com TEST_PASSWORD=... npm run sim:kaspersky
//
// Env vars:
//   TEST_EMAIL / TEST_PASSWORD   required — a real login-capable account
//   BASE_URL                     default http://localhost:8080
//   DURATION_MINUTES             default 5 (settle/monitor window; see FORCED_REFRESH below)
//   HEADLESS                     default true; "false" to watch the browser
//   KASPERSKY_SIM                default true; "false" for an unthrottled control run
//   FORCED_REFRESH               default false; "true" to, 60s after login, call the
//                                 app's live supabase.auth.refreshSession() 5x with a 2s
//                                 gap, then keep monitoring for DURATION_MINUTES to see if
//                                 it settles or keeps firing on its own. Requires BASE_URL
//                                 to be the Vite dev server (source files aren't
//                                 individually addressable in the production static build).

import { chromium } from "@playwright/test";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const dotenv = readEnvFile(path.join(repoRoot, ".env"));
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || dotenv.VITE_SUPABASE_URL || dotenv.SUPABASE_URL;
if (!SUPABASE_URL) {
  console.error("Could not determine Supabase URL (checked VITE_SUPABASE_URL env var and .env).");
  process.exit(1);
}
const supabaseHost = new URL(SUPABASE_URL).host;

const BASE_URL = process.env.BASE_URL || "http://localhost:8080";
const DURATION_MS = Number(process.env.DURATION_MINUTES || 5) * 60_000;
const HEADLESS = process.env.HEADLESS !== "false";
const SIM_ON = process.env.KASPERSKY_SIM !== "false";
const FORCED_REFRESH = process.env.FORCED_REFRESH === "true";
const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;
const CLIENT_MODULE_PATH = "/src/integrations/supabase/client.ts";

if (!TEST_EMAIL || !TEST_PASSWORD) {
  console.error("Set TEST_EMAIL and TEST_PASSWORD env vars to a real login-capable account before running this script.");
  process.exit(1);
}

const refreshEvents = [];
const failedTokenRequests = [];

function isTokenRefreshUrl(url) {
  return url.host === supabaseHost && url.pathname.endsWith("/auth/v1/token") && url.searchParams.get("grant_type") === "refresh_token";
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: HEADLESS });
  try {
    await run(browser);
  } finally {
    await browser.close();
  }
}

async function run(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();

  if (SIM_ON) {
    await page.route("**/*", async (route) => {
      const request = route.request();
      let url;
      try {
        url = new URL(request.url());
      } catch {
        await route.continue();
        return;
      }

      // Simulate Kaspersky's SSL-inspection latency on token refresh calls.
      if (isTokenRefreshUrl(url)) {
        const delayMs = 50 + Math.floor(Math.random() * 150);
        await new Promise((r) => setTimeout(r, delayMs));
        refreshEvents.push({ ts: Date.now(), delayMs });
      }

      // Simulate Kaspersky re-injecting a script into every HTML document.
      if (request.resourceType() === "document") {
        const response = await route.fetch();
        const contentType = response.headers()["content-type"] || "";
        if (contentType.includes("text/html")) {
          const body = await response.text();
          const injected = body.includes("</body>")
            ? body.replace("</body>", "<script>window.__kasperskySimInjected=true;</script></body>")
            : body + "<script>window.__kasperskySimInjected=true;</script>";
          await route.fulfill({ response, body: injected });
          return;
        }
        await route.fulfill({ response });
        return;
      }

      await route.continue();
    });
  } else {
    page.on("request", (request) => {
      let url;
      try {
        url = new URL(request.url());
      } catch {
        return;
      }
      if (isTokenRefreshUrl(url)) refreshEvents.push({ ts: Date.now(), delayMs: 0 });
    });
  }

  page.on("requestfailed", (request) => {
    let url;
    try {
      url = new URL(request.url());
    } catch {
      return;
    }
    if (url.host === supabaseHost && url.pathname.endsWith("/auth/v1/token")) {
      failedTokenRequests.push({ ts: Date.now(), grantType: url.searchParams.get("grant_type"), failure: request.failure()?.errorText });
    }
  });

  console.log(`[sim] Kaspersky simulation: ${SIM_ON ? "ON" : "OFF (control run)"}`);
  console.log(`[sim] Navigating to ${BASE_URL}/login`);
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  // The login button exists in the pre-rendered HTML before React attaches its
  // onSubmit handler; clicking too early triggers a native form GET instead of
  // the JS-driven sign-in. Give hydration a beat to finish.
  await page.waitForTimeout(750);

  await page.locator("#email").fill(TEST_EMAIL);
  await page.locator("#password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  console.log("[sim] Logged in.");

  const forcedRefreshCalls = [];
  let burstEndTs = null;
  if (FORCED_REFRESH) {
    console.log("[sim] Forced-refresh mode: waiting 60s before the burst...");
    await page.waitForTimeout(60_000);

    for (let i = 1; i <= 5; i++) {
      const requestedAt = Date.now();
      let result;
      try {
        result = await page.evaluate(async (modulePath) => {
          const mod = await import(/* @vite-ignore */ modulePath);
          const { data, error } = await mod.supabase.auth.refreshSession();
          return { ok: !error, hasSession: !!data?.session, error: error?.message ?? null };
        }, CLIENT_MODULE_PATH);
      } catch (err) {
        result = { ok: false, hasSession: false, error: String(err) };
      }
      forcedRefreshCalls.push({ index: i, requestedAt: new Date(requestedAt).toISOString(), ...result });
      console.log(`[sim] forced refreshSession() call #${i}:`, JSON.stringify(result));
      if (!result.ok && i === 1) {
        console.error(
          "[sim] First forced refreshSession() call failed to reach the live client module. " +
            "FORCED_REFRESH mode requires BASE_URL to point at the Vite dev server (npm run dev), not the production static build.",
        );
      }
      if (i < 5) await page.waitForTimeout(2000);
    }
    burstEndTs = Date.now();
    console.log(`[sim] Burst done. Settling/monitoring for ${DURATION_MS / 60_000} minutes to watch for follow-on refreshes...`);
  } else {
    console.log(`[sim] Monitoring for ${DURATION_MS / 60_000} minutes...`);
  }

  const start = Date.now();
  while (Date.now() - start < DURATION_MS) {
    await page.waitForTimeout(30_000);
    const elapsedMin = ((Date.now() - start) / 60_000).toFixed(1);
    console.log(`[sim] t+${elapsedMin}m - refresh calls so far: ${refreshEvents.length}, failed token requests: ${failedTokenRequests.length}`);
  }

  const gaps = refreshEvents.slice(1).map((e, i) => e.ts - refreshEvents[i].ts);

  // In FORCED_REFRESH mode, the deliberate 2s-spaced burst always produces
  // short gaps by design — that's not a loop. What matters there is whether
  // any *extra* refresh requests fired after the burst ended on their own.
  let loopDetected;
  let unexpectedRefreshCount = null;
  if (FORCED_REFRESH) {
    unexpectedRefreshCount = refreshEvents.filter((e) => e.ts > burstEndTs).length;
    loopDetected = unexpectedRefreshCount > 0 || failedTokenRequests.length >= 1;
  } else {
    const shortGaps = gaps.filter((g) => g < 5000);
    loopDetected = shortGaps.length >= 3 || failedTokenRequests.length >= 3;
  }

  const summary = {
    baseUrl: BASE_URL,
    supabaseHost,
    kasperskySim: SIM_ON,
    forcedRefreshMode: FORCED_REFRESH,
    forcedRefreshCalls,
    unexpectedRefreshCount,
    durationMinutes: DURATION_MS / 60_000,
    refreshCount: refreshEvents.length,
    refreshTimestamps: refreshEvents.map((e) => new Date(e.ts).toISOString()),
    gapsMs: gaps,
    failedTokenRequests,
    loopDetected,
  };

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(summary, null, 2));

  const outDir = path.join(repoRoot, "tmp", "kaspersky-sim");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `run-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(`\nSaved to ${outFile}`);
  console.log(loopDetected ? "\nLOOP PATTERN DETECTED" : "\nNo loop pattern detected");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
