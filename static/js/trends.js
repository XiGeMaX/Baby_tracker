// ── Trends Page ──────────────────────────────────────────
let trendsData = null;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('weight-date').value = new Date().toISOString().slice(0, 10);
    loadTrends();
});

async function loadTrends() {
    const days = document.getElementById('trend-days').value;
    try {
        trendsData = await api(`/api/stats/trends?days=${days}`);
        renderWeightChart();
        renderFeedChart();
        renderHourChart();
        renderExcreteChart();
    } catch (e) {
        console.error('加载趋势失败:', e);
    }
}

// ── Weight Chart ─────────────────────────────────────────
function renderWeightChart() {
    const container = document.getElementById('weight-chart');
    const list = document.getElementById('weight-list');
    const weights = trendsData.weights;

    if (!weights || weights.length === 0) {
        container.innerHTML = '<p class="text-text-muted text-sm w-full text-center self-center">暂无体重数据，点击右上角记录</p>';
        list.innerHTML = '';
        return;
    }

    const minW = Math.min(...weights.map(w => w.weight)) * 0.95;
    const maxW = Math.max(...weights.map(w => w.weight)) * 1.05;
    const range = maxW - minW || 0.5;

    // 柱子区域和标签分离：柱子用 flex+items-end，百分比高度直接设在 flex 子元素上
    let barsHtml = '';
    let labelsHtml = '';
    weights.forEach(w => {
        const pct = Math.max(5, ((w.weight - minW) / range) * 100);
        const label = w.recorded_date.slice(5);
        barsHtml += `<div class="flex-1 relative group cursor-default" style="height:${pct}%">
            <div class="absolute -top-6 left-1/2 -translate-x-1/2 bg-surface border border-border rounded px-1.5 py-0.5 text-[10px] font-mono text-accent opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-lg">${w.weight}kg</div>
            <div class="w-full h-full min-w-[8px] bg-accent/60 rounded-t hover:bg-accent transition-colors"></div>
        </div>`;
        labelsHtml += `<span class="flex-1 text-center text-[9px] text-text-muted">${label}</span>`;
    });
    container.innerHTML = `<div class="flex items-end gap-1" style="height:calc(100% - 16px)">${barsHtml}</div>
        <div class="flex gap-1 mt-0.5">${labelsHtml}</div>`;

    list.innerHTML = weights.slice().reverse().slice(0, 5).map(w => `
        <div class="flex items-center justify-between py-1 text-xs">
            <span class="text-text-muted font-mono">${w.recorded_date}</span>
            <span class="font-mono text-text-primary">${w.weight} kg</span>
        </div>
    `).join('');
}

