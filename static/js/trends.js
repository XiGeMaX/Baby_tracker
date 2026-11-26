// ── Trends Page ─────────────────────────────────────────
let trendsData = null;
let trendsMode = 'day';
let growthMode = 'both';
let growthChartInstance = null;
let feedChartInstance = null;
let hourChartInstance = null;
let excreteChartInstance = null;
let foodChartInstance = null;
let _trendsObserver = null;
let _trendsLoadSequence = 0;
let _editingGrowthID = null;
let _growthLogs = [];
let _growthLogLoadSequence = 0;
let _growthHistoryVisibleCount = 5;
let _growthTableExpanded = false;
let _trendPopoverTrigger = null;
let _trendPopoverTimer = null;
let _trendPopoverPositionFrame = 0;
let _trendCalendarCursor = null;

const GROWTH_MODE_STORAGE_KEY = 'baby-tracker-growth-mode';
const GROWTH_TABLE_STORAGE_KEY = 'baby-tracker-growth-table-open';
const GROWTH_HISTORY_PAGE_SIZE = 5;

function initTrends() {
    const page = document.getElementById('trends-page');
    if (!page) return;

    destroyTrendCharts();
    setDefaultDates();
    growthMode = readGrowthMode();
    updateModeUI();
    updateRangeDisplay();
    updateGrowthDaysDisplay();
    updateHourDayDisplay();
    updateGrowthModeUI();
    _growthTableExpanded = readGrowthTableOpen();
    updateGrowthTableToggle();
    setupThemeObserver();
    loadTrends();
    loadGrowthHistory();
}

document.addEventListener('DOMContentLoaded', initTrends);

function setDefaultDates() {
    const today = getLocalDate();
    const growthDate = document.getElementById('growth-date');
    if (growthDate) growthDate.value = today;
    updateGrowthDateDisplay();
    const hourDate = document.getElementById('hour-chart-day');
    if (hourDate) hourDate.value = today;
    const trendDate = document.getElementById('trend-date');
    if (trendDate) trendDate.value = today;
}

function destroyTrendCharts() {
    growthChartInstance = destroyChart(growthChartInstance);
    feedChartInstance = destroyChart(feedChartInstance);
    hourChartInstance = destroyChart(hourChartInstance);
    excreteChartInstance = destroyChart(excreteChartInstance);
    foodChartInstance = destroyChart(foodChartInstance);
}

// ── Period and range controls ────────────────────────────
function switchTrendMode(mode) {
    if (!['day', 'month', 'hour'].includes(mode) || mode === trendsMode) return;
    closeTrendPopover();
    trendsMode = mode;
    updateModeUI();
    updateRangeDisplay();
    loadTrends();
}

function updateModeUI() {
    const modeIndex = { day: 0, month: 1, hour: 2 }[trendsMode] || 0;
    const modeSegment = document.getElementById('trend-mode-segment');
    if (modeSegment) modeSegment.style.setProperty('--segment-index', modeIndex);

    document.querySelectorAll('[data-mode]').forEach(button => {
        const active = button.dataset.mode === trendsMode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });

    const daysSelect = document.getElementById('trend-days');
    const daysWrap = document.getElementById('trend-days-wrap');
    const dateWrap = document.getElementById('trend-date-wrap');
    if (daysSelect && daysWrap && dateWrap) {
        const usesDate = trendsMode === 'hour';
        daysWrap.classList.toggle('hidden', usesDate);
        dateWrap.classList.toggle('hidden', !usesDate);
        if (!usesDate) {
            if (trendsMode === 'month') {
                daysSelect.innerHTML = `
                    <option value="30">30天</option>
                    <option value="90" selected>90天</option>
                    <option value="180">半年</option>
                    <option value="365">1年</option>
                `;
                daysSelect.value = '90';
            } else {
                daysSelect.innerHTML = `
                    <option value="7">7天</option>
                    <option value="14" selected>14天</option>
                    <option value="30">30天</option>
                    <option value="60">60天</option>
                    <option value="90">90天</option>
                `;
                daysSelect.value = '14';
            }
        }
    }

    const hourCard = document.getElementById('hour-card');
    if (hourCard) hourCard.hidden = trendsMode !== 'day';

    const prefix = trendsMode === 'day' ? '每日' : trendsMode === 'month' ? '每月' : '每时';
    const feedTitle = document.getElementById('feed-chart-title');
    const excreteTitle = document.getElementById('excrete-chart-title');
    const foodTitle = document.getElementById('food-chart-title');
    if (feedTitle) feedTitle.textContent = `${prefix}喂养量`;
    if (excreteTitle) excreteTitle.textContent = `${prefix}排泄`;
    if (foodTitle) foodTitle.textContent = `${prefix}辅食`;
}

function updateRangeDisplay() {
    const display = document.getElementById('range-display');
    const dateDisplay = document.getElementById('trend-date-display');
    const periodCopy = document.getElementById('trends-period-copy');

    if (trendsMode === 'hour') {
        const dateInput = document.getElementById('trend-date');
        const value = dateInput ? dateInput.value : '';
        if (dateDisplay) dateDisplay.textContent = value ? formatShortDate(value) : '选择日期';
        if (periodCopy) periodCopy.textContent = value ? `${value} · 全天` : '按小时查看';
        return;
    }

    const daysSelect = document.getElementById('trend-days');
    const option = daysSelect?.options[daysSelect.selectedIndex];
    if (display) display.textContent = option?.text || '14天';
    if (periodCopy) periodCopy.textContent = `近 ${option?.text || '14天'}`;
}

function updateGrowthDaysDisplay() {
    const display = document.getElementById('growth-days-display');
    const select = document.getElementById('growth-days');
    if (display && select) {
        display.textContent = select.options[select.selectedIndex]?.text || '30天';
    }
}

function updateHourDayDisplay() {
    const display = document.getElementById('hour-day-display');
    const input = document.getElementById('hour-chart-day');
    if (!display || !input) return;
    if (!input.value) {
        display.textContent = '全部';
    } else if (input.value === getLocalDate()) {
        display.textContent = '今日';
    } else {
        display.textContent = formatShortDate(input.value);
    }
}

function onRangeChange() {
    updateRangeDisplay();
    loadTrends();
}

function onGrowthRangeChange() {
    updateGrowthDaysDisplay();
    loadTrends();
}

function onHourDayChange() {
    updateHourDayDisplay();
    if (trendsData) renderHourChart();
}

function clearHourDay() {
    const picker = document.getElementById('hour-chart-day');
    if (!picker) return;
    closeTrendPopover();
    picker.value = '';
    updateHourDayDisplay();
    if (trendsData) renderHourChart();
}

function openTrendDaysPicker(event) {
    openRangePopover(event.currentTarget, 'trend-days');
}

