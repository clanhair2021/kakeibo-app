// sw.js (最小限のService Worker)
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  // 通常のネットワークリクエストを処理
});
