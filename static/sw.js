const CACHE_NAME = 'baby-tracker-v7';
const APP_BASE = new URL(self.registration.scope).pathname.replace(/\/+$/, '');
const appUrl = path => `${APP_BASE}${path}`;
const STATIC_ASSETS = [
    appUrl('/'),
    appUrl('/static/css/style.css'),
    appUrl('/static/js/motion.js'),
    appUrl('/static/js/app.js'),
    appUrl('/static/js/dashboard.js'),
    appUrl('/static/vendor/tailwindcss.min.js'),
    appUrl('/static/vendor/lucide.min.js'),
    appUrl('/static/vendor/chart.js-4.4.7.min.js'),
    appUrl('/static/manifest.json'),
    appUrl('/static/icons/icon-180.png'),
    appUrl('/static/icons/icon-192.png'),
    appUrl('/static/icons/icon-512.png')
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
    if (url.pathname.includes('/api/')) {
        event.respondWith(
            fetch(event.request).catch(() => new Response(JSON.stringify({ error: '离线' }), {
                headers: { 'Content-Type': 'application/json' }
            }))
        );
        return;
    }
    // 其他请求：网络优先，失败回缓存
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
});
