// ── Local Date Helper ────────────────────────────────────
function getLocalDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Base-path-aware URL Helper ───────────────────────────
function appBasePath() {
    return (document.documentElement.dataset.appBase || '').replace(/\/+$/, '');
}

function appUrl(path) {
    const value = String(path || '');
    if (/^(?:[a-z]+:)?\/\//i.test(value) || value.startsWith('#') || value.startsWith('javascript:')) {
        return value;
    }
    const normalized = value.startsWith('/') ? value : `/${value}`;
    const base = appBasePath();
    if (base && (normalized === base || normalized.startsWith(`${base}/`))) {
        return normalized;
    }
    return `${base}${normalized}`;
}

// ── Toast ─────────────────────────────────────────────────
const TOAST_VISIBLE_LIMIT = 3;
const TOAST_STACK_OFFSET = 10;
const TOAST_EXIT_MS = 180;
const toastTimers = new WeakMap();
let toastSequence = 0;

const TOAST_TYPES = {
    success: { icon: 'check-circle', duration: 3600 },
    info: { icon: 'info', duration: 3800 },
    warning: { icon: 'triangle-alert', duration: 4400 },
    error: { icon: 'circle-alert', duration: 5200 },
};

function resolveToastType(message, requestedType) {
    if (Object.prototype.hasOwnProperty.call(TOAST_TYPES, requestedType)) return requestedType;
    if (/请(?:先|输入|选择|至少)|不一致|长度应为|不能为空/.test(message)) return 'warning';
    if (/失败|错误|异常|无法|不存在|\b(?:failed|failure|error|network|fetch)\b/i.test(message)) return 'error';
    return 'success';
}

function positionToastStack() {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;

    const toasts = Array.from(stack.querySelectorAll('.toast-item:not(.is-leaving)'));
    let maxHeight = 0;
    toasts.slice(0, TOAST_VISIBLE_LIMIT).forEach((toast, index) => {
        const depth = Math.min(index, TOAST_VISIBLE_LIMIT - 1);
        toast.style.setProperty('--toast-y', `${depth * TOAST_STACK_OFFSET}px`);
        toast.style.setProperty('--toast-scale', String(1 - depth * 0.035));
        toast.style.setProperty('--toast-opacity', String(1 - depth * 0.22));
        toast.style.zIndex = String(TOAST_VISIBLE_LIMIT - depth);
        toast.setAttribute('aria-hidden', index === 0 ? 'false' : 'true');
        maxHeight = Math.max(maxHeight, toast.offsetHeight);
    });

    const visibleCount = Math.min(toasts.length, TOAST_VISIBLE_LIMIT);
    const stackHeight = visibleCount > 0
        ? maxHeight + (visibleCount - 1) * TOAST_STACK_OFFSET
        : 0;
    stack.style.height = `${stackHeight}px`;
    stack.classList.toggle('has-toasts', toasts.length > 0);
}

function dismissToast(toast) {
    if (!toast || toast.classList.contains('is-leaving')) return;

    const timer = toastTimers.get(toast);
    if (timer) clearTimeout(timer);
    toastTimers.delete(toast);
    toast.classList.add('is-leaving');
    toast.setAttribute('aria-hidden', 'true');
    positionToastStack();

    const finish = () => {
        toast.remove();
        positionToastStack();
    };
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || typeof toast.animate !== 'function') {
        requestAnimationFrame(finish);
        return;
    }

    const computed = getComputedStyle(toast);
    const animation = toast.animate([
        {
            opacity: computed.opacity,
            transform: computed.transform,
            filter: computed.filter,
        },
        {
            opacity: 0,
            transform: 'translate3d(0, -8px, 0) scale(0.98)',
            filter: 'blur(2px)',
        },
    ], {
        duration: TOAST_EXIT_MS,
        easing: 'cubic-bezier(0.4, 0, 1, 1)',
        fill: 'forwards',
    });
    animation.finished.catch(() => {}).finally(finish);
}

