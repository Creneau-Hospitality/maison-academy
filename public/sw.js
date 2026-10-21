// Maison Academy service worker: keeps the app opening on low or no signal.
// Copyright © 2026 Creneau Hospitality. All rights reserved.
// Answers are queued by the app itself (localStorage) and sent when back online;
// this file only caches the app's own files. Database calls are never cached.
const CACHE = 'ma-shell-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // Pages: network first, fall back to the cached app.
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put('/', copy));
      return res;
    }).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/') || /\.(png|webmanifest|woff2?)$/.test(url.pathname)) {
    // Built files have unique names, so cached copies never go stale.
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    })));
  }
});

// Reminders (web push): show the message; tapping it opens the app.
self.addEventListener('push', (e) => {
  let d = { title: 'Maison Academy', body: "Today's cards are ready.", url: '/' };
  try { d = { ...d, ...e.data.json() }; } catch { /* plain text or empty */ }
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'daily-reminder', data: { url: d.url },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(target); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
