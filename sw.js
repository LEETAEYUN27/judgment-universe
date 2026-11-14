// 판단 유니버스 — 화면 파일만 보관(오프라인 첫 화면용). 시세·기록은 항상 새로 받음.
const V = 'ju-4', SHELL = ['./', './index.html', './core.js?v=3', './ui.js?v=4', './skin.css?v=3', './icon.svg', './manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.includes('/data/h/')) { e.respondWith(caches.open(V + '-h').then(c => c.match(e.request).then(r => r || fetch(e.request).then(x => { if (x.ok) c.put(e.request, x.clone()); return x; })))); return; }
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
