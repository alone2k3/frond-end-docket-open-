/* Offline support.
   App files: try the network first so a new version shows up straight away, and fall back to the saved copy
   when the network is slow (3 seconds) or missing. Google Fonts are cache-first.
   Calls to the database go straight to the network and are never cached here.
   Bump VERSION when files change. */
var VERSION = 'docket-v10';
var SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'store.js', 'config.js', 'supabase-js.js', 'manifest.webmanifest',
  'favicon.svg', 'turmeric-logo.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function store(req, res) {
  if (res && (res.ok || res.type === 'opaque')) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
}
function networkFirst(req) {
  return new Promise(function (resolve) {
    var done = false;
    function finish(r) { if (!done && r) { done = true; resolve(r); } }
    var timer = setTimeout(function () { caches.match(req).then(finish); }, 3000);
    fetch(req).then(function (res) { clearTimeout(timer); store(req, res); finish(res); }).catch(function () {
      clearTimeout(timer);
      caches.match(req).then(function (hit) { finish(hit || (req.mode === 'navigate' ? undefined : Response.error())); return hit || caches.match('index.html'); }).then(function (fb) { finish(fb || Response.error()); });
    });
  });
}
function cacheFirst(req) {
  return caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) { store(req, res); return res; });
  });
}
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(networkFirst(req));
  else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') e.respondWith(cacheFirst(req));
});
