/* PaisaPilot service worker
 * Caches ONLY the static app shell (HTML, CSS, JS, icons, fonts).
 * It never touches Firebase traffic: authentication tokens, database reads/writes and
 * any financial data always go straight to the network and are never stored here.
 * Bump VERSION whenever you deploy changed files so phones pick up the update.
 */
const VERSION = 'v1.1.0';
const SHELL_CACHE = `paisapilot-shell-${VERSION}`;
const FONT_CACHE = 'paisapilot-fonts-v1';

const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest', './firebase-config.js',
  './js/app.js', './js/auth.js', './js/brand.js', './js/charts.js', './js/defaults.js', './js/firebase.js',
  './js/icon-data.js', './js/modal.js', './js/periods.js', './js/store.js', './js/theme-boot.js', './js/ui.js',
  './js/utils.js', './js/version.js',
  './js/views/accounts.js', './js/views/categories.js', './js/views/common.js', './js/views/dashboard.js',
  './js/views/settings.js', './js/views/transactions.js',
  './vendor/firebase.js', './vendor/chart.umd.min.js',
  './assets/icons/favicon.svg', './assets/icons/icon-192.png', './assets/icons/icon-512.png',
  './assets/icons/maskable-192.png', './assets/icons/maskable-512.png', './assets/icons/apple-touch-icon.png'
];

// Hosts whose traffic must never be cached (auth, database, tokens, Firebase APIs).
const NEVER_CACHE = /(^|\.)(googleapis\.com|firebaseio\.com|firebasedatabase\.app|firebaseapp\.com|google\.com|gstatic\.com)$/;
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('paisapilot-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (FONT_HOSTS.has(url.hostname)) { event.respondWith(cacheFirst(req, FONT_CACHE)); return; }
  if (NEVER_CACHE.test(url.hostname)) return;              // straight to network, never stored
  if (url.origin !== self.location.origin) return;         // unknown third parties: not handled
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL_CACHE)).put('./index.html', res.clone());
        return res;
      } catch {
        return (await caches.match('./index.html', { cacheName: SHELL_CACHE })) || Response.error();
      }
    })());
    return;
  }
  event.respondWith(staleWhileRevalidate(req, event));
});

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(network); return cached; }
  return (await network) || Response.error();
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  } catch { return Response.error(); }
}
