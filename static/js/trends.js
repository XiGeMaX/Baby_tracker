// ── Trends Page (Chart.js) ───────────────────────────────
let trendsData = null;
let trendsMode = 'day'; // day / month / hour
let weightChartInstance = null;
let feedChartInstance = null;
let hourChartInstance = null;
let excreteChartInstance = null;
let foodChartInstance = null;
let _trendsObserver = null;

function initTrends() {
    const wd = document.getElementById('weight-date');
    if (wd) wd.value = new Date().toISOString().slice(0, 10);
    const hd = document.getElementById('hour-chart-day');
    if (hd) hd.value = new Date().toISOString().slice(0, 10);
    const td = document.getElementById('trend-date');
    if (td) td.value = new Date().toISOString().slice(0, 10);
    const wdays = document.getElementById('weight-days');
    if (wdays) wdays.value = '30';
    updateModeUI();
    updateRangeDisplay();
    updateWeightDaysDisplay();
    updateHourDayDisplay();
    loadTrends();

    if (!_trendsObserver) {
        _trendsObserver = new MutationObserver(() => {
            if (trendsData) {
                renderWeightChart();
                renderFeedChart();
                renderHourChart();
                renderExcreteChart();
                renderFoodChart();
            }
        });
        _trendsObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });
    }
}

document.addEventListener('DOMContentLoaded', initTrends);

// ── 模式切换 ─────────────────────────────────────────────
function switchTrendMode(mode) {
    if (mode === trendsMode) return;
    trendsMode = mode;
    updateModeUI();
    updateRangeDisplay();
    loadTrends();
}

function updateModeUI() {
    document.querySelectorAll('[data-mode]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === trendsMode);
    });
    // 范围选择器：日/月模式显示 select，时模式显示 date input（位置固定不变）
    const daysSel = document.getElementById('trend-days');
    const dateInput = document.getElementById('trend-date');
    if (daysSel && dateInput) {
        if (trendsMode === 'hour') {
            daysSel.classList.add('hidden');
            dateInput.classList.remove('hidden');
        } else {
            daysSel.classList.remove('hidden');
            dateInput.classList.add('hidden');
            // 月模式下选项调整
            if (trendsMode === 'month') {
                daysSel.innerHTML = `
                    <option value="30">30天</option>
                    <option value="90" selected>90天</option>
                    <option value="180">半年</option>
                    <option value="365">1年</option>
                `;
                daysSel.value = '90';
            } else if (trendsMode === 'day') {
                daysSel.innerHTML = `
                    <option value="7">7天</option>
                    <option value="14" selected>14天</option>
                    <option value="30">30天</option>
                    <option value="60">60天</option>
                    <option value="90">90天</option>
                `;
                daysSel.value = '14';
            }
        }
    }
    // 喂养时段分布卡片：仅日模式显示
    const hourCard = document.getElementById('hour-card');
    if (hourCard) hourCard.style.display = trendsMode === 'day' ? '' : 'none';
    // 喂养量标题
    const feedTitle = document.getElementById('feed-chart-title');
    if (feedTitle) feedTitle.textContent = trendsMode === 'day' ? '每日喂养量' : trendsMode === 'month' ? '每月喂养量' : '每时喂养量';
    const excreteTitle = document.getElementById('excrete-chart-title');
    if (excreteTitle) excreteTitle.textContent = trendsMode === 'day' ? '每日排泄' : trendsMode === 'month' ? '每月排泄' : '每时排泄';
    const foodTitle = document.getElementById('food-chart-title');
    if (foodTitle) foodTitle.textContent = trendsMode === 'day' ? '每日辅食' : trendsMode === 'month' ? '每月辅食' : '每时辅食';
}

// 更新范围选择器显示文本
function updateRangeDisplay() {
    const display = document.getElementById('range-display');
    if (!display) return;
    if (trendsMode === 'hour') {
        const dateInput = document.getElementById('trend-date');
        const val = dateInput ? dateInput.value : '';
        display.textContent = val ? val.slice(5) : '选择日期';
    } else {
        const daysSel = document.getElementById('trend-days');
        if (daysSel) {
            const opt = daysSel.options[daysSel.selectedIndex];
            display.textContent = opt ? opt.text : '14天';
        }
    }
}

// 更新体重天数选择器显示文本
function updateWeightDaysDisplay() {
    const display = document.getElementById('weight-days-display');
    const sel = document.getElementById('weight-days');
    if (display && sel) {
        const opt = sel.options[sel.selectedIndex];
        display.textContent = opt ? opt.text : '30天';
    }
}