function openGrowthDaysPicker(event) {
    openRangePopover(event.currentTarget, 'growth-days');
}

function openTrendDatePicker(event) {
    openDatePopover(event.currentTarget, 'trend-date');
}

function openHourDayPicker(event) {
    openDatePopover(event.currentTarget, 'hour-chart-day');
}

function openGrowthDatePicker(event) {
    openDatePopover(event.currentTarget, 'growth-date');
}

function updateGrowthDateDisplay() {
    const input = document.getElementById('growth-date');
    const display = document.getElementById('growth-date-display');
    if (!input || !display) return;
    display.textContent = input.value ? formatShortDate(input.value) : '选择日期';
}

function openRangePopover(trigger, selectID) {
    const select = document.getElementById(selectID);
    const popover = document.getElementById('trend-popover');
    if (!select || !popover) return;
    const title = trigger.dataset.popoverTitle || '选择范围';
    const options = [...select.options].map(option => ({
        value: option.value,
        label: option.textContent.trim(),
        selected: option.value === select.value,
    }));
    const content = `
        <p class="trend-popover-title">${esc(title)}</p>
        <div class="trend-popover-options">
            ${options.map(option => `
                <button type="button" class="trend-popover-option ${option.selected ? 'is-selected' : ''}"
                    role="option" aria-selected="${String(option.selected)}"
                    data-range-value="${esc(option.value)}">
                    <span>${esc(option.label)}</span>
                </button>
            `).join('')}
        </div>
    `;

    showTrendPopover(trigger, content, 168, 'listbox', title);
    popover.onclick = event => {
        event.stopPropagation();
        const option = event.target.closest('[data-range-value]');
        if (!option) return;
        select.value = option.dataset.rangeValue;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        closeTrendPopover(true);
    };
    popover.onkeydown = event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const options = [...popover.querySelectorAll('[data-range-value]')];
        const current = options.indexOf(document.activeElement);
        let next = current;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = options.length - 1;
        if (event.key === 'ArrowDown') next = Math.min(options.length - 1, current + 1);
        if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
        options[next]?.focus({ preventScroll: true });
    };
    requestAnimationFrame(() => {
        const selected = popover.querySelector('.trend-popover-option.is-selected');
        (selected || popover.querySelector('.trend-popover-option'))?.focus({ preventScroll: true });
    });
}

function openDatePopover(trigger, inputID) {
    const input = document.getElementById(inputID);
    if (!input) return;
    _trendCalendarCursor = parseDateKey(input.value) || new Date();
    renderDatePopover(trigger, inputID, 'selected');
}

function renderDatePopover(trigger, inputID, focusTarget) {
    const popover = document.getElementById('trend-popover');
    const input = document.getElementById(inputID);
    if (!popover || !input) return;

    const selectedDate = parseDateKey(input.value);
    const todayDate = new Date();
    const cursor = _trendCalendarCursor || selectedDate || todayDate;
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    const offset = (firstDay.getDay() + 6) % 7;
    for (let index = 0; index < offset; index += 1) {
        cells.push('<span class="ui-calendar-blank" aria-hidden="true"></span>');
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(year, month, day);
        const key = toDateKey(date);
        const selected = selectedDate && toDateKey(selectedDate) === key;
        const isToday = toDateKey(todayDate) === key;
        cells.push(`
            <button type="button" class="ui-calendar-day ${selected ? 'is-selected' : ''} ${isToday ? 'is-today' : ''}"
                data-calendar-date="${key}" aria-label="${year}年${month + 1}月${day}日"
                aria-pressed="${String(Boolean(selected))}">${day}</button>
        `);
    }
    while (cells.length < 42) {
        cells.push('<span class="ui-calendar-blank" aria-hidden="true"></span>');
    }

    const title = trigger.dataset.popoverTitle || '选择日期';
    const content = `
        <div class="ui-calendar">
            <div class="ui-calendar-header">
                <button type="button" class="ui-calendar-nav" data-calendar-action="prev" aria-label="上个月">
                    <i data-lucide="chevron-left" class="h-4 w-4"></i>
                </button>
                <strong class="ui-calendar-title">${year}年${month + 1}月</strong>
                <button type="button" class="ui-calendar-nav" data-calendar-action="next" aria-label="下个月">
                    <i data-lucide="chevron-right" class="h-4 w-4"></i>
                </button>
            </div>
            <div class="ui-calendar-weekdays" aria-hidden="true">
                <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
            </div>
            <div class="ui-calendar-grid" role="group" aria-label="${year}年${month + 1}月">
                ${cells.join('')}
            </div>
            <div class="ui-calendar-footer">
                <button type="button" class="ui-calendar-action" data-calendar-action="today">今天</button>
                <button type="button" class="ui-calendar-action" data-calendar-action="cancel">取消</button>
            </div>
        </div>
    `;

    showTrendPopover(trigger, content, 320, 'dialog', title);
    popover.onclick = event => {
        event.stopPropagation();
        const action = event.target.closest('[data-calendar-action]')?.dataset.calendarAction;
        if (action === 'prev' || action === 'next') {
            _trendCalendarCursor = new Date(year, month + (action === 'next' ? 1 : -1), 1);
            renderDatePopover(trigger, inputID, action);
            return;
        }
        if (action === 'today') {
            commitCalendarDate(input, toDateKey(new Date()), trigger);
            return;
        }
        if (action === 'cancel') {
            closeTrendPopover(true);
            return;
        }
        const day = event.target.closest('[data-calendar-date]');
        if (day) commitCalendarDate(input, day.dataset.calendarDate, trigger);
    };
    popover.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        if (!event.target.matches('[data-calendar-date]')) return;
        event.preventDefault();
        const days = [...popover.querySelectorAll('[data-calendar-date]')];
        const current = days.indexOf(document.activeElement);
        const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        let next = current;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = days.length - 1;
        if (event.key in offsets) next = Math.min(days.length - 1, Math.max(0, current + offsets[event.key]));
        days[next]?.focus({ preventScroll: true });
    };
    requestAnimationFrame(() => {
        let target = null;
        if (focusTarget === 'prev' || focusTarget === 'next') {
            target = popover.querySelector(`[data-calendar-action="${focusTarget}"]`);
        } else {
            target = popover.querySelector('.ui-calendar-day.is-selected')
                || popover.querySelector('.ui-calendar-day.is-today')
                || popover.querySelector('[data-calendar-date]');
        }
        target?.focus({ preventScroll: true });
    });
}

function commitCalendarDate(input, value, trigger) {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    closeTrendPopover();
    trigger?.focus({ preventScroll: true });
}

