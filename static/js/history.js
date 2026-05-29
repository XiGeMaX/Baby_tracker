// ── History Page ─────────────────────────────────────────
let calYear, calMonth, selectedDate, currentFilter = 'all';
let recordDates = new Set();
let vaccineVaccinatedDates = new Set();
let vaccineOverdueDates = new Set();
let vaccineUpcomingDates = new Set();

async function initHistory() {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    selectedDate = formatDateISO(now);
    recordDates.clear();
    vaccineVaccinatedDates.clear();
    vaccineOverdueDates.clear();
    vaccineUpcomingDates.clear();
    await Promise.all([loadRecordDates(), loadVaccineDates()]);
    renderCalendar();
    loadRecords(selectedDate);
}

document.addEventListener('DOMContentLoaded', initHistory);

function formatDateISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function loadRecordDates() {
    try {
        const dates = await api('/api/records/dates');
        dates.forEach(d => recordDates.add(d));
    } catch (e) { /* ignore */ }
}

async function loadVaccineDates() {
    try {
        const data = await api('/api/vaccine/dates');
        if (data.vaccinated) data.vaccinated.forEach(d => vaccineVaccinatedDates.add(d));
        if (data.overdue) data.overdue.forEach(d => vaccineOverdueDates.add(d));
        if (data.upcoming) data.upcoming.forEach(d => vaccineUpcomingDates.add(d));
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
        const hasVaccine = vaccineVaccinatedDates.has(dateStr);
        const hasOverdue = vaccineOverdueDates.has(dateStr);
        const hasUpcoming = vaccineUpcomingDates.has(dateStr);

        let cls = 'cal-day';
        if (isToday) cls += ' today';
        if (isSelected) cls += ' selected';

        // 构建底部指示点：绿=喂养 黄=已接种 红=未接种 黑=逾期
        let dotsHtml = '';
        if (hasRecord || hasVaccine || hasOverdue || hasUpcoming) {
            dotsHtml = '<div class="cal-dots">';
            if (hasRecord) dotsHtml += '<span class="cal-dot-feed"></span>';
            if (hasVaccine) dotsHtml += '<span class="cal-dot-vaccine"></span>';
            if (hasUpcoming) dotsHtml += '<span class="cal-dot-upcoming"></span>';
            if (hasOverdue) dotsHtml += '<span class="cal-dot-overdue"></span>';
            dotsHtml += '</div>';
        }

        html += `<div class="${cls}" onclick="selectDate('${dateStr}')">${d}${dotsHtml}</div>`;
    }
    grid.innerHTML = html;
}

function selectDate(dateStr) {
    selectedDate = dateStr;
    renderCalendar();
    loadRecords(dateStr);
}

async function loadRecords(dateStr) {
    const container = document.getElementById('records-list');

    // 并行加载喂养记录和疫苗记录
    const promises = [];

    if (currentFilter === 'all' || currentFilter === 'vaccine') {
        promises.push(
            api(`/api/vaccine/day-records?date=${dateStr}`).catch(() => ({ vaccinated: [], planned: [] }))
        );
    } else {
        promises.push(Promise.resolve({ vaccinated: [], planned: [] }));
    }

    if (currentFilter === 'all' || (currentFilter !== 'vaccine')) {
        let url = `/api/records?date=${dateStr}`;
        if (currentFilter !== 'all' && currentFilter !== 'vaccine') url += `&type=${currentFilter}`;
        promises.push(api(url).catch(() => []));
    } else {
        promises.push(Promise.resolve([]));
    }

    try {
        const [vaccineData, records] = await Promise.all(promises);
        renderRecords(records, vaccineData, dateStr);
    } catch (e) {
        container.innerHTML = `<div class="card text-center text-red-400 text-sm py-8">加载失败</div>`;
    }
}

function filterRecords(type, btn) {
    currentFilter = type;
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (selectedDate) loadRecords(selectedDate);
}

function renderRecords(records, vaccineData, dateStr) {
    const container = document.getElementById('records-list');
    const items = [];

    // 喂养/排泄/症状记录
    if (records && records.length > 0) {
        records.forEach(r => {
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

            items.push(`
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
            </div>`);
        });
    }

    // 疫苗记录
    if (vaccineData) {
        // 已接种
        if (vaccineData.vaccinated && vaccineData.vaccinated.length > 0) {
            vaccineData.vaccinated.forEach(v => {
                items.push(`
                <div class="card flex items-center gap-3 py-3 px-4 fade-in">
                    <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-yellow-500/10">
                        <i data-lucide="syringe" class="w-4 h-4 text-yellow-500"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="text-sm text-text-primary">${esc(v.name)} 第${v.dose_index}剂</span>
                            <span class="text-xs px-1.5 py-0.5 rounded border badge-vaccine">疫苗</span>
                        </div>
                        <p class="text-xs text-text-muted mt-0.5">已接种${v.note ? ' · ' + esc(v.note) : ''}</p>
                    </div>
                    <span class="font-mono text-xs text-yellow-500 flex-shrink-0">${esc(v.vaccinated_date)}</span>
                </div>`);
            });
        }
        // 计划中
        if (vaccineData.planned && vaccineData.planned.length > 0) {
            vaccineData.planned.forEach(v => {
                const isOverdue = v.status === 'overdue';
                items.push(`
                <div class="card flex items-center gap-3 py-3 px-4 fade-in">
                    <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isOverdue ? 'bg-gray-500/10' : 'bg-red-500/10'}">
                        <i data-lucide="clock" class="w-4 h-4 ${isOverdue ? 'text-gray-400' : 'text-red-400'}"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="text-sm text-text-primary">${esc(v.name)} 第${v.dose_index}剂</span>
                            <span class="text-xs px-1.5 py-0.5 rounded border badge-vaccine">疫苗</span>
                        </div>
                        <p class="text-xs text-text-muted mt-0.5">${isOverdue ? '逾期未接种' : '计划接种'}</p>
                    </div>
                    <span class="font-mono text-xs ${isOverdue ? 'text-gray-400' : 'text-red-400'} flex-shrink-0">${esc(v.due_date)}</span>
                </div>`);
            });
        }
    }

    if (items.length === 0) {
        container.innerHTML = `
            <div class="card text-center text-text-muted text-sm py-8">
                <p>${dateStr} 暂无记录</p>
            </div>`;
        return;
    }

    container.innerHTML = items.join('');
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
