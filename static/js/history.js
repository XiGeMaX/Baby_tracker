// ── History Page ─────────────────────────────────────────
let calYear, calMonth, selectedDate, currentFilter = 'all';
let recordDates = new Set();

document.addEventListener('DOMContentLoaded', async () => {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    selectedDate = formatDateISO(now);
    await loadRecordDates();
    renderCalendar();
    loadRecords(selectedDate);
});

function formatDateISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function loadRecordDates() {
    try {
        const dates = await api('/api/records/dates');
        dates.forEach(d => recordDates.add(d));
    } catch (e) { /* ignore */ }
}

function changeMonth(delta) {
    calMonth += delta;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
}

function renderCalendar() {
    const label = document.getElementById('cal-month-label');
    label.textContent = `${calYear}年${calMonth + 1}月`;

    const grid = document.getElementById('cal-grid');
    const firstDay = new Date(calYear, calMonth, 1);
    let startDay = firstDay.getDay() - 1;
    if (startDay < 0) startDay = 6;

    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const today = formatDateISO(new Date());

    let html = '';
    for (let i = 0; i < startDay; i++) {
        html += '<div class="cal-day other-month"></div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isToday = dateStr === today;
        const isSelected = dateStr === selectedDate;
        const hasRecord = recordDates.has(dateStr);
        let cls = 'cal-day';
        if (isToday) cls += ' today';
        if (isSelected) cls += ' selected';
        if (hasRecord) cls += ' has-record';
        html += `<div class="${cls}" onclick="selectDate('${dateStr}')">${d}</div>`;
    }
    grid.innerHTML = html;
}

function selectDate(dateStr) {
    selectedDate = dateStr;
    renderCalendar();
    loadRecords(dateStr);
}

async function loadRecords(dateStr) {
    try {
        let url = `/api/records?date=${dateStr}`;
        if (currentFilter !== 'all') url += `&type=${currentFilter}`;
        const records = await api(url);
        renderRecords(records, dateStr);
    } catch (e) {
        document.getElementById('records-list').innerHTML =
            `<div class="card text-center text-red-400 text-sm py-8">加载失败</div>`;
    }
}

function filterRecords(type, btn) {
    currentFilter = type;
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (selectedDate) loadRecords(selectedDate);
}

function renderRecords(records, dateStr) {
    const container = document.getElementById('records-list');
    if (!records || records.length === 0) {
        container.innerHTML = `
            <div class="card text-center text-text-muted text-sm py-8">
                <p>${dateStr} 暂无记录</p>
            </div>`;
        return;
    }

    container.innerHTML = records.map(r => {
        const typeClass = r.type === 'feed' ? 'badge-feed' : r.type === 'excrete' ? 'badge-excrete' : 'badge-symptom';
        const iconColor = r.type === 'feed' ? 'text-blue-400' : r.type === 'excrete' ? 'text-amber-400' : 'text-red-400';
        const bgColor = r.type === 'feed' ? 'bg-blue-500/10' : r.type === 'excrete' ? 'bg-amber-500/10' : 'bg-red-500/10';
        const iconName = r.type === 'feed' ? 'droplets' : r.type === 'excrete' ? 'circle-dot' : 'heart-pulse';

        let detail = '';
        if (r.amount) detail += `${r.amount}ml`;
        if (r.duration) detail += ` · ${r.duration}分钟`;
        if (r.temperature) detail += ` · ${r.temperature}°C`;
        if (r.color) detail += ` · ${r.color}`;
        if (r.consistency) detail += ` · ${r.consistency}`;
        if (r.note) detail += ` · ${r.note}`;

        return `
        <div class="card flex items-center gap-3 py-3 px-4 fade-in">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${bgColor}">
                <i data-lucide="${iconName}" class="w-4 h-4 ${iconColor}"></i>
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                    <span class="text-sm text-text-primary">${esc(typeLabel(r.type, r.sub_type))}</span>
                    <span class="text-xs px-1.5 py-0.5 rounded border ${typeClass}">${TYPE_LABELS[r.type]}</span>
                </div>
                <p class="text-xs text-text-muted mt-0.5">${esc(detail || '--')}</p>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
                <span class="font-mono text-xs text-text-muted">${formatTime(r.timestamp)}</span>
                <button class="text-text-muted hover:text-amber-400 transition-colors p-1" onclick="openEditModal(${r.id}, ()=>loadRecords(selectedDate))" title="编辑">
                    <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
                </button>
                <button class="text-text-muted hover:text-red-400 transition-colors p-1" onclick="deleteRecord(${r.id})" title="删除">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
            </div>
        </div>`;
    }).join('');

    lucide.createIcons();
}

async function deleteRecord(id) {
    if (!await showConfirm('确定删除此记录？', { confirmText: '删除', danger: true })) return;
    try {
        await api(`/api/records/${id}`, { method: 'DELETE' });
        showToast('已删除');
        loadRecords(selectedDate);
    } catch (e) {
        showToast(e.message || '删除失败');
    }
}
