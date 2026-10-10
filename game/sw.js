// GS Baseball offline support. Bump VERSION whenever files change.
const VERSION = 'gsb-v3.3.2';
const CORE = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/main.js', 'js/engine.js', 'js/physics.js', 'js/player.js', 'js/field.js', 'js/data.js', 'js/audio.js', 'js/ui.js', 'js/assets.js', 'js/crowd.js', 'js/crowd-worker.js', 'js/vendor/three.module.min.js', 'img/gs-logo-light.png', 'img/gs-logo-navy.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const MUSIC = ['music/bring-that-sting.mp3', 'music/built-different.mp3', 'music/buzzin.mp3', 'music/one-shot.mp3'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
    // download the team songs in the background so music works offline too
    const c = await caches.open(VERSION);
    for (const m of MUSIC) { if (!(await c.match(m))) { try { await c.add(m); } catch { } } }
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.status === 200) c.put(req, res.clone());
      return res;
    } catch {
      return (await c.match('index.html')) || Response.error();
    }
  })());
});
