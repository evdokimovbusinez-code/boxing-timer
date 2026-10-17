/* Офлайн-кэш: таймер работает в зале без интернета. */
const CACHE = 'boxing-timer-v4';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'i18n.js', 'parse.js', 'detect.js', 'voice-phrases.js', 'stomp-worklet.js',
  'manifest.webmanifest', 'media/keepawake.mp4', 'voices/index.json',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Сразу из кэша (мгновенный старт даже при плохом интернете в зале), а в фоне — свежая версия на следующий запуск.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(e.request, { ignoreSearch: true }).then((cached) => {
        const fresh = fetch(e.request)
          .then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; })
          .catch(() => cached || c.match('index.html'));
        if (cached) { e.waitUntil(fresh.catch(() => {})); return cached; }
        return fresh;
      })
    )
  );
});
