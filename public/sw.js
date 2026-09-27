self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "إشعار جديد", body: event.data.text() };
  }

  const title = payload.title || "إشعار جديد";
  const url = payload.url || "/maintenance";
  const options = {
    body: payload.body || "",
    icon: "/logo.png",
    badge: "/logo.png",
    data: { url },
  };
  // Replay requests (Settings › Replay approval): Approve / Deny right in the
  // notification where the platform supports actions (Android, desktop
  // Chrome/Edge). iPhone ignores them; tapping opens the requests page.
  if (new URL(url, self.location.origin).pathname === "/replay-requests") {
    options.tag = url;
    options.requireInteraction = true;
    options.actions = [
      { action: "approve", title: "موافقة" },
      { action: "deny", title: "رفض" },
    ];
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  let targetUrl = event.notification.data?.url || "/maintenance";
  // An action button: the requests page makes the decision with the admin's
  // own session (the service worker has none), then cleans the URL.
  if (event.action === "approve" || event.action === "deny") {
    const u = new URL(targetUrl, self.location.origin);
    u.searchParams.set("do", event.action);
    targetUrl = u.pathname + u.search;
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        if (clientUrl.pathname === targetUrl && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