function showTrendPopover(trigger, content, preferredWidth, role, label) {
    const popover = document.getElementById('trend-popover');
    if (!popover) return;
    clearTimeout(_trendPopoverTimer);
    closeTrendPopover();
    _trendPopoverTrigger = trigger;
    popover.className = 'trend-popover';
    popover.innerHTML = content;
    popover.setAttribute('role', role);
    popover.setAttribute('aria-label', label);
    popover.setAttribute('aria-hidden', 'false');
    trigger.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    lucide.createIcons();
    requestAnimationFrame(() => {
        positionTrendPopover(trigger, preferredWidth);
        popover.classList.add('is-open');
    });
}

function closeTrendPopover(restoreFocus = false) {
    const trigger = _trendPopoverTrigger;
    const popover = document.getElementById('trend-popover');
    if (!popover) return;
    clearTimeout(_trendPopoverTimer);
    if (_trendPopoverPositionFrame) {
        cancelAnimationFrame(_trendPopoverPositionFrame);
        _trendPopoverPositionFrame = 0;
    }
    if (trigger) {
        trigger.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
    }
    _trendPopoverTrigger = null;
    if (restoreFocus && trigger) trigger.focus({ preventScroll: true });
    if (popover.classList.contains('is-hidden')) return;
    popover.classList.remove('is-open');
    popover.setAttribute('aria-hidden', 'true');
    _trendPopoverTimer = setTimeout(() => {
        if (_trendPopoverTrigger) return;
        popover.classList.add('is-hidden');
        popover.innerHTML = '';
        popover.onclick = null;
        popover.onkeydown = null;
    }, prefersReducedMotion() ? 0 : 170);
}

function positionTrendPopover(trigger, preferredWidth) {
    const popover = document.getElementById('trend-popover');
    if (!popover) return;
    const margin = 8;
    const gap = 6;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportRight = viewportLeft + (viewport?.width || window.innerWidth);
    const viewportBottom = viewportTop + (viewport?.height || window.innerHeight);
    const triggerVisible = rect.right >= viewportLeft
        && rect.left <= viewportRight
        && rect.bottom >= viewportTop
        && rect.top <= viewportBottom;
    if (!triggerVisible) {
        closeTrendPopover();
        return;
    }
    const width = Math.min(preferredWidth, window.innerWidth - margin * 2);
    popover.style.width = `${width}px`;
    popover.style.left = '0px';
    popover.style.top = '0px';
    const height = popover.offsetHeight;
    let left = rect.right - width;
    left = Math.min(window.innerWidth - width - margin, Math.max(margin, left));
    let top = rect.bottom + gap;
    if (top + height > window.innerHeight - margin) {
        top = rect.top - height - gap;
    }
    top = Math.max(margin, top);
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
}

function scheduleTrendPopoverReposition() {
    if (!_trendPopoverTrigger || _trendPopoverPositionFrame) return;
    _trendPopoverPositionFrame = requestAnimationFrame(() => {
        _trendPopoverPositionFrame = 0;
        if (!_trendPopoverTrigger) return;
        const popover = document.getElementById('trend-popover');
        const width = Number.parseFloat(popover?.style.width) || 168;
        positionTrendPopover(_trendPopoverTrigger, width);
    });
}

function parseDateKey(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
}

function toDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

document.addEventListener('click', event => {
    if (!_trendPopoverTrigger) return;
    const popover = document.getElementById('trend-popover');
    if (popover?.contains(event.target) || _trendPopoverTrigger.contains(event.target)) return;
    closeTrendPopover();
});

document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !_trendPopoverTrigger) return;
    event.preventDefault();
    closeTrendPopover(true);
});

window.addEventListener('resize', scheduleTrendPopoverReposition);
window.addEventListener('scroll', scheduleTrendPopoverReposition, { capture: true, passive: true });

// ── Data loading ──────────────────────────────────────────
async function loadTrends() {
    const requestID = ++_trendsLoadSequence;
    const page = document.getElementById('trends-page');
    if (page) page.setAttribute('aria-busy', 'true');

    const growthDays = document.getElementById('growth-days')?.value || '30';
    let url = `/api/stats/trends?growth_days=${encodeURIComponent(growthDays)}&mode=${trendsMode}`;
    if (trendsMode === 'hour') {
        const date = document.getElementById('trend-date')?.value;
        if (date) url += `&date=${encodeURIComponent(date)}`;
    } else {
        const days = document.getElementById('trend-days')?.value || '14';
        url += `&days=${encodeURIComponent(days)}`;
    }

    try {
        const data = await api(url);
        if (requestID !== _trendsLoadSequence) return;
        trendsData = data;
        renderAllCharts();
    } catch (error) {
        if (requestID !== _trendsLoadSequence) return;
        console.error('加载趋势失败:', error);
        showToast(error.message || '加载趋势失败');
    } finally {
        if (requestID === _trendsLoadSequence && page) {
            page.removeAttribute('aria-busy');
        }
    }
}

async function loadGrowthHistory() {
    const requestID = ++_growthLogLoadSequence;
    try {
        const rows = await api('/api/growth-logs');
        if (requestID !== _growthLogLoadSequence) return;
        _growthLogs = sortGrowthRows(Array.isArray(rows) ? rows : []);
        renderGrowthTable(_growthLogs);
    } catch (error) {
        if (requestID !== _growthLogLoadSequence) return;
        console.error('加载成长记录失败:', error);
        showToast(error.message || '加载成长记录失败');
    }
}

function sortGrowthRows(rows) {
    return [...rows].sort((left, right) => {
        const dateOrder = String(right.recorded_date || '').localeCompare(String(left.recorded_date || ''));
        return dateOrder || Number(right.id || 0) - Number(left.id || 0);
    });
}

function renderAllCharts() {
    if (!trendsData) return;
    renderGrowthChart();
    renderFeedChart();
    renderFoodChart();
    renderExcreteChart();
    renderHourChart();
    lucide.createIcons();
}

function setupThemeObserver() {
    if (_trendsObserver) return;
    _trendsObserver = new MutationObserver(() => {
        if (trendsData) renderAllCharts();
    });
    _trendsObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
    });
}