// 更新时段日期选择器显示文本
function updateHourDayDisplay() {
    const display = document.getElementById('hour-day-display');
    const input = document.getElementById('hour-chart-day');
    if (!display || !input) return;
    if (input.value) {
        display.textContent = input.value.slice(5);
    } else {
        display.textContent = '全部';
    }
}

// 范围选择器变更回调（select 或 date input 共用）
function onRangeChange(value) {
    updateRangeDisplay();
    loadTrends();
}

// 时段日期选择器变更回调
function onHourDayChange(value) {
    updateHourDayDisplay();
    renderHourChart();
}

async function loadTrends() {
    const weightDaysEl = document.getElementById('weight-days');
    const weightDays = weightDaysEl ? weightDaysEl.value : '30';
    let url = `/api/stats/trends?weight_days=${weightDays}&mode=${trendsMode}`;
    if (trendsMode === 'hour') {
        const dateInput = document.getElementById('trend-date');
        const dateVal = dateInput ? dateInput.value : '';
        if (dateVal) url += `&date=${dateVal}`;
    } else {
        const daysEl = document.getElementById('trend-days');
        const days = daysEl ? daysEl.value : '14';
        url += `&days=${days}`;
    }
    try {
        trendsData = await api(url);
        renderWeightChart();
        renderFeedChart();
        renderHourChart();
        renderExcreteChart();
        renderFoodChart();
    } catch (e) {
        console.error('加载趋势失败:', e);
    }
}

async function loadWeightTrend() {
    updateWeightDaysDisplay();
    const weightDaysEl = document.getElementById('weight-days');
    const weightDays = weightDaysEl ? weightDaysEl.value : '30';
    let url = `/api/stats/trends?weight_days=${weightDays}&mode=${trendsMode}`;
    if (trendsMode === 'hour') {
        const dateInput = document.getElementById('trend-date');
        const dateVal = dateInput ? dateInput.value : '';
        if (dateVal) url += `&date=${dateVal}`;
    } else {
        const daysEl = document.getElementById('trend-days');
        const days = daysEl ? daysEl.value : '14';
        url += `&days=${days}`;
    }
    try {
        const data = await api(url);
        if (trendsData) {
            trendsData.weights = data.weights;
            if (data.weight_days !== undefined) {
                trendsData.weight_days = data.weight_days;
            }
        } else {
            trendsData = data;
        }
        renderWeightChart();
    } catch (e) {
        console.error('加载体重趋势失败:', e);
    }
}

// ── 主题颜色 ─────────────────────────────────────────────
function getThemeColors() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    return {
        accent: isLight ? '#059669' : '#00e5a0',
        accentBg: isLight ? 'rgba(5,150,105,0.15)' : 'rgba(0,229,160,0.15)',
        blue: isLight ? '#2563eb' : '#60a5fa',
        blueBg: isLight ? 'rgba(37,99,235,0.5)' : 'rgba(96,165,250,0.5)',
        amber: isLight ? '#b45309' : '#fbbf24',
        amberBg: isLight ? 'rgba(180,83,9,0.5)' : 'rgba(251,191,36,0.5)',
        red: isLight ? '#dc2626' : '#f87171',
        redBg: isLight ? 'rgba(220,38,38,0.5)' : 'rgba(248,113,113,0.5)',
        purple: isLight ? '#7c3aed' : '#a78bfa',
        purpleBg: isLight ? 'rgba(124,58,237,0.5)' : 'rgba(167,139,250,0.5)',
        cyan: isLight ? '#0891b2' : '#22d3ee',
        cyanBg: isLight ? 'rgba(8,145,178,0.5)' : 'rgba(34,211,238,0.5)',
        pink: isLight ? '#db2777' : '#f472b6',
        pinkBg: isLight ? 'rgba(219,39,119,0.5)' : 'rgba(244,114,182,0.5)',
        grid: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(128,128,128,0.1)',
        text: isLight ? '#64748b' : '#94a3b8',
        surface: isLight ? '#ffffff' : '#1a1b26',
        border: isLight ? '#e5e7eb' : '#2a2b3d',
        tooltipBg: isLight ? '#ffffff' : '#1a1b26',
        tooltipBorder: isLight ? '#e5e7eb' : '#2a2b3d',
    };
}

function commonScaleOptions(colors, unit) {
    return {
        grid: { color: colors.grid, drawBorder: false },
        ticks: {
            color: colors.text,
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            callback: function(value) { return value + (unit || ''); }
        },
        border: { display: false },
    };
}

