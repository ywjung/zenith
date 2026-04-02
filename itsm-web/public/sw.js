// ZENITH ITSM Service Worker v6
// Strategy:
//   - _next/static/ : Cache First (content-hashed, truly immutable)
//   - /icons/, /manifest.json, /favicon.ico : Stale-While-Revalidate
//     → serves cached version immediately, fetches fresh in background
//     → ensures icon/manifest updates reach clients without cache-busting URLs
//   - Everything else: pass-through (no caching)
//     → prevents stale RSC payloads / page-chunk mismatch after deploys

const CACHE_NAME = 'zenith-v6';

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', () => {
  self.skipWaiting();
});

// ── Activate — purge old caches ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET
  if (request.method !== 'GET') return;

  // Only http/https — chrome-extension:// etc. are unsupported by Cache API
  if (!request.url.startsWith('http')) return;

  // Navigation: browser handles directly
  if (request.mode === 'navigate') return;

  const url = new URL(request.url);

  // API calls: always network
  if (url.pathname.startsWith('/api/')) return;

  // Next.js RSC prefetch requests: always network (stale RSC = webpack chunk mismatch)
  if (request.headers.get('RSC') || url.searchParams.has('_rsc')) return;

  // _next/data/ (getServerSideProps / RSC flight): always network
  if (url.pathname.startsWith('/_next/data/')) return;

  // _next/static/ : Cache First — filenames are content-hashed, safe to cache forever
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Static public assets (icons, manifest): Stale-While-Revalidate
  // Serves cached version immediately while fetching fresh in background,
  // so icon/manifest updates propagate to existing clients without URL versioning.
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/favicon.ico'
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Everything else (page routes, API routes, etc.): pass through — no caching
});

// ── Cache First strategy ──────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

// ── Stale-While-Revalidate strategy ──────────────────────────────────────────
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached ?? (await networkFetch) ?? new Response('', { status: 503 });
}

// ── Web Push ──────────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'ZENITH ITSM', body: '새 알림이 있습니다.', url: '/' };
  if (event.data) {
    try { data = { ...data, ...JSON.parse(event.data.text()) }; } catch { /* keep defaults */ }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url },
      tag: 'itsm-push',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