// ── Theme and chart helpers ───────────────────────────────
function getThemeColors() {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    return {
        accent: light ? '#059669' : '#00e5a0',
        accentBg: light ? 'rgba(5,150,105,0.16)' : 'rgba(0,229,160,0.18)',
        height: light ? '#2563eb' : '#60a5fa',
        heightBg: light ? 'rgba(37,99,235,0.14)' : 'rgba(96,165,250,0.16)',
        blue: light ? '#2563eb' : '#60a5fa',
        blueBg: light ? 'rgba(37,99,235,0.38)' : 'rgba(96,165,250,0.38)',
        amber: light ? '#b45309' : '#fbbf24',
        amberBg: light ? 'rgba(180,83,9,0.36)' : 'rgba(251,191,36,0.36)',
        red: light ? '#dc2626' : '#f87171',
        redBg: light ? 'rgba(220,38,38,0.34)' : 'rgba(248,113,113,0.34)',
        green: light ? '#047857' : '#34d399',
        greenBg: light ? 'rgba(4,120,87,0.3)' : 'rgba(52,211,153,0.3)',
        cyan: light ? '#0891b2' : '#22d3ee',
        cyanBg: light ? 'rgba(8,145,178,0.32)' : 'rgba(34,211,238,0.32)',
        pink: light ? '#db2777' : '#f472b6',
        pinkBg: light ? 'rgba(219,39,119,0.32)' : 'rgba(244,114,182,0.32)',
        grid: light ? 'rgba(15,23,42,0.07)' : 'rgba(148,163,184,0.1)',
        text: light ? '#64748b' : '#94a3b8',
        surface: light ? '#ffffff' : '#111827',
        tooltipBg: light ? '#ffffff' : '#111827',
        tooltipBorder: light ? '#e2e8f0' : '#2a2b3d',
    };
}

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function chartAnimationOptions() {
    return prefersReducedMotion()
        ? { duration: 0 }
        : { duration: 440, easing: 'easeOutQuart' };
}

function commonTooltipConfig(colors) {
    return {
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        borderWidth: 1,
        titleColor: colors.text,
        bodyColor: colors.text,
        titleFont: { family: "'Noto Sans SC', system-ui, sans-serif", size: 11, weight: '600' },
        bodyFont: { family: "'JetBrains Mono', Consolas, monospace", size: 11 },
        padding: 9,
        cornerRadius: 7,
        displayColors: true,
        boxPadding: 4,
    };
}

function commonScaleOptions(colors) {
    return {
        grid: { color: colors.grid, drawTicks: false },
        ticks: {
            color: colors.text,
            padding: 7,
            font: { family: "'JetBrains Mono', Consolas, monospace", size: 9 },
        },
        border: { display: false },
    };
}

function destroyChart(instance) {
    if (instance) instance.destroy();
    return null;
}

function getXAxisTickCallback(mode) {
    if (mode === 'month') {
        return function (value) {
            const label = this.getLabelForValue(value);
            const parts = label.split('-');
            return parts.length >= 2 ? `${Number(parts[1])}月` : label;
        };
    }
    if (mode === 'hour') {
        return function (value) {
            return this.getLabelForValue(value).slice(0, 2);
        };
    }
    return function (value) {
        return this.getLabelForValue(value).slice(5);
    };
}

function setChartEmpty(canvas, empty, hasData) {
    if (canvas) canvas.style.display = hasData ? '' : 'none';
    if (empty) empty.classList.toggle('is-hidden', hasData);
}

function formatShortDate(value) {
    if (!value) return '--';
    const parts = String(value).slice(0, 10).split('-');
    if (parts.length !== 3) return String(value);
    return `${Number(parts[1])}月${Number(parts[2])}日`;
}

