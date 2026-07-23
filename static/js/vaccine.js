// ── Vaccine Page ─────────────────────────────────────────
let vaccineData = null;

function initVaccine() {
    // 重置 Tab 状态及事件委托标志，保证 SPA 重新进入时可重入
    _currentTab = 'schedule';
    _healthLoaded = false;
    _countdownLoaded = false;
    _vaccineDelegateBound = false;
    _scheduleLoaded = false;
    switchTab('schedule');
    loadVaccine();
}

document.addEventListener('DOMContentLoaded', initVaccine);

// ── Tab 切换 ─────────────────────────────────────────────
let _currentTab = 'schedule';
let _healthLoaded = false;
let _countdownLoaded = false;
let _scheduleLoaded = false;

function switchTab(tab) {
    _currentTab = tab;
    document.querySelectorAll('[data-tab-btn]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tabBtn === tab);
    });
    ['schedule', 'vaccine', 'health', 'countdown'].forEach(t => {
        const el = document.getElementById('tab-' + t);
        if (el) el.classList.toggle('hidden', tab !== t);
    });
    // 头部按钮按 Tab 控制
    const addBtn = document.getElementById('vaccine-add-btn');
    const healthBtn = document.getElementById('health-add-btn');
    const countdownBtn = document.getElementById('countdown-add-btn');
    const datePicker = document.getElementById('date-picker-wrap');
    if (addBtn) addBtn.classList.toggle('hidden', tab !== 'vaccine');
    if (healthBtn) healthBtn.classList.toggle('hidden', tab !== 'health');
    if (countdownBtn) countdownBtn.classList.toggle('hidden', tab !== 'countdown');
    if (datePicker) datePicker.classList.toggle('hidden', tab !== 'schedule');
    // 按需懒加载
    if (tab === 'schedule' && !_scheduleLoaded) initCalendar();
    if (tab === 'health' && !_healthLoaded) loadHealth();
    if (tab === 'countdown' && !_countdownLoaded) loadCountdown();
}

async function loadVaccine() {
    try {
        vaccineData = await api('/api/vaccine/schedule');
        if (vaccineData.error && !vaccineData.overview) {
            document.getElementById('vaccine-overview').innerHTML =
                `<div class="card"><p class="text-text-muted text-sm text-center">${esc(vaccineData.error)}</p></div>`;
            document.getElementById('vaccine-list').innerHTML = '';
            document.getElementById('vaccine-age').textContent = '';
            return;
        }
        renderOverview();
        renderList();
    } catch (e) {
        console.error('加载疫苗数据失败:', e);
        document.getElementById('vaccine-overview').innerHTML =
            `<div class="card"><p class="text-text-muted text-sm text-center">${esc(e.message || '加载失败')}</p></div>`;
    }
}

function renderOverview() {
    const ov = vaccineData.overview;
    const container = document.getElementById('vaccine-overview');
    if (!ov) {
        container.innerHTML = '<div class="card"><p class="text-text-muted text-sm text-center">请先在管理面板设置宝宝出生日期</p></div>';
        return;
    }

    document.getElementById('vaccine-age').textContent = `${ov.age_months}月龄 (${ov.age_days}天)`;

    const pct = ov.total_doses > 0 ? (ov.done_count / ov.total_doses * 100) : 0;
    const lastDone = ov.last_done;
    const nextUp = ov.next_upcoming;

    container.innerHTML = `
    <!-- 最近已接种 -->
    <div class="card flex items-center gap-4">
        <div class="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
            <i data-lucide="syringe" class="w-5 h-5 text-accent"></i>
        </div>
        <div class="flex-1 min-w-0">
            <p class="text-xs text-text-muted">最近已接种</p>
            <p class="text-sm font-medium text-text-primary truncate">${lastDone ? esc(lastDone.name) + ' 第' + lastDone.dose_index + '剂' : '暂无记录'}</p>
        </div>
        <span class="text-xs text-text-muted font-mono flex-shrink-0">${lastDone ? esc(lastDone.vaccinated_date) : ''}</span>
    </div>
    <!-- 下一次接种 -->
    <div class="card flex items-center gap-4">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${nextUp && nextUp.status === 'overdue' ? 'bg-red-500/10' : 'bg-accent/10'}">
            <i data-lucide="calendar-clock" class="w-5 h-5 ${nextUp && nextUp.status === 'overdue' ? 'text-red-400' : 'text-accent'}"></i>
        </div>
        <div class="flex-1 min-w-0">
            <p class="text-xs text-text-muted">下一次接种</p>
            <p class="text-sm font-medium text-text-primary truncate">${nextUp ? esc(nextUp.name) + ' 第' + nextUp.dose_index + '剂' : '全部完成'}</p>
        </div>
        ${nextUp ? `<span class="text-sm font-bold flex-shrink-0 ${nextUp.status === 'overdue' ? 'text-red-400' : 'text-accent'}">${nextUp.status === 'overdue' ? '逾期' + Math.abs(ov.next_days) + '天' : ov.next_days + '天后'}</span>` : ''}
    </div>
    <!-- 进度 -->
    <div class="card">
        <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-text-muted">接种进度</span>
            <span class="text-xs font-mono text-accent">${ov.done_count}/${ov.total_doses}</span>
        </div>
        <div class="w-full h-2 bg-border rounded-full overflow-hidden">
            <div class="h-full bg-accent rounded-full transition-all duration-500" style="width:${pct}%"></div>
        </div>
        <div class="flex justify-between mt-1">
            <span class="text-[10px] text-red-400">${ov.overdue_count > 0 ? ov.overdue_count + '剂逾期' : ''}</span>
            <span class="text-[10px] text-text-muted">${Math.round(pct)}%</span>
        </div>
    </div>`;
    lucide.createIcons();
}