// ── Feed Chart ───────────────────────────────────────────
function renderFeedChart() {
    const container = document.getElementById('feed-chart');
    const daily = trendsData.daily;

    if (!daily || daily.length === 0) {
        container.innerHTML = '<p class="text-text-muted text-sm absolute inset-0 flex items-center justify-center">暂无数据</p>';
        return;
    }

    const hasData = daily.some(d => d.feed_ml > 0);
    if (!hasData) {
        container.innerHTML = '<p class="text-text-muted text-sm absolute inset-0 flex items-center justify-center">暂无喂养数据</p>';
        return;
    }

    const maxMl = Math.max(...daily.map(d => d.feed_ml));
    const targetMl = trendsData.target_ml || 500;
    const yMax = Math.max(maxMl, targetMl) * 1.15;
    const targetPct = (targetMl / yMax) * 100;

    // Y轴刻度
    const ySteps = 4;
    let yLabelsHtml = '';
    let gridHtml = '';
    for (let i = 0; i <= ySteps; i++) {
        const val = Math.round(yMax * (1 - i / ySteps));
        const bottomPct = ((ySteps - i) / ySteps) * 100;
        yLabelsHtml += `<span class="absolute left-0 right-1 text-[9px] font-mono text-text-muted text-right" style="bottom:${bottomPct}%; transform: translateY(50%)">${val}</span>`;
        if (i < ySteps) {
            gridHtml += `<div class="absolute left-0 right-0 border-t border-border/30" style="bottom:${bottomPct}%"></div>`;
        }
    }

    // 目标线
    gridHtml += `<div class="absolute left-0 right-0 border-t border-dashed border-accent/40" style="bottom:${targetPct}%"></div>
        <span class="absolute right-1 text-[9px] text-accent/60 font-mono" style="bottom:${targetPct}%; transform: translateY(-100%)">目标 ${targetMl}ml</span>`;

    // 柱子 - 作为 flex 直接子元素，百分比高度才能生效
    let barsHtml = '';
    let labelsHtml = '';
    daily.forEach(d => {
        const pct = d.feed_ml > 0 ? Math.max(2, (d.feed_ml / yMax) * 100) : 0;
        const label = d.date.slice(8);
        const isToday = d.date === getLocalDate();
        const color = isToday ? 'bg-accent' : 'bg-accent/40';
        barsHtml += `<div class="flex-1 relative group cursor-default" style="height:${pct}%">
            <div class="absolute -top-8 left-1/2 -translate-x-1/2 bg-surface border border-border rounded px-1.5 py-1 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-lg">
                <div class="font-mono text-accent">${d.feed_ml}ml</div>
                <div class="text-text-muted">${d.feed_count}次</div>
            </div>
            <div class="w-full h-full min-w-[4px] ${color} rounded-t hover:bg-accent transition-colors"></div>
        </div>`;
        labelsHtml += `<span class="flex-1 text-center text-[8px] ${isToday ? 'text-accent font-bold' : 'text-text-muted'}">${label}</span>`;
    });

    container.innerHTML = `
        <div class="absolute left-0 top-0 w-7" style="bottom:20px">${yLabelsHtml}<span class="absolute left-0 right-0 text-[9px] text-text-muted text-center" style="top:50%; transform: translateY(-50%) rotate(-90deg)">ml</span></div>
        <div class="absolute left-7 right-0 top-0 pointer-events-none" style="bottom:20px">${gridHtml}</div>
        <div class="absolute left-7 right-0 top-0 flex items-end gap-1" style="bottom:20px">${barsHtml}</div>
        <div class="absolute left-7 right-0 flex gap-1" style="bottom:2px">${labelsHtml}</div>`;
}

// ── Hour Chart ───────────────────────────────────────────
function renderHourChart() {
    const container = document.getElementById('hour-chart');
    const hours = trendsData.feed_hours;

    if (!hours || hours.length === 0) {
        container.innerHTML = '<p class="text-text-muted text-sm w-full text-center self-center">暂无数据</p>';
        return;
    }

    const maxCount = Math.max(...hours.map(h => h.count), 1);
    const hourMap = {};
    hours.forEach(h => { hourMap[h.hour] = h.count; });

    let barsHtml = '';
    for (let h = 0; h <= 23; h++) {
        const count = hourMap[h] || 0;
        const pct = count > 0 ? Math.max(3, (count / maxCount) * 100) : 0;
        const isActive = count > 0;
        const hourLabel = `${h}:00-${(h + 1) % 24}:00`;
        const barColor = isActive ? 'bg-blue-400/60 hover:bg-blue-400' : 'bg-border/30';
        const barH = isActive ? pct : 2;
        barsHtml += `<div class="flex-1 relative group cursor-default" style="height:${barH}%">
            ${isActive ? `<div class="absolute -top-6 left-1/2 -translate-x-1/2 bg-surface border border-border rounded px-1.5 py-0.5 text-[9px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-lg">
                <span class="font-mono text-blue-400">${count}次</span>
                <span class="text-text-muted ml-1">${hourLabel}</span>
            </div>` : ''}
            <div class="w-full h-full min-w-[2px] ${barColor} rounded-t transition-colors"></div>
        </div>`;
    }
    container.innerHTML = barsHtml;
}