function formatMeasurement(value, digits) {
    return Number(value).toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

function formatCount(value, digits = 0) {
    return Number(value || 0).toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

// ── Growth curve ──────────────────────────────────────────
function readGrowthMode() {
    try {
        const stored = localStorage.getItem(GROWTH_MODE_STORAGE_KEY);
        return ['weight', 'height', 'both'].includes(stored) ? stored : 'both';
    } catch {
        return 'both';
    }
}

function growthMetricVisible(kind) {
    return growthMode === 'both' || growthMode === kind;
}

function toggleGrowthMetric(kind) {
    if (!['weight', 'height'].includes(kind)) return;
    const showWeight = kind === 'weight' ? !growthMetricVisible('weight') : growthMetricVisible('weight');
    const showHeight = kind === 'height' ? !growthMetricVisible('height') : growthMetricVisible('height');
    if (!showWeight && !showHeight) {
        showToast('至少显示一条成长曲线');
        return;
    }
    growthMode = showWeight && showHeight ? 'both' : showWeight ? 'weight' : 'height';
    try {
        localStorage.setItem(GROWTH_MODE_STORAGE_KEY, growthMode);
    } catch {}
    updateGrowthModeUI();
    syncGrowthChartMode(true);
}

function updateGrowthModeUI() {
    document.querySelectorAll('[data-growth-metric]').forEach(metric => {
        const kind = metric.dataset.growthMetric;
        const active = growthMetricVisible(kind);
        metric.classList.toggle('is-active', active);
        metric.setAttribute('aria-pressed', String(active));
    });
}

function getGrowthRows() {
    if (Array.isArray(trendsData?.growth)) return trendsData.growth;
    if (Array.isArray(trendsData?.weights)) return trendsData.weights;
    return [];
}

function buildGrowthSeries(rows) {
    const dates = new Map();
    for (const row of rows) {
        const date = String(row.recorded_date || '').slice(0, 10);
        if (!date) continue;
        const entry = dates.get(date) || { date, weight: null, height: null };
        const weight = optionalNumber(row.weight);
        const height = optionalNumber(row.height);
        if (weight !== null) entry.weight = weight;
        if (height !== null) entry.height = height;
        dates.set(date, entry);
    }
    return [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function optionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function latestGrowthValue(series, key) {
    for (let index = series.length - 1; index >= 0; index -= 1) {
        if (series[index][key] !== null) return series[index];
    }
    return null;
}

function growthChangeCopy(series, key, unit, digits) {
    const values = series.filter(item => item[key] !== null);
    if (values.length === 0) return '暂无记录';
    if (values.length === 1) return '首条记录';
    const delta = values[values.length - 1][key] - values[0][key];
    const sign = delta > 0 ? '+' : '';
    return `${sign}${formatMeasurement(delta, digits)} ${unit}`;
}

function renderGrowthChart() {
    const rows = getGrowthRows();
    const series = buildGrowthSeries(rows);
    const colors = getThemeColors();
    const canvas = document.getElementById('growth-chart');
    const empty = document.getElementById('growth-empty');
    const compact = window.matchMedia('(max-width: 560px)').matches;

    growthChartInstance = destroyChart(growthChartInstance);
    renderGrowthSummary(series);

    if (!canvas) return;
    const hasWeight = series.some(item => item.weight !== null);
    const hasHeight = series.some(item => item.height !== null);
    const hasData = hasWeight || hasHeight;
    setChartEmpty(canvas, empty, hasData);
    if (!hasData) return;

    const context = canvas.getContext('2d');
    const chartHeight = canvas.parentElement?.clientHeight || (compact ? 156 : 286);
    const weightGradient = context.createLinearGradient(0, 0, 0, chartHeight);
    weightGradient.addColorStop(0, colors.accentBg);
    weightGradient.addColorStop(1, 'rgba(0,0,0,0)');

    const labels = series.map(item => item.date);
    const weightData = series.map(item => item.weight);
    const heightData = series.map(item => item.height);
    const showWeight = growthMetricVisible('weight');
    const showHeight = growthMetricVisible('height');

    growthChartInstance = new Chart(context, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: '体重',
                    data: weightData,
                    yAxisID: 'y',
                    hidden: !showWeight || !hasWeight,
                    borderColor: colors.accent,
                    backgroundColor: weightGradient,
                    borderWidth: compact ? 2 : 2.25,
                    pointRadius: compact ? 2.25 : 3,
                    pointHoverRadius: 5,
                    pointBackgroundColor: colors.accent,
                    pointBorderColor: colors.surface,
                    pointBorderWidth: 2,
                    fill: true,
                    spanGaps: true,
                    tension: 0.32,
                    cubicInterpolationMode: 'monotone',
                },
                {
                    label: '身高',
                    data: heightData,
                    yAxisID: 'yHeight',
                    hidden: !showHeight || !hasHeight,
                    borderColor: colors.height,
                    backgroundColor: colors.heightBg,
                    borderWidth: compact ? 2 : 2.25,
                    pointRadius: compact ? 2.25 : 3,
                    pointHoverRadius: 5,
                    pointBackgroundColor: colors.height,
                    pointBorderColor: colors.surface,
                    pointBorderWidth: 2,
                    fill: false,
                    spanGaps: true,
                    tension: 0.32,
                    cubicInterpolationMode: 'monotone',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartAnimationOptions(),
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...commonTooltipConfig(colors),
                    callbacks: {
                        title: items => items.length ? formatShortDate(items[0].label) : '',
                        label: item => {
                            if (item.parsed.y === null) return '';
                            const digits = item.datasetIndex === 0 ? 2 : 1;
                            const unit = item.datasetIndex === 0 ? 'kg' : 'cm';
                            return ` ${item.dataset.label}: ${formatMeasurement(item.parsed.y, digits)} ${unit}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: colors.text,
                        autoSkip: true,
                        maxTicksLimit: compact ? 4 : 8,
                        maxRotation: 0,
                        font: { family: "'JetBrains Mono', Consolas, monospace", size: compact ? 8 : 9 },
                        callback: function (value) {
                            return this.getLabelForValue(value).slice(5);
                        },
                    },
                    border: { display: false },
                },
                y: {
                    ...commonScaleOptions(colors),
                    display: showWeight && hasWeight,
                    position: 'left',
                    beginAtZero: false,
                    grace: '10%',
                    ticks: {
                        color: colors.text,
                        padding: compact ? 5 : 8,
                        maxTicksLimit: compact ? 4 : 6,
                        font: { family: "'JetBrains Mono', Consolas, monospace", size: compact ? 8 : 9 },
                        callback: value => `${formatMeasurement(value, 1)} kg`,
                    },
                },
                yHeight: {
                    ...commonScaleOptions(colors),
                    display: showHeight && hasHeight,
                    position: 'right',
                    beginAtZero: false,
                    grace: '10%',
                    grid: {
                        color: colors.grid,
                        drawTicks: false,
                        drawOnChartArea: growthMode === 'height' || !hasWeight,
                    },
                    ticks: {
                        color: colors.text,
                        padding: compact ? 5 : 8,
                        maxTicksLimit: compact ? 4 : 6,
                        font: { family: "'JetBrains Mono', Consolas, monospace", size: compact ? 8 : 9 },
                        callback: value => `${formatMeasurement(value, 1)} cm`,
                    },
                },
            },
        },
    });
}

function syncGrowthChartMode(animate) {
    const chart = growthChartInstance;
    if (!chart) return;

    const hasWeight = chart.data.datasets[0].data.some(value => value !== null);
    const hasHeight = chart.data.datasets[1].data.some(value => value !== null);
    const showWeight = growthMetricVisible('weight');
    const showHeight = growthMetricVisible('height');

    chart.setDatasetVisibility(0, showWeight && hasWeight);
    chart.setDatasetVisibility(1, showHeight && hasHeight);
    chart.options.scales.y.display = showWeight && hasWeight;
    chart.options.scales.yHeight.display = showHeight && hasHeight;
    chart.options.scales.yHeight.grid.drawOnChartArea = growthMode === 'height' || !hasWeight;
    chart.options.animation = animate ? chartAnimationOptions() : { duration: 0 };
    chart.update();
}

function renderGrowthSummary(series) {
    const latestWeight = latestGrowthValue(series, 'weight');
    const latestHeight = latestGrowthValue(series, 'height');
    const weightValue = document.getElementById('latest-weight-value');
    const heightValue = document.getElementById('latest-height-value');
    const weightChange = document.getElementById('weight-change-value');
    const heightChange = document.getElementById('height-change-value');
    const latestCopy = document.getElementById('growth-latest-copy');

    if (weightValue) weightValue.textContent = latestWeight ? `${formatMeasurement(latestWeight.weight, 2)} kg` : '--';
    if (heightValue) heightValue.textContent = latestHeight ? `${formatMeasurement(latestHeight.height, 1)} cm` : '--';
    if (weightChange) weightChange.textContent = growthChangeCopy(series, 'weight', 'kg', 2);
    if (heightChange) heightChange.textContent = growthChangeCopy(series, 'height', 'cm', 1);

    if (latestCopy) {
        const latest = [...series].reverse().find(item => item.weight !== null || item.height !== null);
        latestCopy.textContent = latest ? `更新于 ${formatShortDate(latest.date)}` : '还没有成长记录';
    }
}

function renderGrowthTable(rows) {
    const body = document.getElementById('growth-table-body');
    const count = document.getElementById('growth-record-count');
    const toggle = document.getElementById('growth-table-toggle');
    const summary = document.getElementById('growth-history-summary');
    const more = document.getElementById('growth-history-more');
    const moreLabel = document.getElementById('growth-history-more-label');
    if (!body) return;

    _growthHistoryVisibleCount = Math.min(
        rows.length,
        Math.max(GROWTH_HISTORY_PAGE_SIZE, _growthHistoryVisibleCount),
    );
    const visibleRows = rows.slice(0, _growthHistoryVisibleCount);
    const hiddenCount = Math.max(0, rows.length - visibleRows.length);
    if (count) count.textContent = `${rows.length} 条`;
    if (toggle) toggle.disabled = rows.length === 0;
    if (summary) {
        summary.textContent = hiddenCount
            ? `显示最近 ${visibleRows.length} 条，共 ${rows.length} 条`
            : `已显示全部 ${rows.length} 条`;
    }
    if (more) {
        more.hidden = hiddenCount === 0;
        if (moreLabel) {
            const nextCount = Math.min(GROWTH_HISTORY_PAGE_SIZE, hiddenCount);
            moreLabel.textContent = hiddenCount <= GROWTH_HISTORY_PAGE_SIZE
                ? `显示更早 ${nextCount} 条`
                : `再显示 ${nextCount} 条`;
        }
    }
    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="5" class="growth-table-empty">暂无记录</td></tr>';
        lucide.createIcons();
        updateGrowthTableToggle();
        return;
    }

    body.innerHTML = visibleRows.map(row => {
        const weight = optionalNumber(row.weight);
        const height = optionalNumber(row.height);
        const note = String(row.note || '');
        return `
            <tr>
                <td>${esc(formatShortDate(row.recorded_date))}</td>
                <td>${weight === null ? '--' : `${formatMeasurement(weight, 2)} kg`}</td>
                <td>${height === null ? '--' : `${formatMeasurement(height, 1)} cm`}</td>
                <td><span class="growth-note" title="${esc(note)}">${esc(note || '--')}</span></td>
                <td>
                    <div class="growth-row-actions">
                        <button type="button" class="growth-row-button" title="编辑"
                            data-edit-growth data-id="${row.id}"
                            data-weight="${weight === null ? '' : weight}"
                            data-height="${height === null ? '' : height}"
                            data-date="${esc(row.recorded_date)}"
                            data-note="${esc(note)}">
                            <i data-lucide="pencil" class="h-3.5 w-3.5"></i>
                        </button>
                        <button type="button" class="growth-row-button is-danger" title="删除"
                            data-delete-growth data-id="${row.id}">
                            <i data-lucide="trash-2" class="h-3.5 w-3.5"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    const scroll = body.closest('.growth-table-scroll');
    if (scroll) scroll.scrollTop = 0;
    lucide.createIcons();
    updateGrowthTableToggle();
}

function showMoreGrowthHistory() {
    const scroll = document.querySelector('.growth-table-scroll');
    const previousScrollTop = scroll?.scrollTop || 0;
    _growthHistoryVisibleCount = Math.min(
        _growthLogs.length,
        _growthHistoryVisibleCount + GROWTH_HISTORY_PAGE_SIZE,
    );
    renderGrowthTable(_growthLogs);
    if (scroll) scroll.scrollTop = previousScrollTop;
    const more = document.getElementById('growth-history-more');
    if (more && !more.hidden) more.focus({ preventScroll: true });
}

function readGrowthTableOpen() {
    try {
        return localStorage.getItem(GROWTH_TABLE_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

function updateGrowthTableToggle() {
    const shell = document.getElementById('growth-table-shell');
    const toggle = document.getElementById('growth-table-toggle');
    const label = document.getElementById('growth-table-toggle-label');
    if (!shell || !toggle) return;

    const expanded = _growthTableExpanded && !toggle.disabled;
    shell.classList.toggle('is-open', expanded);
    shell.toggleAttribute('inert', !expanded);
    shell.setAttribute('aria-hidden', String(!expanded));
    toggle.classList.toggle('is-open', expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    if (label) label.textContent = expanded ? '收起' : '展开';
}

function toggleGrowthTable(force) {
    _growthTableExpanded = typeof force === 'boolean' ? force : !_growthTableExpanded;
    try {
        localStorage.setItem(GROWTH_TABLE_STORAGE_KEY, String(_growthTableExpanded));
    } catch {}
    updateGrowthTableToggle();
}

// ── Feeding chart ─────────────────────────────────────────
function renderFeedChart() {
    const daily = trendsData?.daily || [];
    const colors = getThemeColors();
    const canvas = document.getElementById('feed-chart');
    const empty = document.getElementById('feed-empty');
    const totalLabel = document.querySelector('#feed-total-stat strong');

    feedChartInstance = destroyChart(feedChartInstance);
    const hasData = daily.some(item => Number(item.feed_ml) > 0);
    setChartEmpty(canvas, empty, hasData);
    if (!hasData || !canvas) {
        if (totalLabel) totalLabel.textContent = '--';
        return;
    }

    const targetML = Number(trendsData.target_ml) || 500;
    const total = daily.reduce((sum, item) => sum + Number(item.feed_ml || 0), 0);
    if (totalLabel) totalLabel.textContent = `${formatCount(total)} ml`;

    const today = getLocalDate();
    const labels = daily.map(item => item.label);
    const values = daily.map(item => Number(item.feed_ml || 0));
    const barColors = daily.map(item => item.date === today ? colors.accent : colors.accentBg);
    const borderColors = daily.map(() => colors.accent);
    const showTargetLine = trendsMode === 'day';

    const targetLinePlugin = {
        id: 'targetLine',
        afterDatasetsDraw(chart) {
            if (!showTargetLine) return;
            const area = chart.chartArea;
            const y = chart.scales.y.getPixelForValue(targetML);
            if (y < area.top || y > area.bottom) return;
            const ctx = chart.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = colors.accent;
            ctx.globalAlpha = 0.45;
            ctx.lineWidth = 1;
            ctx.moveTo(area.left, y);
            ctx.lineTo(area.right, y);
            ctx.stroke();
            ctx.globalAlpha = 0.72;
            ctx.fillStyle = colors.accent;
            ctx.font = "9px 'JetBrains Mono', Consolas, monospace";
            ctx.textAlign = 'right';
            ctx.fillText(`目标 ${targetML} ml`, area.right, y - 4);
            ctx.restore();
        },
    };

    feedChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: '喂养量',
                data: values,
                backgroundColor: barColors,
                borderColor: borderColors,
                borderWidth: 1,
                borderRadius: 4,
                borderSkipped: false,
                maxBarThickness: 24,
                categoryPercentage: 0.72,
                barPercentage: 0.82,
            }],
        },
        plugins: [targetLinePlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartAnimationOptions(),
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...commonTooltipConfig(colors),
                    callbacks: {
                        title: items => items.length ? items[0].label : '',
                        label: item => {
                            const row = daily[item.dataIndex];
                            return [` ${formatCount(item.parsed.y)} ml`, ` ${formatCount(row.feed_count)} 次`];
                        },
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: colors.text,
                        autoSkip: true,
                        maxTicksLimit: trendsMode === 'hour' ? 8 : 7,
                        maxRotation: 0,
                        font: { family: "'JetBrains Mono', Consolas, monospace", size: 9 },
                        callback: getXAxisTickCallback(trendsMode),
                    },
                    border: { display: false },
                },
                y: {
                    ...commonScaleOptions(colors),
                    beginAtZero: true,
                    suggestedMax: showTargetLine ? Math.max(targetML, ...values) : undefined,
                    ticks: {
                        color: colors.text,
                        padding: 8,
                        maxTicksLimit: 6,
                        font: { family: "'JetBrains Mono', Consolas, monospace", size: 9 },
                        callback: value => `${formatCount(value)} ml`,
                    },
                },
            },
        },
    });
}

// ── Solid food chart ──────────────────────────────────────
function renderFoodChart() {
    const daily = trendsData?.daily || [];
    const foodByUnit = trendsData?.food_by_unit || {};
    const colors = getThemeColors();
    const canvas = document.getElementById('food-chart');
    const empty = document.getElementById('food-empty');
    const legend = document.getElementById('food-legend');
    const hint = document.getElementById('food-unit-hint');

    foodChartInstance = destroyChart(foodChartInstance);
    const units = Object.keys(foodByUnit).sort((a, b) => {
        const order = ['g', '勺', '块'];
        const aIndex = order.indexOf(a);
        const bIndex = order.indexOf(b);
        if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
    });
    const hasData = units.length > 0 && daily.length > 0;
    setChartEmpty(canvas, empty, hasData);
    if (legend) legend.innerHTML = '';

    if (!hasData || !canvas) {
        if (hint) hint.textContent = '按计量单位分组';
        return;
    }

    const colorMap = {
        g: { color: colors.accent, bg: colors.accentBg, label: '克 (g)' },
        勺: { color: colors.blue, bg: colors.blueBg, label: '勺' },
        块: { color: colors.amber, bg: colors.amberBg, label: '块' },
    };
    const fallback = [
        { color: colors.green, bg: colors.greenBg },
        { color: colors.cyan, bg: colors.cyanBg },
        { color: colors.pink, bg: colors.pinkBg },
        { color: colors.red, bg: colors.redBg },
    ];
    units.forEach((unit, index) => {
        if (!colorMap[unit]) {
            const palette = fallback[index % fallback.length];
            colorMap[unit] = { color: palette.color, bg: palette.bg, label: unit };
        }
    });

    const labels = daily.map(item => item.label);
    const periodToIndex = new Map(daily.map((item, index) => [String(item.label), index]));
    const datasets = units.map(unit => {
        const values = new Array(daily.length).fill(0);
        for (const row of foodByUnit[unit] || []) {
            const key = trendsMode === 'hour'
                ? `${String(row.period).padStart(2, '0')}:00`
                : String(row.period);
            const index = periodToIndex.get(key);
            if (index !== undefined) values[index] += Number(row.total_amount || 0);
        }
        const meta = colorMap[unit];
        return {
            label: meta.label,
            data: values,
            backgroundColor: meta.bg,
            borderColor: meta.color,
            borderWidth: 1,
            borderRadius: 3,
            borderSkipped: false,
            maxBarThickness: 18,
        };
    });

    if (legend) {
        legend.innerHTML = units.map(unit => {
            const meta = colorMap[unit];
            return `<span><span class="growth-dot" style="background:${meta.color}"></span>${esc(meta.label)}</span>`;
        }).join('');
    }
    if (hint) hint.textContent = units.map(unit => colorMap[unit].label).join(' / ');

    foodChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartAnimationOptions(),
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...commonTooltipConfig(colors),
                    callbacks: {
                        title: items => items.length ? items[0].label : '',
                        label: item => ` ${item.dataset.label}: ${formatCount(item.parsed.y, 1)}`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: colors.text,
                        autoSkip: true,
                        maxTicksLimit: 6,
                        maxRotation: 0,
                        font: { family: "'JetBrains Mono', Consolas, monospace", size: 9 },
                        callback: getXAxisTickCallback(trendsMode),
                    },
                    border: { display: false },
                },
                y: {
                    ...commonScaleOptions(colors),
                    beginAtZero: true,
                    ticks: {
                        color: colors.text,
                        padding: 8,
                        maxTicksLimit: 5,
                        font: { family: "'JetBrains Mono', Consolas, monospace", size: 9 },
                    },
                },
            },
        },
    });
}

