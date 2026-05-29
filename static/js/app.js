// ── Local Date Helper ────────────────────────────────────
function getLocalDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Toast ─────────────────────────────────────────────────
function showToast(msg) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-msg');
    toastMsg.textContent = msg;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hidden');
    }, 2500);
}

// ── API Helper ───────────────────────────────────────────
async function api(url, options = {}) {
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
            modal.className = 'fixed inset-0 z-[95] hidden items-center justify-center bg-black/60';
            document.body.appendChild(modal);
        }
        const btnClass = danger
            ? 'bg-red-500/20 border-red-500/40 text-red-400 hover:bg-red-500/30'
            : 'bg-accent/20 border-accent/40 text-accent hover:bg-accent/30';
        modal.innerHTML = `
        <div class="bg-surface border border-border rounded-xl p-6 w-80 max-w-[90vw]">
            <p class="text-sm text-text-primary mb-5">${esc(message)}</p>
            <div class="flex gap-2">
                <button id="confirm-cancel" class="btn-secondary flex-1 text-sm">取消</button>
                <button id="confirm-ok" class="flex-1 text-sm px-4 py-2 rounded-lg border transition-colors ${btnClass}">${esc(confirmText || '确定')}</button>
            </div>
        </div>`;
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        // 关闭FAB悬浮导航，避免冲突
        if (typeof fabClose === 'function') fabClose();

        const close = (result) => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            resolve(result);
        };
        document.getElementById('confirm-cancel').onclick = () => close(false);
        document.getElementById('confirm-ok').onclick = () => close(true);
        modal.onclick = (e) => { if (e.target === modal) close(false); };
    });
}

// ── Shared Edit Modal ────────────────────────────────────
const EDIT_SUB_TYPES = {
    feed: [
        { value: 'breast_left', label: '母乳(左)' },
        { value: 'breast_right', label: '母乳(右)' },
        { value: 'formula', label: '配方奶' },
        { value: 'water', label: '水' },
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
        modal.className = 'fixed inset-0 z-[90] hidden items-center justify-center bg-black/60';
        document.body.appendChild(modal);
    }

    const ts = r.timestamp ? r.timestamp.replace(' ', 'T').slice(0, 16) : '';

    modal.innerHTML = `
    <div class="bg-surface border border-border rounded-xl p-6 w-[420px] max-w-[90vw] max-h-[85vh] overflow-y-auto">
        <h3 class="text-sm font-medium text-text-secondary mb-4">编辑记录 #${r.id}</h3>
        <div class="space-y-3">
            <div>
                <label class="text-text-muted text-xs mb-1 block">类型</label>
                <select id="edit-type" class="input-field" onchange="_onEditTypeChange()">
                    <option value="feed" ${r.type==='feed'?'selected':''}>喂养</option>
                    <option value="excrete" ${r.type==='excrete'?'selected':''}>排泄</option>
                    <option value="symptom" ${r.type==='symptom'?'selected':''}>症状</option>
                    <option value="supplement" ${r.type==='supplement'?'selected':''}>补充</option>
                </select>
            </div>
            <div>
                <label class="text-text-muted text-xs mb-1 block">子类型</label>
                <select id="edit-subtype" class="input-field" onchange="_onEditTypeChange()"></select>
            </div>
            <div id="edit-custom-subtype-wrap" class="hidden">
                <label class="text-text-muted text-xs mb-1 block">自定义子类型名称</label>
                <input type="text" id="edit-custom-subtype-input" class="input-field" placeholder="如：维D滴剂">
            </div>
            <div>
                <label class="text-text-muted text-xs mb-1 block">量 (ml)</label>
                <input type="number" id="edit-amount" class="input-field font-mono" value="${esc(r.amount || '')}" min="0">
            </div>
            <div>
                <label class="text-text-muted text-xs mb-1 block">时长 (分钟)</label>
                <input type="number" id="edit-duration" class="input-field font-mono" value="${esc(r.duration || '')}" min="0">
            </div>
            <div>
                <label class="text-text-muted text-xs mb-1 block">颜色</label>
                <input type="text" id="edit-color" class="input-field" value="${esc(r.color || '')}">
            </div>
            <div>
                <label class="text-text-muted text-xs mb-1 block">性状</label>
                <input type="text" id="edit-consistency" class="input-field" value="${esc(r.consistency || '')}">
            </div>
            <div>
                <label class="text-text-muted text-xs mb-1 block">体温 (°C)</label>
                <input type="number" id="edit-temperature" class="input-field font-mono" value="${esc(r.temperature || '')}" step="0.1">
            </div>
            <div>
                <label class="text-text-muted text-xs mb-1 block">时间</label>
                <input type="datetime-local" id="edit-timestamp" class="input-field font-mono" value="${esc(ts)}">
            </div>
            <div>
                <label class="text-text-muted text-xs mb-1 block">备注</label>
                <input type="text" id="edit-note" class="input-field" value="${esc(r.note || '')}">
            </div>
        </div>
        <div class="flex gap-2 mt-4">
            <button class="btn-secondary flex-1 text-sm" onclick="closeEditModal()">取消</button>
            <button class="btn-primary flex-1 text-sm" onclick="_saveEditRecord(${r.id})">保存</button>
        </div>
    </div>`;

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // 关闭FAB悬浮导航，避免冲突
    if (typeof fabClose === 'function') fabClose();

    window._editCurrentSubType = r.sub_type;
    _onEditTypeChange();
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
    window._editCurrentSubType = sel.value;
    const wrap = document.getElementById('edit-custom-subtype-wrap');
    if (wrap) wrap.classList.toggle('hidden', sel.value !== '_custom');
}

function closeEditModal() {
    const modal = document.getElementById('edit-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
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
    const data = {
        type: document.getElementById('edit-type').value,
        sub_type: subType,
        amount: document.getElementById('edit-amount').value ? parseFloat(document.getElementById('edit-amount').value) : null,
        duration: document.getElementById('edit-duration').value ? parseInt(document.getElementById('edit-duration').value) : null,
        color: document.getElementById('edit-color').value,
        consistency: document.getElementById('edit-consistency').value,
        temperature: document.getElementById('edit-temperature').value ? parseFloat(document.getElementById('edit-temperature').value) : null,
        note: document.getElementById('edit-note').value,
        timestamp: document.getElementById('edit-timestamp').value
            ? document.getElementById('edit-timestamp').value.replace('T', ' ') + ':00'
            : null,
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
