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

  // Navigation: network-first, 네트워크 실패 시 오프라인 메시지 표시 (폐쇄망에서 서버 다운 시)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ZENITH ITSM — 오프라인</title></head>' +
          '<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;color:#374151;text-align:center">' +
          '<div><div style="font-size:4rem;margin-bottom:1rem">🔌</div>' +
          '<h1 style="font-size:1.25rem;font-weight:700;margin:0 0 0.5rem">서버에 연결할 수 없습니다</h1>' +
          '<p style="font-size:0.875rem;color:#6b7280;margin:0 0 1.5rem">네트워크 연결을 확인하거나 잠시 후 다시 시도해주세요.</p>' +
          '<button onclick="location.reload()" style="padding:0.5rem 1.5rem;background:#2563eb;color:#fff;border:none;border-radius:0.5rem;font-size:0.875rem;cursor:pointer">🔄 새로고침</button></div></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
      )
    );
    return;
  }

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
// In-flight 요청 중복 제거: 동일 URL에 대한 백그라운드 fetch가 쌓이지 않도록 함.
const _inflightRevalidate = new Map();

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const key = request.url;

  let networkFetch = _inflightRevalidate.get(key);
  if (!networkFetch) {
    networkFetch = fetch(request).then((response) => {
      if (response.ok) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    }).catch(() => null).finally(() => {
      _inflightRevalidate.delete(key);
    });
    _inflightRevalidate.set(key, networkFetch);
  }

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
