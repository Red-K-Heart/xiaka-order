const CACHE_NAME = 'xiaka-operator-shell-v38';
const STATIC_HOSTS = new Set(['cdn.tailwindcss.com', 'cdnjs.cloudflare.com']);

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('xiaka-operator-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const isPage = request.mode === 'navigate' && url.origin === self.location.origin;
  const isStaticAsset = STATIC_HOSTS.has(url.hostname) && /tailwindcss|font-awesome/i.test(url.href);
  if (!isPage && !isStaticAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cacheKey = isPage ? new Request(`${url.origin}${url.pathname}`) : request;
    try {
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') await cache.put(cacheKey, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      throw error;
    }
  })());
});
