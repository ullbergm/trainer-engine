/* Synced from the trainer-engine repo; do not edit in an app repo.
 *
 * Service worker: precached core assets are served cache-only (each release
 * replaces them wholesale via a new worker); anything else same-origin gets
 * stale-while-revalidate.
 *
 * The cache name carries the release version (stamped in by the deploy
 * workflow), so every release ships a byte-different sw.js: the browser
 * installs it as a new worker, which precaches everything fresh and drops the
 * old cache on activate. That gives each release a clean, consistent set of
 * assets (no mixed old/new files) and lets the page detect the update and
 * offer a reload. */
const VERSION = '__VERSION__'; // replaced with the release tag at deploy
// Cache storage is scoped to the origin, so the name needs no site prefix.
const CACHE = 'trainer-' + VERSION;
// The app's own files beyond the engine core: page maps, extra data, module
// scripts. Every app ships the file, even if the list is empty.
importScripts('data/app-assets.js');
const CORE = [
  './',
  'index.html',
  'css/engine.css',
  'css/app.css',
  'js/fsrs.js',
  'js/readiness.js',
  'js/storage.js',
  'js/app.js',
  'data/questions.js',
  'data/exam-config.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  // Both are written into the deploy by the release workflow; without them
  // the About changelog and the footer version are blank offline.
  'CHANGELOG.md',
  'version.txt',
  ...APP_ASSETS,
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Core assets only change at a release, and every release ships a new worker
// that precaches a fresh set. Refreshing them per-request would drip files
// from the next release into this cache one at a time, and a partial refresh
// (tab closed mid-load) leaves a mix of two releases behind.
const CORE_PATHS = new Set(CORE.map(p => new URL(p, location.href).pathname));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      // ignoreSearch: a URL with a query string (share-link trackers and the
      // like) still hits the precached copy when offline.
      const cached = await cache.match(e.request, { ignoreSearch: true });
      if (cached && CORE_PATHS.has(url.pathname)) return cached;
      const fetched = fetch(e.request).then(res => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
