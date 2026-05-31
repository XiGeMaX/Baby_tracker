// ── Admin Page ───────────────────────────────────────────
const SUB_TYPES = {
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

let _adminEventsInit = false;

function initAdmin() {
    Promise.all([loadBaby(), loadSettings(), loadStats(), loadUsers(), loadButtons(), loadLogs(), loadHaApiKey()]);
    updateSubTypes();
    if (!_adminEventsInit) {
        _adminEventsInit = true;
        document.addEventListener('click', e => {
            const resetBtn = e.target.closest('[data-reset-pw]');
            if (resetBtn) showResetPasswordModal(parseInt(resetBtn.dataset.resetPw), resetBtn.dataset.resetName);
            const renameBtn = e.target.closest('[data-rename-user]');
            if (renameBtn) showRenameUserModal(parseInt(renameBtn.dataset.renameUser), renameBtn.dataset.renameName);
        });
    }
}

document.addEventListener('DOMContentLoaded', initAdmin);

// ── Users ────────────────────────────────────────────────
async function loadUsers() {
    try {
        const users = await api('/api/users');
        renderUsers(users);
    } catch (e) {
        document.getElementById('users-list').innerHTML =
            `<p class="text-red-400 text-sm text-center py-4">${e.message}</p>`;
    }
}

function renderUsers(users) {
    const container = document.getElementById('users-list');
    const pendingCount = users.filter(u => u.status === 'pending').length;
    const badge = document.getElementById('pending-badge');

    if (pendingCount > 0) {
        badge.style.display = 'inline';
        badge.textContent = `${pendingCount} 待审批`;
    } else {
        badge.style.display = 'none';
    }

    if (users.length === 0) {
        container.innerHTML = '<p class="text-text-muted text-sm text-center py-4">暂无用户</p>';
        return;
    }

    container.innerHTML = users.map(u => {
        const statusColors = {
            approved: 'text-accent bg-accent/10 border-accent/30',
            pending: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
            rejected: 'text-red-400 bg-red-500/10 border-red-500/30'
        };
        const statusLabels = { approved: '已批准', pending: '待审批', rejected: '已拒绝' };
        const sc = statusColors[u.status] || statusColors.pending;
        const sl = statusLabels[u.status] || u.status;

        let actions = '';
        if (u.status === 'pending') {
            actions = `
                <button class="text-xs px-2 py-1 rounded border border-accent/30 text-accent hover:bg-accent/10 transition-colors" onclick="approveUser(${u.id})">批准</button>
                <button class="text-xs px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors" onclick="rejectUser(${u.id})">拒绝</button>`;
        } else if (u.status === 'rejected') {
            actions = `<button class="text-xs px-2 py-1 rounded border border-accent/30 text-accent hover:bg-accent/10 transition-colors" onclick="approveUser(${u.id})">重新批准</button>`;
        }
        actions += ` <button class="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-amber-400 hover:border-amber-500/30 transition-colors" data-reset-pw="${u.id}" data-reset-name="${esc(u.nickname || u.username)}">改密</button>`;
        actions += ` <button class="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-blue-400 hover:border-blue-500/30 transition-colors" data-rename-user="${u.id}" data-rename-name="${esc(u.username)}">改名</button>`;
        if (u.role !== 'admin') {
            actions += ` <button class="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-red-400 hover:border-red-500/30 transition-colors" onclick="deleteUser(${u.id})">删除</button>`;
        }

        return `
        <div class="flex items-center gap-3 py-2 px-3 rounded-lg bg-base border border-border">
            <div class="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent text-xs font-bold flex-shrink-0">
                ${esc((u.nickname || u.username || '?')[0])}
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                    <span class="text-sm text-text-primary">${esc(u.nickname || u.username)}</span>
                    ${u.role === 'admin' ? '<span class="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">管理员</span>' : ''}
                    <span class="text-xs px-1.5 py-0.5 rounded border ${sc}">${sl}</span>
                </div>
                <p class="text-xs text-text-muted">${esc(u.username)} · ${esc(u.created_at || '')}</p>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">${actions}</div>
        </div>`;
    }).join('');
}

async function approveUser(id) {
    await api(`/api/users/${id}/approve`, { method: 'POST' });
    showToast('已批准');
    loadUsers();
    loadStats();
}

async function rejectUser(id) {
    await api(`/api/users/${id}/reject`, { method: 'POST' });
    showToast('已拒绝');
    loadUsers();
}

async function deleteUser(id) {
    if (!await showConfirm('确定删除此用户？', { confirmText: '删除', danger: true })) return;
    await api(`/api/users/${id}`, { method: 'DELETE' });
    showToast('已删除');
    loadUsers();
}

// ── Quick Buttons ────────────────────────────────────────
let _cachedButtons = [];

async function loadButtons() {
    try {
        const buttons = await api('/api/quick-buttons');
        _cachedButtons = buttons;
        renderButtons(buttons);
    } catch (e) { /* ignore */ }
}

function renderButtons(buttons) {
    const container = document.getElementById('buttons-list');
    if (buttons.length === 0) {
        container.innerHTML = '<p class="text-text-muted text-sm text-center py-4">暂无按钮，点击上方添加</p>';
        return;
    }

    const typeLabels = { feed: '喂养', excrete: '排泄', symptom: '症状', supplement: '补充' };
    const typeColors = { feed: 'text-blue-400', excrete: 'text-amber-400', symptom: 'text-red-400', supplement: 'text-purple-400' };

    container.innerHTML = buttons.map((b, i) => `
        <div class="flex items-center gap-3 py-2 px-3 rounded-lg bg-base border border-border ${b.is_active ? '' : 'opacity-40'}">
            <div class="flex flex-col gap-0.5">
                <button class="text-text-muted hover:text-accent transition-colors ${i === 0 ? 'invisible' : ''}" onclick="moveButton(${b.id}, -1)" title="上移">
                    <i data-lucide="chevron-up" class="w-3.5 h-3.5"></i>
                </button>
                <button class="text-text-muted hover:text-accent transition-colors ${i === buttons.length - 1 ? 'invisible' : ''}" onclick="moveButton(${b.id}, 1)" title="下移">
                    <i data-lucide="chevron-down" class="w-3.5 h-3.5"></i>
                </button>
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                    <span class="text-sm text-text-primary">${esc(b.label)}</span>
                    <span class="text-xs ${typeColors[b.type]}">${typeLabels[b.type]}</span>
                    ${b.amount ? `<span class="text-xs text-text-muted font-mono">${b.amount}ml</span>` : ''}
                </div>
                <p class="text-xs text-text-muted">排序: ${b.sort_order} · ${b.is_active ? '启用' : '禁用'}</p>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
                <button class="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-amber-400 hover:border-amber-500/30 transition-colors"
                        onclick="showEditButtonModal(${b.id})">编辑</button>
                <button class="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-accent transition-colors"
                        onclick="toggleButton(${b.id}, ${b.is_active ? 0 : 1})">${b.is_active ? '禁用' : '启用'}</button>
                <button class="text-xs px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                        onclick="deleteButton(${b.id})">删除</button>
            </div>
        </div>
    `).join('');
    lucide.createIcons();
}

async function toggleButton(id, isActive) {
    await api(`/api/quick-buttons/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: isActive })
    });
    loadButtons();
}

async function moveButton(id, direction) {
    // direction: -1 上移, +1 下移
    const buttons = await api('/api/quick-buttons');
    const idx = buttons.findIndex(b => b.id === id);
    if (idx < 0) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= buttons.length) return;
    // 交换位置
    [buttons[idx], buttons[targetIdx]] = [buttons[targetIdx], buttons[idx]];
    // 提交新的排序
    await api('/api/quick-buttons/reorder', {
        method: 'POST',
        body: JSON.stringify({ ids: buttons.map(b => b.id) })
    });
    loadButtons();
}

async function deleteButton(id) {
    if (!await showConfirm('确定删除此按钮？', { confirmText: '删除', danger: true })) return;
    await api(`/api/quick-buttons/${id}`, { method: 'DELETE' });
    showToast('已删除');
    loadButtons();
}

let _editingButtonId = null;

function showAddButtonModal() {
    _editingButtonId = null;
    const m = document.getElementById('add-btn-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
    document.getElementById('btn-modal-title').textContent = '添加快速记录按钮';
    document.getElementById('btn-modal-submit').textContent = '添加';
    document.getElementById('new-btn-type').value = 'feed';
    document.getElementById('new-btn-label').value = '';
    document.getElementById('new-btn-amount').value = '0';
    document.getElementById('new-btn-order').value = '0';
    document.getElementById('custom-subtype-input').value = '';
    updateSubTypes();
}

function showEditButtonModal(id) {
    const btn = _cachedButtons.find(b => b.id === id);
    if (!btn) return;
    _editingButtonId = id;
    const m = document.getElementById('add-btn-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
    document.getElementById('btn-modal-title').textContent = '编辑快速记录按钮';
    document.getElementById('btn-modal-submit').textContent = '保存';
    document.getElementById('new-btn-type').value = btn.type;
    updateSubTypes();
    const sel = document.getElementById('new-btn-subtype');
    const knownValues = new Set((SUB_TYPES[btn.type] || []).map(s => s.value));
    if (btn.sub_type && !knownValues.has(btn.sub_type)) {
        sel.innerHTML += `<option value="${esc(btn.sub_type)}" selected>${esc(btn.sub_type)}</option>`;
    } else {
        sel.value = btn.sub_type;
    }
    onSubTypeChange();
    if (sel.value === '_custom' && btn.sub_type !== '_custom') {
        document.getElementById('custom-subtype-input').value = btn.sub_type;
    } else if (btn.sub_type && !knownValues.has(btn.sub_type)) {
        document.getElementById('custom-subtype-wrap').classList.add('hidden');
    }
    document.getElementById('new-btn-label').value = btn.label || '';
    document.getElementById('new-btn-amount').value = btn.amount || 0;
    document.getElementById('new-btn-order').value = btn.sort_order || 0;
}

function closeAddButtonModal() {
    _editingButtonId = null;
    const m = document.getElementById('add-btn-modal');
    m.classList.add('hidden');
    m.classList.remove('flex');
}

function updateSubTypes() {
    const type = document.getElementById('new-btn-type').value;
    const sel = document.getElementById('new-btn-subtype');
    const opts = SUB_TYPES[type] || [];
    sel.innerHTML = opts.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
    onSubTypeChange();
}

function onSubTypeChange() {
    const sel = document.getElementById('new-btn-subtype');
    const wrap = document.getElementById('custom-subtype-wrap');
    if (wrap) {
        wrap.classList.toggle('hidden', sel.value !== '_custom');
    }
}

async function addButton() {
    let subType = document.getElementById('new-btn-subtype').value;
    if (subType === '_custom') {
        subType = document.getElementById('custom-subtype-input').value.trim();
        if (!subType) {
            showToast('请输入自定义子类型名称');
            return;
        }
    }
    const data = {
        type: document.getElementById('new-btn-type').value,
        sub_type: subType,
        label: document.getElementById('new-btn-label').value.trim(),
        amount: parseInt(document.getElementById('new-btn-amount').value) || 0,
        sort_order: parseInt(document.getElementById('new-btn-order').value) || 0,
        is_active: 1
    };
    if (!data.label) {
        showToast('请输入显示标签');
        return;
    }
    try {
        if (_editingButtonId) {
            data.is_active = _cachedButtons.find(b => b.id === _editingButtonId)?.is_active ?? 1;
            await api(`/api/quick-buttons/${_editingButtonId}`, { method: 'PUT', body: JSON.stringify(data) });
            showToast('按钮已更新');
        } else {
            await api('/api/quick-buttons', { method: 'POST', body: JSON.stringify(data) });
            showToast('按钮已添加');
        }
        closeAddButtonModal();
        loadButtons();
    } catch (e) {
        showToast(e.message);
    }
}

// ── Baby ─────────────────────────────────────────────────
async function loadBaby() {
    try {
        const baby = await api('/api/baby');
        document.getElementById('baby-name').value = baby.name || '';
        document.getElementById('baby-gender').value = baby.gender || 'male';
        document.getElementById('baby-birth').value = baby.birth_date || '';
        document.getElementById('baby-weight').value = baby.weight || 3.0;
    } catch (e) { /* ignore */ }
}

async function saveBaby() {
    const data = {
        name: document.getElementById('baby-name').value || '宝宝',
        gender: document.getElementById('baby-gender').value,
        birth_date: document.getElementById('baby-birth').value || new Date().toISOString().slice(0, 10),
        weight: parseFloat(document.getElementById('baby-weight').value) || 3.0
    };
    try {
        await api('/api/baby', { method: 'PUT', body: JSON.stringify(data) });
        showToast('婴儿信息已保存');
    } catch (e) {
        showToast('保存失败: ' + e.message);
    }
}

// ── Settings ─────────────────────────────────────────────
async function loadSettings() {
    try {
        const settings = await api('/api/settings');
        if (settings.custom_daily_target) {
            document.getElementById('custom-target').value = settings.custom_daily_target;
        }
        document.getElementById('feeds-per-day').value = settings.feeds_per_day || 8;
    } catch (e) { /* ignore */ }
}

async function saveSettings() {
    const data = {
        feeds_per_day: parseInt(document.getElementById('feeds-per-day').value) || 8,
        custom_daily_target: document.getElementById('custom-target').value || '',
    };
    try {
        await api('/api/settings', { method: 'PUT', body: JSON.stringify(data) });
        showToast('设置已保存');
    } catch (e) {
        showToast('保存失败: ' + e.message);
    }
}

// ── Stats ────────────────────────────────────────────────
async function loadStats() {
    try {
        const stats = await api('/api/stats');
        document.getElementById('stat-records').textContent = stats.total_records;
        document.getElementById('stat-feeds').textContent = stats.total_feeds;
        document.getElementById('stat-ml').textContent = stats.total_ml;
        document.getElementById('stat-days').textContent = stats.tracked_days;
        document.getElementById('stat-pending').textContent = stats.pending_users;
    } catch (e) { /* ignore */ }
}

// ── Audit Logs ───────────────────────────────────────────
async function loadLogs() {
    try {
        const logs = await api('/api/audit-logs?limit=100');
        renderLogs(logs);
    } catch (e) { /* ignore */ }
}

function renderLogs(logs) {
    const container = document.getElementById('audit-logs');
    if (!logs || logs.length === 0) {
        container.innerHTML = '<p class="text-text-muted text-sm text-center py-4">暂无操作日志</p>';
        return;
    }

    const actionColors = {
        '登录': 'text-accent',
        '登出': 'text-text-muted',
        '注册': 'text-blue-400',
        '快速记录': 'text-accent',
        '创建记录': 'text-accent',
        '编辑记录': 'text-amber-400',
        '删除记录': 'text-red-400',
        '审批用户': 'text-blue-400',
        '修改昵称': 'text-text-secondary',
        '修改婴儿信息': 'text-text-secondary',
        '修改设置': 'text-text-secondary',
        '添加按钮': 'text-accent',
        '修改按钮': 'text-amber-400',
        '删除按钮': 'text-red-400',
        '删除用户': 'text-red-400',
        '重置密码': 'text-amber-400',
        '清除数据': 'text-red-400',
        '导出CSV': 'text-text-secondary',
        'HA快速记录': 'text-purple-400',
        '生成HA密钥': 'text-purple-400',
        '备份数据': 'text-blue-400',
        '恢复数据': 'text-amber-400',
    };

    container.innerHTML = logs.map(l => {
        const color = actionColors[l.action] || 'text-text-secondary';
        return `
        <div class="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-white/[0.02] transition-colors">
            <span class="font-mono text-[10px] text-text-muted whitespace-nowrap mt-0.5">${l.created_at ? l.created_at.slice(5, 19) : ''}</span>
            <span class="text-xs ${color} font-medium whitespace-nowrap">${esc(l.action)}</span>
            <span class="text-xs text-text-muted truncate">${esc(l.username)}${l.detail ? ' · ' + esc(l.detail) : ''}</span>
        </div>`;
    }).join('');
}

function exportCSV() {
    window.location.href = '/api/export/csv';
}

// ── Backup & Restore ─────────────────────────────────────
function backupExport() {
    window.location.href = '/api/backup/export';
}

function showRestoreModal() {
    const m = document.getElementById('restore-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
    document.getElementById('restore-file').value = '';
    if (typeof fabClose === 'function') fabClose();
}

function closeRestoreModal() {
    const m = document.getElementById('restore-modal');
    m.classList.add('hidden');
    m.classList.remove('flex');
}

async function backupRestore() {
    const fileInput = document.getElementById('restore-file');
    if (!fileInput.files || !fileInput.files[0]) {
        showToast('请选择备份文件');
        return;
    }
    if (!await showConfirm('确定恢复备份？当前所有数据将被覆盖，此操作不可撤销！', { confirmText: '恢复', danger: true })) return;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
        const res = await fetch('/api/backup/restore', {
            method: 'POST',
            body: formData,
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '恢复失败');
        const counts = data.counts || {};
        const summary = Object.entries(counts).map(([t, c]) => `${t}: ${c}条`).join(', ');
        showToast(`备份已恢复 — ${summary}`);
        closeRestoreModal();
        loadStats();
        loadUsers();
        loadButtons();
        loadLogs();
    } catch (e) {
        showToast(e.message);
    }
}

async function clearData() {
    if (!await showConfirm('确定清除所有记录？此操作不可恢复！', { confirmText: '继续', danger: true })) return;
    if (!await showConfirm('再次确认：清除所有喂养、排泄、症状记录？', { confirmText: '确认清除', danger: true })) return;
    try {
        await api('/api/data/clear', { method: 'POST' });
        showToast('所有记录已清除');
        loadStats();
    } catch (e) {
        showToast('操作失败: ' + e.message);
    }
}

// ── Reset Password ──────────────────────────────────────
let _resetUserId = null;
let _resetUserName = '';

function showResetPasswordModal(userId, userName) {
    _resetUserId = userId;
    _resetUserName = userName;
    let modal = document.getElementById('reset-pw-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'reset-pw-modal';
        modal.className = 'fixed inset-0 z-[90] hidden items-center justify-center bg-black/60';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
    <div class="bg-surface border border-border rounded-xl p-6 w-80 max-w-[90vw]">
        <h3 class="text-sm font-medium text-text-secondary mb-3">重置密码 - ${esc(userName)}</h3>
        <input type="password" id="reset-pw-input" class="input-field font-mono" placeholder="输入新密码（至少6位）" autocomplete="new-password">
        <div class="flex gap-2 mt-4">
            <button class="btn-secondary flex-1 text-sm" onclick="closeResetPasswordModal()">取消</button>
            <button class="btn-primary flex-1 text-sm" onclick="resetPassword()">确认</button>
        </div>
    </div>`;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
    document.getElementById('reset-pw-input').focus();
}

function closeResetPasswordModal() {
    const modal = document.getElementById('reset-pw-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    _resetUserId = null;
}

async function resetPassword() {
    const pw = document.getElementById('reset-pw-input').value;
    if (pw.length < 6) {
        showToast('密码至少6个字符');
        return;
    }
    try {
        await api(`/api/users/${_resetUserId}/password`, {
            method: 'PUT',
            body: JSON.stringify({ password: pw })
        });
        showToast('密码已重置');
        closeResetPasswordModal();
    } catch (e) {
        showToast(e.message);
    }
}

// ── Rename User ─────────────────────────────────────────
let _renameUserId = null;

function showRenameUserModal(userId, currentName) {
    _renameUserId = userId;
    let modal = document.getElementById('rename-user-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'rename-user-modal';
        modal.className = 'fixed inset-0 z-[90] hidden items-center justify-center bg-black/60';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
    <div class="bg-surface border border-border rounded-xl p-6 w-80 max-w-[90vw]">
        <h3 class="text-sm font-medium text-text-secondary mb-3">修改登录名</h3>
        <input type="text" id="rename-user-input" class="input-field font-mono" placeholder="输入新登录名（至少2位）" value="${esc(currentName)}">
        <p class="text-[10px] text-text-muted mt-1">当前: ${esc(currentName)}</p>
        <div class="flex gap-2 mt-4">
            <button class="btn-secondary flex-1 text-sm" onclick="closeRenameUserModal()">取消</button>
            <button class="btn-primary flex-1 text-sm" onclick="renameUser()">确认</button>
        </div>
    </div>`;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
    const input = document.getElementById('rename-user-input');
    input.focus();
    input.select();
}

function closeRenameUserModal() {
    const modal = document.getElementById('rename-user-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    _renameUserId = null;
}

async function renameUser() {
    const newName = document.getElementById('rename-user-input').value.trim();
    if (!newName || newName.length < 2) {
        showToast('用户名至少2个字符');
        return;
    }
    try {
        await api(`/api/users/${_renameUserId}/username`, {
            method: 'PUT',
            body: JSON.stringify({ username: newName })
        });
        showToast('用户名已更新');
        closeRenameUserModal();
        loadUsers();
    } catch (e) {
        showToast(e.message);
    }
}

// ── HA Integration Wizard ────────────────────────────────
let _haButtons = [];

async function loadHaApiKey() {
    try {
        const data = await api('/api/ha/api-key');
        const el = document.getElementById('ha-api-key');
        if (el) el.value = data.api_key || '';
    } catch (e) { /* ignore */ }
    loadHaButtons();
}

async function loadHaButtons() {
    try {
        _haButtons = await api('/api/ha/buttons');
        renderHaButtonChecks();
    } catch (e) {
        _haButtons = [];
    }
}

function renderHaButtonChecks() {
    const container = document.getElementById('ha-button-checks');
    if (!container) return;
    if (_haButtons.length === 0) {
        container.innerHTML = '<p class="text-[10px] text-text-muted">暂无启用的快速记录按钮</p>';
        return;
    }
    const typeLabels = { feed: '喂养', excrete: '排泄', symptom: '症状', supplement: '补充' };
    const typeColors = { feed: 'text-blue-400', excrete: 'text-amber-400', symptom: 'text-red-400', supplement: 'text-purple-400' };
    container.innerHTML = _haButtons.map(b => `
        <label class="flex items-center gap-2 py-1 cursor-pointer">
            <input type="checkbox" class="ha-entity accent-accent" data-type="switch" data-id="${b.id}" data-label="${esc(b.label)}" checked>
            <span class="text-xs ${typeColors[b.type] || ''}">${typeLabels[b.type] || b.type}</span>
            <span class="text-xs text-text-primary">${esc(b.label)}</span>
        </label>
    `).join('');
}

function haToggleAllButtons() {
    const checks = document.querySelectorAll('.ha-entity[data-type="switch"]');
    const allChecked = Array.from(checks).every(c => c.checked);
    checks.forEach(c => { c.checked = !allChecked; });
}

async function generateHaApiKey() {
    if (!await showConfirm('生成新的 API 密钥？旧密钥将立即失效。', { confirmText: '生成' })) return;
    try {
        const data = await api('/api/ha/api-key', { method: 'POST' });
        const el = document.getElementById('ha-api-key');
        if (el) el.value = data.api_key || '';
        showToast('API 密钥已生成');
    } catch (e) {
        showToast(e.message);
    }
}

function copyHaApiKey() {
    const el = document.getElementById('ha-api-key');
    if (!el || !el.value) {
        showToast('请先生成 API 密钥');
        return;
    }
    _copyText(el.value, '密钥已复制');
}

function generateHaYaml() {
    const host = document.getElementById('ha-host')?.value?.trim() || '<BABY_TRACKER_IP>';
    const port = document.getElementById('ha-port')?.value || '8964';
    const apiKey = document.getElementById('ha-api-key')?.value || '<YOUR_API_KEY>';
    const base = `http://${host}:${port}`;

    const sensors = [];
    const switches = [];

    document.querySelectorAll('.ha-entity').forEach(cb => {
        if (!cb.checked) return;
        const type = cb.dataset.type;
        const id = cb.dataset.id;
        if (type === 'sensor') sensors.push(id);
        else if (type === 'switch') switches.push({ id: parseInt(id), label: cb.dataset.label });
    });

    if (sensors.length === 0 && switches.length === 0) {
        document.getElementById('ha-yaml-output').textContent = '# 请至少勾选一个传感器或开关';
        return;
    }

    const lines = [];

    if (sensors.length > 0) {
        lines.push('sensor:');
        const sensorConfigs = {
            'status': {
                name: '宝宝今日奶量',
                resource: '/api/ha/status',
                value_template: '{{ value_json.total_feed_ml }}',
                unit: 'ml',
                attrs: ['feed_count', 'target_ml', 'remaining_ml', 'feed_progress', 'urine_count', 'stool_count', 'last_feed_time', 'estimated_feeds_left', 'per_feed_ml']
            },
            'feed-today': {
                name: '宝宝今日喂养',
                resource: '/api/ha/feed-today',
                value_template: '{{ value_json.state }}',
                unit: '',
                attrs: ['feed_count', 'feeds']
            },
            'last-feed': {
                name: '宝宝上次喂养',
                resource: '/api/ha/last-feed',
                value_template: '{{ value_json.state }}',
                unit: '',
                attrs: ['sub_type', 'amount_ml', 'duration_min']
            },
            'excrete-today': {
                name: '宝宝今日排泄',
                resource: '/api/ha/excrete-today',
                value_template: '{{ value_json.state }}',
                unit: '',
                attrs: ['urine_count', 'stool_count', 'total_count']
            }
        };

        sensors.forEach(sid => {
            const cfg = sensorConfigs[sid];
            if (!cfg) return;
            lines.push(`  - platform: rest`);
            lines.push(`    name: "${cfg.name}"`);
            lines.push(`    resource: "${base}${cfg.resource}"`);
            lines.push(`    value_template: "${cfg.value_template}"`);
            if (cfg.unit) lines.push(`    unit_of_measurement: "${cfg.unit}"`);
            if (cfg.attrs.length > 0) {
                lines.push(`    json_attributes:`);
                cfg.attrs.forEach(a => lines.push(`      - ${a}`));
            }
            lines.push(`    scan_interval: 300`);
            lines.push('');
        });
    }

    if (switches.length > 0) {
        lines.push('switch:');
        switches.forEach(sw => {
            const safeName = sw.label.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
            lines.push(`  # ${sw.label}`);
            lines.push(`  - platform: rest`);
            lines.push(`    name: "${sw.label}"`);
            lines.push(`    resource: "${base}/api/ha/button/${sw.id}?api_key=${apiKey}"`);
            lines.push(`    body_on: '{"state":"on"}'`);
            lines.push(`    body_off: '{"state":"off"}'`);
            lines.push(`    is_on_template: "{{ value_json.state == 'on' }}"`);
            lines.push(`    headers:`);
            lines.push(`      Content-Type: application/json`);
            lines.push(`    scan_interval: 5`);
            lines.push('');
        });
    }

    document.getElementById('ha-yaml-output').textContent = lines.join('\n').trimEnd();
}

function copyHaYaml() {
    const text = document.getElementById('ha-yaml-output')?.textContent;
    if (!text || text.trim() === '' || text.includes('点击上方按钮')) {
        showToast('请先点击生成配置代码');
        return;
    }
    _copyText(text, '配置已复制到剪贴板');
}

function _copyText(text, msg) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(msg || '已复制');
        }).catch(() => {
            _fallbackCopy(text, msg);
        });
    } else {
        _fallbackCopy(text, msg);
    }
}

function _fallbackCopy(text, msg) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
        document.execCommand('copy');
        showToast(msg || '已复制');
    } catch (e) {
        showToast('复制失败，请手动选择文本复制');
    }
    document.body.removeChild(ta);
}
