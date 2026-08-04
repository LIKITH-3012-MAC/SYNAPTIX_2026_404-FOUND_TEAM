/* RESOLVIT Progressive Web App Service Worker */

const CACHE_VERSION = 'resolvit-v1.0.0';
const STATIC_CACHE = `resolvit-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `resolvit-runtime-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

// Core assets required for offline shell
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/submit.html',
  '/dashboard.html',
  '/intelligence.html',
  '/care.html',
  '/citizen.html',
  '/ngo.html',
  '/admin.html',
  '/authority.html',
  '/forgot-password.html',
  '/reset-password.html',
  '/pass-reset.html',
  '/signup.html',
  '/css/styles.css',
  '/css/map-premium.css',
  '/css/intro.css',
  '/css/copilot.css',
  '/css/care.css',
  '/css/profile-premium.css',
  '/css/pwa.css',
  '/js/pwa.js',
  '/js/offline-db.js',
  '/js/sync-manager.js',
  '/js/api.js',
  '/js/auth.js',
  '/js/ui-enhancements.js',
  '/js/animations.js',
  '/js/copilot.js',
  '/js/dashboard.js',
  '/js/theme-manager.js',
  '/js/i18n.js',
  '/resolvit.png',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/maskable-icon-512x512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32x32.png',
  '/icons/favicon-16x16.png'
];

// 1. Service Worker Installation
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      // Use Promise.allSettled to prevent single missing optional asset from breaking installation
      return Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[PWA SW] Precache warning for ${url}:`, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// 2. Service Worker Activation & Cache Cleanup
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== STATIC_CACHE && cacheName !== RUNTIME_CACHE) {
            console.log('[PWA SW] Removing legacy cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Helper: Determine if request is API call
function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

// 3. Fetch Event Handling
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests or external non-http(s)
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // API Requests: Network First with graceful fallback
  if (isApiRequest(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          return new Response(
            JSON.stringify({ error: true, offline: true, message: 'You are currently offline' }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  // Navigation (HTML Pages): Network First -> Cache -> Offline Page
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          // Match matching html page or fall back to /offline.html
          const offlineFallback = await caches.match(OFFLINE_URL);
          return offlineFallback || new Response('Offline', { status: 503, statusText: 'Offline' });
        })
    );
    return;
  }

  // Static Assets (CSS, JS, Fonts, Images): Stale-While-Revalidate Strategy
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(() => null);

      // Return cached version immediately if available, otherwise wait for network
      return cachedResponse || fetchPromise;
    })
  );
});

// 4. Message Event Listener for manual updates or skip waiting
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