// ── Excrete chart ─────────────────────────────────────────
function renderExcreteChart() {
    const daily = trendsData?.daily || [];
    const colors = getThemeColors();
    const canvas = document.getElementById('excrete-chart');
    const empty = document.getElementById('excrete-empty');

    excreteChartInstance = destroyChart(excreteChartInstance);
    const hasData = daily.some(item => Number(item.urine_count) > 0 || Number(item.stool_count) > 0);
    setChartEmpty(canvas, empty, hasData);
    if (!hasData || !canvas) return;

    excreteChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: daily.map(item => item.label),
            datasets: [
                {
                    label: '排尿',
                    data: daily.map(item => Number(item.urine_count || 0)),
                    backgroundColor: colors.amberBg,
                    borderColor: colors.amber,
                    borderWidth: 1,
                    borderSkipped: false,
                    maxBarThickness: 20,
                },
                {
                    label: '排便',
                    data: daily.map(item => Number(item.stool_count || 0)),
                    backgroundColor: colors.redBg,
                    borderColor: colors.red,
                    borderWidth: 1,
                    borderSkipped: false,
                    maxBarThickness: 20,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartAnimationOptions(),
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...commonTooltipConfig(colors),
                    callbacks: {
                        title: items => items.length ? items[0].label : '',
                        label: item => ` ${item.dataset.label}: ${formatCount(item.parsed.y)} 次`,
                    },
                },
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: {
                        color: colors.text,
                        autoSkip: true,
                        maxTicksLimit: 6,
                        maxRotation: 0,
                        font: { family: "'JetBrains Mono', Consolas, monospace", size: 9 },
                        callback: getXAxisTickCallback(trendsMode),
                    },
                    border: { display: false },
                },
                y: {
                    ...commonScaleOptions(colors),
                    stacked: true,
                    beginAtZero: true,
                    ticks: {
                        color: colors.text,
                        padding: 8,
                        stepSize: 1,
                        precision: 0,
                        maxTicksLimit: 5,
                        font: { family: "'JetBrains Mono', Consolas, monospace", size: 9 },
                        callback: value => `${formatCount(value)} 次`,
                    },
                },
            },
        },
    });
}

