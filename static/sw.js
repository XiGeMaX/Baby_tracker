const CACHE_NAME = 'baby-tracker-v1';
const STATIC_ASSETS = [
    '/',
    '/static/css/style.css',
    '/static/js/app.js',
    '/static/js/dashboard.js',
    '/static/manifest.json'
];

// 安装：预缓存核心资源
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// 请求策略：API 请求走网络，静态资源优先缓存
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    // API 请求始终走网络
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request).catch(() => new Response(JSON.stringify({ error: '离线' }), {
                headers: { 'Content-Type': 'application/json' }
            }))
        );
        return;
    }
    // 其他请求：网络优先，失败回缓存
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