// ── Excrete Chart ────────────────────────────────────────
function renderExcreteChart() {
    const container = document.getElementById('excrete-chart');
    const daily = trendsData.daily;

    if (!daily || daily.length === 0) {
        container.innerHTML = '<p class="text-text-muted text-sm absolute inset-0 flex items-center justify-center">暂无数据</p>';
        return;
    }

    const hasData = daily.some(d => d.urine_count > 0 || d.stool_count > 0);
    if (!hasData) {
        container.innerHTML = '<p class="text-text-muted text-sm absolute inset-0 flex items-center justify-center">暂无排泄数据</p>';
        return;
    }

    // Y轴取每日总排泄次数的最大值
    const maxTotal = Math.max(...daily.map(d => d.urine_count + d.stool_count), 1);
    const yMax = Math.ceil(maxTotal * 1.2 / 2) * 2 || 2;

    // Y轴刻度
    const ySteps = Math.min(yMax, 4);
    let yLabelsHtml = '';
    let gridHtml = '';
    for (let i = 0; i <= ySteps; i++) {
        const val = Math.round(yMax * (1 - i / ySteps));
        const bottomPct = ((ySteps - i) / ySteps) * 100;
        yLabelsHtml += `<span class="absolute left-0 right-1 text-[9px] font-mono text-text-muted text-right" style="bottom:${bottomPct}%; transform: translateY(50%)">${val}</span>`;
        if (i < ySteps) {
            gridHtml += `<div class="absolute left-0 right-0 border-t border-border/30" style="bottom:${bottomPct}%"></div>`;
        }
    }

    // 堆叠柱：每个柱子是一个 flex-col，尿在上便在下
    let barsHtml = '';
    let labelsHtml = '';
    daily.forEach(d => {
        const urinePct = (d.urine_count / yMax) * 100;
        const stoolPct = (d.stool_count / yMax) * 100;
        const totalPct = urinePct + stoolPct;
        const label = d.date.slice(8);
        const barH = totalPct > 0 ? totalPct : 0.5;
        barsHtml += `<div class="flex-1 relative group cursor-default" style="height:${barH}%">
            <div class="absolute -top-8 left-1/2 -translate-x-1/2 bg-surface border border-border rounded px-1.5 py-1 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-lg">
                <div class="text-amber-400 font-mono">尿 ${d.urine_count}次</div>
                <div class="text-red-400 font-mono">便 ${d.stool_count}次</div>
            </div>
            <div class="w-full h-full flex flex-col justify-end min-w-[4px]">
                ${d.urine_count > 0 ? `<div class="w-full bg-amber-400/60 rounded-t hover:bg-amber-400/80 transition-colors" style="height:${urinePct}%; min-height:2px"></div>` : ''}
                ${d.stool_count > 0 ? `<div class="w-full bg-red-400/60 rounded-b hover:bg-red-400/80 transition-colors" style="height:${stoolPct}%; min-height:2px"></div>` : ''}
            </div>
        </div>`;
        labelsHtml += `<span class="flex-1 text-center text-[8px] text-text-muted">${label}</span>`;
    });

    container.innerHTML = `
        <div class="absolute left-0 top-0 w-7" style="bottom:16px">${yLabelsHtml}<span class="absolute left-0 right-0 text-[9px] text-text-muted text-center" style="top:50%; transform: translateY(-50%) rotate(-90deg)">次</span></div>
        <div class="absolute left-7 right-0 top-0 pointer-events-none" style="bottom:16px">${gridHtml}</div>
        <div class="absolute left-7 right-0 top-0 flex items-end gap-1" style="bottom:16px">${barsHtml}</div>
        <div class="absolute left-7 right-0 flex gap-1" style="bottom:0">${labelsHtml}</div>`;
}

// ── Weight Modal ─────────────────────────────────────────
function showWeightModal() {
    const m = document.getElementById('weight-modal');
    if (!m) return;
    m.classList.remove('hidden');
    m.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
    document.getElementById('weight-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('weight-value').value = '';
    document.getElementById('weight-note').value = '';
    document.getElementById('weight-value').focus();
}

function closeWeightModal() {
    const m = document.getElementById('weight-modal');
    if (!m) return;
    m.classList.add('hidden');
    m.classList.remove('flex');
}

async function saveWeight() {
    const weight = parseFloat(document.getElementById('weight-value').value);
    const recorded_date = document.getElementById('weight-date').value;
    const note = document.getElementById('weight-note').value;

    if (!weight || weight <= 0) {
        showToast('请输入有效体重');
        return;
    }
    if (!recorded_date) {
        showToast('请选择日期');
        return;
    }

    try {
        await api('/api/weight-logs', {
            method: 'POST',
            body: JSON.stringify({ weight, recorded_date, note })
        });
        showToast('体重已记录');
        closeWeightModal();
        loadTrends();
    } catch (e) {
        showToast(e.message);
    }
}
