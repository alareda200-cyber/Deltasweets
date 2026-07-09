#!/usr/bin/env node
/**
 * generate-static-shell.mjs
 *
 * Run this AFTER every `npm run build`, before deploying to Firebase
 * Hosting. It boots the just-built Node server (the same one already
 * proven to work — see the node-preset config in vite.config.ts), fetches
 * a real page from it to discover the CURRENT build's content-hashed asset
 * filenames (these change on every build), then writes a minimal,
 * route-agnostic index.html shell into .output/public/ — no server-
 * rendered content, no baked-in router state, just the real stylesheet +
 * entry script for this exact build. This is what makes the static SPA
 * shell approach safe to repeat on every deploy instead of going stale.
 *
 * Usage:  node scripts/generate-static-shell.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const PORT = 8199;

function log(msg) {
  console.log(`[generate-static-shell] ${msg}`);
}

// Firebase serves this SAME index.html for every route (catch-all rewrite in
// firebase.json). If it keeps /login's fully server-rendered DOM (its form,
// text, etc.), React sees that DOM on hydration for every OTHER route and
// throws a hydration mismatch (error #418) because the server-rendered
// content it's hydrating against doesn't match what that route actually
// renders. But the bootstrap scripts can't just be dropped either — the
// hydration entry's first line is `window.$_TSR||ge()` where
// `ge(){throw Error("Invariant failed")}`, an unconditional hard crash if
// that object is missing.
//
// The fix: keep every <script> tag (in original order — it's what carries
// $_TSR and the entry module), but discard everything else inside <body>.
// With no leftover server-rendered DOM to mismatch against, React hydrates
// an effectively-empty container instead of fighting stale content, and
// $_TSR is still there to satisfy the invariant check. <head> (styles,
// meta, links, the correctly content-hashed asset references) is left
// completely untouched — only <body>'s non-script content is cleared.
function stripBodyToScriptsOnly(html) {
  const bodyMatch = html.match(/<body([^>]*)>([\s\S]*)<\/body>/i);
  if (!bodyMatch) {
    throw new Error(
      "Could not find <body>...</body> in the server-rendered HTML — server output format may have changed.",
    );
  }
  const [fullMatch, bodyAttrs, bodyInner] = bodyMatch;
  const scriptTags = bodyInner.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const strippedBody = `<body${bodyAttrs}>${scriptTags.join("")}</body>`;
  return (
    html.slice(0, bodyMatch.index) + strippedBody + html.slice(bodyMatch.index + fullMatch.length)
  );
}

async function main() {
  log("Starting the built server to capture real asset filenames...");
  const server = spawn("node", [path.join(projectRoot, ".output/server/index.mjs")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "pipe",
  });

  let ready = false;
  server.stdout.on("data", (d) => {
    if (d.toString().includes("Listening")) ready = true;
  });

  // Wait up to 10s for the server to report ready.
  for (let i = 0; i < 100 && !ready; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) {
    server.kill();
    throw new Error(
      "Server did not start in time — check .output/server/index.mjs exists (run `npm run build` first).",
    );
  }

  log("Fetching /login to capture this build's complete, real rendered HTML...");
  const res = await fetch(`http://127.0.0.1:${PORT}/login`);
  const html = await res.text();
  server.kill();

  // We need the FULL, real HTML the server actually rendered for /login —
  // including its complete `window.$_TSR = {...}` bootstrap script and the
  // real content-hashed asset <script>/<link> tags for this build. Do NOT
  // fetch/build this any other way. Confirmed by inspecting the actual
  // client bundle: the hydration entry's first line is literally
  // `window.$_TSR||ge()` where `ge(){throw Error("Invariant failed")}` —
  // an unconditional hard crash if that object is missing. The router's own
  // location parser reads `window.location.pathname` as its actual source
  // of truth (also confirmed in the bundle), so it correctly resolves to
  // whatever the real browser URL is once it takes over, regardless of
  // which route this shell happened to be captured from.
  //
  // What we must NOT keep is /login's server-rendered *DOM* (the <body>
  // content besides scripts) — see stripBodyToScriptsOnly() above.
  const shellHtml = stripBodyToScriptsOnly(html);
  const outputPath = path.join(projectRoot, ".output/public/index.html");
  writeFileSync(outputPath, shellHtml, "utf8");
  log(`Wrote static shell to ${outputPath}`);
  log("Done. .output/public/ is now ready for `firebase deploy --only hosting`.");
}

main().catch((err) => {
  console.error("[generate-static-shell] FAILED:", err.message);
  process.exit(1);
});
