// ── Batch Entry (拍照识别 / 批量录入) ──────────────────────
// 弹窗动态挂到 document.body（在 #spa-content 之外），因此 SPA 切页不会销毁它。
// 全局入口：openBatchModal() / closeBatchModal()。
// IIFE + 装载守卫：SPA 的 _loadScript 可能重复加载本文件；守卫可避免顶层 let
// 重复声明报错，并保留已有弹窗 DOM 与状态（batchRows / batchDate 不会被重置）。
(function () {
'use strict';
if (window.__batchModalLoaded) return;
window.__batchModalLoaded = true;

let batchRows = [];
let batchDate = getLocalDate();
let batchBusy = false;
let batchRecognizing = false;
let batchAbort = null;          // 当前识别请求的 AbortController
let _batchModal = null;
let _batchStatusTimer = null;   // 识别中「已等待 N 秒」计时器
let _batchStatusStart = 0;

// 这些字段的变更需要重建行 DOM（联动选项 / 显隐），其余字段只写回模型。
const _BATCH_STRUCTURAL = new Set(['_selected', 'type', 'sub_type', 'food_unit']);

// ── 时间戳工具 ────────────────────────────────────────────
function _batchNowTimestamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
           `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 统一成 DB 使用的 'YYYY-MM-DD HH:MM:SS'
function _batchNormTimestamp(ts) {
    if (!ts || typeof ts !== 'string') return '';
    const s = ts.trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return s + ':00';
    return '';
}

function _batchValidTimestamp(ts) {
    return _batchNormTimestamp(ts) !== '';
}

// ── 行数据归一化（AI 返回 / 手动新增都走这里） ──────────────
function _batchNormalizeRow(raw) {
    const r = raw || {};
    const valid = r.valid !== false;
    const confidence = (typeof r.confidence === 'number' && !isNaN(r.confidence))
        ? Math.min(1, Math.max(0, r.confidence)) : 1;
    const fu = r.food_unit || '';
    // type 为空（如 AI 无法判定类型）时保留空值，让下拉显示「请选择」，
    // 避免兜底成 'feed' 造成「下拉显示喂养却提示无法识别类型」的矛盾状态。
    return {
        type: r.type || '',
        sub_type: r.sub_type || '',
        amount: (r.amount === null || r.amount === undefined) ? '' : r.amount,
        duration: (r.duration === null || r.duration === undefined) ? '' : r.duration,
        color: r.color || '',
        consistency: r.consistency || '',
        temperature: (r.temperature === null || r.temperature === undefined) ? '' : r.temperature,
        note: r.note || '',
        timestamp: _batchNormTimestamp(r.timestamp) || _batchNowTimestamp(),
        food_unit: fu,
        confidence: confidence,
        warnings: Array.isArray(r.warnings) ? r.warnings.slice() : [],
        raw_text: r.raw_text || '',
        date_recognized: !!r.date_recognized,   // 该行日期来自图片而非弹窗所选日期
        raw_date: r.raw_date || '',             // 图片里的日期原文
        valid: valid,
        errors: Array.isArray(r.errors) ? r.errors.slice() : [],
        _selected: valid,                       // valid===false 默认不选
        _wasInvalid: !valid,                    // 记录初始无效态，供修正后自动勾选
        _more: false,
        _customSub: false,
        _customSubText: '',
        _customUnit: !!(fu && !FOOD_UNIT_PRESETS.includes(fu)),
    };
}

// ── 弹窗骨架（只创建一次，复用 DOM） ────────────────────────
function _ensureBatchModal() {
    if (_batchModal && document.body.contains(_batchModal)) return _batchModal;
    // 兜底：若页面上已存在同 id 弹窗（例如重复注入），直接复用而非再建一个
    const existing = document.getElementById('batch-modal');
    if (existing) {
        _batchModal = existing;
        return existing;
    }
    const modal = document.createElement('div');
    modal.id = 'batch-modal';
    modal.className = 'batch-modal fixed inset-0 z-[90] hidden items-center justify-center bg-black/60';
    modal.innerHTML = `
    <div class="batch-panel bg-surface border border-border rounded-xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        <!-- 头部（固定） -->
        <div class="flex items-center justify-between px-4 py-3.5 border-b border-border flex-shrink-0">
            <div class="flex items-center gap-2 min-w-0">
                <i data-lucide="wand-sparkles" class="w-5 h-5 text-accent flex-shrink-0"></i>
                <h3 class="text-sm font-medium text-text-primary truncate">拍照识别 / 批量录入</h3>
            </div>
            <button id="batch-close" data-batch-act="close" class="btn-tap border-0 bg-transparent text-text-muted hover:text-text-primary transition-colors flex-shrink-0" title="关闭" aria-label="关闭">
                <i data-lucide="x" class="w-5 h-5"></i>
            </button>
        </div>

        <!-- 中部（可滚动） -->
        <div class="flex-1 overflow-y-auto min-h-0">
            <!-- 工具区 -->
            <div class="px-4 py-3 space-y-2.5 border-b border-border">
                <input type="file" id="batch-file" accept="image/*" capture="environment" multiple class="hidden">
                <div class="flex flex-wrap items-center gap-2">
                    <button id="batch-pick" data-batch-act="pick" class="btn-secondary text-xs flex items-center gap-1.5 px-3 py-2 whitespace-nowrap">
                        <i data-lucide="image-plus" class="w-4 h-4"></i> 拍照 / 选图
                    </button>
                    <button id="batch-add" data-batch-act="add" class="btn-secondary text-xs flex items-center gap-1.5 px-3 py-2 whitespace-nowrap">
                        <i data-lucide="plus" class="w-4 h-4"></i> 手动添加一行
                    </button>
                    <div class="flex-1"></div>
                    <label class="text-text-muted text-xs whitespace-nowrap">录入日期</label>
                    <input type="date" id="batch-date" class="input-field font-mono text-xs w-auto">
                </div>
                <div id="batch-status" class="hidden items-center gap-2 text-xs text-text-secondary">
                    <i data-lucide="loader-2" class="w-4 h-4 animate-spin text-accent"></i>
                    <span id="batch-status-text">AI 识别中…</span>
                    <button id="batch-cancel-recog" data-batch-act="cancel-recog" class="btn-secondary text-xs px-2 py-1 ml-2">取消</button>
                </div>
            </div>

            <!-- 汇总条（sticky） -->
            <div id="batch-summary" class="batch-summary sticky top-0 z-10 px-4 py-2.5 border-b border-border flex items-center justify-between flex-wrap gap-x-2 gap-y-1 text-xs"></div>

            <!-- 记录列表 -->
            <div id="batch-list" class="px-4 py-3 space-y-3"></div>
        </div>

        <!-- 底部操作条（固定） -->
        <div class="px-4 py-3 border-t border-border flex items-center gap-2 flex-shrink-0">
            <button id="batch-cancel" data-batch-act="cancel" class="btn-secondary btn-compact flex-1 justify-center whitespace-nowrap">取消</button>
            <button id="batch-submit" data-batch-act="submit" class="btn-primary btn-compact flex-1 justify-center whitespace-nowrap">
                <i data-lucide="check" class="w-4 h-4 flex-shrink-0"></i><span id="batch-submit-label">确认录入 (0)</span>
            </button>
        </div>
    </div>`;
    document.body.appendChild(modal);
    _batchModal = modal;
    _bindBatchModalEvents(modal);
    return modal;
}

function _bindBatchModalEvents(modal) {
    // 点击委托
    modal.addEventListener('click', _batchOnClick);
    // 输入委托（input 处理文本/数值，change 处理结构与兜底）
    modal.addEventListener('input', _batchOnInput);
    modal.addEventListener('change', _batchOnChange);

    // 图片选择
    modal.querySelector('#batch-file').addEventListener('change', e => {
        const files = Array.from(e.target.files || []);
        e.target.value = ''; // 允许重复选择同一文件
        if (files.length) _batchHandleFiles(files);
    });

    // 全局录入日期：同步改写「日期来自弹窗」的行；
    // 从图片里识别到日期的行保留其图片日期（用户仍可逐行手动改）。
    modal.querySelector('#batch-date').addEventListener('change', e => {
        const d = e.target.value;
        if (!d) return;
        batchDate = d;
        let changed = 0, kept = 0;
        batchRows.forEach(r => {
            if (r.date_recognized) { kept++; return; }
            const t = (r.timestamp || '').slice(11, 19) || '00:00:00';
            r.timestamp = `${d} ${t}`;
            changed++;
        });
        _batchRenderList();
        showToast(kept > 0
            ? `日期已改为 ${d}（${changed} 条已同步，${kept} 条保留图片日期）`
            : `日期已改为 ${d}，所有记录时间已同步`);
    });
}

// ── 打开 / 关闭 ───────────────────────────────────────────
function openBatchModal() {
    const modal = _ensureBatchModal();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    // 关闭 FAB 悬浮导航，避免冲突
    if (typeof fabClose === 'function') fabClose();
    const dateEl = modal.querySelector('#batch-date');
    if (dateEl) dateEl.value = batchDate;
    _batchRenderStatus();
    _batchRenderList();
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeBatchModal() {
    if (!_batchModal) return;
    _batchModal.classList.add('hidden');
    _batchModal.classList.remove('flex');
    // 关闭时取消仍在进行的识别
    if (batchAbort) {
        try { batchAbort.abort(); } catch (_) { /* ignore */ }
        batchAbort = null;
    }
    batchBusy = false;
    batchRecognizing = false;
    _batchRenderStatus();
    const btn = document.getElementById('batch-submit');
    if (btn) btn.disabled = false;
}

// ── 状态条 / 汇总条 / 列表渲染 ─────────────────────────────
function _batchRenderStatus() {
    const el = document.getElementById('batch-status');
    const textEl = document.getElementById('batch-status-text');
    if (!el) return;
    if (batchRecognizing) {
        el.classList.remove('hidden');
        el.classList.add('flex');
        _batchStatusStart = Date.now();
        if (textEl) textEl.textContent = 'AI 识别中… 已等待 0 秒';
        if (_batchStatusTimer) clearInterval(_batchStatusTimer);
        _batchStatusTimer = setInterval(() => {
            if (!batchRecognizing) {
                clearInterval(_batchStatusTimer);
                _batchStatusTimer = null;
                return;
            }
            const sec = Math.floor((Date.now() - _batchStatusStart) / 1000);
            const t = document.getElementById('batch-status-text');
            if (t) t.textContent = `AI 识别中… 已等待 ${sec} 秒`;
        }, 1000);
    } else {
        el.classList.add('hidden');
        el.classList.remove('flex');
        if (_batchStatusTimer) {
            clearInterval(_batchStatusTimer);
            _batchStatusTimer = null;
        }
        if (textEl) textEl.textContent = 'AI 识别中…';
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function _batchSelectableRows() {
    const out = [];
    batchRows.forEach((r, i) => { if (r.valid !== false) out.push(i); });
    return out;
}

function _batchUpdateSummary() {
    const total = batchRows.length;
    let selected = 0;
    let feedMl = 0;
    batchRows.forEach(r => {
        if (!r._selected || r.valid === false) return;
        selected++;
        if (r.type === 'feed' && r.sub_type !== 'solid_food') {
            const n = parseFloat(r.amount);
            if (!isNaN(n)) feedMl += n;
        }
    });
    const selIdx = _batchSelectableRows();
    const allSel = selIdx.length > 0 && selIdx.every(i => batchRows[i]._selected);
    const el = document.getElementById('batch-summary');
    if (el) {
        // 窄屏用更紧凑的文案，避免「全选」按钮被挤到第二行
        el.innerHTML = `
            <span class="text-text-secondary font-mono text-[11px] sm:text-xs whitespace-nowrap min-w-0 truncate">共 <b class="text-text-primary">${total}</b> · 录入 <b class="text-accent">${selected}</b> · 奶量 <b class="text-text-primary">${feedMl}</b>ml</span>
            <button class="btn-secondary text-[11px] px-2 py-1 whitespace-nowrap flex-shrink-0" data-batch-act="toggle-all">${allSel ? '取消全选' : '全选'}</button>`;
    }
    const label = document.getElementById('batch-submit-label');
    if (label) label.textContent = `确认录入 (${selected})`;
}

function _batchRenderList() {
    const list = document.getElementById('batch-list');
    if (!list) return;
    if (batchRows.length === 0) {
        list.innerHTML = `<div class="text-center text-text-muted text-sm py-10">暂无记录，点击「拍照 / 选图」或「手动添加一行」开始</div>`;
    } else {
        list.innerHTML = batchRows.map((r, i) => _batchRenderRow(r, i)).join('');
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
    _batchUpdateSummary();
}

// ── 选项构造 ─────────────────────────────────────────────
// 按 EDIT_SUB_TYPES 联动生成子类型选项；选中值不在列表里则追加该值。
function _batchSubtypeOptions(type, current, customMode) {
    const opts = (EDIT_SUB_TYPES[type] || []).map(o => ({ value: o.value, label: o.label }));
    const known = new Set(opts.map(o => o.value));
    // 与编辑弹窗 _onEditTypeChange 一致：选中值若不在列表里则追加该值选项
    if (current && current !== '_custom' && !known.has(current)) {
        opts.push({ value: current, label: current });
    }
    return opts.map(o => {
        const selected = customMode ? (o.value === '_custom') : (o.value === current);
        return `<option value="${esc(o.value)}" ${selected ? 'selected' : ''}>${esc(o.label)}</option>`;
    }).join('');
}

function _batchFoodUnitOptions(current, customMode) {
    const opts = FOOD_UNIT_PRESETS.map(u => ({ value: u, label: u }));
    opts.push({ value: '_custom', label: '自定义...' });
    return opts.map(o => {
        const selected = customMode ? (o.value === '_custom') : (o.value === current);
        return `<option value="${esc(o.value)}" ${selected ? 'selected' : ''}>${esc(o.label)}</option>`;
    }).join('');
}

function _batchAmountLabel(row) {
    if (row.sub_type === 'solid_food' && !row._customSub) {
        return `量 (${row.food_unit || 'g'})`;
    }
    return '量 (ml)';
}

// 自定义单位文本输入时，只更新对应行的「量」标签，不重建整行（保留焦点）
function _batchUpdateAmountLabels() {
    const nodes = document.querySelectorAll('#batch-list [data-batch-amount-label]');
    nodes.forEach(el => {
        const i = parseInt(el.dataset.batchRow, 10);
        const row = batchRows[i];
        if (row) el.textContent = _batchAmountLabel(row);
    });
}

// ── 单行渲染 ─────────────────────────────────────────────
function _batchRenderRow(row, i) {
    const warnings = Array.isArray(row.warnings) ? row.warnings : [];
    const errors = Array.isArray(row.errors) ? row.errors : [];
    const lowConf = typeof row.confidence === 'number' && row.confidence < 0.6;
    const warn = lowConf || warnings.length > 0 || row.valid === false || errors.length > 0;
    const invalid = row.valid === false;
    const ts = row.timestamp || '';
    const dpart = ts.slice(0, 10);
    const tpart = ts.slice(11, 16);

    const confBadge = (warn && typeof row.confidence === 'number')
        ? `<span class="badge-warn">置信度 ${Math.round(row.confidence * 100)}%</span>` : '';
    let notes = warnings.concat(errors)
        .map(t => `<div class="text-amber-400 text-[11px] leading-relaxed">⚠ ${esc(t)}</div>`).join('');
    if (invalid && errors.length === 0) {
        notes += `<div class="text-amber-400 text-[11px]">⚠ 识别结果无效，请核对后再录入</div>`;
    }
    const warnBlock = (confBadge || notes)
        ? `<div class="flex flex-wrap items-start gap-1.5">${confBadge}<div class="flex-1 min-w-0 space-y-0.5">${notes}</div></div>` : '';
    const rawHtml = row.raw_text
        ? `<div class="text-text-muted text-[11px] break-all">识别原文：${esc(row.raw_text)}</div>` : '';

    const typeOpts = (row.type ? '' : `<option value="" selected>请选择类型</option>`) +
        Object.keys(TYPE_LABELS).map(t =>
            `<option value="${esc(t)}" ${t === row.type ? 'selected' : ''}>${esc(TYPE_LABELS[t])}</option>`
        ).join('');
    const subOpts = _batchSubtypeOptions(row.type, row.sub_type, !!row._customSub);
    // 自定义模式下文本框应留空（避免与已废弃的旧值混淆），值由用户输入写回
    const customSubWrap = row._customSub
        ? `<input type="text" class="input-field mt-1.5" data-batch-row="${i}" data-batch-field="_custom_sub" value="${esc(row._customSubText || '')}" placeholder="自定义子类型名称">`
        : '';

    const isSolid = row.sub_type === 'solid_food' && !row._customSub;
    const unitOpts = _batchFoodUnitOptions(row.food_unit, !!row._customUnit);
    const unitCustomInput = row._customUnit
        ? `<input type="text" class="input-field mt-1.5" data-batch-row="${i}" data-batch-field="_custom_unit" value="${esc(FOOD_UNIT_PRESETS.includes(row.food_unit) ? '' : row.food_unit)}" placeholder="自定义单位">`
        : '';
    const foodUnitBlock = isSolid ? `
            <div class="mt-2">
                <label class="text-text-muted text-[11px] mb-1 block">辅食计量单位</label>
                <select class="input-field" data-batch-row="${i}" data-batch-field="food_unit">${unitOpts}</select>
                ${unitCustomInput}
            </div>` : '';

    const moreBlock = row._more ? `
        <div class="mt-2 pt-2 border-t border-border">
            <div class="grid grid-cols-2 gap-2">
                <div>
                    <label class="text-text-muted text-[11px] mb-1 block">时长 (分钟)</label>
                    <input type="number" class="input-field font-mono" min="0" data-batch-row="${i}" data-batch-field="duration" value="${esc(row.duration)}">
                </div>
                <div>
                    <label class="text-text-muted text-[11px] mb-1 block">体温 (°C)</label>
                    <input type="number" class="input-field font-mono" step="0.1" data-batch-row="${i}" data-batch-field="temperature" value="${esc(row.temperature)}">
                </div>
                <div>
                    <label class="text-text-muted text-[11px] mb-1 block">颜色</label>
                    <input type="text" class="input-field" data-batch-row="${i}" data-batch-field="color" value="${esc(row.color)}">
                </div>
                <div>
                    <label class="text-text-muted text-[11px] mb-1 block">性状</label>
                    <input type="text" class="input-field" data-batch-row="${i}" data-batch-field="consistency" value="${esc(row.consistency)}">
                </div>
            </div>
            ${foodUnitBlock}
        </div>` : '';

    return `
    <div class="batch-row ${warn ? 'batch-row-warn border-amber-500/40 bg-amber-500/5' : ''} rounded-xl border border-border p-3" data-batch-row-wrap="${i}">
        <div class="flex items-start gap-2.5">
            <input type="checkbox" class="mt-2.5 w-5 h-5 rounded border-border bg-surface accent-teal-500 flex-shrink-0"
                   data-batch-row="${i}" data-batch-field="_selected"
                   ${row._selected && !invalid ? 'checked' : ''} ${invalid ? 'disabled' : ''}>
            <div class="flex-1 min-w-0 space-y-2">
                <!-- 移动端 2 列、桌面 3 列，避免日期/时间/子类型在窄屏被截断 -->
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div>
                        <label class="text-text-muted text-[11px] mb-1 block">类型</label>
                        <select class="input-field" data-batch-row="${i}" data-batch-field="type">${typeOpts}</select>
                    </div>
                    <div class="min-w-0">
                        <label class="text-text-muted text-[11px] mb-1 block">子类型</label>
                        <select class="input-field" data-batch-row="${i}" data-batch-field="sub_type">${subOpts}</select>
                        ${customSubWrap}
                    </div>
                    <div class="min-w-0 col-span-2 sm:col-span-1">
                        <label class="text-text-muted text-[11px] mb-1 block" data-batch-amount-label data-batch-row="${i}">${esc(_batchAmountLabel(row))}</label>
                        <input type="number" class="input-field font-mono" min="0" data-batch-row="${i}" data-batch-field="amount" value="${esc(row.amount)}">
                    </div>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div class="min-w-0">
                        <label class="text-text-muted text-[11px] mb-1 block">
                            日期${row.date_recognized ? ' <span class="text-accent">· 图片</span>' : ''}
                        </label>
                        <input type="date" class="input-field font-mono" data-batch-row="${i}" data-batch-field="_date" value="${esc(dpart)}">
                    </div>
                    <div class="min-w-0">
                        <label class="text-text-muted text-[11px] mb-1 block">时间</label>
                        <input type="time" class="input-field font-mono" data-batch-row="${i}" data-batch-field="_time" value="${esc(tpart)}">
                    </div>
                    <div class="min-w-0 col-span-2 sm:col-span-1">
                        <label class="text-text-muted text-[11px] mb-1 block">备注</label>
                        <input type="text" class="input-field" data-batch-row="${i}" data-batch-field="note" value="${esc(row.note)}">
                    </div>
                </div>
                ${warnBlock}
                ${rawHtml}
                <div class="flex items-center justify-between gap-2">
                    <button class="text-text-muted hover:text-accent transition-colors text-[11px] flex items-center gap-1" data-batch-act="more" data-batch-row="${i}">
                        <i data-lucide="${row._more ? 'chevron-up' : 'chevron-down'}" class="w-3.5 h-3.5"></i> ${row._more ? '收起' : '更多'}
                    </button>
                    <button class="btn-tap btn-tap-sm text-text-muted hover:text-red-400 transition-colors flex-shrink-0" data-batch-act="delete" data-batch-row="${i}" title="删除" aria-label="删除这一行">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
                ${moreBlock}
            </div>
        </div>
    </div>`;
}

// ── 事件处理 ─────────────────────────────────────────────
function _batchOnClick(e) {
    const el = e.target.closest('[data-batch-act]');
    if (!el || !_batchModal || !_batchModal.contains(el)) return;
    const act = el.dataset.batchAct;
    const i = (el.dataset.batchRow !== undefined) ? parseInt(el.dataset.batchRow, 10) : -1;
    switch (act) {
        case 'close':
        case 'cancel':
            closeBatchModal();
            break;
        case 'pick': {
            const f = document.getElementById('batch-file');
            if (f) f.click();
            break;
        }
        case 'add':
            _batchAddManualRow();
            break;
        case 'cancel-recog':
            _batchCancelRecognize();
            break;
        case 'submit':
            _batchSubmit();
            break;
        case 'toggle-all':
            _batchToggleAll();
            break;
        case 'delete':
            batchRows.splice(i, 1);
            _batchRenderList();
            break;
        case 'more':
            if (batchRows[i]) {
                batchRows[i]._more = !batchRows[i]._more;
                _batchRenderList();
            }
            break;
        default:
            break;
    }
}

// 从行内的日期 / 时间输入重建 timestamp
function _batchSyncTimestamp(row, rowEl) {
    if (!rowEl) return;
    const dEl = rowEl.querySelector('[data-batch-field="_date"]');
    const tEl = rowEl.querySelector('[data-batch-field="_time"]');
    if (!dEl || !tEl) return;
    const d = dEl.value;
    if (!d) { row.timestamp = ''; return; }
    row.timestamp = `${d} ${tEl.value || '00:00'}:00`;
}

// input：文本 / 数值字段只写回模型，不重建 DOM（保留焦点）
function _batchOnInput(e) {
    const el = e.target;
    const field = el.dataset.batchField;
    if (!field || el.dataset.batchRow === undefined) return;
    if (_BATCH_STRUCTURAL.has(field)) return; // 交给 change 统一处理
    const i = parseInt(el.dataset.batchRow, 10);
    const row = batchRows[i];
    if (!row) return;
    const rowEl = el.closest('[data-batch-row-wrap]');
    const value = el.value;
    switch (field) {
        case '_custom_sub':
            row._customSubText = value;
            row.sub_type = value.trim();
            // 自定义子类型输入可能补齐原来无效的行：只重算状态并局部启用/禁用勾选框，
            // 不重绘整行，避免每敲一个字就丢失输入焦点。
            _batchRevalidateRow(row);
            _batchSyncRowCheckbox(rowEl, i);
            break;
        case '_custom_unit':
            row.food_unit = value;
            _batchUpdateAmountLabels();
            break;
        case '_date':
            // 用户手动改了该行日期，就不再视为「图片日期」，之后的全局日期变更会正常覆盖它
            row.date_recognized = false;
            _batchSyncTimestamp(row, rowEl);
            break;
        case '_time':
            _batchSyncTimestamp(row, rowEl);
            break;
        case 'amount': row.amount = value; break;
        case 'duration': row.duration = value; break;
        case 'color': row.color = value; break;
        case 'consistency': row.consistency = value; break;
        case 'temperature': row.temperature = value; break;
        case 'note': row.note = value; break;
        default: return;
    }
    _batchUpdateSummary();
}

// change：联动结构字段 + 其余字段兜底
function _batchOnChange(e) {
    const el = e.target;
    const field = el.dataset.batchField;
    if (!field || el.dataset.batchRow === undefined) return;
    const i = parseInt(el.dataset.batchRow, 10);
    const row = batchRows[i];
    if (!row) return;
    const rowEl = el.closest('[data-batch-row-wrap]');
    const value = el.value;

    if (field === '_selected') {
        // 无效行不可勾选；但用户可通过编辑类型/子类型修复（见 _batchRevalidateRow），
        // 修复后重绘会重新启用勾选框，因此这里不是永久锁死。
        if (row.valid === false) { el.checked = false; return; }
        row._selected = el.checked;
        _batchUpdateSummary();
        return;
    }
    if (field === 'type') {
        row.type = value;
        row._customSub = false;
        row._customSubText = '';
        const opts = EDIT_SUB_TYPES[value] || [];
        const known = opts.map(o => o.value);
        // 类型变更时重造子类型选项：旧值不在新列表则回落到第一项
        if (!known.includes(row.sub_type)) {
            row.sub_type = opts.length ? opts[0].value : '';
        }
        _batchSyncCustomUnit(row);
        _batchRevalidateRow(row);
        _batchRenderList();
        return;
    }
    if (field === 'sub_type') {
        if (value === '_custom') {
            row._customSub = true;
            row._customSubText = '';
            row.sub_type = '';
        } else {
            row._customSub = false;
            row._customSubText = '';
            row.sub_type = value;
        }
        _batchSyncCustomUnit(row);
        _batchRevalidateRow(row);
        _batchRenderList();
        return;
    }
    if (field === 'food_unit') {
        if (value === '_custom') {
            row._customUnit = true;
        } else {
            row._customUnit = false;
            row.food_unit = value;
        }
        _batchRenderList();
        return;
    }
    // 其余值字段与 input 幂等兜底
    _batchOnInput(e);
}

function _batchSyncCustomUnit(row) {
    row._customUnit = !!(row.food_unit && !FOOD_UNIT_PRESETS.includes(row.food_unit));
}

// 用户人工修正类型/子类型后重新判定合法性：AI 判定 valid=false 的行不应被永久锁死，
// 只要 type/sub_type 已补齐即可恢复勾选并参与提交（对应「逐行核对/编辑」的核心承诺）。
function _batchRevalidateRow(row) {
    const typeOk = Object.prototype.hasOwnProperty.call(TYPE_LABELS, row.type);
    const subOk = !!String(row.sub_type || '').trim();
    if (typeOk && subOk) {
        row.valid = true;
        row.errors = (Array.isArray(row.errors) ? row.errors : [])
            .filter(e => e !== '无法识别记录类型' && e !== '该条记录解析异常');
        // 修正后默认勾选，但保留用户已手动取消勾选的意图（仅对原本无效行自动勾选）
        if (row._selected === false && row._wasInvalid) row._selected = true;
        row._wasInvalid = false;
    } else {
        row._wasInvalid = true;
        row.valid = false;
        if (!typeOk && !row.errors.includes('无法识别记录类型')) {
            row.errors.push('无法识别记录类型');
        }
        row._selected = false;
    }
}

function _batchToggleAll() {
    const sel = _batchSelectableRows();
    const allSel = sel.length > 0 && sel.every(i => batchRows[i]._selected);
    sel.forEach(i => { batchRows[i]._selected = !allSel; });
    _batchRenderList();
}

// 局部同步单行的勾选框可用性与选中态（不重建 DOM，保留输入焦点）
function _batchSyncRowCheckbox(rowEl, i) {
    if (!rowEl) return;
    const row = batchRows[i];
    if (!row) return;
    const cb = rowEl.querySelector('[data-batch-field="_selected"]');
    if (cb) {
        cb.disabled = row.valid === false;
        cb.checked = !!row._selected && row.valid !== false;
    }
    rowEl.classList.toggle('batch-row-warn',
        (typeof row.confidence === 'number' && row.confidence < 0.6) ||
        (Array.isArray(row.warnings) && row.warnings.length > 0) ||
        (Array.isArray(row.errors) && row.errors.length > 0) ||
        row.valid === false);
}

// ── 手动添加一行 ─────────────────────────────────────────
function _batchAddManualRow() {
    batchRows.push(_batchNormalizeRow({
        type: 'feed',
        sub_type: 'formula',
        amount: '',
        duration: '',
        color: '',
        consistency: '',
        temperature: '',
        note: '',
        timestamp: `${batchDate} ${_batchNowTimestamp().slice(11, 19)}`,
        food_unit: '',
        confidence: 1,
        warnings: [],
        raw_text: '',
        valid: true,
        errors: [],
    }));
    _batchRenderList();
}

// ── 图片压缩 ─────────────────────────────────────────────
// FileReader → Image → Canvas 缩到最长边 1600px → JPEG(0.8) dataURL。
// 说明：此处刻意忽略 EXIF 方向校正（移动端个别照片方向可能需用户在系统相册先转正），
// 以零依赖、纯浏览器实现为准；不支持的格式（如 HEIC）会在解码阶段失败并被上层 catch。
function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('无法读取图片文件'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('图片解码失败（可能是不支持的 HEIC 等格式）'));
            img.onload = () => {
                try {
                    const maxSide = 1600;
                    let w = img.naturalWidth || img.width;
                    let h = img.naturalHeight || img.height;
                    if (!w || !h) { reject(new Error('图片尺寸无效')); return; }
                    const scale = Math.min(1, maxSide / Math.max(w, h));
                    w = Math.max(1, Math.round(w * scale));
                    h = Math.max(1, Math.round(h * scale));
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) { reject(new Error('浏览器不支持 Canvas')); return; }
                    ctx.drawImage(img, 0, 0, w, h);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                    if (!dataUrl || dataUrl === 'data:,') { reject(new Error('图片压缩失败')); return; }
                    resolve(dataUrl);
                } catch (err) {
                    reject(new Error((err && err.message) || '图片处理失败'));
                }
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

// ── 识别流程（多张照片累积，不覆盖已有行） ──────────────────
function _batchCancelRecognize() {
    if (batchAbort) {
        try { batchAbort.abort(); } catch (_) { /* ignore */ }
    }
    showToast('已取消识别');
}

async function _batchHandleFiles(files) {
    if (batchBusy) { showToast('正在处理中，请稍候'); return; }

    // 识别前先查 AI 配置；未配置只提示，不阻断「手动添加一行」与批量录入
    let status;
    try {
        status = await api('/api/ai/status');
    } catch (e) {
        showToast('无法获取 AI 状态：' + (e.message || '请重试'));
        return;
    }
    if (!status || status.configured === false) {
        showToast('请先在管理页配置 AI 服务');
        return;
    }

    const controller = new AbortController();
    batchAbort = controller;
    batchBusy = true;
    batchRecognizing = true;
    _batchRenderStatus();

    let added = 0;
    let failed = false;
    try {
        for (const file of files) {
            if (controller.signal.aborted) break;
            let image;
            try {
                image = await compressImage(file);
            } catch (e) {
                showToast(`图片「${file.name}」处理失败：${e.message || '格式不支持'}`);
                continue;
            }
            if (controller.signal.aborted) break;
            try {
                // 不设前端超时：视觉识别可能耗时数分钟（后端默认同样不限时），
                // 由用户的「取消」按钮或页面关闭来终止，避免请求已完成但结果被丢弃。
                const res = await api('/api/ai/recognize', {
                    method: 'POST',
                    body: JSON.stringify({ image: image, date: batchDate }),
                    signal: controller.signal,
                });
                const records = (res && Array.isArray(res.records)) ? res.records : [];
                records.forEach(r => batchRows.push(_batchNormalizeRow(r)));
                added += records.length;
            } catch (e) {
                if (controller.signal.aborted || e.isCancelled || e.name === 'AbortError') break;
                // 超时（若部署方显式配置了网关/代理超时）单独提示，避免误以为识别失败
                if (e.isTimeout) {
                    showToast('识别超时：请求仍可能已在服务端完成，请稍后重试或检查网络');
                } else {
                    showToast(`识别失败：${e.message || '请重试'}`);
                }
                failed = true;
                break;
            }
        }
    } finally {
        batchBusy = false;
        batchRecognizing = false;
        if (batchAbort === controller) batchAbort = null;
        _batchRenderStatus();
        _batchRenderList();   // 无论成功/失败/取消，都把已拿到的候选行渲染出来
        if (controller.signal.aborted) {
            showToast('已取消识别');
        } else if (failed) {
            // 失败提示已在上面 showToast，这里不覆盖
        } else {
            showToast(added > 0 ? `已添加 ${added} 条候选记录，请核对` : '未识别到记录，可手动添加');
        }
    }
}

// ── 提交 ─────────────────────────────────────────────────
async function _batchSubmit() {
    if (batchBusy) return;
    const selectedIdx = [];
    batchRows.forEach((r, i) => {
        if (r._selected && r.valid !== false) selectedIdx.push(i);
    });
    if (selectedIdx.length === 0) {
        showToast('请至少勾选一条记录');
        return;
    }
    for (const i of selectedIdx) {
        const r = batchRows[i];
        const no = i + 1;
        if (r.valid === false) { showToast(`第 ${no} 条识别结果无效，请修正后再录入`); return; }
        if (!r.type || !r.sub_type) { showToast(`第 ${no} 条缺少类型或子类型`); return; }
        if (!_batchValidTimestamp(r.timestamp)) { showToast(`第 ${no} 条时间无效`); return; }
    }

    const toNum = v => (v === '' || v === null || v === undefined || isNaN(parseFloat(v))) ? null : parseFloat(v);
    const toInt = v => (v === '' || v === null || v === undefined || isNaN(parseInt(v, 10))) ? null : parseInt(v, 10);
    // 只发送 DB 字段，剥掉 confidence / warnings / raw_text / valid / errors / _selected 等
    const records = selectedIdx.map(i => {
        const r = batchRows[i];
        return {
            type: r.type,
            sub_type: r.sub_type,
            amount: toNum(r.amount),
            duration: toInt(r.duration),
            color: r.color || '',
            consistency: r.consistency || '',
            temperature: toNum(r.temperature),
            note: r.note || '',
            timestamp: _batchNormTimestamp(r.timestamp),
            food_unit: r.food_unit || '',
        };
    });
    const payload = { records: records, _date: batchDate };

    batchBusy = true;
    const btn = document.getElementById('batch-submit');
    const label = document.getElementById('batch-submit-label');
    if (btn) btn.disabled = true;
    if (label) label.textContent = '录入中…';
    try {
        const result = await api('/api/records/batch', {
            method: 'POST',
            body: JSON.stringify(payload),
            timeoutMs: 30000,
        });
        const inserted = (result && result.inserted !== undefined) ? result.inserted : records.length;
        showToast(`已录入 ${inserted} 条`);
        batchRows = [];
        closeBatchModal();
        // 批量接口直接返回今日概览数据，无需二次 GET
        if (result && typeof renderDashboard === 'function') renderDashboard(result);
    } catch (e) {
        // 失败保留弹窗与所有行数据
        showToast(e.message || '录入失败');
    } finally {
        batchBusy = false;
        if (btn) btn.disabled = false;
        const count = batchRows.filter(r => r._selected && r.valid !== false).length;
        if (label) label.textContent = `确认录入 (${count})`;
    }
}

// ── 暴露全局入口 ─────────────────────────────────────────
window.openBatchModal = openBatchModal;
window.closeBatchModal = closeBatchModal;
window.compressImage = compressImage;

})();
