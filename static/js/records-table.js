// ── 记录列表表格视图（总览最近记录 / 成长日程共用） ─────────
// 设计：一条记录一行；列按 sub_type 展开，只显示本次数据里实际出现过的列；
// 展示方式由系统设置 record_view_mode 决定（table/card），页面可临时切换（不写库）。
(function () {
    'use strict';
    if (window.__recordsTableLoaded) return;
    window.__recordsTableLoaded = true;

    // 列定义：key 为 sub_type，label 为表头；未列出的 sub_type 会动态追加为「其他」列。
    // 顺序即默认列顺序；同一 type 下的多个 sub_type 各自独立成列。
    const COLUMNS = [
        { key: 'breast_left',  label: '母乳(左)' },
        { key: 'breast_right', label: '母乳(右)' },
        { key: 'formula',      label: '配方奶' },
        { key: 'water',        label: '喂水' },
        { key: 'solid_food',   label: '辅食' },
        { key: 'urine',        label: '尿' },
        { key: 'stool',        label: '便' },
        { key: 'both',         label: '尿+便' },
        { key: 'vomit',        label: '吐奶' },
        { key: 'fever',        label: '发热' },
        { key: 'jaundice',     label: '黄疸' },
        { key: 'rash',         label: '皮疹' },
        { key: 'vitamin_d',    label: '维D' },
        { key: 'vitamin_ad',   label: '维AD' },
        { key: 'iron',         label: '铁剂' },
        { key: 'calcium',      label: '钙剂' },
        { key: 'dha',          label: 'DHA' },
        { key: 'probiotics',   label: '益生菌' },
    ];
    const LABEL_OF = Object.fromEntries(COLUMNS.map(c => [c.key, c.label]));

    // 单元格里显示的值：有量就带单位，无量就打 ✓，其它补充字段（体温/备注等）追加说明
    function cellValue(r) {
        const parts = [];
        if (r.amount !== null && r.amount !== undefined && r.amount !== '') {
            const unit = (r.sub_type === 'solid_food' && r.food_unit) ? r.food_unit : 'ml';
            parts.push(`${r.amount}${unit}`);
        }
        if (r.duration) parts.push(`${r.duration}分`);
        if (r.temperature) parts.push(`${r.temperature}°C`);
        if (r.color) parts.push(String(r.color));
        if (r.consistency) parts.push(String(r.consistency));
        if (r.note) parts.push(String(r.note));
        return parts.length ? parts.join(' · ') : '✓';
    }

    // 从记录集合里挑出实际出现过的列（并按 COLUMNS 顺序排列）；
    // 未在 COLUMNS 中定义的自定义 sub_type 也动态成列，避免数据丢失。
    function pickColumns(records) {
        const present = new Set((records || []).map(r => r.sub_type).filter(Boolean));
        const cols = [];
        COLUMNS.forEach(c => { if (present.has(c.key)) cols.push({ key: c.key, label: c.label }); });
        present.forEach(key => {
            if (!LABEL_OF[key]) cols.push({ key: key, label: String(key) });
        });
        return cols;
    }

    // 统计行取值：有数值的列求和（带单位；单位不一致时退化为计数），
    // 纯标记列（尿/便/症状/补充剂）统计出现次数。
    function columnStat(records, colKey) {
        const rows = (records || []).filter(r => r.sub_type === colKey);
        if (!rows.length) return '';
        let sum = 0, hasAmount = false;
        const units = new Set();
        rows.forEach(r => {
            const a = (r.amount === null || r.amount === undefined || r.amount === '') ? NaN : parseFloat(r.amount);
            if (!isNaN(a)) {
                sum += a;
                hasAmount = true;
                units.add(colKey === 'solid_food' ? (r.food_unit || 'ml') : 'ml');
            }
        });
        if (!hasAmount || units.size !== 1) return `${rows.length}次`;
        return `${Math.round(sum * 100) / 100}${[...units][0]}`;
    }

    // 渲染表格 HTML。opts: { onEdit(id), onDelete(id), showActions }
    function renderTable(records, opts) {
        opts = opts || {};
        const cols = pickColumns(records);
        const showActions = opts.showActions !== false && typeof opts.onEdit === 'function';
        const head = ['时间'].concat(cols.map(c => c.label));
        if (showActions) head.push('操作');

        const headHtml = head.map(h =>
            `<th class="text-left font-medium text-text-muted text-[11px] px-2 py-2 whitespace-nowrap border-b border-border">${esc(h)}</th>`
        ).join('');

        const rowsHtml = (records || []).map(r => {
            const cells = cols.map(c => {
                const v = (r.sub_type === c.key) ? cellValue(r) : '';
                return `<td class="px-2 py-2 text-xs text-text-primary border-b border-border/60 whitespace-nowrap">${v ? esc(v) : ''}</td>`;
            }).join('');
            const actions = showActions ? `
                <td class="px-2 py-2 border-b border-border/60 whitespace-nowrap">
                    <button class="text-text-muted hover:text-amber-400 transition-colors p-1" data-rec-action="edit" data-rec-id="${r.id}" title="编辑">
                        <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
                    </button>
                    <button class="text-text-muted hover:text-red-400 transition-colors p-1" data-rec-action="delete" data-rec-id="${r.id}" title="删除">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </td>` : '';
            return `<tr data-rec-row="${r.id}">
                <td class="px-2 py-2 font-mono text-xs text-text-muted border-b border-border/60 whitespace-nowrap">${esc(formatTime(r.timestamp))}</td>
                ${cells}${actions}
            </tr>`;
        }).join('');

        // 底部统计行：首列「合计」，各列按 columnStat 汇总（空数据时不渲染）
        const hasRows = (records || []).length > 0;
        const footHtml = hasRows ? `<tr>
            <td class="px-2 py-2 text-[11px] font-medium text-text-muted border-t border-border whitespace-nowrap">合计</td>
            ${cols.map(c => `<td class="px-2 py-2 text-xs font-medium text-text-primary border-t border-border whitespace-nowrap">${esc(columnStat(records, c.key))}</td>`).join('')}
            ${showActions ? '<td class="border-t border-border"></td>' : ''}
        </tr>` : '';

        return `
        <div class="card p-0 overflow-x-auto">
            <table class="w-full border-collapse rec-table">
                <thead><tr>${headHtml}</tr></thead>
                <tbody>${rowsHtml || `<tr><td colspan="${head.length}" class="text-center text-text-muted text-sm py-8">暂无记录</td></tr>`}</tbody>
                ${footHtml ? `<tfoot>${footHtml}</tfoot>` : ''}
            </table>
        </div>`;
    }

    // 给表格容器绑定编辑/删除事件委托（只绑一次）
    function bindTableActions(container, opts) {
        if (!container || container.dataset.recTableBound) return;
        container.dataset.recTableBound = 'true';
        container.addEventListener('click', e => {
            const btn = e.target.closest('[data-rec-action]');
            if (!btn) return;
            const id = parseInt(btn.dataset.recId, 10);
            if (btn.dataset.recAction === 'edit' && typeof opts.onEdit === 'function') opts.onEdit(id);
            if (btn.dataset.recAction === 'delete' && typeof opts.onDelete === 'function') opts.onDelete(id);
        });
    }

    // ── 展示方式 ────────────────────────────────────────────
    // 系统设置（默认 table），页面内临时切换用 sessionStorage（不写库）
    const DEFAULT_MODE = 'table';
    const SESSION_KEY = 'record_view_mode_override';

    async function getViewMode() {
        const override = sessionStorage.getItem(SESSION_KEY);
        if (override === 'table' || override === 'card') return override;
        try {
            const settings = await api('/api/settings');
            const v = settings && settings.record_view_mode;
            return (v === 'table' || v === 'card') ? v : DEFAULT_MODE;
        } catch (e) {
            return DEFAULT_MODE;
        }
    }

    function setViewModeOverride(mode) {
        if (mode === 'table' || mode === 'card') sessionStorage.setItem(SESSION_KEY, mode);
        else sessionStorage.removeItem(SESSION_KEY);
    }

    function getViewModeOverride() {
        const v = sessionStorage.getItem(SESSION_KEY);
        return (v === 'table' || v === 'card') ? v : null;
    }

    // 渲染「表格 / 卡片」切换控件的 HTML。
    // 事件绑定与高亮更新由宿主容器负责：bindViewToggle(el, onChange) + 点击后自动高亮。
    function renderViewToggle(currentMode) {
        const btn = (mode, label) =>
            `<button type="button" data-view-mode="${mode}" class="text-[11px] px-2 py-1 rounded border whitespace-nowrap ${currentMode === mode ? 'border-accent/40 text-accent bg-accent/10' : 'border-border text-text-muted'}">${label}</button>`;
        return `<span data-view-toggle="1" class="inline-flex items-center gap-1">${btn('table', '表格')}${btn('card', '卡片')}</span>`;
    }

    // 就地更新切换控件的高亮（切换展示方式后调用，避免重新渲染导致状态滞后）
    function updateViewToggle(container, mode) {
        if (!container || !container.querySelector) return;
        const wrap = container.querySelector('[data-view-toggle]');
        if (!wrap) return;
        wrap.querySelectorAll('[data-view-mode]').forEach(b => {
            const active = b.dataset.viewMode === mode;
            b.classList.toggle('border-accent/40', active);
            b.classList.toggle('text-accent', active);
            b.classList.toggle('bg-accent/10', active);
            b.classList.toggle('border-border', !active);
            b.classList.toggle('text-text-muted', !active);
        });
    }

    // 给切换控件的宿主容器绑定一次性点击事件委托（容器内 HTML 可随 innerHTML 重建，委托仍有效）
    function bindViewToggle(container, onChange) {
        if (!container || container.dataset.viewToggleBound) return;
        container.dataset.viewToggleBound = 'true';
        container.addEventListener('click', ev => {
            const b = ev.target.closest('[data-view-mode]');
            if (!b) return;
            const mode = b.dataset.viewMode;
            if (mode !== 'table' && mode !== 'card') return;
            setViewModeOverride(mode);
            updateViewToggle(container, mode);
            if (typeof onChange === 'function') onChange(mode);
        });
    }

    window.RecordsTable = {
        COLUMNS, cellValue, pickColumns, columnStat, renderTable, bindTableActions,
        getViewMode, setViewModeOverride, getViewModeOverride,
        renderViewToggle, updateViewToggle, bindViewToggle,
        DEFAULT_MODE,
    };
})();
