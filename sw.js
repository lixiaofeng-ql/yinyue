/* 音乐馆 Service Worker
 * - 静态资源（js/css/icon）：缓存优先 + 后台更新
 * - data/*.json：网络优先（每次部署数据都会变，必须拿最新的），断网时回退缓存
 */
const CACHE = 'yinyue-v2';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];
const DATA = [
  'data/charts.json',
  'data/playlists.json',
  'data/songs.json',
  'data/singers.json',
  'data/mvs.json',
  'data/lyrics.json',
  'data/playback.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.all(
        [...SHELL, ...DATA].map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      );
      await self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 网易云播放接口：直接走网络，不缓存
  if (url.hostname.endsWith('music.163.com') || url.hostname.endsWith('126.net')) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // 数据文件：网络优先
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || new Response('{}', { status: 503 }))
        )
    );
    return;
  }

  // 页面导航：网络优先，离线回退首页
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match('index.html'))
    );
    return;
  }

  // 其他静态资源：缓存优先 + 后台更新
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