function renderList() {
    const container = document.getElementById('vaccine-list');
    const schedule = vaccineData.schedule;
    if (!schedule || schedule.length === 0) {
        container.innerHTML = '<p class="text-text-muted text-sm text-center py-4">暂无数据</p>';
        return;
    }

    // 按疫苗名分组
    const groups = {};
    schedule.forEach(s => {
        if (!groups[s.name]) groups[s.name] = [];
        groups[s.name].push(s);
    });

    // 按未接种计划的最近日期排序（已全完成的排最后）
    const sortedEntries = Object.entries(groups).sort((a, b) => {
        const aUpcoming = a[1].filter(d => d.status !== 'done');
        const bUpcoming = b[1].filter(d => d.status !== 'done');
        if (aUpcoming.length === 0 && bUpcoming.length === 0) return 0;
        if (aUpcoming.length === 0) return 1;
        if (bUpcoming.length === 0) return -1;
        const aMin = aUpcoming.reduce((min, d) => (d.due_date && d.due_date < min) ? d.due_date : min, aUpcoming[0].due_date || '9999');
        const bMin = bUpcoming.reduce((min, d) => (d.due_date && d.due_date < min) ? d.due_date : min, bUpcoming[0].due_date || '9999');
        return aMin.localeCompare(bMin);
    });

    let html = '';
    for (const [name, doses] of sortedEntries) {
        const allDone = doses.every(d => d.status === 'done');
        const hasOverdue = doses.some(d => d.status === 'overdue');
        const isCustom = doses[0].is_custom;
        const borderColor = allDone ? 'border-accent/20' : hasOverdue ? 'border-red-500/20' : 'border-border';
        const nextDose = doses.find(d => d.status !== 'done');

        html += `<div class="border ${borderColor} rounded-lg p-3">
            <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-text-primary">${esc(name)}</span>
                    ${isCustom ? '<span class="text-[9px] text-amber-400 border border-amber-500/20 rounded px-1">自定义</span>' : `<span class="text-[10px] text-text-muted font-mono">${doses[0].short}</span>`}
                </div>
                <div class="flex items-center gap-2">
                    ${allDone ? '<span class="text-[10px] text-accent">已完成</span>' : ''}
                    ${nextDose ? `<span class="text-[10px] ${nextDose.status === 'overdue' ? 'text-red-400' : 'text-text-muted'} font-mono">下次: 第${nextDose.dose_index}剂 ${nextDose.due_date.slice(5)}</span>` : ''}
                </div>
            </div>
            <div class="flex flex-wrap gap-2">`;

        doses.forEach(d => {
            const statusConfig = {
                done: { bg: 'bg-accent/10 text-accent border-accent/20', icon: 'check', label: d.vaccinated_date || '' },
                overdue: { bg: 'bg-red-500/10 text-red-400 border-red-500/20', icon: 'alert-circle', label: '逾期' },
                upcoming: { bg: 'bg-surface text-text-muted border-border', icon: 'clock', label: d.due_date ? d.due_date.slice(5) : '' },
            };
            const cfg = statusConfig[d.status] || statusConfig.upcoming;
            html += `<button class="flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-mono ${cfg.bg} transition-colors hover:opacity-80"
                data-dose-click data-vaccine-name="${esc(d.name)}" data-dose-index="${d.dose_index}" data-status="${d.status}" data-due-date="${esc(d.due_date || '')}" data-custom="${d.is_custom ? '1' : '0'}" data-vaccinated-date="${esc(d.vaccinated_date || '')}" data-note="${esc(d.note_text || d.note || '')}">
                <i data-lucide="${cfg.icon}" class="w-3 h-3"></i>
                第${d.dose_index}剂
                <span class="text-[9px] opacity-70">${cfg.label}</span>
            </button>`;
        });

        html += `</div></div>`;
    }
    container.innerHTML = html;
    lucide.createIcons();
    bindVaccineListEvents();
}

// ── 事件委托 ─────────────────────────────────────────────
let _vaccineDelegateBound = false;
function bindVaccineListEvents() {
    const container = document.getElementById('vaccine-list');
    if (!container || _vaccineDelegateBound) return;
    _vaccineDelegateBound = true;
    container.addEventListener('click', e => {
        const btn = e.target.closest('[data-dose-click]');
        if (!btn) return;
        onDoseClick(btn.dataset.vaccineName, parseInt(btn.dataset.doseIndex), btn.dataset.status, btn.dataset.dueDate, btn.dataset.custom === '1', btn.dataset.vaccinatedDate, btn.dataset.note);
    });
}

function onDoseClick(name, doseIndex, status, dueDate, isCustom, vaccinatedDate, note) {
    if (status === 'done') {
        showEditVaccineModal(name, doseIndex, vaccinatedDate, note);
    } else {
        showPlanDateModal(name, doseIndex, dueDate, isCustom);
    }
}