function hideToast() {
    const stack = document.getElementById('toast-stack');
    const frontToast = stack?.querySelector('.toast-item:not(.is-leaving)');
    if (frontToast) dismissToast(frontToast);
}

function showToast(message, typeOrOptions = null) {
    const text = String(message ?? '').trim();
    const stack = document.getElementById('toast-stack');
    if (!text || !stack) return null;

    const options = typeOrOptions && typeof typeOrOptions === 'object'
        ? typeOrOptions
        : { type: typeOrOptions };
    const type = resolveToastType(text, options.type);
    const config = TOAST_TYPES[type];

    const toast = document.createElement('article');
    toast.className = `toast-item toast-item--${type} is-entering`;
    toast.dataset.toastType = type;
    toast.dataset.toastOrder = String(++toastSequence);
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    toast.setAttribute('aria-atomic', 'true');

    const iconSlot = document.createElement('span');
    iconSlot.className = 'toast-icon-slot';
    iconSlot.setAttribute('aria-hidden', 'true');
    const icon = document.createElement('i');
    icon.dataset.lucide = config.icon;
    icon.className = 'toast-icon';
    iconSlot.appendChild(icon);

    const copy = document.createElement('p');
    copy.className = 'toast-message';
    copy.textContent = text;
    toast.append(iconSlot, copy);
    stack.prepend(toast);

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }

    positionToastStack();
    requestAnimationFrame(() => toast.classList.remove('is-entering'));

    const activeToasts = Array.from(stack.querySelectorAll('.toast-item:not(.is-leaving)'));
    activeToasts.slice(TOAST_VISIBLE_LIMIT).forEach(dismissToast);

    const duration = Number.isFinite(options.duration)
        ? Math.max(1200, Number(options.duration))
        : config.duration;
    const timer = setTimeout(() => dismissToast(toast), duration);
    toastTimers.set(toast, timer);
    return toast;
}

