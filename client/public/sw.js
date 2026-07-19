// Bumped v2→v3 (BUILD-21 Part 2): the activate handler deletes every cache name
// != CACHE_NAME, so bumping forces a one-time purge of any stale precache on
// each client's next load — belt-and-suspenders against a poisoned bundle
// (the SW is already network-first, and Vite content-hashes JS/CSS).
const CACHE_NAME = 'steward-v3';
const STATIC_ASSETS = ['/', '/index.html', '/offline.html'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Let API calls and Railway backend pass through without caching
  if (
    event.request.url.includes('railway.app') ||
    event.request.url.includes('/api/') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // For navigation requests (page loads), serve the offline page
          if (event.request.mode === 'navigate') {
            return caches.match('/offline.html');
          }
        });
      })
  );
});