// ── Feeding hour chart ────────────────────────────────────
function renderHourChart() {
    if (trendsMode !== 'day') return;
    const colors = getThemeColors();
    const canvas = document.getElementById('hour-chart');
    const empty = document.getElementById('hour-empty');
    const selectedDay = document.getElementById('hour-chart-day')?.value || '';
    const byDay = trendsData?.feed_hours_by_day || [];
    const allHours = trendsData?.feed_hours || [];
    const hours = selectedDay ? byDay.filter(item => item.date === selectedDay) : allHours;

    hourChartInstance = destroyChart(hourChartInstance);
    const total = hours.reduce((sum, item) => sum + Number(item.count || 0), 0);
    setChartEmpty(canvas, empty, total > 0);
    if (total === 0 || !canvas) return;

    const counts = new Map(hours.map(item => [Number(item.hour), Number(item.count || 0)]));
    const labels = [];
    const values = [];
    const backgrounds = [];
    const borders = [];
    for (let hour = 0; hour < 24; hour += 1) {
        const value = counts.get(hour) || 0;
        labels.push(`${String(hour).padStart(2, '0')}:00`);
        values.push(value);
        backgrounds.push(value > 0 ? colors.blueBg : 'rgba(128,128,128,0.08)');
        borders.push(value > 0 ? colors.blue : 'rgba(128,128,128,0.12)');
    }

    hourChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: '喂养次数',
                data: values,
                backgroundColor: backgrounds,
                borderColor: borders,
                borderWidth: 1,
                borderRadius: 3,
                borderSkipped: false,
                maxBarThickness: 14,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartAnimationOptions(),
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...commonTooltipConfig(colors),
                    callbacks: {
                        title: items => {
                            const hour = items[0]?.dataIndex ?? 0;
                            return `${hour}:00 - ${(hour + 1) % 24}:00`;
                        },
                        label: item => ` ${formatCount(item.parsed.y)} 次`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: colors.text,
                        maxRotation: 0,
                        font: { family: "'JetBrains Mono', Consolas, monospace", size: 8 },
                        callback: function (value, index) {
                            return index % 3 === 0 ? `${value}时` : '';
                        },
                    },
                    border: { display: false },
                },
                y: {
                    ...commonScaleOptions(colors),
                    beginAtZero: true,
                    ticks: {
                        color: colors.text,
                        padding: 8,
                        stepSize: 1,
                        precision: 0,
                        maxTicksLimit: 5,
                        font: { family: "'JetBrains Mono', Consolas, monospace", size: 9 },
                        callback: value => `${formatCount(value)} 次`,
                    },
                },
            },
        },
    });
}

