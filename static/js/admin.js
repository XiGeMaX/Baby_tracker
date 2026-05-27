// ── Admin Page ───────────────────────────────────────────
const SUB_TYPES = {
    feed: [
        { value: 'breast_left', label: '母乳(左)' },
        { value: 'breast_right', label: '母乳(右)' },
        { value: 'formula', label: '配方奶' },
        { value: 'water', label: '水' },
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
        { value: 'other', label: '其他' },
    ]
};

document.addEventListener('DOMContentLoaded', () => {
    Promise.all([loadBaby(), loadSettings(), loadStats(), loadUsers(), loadButtons(), loadLogs()]);
    updateSubTypes();
});

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
        actions += ` <button class="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-amber-400 hover:border-amber-500/30 transition-colors" onclick="showResetPasswordModal(${u.id}, '${esc(u.nickname || u.username)}')">改密</button>`;
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
async function loadButtons() {
    try {
        const buttons = await api('/api/quick-buttons');
        renderButtons(buttons);
    } catch (e) { /* ignore */ }
}

function renderButtons(buttons) {
    const container = document.getElementById('buttons-list');
    if (buttons.length === 0) {
        container.innerHTML = '<p class="text-text-muted text-sm text-center py-4">暂无按钮，点击上方添加</p>';
        return;
    }

    const typeLabels = { feed: '喂养', excrete: '排泄', symptom: '症状' };
    const typeColors = { feed: 'text-blue-400', excrete: 'text-amber-400', symptom: 'text-red-400' };

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

function showAddButtonModal() {
    const m = document.getElementById('add-btn-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
    updateSubTypes();
}

function closeAddButtonModal() {
    const m = document.getElementById('add-btn-modal');
    m.classList.add('hidden');
    m.classList.remove('flex');
}

function updateSubTypes() {
    const type = document.getElementById('new-btn-type').value;
    const sel = document.getElementById('new-btn-subtype');
    sel.innerHTML = SUB_TYPES[type].map(s => `<option value="${s.value}">${s.label}</option>`).join('');
}

async function addButton() {
    const data = {
        type: document.getElementById('new-btn-type').value,
        sub_type: document.getElementById('new-btn-subtype').value,
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
        await api('/api/quick-buttons', { method: 'POST', body: JSON.stringify(data) });
        showToast('按钮已添加');
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
        loadEstimate();
    } catch (e) {
        showToast('保存失败: ' + e.message);
    }
}

// ── Settings ─────────────────────────────────────────────
const COEFF_LABELS = {
    day0: '出生当天 (ml)',
    day1: '日龄1天 (ml/kg)',
    day2_3: '日龄2-3天 (ml/kg)',
    day4_7: '日龄4-7天 (ml/kg)',
    day8_14: '日龄8-14天 (ml/kg)',
    day15_28: '日龄15-28天 (ml/kg)',
    month1_3: '1-3月龄 (ml/kg)',
    month4_6: '4-6月龄 (ml/kg)',
    month4_6_cap: '4-6月上限 (ml)',
    month6_12_base: '6-12月基础量 (ml)',
    month6_12_decay: '6-12月月递减 (ml)',
    month6_12_min: '6-12月下限 (ml)',
    year1_plus: '1岁以上 (ml)',
};

const DEFAULT_COEFFS = {
    day0: 60, day1: 60, day2_3: 80, day4_7: 100,
    day8_14: 120, day15_28: 135, month1_3: 150,
    month4_6: 150, month4_6_cap: 900,
    month6_12_base: 800, month6_12_decay: 30, month6_12_min: 600,
    year1_plus: 500,
};

let currentCoeffs = { ...DEFAULT_COEFFS };

async function loadSettings() {
    try {
        const settings = await api('/api/settings');
        const custom = settings.custom_daily_target;
        if (custom && custom.trim()) {
            document.querySelector('input[name="milk-mode"][value="custom"]').checked = true;
            document.getElementById('custom-target').value = custom;
            document.getElementById('custom-milk-input').classList.remove('hidden');
        }
        document.getElementById('feeds-per-day').value = settings.feeds_per_day || 8;

        // 解析系数
        try {
            const parsed = JSON.parse(settings.milk_coefficients || '{}');
            currentCoeffs = { ...DEFAULT_COEFFS, ...parsed };
        } catch (e) { /* use defaults */ }
        renderCoeffFields();

        loadEstimate();
    } catch (e) { /* ignore */ }
}

function renderCoeffFields() {
    const container = document.getElementById('coeff-fields');
    container.innerHTML = Object.entries(COEFF_LABELS).map(([key, label]) => `
        <div>
            <label class="text-text-muted text-[10px] mb-0.5 block">${label}</label>
            <input type="number" id="coeff-${key}" class="input-field font-mono text-xs py-1.5" value="${currentCoeffs[key] || 0}" step="1" min="0"
                   onchange="onCoeffChange('${key}', this.value)">
        </div>
    `).join('');
}

function onCoeffChange(key, value) {
    currentCoeffs[key] = parseFloat(value) || 0;
}

function resetCoeffs() {
    currentCoeffs = { ...DEFAULT_COEFFS };
    renderCoeffFields();
    showToast('系数已恢复默认，点击保存生效');
}

async function saveSettings() {
    const mode = document.querySelector('input[name="milk-mode"]:checked').value;
    const data = {
        feeds_per_day: parseInt(document.getElementById('feeds-per-day').value) || 8,
        custom_daily_target: mode === 'custom' ? (document.getElementById('custom-target').value || '') : '',
        milk_coefficients: JSON.stringify(currentCoeffs)
    };
    try {
        await api('/api/settings', { method: 'PUT', body: JSON.stringify(data) });
        showToast('设置已保存');
        loadEstimate();
    } catch (e) {
        showToast('保存失败: ' + e.message);
    }
}

function toggleMilkMode() {
    const mode = document.querySelector('input[name="milk-mode"]:checked').value;
    document.getElementById('custom-milk-input').classList.toggle('hidden', mode !== 'custom');
}

async function loadEstimate() {
    try {
        const est = await api('/api/milk-estimate');
        document.getElementById('estimate-text').textContent =
            `${est.calculation_detail} | 单次约 ${est.per_feed_ml}ml`;
    } catch (e) {
        document.getElementById('estimate-text').textContent = '估算失败';
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

function exportCSV() { window.location.href = '/api/export/csv'; }

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

function showResetPasswordModal(userId, userName) {
    _resetUserId = userId;
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
