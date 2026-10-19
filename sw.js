/*
 * Service worker: lets MTG Tracker and the Simulator open without internet, and installs them
 * as an app on phones and computers.
 *
 * - The app's own files are fetched from the network first, so you always get the latest version
 *   when online. A copy is kept for when you're offline.
 * - Card images (cards.scryfall.io) are kept after the first time you see them, so your collection
 *   still has pictures offline. "Save card images for offline" on the Account & backup tab
 *   downloads them all at once.
 * - Everything else (Scryfall lookups and prices, the deck relay, online play) needs internet.
 *
 * Only runs when the app is opened from a web address, not by double-clicking index.html.
 */
const APP_CACHE = 'mtg-app';
const IMAGE_CACHE = 'mtg-images'; // also filled by app.js ("Save card images for offline")
const MAX_IMAGES = 6000;

const APP_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/parser.js', 'js/store.js', 'js/backup.js', 'js/account.js', 'js/scryfall.js', 'js/archidekt.js', 'js/moxfield.js',
  'js/deckcheck.js', 'js/charts.js', 'js/app.js',
  'icons/icon-192.png', 'icons/favicon-32.png',
  'simulator/index.html', 'simulator/css/styles.css', 'simulator/js/tracker-link.js', 'simulator/js/game.js',
  'simulator/js/odds.js', 'simulator/js/bot.js', 'simulator/js/autoplay.js', 'simulator/js/brackets.js', 'simulator/js/online.js', 'simulator/js/app.js',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE).then(cache => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) event.respondWith(networkFirst(req, url));
  else if (url.hostname === 'cards.scryfall.io') event.respondWith(cachedImage(req));
});

// The app's own files: the network when it answers, otherwise the saved copy. The deploy adds
// ?v=<version> to links, so copies are saved under the address without it and each new version
// replaces the last.
async function networkFirst(req, url) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) {
      const clean = url.origin + url.pathname;
      await cache.put(clean, res.clone());
    }
    return res;
  } catch (err) {
    const saved = await cache.match(url.origin + url.pathname)
      || (req.mode === 'navigate' && await cache.match(new URL('index.html', self.registration.scope).href));
    if (saved) return saved;
    throw err;
  }
}

// Card images: the saved copy when there is one, otherwise download and save it. Images are
// fetched with CORS (Scryfall allows it) so the browser stores them at their real size.
async function cachedImage(req) {
  const cache = await caches.open(IMAGE_CACHE);
  const saved = await cache.match(req.url);
  if (saved) return saved;
  try {
    const res = await fetch(req.url, { mode: 'cors' });
    if (res.ok) {
      await cache.put(req.url, res.clone());
      trimImages(cache);
    }
    return res;
  } catch (err) {
    return fetch(req); // let the browser show its usual broken image
  }
}

// Keeps the newest MAX_IMAGES. Checked every 100 new images, since listing the cache isn't free.
let added = 0;
let trimming = false;
async function trimImages(cache) {
  if (trimming || ++added % 100) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))) await cache.delete(key);
  } finally {
    trimming = false;
  }
}
