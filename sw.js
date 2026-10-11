/* ZaiChat v16 — Service Worker: офлайн-оболочка, сеть-первая для данных */
const VERSION = 'v16.4';
const SHELL = [
  '/', '/index.html', '/css/app.css?v=16.4',
  '/js/app.js?v=16.4', '/js/api.js', '/js/store.js', '/js/md.js', '/js/ppt.js', '/js/plugins.js', '/js/chat.js',
  '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/offline.html'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // данные z.ai — только сеть (стриминг и аккаунт)
  if (url.host === 'chat.z.ai') return;
  // навигация: сеть → кэш → /offline
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put('/', cp)); return r; })
        .catch(() => caches.match('/').then(r => r || caches.match('/offline.html')))
    );
    return;
  }
  // код и стили — СЕТЬ-ПЕРВЫЕ (иначе после деплоя пользователи застревают на старом api.js)
  if (url.origin === location.origin && (url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/') || url.pathname === '/index.html')) {
    e.respondWith(
      fetch(e.request).then(r => { if (r && r.ok) caches.open(VERSION).then(c => c.put(e.request, r.clone())); return r; })
        .catch(() => caches.match(e.request).then(c => c || caches.match('/offline.html')))
    );
    return;
  }
  // прочее (иконки и статики): кэш-первая с фоновым обновлением
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(r => {
        if (r && r.ok && url.origin === location.origin) caches.open(VERSION).then(c => c.put(e.request, r.clone()));
        return r;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
