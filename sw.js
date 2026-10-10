// Offline support: network first, fall back to the last cached copy.
// Bump VERSION when you want every phone to drop its old cache.
const VERSION = 'amma-dishti-v4';
const SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/data.js',
  'js/store.js',
  'js/sound.js',
  'js/cropper.js',
  'js/ritual.js',
  'js/voicestore.js',
  'js/voicefx.js',
  'js/recorder.js',
  'manifest.webmanifest',
  'icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('index.html'))),
  );
});
