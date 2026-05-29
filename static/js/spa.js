// ── SPA Router ───────────────────────────────────────────
const SpaRouter = {
    _loadedScripts: new Set(),
    _currentPage: null,
    _transitioning: false,

    _pageInitMap: {
        '/': 'initDashboard',
        '/trends': 'initTrends',
        '/vaccine': 'initVaccine',
        '/history': 'initHistory',
        '/admin': 'initAdmin',
    },

    init() {
        this._currentPage = location.pathname;
        window.addEventListener('popstate', () => this._onPopState());
        document.addEventListener('click', e => this._onClick(e));
    },

    navigate(url) {
        if (!url || url.startsWith('#') || url.startsWith('javascript:')) return;
        try {
            const u = new URL(url, location.origin);
            if (u.origin !== location.origin) return;
        } catch { return; }

        const path = new URL(url, location.origin).pathname;
        if (path === this._currentPage) return;
        if (this._transitioning) return;

        this._transitioning = true;
        this._loadPage(path, url);
    },

    async _loadPage(path, url) {
        try {
            const sep = url.includes('?') ? '&' : '?';
            const fetchUrl = `${url}${sep}_spa=1`;

            const resp = await fetch(fetchUrl, { credentials: 'same-origin' });
            if (!resp.ok) { location.href = url; return; }

            const html = await resp.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            const newContent = doc.getElementById('spa-content');
            if (!newContent) { location.href = url; return; }

            const currentContent = document.getElementById('spa-content');

            // 淡出 → 替换 → 淡入
            currentContent.style.opacity = '0';
            currentContent.style.transition = 'opacity 0.1s';

            await new Promise(r => setTimeout(r, 100));
            currentContent.innerHTML = newContent.innerHTML;
            currentContent.style.opacity = '1';

            document.title = doc.title || 'Baby Tracker';
            this._updateNavActive(path);

            // 加载未缓存的页面脚本
            const scripts = doc.querySelectorAll('[data-page-script]');
            for (const script of scripts) {
                const src = script.getAttribute('src') || script.dataset.pageScript;
                if (src && !this._loadedScripts.has(src)) {
                    await this._loadScript(src);
                    this._loadedScripts.add(src);
                }
            }

            history.pushState({}, '', url);
            this._currentPage = path;

            // 调用页面初始化函数
            const initFn = this._pageInitMap[path];
            if (initFn && typeof window[initFn] === 'function') {
                window[initFn]();
            }

            if (typeof lucide !== 'undefined') lucide.createIcons();
            window.scrollTo(0, 0);
        } catch (err) {
            console.error('SPA navigation failed:', err);
            location.href = url;
        } finally {
            this._transitioning = false;
        }
    },

    _loadScript(src) {
        return new Promise(resolve => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = resolve;
            document.body.appendChild(s);
        });
    },

    _updateNavActive(path) {
        document.querySelectorAll('.nav-item, .fab-item').forEach(el => {
            const href = el.getAttribute('href');
            el.classList.toggle('active', href === path);
        });
    },

    _onClick(e) {
        const link = e.target.closest('a[href]');
        if (!link) return;

        const href = link.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:') ||
            (href.startsWith('http') && !href.startsWith(location.origin)) ||
            link.hasAttribute('target') || link.hasAttribute('download') ||
            e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
            return;
        }

        let path;
        try { path = new URL(href, location.origin).pathname; }
        catch { return; }

        if (!(path in this._pageInitMap)) return;

        e.preventDefault();
        this.navigate(href);
    },

    _onPopState() {
        const path = location.pathname;
        if (path === this._currentPage) return;
        this._currentPage = path;
        location.reload();
    }
};

document.addEventListener('DOMContentLoaded', () => SpaRouter.init());