// ── API Helper ───────────────────────────────────────────
async function api(url, options = {}) {
    url = appUrl(url);
    // GET 请求加时间戳防缓存
    if (!options.method || options.method === 'GET') {
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}_t=${Date.now()}`;
    }
    const resp = await fetch(url, {
        cache: 'no-store',
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || '请求失败');
    }
    return resp.json();
}

// ── HTML Escape ──────────────────────────────────────────
const ESC_MAP = { '&': '&amp;', '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;' };
function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&"'<>]/g, c => ESC_MAP[c]);
}

// ── Shared Modal Lifecycle ───────────────────────────────
const appModalStack = [];
const APP_MODAL_EXIT_MS = 240;

function openAppModal(modal, { focusSelector, onDismiss } = {}) {
    if (!modal) return;
    clearTimeout(modal._appModalCloseTimer);
    modal._appModalCloseTimer = null;
    const openIndex = appModalStack.indexOf(modal);
    if (openIndex >= 0) appModalStack.splice(openIndex, 1);

    modal._previousFocus = document.activeElement;
    modal._appModalDismiss = onDismiss || null;
    appModalStack.push(modal);
    document.body.classList.add('app-modal-open');
    modal.classList.remove('hidden', 'is-closing');
    modal.classList.add('flex');
    modal.setAttribute('aria-hidden', 'false');

    if (!modal.dataset.appModalBound) {
        modal.addEventListener('click', event => {
            if (event.target === modal) dismissAppModal(modal);
        });
        modal.dataset.appModalBound = 'true';
    }

    if (typeof fabClose === 'function') fabClose();
    requestAnimationFrame(() => {
        modal.classList.add('is-open');
        if (focusSelector) modal.querySelector(focusSelector)?.focus();
    });
}

function closeAppModal(modal) {
    if (!modal || modal.classList.contains('hidden')) return;
    clearTimeout(modal._appModalCloseTimer);
    modal.classList.add('is-closing');
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');

    const stackIndex = appModalStack.indexOf(modal);
    if (stackIndex >= 0) appModalStack.splice(stackIndex, 1);

    const previous = modal._previousFocus;
    modal._previousFocus = null;
    modal._appModalDismiss = null;
    if (previous && document.contains(previous)) requestAnimationFrame(() => previous.focus());

    const release = () => {
        if (appModalStack.includes(modal)) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex', 'is-closing');
        document.body.classList.toggle('app-modal-open', appModalStack.length > 0);
    };
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
        release();
        return;
    }
    modal._appModalCloseTimer = setTimeout(() => {
        modal._appModalCloseTimer = null;
        release();
    }, APP_MODAL_EXIT_MS);
}

function dismissAppModal(modal) {
    if (!modal) return;
    if (typeof modal._appModalDismiss === 'function') {
        modal._appModalDismiss();
        return;
    }
    closeAppModal(modal);
}

document.addEventListener('keydown', event => {
    if (event.defaultPrevented || appModalStack.length === 0) return;
    const modal = appModalStack[appModalStack.length - 1];
    if (event.key === 'Escape') {
        event.preventDefault();
        dismissAppModal(modal);
        return;
    }
    if (event.key !== 'Tab' || !modal.contains(document.activeElement)) return;

    const focusable = Array.from(modal.querySelectorAll(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )).filter(element => element.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
});

// ── Format Time ──────────────────────────────────────────
function formatTime(ts) {
    if (!ts) return '--:--';
    const d = new Date(ts.replace(' ', 'T'));
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
    if (!ts) return '--';
    const d = new Date(ts.replace(' ', 'T'));
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function formatDateTime(ts) {
    if (!ts) return '--';
    const d = new Date(ts.replace(' ', 'T'));
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' +
           d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// ── Record Type Labels ───────────────────────────────────
const TYPE_LABELS = {
    feed: '喂养',
    excrete: '排泄',
    symptom: '症状',
    supplement: '补充'
};

const SUB_TYPE_LABELS = {
    breast_left: '母乳(左)',
    breast_right: '母乳(右)',
    formula: '配方奶',
    water: '水',
    solid_food: '辅食',
    urine: '尿',
    stool: '便',
    both: '尿+便',
    vomit: '呕吐',
    fever: '发热',
    jaundice: '黄疸',
    rash: '皮疹',
    vitamin_d: '维D',
    vitamin_ad: '维AD',
    iron: '铁剂',
    calcium: '钙剂',
    dha: 'DHA',
    probiotics: '益生菌'
};

// 预设辅食计量单位
const FOOD_UNIT_PRESETS = ['g', '勺', '块'];

function typeLabel(type, subType) {
    if (subType && SUB_TYPE_LABELS[subType]) return SUB_TYPE_LABELS[subType];
    if (subType && !SUB_TYPE_LABELS[subType]) return subType;
    return TYPE_LABELS[type] || type;
}

// ── SVG Progress Ring ────────────────────────────────────
function setProgressRing(svgEl, progress) {
    const circle = svgEl.querySelector('.progress-ring-circle');
    if (!circle) return;
    const r = parseFloat(circle.getAttribute('r'));
    const circumference = 2 * Math.PI * r;
    circle.style.strokeDasharray = circumference;
    circle.style.strokeDashoffset = circumference * (1 - Math.min(1, Math.max(0, progress)));
}

// ── Custom Confirm Dialog ────────────────────────────────
function showConfirm(message, { confirmText, danger } = {}) {
    return new Promise(resolve => {
        let modal = document.getElementById('confirm-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'confirm-modal';
            modal.className = 'app-modal hidden items-center justify-center';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.setAttribute('aria-labelledby', 'confirm-modal-title');
            document.body.appendChild(modal);
        }
        const btnClass = danger ? 'btn-danger' : 'btn-primary';
        modal.innerHTML = `
        <div class="app-modal-panel">
            <h3 id="confirm-modal-title" class="app-modal-title mb-3">请确认</h3>
            <p class="text-sm text-text-secondary mb-5">${esc(message)}</p>
            <div class="modal-actions">
                <button type="button" id="confirm-cancel" class="btn-secondary text-sm">取消</button>
                <button type="button" id="confirm-ok" class="${btnClass} text-sm">${esc(confirmText || '确定')}</button>
            </div>
        </div>`;

        const close = (result) => {
            closeAppModal(modal);
            resolve(result);
        };
        document.getElementById('confirm-cancel').onclick = () => close(false);
        document.getElementById('confirm-ok').onclick = () => close(true);
        openAppModal(modal, {
            focusSelector: '#confirm-cancel',
            onDismiss: () => close(false),
        });
    });
}

// ── Shared Edit Modal ────────────────────────────────────
const EDIT_SUB_TYPES = {
    feed: [
        { value: 'breast_left', label: '母乳(左)' },
        { value: 'breast_right', label: '母乳(右)' },
        { value: 'formula', label: '配方奶' },
        { value: 'water', label: '水' },
        { value: 'solid_food', label: '辅食' },
        { value: '_custom', label: '自定义...' },
    ],
    excrete: [
        { value: 'urine', label: '尿' },
        { value: 'stool', label: '便' },
        { value: 'both', label: '尿+便' },
    ],
    symptom: [
        { value: 'vomit', label: '呕吐' },
        { value: 'fever', label: '发热' },
        { value: 'jaundice', label: '黄疸' },
        { value: 'rash', label: '皮疹' },
        { value: '_custom', label: '自定义...' },
    ],
    supplement: [
        { value: 'vitamin_d', label: '维D' },
        { value: 'vitamin_ad', label: '维AD' },
        { value: 'iron', label: '铁剂' },
        { value: 'calcium', label: '钙剂' },
        { value: 'dha', label: 'DHA' },
        { value: 'probiotics', label: '益生菌' },
        { value: '_custom', label: '自定义...' },
    ]
};

let _editOnSave = null; // 保存后回调

async function openEditModal(id, onSave) {
    try {
        const r = await api(`/api/records/${id}`);
        _editOnSave = onSave || null;
        _showEditModal(r);
    } catch (e) {
        showToast(e.message || '加载失败');
    }
}

function _showEditModal(r) {
    let modal = document.getElementById('edit-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'edit-modal';
        modal.className = 'app-modal hidden items-center justify-center';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'edit-modal-title');
        document.body.appendChild(modal);
    }

    const ts = r.timestamp || '';

    modal.innerHTML = `
    <div class="app-modal-panel">
        <h3 id="edit-modal-title" class="app-modal-title mb-4">编辑记录 #${r.id}</h3>
        <div class="space-y-3">
            <div>
                <label class="field-label" for="edit-type">类型</label>
                <select id="edit-type" class="input-field" onchange="_onEditTypeChange()">
                    <option value="feed" ${r.type==='feed'?'selected':''}>喂养</option>
                    <option value="excrete" ${r.type==='excrete'?'selected':''}>排泄</option>
                    <option value="symptom" ${r.type==='symptom'?'selected':''}>症状</option>
                    <option value="supplement" ${r.type==='supplement'?'selected':''}>补充</option>
                </select>
            </div>
            <div>
                <label class="field-label" for="edit-subtype">子类型</label>
                <select id="edit-subtype" class="input-field" onchange="_onEditSubtypeChange()"></select>
            </div>
            <div id="edit-custom-subtype-wrap" class="hidden">
                <label class="field-label" for="edit-custom-subtype-input">自定义子类型名称</label>
                <input type="text" id="edit-custom-subtype-input" class="input-field" placeholder="如：维D滴剂">
            </div>
            <div id="edit-food-unit-wrap" class="hidden">
                <label class="field-label" for="edit-food-unit">辅食计量单位</label>
                <div class="flex gap-2 items-center">
                    <select id="edit-food-unit" class="input-field flex-1" onchange="_onEditFoodUnitChange()">
                        <option value="g">g (克)</option>
                        <option value="勺">勺</option>
                        <option value="块">块</option>
                        <option value="_custom">自定义...</option>
                    </select>
                    <input type="text" id="edit-food-unit-custom" class="input-field flex-1 hidden" placeholder="如：ml、份" oninput="_updateAmountLabel()">
                </div>
            </div>
            <div>
                <label id="edit-amount-label" class="field-label" for="edit-amount">量 (ml)</label>
                <input type="number" id="edit-amount" class="input-field font-mono" value="${esc(r.amount || '')}" min="0">
            </div>
            <div>
                <label class="field-label" for="edit-duration">时长 (分钟)</label>
                <input type="number" id="edit-duration" class="input-field font-mono" value="${esc(r.duration || '')}" min="0">
            </div>
            <div>
                <label class="field-label" for="edit-color">颜色</label>
                <input type="text" id="edit-color" class="input-field" value="${esc(r.color || '')}">
            </div>
            <div>
                <label class="field-label" for="edit-consistency">性状</label>
                <input type="text" id="edit-consistency" class="input-field" value="${esc(r.consistency || '')}">
            </div>
            <div>
                <label class="field-label" for="edit-temperature">体温 (°C)</label>
                <input type="number" id="edit-temperature" class="input-field font-mono" value="${esc(r.temperature || '')}" step="0.1">
            </div>
            <div>
                <label class="field-label" for="edit-date">日期</label>
                <input type="date" id="edit-date" class="input-field font-mono" value="${esc(ts.slice(0,10))}">
            </div>
            <div>
                <label class="field-label" for="edit-time">时间</label>
                <input type="time" id="edit-time" class="input-field font-mono" value="${esc(ts.slice(11,16))}">
            </div>
            <div>
                <label class="field-label" for="edit-note">备注</label>
                <input type="text" id="edit-note" class="input-field" value="${esc(r.note || '')}">
            </div>
        </div>
        <div class="modal-actions">
            <button type="button" class="btn-secondary text-sm" onclick="closeEditModal()">取消</button>
            <button type="button" class="btn-primary text-sm" onclick="_saveEditRecord(${r.id})">保存</button>
        </div>
    </div>`;

    window._editCurrentSubType = r.sub_type;
    window._editCurrentFoodUnit = r.food_unit || '';
    _onEditTypeChange();
    _syncFoodUnitUI();
    openAppModal(modal, {
        focusSelector: '#edit-type-trigger, #edit-type',
        onDismiss: closeEditModal,
    });
}

function _onEditTypeChange() {
    const type = document.getElementById('edit-type').value;
    const sel = document.getElementById('edit-subtype');
    const options = EDIT_SUB_TYPES[type] || [];
    const currentSub = window._editCurrentSubType;
    const knownValues = new Set(options.map(s => s.value));
    sel.innerHTML = options.map(s =>
        `<option value="${s.value}" ${s.value === currentSub ? 'selected' : ''}>${s.label}</option>`
    ).join('');
    if (currentSub && !knownValues.has(currentSub) && currentSub !== '_custom') {
        sel.innerHTML += `<option value="${esc(currentSub)}" selected>${esc(currentSub)}</option>`;
    }
    const wrap = document.getElementById('edit-custom-subtype-wrap');
    if (wrap) wrap.classList.toggle('hidden', sel.value !== '_custom');
    if (sel.value === '_custom') {
        const ci = document.getElementById('edit-custom-subtype-input');
        if (ci && currentSub && currentSub !== '_custom' && !knownValues.has(currentSub)) {
            ci.value = currentSub;
        }
    }
    _syncFoodUnitUI();
    _updateAmountLabel();
}

function _onEditSubtypeChange() {
    const sel = document.getElementById('edit-subtype');
    const wrap = document.getElementById('edit-custom-subtype-wrap');
    if (wrap) wrap.classList.toggle('hidden', sel.value !== '_custom');
    if (sel.value === '_custom') {
        const ci = document.getElementById('edit-custom-subtype-input');
        if (ci) ci.focus();
    }
    _syncFoodUnitUI();
    _updateAmountLabel();
}

// 同步辅食计量单位 UI 显示
function _syncFoodUnitUI() {
    const sel = document.getElementById('edit-subtype');
    if (!sel) return;
    const isSolid = sel.value === 'solid_food';
    const wrap = document.getElementById('edit-food-unit-wrap');
    if (wrap) wrap.classList.toggle('hidden', !isSolid);
    if (isSolid) {
        const unitSel = document.getElementById('edit-food-unit');
        const customInput = document.getElementById('edit-food-unit-custom');
        const curUnit = window._editCurrentFoodUnit || '';
        if (unitSel && customInput) {
            if (FOOD_UNIT_PRESETS.includes(curUnit)) {
                unitSel.value = curUnit;
                customInput.classList.add('hidden');
                customInput.value = '';
            } else if (curUnit) {
                unitSel.value = '_custom';
                customInput.classList.remove('hidden');
                customInput.value = curUnit;
            } else {
                unitSel.value = 'g';
                customInput.classList.add('hidden');
                customInput.value = '';
            }
        }
    }
}

// 切换辅食单位自定义输入框显示
function _onEditFoodUnitChange() {
    const unitSel = document.getElementById('edit-food-unit');
    const customInput = document.getElementById('edit-food-unit-custom');
    if (!unitSel || !customInput) return;
    if (unitSel.value === '_custom') {
        customInput.classList.remove('hidden');
        customInput.focus();
    } else {
        customInput.classList.add('hidden');
        customInput.value = '';
    }
    _updateAmountLabel();
}

// 根据子类型与单位更新"量"标签
function _updateAmountLabel() {
    const sel = document.getElementById('edit-subtype');
    const label = document.getElementById('edit-amount-label');
    if (!sel || !label) return;
    if (sel.value === 'solid_food') {
        const unitSel = document.getElementById('edit-food-unit');
        const customInput = document.getElementById('edit-food-unit-custom');
        let unit = 'g';
        if (unitSel) {
            if (unitSel.value === '_custom' && customInput && customInput.value) {
                unit = customInput.value;
            } else if (unitSel.value !== '_custom') {
                unit = unitSel.value;
            }
        }
        label.textContent = `量 (${unit})`;
    } else {
        label.textContent = '量 (ml)';
    }
}

function closeEditModal() {
    const modal = document.getElementById('edit-modal');
    closeAppModal(modal);
}

async function _saveEditRecord(id) {
    let subType = document.getElementById('edit-subtype').value;
    if (subType === '_custom') {
        subType = document.getElementById('edit-custom-subtype-input').value.trim();
        if (!subType) {
            showToast('请输入自定义子类型名称');
            return;
        }
    }
    // 解析辅食计量单位
    let foodUnit = '';
    if (subType === 'solid_food') {
        const unitSel = document.getElementById('edit-food-unit');
        const customInput = document.getElementById('edit-food-unit-custom');
        if (unitSel && unitSel.value === '_custom') {
            foodUnit = customInput ? customInput.value.trim() : '';
            if (!foodUnit) {
                showToast('请输入或选择辅食计量单位');
                return;
            }
        } else if (unitSel) {
            foodUnit = unitSel.value;
        } else {
            foodUnit = 'g';
        }
    }
    const data = {
        type: document.getElementById('edit-type').value,
        sub_type: subType,
        amount: document.getElementById('edit-amount').value ? parseFloat(document.getElementById('edit-amount').value) : null,
        duration: document.getElementById('edit-duration').value ? parseInt(document.getElementById('edit-duration').value) : null,
        color: document.getElementById('edit-color').value,
        consistency: document.getElementById('edit-consistency').value,
        temperature: document.getElementById('edit-temperature').value ? parseFloat(document.getElementById('edit-temperature').value) : null,
        note: document.getElementById('edit-note').value,
        timestamp: (document.getElementById('edit-date').value && document.getElementById('edit-time').value)
            ? document.getElementById('edit-date').value + ' ' + document.getElementById('edit-time').value + ':00'
            : null,
        food_unit: foodUnit,
        _date: getLocalDate(),
    };

    try {
        const result = await api(`/api/records/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('记录已更新');
        closeEditModal();
        // 将 API 返回的概览数据传递给回调，避免二次 GET 请求
        if (typeof _editOnSave === 'function') _editOnSave(result);
    } catch (e) {
        showToast(e.message || '更新失败');
    }
}