function commonTooltipConfig(colors) {
    return {
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        borderWidth: 1,
        titleColor: colors.text,
        bodyColor: colors.text,
        titleFont: { family: "'Noto Sans SC', sans-serif", size: 11 },
        bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
        padding: 8,
        cornerRadius: 6,
        displayColors: true,
        boxPadding: 4,
    };
}

function destroyChart(instance) {
    if (instance) {
        instance.destroy();
    }
    return null;
}

// 根据模式返回 X 轴标签的格式化回调
function getXAxisTickCallback(mode) {
    if (mode === 'month') {
        return function(value) {
            const label = this.getLabelForValue(value);
            // "2026-07" -> "07月"
            const parts = label.split('-');
            return parts.length >= 2 ? parts[1] + '月' : label;
        };
    }
    if (mode === 'hour') {
        return function(value, index) {
            const label = this.getLabelForValue(value);
            // "08:00" -> "08"
            return label.slice(0, 2);
        };
    }
    return function(value) {
        // day mode: "2026-07-23" -> "07-23"
        return this.getLabelForValue(value).slice(5);
    };
}

// ── Weight Chart (Line) ─────────────────────────────────
function renderWeightChart() {
    const colors = getThemeColors();
    const list = document.getElementById('weight-list');
    const weights = trendsData.weights;

    weightChartInstance = destroyChart(weightChartInstance);

    if (!weights || weights.length === 0) {
        list.innerHTML = '';
        return;
    }

    const ctx = document.getElementById('weight-chart').getContext('2d');

    const labels = weights.map(w => w.recorded_date);
    const data = weights.map(w => w.weight);

    weightChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '体重 (kg)',
                data: data,
                borderColor: colors.accent,
                backgroundColor: colors.accentBg,
                borderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6,
                pointBackgroundColor: colors.accent,
                pointBorderColor: colors.surface,
                pointBorderWidth: 2,
                fill: true,
                tension: 0.3,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...commonTooltipConfig(colors),
                    callbacks: {
                        title: function(items) { return items[0].label; },
                        label: function(item) { return ` ${item.parsed.y.toFixed(2)} kg`; }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: colors.text,
                        font: { family: "'JetBrains Mono', monospace", size: 9 },
                        maxRotation: 0,
                        callback: function(value) {
                            const label = this.getLabelForValue(value);
                            return label.slice(5);
                        }
                    },
                    border: { display: false },
                },
                y: {
                    ...commonScaleOptions(colors, 'kg'),
                    beginAtZero: false,
                    ticks: {
                        color: colors.text,
                        font: { family: "'JetBrains Mono', monospace", size: 10 },
                        callback: function(value) { return value.toFixed(2) + 'kg'; }
                    },
                }
            }
        }
    });

    // 体重列表
    list.innerHTML = weights.slice().reverse().slice(0, 5).map(w => `
        <div class="flex items-center justify-between py-1 text-xs group">
            <span class="text-text-muted font-mono">${esc(w.recorded_date)}</span>
            <div class="flex items-center gap-2">
                <span class="font-mono text-text-primary">${w.weight} kg</span>
                <button class="text-text-muted hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity"
                    data-edit-weight data-id="${w.id}" data-weight="${w.weight}" data-date="${esc(w.recorded_date)}" data-note="${esc(w.note || '')}">
                    <i data-lucide="pencil" class="w-3 h-3"></i>
                </button>
                <button class="text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    data-delete-weight data-id="${w.id}">
                    <i data-lucide="trash-2" class="w-3 h-3"></i>
                </button>
            </div>
        </div>
    `).join('');
    lucide.createIcons();
}

// 体重列表事件委托
document.addEventListener('click', function(e) {
    const editBtn = e.target.closest('[data-edit-weight]');
    if (editBtn) {
        editWeight(
            parseInt(editBtn.dataset.id),
            parseFloat(editBtn.dataset.weight),
            editBtn.dataset.date,
            editBtn.dataset.note
        );
        return;
    }
    const deleteBtn = e.target.closest('[data-delete-weight]');
    if (deleteBtn) {
        deleteWeight(parseInt(deleteBtn.dataset.id));
        return;
    }
});

