// Jay Society Intel service worker: push notifications + offline fallback.
// Pages are private and dynamic, so we don't cache them (no stale numbers on screen).
const CACHE = "jsi-shell-v1";
const SHELL = ["/icons/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    "<!doctype html><meta name=viewport content='width=device-width'><body style='background:#0b0c0f;color:#ecebe6;font-family:system-ui;padding:40px'><h2>Offline</h2><p>Reconnect to load fresh research. Nothing is shown offline so you never act on stale numbers.</p>",
    { headers: { "Content-Type": "text/html" } },
  )));
});

self.addEventListener("push", (e) => {
  let data = { title: "Jay Society Intel", body: "", url: "/" };
  try { data = { ...data, ...e.data.json() }; } catch (_) { /* plain text */ }
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: data.url } }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
