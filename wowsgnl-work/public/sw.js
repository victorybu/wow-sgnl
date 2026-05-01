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

const CACHE_VERSION = 'signal-v1';
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