// ── Feed Chart (Bar + Target Line) ─────────────────────
function renderFeedChart() {
    const colors = getThemeColors();
    const daily = trendsData.daily;

    feedChartInstance = destroyChart(feedChartInstance);

    if (!daily || daily.length === 0) return;
    if (!daily.some(d => d.feed_ml > 0)) return;

    const ctx = document.getElementById('feed-chart').getContext('2d');
    const targetMl = trendsData.target_ml || 500;

    const labels = daily.map(d => d.label);
    const data = daily.map(d => d.feed_ml);
    const todayStr = getLocalDate();
    const isToday = daily.map(d => d.date === todayStr);

    const barColors = isToday.map(t => t ? colors.accent : colors.accentBg);
    const barBorderColors = isToday.map(t => t ? colors.accent : colors.accent);

    // 目标线插件（仅日模式显示）
    const showTargetLine = trendsMode === 'day';
    const targetLinePlugin = {
        id: 'targetLine',
        afterDatasetsDraw(chart) {
            if (!showTargetLine) return;
            const { ctx: c, chartArea, scales } = chart;
            const y = scales.y.getPixelForValue(targetMl);
            if (y < chartArea.top || y > chartArea.bottom) return;
            c.save();
            c.beginPath();
            c.setLineDash([6, 4]);
            c.strokeStyle = colors.accent;
            c.globalAlpha = 0.5;
            c.lineWidth = 1.5;
            c.moveTo(chartArea.left, y);
            c.lineTo(chartArea.right, y);
            c.stroke();
            // 标签
            c.globalAlpha = 0.7;
            c.fillStyle = colors.accent;
            c.font = "9px 'JetBrains Mono', monospace";
            c.textAlign = 'right';
            c.fillText(`目标 ${targetMl}ml`, chartArea.right, y - 4);
            c.restore();
        }
    };

    feedChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '喂养量 (ml)',
                data: data,
                backgroundColor: barColors,
                borderColor: barBorderColors,
                borderWidth: 1,
                borderRadius: 4,
                borderSkipped: false,
            }]
        },
        plugins: [targetLinePlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...commonTooltipConfig(colors),
                    callbacks: {
                        title: function(items) { return items[0].label; },
                        label: function(item) {
                            const d = daily[item.dataIndex];
                            return [` ${d.feed_ml} ml`, ` ${d.feed_count} 次`];
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: colors.text,
                        font: { family: "'JetBrains Mono', monospace", size: 9 },
                        maxRotation: 0,
                        callback: getXAxisTickCallback(trendsMode)
                    },
                    border: { display: false },
                },
                y: {
                    ...commonScaleOptions(colors, ''),
                    beginAtZero: true,
                    ticks: {
                        ...commonScaleOptions(colors, '').ticks,
                        callback: function(value) { return value + ' ml'; }
                    }
                }
            }
        }
    });
}

