// ── Trends Page (Chart.js) ───────────────────────────────
let trendsData = null;
let weightChartInstance = null;
let feedChartInstance = null;
let hourChartInstance = null;
let excreteChartInstance = null;
let _trendsObserver = null;

function initTrends() {
    const wd = document.getElementById('weight-date');
    if (wd) wd.value = new Date().toISOString().slice(0, 10);
    loadTrends();

    if (!_trendsObserver) {
        _trendsObserver = new MutationObserver(() => {
            if (trendsData) {
                renderWeightChart();
                renderFeedChart();
                renderHourChart();
                renderExcreteChart();
            }
        });
        _trendsObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });
    }
}

document.addEventListener('DOMContentLoaded', initTrends);

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
                        callback: function(value, index) {
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

    const labels = daily.map(d => d.date);
    const data = daily.map(d => d.feed_ml);
    const isToday = daily.map(d => d.date === getLocalDate());

    const barColors = isToday.map(t => t ? colors.accent : colors.accentBg);
    const barBorderColors = isToday.map(t => t ? colors.accent : colors.accent);

    // 目标线插件
    const targetLinePlugin = {
        id: 'targetLine',
        afterDatasetsDraw(chart) {
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
                        callback: function(value) {
                            return this.getLabelForValue(value).slice(8);
                        }
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

// ── Hour Chart (Bar, 24h) ──────────────────────────────
function renderHourChart() {
    const colors = getThemeColors();
    const hours = trendsData.feed_hours;

    hourChartInstance = destroyChart(hourChartInstance);

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
                            // 只显示 0, 6, 12, 18, 23
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
    const labels = daily.map(d => d.date);
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
                        callback: function(value) {
                            return this.getLabelForValue(value).slice(8);
                        }
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
