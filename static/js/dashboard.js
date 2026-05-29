// ── Dashboard ────────────────────────────────────────────
let dashboardData = null;

async function initDashboard() {
    const dateEl = document.getElementById('today-date');
    if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
        });
    }
    await refreshDashboard();
}

document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshDashboard();
    });
});

// 手动刷新（带旋转动画）
async function refreshDashboard() {
    try {
        const data = await api(`/api/records/today?date=${getLocalDate()}`);
        dashboardData = data;
        renderDashboard(data);
    } catch (e) {
        console.error('刷新失败:', e);
    }
}

function renderDashboard(data) {
    // 奶量进度环
    document.getElementById('milk-consumed').textContent = data.total_feed_ml;
    document.getElementById('milk-target').textContent = data.target_ml;
    document.getElementById('milk-remaining').textContent = data.remaining_ml;

    const ring = document.getElementById('milk-ring');
    if (ring) setProgressRing(ring, data.feed_progress);

    if (data.estimate) {
        document.getElementById('estimate-detail').textContent = data.estimate.calculation_detail;
    }

    // 喂养次数
    document.getElementById('feed-count').textContent = data.feed_count;
    document.getElementById('feed-total').textContent = data.estimated_feeds_per_day;
    document.getElementById('feed-progress-bar').style.width = (data.feed_progress * 100) + '%';
    document.getElementById('feeds-left').textContent = data.estimated_feeds_left;

    // 排泄
    document.getElementById('urine-count').textContent = data.urine_count;
    document.getElementById('stool-count').textContent = data.stool_count;

    // 上次喂养
    document.getElementById('last-feed-time').textContent = data.last_feed_time ? formatTime(data.last_feed_time) : '暂无记录';

    // 快速记录按钮（仅首次渲染）
    const btnContainer = document.getElementById('quick-buttons');
    if (btnContainer && data.quick_buttons) {
        renderQuickButtons(data.quick_buttons);
    }

    // 最近记录
    renderRecentRecords(data.recent_records);
}

function renderQuickButtons(buttons) {
    const container = document.getElementById('quick-buttons');
    if (!container) return;

    const typeIcons = { feed: 'droplets', excrete: 'circle-dot', symptom: 'heart-pulse', supplement: 'pill' };
    const typeColors = { feed: 'text-blue-400', excrete: 'text-amber-400', symptom: 'text-red-400', supplement: 'text-purple-400' };
    const typeBorders = { feed: 'border-blue-500/20', excrete: 'border-amber-500/20', symptom: 'border-red-500/20', supplement: 'border-purple-500/20' };

    let html = '';
    for (const btn of buttons) {
        html += `
        <button class="quick-btn flex flex-col items-center gap-1 p-3 rounded-xl border ${typeBorders[btn.type]} bg-surface hover:bg-white/5 active:scale-95 transition-all duration-150 cursor-pointer"
                data-btn-id="${btn.id}" data-btn-label="${esc(btn.label)}">
            <i data-lucide="${typeIcons[btn.type]}" class="w-5 h-5 ${typeColors[btn.type]}"></i>
            <span class="text-xs text-text-secondary">${esc(btn.label)}</span>
        </button>`;
    }
    container.innerHTML = html;

    // 事件委托只绑定一次
    if (!container.dataset.delegateBound) {
        container.addEventListener('click', e => {
            const btn = e.target.closest('.quick-btn');
            if (!btn) return;
            const btnId = parseInt(btn.dataset.btnId);
            const label = btn.dataset.btnLabel;
            quickRecord(btnId, label);
        });
        container.dataset.delegateBound = 'true';
    }

    lucide.createIcons();
}

async function quickRecord(btnId, label) {
    try {
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        const data = await api(`/api/quick-record/${btnId}`, { method: 'POST', body: JSON.stringify({ timestamp, date: getLocalDate() }) });
        showToast(`${label} - 记录成功`);
        // API 直接返回更新后的概览数据，无需二次请求
        dashboardData = data;
        renderDashboard(data);
    } catch (e) {
        showToast(e.message);
    }
}

function renderRecentRecords(records) {
    const container = document.getElementById('recent-records');
    if (!records || records.length === 0) {
        container.innerHTML = `<div class="card text-center text-text-muted text-sm py-8"><p>暂无记录</p></div>`;
        return;
    }

    container.innerHTML = records.map(r => {
        const badgeMap = { feed: 'badge-feed', excrete: 'badge-excrete', symptom: 'badge-symptom', supplement: 'badge-supplement' };
        const typeClass = badgeMap[r.type] || 'badge-symptom';
        const bgMap = { feed: 'bg-blue-500/10', excrete: 'bg-amber-500/10', symptom: 'bg-red-500/10', supplement: 'bg-purple-500/10' };
        const iconMap = { feed: 'droplets', excrete: 'circle-dot', symptom: 'heart-pulse', supplement: 'pill' };
        const colorMap = { feed: 'text-blue-400', excrete: 'text-amber-400', symptom: 'text-red-400', supplement: 'text-purple-400' };
        const detail = buildRecordDetail(r);

        return `
        <div class="card flex items-center gap-3 py-3 px-4 fade-in">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${bgMap[r.type] || bgMap.symptom}">
                <i data-lucide="${iconMap[r.type] || iconMap.symptom}" class="w-4 h-4 ${colorMap[r.type] || colorMap.symptom}"></i>
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                    <span class="text-sm text-text-primary">${esc(typeLabel(r.type, r.sub_type))}</span>
                    <span class="text-xs px-1.5 py-0.5 rounded border ${typeClass}">${TYPE_LABELS[r.type]}</span>
                </div>
                <p class="text-xs text-text-muted mt-0.5">${esc(detail)}</p>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
                <span class="font-mono text-xs text-text-muted">${formatTime(r.timestamp)}</span>
                <button class="text-text-muted hover:text-amber-400 transition-colors p-1" onclick="openEditModal(${r.id}, onDashboardEditSaved)" title="编辑">
                    <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
                </button>
                <button class="text-text-muted hover:text-red-400 transition-colors p-1" onclick="deleteDashboardRecord(${r.id})" title="删除">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
            </div>
        </div>`;
    }).join('');

    lucide.createIcons();
}

function buildRecordDetail(r) {
    const parts = [];
    if (r.amount) parts.push(`${r.amount}ml`);
    if (r.duration) parts.push(`${r.duration}分钟`);
    if (r.temperature) parts.push(`${r.temperature}°C`);
    if (r.color) parts.push(r.color);
    if (r.consistency) parts.push(r.consistency);
    if (r.note) parts.push(r.note);
    return parts.join(' · ') || '--';
}

function onDashboardEditSaved(data) {
    // 编辑后 API 直接返回概览数据，无需二次 GET 请求
    if (data && data.total_feed_ml !== undefined) {
        dashboardData = data;
        renderDashboard(data);
    } else {
        // 兜底：如果返回数据不包含概览，则重新请求
        refreshDashboard();
    }
}

async function deleteDashboardRecord(id) {
    if (!await showConfirm('确定删除此记录？', { confirmText: '删除', danger: true })) return;
    try {
        const data = await api(`/api/records/${id}?date=${getLocalDate()}`, { method: 'DELETE' });
        showToast('已删除');
        // 删除后 API 直接返回概览数据，无需二次 GET 请求
        if (data && data.total_feed_ml !== undefined) {
            dashboardData = data;
            renderDashboard(data);
        } else {
            await refreshDashboard();
        }
    } catch (e) {
        showToast(e.message || '删除失败');
    }
}
