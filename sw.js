const CACHE_NAME = 'radio-tv-online-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './broadcast.html',
  './manifest.json',
  './assets/logo.png',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

// Install event - cache essential files
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS_TO_CACHE);
    }).catch(function(error) {
      console.log('Cache installation failed:', error);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') {
    return;
  }

  // HTML, JS, CSS y version.txt siempre del servidor (para que las actualizaciones lleguen solas)
  const url = event.request.url;
  if (
    url.indexOf('version.txt') !== -1 ||
    url.indexOf('/js/') !== -1 ||
    url.indexOf('/css/') !== -1 ||
    url.indexOf('.html') !== -1
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(response) {
      if (response) {
        return response;
      }

      return fetch(event.request).then(function(response) {
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }

        const responseToCache = response.clone();

        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, responseToCache);
        });

        return response;
      }).catch(function(error) {
        return caches.match('./index.html').then(function(response) {
          return response || new Response('Offline - Por favor conecta a internet', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({
              'Content-Type': 'text/plain'
            })
          });
        });
      });
    })
  );
});
