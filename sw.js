// Mes chats : app gardée en cache pour le hors ligne, photos en cache, notifications de rappel.
const V = 'chats-v2';
const SHELL = ['./', 'index.html', 'app.js', 'supabase.js', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== 'chats-photos').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const netFirst = async req => { const c = await caches.open(V);
  try { const r = await fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })); if (r.ok) c.put(req, r.clone()); return r; }
  catch { const m = await c.match(req, { ignoreSearch: req.mode === 'navigate' }); if (m) return m; if (req.mode === 'navigate') return c.match('index.html'); throw new Error('offline'); } };
const cacheFirst = async (req, name = V) => { const c = await caches.open(name); const m = await c.match(req); if (m) return m;
  const r = await fetch(req); if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; };
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.hostname.endsWith('supabase.co')) { if (u.pathname.includes('/storage/v1/object/sign/')) e.respondWith(cacheFirst(req, 'chats-photos')); return; }
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') { e.respondWith(cacheFirst(req)); return; }
  if (u.origin === location.origin) { e.respondWith(/supabase\.js$/.test(u.pathname) ? cacheFirst(req) : netFirst(req)); return; }
});

// Notifications
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Mes chats', {
    body: d.body || '', tag: d.tag, renotify: !!d.tag, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: d.url || './' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.postMessage({ url: target }); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
