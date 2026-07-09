import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";

// Overrides @tanstack/react-start's default client entry, which calls
// hydrateRoot(document, ...). That's only correct when the served HTML was
// actually server-rendered for the CURRENT route — but this app's real
// deployment target is Firebase Hosting serving one static index.html for
// every route (see CLAUDE.md / vite.config.ts), so the markup React would
// be "hydrating" was frozen at build time for whatever route
// scripts/generate-static-shell.mjs happened to capture. Hydrating against
// the wrong route's DOM shape throws React error #418 on every route
// except that one — confirmed: even reducing the shell's <body> to just
// its <script> tags still mismatches, because hydrateRoot(document, ...)
// reconciles the ENTIRE document (RootShell renders <html>/<head>/<body>
// itself), so any difference in tree shape — not just content — triggers
// it. createRoot(document) does a normal client-side render instead:  it
// replaces whatever the static shell had with whatever the CURRENT route
// actually renders, with nothing to mismatch against.
createRoot(document).render(
  <StrictMode>
    <StartClient />
  </StrictMode>,
);
