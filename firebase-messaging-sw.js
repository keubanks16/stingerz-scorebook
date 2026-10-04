// GS Baseball Hub service worker.
// 1. Keeps a copy of the Hub on the phone so it opens and keeps scoring with no signal.
// 2. Shows notifications when the app is closed (Firebase Cloud Messaging).

const CACHE = 'gs-hub-v1';
const FB = 'https://www.gstatic.com/firebasejs/12.19.0/';
const SHELL = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon-maskable-512.png'];
const FB_MODULES = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js', 'firebase-messaging.js'].map((f) => FB + f);
const PAGE = new URL('./', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One missing file shouldn't stop the rest from being saved.
    await Promise.all(SHELL.concat(FB_MODULES).map(async (u) => {
      try { const r = await fetch(new Request(u, { cache: 'reload' })); if (r.ok) await cache.put(u === './' ? PAGE : u, await clean(r)); } catch (e) { /* saved next time */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// A response that came through a redirect can't be handed to a page load later, so save a clean copy.
async function clean(r) { return r.redirected ? new Response(await r.blob(), { status: 200, headers: r.headers }) : r; }

// Network first for the Hub itself, so updates show up as soon as there's signal. On a weak
// signal it waits a few seconds, then opens the saved copy instead of a blank screen.
async function page(request) {
  const cache = await caches.open(CACHE);
  const net = fetch(request).then(async (r) => { if (r && r.ok) { const c = await clean(r.clone()); cache.put(PAGE, c); } return r; });
  const timeout = new Promise((resolve) => setTimeout(resolve, 3500));
  try {
    const r = await Promise.race([net, timeout]);
    if (r && r.ok) return r;
  } catch (e) { /* no signal */ }
  const saved = await cache.match(PAGE);
  if (saved) { net.catch(() => {}); return saved; }
  return net;
}
// Firebase code is versioned, so the saved copy never goes stale.
async function savedFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const r = await fetch(request);
  if (r && r.ok) cache.put(request, r.clone());
  return r;
}
// Icons, pictures and the app manifest: answer from the saved copy, refresh it in the background.
async function savedThenRefresh(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request, { ignoreSearch: true });
  const net = fetch(request).then((r) => { if (r && r.ok) cache.put(request, r.clone()); return r; }).catch(() => null);
  return saved || (await net) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' && url.origin === self.location.origin) { event.respondWith(page(req)); return; }
  if (url.href.startsWith(FB)) { event.respondWith(savedFirst(req)); return; }
  if (url.origin === self.location.origin && /\.(png|jpg|gif|webmanifest|svg|ico)$/.test(url.pathname)) { event.respondWith(savedThenRefresh(req)); return; }
  // Everything else (the database, sign-in, the Worker, video) goes straight to the network.
});

// ---------- notifications ----------
// If the notification code can't load, the offline copy above still works.
try {
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');
firebase.initializeApp({"apiKey": "AIzaSyBfTjGdAr9nXPEp30X7c9Ot01fT5oGV7_0", "authDomain": "stingerz-scorebook.firebaseapp.com", "projectId": "stingerz-scorebook", "storageBucket": "stingerz-scorebook.firebasestorage.app", "messagingSenderId": "667344236029", "appId": "1:667344236029:web:9f1372d2e6d96321587d94"});
firebase.messaging();
} catch (e) { /* notifications unavailable in this browser right now */ }
