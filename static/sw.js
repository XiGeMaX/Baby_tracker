const CACHE_NAME = 'baby-tracker-v4';
const STATIC_ASSETS = [
    '/',
    '/static/css/style.css',
    '/static/css/tailwind.css',
    '/static/js/app.js',
    '/static/js/spa.js',
    '/static/js/dashboard.js',
    '/static/js/trends.js',
    '/static/js/vaccine.js',
    '/static/js/admin.js',
    '/static/js/batch.js',
    '/static/js/records-table.js',
    '/static/manifest.json',
    '/static/icons/icon-192.png',
    '/static/icons/icon-512.png',
    '/static/icons/icon-maskable-512.png'
];

// 安装：预缓存全部核心静态资源（含页面脚本、本地 Tailwind 产物与 PWA 图标）
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// 激活：清理旧版本缓存
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// 请求策略：API 走网络，页面与静态资源网络优先、失败回缓存
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    // 只处理同源 GET；非同源（字体 CDN、Lucide CDN 等）不拦截
    if (url.origin !== self.location.origin || event.request.method !== 'GET') return;

    if (url.pathname.startsWith('/api/')) {
        // 离线时用 503 明确失败，避免前端把 200 {error:'离线'} 当成业务成功
        event.respondWith(
            fetch(event.request).catch(() => new Response(JSON.stringify({ error: '离线，无法连接服务器' }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            }))
        );
        return;
    }
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