// ── 计划日期修改弹窗 ─────────────────────────────────────
function showPlanDateModal(name, doseIndex, dueDate, isCustom) {
    document.getElementById('pdm-name').value = name;
    document.getElementById('pdm-dose').value = doseIndex;
    document.getElementById('pdm-custom').value = isCustom ? '1' : '0';
    document.getElementById('pdm-date').value = dueDate || new Date().toISOString().slice(0, 10);
    document.getElementById('plan-date-modal-title').textContent = `${name} 第${doseIndex}剂`;
    const m = document.getElementById('plan-date-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
}

async function deleteVaccinePlan() {
    const name = document.getElementById('pdm-name').value;
    const doseIndex = parseInt(document.getElementById('pdm-dose').value);
    const isCustom = document.getElementById('pdm-custom').value === '1';
    if (!await showConfirm(`确定删除 ${name} 第${doseIndex}剂 的计划？`, { confirmText: '删除', danger: true })) return;
    try {
        const url = isCustom ? '/api/vaccine/custom-plan' : '/api/vaccine/plan';
        await api(url, {
            method: 'DELETE',
            body: JSON.stringify({ vaccine_name: name, dose_index: doseIndex })
        });
        showToast('已删除');
        closePlanDateModal();
        await loadVaccine();
    } catch (e) { showToast(e.message); }
}

function closePlanDateModal() {
    const m = document.getElementById('plan-date-modal');
    m.classList.add('hidden');
    m.classList.remove('flex');
}

async function savePlanDate() {
    const name = document.getElementById('pdm-name').value;
    const doseIndex = parseInt(document.getElementById('pdm-dose').value);
    const customDueDate = document.getElementById('pdm-date').value;
    if (!customDueDate) { showToast('请选择日期'); return; }
    try {
        await api('/api/vaccine/plan-date', {
            method: 'PUT',
            body: JSON.stringify({ vaccine_name: name, dose_index: doseIndex, custom_due_date: customDueDate })
        });
        showToast('计划日期已更新');
        closePlanDateModal();
        await loadVaccine();
    } catch (e) { showToast(e.message); }
}

// 从计划日期弹窗跳转到记录接种
function planDateToRecord() {
    const name = document.getElementById('pdm-name').value;
    const doseIndex = parseInt(document.getElementById('pdm-dose').value);
    const dueDate = document.getElementById('pdm-date').value;
    closePlanDateModal();
    showVaccineModal(name, doseIndex, dueDate);
}

// ── 接种记录弹窗 ─────────────────────────────────────────
function showVaccineModal(name, doseIndex, dueDate) {
    document.getElementById('vm-name').value = name;
    document.getElementById('vm-dose').value = doseIndex;
    document.getElementById('vm-date').value = dueDate || new Date().toISOString().slice(0, 10);
    document.getElementById('vm-note').value = '';
    document.getElementById('vaccine-modal-title').textContent = `${name} 第${doseIndex}剂`;
    const m = document.getElementById('vaccine-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
}

function closeVaccineModal() {
    const m = document.getElementById('vaccine-modal');
    m.classList.add('hidden');
    m.classList.remove('flex');
}

async function saveVaccineRecord() {
    const name = document.getElementById('vm-name').value;
    const doseIndex = parseInt(document.getElementById('vm-dose').value);
    const vaccinatedDate = document.getElementById('vm-date').value || new Date().toISOString().slice(0, 10);
    const note = document.getElementById('vm-note').value;
    try {
        await api('/api/vaccine/record', {
            method: 'POST',
            body: JSON.stringify({ vaccine_name: name, dose_index: doseIndex, vaccinated_date: vaccinatedDate, note })
        });
        showToast(`${name} 第${doseIndex}剂 已记录`);
        closeVaccineModal();
        await loadVaccine();
        // 提示下一次同项目接种时间
        const nextDose = vaccineData.schedule.find(s => s.name === name && s.status !== 'done');
        if (nextDose) {
            setTimeout(() => showToast(`${name} 下一次: 第${nextDose.dose_index}剂 (${nextDose.due_date})`), 800);
        } else {
            setTimeout(() => showToast(`${name} 全部剂次已完成`), 800);
        }
    } catch (e) { showToast(e.message); }
}

async function deleteVaccineRecord(name, doseIndex) {
    try {
        await api('/api/vaccine/record', {
            method: 'DELETE',
            body: JSON.stringify({ vaccine_name: name, dose_index: doseIndex })
        });
        showToast('已删除');
        loadVaccine();
    } catch (e) { showToast(e.message); }
}

// ── 编辑疫苗记录弹窗 ─────────────────────────────────────
function showEditVaccineModal(name, doseIndex, vaccinatedDate, note) {
    document.getElementById('evm-name').value = name;
    document.getElementById('evm-dose').value = doseIndex;
    document.getElementById('evm-date').value = vaccinatedDate || new Date().toISOString().slice(0, 10);
    document.getElementById('evm-note').value = note || '';
    document.getElementById('edit-vaccine-modal-title').textContent = `${name} 第${doseIndex}剂`;
    const m = document.getElementById('edit-vaccine-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
}

function closeEditVaccineModal() {
    const m = document.getElementById('edit-vaccine-modal');
    m.classList.add('hidden');
    m.classList.remove('flex');
}

async function updateVaccineRecord() {
    const name = document.getElementById('evm-name').value;
    const doseIndex = parseInt(document.getElementById('evm-dose').value);
    const vaccinatedDate = document.getElementById('evm-date').value;
    const note = document.getElementById('evm-note').value;
    if (!vaccinatedDate) { showToast('请选择日期'); return; }
    try {
        await api('/api/vaccine/record', {
            method: 'POST',
            body: JSON.stringify({ vaccine_name: name, dose_index: doseIndex, vaccinated_date: vaccinatedDate, note })
        });
        showToast(`${name} 第${doseIndex}剂 已更新`);
        closeEditVaccineModal();
        await loadVaccine();
    } catch (e) { showToast(e.message); }
}

async function deleteVaccineFromEdit() {
    const name = document.getElementById('evm-name').value;
    const doseIndex = parseInt(document.getElementById('evm-dose').value);
    if (!await showConfirm(`确定删除 ${name} 第${doseIndex}剂 的接种记录？`, { confirmText: '删除', danger: true })) return;
    try {
        await api('/api/vaccine/record', {
            method: 'DELETE',
            body: JSON.stringify({ vaccine_name: name, dose_index: doseIndex })
        });
        showToast('已删除');
        closeEditVaccineModal();
        await loadVaccine();
    } catch (e) { showToast(e.message); }
}

// ── 自定义疫苗弹窗（多针剂） ─────────────────────────────
let _doseCounter = 0;

function showAddVaccineModal() {
    document.getElementById('av-name').value = '';
    const container = document.getElementById('av-doses-container');
    container.innerHTML = '';
    _doseCounter = 0;
    addDoseRow();
    const m = document.getElementById('add-vaccine-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
    document.getElementById('av-name').focus();
}

function closeAddVaccineModal() {
    const m = document.getElementById('add-vaccine-modal');
    m.classList.add('hidden');
    m.classList.remove('flex');
}

function addDoseRow() {
    _doseCounter++;
    const container = document.getElementById('av-doses-container');
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2 dose-row';
    row.innerHTML = `
        <span class="text-xs text-text-muted w-10 flex-shrink-0">第${_doseCounter}剂</span>
        <input type="date" class="input-field font-mono flex-1 text-xs" value="${new Date().toISOString().slice(0, 10)}">
        <input type="text" class="input-field flex-1 text-xs" placeholder="备注">
        ${_doseCounter > 1 ? `<button onclick="removeDoseRow(this)" class="text-text-muted hover:text-red-400 transition-colors flex-shrink-0 p-1"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>` : ''}
    `;
    container.appendChild(row);
    lucide.createIcons();
}

function removeDoseRow(btn) {
    btn.closest('.dose-row').remove();
    const rows = document.querySelectorAll('#av-doses-container .dose-row');
    rows.forEach((row, i) => {
        row.querySelector('span').textContent = `第${i + 1}剂`;
    });
    _doseCounter = rows.length;
}

async function saveCustomVaccine() {
    const name = document.getElementById('av-name').value.trim();
    if (!name) { showToast('请输入疫苗名称'); return; }
    const rows = document.querySelectorAll('#av-doses-container .dose-row');
    const doses = [];
    rows.forEach((row, i) => {
        const dateInput = row.querySelector('input[type="date"]');
        const noteInput = row.querySelector('input[type="text"]');
        const dueDate = dateInput.value;
        if (dueDate) {
            doses.push({ dose_index: i + 1, due_date: dueDate, note: noteInput ? noteInput.value : '' });
        }
    });
    if (doses.length === 0) { showToast('请至少添加一剂'); return; }
    try {
        await api('/api/vaccine/custom-plan', {
            method: 'POST',
            body: JSON.stringify({ vaccine_name: name, doses })
        });
        showToast(`${name} 已添加 ${doses.length} 剂`);
        closeAddVaccineModal();
        await loadVaccine();
    } catch (e) { showToast(e.message); }
}

// ── 自定义健康随访弹窗 ───────────────────────────────────
function showAddHealthModal() {
    document.getElementById('ah-name').value = '';
    document.getElementById('ah-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('ah-note').value = '';
    const m = document.getElementById('add-health-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
    document.getElementById('ah-name').focus();
}

function closeAddHealthModal() {
    const m = document.getElementById('add-health-modal');
    m.classList.add('hidden');
    m.classList.remove('flex');
}

async function saveCustomHealth() {
    const label = document.getElementById('ah-name').value.trim();
    const completedDate = document.getElementById('ah-date').value;
    const note = document.getElementById('ah-note').value;
    if (!label) { showToast('请输入随访名称'); return; }
    if (!completedDate) { showToast('请选择日期'); return; }
    try {
        await api('/api/health/record', {
            method: 'POST',
            body: JSON.stringify({ label, completed_date: completedDate, note })
        });
        showToast(`${label} 已记录`);
        closeAddHealthModal();
        await loadHealth();
    } catch (e) { showToast(e.message); }
}

// ═════════════════════════════════════════════════════════
// ── 健康随访 ─────────────────────────────────────────────
// ═════════════════════════════════════════════════════════
let healthData = null;

async function loadHealth() {
    try {
        healthData = await api('/api/health/schedule');
        renderHealthOverview();
        renderHealthList();
        _healthLoaded = true;
    } catch (e) {
        console.error('加载健康随访数据失败:', e);
        const ov = document.getElementById('health-overview');
        const list = document.getElementById('health-list');
        if (ov) ov.innerHTML = `<div class="card"><p class="text-text-muted text-sm text-center">${esc(e.message || '加载失败')}</p></div>`;
        if (list) list.innerHTML = '';
    }
}

// 计算日期距今天数（>0 未来，0 今天，<0 已过）
function daysDiffFromToday(dateStr) {
    if (!dateStr) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return Math.round((d - today) / 86400000);
}

function renderHealthOverview() {
    const ov = healthData.overview;
    const container = document.getElementById('health-overview');
    if (!container) return;
    if (!ov) {
        container.innerHTML = '<div class="card"><p class="text-text-muted text-sm text-center">请先在管理面板设置宝宝出生日期</p></div>';
        return;
    }
    const pct = ov.total > 0 ? (ov.done_count / ov.total * 100) : 0;
    const nextUp = ov.next_upcoming;
    const nextLabel = nextUp ? (typeof nextUp === 'string' ? nextUp : (nextUp.label || '')) : '';
    const nextDate = (nextUp && typeof nextUp === 'object') ? (nextUp.due_date || '') : '';
    const nextDays = ov.next_days;
    const overdue = (typeof nextDays === 'number') && nextDays < 0;
    const nextDaysText = nextLabel
        ? (nextDays < 0 ? '逾期' + Math.abs(nextDays) + '天' : nextDays === 0 ? '今天' : nextDays + '天后')
        : '';

    container.innerHTML = `
    <!-- 总览 -->
    <div class="card flex items-center gap-4">
        <div class="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
            <i data-lucide="activity" class="w-5 h-5 text-accent"></i>
        </div>
        <div class="flex-1 min-w-0">
            <p class="text-xs text-text-muted">健康随访</p>
            <p class="text-sm font-medium text-text-primary truncate">共 ${ov.total} 次 · 已完成 ${ov.done_count} 次${ov.overdue_count > 0 ? ' · 逾期 ' + ov.overdue_count + ' 次' : ''}</p>
        </div>
        ${ov.is_premature ? '<span class="text-[10px] text-amber-400 border border-amber-500/20 rounded px-1 flex-shrink-0">早产儿</span>' : ''}
    </div>
    <!-- 下一次随访 -->
    <div class="card flex items-center gap-4">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${overdue ? 'bg-red-500/10' : 'bg-accent/10'}">
            <i data-lucide="calendar-clock" class="w-5 h-5 ${overdue ? 'text-red-400' : 'text-accent'}"></i>
        </div>
        <div class="flex-1 min-w-0">
            <p class="text-xs text-text-muted">下一次随访</p>
            <p class="text-sm font-medium text-text-primary truncate">${nextLabel ? esc(nextLabel) + (nextDate ? ' (' + esc(nextDate) + ')' : '') : '全部完成'}</p>
        </div>
        ${nextLabel ? `<span class="text-sm font-bold flex-shrink-0 ${overdue ? 'text-red-400' : 'text-accent'}">${nextDaysText}</span>` : ''}
    </div>
    <!-- 进度 -->
    <div class="card">
        <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-text-muted">随访进度</span>
            <span class="text-xs font-mono text-accent">${ov.done_count}/${ov.total}</span>
        </div>
        <div class="w-full h-2 bg-border rounded-full overflow-hidden">
            <div class="h-full bg-accent rounded-full transition-all duration-500" style="width:${pct}%"></div>
        </div>
        <div class="flex justify-between mt-1">
            <span class="text-[10px] text-red-400">${ov.overdue_count > 0 ? ov.overdue_count + '项逾期' : ''}</span>
            <span class="text-[10px] text-text-muted">${Math.round(pct)}%</span>
        </div>
    </div>`;
    lucide.createIcons();
}

function renderHealthList() {
    const container = document.getElementById('health-list');
    if (!container) return;
    const schedule = healthData.schedule;
    if (!schedule || schedule.length === 0) {
        container.innerHTML = '<p class="text-text-muted text-sm text-center py-4">暂无数据</p>';
        return;
    }

    let html = '';
    schedule.forEach(item => {
        const isDone = item.status === 'done';
        const isOverdue = item.status === 'overdue';
        const cfg = isDone
            ? { color: 'text-accent', border: 'border-accent/20', icon: 'check-circle' }
            : isOverdue
                ? { color: 'text-red-400', border: 'border-red-500/20', icon: 'alert-circle' }
                : { color: 'text-text-muted', border: 'border-border', icon: 'clock' };

        let daysText = '';
        if (!isDone) {
            const d = daysDiffFromToday(item.due_date);
            if (d !== null) {
                daysText = d < 0 ? '逾期' + Math.abs(d) + '天' : d === 0 ? '今天' : d + '天后';
            }
        }

        const secondary = [item.location, isDone ? (item.completed_date ? '完成于 ' + item.completed_date : '') : item.due_date]
            .filter(Boolean).map(esc).join(' · ');

        html += `<div class="border ${cfg.border} rounded-lg p-3 cursor-pointer hover:opacity-80 transition-opacity" data-health-click data-label="${esc(item.label)}" data-status="${item.status}" data-due-date="${esc(item.due_date || '')}" data-completed-date="${esc(item.completed_date || '')}" data-note="${esc(item.note_text || '')}">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 min-w-0">
                    <i data-lucide="${cfg.icon}" class="w-4 h-4 ${cfg.color} flex-shrink-0"></i>
                    <span class="text-sm font-medium text-text-primary">${esc(item.label)}</span>
                    ${item.premature_only ? '<span class="text-[9px] text-amber-400 border border-amber-500/20 rounded px-1 flex-shrink-0">早产</span>' : ''}
                    ${item.is_custom ? '<span class="text-[9px] text-teal-400 border border-teal-500/20 rounded px-1 flex-shrink-0">自定义</span>' : ''}
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                    ${isDone ? `<span class="text-[10px] text-accent font-mono">✓ ${esc(item.completed_date || '')}</span>` : ''}
                    ${daysText ? `<span class="text-[10px] font-mono ${cfg.color}">${daysText}</span>` : ''}
                </div>
            </div>
            ${secondary ? `<p class="text-[10px] text-text-muted mt-1 ml-6 truncate">${secondary}</p>` : ''}
        </div>`;
    });
    container.innerHTML = html;
    lucide.createIcons();
    // 事件委托：每次渲染重新绑定到当前容器（容器为全新元素，天然可重入）
    container.onclick = (e) => {
        const el = e.target.closest('[data-health-click]');
        if (!el) return;
        onHealthClick({
            label: el.dataset.label,
            status: el.dataset.status,
            dueDate: el.dataset.dueDate,
            completedDate: el.dataset.completedDate,
            note: el.dataset.note,
        });
    };
}

function onHealthClick(ds) {
    if (ds.status === 'done') {
        // 已完成：编辑（修改日期/备注/删除）
        showHealthRecordModal(ds.label, 'edit', ds.completedDate, ds.note);
    } else {
        // 未完成：弹出计划日期弹窗（可修改计划日期或记录完成）
        showHealthPlanModal(ds.label, ds.dueDate);
    }
}

// ── 健康随访-计划日期弹窗 ───────────────────────────────
function showHealthPlanModal(label, dueDate) {
    document.getElementById('hpm-label').value = label;
    document.getElementById('hpm-date').value = dueDate || getLocalDate();
    document.getElementById('health-plan-modal-title').textContent = label;
    const m = document.getElementById('health-plan-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
}

function closeHealthPlanModal() {
    const m = document.getElementById('health-plan-modal');
    m.classList.add('hidden');
    m.classList.remove('flex');
}

async function saveHealthPlanDate() {
    const label = document.getElementById('hpm-label').value;
    const customDueDate = document.getElementById('hpm-date').value;
    if (!customDueDate) { showToast('请选择日期'); return; }
    try {
        await api('/api/health/plan-date', {
            method: 'PUT',
            body: JSON.stringify({ label, custom_due_date: customDueDate })
        });
        showToast('计划日期已更新');
        closeHealthPlanModal();
        await loadHealth();
    } catch (e) { showToast(e.message); }
}

// 从计划日期弹窗跳转到记录完成
function healthPlanToRecord() {
    const label = document.getElementById('hpm-label').value;
    const dueDate = document.getElementById('hpm-date').value;
    closeHealthPlanModal();
    showHealthRecordModal(label, 'create', dueDate, '');
}

// ── 健康随访-记录完成/编辑弹窗 ─────────────────────────
function showHealthRecordModal(label, mode, date, note) {
    document.getElementById('hrm-label').value = label;
    document.getElementById('hrm-mode').value = mode;
    document.getElementById('hrm-date').value = date || getLocalDate();
    document.getElementById('hrm-note').value = note || '';
    document.getElementById('health-record-modal-title').textContent = mode === 'edit' ? '编辑随访记录' : '记录随访';
    document.getElementById('hrm-delete-btn').classList.toggle('hidden', mode !== 'edit');
    const m = document.getElementById('health-record-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
}

function closeHealthRecordModal() {
    const m = document.getElementById('health-record-modal');
    m.classList.add('hidden');
    m.classList.remove('flex');
}

async function saveHealthRecord() {
    const label = document.getElementById('hrm-label').value;
    const completedDate = document.getElementById('hrm-date').value || getLocalDate();
    const note = document.getElementById('hrm-note').value;
    if (!completedDate) { showToast('请选择日期'); return; }
    try {
        await api('/api/health/record', {
            method: 'POST',
            body: JSON.stringify({ label, completed_date: completedDate, note })
        });
        showToast('已保存');
        closeHealthRecordModal();
        await loadHealth();
    } catch (e) { showToast(e.message); }
}

async function deleteHealthFromRecord() {
    const label = document.getElementById('hrm-label').value;
    if (!await showConfirm(`确定删除 ${label} 的随访记录？`, { confirmText: '删除', danger: true })) return;
    try {
        await api(`/api/health/record?label=${encodeURIComponent(label)}`, { method: 'DELETE' });
        showToast('已删除');
        closeHealthRecordModal();
        await loadHealth();
    } catch (e) { showToast(e.message); }
}

// ═════════════════════════════════════════════════════════
// ── 倒数日 ───────────────────────────────────────────────
// ═════════════════════════════════════════════════════════
let countdownData = [];

async function loadCountdown() {
    try {
        countdownData = await api('/api/countdowns');
        renderCountdownList();
        _countdownLoaded = true;
    } catch (e) {
        console.error('加载倒数日失败:', e);
        const container = document.getElementById('countdown-list');
        if (container) container.innerHTML = `<div class="card"><p class="text-text-muted text-sm text-center">${esc(e.message || '加载失败')}</p></div>`;
    }
}

function renderCountdownList() {
    const container = document.getElementById('countdown-list');
    if (!container) return;
    if (!Array.isArray(countdownData) || countdownData.length === 0) {
        container.innerHTML = '<p class="text-text-muted text-sm text-center py-4">暂无倒数日，点击右上角添加</p>';
        return;
    }

    let html = '';
    countdownData.forEach(item => {
        let daysText, daysColor;
        if (item.days_left > 0) {
            daysText = '还有' + item.days_left + '天';
            daysColor = 'text-accent';
        } else if (item.days_left === 0) {
            daysText = '今天';
            daysColor = 'text-red-400';
        } else {
            daysText = '已过' + Math.abs(item.days_left) + '天';
            daysColor = 'text-text-muted';
        }
        html += `<div class="card flex items-center gap-4 cursor-pointer hover:opacity-80 transition-opacity" data-countdown-click data-id="${item.id}">
            <div class="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
                <i data-lucide="calendar-heart" class="w-5 h-5 text-accent"></i>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-text-primary truncate">${esc(item.title)}</p>
                <p class="text-xs text-text-muted font-mono truncate">${esc(item.target_date)}${item.note ? ' · ' + esc(item.note) : ''}</p>
            </div>
            <span class="text-sm font-bold flex-shrink-0 ${daysColor}">${daysText}</span>
        </div>`;
    });
    container.innerHTML = html;
    lucide.createIcons();
    // 事件委托：每次渲染重新绑定到当前容器
    container.onclick = (e) => {
        const el = e.target.closest('[data-countdown-click]');
        if (!el) return;
        const id = parseInt(el.dataset.id);
        const item = countdownData.find(c => c.id === id);
        if (item) showCountdownModal(item);
    };
}

function showCountdownModal(item) {
    const isEdit = !!item;
    document.getElementById('cm-id').value = isEdit ? item.id : '';
    document.getElementById('cm-title').value = isEdit ? (item.title || '') : '';
    document.getElementById('cm-date').value = isEdit ? (item.target_date || '') : getLocalDate();
    document.getElementById('cm-note').value = isEdit ? (item.note || '') : '';
    document.getElementById('countdown-modal-title').textContent = isEdit ? '编辑倒数日' : '添加倒数日';
    document.getElementById('cm-delete-btn').classList.toggle('hidden', !isEdit);
    const m = document.getElementById('countdown-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
    if (!isEdit) document.getElementById('cm-title').focus();
}

function closeCountdownModal() {
    const m = document.getElementById('countdown-modal');
    m.classList.add('hidden');
    m.classList.remove('flex');
}

async function saveCountdown() {
    const id = document.getElementById('cm-id').value;
    const title = document.getElementById('cm-title').value.trim();
    const targetDate = document.getElementById('cm-date').value;
    const note = document.getElementById('cm-note').value;
    if (!title) { showToast('请输入标题'); return; }
    if (!targetDate) { showToast('请选择日期'); return; }
    try {
        if (id) {
            await api(`/api/countdowns/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ title, target_date: targetDate, note })
            });
            showToast('已更新');
        } else {
            await api('/api/countdowns', {
                method: 'POST',
                body: JSON.stringify({ title, target_date: targetDate, note })
            });
            showToast('已添加');
        }
        closeCountdownModal();
        await loadCountdown();
    } catch (e) { showToast(e.message); }
}

async function deleteCountdownFromModal() {
    const id = document.getElementById('cm-id').value;
    if (!id) return;
    if (!await showConfirm('确定删除此倒数日？', { confirmText: '删除', danger: true })) return;
    try {
        await api(`/api/countdowns/${id}`, { method: 'DELETE' });
        showToast('已删除');
        closeCountdownModal();
        await loadCountdown();
    } catch (e) { showToast(e.message); }
}

// ═════════════════════════════════════════════════════════
// ── 全部日程（历史日历） ─────────────────────────────────
// ═════════════════════════════════════════════════════════
let calYear, calMonth, selectedDate, currentFilter = 'all';
let recordDates = new Set();
let vaccineVaccinatedDates = new Set();
let vaccineOverdueDates = new Set();
let vaccineUpcomingDates = new Set();
let healthCompletedDates = new Set();
let healthPlannedDates = new Set();
let countdownDates = new Map();

function formatDateISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function initCalendar() {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    selectedDate = formatDateISO(now);
    const dp = document.getElementById('schedule-date-picker');
    if (dp) dp.value = selectedDate;
    updateDateDisplay(selectedDate);
    recordDates.clear();
    vaccineVaccinatedDates.clear();
    vaccineOverdueDates.clear();
    vaccineUpcomingDates.clear();
    healthCompletedDates.clear();
    healthPlannedDates.clear();
    countdownDates.clear();
    await Promise.all([loadRecordDates(), loadVaccineDates(), loadHealthDates(), loadCountdownDates()]);
    _scheduleLoaded = true;
    renderCalendar();
    updateDateDiffLabel(selectedDate);
    loadRecords(selectedDate);
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

async function loadHealthDates() {
    try {
        const data = await api('/api/health/dates');
        if (data.completed) data.completed.forEach(d => healthCompletedDates.add(d));
        if (data.upcoming) data.upcoming.forEach(d => healthPlannedDates.add(d));
        if (data.overdue) data.overdue.forEach(d => healthPlannedDates.add(d));
    } catch (e) { /* ignore */ }
}

async function loadCountdownDates() {
    try {
        const list = await api('/api/countdowns');
        countdownDates.clear();
        list.forEach(c => {
            if (!countdownDates.has(c.target_date)) {
                countdownDates.set(c.target_date, []);
            }
            countdownDates.get(c.target_date).push(c);
        });
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
    if (!label) return;
    label.textContent = `${calYear}年${calMonth + 1}月`;

    const grid = document.getElementById('cal-grid');
    if (!grid) return;
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
        const hasHealthDone = healthCompletedDates.has(dateStr);
        const hasHealthPlan = healthPlannedDates.has(dateStr);
        const hasCountdown = countdownDates.has(dateStr);

        let cls = 'cal-day';
        if (isToday) cls += ' today';
        if (isSelected) cls += ' selected';

        let dotsHtml = '';
        if (hasRecord || hasVaccine || hasOverdue || hasUpcoming || hasHealthDone || hasHealthPlan || hasCountdown) {
            dotsHtml = '<div class="cal-dots">';
            if (hasRecord) dotsHtml += '<span class="cal-dot-feed"></span>';
            if (hasVaccine) dotsHtml += '<span class="cal-dot-vaccine"></span>';
            if (hasHealthDone) dotsHtml += '<span class="cal-dot-health"></span>';
            if (hasHealthPlan) dotsHtml += '<span class="cal-dot-health-plan"></span>';
            if (hasCountdown) dotsHtml += '<span class="cal-dot-countdown"></span>';
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
    const dp = document.getElementById('schedule-date-picker');
    if (dp) dp.value = dateStr;
    updateDateDisplay(dateStr);
    renderCalendar();
    updateDateDiffLabel(dateStr);
    loadRecords(dateStr);
}

function onScheduleDatePick(dateStr) {
    if (!dateStr) return;
    const d = new Date(dateStr);
    calYear = d.getFullYear();
    calMonth = d.getMonth();
    selectedDate = dateStr;
    updateDateDisplay(dateStr);
    renderCalendar();
    updateDateDiffLabel(dateStr);
    loadRecords(dateStr);
}

function updateDateDisplay(dateStr) {
    const el = document.getElementById('date-display');
    if (!el || !dateStr) return;
    const d = new Date(dateStr);
    el.textContent = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function updateDateDiffLabel(dateStr) {
    const el = document.getElementById('date-diff-label');
    if (!el) return;
    const today = formatDateISO(new Date());
    const diff = Math.round((new Date(dateStr) - new Date(today)) / 86400000);
    let diffText;
    if (diff === 0) diffText = '今天';
    else if (diff > 0) diffText = `${diff} 天后`;
    else diffText = `${Math.abs(diff)} 天前`;
    el.textContent = `${dateStr} · ${diffText}`;
}

async function loadRecords(dateStr) {
    const container = document.getElementById('records-list');
    if (!container) return;

    const promises = [];

    if (currentFilter === 'all' || currentFilter === 'vaccine') {
        promises.push(
            api(`/api/vaccine/day-records?date=${dateStr}`).catch(() => ({ vaccinated: [], planned: [] }))
        );
    } else {
        promises.push(Promise.resolve({ vaccinated: [], planned: [] }));
    }

    if (currentFilter === 'all' || currentFilter === 'health') {
        promises.push(
            api(`/api/health/day-records?date=${dateStr}`).catch(() => ({ completed: [], planned: [] }))
        );
    } else {
        promises.push(Promise.resolve({ completed: [], planned: [] }));
    }

    if (currentFilter === 'all' || (currentFilter !== 'vaccine' && currentFilter !== 'health' && currentFilter !== 'countdown')) {
        let url = `/api/records?date=${dateStr}`;
        if (currentFilter !== 'all' && currentFilter !== 'vaccine' && currentFilter !== 'health' && currentFilter !== 'countdown') url += `&type=${currentFilter}`;
        promises.push(api(url).catch(() => []));
    } else {
        promises.push(Promise.resolve([]));
    }

    try {
        const [vaccineData, healthData, records] = await Promise.all(promises);
        const countdownList = (currentFilter === 'all' || currentFilter === 'countdown')
            ? (countdownDates.get(dateStr) || [])
            : [];
        renderRecords(records, vaccineData, healthData, countdownList, dateStr);
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

function renderRecords(records, vaccineData, healthData, countdownList, dateStr) {
    const container = document.getElementById('records-list');
    if (!container) return;
    const items = [];

    if (records && records.length > 0) {
        records.forEach(r => {
            const badgeMap = { feed: 'badge-feed', excrete: 'badge-excrete', symptom: 'badge-symptom', supplement: 'badge-supplement' };
            const typeClass = badgeMap[r.type] || 'badge-symptom';
            const bgMap = { feed: 'bg-blue-500/10', excrete: 'bg-amber-500/10', symptom: 'bg-red-500/10', supplement: 'bg-purple-500/10' };
            const iconMap = { feed: 'droplets', excrete: 'circle-dot', symptom: 'heart-pulse', supplement: 'pill' };
            const colorMap = { feed: 'text-blue-400', excrete: 'text-amber-400', symptom: 'text-red-400', supplement: 'text-purple-400' };

            let detail = '';
            if (r.amount) {
                const unit = (r.sub_type === 'solid_food' && r.food_unit) ? r.food_unit : 'ml';
                detail += `${r.amount}${unit}`;
            }
            if (r.duration) detail += ` · ${r.duration}分钟`;
            if (r.temperature) detail += ` · ${r.temperature}°C`;
            if (r.color) detail += ` · ${r.color}`;
            if (r.consistency) detail += ` · ${r.consistency}`;
            if (r.note) detail += ` · ${r.note}`;

            items.push(`
            <div class="card flex items-center gap-3 py-3 px-4 fade-in">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${bgMap[r.type] || bgMap.symptom}">
                    <i data-lucide="${iconMap[r.type] || iconMap.symptom}" class="w-4 h-4 ${colorMap[r.type] || colorMap.symptom}"></i>
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
                    <button class="text-text-muted hover:text-amber-400 transition-colors p-1" onclick="openEditModal(${r.id}, onScheduleEditSaved)" title="编辑">
                        <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
                    </button>
                    <button class="text-text-muted hover:text-red-400 transition-colors p-1" onclick="deleteRecord(${r.id})" title="删除">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            </div>`);
        });
    }

    if (vaccineData) {
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

    if (healthData) {
        if (healthData.completed && healthData.completed.length > 0) {
            healthData.completed.forEach(h => {
                items.push(`
                <div class="card flex items-center gap-3 py-3 px-4 fade-in">
                    <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-teal-500/10">
                        <i data-lucide="stethoscope" class="w-4 h-4 text-teal-400"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="text-sm text-text-primary">${esc(h.label)}</span>
                            <span class="text-xs px-1.5 py-0.5 rounded border badge-health">随访</span>
                        </div>
                        <p class="text-xs text-text-muted mt-0.5">已完成随访${h.note ? ' · ' + esc(h.note) : ''}</p>
                    </div>
                    <span class="font-mono text-xs text-teal-400 flex-shrink-0">${esc(h.completed_date)}</span>
                </div>`);
            });
        }
        if (healthData.planned && healthData.planned.length > 0) {
            healthData.planned.forEach(h => {
                const isOverdue = h.status === 'overdue';
                items.push(`
                <div class="card flex items-center gap-3 py-3 px-4 fade-in">
                    <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isOverdue ? 'bg-gray-500/10' : 'bg-teal-500/10'}">
                        <i data-lucide="calendar-clock" class="w-4 h-4 ${isOverdue ? 'text-gray-400' : 'text-teal-400'}"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="text-sm text-text-primary">${esc(h.label)}</span>
                            <span class="text-xs px-1.5 py-0.5 rounded border badge-health">随访</span>
                        </div>
                        <p class="text-xs text-text-muted mt-0.5">${isOverdue ? '逾期未随访' : '计划随访'}${h.location ? ' · ' + esc(h.location) : ''}</p>
                    </div>
                    <span class="font-mono text-xs ${isOverdue ? 'text-gray-400' : 'text-teal-400'} flex-shrink-0">${esc(h.due_date)}</span>
                </div>`);
            });
        }
    }

    // 倒数日
    if (countdownList && countdownList.length > 0) {
        countdownList.forEach(c => {
            const daysLeft = c.days_left;
            let statusText = '';
            let statusColor = 'text-pink-400';
            if (daysLeft === null || daysLeft === undefined) {
                statusText = '日期无效';
            } else if (daysLeft > 0) {
                statusText = `还有 ${daysLeft} 天`;
            } else if (daysLeft === 0) {
                statusText = '就是今天';
                statusColor = 'text-red-400';
            } else {
                statusText = `已过去 ${Math.abs(daysLeft)} 天`;
                statusColor = 'text-text-muted';
            }
            items.push(`
            <div class="card flex items-center gap-3 py-3 px-4 fade-in">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-pink-500/10">
                    <i data-lucide="calendar-heart" class="w-4 h-4 text-pink-400"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="text-sm text-text-primary">${esc(c.title)}</span>
                        <span class="text-xs px-1.5 py-0.5 rounded border badge-countdown">倒数日</span>
                    </div>
                    <p class="text-xs text-text-muted mt-0.5">${esc(statusText)}${c.note ? ' · ' + esc(c.note) : ''}</p>
                </div>
                <span class="font-mono text-xs ${statusColor} flex-shrink-0">${esc(c.target_date)}</span>
            </div>`);
        });
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

function onScheduleEditSaved() {
    if (selectedDate) loadRecords(selectedDate);
}

async function deleteRecord(id) {
    if (!await showConfirm('确定删除此记录？', { confirmText: '删除', danger: true })) return;
    try {
        await api(`/api/records/${id}`, { method: 'DELETE' });
        showToast('已删除');
        if (selectedDate) loadRecords(selectedDate);
    } catch (e) {
        showToast(e.message || '删除失败');
    }
}
