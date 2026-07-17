const CACHE = 'rebecca-feed-planner-v3';
const CORE = [
  './', './index.html', './styles.css?v=3', './app.js?v=3', './manifest.webmanifest',
  './assets/profile.jpg', './assets/icon-180.png', './assets/icon-192.png', './assets/icon-512.png',
  './assets/highlights/corfu.jpg', './assets/highlights/rebecca.jpg', './assets/highlights/heart.jpg', './assets/highlights/salzburg.jpg', './assets/highlights/malaga.jpg',
  ...Array.from({ length: 14 }, (_, i) => `./assets/posts/${String(i + 1).padStart(2, '0')}.jpg`)
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      const refreshed = fetch(event.request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || refreshed;
    })
  );
});
