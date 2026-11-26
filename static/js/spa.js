// ── SPA Router ───────────────────────────────────────────
const SpaRouter = {
    _loadedScripts: new Set(),
    _currentPage: null,
    _transitioning: false,
    _pendingNavigation: null,
    _activeFetch: null,
    _activeTransition: null,
    _navigationSerial: 0,
    _routeOrder: ['/', '/trends', '/vaccine', '/admin'],

    _pageInitMap: {
        '/': 'initDashboard',
        '/trends': 'initTrends',
        '/vaccine': 'initVaccine',
        '/admin': 'initAdmin',
    },

    _routePath(path) {
        const base = appBasePath();
        if (base && (path === base || path.startsWith(`${base}/`))) {
            return path.slice(base.length) || '/';
        }
        return path;
    },

    init() {
        this._currentPage = this._routePath(location.pathname);
        document.querySelectorAll('[data-page-script]').forEach(script => {
            const src = script.getAttribute('src') || script.dataset.pageScript;
            if (src) this._loadedScripts.add(src);
        });
        window.addEventListener('popstate', () => this._onPopState());
        document.addEventListener('click', e => this._onClick(e));
    },

    navigate(url) {
        if (!url || url.startsWith('#') || url.startsWith('javascript:')) return;
        try {
            const u = new URL(url, location.origin);
            if (u.origin !== location.origin) return;
        } catch { return; }

        const path = this._routePath(new URL(url, location.origin).pathname);
        if (!(path in this._pageInitMap)) return;
        if (path === this._currentPage) {
            this._navigationSerial += 1;
            this._pendingNavigation = null;
            this._activeFetch?.abort();
            this._cancelPageMotion();
            this._updateNavActive(this._currentPage);
            return;
        }

        this._navigationSerial += 1;
        this._pendingNavigation = {
            id: this._navigationSerial,
            path,
            url,
        };
        this._updateNavActive(path);

        this._activeFetch?.abort();
        this._activeTransition?.skipTransition();
        this._cancelPageMotion();
        if (!this._transitioning) this._drainNavigationQueue();
    },

    async _drainNavigationQueue() {
        if (this._transitioning) return;
        this._transitioning = true;
        try {
            while (this._pendingNavigation) {
                const navigation = this._pendingNavigation;
                this._pendingNavigation = null;
                if (navigation.path === this._currentPage) continue;
                await this._loadPage(navigation);
            }
        } finally {
            this._transitioning = false;
            if (this._pendingNavigation) this._drainNavigationQueue();
        }
    },

    _isNavigationCurrent(navigation) {
        return navigation.id === this._navigationSerial;
    },

    _cancelPageMotion() {
        const content = document.getElementById('spa-content');
        content?.getAnimations().forEach(animation => animation.cancel());
    },

    _directionFor(fromPath, toPath) {
        const fromIndex = this._routeOrder.indexOf(fromPath);
        const toIndex = this._routeOrder.indexOf(toPath);
        return fromIndex >= 0 && toIndex >= 0 && toIndex < fromIndex ? 'backward' : 'forward';
    },

    async _loadPage(navigation) {
        const { path, url } = navigation;
        const controller = new AbortController();
        this._activeFetch = controller;
        try {
            const sep = url.includes('?') ? '&' : '?';
            const fetchUrl = `${appUrl(url)}${sep}_spa=1`;

            const resp = await fetch(fetchUrl, {
                credentials: 'same-origin',
                signal: controller.signal,
            });
            if (!resp.ok) { location.href = url; return; }

            const html = await resp.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            const newContent = doc.getElementById('spa-content');
            if (!newContent) { location.href = url; return; }

            // SPA owns the page transition; avoid stacking a second entrance animation.
            newContent.querySelectorAll('.fade-in').forEach(element => {
                element.classList.remove('fade-in');
            });

            if (!this._isNavigationCurrent(navigation)) return;

            const currentContent = document.getElementById('spa-content');

            // 加载未缓存的页面脚本
            const scripts = doc.querySelectorAll('[data-page-script]');
            for (const script of scripts) {
                const src = script.getAttribute('src') || script.dataset.pageScript;
                if (src && !this._loadedScripts.has(src)) {
                    await this._loadScript(src);
                    this._loadedScripts.add(src);
                }
            }

            if (!this._isNavigationCurrent(navigation)) return;
            const preparedContent = this._prepareContent(newContent);
            await this._commitPage({
                currentContent,
                preparedContent,
                doc,
                navigation,
                path,
                url,
                direction: this._directionFor(this._currentPage, path),
            });
        } catch (err) {
            if (err?.name === 'AbortError') return;
            console.error('SPA navigation failed:', err);
            location.href = url;
        } finally {
            if (this._activeFetch === controller) this._activeFetch = null;
        }
    },

    _prepareContent(newContent) {
        // Prepare nodes and icons before the transition so its update callback
        // only has to move ready-made DOM into place.
        const staging = document.createElement('div');
        staging.hidden = true;
        staging.setAttribute('aria-hidden', 'true');

        const fragment = document.createDocumentFragment();
        newContent.childNodes.forEach(node => {
            fragment.append(document.importNode(node, true));
        });
        staging.append(fragment);
        document.body.append(staging);

        if (typeof lucide !== 'undefined') {
            staging.querySelectorAll('[data-lucide]').forEach(icon => {
                icon.setAttribute('data-lucide-staged', icon.getAttribute('data-lucide'));
                icon.removeAttribute('data-lucide');
            });
            lucide.createIcons({ nameAttr: 'data-lucide-staged' });
        }

        const prepared = document.createDocumentFragment();
        prepared.append(...staging.childNodes);
        staging.remove();
        return prepared;
    },

    async _commitPage({ currentContent, preparedContent, doc, navigation, path, url, direction }) {
        const motion = window.MotionFX;
        let swapped = false;
        const swapContent = () => {
            if (swapped) return;
            swapped = true;
            currentContent.replaceChildren(preparedContent);
            document.title = doc.title || 'Baby Tracker';
            this._updateNavActive(path);
            history.pushState({}, '', appUrl(url));
            this._currentPage = path;
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        };

        const initializePage = () => {
            if (path !== this._currentPage || !this._isNavigationCurrent(navigation)) return;
            const initFn = this._pageInitMap[path];
            if (initFn && typeof window[initFn] === 'function') {
                Promise.resolve(window[initFn]()).catch(err => {
                    console.error(`Page initialization failed for ${path}:`, err);
                });
            }
        };

        if (typeof document.startViewTransition === 'function') {
            document.documentElement.dataset.spaDirection = direction;
            let transition = null;
            try {
                transition = document.startViewTransition(swapContent);
                this._activeTransition = transition;
                transition.ready.catch(() => {});
                await transition.finished;
            } catch {
                // Fall through to the lightweight transition path.
            } finally {
                if (this._activeTransition === transition) this._activeTransition = null;
                delete document.documentElement.dataset.spaDirection;
            }
            if (transition) {
                initializePage();
                return;
            }
        }

        if (swapped) {
            initializePage();
            return;
        }
        if (motion) {
            currentContent.getAnimations().forEach(animation => animation.cancel());
            await motion.pageLeave(currentContent, direction);
        }
        if (!this._isNavigationCurrent(navigation)) return;
        swapContent();
        currentContent.getAnimations().forEach(animation => animation.cancel());
        const enter = motion ? motion.pageEnter(currentContent, direction) : Promise.resolve();
        await enter;
        initializePage();
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
            if (!href) return;
            let linkPath = '';
            try {
                linkPath = this._routePath(new URL(href, location.origin).pathname);
            } catch {
                return;
            }
            const active = linkPath === path;
            el.classList.toggle('active', active);
            if (active) el.setAttribute('aria-current', 'page');
            else el.removeAttribute('aria-current');
        });
    },

    _onClick(e) {
        if (e.defaultPrevented) return;
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
        try { path = this._routePath(new URL(href, location.origin).pathname); }
        catch { return; }

        if (!(path in this._pageInitMap)) return;

        e.preventDefault();
        this.navigate(href);
    },

    _onPopState() {
        const path = this._routePath(location.pathname);
        if (path === this._currentPage) return;
        this._currentPage = path;
        location.reload();
    }
};

document.addEventListener('DOMContentLoaded', () => SpaRouter.init());
