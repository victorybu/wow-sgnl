// Signal PWA service worker.
// Strategy:
//   - Network-first for everything (this is an internal tool that
//     shows real-time data; never serve stale events from cache).
//   - Cache /triage on each successful fetch so the shell loads
//     instantly on bad mobile network.
//   - On offline navigation requests, serve the cached /triage if
//     available.
//
// No prefetch, no background sync — keep it lean. Bump CACHE_VERSION
// to force update on deploy.

const CACHE_VERSION = 'signal-v2';
const SHELL_URLS = ['/triage', '/'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_URLS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      ),
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) return;

  // Skip API routes — always live
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache successful page navigations for the shell
        if (
          res.ok &&
          (req.mode === 'navigate' || res.headers.get('content-type')?.includes('text/html'))
        ) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          // Offline fallback for navigations: serve /triage shell
          if (req.mode === 'navigate') {
            return caches.match('/triage');
          }
          return new Response('offline', { status: 503, statusText: 'offline' });
        })
      )
  );
});

// Push event: server fires this when a 9+ event lands. Payload comes
// in as JSON ({title, body, url?, tag?}); show a system notification
// and stash the URL on the notification's data so click navigates.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch { payload = { title: 'Signal', body: event.data.text() }; }
  const title = payload.title || 'Signal alert';
  const opts = {
    body: payload.body || '',
    icon: '/icon-192',
    badge: '/icon-192',
    data: { url: payload.url || '/' },
    tag: payload.tag || 'signal',
    renotify: true,
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

// Notification click: focus an existing tab on the URL (or open new).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const sameOrigin = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (sameOrigin) {
        sameOrigin.focus();
        return sameOrigin.navigate(target).catch(() => {});
      }
      return self.clients.openWindow(target);
    }),
  );
});
