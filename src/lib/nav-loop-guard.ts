const WINDOW_MS = 5000;
const MAX_ATTEMPTS = 3;
const STORAGE_KEY = "psc:nav-redirect-log";

interface LogEntry {
  path: string;
  at: number;
}

// Defends against something outside our control (e.g. an antivirus
// injecting scripts or intercepting requests) perturbing session/history
// state and driving our own auth-redirect effects into a tight loop.
// Persisted in sessionStorage rather than a module variable because the
// loop this guards against can include full page reloads, which would
// otherwise reset an in-memory counter every time.
export function shouldSuppressRedirect(path: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const now = Date.now();
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const log: LogEntry[] = raw ? JSON.parse(raw) : [];
    const recent = log.filter((e) => now - e.at < WINDOW_MS);
    const recentForPath = recent.filter((e) => e.path === path);

    if (recentForPath.length >= MAX_ATTEMPTS) {
      return true;
    }

    recent.push({ path, at: now });
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
    return false;
  } catch {
    return false;
  }
}
