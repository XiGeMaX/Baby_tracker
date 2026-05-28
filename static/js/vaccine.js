// ── Vaccine Page ─────────────────────────────────────────
let vaccineData = null;

document.addEventListener('DOMContentLoaded', () => {
    loadVaccine();
});

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

    let html = '';
    for (const [name, doses] of Object.entries(groups)) {
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
        // 已接种：弹出编辑弹窗（可修改日期/备注/删除）
        showEditVaccineModal(name, doseIndex, vaccinatedDate, note);
    } else {
        // 未接种：弹出计划日期修改弹窗（可修改计划日期或直接记录接种）
        showPlanDateModal(name, doseIndex, dueDate);
    }
}

// ── 计划日期修改弹窗 ─────────────────────────────────────
function showPlanDateModal(name, doseIndex, dueDate) {
    document.getElementById('pdm-name').value = name;
    document.getElementById('pdm-dose').value = doseIndex;
    document.getElementById('pdm-date').value = dueDate || new Date().toISOString().slice(0, 10);
    document.getElementById('plan-date-modal-title').textContent = `${name} 第${doseIndex}剂`;
    const m = document.getElementById('plan-date-modal');
    m.classList.remove('hidden');
    m.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
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

// ── 自定义疫苗弹窗 ───────────────────────────────────────
function showAddVaccineModal() {
    document.getElementById('av-name').value = '';
    document.getElementById('av-dose').value = '1';
    document.getElementById('av-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('av-note').value = '';
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

async function saveCustomVaccine() {
    const name = document.getElementById('av-name').value.trim();
    const doseIndex = parseInt(document.getElementById('av-dose').value) || 1;
    const vaccinatedDate = document.getElementById('av-date').value;
    const note = document.getElementById('av-note').value;
    if (!name) { showToast('请输入疫苗名称'); return; }
    if (!vaccinatedDate) { showToast('请选择日期'); return; }
    try {
        await api('/api/vaccine/record', {
            method: 'POST',
            body: JSON.stringify({ vaccine_name: name, dose_index: doseIndex, vaccinated_date: vaccinatedDate, note })
        });
        showToast(`${name} 第${doseIndex}剂 已记录`);
        closeAddVaccineModal();
        await loadVaccine();
    } catch (e) { showToast(e.message); }
}