// ── Growth modal and records ──────────────────────────────
function showGrowthModal() {
    _editingGrowthID = null;
    setGrowthFieldValues({ date: getLocalDate() });
    document.getElementById('growth-modal-title').textContent = '添加记录';
    openGrowthModal('growth-weight');
}

function editGrowthLog(id, weight, height, date, note) {
    _editingGrowthID = id;
    setGrowthFieldValues({ weight, height, date, note });
    document.getElementById('growth-modal-title').textContent = '编辑记录';
    openGrowthModal(height !== null && weight === null ? 'growth-height' : 'growth-weight');
}

function setGrowthFieldValues({ weight = '', height = '', date = '', note = '' }) {
    const mapping = {
        'growth-weight': weight,
        'growth-height': height,
        'growth-date': date,
        'growth-note': note,
    };
    for (const [id, value] of Object.entries(mapping)) {
        const input = document.getElementById(id);
        if (!input) continue;
        input.value = value ?? '';
        input.removeAttribute('aria-invalid');
    }
    updateGrowthDateDisplay();
}

function openGrowthModal(focusID) {
    const modal = document.getElementById('growth-modal');
    if (!modal) return;
    openAppModal(modal, {
        focusSelector: `#${focusID}`,
        onDismiss: closeGrowthModal,
    });
}

function closeGrowthModal() {
    const modal = document.getElementById('growth-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    closeTrendPopover();
    closeAppModal(modal);
    _editingGrowthID = null;
}

async function saveGrowthLog(event) {
    event.preventDefault();
    const weightInput = document.getElementById('growth-weight');
    const heightInput = document.getElementById('growth-height');
    const dateInput = document.getElementById('growth-date');
    const noteInput = document.getElementById('growth-note');
    const saveButton = document.getElementById('growth-save-button');

    const weight = parseGrowthInput(weightInput, 0.1, 100, '体重需在 0.1-100 kg 之间');
    const height = parseGrowthInput(heightInput, 10, 250, '身高需在 10-250 cm 之间');
    if (weight === undefined || height === undefined) return;
    if (weight === null && height === null) {
        showToast('请至少填写体重或身高');
        weightInput.focus();
        return;
    }
    const recordedDate = dateInput.value;
    if (!recordedDate) {
        dateInput.setAttribute('aria-invalid', 'true');
        document.getElementById('growth-date-trigger')?.focus();
        showToast('请选择日期');
        return;
    }
    dateInput.removeAttribute('aria-invalid');

    const payload = {
        weight,
        height,
        recorded_date: recordedDate,
        note: noteInput.value.trim(),
    };
    const editing = Boolean(_editingGrowthID);
    const originalLabel = saveButton.textContent;
    saveButton.disabled = true;
    saveButton.textContent = '保存中…';

    try {
        await api(editing ? `/api/growth-logs/${_editingGrowthID}` : '/api/growth-logs', {
            method: editing ? 'PUT' : 'POST',
            body: JSON.stringify(payload),
        });
        closeGrowthModal();
        showToast(editing ? '成长记录已更新' : '成长记录已添加');
        await Promise.all([loadTrends(), loadGrowthHistory()]);
    } catch (error) {
        showToast(error.message || '保存成长记录失败');
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = originalLabel;
    }
}

function parseGrowthInput(input, min, max, message) {
    const raw = input.value.trim();
    if (!raw) {
        input.removeAttribute('aria-invalid');
        return null;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        showToast(message);
        return undefined;
    }
    input.removeAttribute('aria-invalid');
    return value;
}

async function deleteGrowthLog(id) {
    if (!await showConfirm('确定删除这条成长记录？', { confirmText: '删除', danger: true })) return;
    try {
        await api(`/api/growth-logs/${id}`, { method: 'DELETE' });
        showToast('成长记录已删除');
        await Promise.all([loadTrends(), loadGrowthHistory()]);
    } catch (error) {
        showToast(error.message || '删除成长记录失败');
    }
}

document.addEventListener('click', event => {
    const closeControl = event.target.closest('[data-close-growth-modal]');
    if (closeControl) {
        closeGrowthModal();
        return;
    }
    const editButton = event.target.closest('[data-edit-growth]');
    if (editButton) {
        editGrowthLog(
            Number(editButton.dataset.id),
            editButton.dataset.weight === '' ? null : Number(editButton.dataset.weight),
            editButton.dataset.height === '' ? null : Number(editButton.dataset.height),
            editButton.dataset.date,
            editButton.dataset.note,
        );
        return;
    }
    const deleteButton = event.target.closest('[data-delete-growth]');
    if (deleteButton) {
        deleteGrowthLog(Number(deleteButton.dataset.id));
    }
});