// ── Food Chart (Stacked Bar by Unit) ───────────────────
function renderFoodChart() {
    const colors = getThemeColors();
    const daily = trendsData.daily;
    const foodByUnit = trendsData.food_by_unit || {};

    foodChartInstance = destroyChart(foodChartInstance);

    const legendEl = document.getElementById('food-legend');
    const hintEl = document.getElementById('food-unit-hint');
    const emptyEl = document.getElementById('food-empty');
    const canvas = document.getElementById('food-chart');

    // 检查是否有辅食数据
    const units = Object.keys(foodByUnit);
    const hasFood = units.length > 0 && daily && daily.length > 0;

    if (legendEl) legendEl.innerHTML = '';
    if (hintEl) hintEl.textContent = '';

    if (!hasFood) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        canvas.style.display = 'none';
        return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    canvas.style.display = '';

    // 单位颜色映射
    const unitColorMap = {
        'g':    { color: colors.accent, bg: colors.accentBg, label: '克 (g)' },
        '勺':   { color: colors.blue, bg: colors.blueBg, label: '勺' },
        '块':   { color: colors.amber, bg: colors.amberBg, label: '块' },
    };
    // 备用色板（用于自定义单位）
    const fallbackPalette = [
        { color: colors.purple, bg: colors.purpleBg },
        { color: colors.cyan, bg: colors.cyanBg },
        { color: colors.pink, bg: colors.pinkBg },
        { color: colors.red, bg: colors.redBg },
    ];
    let fallbackIdx = 0;
    units.forEach(u => {
        if (!unitColorMap[u]) {
            const p = fallbackPalette[fallbackIdx % fallbackPalette.length];
            unitColorMap[u] = { color: p.color, bg: p.bg, label: u };
            fallbackIdx++;
        }
    });

    // 构建 period -> {unit: total_amount} 映射
    // daily 的 label 是顺序的 period；foodByUnit 的每个 entry 有 period 字段
    const labels = daily.map(d => d.label);
    const periodToIndex = {};
    daily.forEach((d, i) => {
        // period 字段在 foodByUnit 数据里是 r['period']，与 label 一一对应
        // 对于 hour 模式 period 是整数 0-23，label 是 "08:00"
        // 对于 month 模式 period 是 "2026-07"，label 也是 "2026-07"
        // 对于 day 模式 period 是 "2026-07-23"，label 也是 "2026-07-23"
        periodToIndex[d.label] = i;
    });

    // 构建每个单位的数据集
    const datasets = units.map(unit => {
        const meta = unitColorMap[unit];
        const arrData = new Array(daily.length).fill(0);
        const records = foodByUnit[unit] || [];
        records.forEach(r => {
            // 在 hour 模式下，period 是整数，label 是 "08:00"
            let key = r['period'];
            if (trendsMode === 'hour') {
                key = String(r['period']).padStart(2, '0') + ':00';
            } else {
                key = String(r['period']);
            }
            const idx = periodToIndex[key];
            if (idx !== undefined) {
                arrData[idx] += r['total_amount'] || 0;
            }
        });
        return {
            label: meta.label,
            data: arrData,
            backgroundColor: meta.bg,
            borderColor: meta.color,
            borderWidth: 1,
            borderRadius: 3,
            borderSkipped: false,
        };
    });

    // 渲染图例
    if (legendEl) {
        legendEl.innerHTML = units.map(u => {
            const meta = unitColorMap[u];
            return `<span class="flex items-center gap-1">
                <span class="w-2 h-2 rounded-sm inline-block" style="background:${meta.color}"></span>${esc(meta.label)}
            </span>`;
        }).join('');
    }
    if (hintEl) {
        hintEl.textContent = '(' + units.map(u => unitColorMap[u].label).join('/') + ')';
    }

    const ctx = canvas.getContext('2d');
    foodChartInstance = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...commonTooltipConfig(colors),
                    callbacks: {
                        title: function(items) { return items[0].label; },
                        label: function(item) {
                            return ` ${item.dataset.label}: ${item.parsed.y}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: {
                        color: colors.text,
                        font: { family: "'JetBrains Mono', monospace", size: 9 },
                        maxRotation: 0,
                        callback: getXAxisTickCallback(trendsMode)
                    },
                    border: { display: false },
                },
                y: {
                    stacked: true,
                    ...commonScaleOptions(colors, ''),
                    beginAtZero: true,
                    ticks: {
                        ...commonScaleOptions(colors, '').ticks,
                        callback: function(value) { return value; }
                    }
                }
            }
        }
    });
}

// ── Hour Chart (Bar, 24h, by day) ──────────────────────
function renderHourChart() {
    const colors = getThemeColors();
    const byDay = trendsData.feed_hours_by_day;
    const allHours = trendsData.feed_hours;

    hourChartInstance = destroyChart(hourChartInstance);

    const picker = document.getElementById('hour-chart-day');
    const selectedDay = picker ? picker.value : '';

    let hours;
    if (!selectedDay || !byDay || byDay.length === 0) {
        hours = allHours;
    } else {
        hours = byDay.filter(h => h.date === selectedDay);
    }

    if (!hours || hours.length === 0) return;

    const ctx = document.getElementById('hour-chart').getContext('2d');
    const hourMap = {};
    hours.forEach(h => { hourMap[h.hour] = h.count; });

    const labels = [];
    const data = [];
    const bgColors = [];
    const borderColors = [];
    for (let h = 0; h <= 23; h++) {
        labels.push(`${h}:00`);
        const count = hourMap[h] || 0;
        data.push(count);
        if (count > 0) {
            bgColors.push(colors.blueBg);
            borderColors.push(colors.blue);
        } else {
            bgColors.push('rgba(128,128,128,0.1)');
            borderColors.push('rgba(128,128,128,0.15)');
        }
    }

    hourChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '喂养次数',
                data: data,
                backgroundColor: bgColors,
                borderColor: borderColors,
                borderWidth: 1,
                borderRadius: 2,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...commonTooltipConfig(colors),
                    callbacks: {
                        title: function(items) {
                            const h = items[0].dataIndex;
                            return `${h}:00 - ${(h + 1) % 24}:00`;
                        },
                        label: function(item) { return ` ${item.parsed.y} 次`; }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: colors.text,
                        font: { family: "'JetBrains Mono', monospace", size: 8 },
                        maxRotation: 0,
                        callback: function(value, index) {
                            if ([0, 6, 12, 18, 23].includes(index)) return value + '时';
                            return '';
                        }
                    },
                    border: { display: false },
                },
                y: {
                    ...commonScaleOptions(colors, ''),
                    beginAtZero: true,
                    ticks: {
                        ...commonScaleOptions(colors, '').ticks,
                        stepSize: 1,
                        callback: function(value) { return value + ' 次'; }
                    }
                }
            }
        }
    });
}

// ── Excrete Chart (Stacked Bar) ────────────────────────
function renderExcreteChart() {
    const colors = getThemeColors();
    const daily = trendsData.daily;

    excreteChartInstance = destroyChart(excreteChartInstance);

    if (!daily || daily.length === 0) return;
    if (!daily.some(d => d.urine_count > 0 || d.stool_count > 0)) return;

    const ctx = document.getElementById('excrete-chart').getContext('2d');
    const labels = daily.map(d => d.label);
    const urineData = daily.map(d => d.urine_count);
    const stoolData = daily.map(d => d.stool_count);

    excreteChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '排尿',
                    data: urineData,
                    backgroundColor: colors.amberBg,
                    borderColor: colors.amber,
                    borderWidth: 1,
                    borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 4, bottomRight: 4 },
                    borderSkipped: false,
                },
                {
                    label: '排便',
                    data: stoolData,
                    backgroundColor: colors.redBg,
                    borderColor: colors.red,
                    borderWidth: 1,
                    borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
                    borderSkipped: false,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...commonTooltipConfig(colors),
                    callbacks: {
                        title: function(items) { return items[0].label; },
                        label: function(item) {
                            if (item.datasetIndex === 0) return ` 尿 ${item.parsed.y} 次`;
                            return ` 便 ${item.parsed.y} 次`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: {
                        color: colors.text,
                        font: { family: "'JetBrains Mono', monospace", size: 9 },
                        maxRotation: 0,
                        callback: getXAxisTickCallback(trendsMode)
                    },
                    border: { display: false },
                },
                y: {
                    stacked: true,
                    ...commonScaleOptions(colors, ''),
                    beginAtZero: true,
                    ticks: {
                        ...commonScaleOptions(colors, '').ticks,
                        stepSize: 1,
                        callback: function(value) { return value + ' 次'; }
                    }
                }
            }
        }
    });
}

// ── Weight Modal ─────────────────────────────────────────
let _editingWeightId = null;

function showWeightModal() {
    _editingWeightId = null;
    const m = document.getElementById('weight-modal');
    if (!m) return;
    m.classList.remove('hidden');
    m.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
    document.getElementById('weight-modal-title').textContent = '记录体重';
    document.getElementById('weight-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('weight-value').value = '';
    document.getElementById('weight-note').value = '';
    document.getElementById('weight-value').focus();
}

function editWeight(id, weight, date, note) {
    _editingWeightId = id;
    const m = document.getElementById('weight-modal');
    if (!m) return;
    m.classList.remove('hidden');
    m.classList.add('flex');
    if (typeof fabClose === 'function') fabClose();
    document.getElementById('weight-modal-title').textContent = '编辑体重';
    document.getElementById('weight-date').value = date;
    document.getElementById('weight-value').value = weight;
    document.getElementById('weight-note').value = note;
    document.getElementById('weight-value').focus();
}

function closeWeightModal() {
    const m = document.getElementById('weight-modal');
    if (!m) return;
    m.classList.add('hidden');
    m.classList.remove('flex');
    _editingWeightId = null;
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
        if (_editingWeightId) {
            await api(`/api/weight-logs/${_editingWeightId}`, {
                method: 'PUT',
                body: JSON.stringify({ weight, recorded_date, note })
            });
            showToast('体重已更新');
        } else {
            await api('/api/weight-logs', {
                method: 'POST',
                body: JSON.stringify({ weight, recorded_date, note })
            });
            showToast('体重已记录');
        }
        closeWeightModal();
        loadTrends();
    } catch (e) {
        showToast(e.message);
    }
}

function clearHourDay() {
    const picker = document.getElementById('hour-chart-day');
    if (picker) {
        picker.value = '';
        updateHourDayDisplay();
        renderHourChart();
    }
}

async function deleteWeight(id) {
    if (!await showConfirm('确定删除此体重记录？', { confirmText: '删除', danger: true })) return;
    try {
        await api(`/api/weight-logs/${id}`, { method: 'DELETE' });
        showToast('已删除');
        loadTrends();
    } catch (e) {
        showToast(e.message);
    }
}
