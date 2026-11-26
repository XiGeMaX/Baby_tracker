// Shared application controls. Native form elements remain the source of truth,
// while every visible picker is rendered with the Baby Tracker theme.
(function () {
    'use strict';

    const popover = document.createElement('div');
    popover.className = 'ui-popover-layer';
    popover.hidden = true;
    popover.id = 'theme-control-popover';
    document.body.appendChild(popover);

    let activeTrigger = null;
    let activeControl = null;
    let activePlacement = null;
    let closeActivePopover = null;
    let repositionFrame = 0;
    let idCounter = 0;
    const datePickerWidth = 320;

    const nativeSelectValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    const nativeInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const refreshQueue = new Set();
    let refreshScheduled = false;

    function nextId(prefix) {
        idCounter += 1;
        return `${prefix}-${idCounter}`;
    }

    function icon(name, className) {
        const node = document.createElement('i');
        node.dataset.lucide = name;
        node.className = className || 'ui-control-icon';
        node.setAttribute('aria-hidden', 'true');
        return node;
    }

    function refreshIcons(root) {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    function associatedLabels(control) {
        const labels = new Set(Array.from(control.labels || []));
        const parent = control.parentElement;
        if (parent) {
            const nearby = parent.querySelector(':scope > label, :scope > .field-label');
            if (nearby) labels.add(nearby);
        }
        return Array.from(labels).filter(label => !label.contains(control));
    }

    function controlLabel(control, fallback) {
        const labels = associatedLabels(control)
            .map(label => label.textContent.trim())
            .filter(Boolean);
        if (labels.length) return labels.join(' ');
        return control.getAttribute('aria-label') || control.getAttribute('title') || fallback;
    }

    function moveClasses(control, wrapper) {
        const classes = Array.from(control.classList).filter(className => className !== 'input-field');
        if (classes.length) wrapper.classList.add(...classes);
        control.className = 'ui-native-control';
    }

    function labelIds(control) {
        return associatedLabels(control).map(label => {
            if (!label.id) label.id = nextId('ui-label');
            return label.id;
        });
    }

    function applyAccessibleName(trigger, control, fallback) {
        const ids = labelIds(control);
        if (ids.length) {
            trigger.setAttribute('aria-labelledby', ids.join(' '));
            return;
        }
        trigger.setAttribute('aria-label', controlLabel(control, fallback));
    }

    function bindAssociatedLabels(control, trigger, labels) {
        (labels || associatedLabels(control)).forEach(label => {
            label.addEventListener('click', event => {
                if (event.target.closest('button, a, input, select, textarea')) return;
                event.preventDefault();
                focusWithoutScroll(trigger);
                trigger.click();
            });
        });
    }

    function focusWithoutScroll(element) {
        if (!element || typeof element.focus !== 'function') return;
        try {
            element.focus({ preventScroll: true });
        } catch {
            element.focus();
        }
    }

    function positionPopover(trigger, placement = {}) {
        const margin = 8;
        const gap = 6;
        const rect = trigger.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const preferredWidth = Number(placement.width) || 0;
        const minimumWidth = Number(placement.minimumWidth) || 0;
        const targetWidth = preferredWidth || Math.max(rect.width, minimumWidth);
        const width = Math.min(
            targetWidth,
            viewportWidth - margin * 2
        );
        popover.style.width = `${Math.round(width)}px`;
        popover.style.minWidth = '0';
        popover.style.maxWidth = `calc(100vw - ${margin * 2}px)`;
        popover.style.left = '0px';
        popover.style.top = '0px';

        // Layout dimensions stay stable while the entrance scale animation runs.
        const computedWidth = popover.offsetWidth;
        const height = popover.offsetHeight;
        let left = rect.left;
        let top = rect.bottom + gap;

        if (left + computedWidth > viewportWidth - margin) {
            left = viewportWidth - computedWidth - margin;
        }
        left = Math.max(margin, left);

        if (top + height > viewportHeight - margin && rect.top - height - gap >= margin) {
            top = rect.top - height - gap;
        } else {
            top = Math.min(top, viewportHeight - height - margin);
        }
        top = Math.max(margin, top);

        popover.style.left = `${Math.round(left)}px`;
        popover.style.top = `${Math.round(top)}px`;
    }

    function triggerIsVisible(trigger) {
        const rect = trigger.getBoundingClientRect();
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft || 0;
        const top = viewport?.offsetTop || 0;
        const right = left + (viewport?.width || window.innerWidth);
        const bottom = top + (viewport?.height || window.innerHeight);
        return rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom;
    }

    function repositionActivePopover() {
        if (popover.hidden || !activeTrigger) return;
        if (!document.contains(activeTrigger) || !triggerIsVisible(activeTrigger)) {
            closePopover();
            return;
        }
        positionPopover(activeTrigger, activePlacement || {});
    }

    function schedulePopoverReposition() {
        if (popover.hidden || !activeTrigger || repositionFrame) return;
        repositionFrame = requestAnimationFrame(() => {
            repositionFrame = 0;
            repositionActivePopover();
        });
    }

    function closePopover({ restoreFocus = false } = {}) {
        if (closeActivePopover) closeActivePopover();
        const trigger = activeTrigger;
        if (repositionFrame) {
            cancelAnimationFrame(repositionFrame);
            repositionFrame = 0;
        }
        popover.hidden = true;
        popover.replaceChildren();
        popover.removeAttribute('role');
        activeTrigger = null;
        activeControl = null;
        activePlacement = null;
        closeActivePopover = null;
        if (trigger) {
            trigger.setAttribute('aria-expanded', 'false');
            trigger.classList.remove('is-open');
        }
        if (restoreFocus && trigger && document.contains(trigger)) focusWithoutScroll(trigger);
    }

    function openPopover(trigger, control, content, options = {}) {
        if (activeTrigger === trigger && !popover.hidden) {
            closePopover({ restoreFocus: true });
            return;
        }
        closePopover();

        activeTrigger = trigger;
        activeControl = control;
        activePlacement = {
            width: options.width,
            minimumWidth: options.minimumWidth,
        };
        closeActivePopover = options.onClose || null;
        trigger.setAttribute('aria-expanded', 'true');
        trigger.classList.add('is-open');
        popover.replaceChildren(content);
        popover.hidden = false;
        if (options.role) popover.setAttribute('role', options.role);
        refreshIcons(popover);
        positionPopover(trigger, activePlacement);

        const focusTarget = options.focusTarget || popover.querySelector('button:not(:disabled), [tabindex="0"]');
        if (focusTarget) requestAnimationFrame(() => focusWithoutScroll(focusTarget));
    }

    function setNativeValue(control, value) {
        const descriptor = control instanceof HTMLSelectElement ? nativeSelectValue : nativeInputValue;
        if (descriptor && descriptor.set) descriptor.set.call(control, value);
        else control.value = value;
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function queueRefresh(control) {
        if (!control || !control.dataset.uiEnhanced) return;
        refreshQueue.add(control);
        if (refreshScheduled) return;
        refreshScheduled = true;
        queueMicrotask(() => {
            refreshScheduled = false;
            const controls = Array.from(refreshQueue);
            refreshQueue.clear();
            controls.forEach(item => {
                if (item.dataset.uiEnhanced === 'select') syncSelect(item);
                if (item.dataset.uiEnhanced === 'date') syncDate(item);
                if (item.dataset.uiEnhanced === 'time') syncTime(item);
                if (item.dataset.uiEnhanced === 'file') syncFile(item);
            });
        });
    }

    // Programmatic value changes are common in the page scripts. Keep the
    // themed trigger in sync without requiring every call site to know about it.
    if (nativeSelectValue && nativeSelectValue.get && nativeSelectValue.set) {
        Object.defineProperty(HTMLSelectElement.prototype, 'value', {
            configurable: true,
            enumerable: nativeSelectValue.enumerable,
            get: nativeSelectValue.get,
            set(value) {
                nativeSelectValue.set.call(this, value);
                queueRefresh(this);
            },
        });
    }

    if (nativeInputValue && nativeInputValue.get && nativeInputValue.set) {
        Object.defineProperty(HTMLInputElement.prototype, 'value', {
            configurable: true,
            enumerable: nativeInputValue.enumerable,
            get: nativeInputValue.get,
            set(value) {
                nativeInputValue.set.call(this, value);
                queueRefresh(this);
            },
        });
    }

    function syncSelect(select) {
        const wrapper = select.closest('.ui-control');
        if (!wrapper) return;
        const trigger = wrapper.querySelector('.ui-select-trigger');
        const value = wrapper.querySelector('.ui-control-value');
        if (!trigger || !value) return;
        const selected = select.selectedOptions && select.selectedOptions[0];
        const label = selected ? selected.textContent.trim() : '';
        value.textContent = label || select.getAttribute('data-placeholder') || '请选择';
        value.classList.toggle('is-placeholder', !label || selected.disabled || selected.value === '');
        trigger.disabled = select.disabled;
        wrapper.classList.toggle('is-disabled', select.disabled);
        trigger.setAttribute('aria-expanded', String(activeTrigger === trigger && !popover.hidden));
    }

    function buildSelectMenu(select, trigger) {
        const menu = document.createElement('div');
        menu.className = 'ui-select-list';
        menu.setAttribute('role', 'listbox');
        menu.setAttribute('aria-label', controlLabel(select, '选项'));

        const options = Array.from(select.options);
        options.forEach((option, index) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'ui-select-option';
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(index === select.selectedIndex));
            item.disabled = option.disabled;
            item.textContent = option.textContent.trim();
            item.dataset.optionIndex = String(index);
            item.addEventListener('click', () => {
                select.selectedIndex = index;
                select.dispatchEvent(new Event('input', { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true }));
                syncSelect(select);
                closePopover({ restoreFocus: true });
            });
            menu.appendChild(item);
        });

        menu.addEventListener('keydown', event => {
            const items = Array.from(menu.querySelectorAll('.ui-select-option:not(:disabled)'));
            const current = document.activeElement;
            const index = items.indexOf(current);
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                items[Math.min(items.length - 1, index + 1)]?.focus();
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                items[Math.max(0, index <= 0 ? 0 : index - 1)]?.focus();
            } else if (event.key === 'Home') {
                event.preventDefault();
                items[0]?.focus();
            } else if (event.key === 'End') {
                event.preventDefault();
                items[items.length - 1]?.focus();
            } else if (event.key === 'Tab') {
                closePopover();
            }
        });
        return menu;
    }

    function openSelect(select, trigger) {
        const menu = buildSelectMenu(select, trigger);
        const selected = menu.querySelector('[aria-selected="true"]:not(:disabled)');
        const first = menu.querySelector('.ui-select-option:not(:disabled)');
        const fragment = document.createDocumentFragment();
        const title = document.createElement('div');
        title.className = 'ui-popover-title';
        title.textContent = controlLabel(select, '选择');
        fragment.append(title, menu);
        openPopover(trigger, select, fragment, {
            minimumWidth: Math.max(176, trigger.getBoundingClientRect().width),
            role: 'dialog',
            focusTarget: selected || first,
        });
    }

    function enhanceSelect(select) {
        if (!(select instanceof HTMLSelectElement) || select.dataset.uiEnhanced) return;
        if (select.matches('.range-native, [multiple], [hidden]') || Number(select.size) > 1) return;
        if (!select.isConnected) return;

        const labels = associatedLabels(select);
        const wrapper = document.createElement('div');
        wrapper.className = 'ui-control ui-select';
        moveClasses(select, wrapper);
        wrapper.dataset.uiControl = 'select';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ui-select-trigger ui-control-trigger';
        trigger.id = select.id ? `${select.id}-trigger` : nextId('ui-select-trigger');
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        applyAccessibleName(trigger, select, '选择');

        const value = document.createElement('span');
        value.className = 'ui-control-value';
        trigger.append(value, icon('chevron-down'));

        select.dataset.uiEnhanced = 'select';
        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');
        select.before(wrapper);
        wrapper.append(select, trigger);
        bindAssociatedLabels(select, trigger, labels);
        trigger.addEventListener('click', () => openSelect(select, trigger));
        trigger.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                openSelect(select, trigger);
            }
        });
        syncSelect(select);
    }

    function pad(value) {
        return String(value).padStart(2, '0');
    }

    function parseDate(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
        if (!match) return null;
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }

    function formatDateInput(date) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function formatDateDisplay(value) {
        const date = parseDate(value);
        if (!date) return '';
        return new Intl.DateTimeFormat('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(date);
    }

    function syncDate(input) {
        const wrapper = input.closest('.ui-control');
        if (!wrapper) return;
        const trigger = wrapper.querySelector('.ui-date-trigger');
        const value = wrapper.querySelector('.ui-control-value');
        if (!trigger || !value) return;
        const display = formatDateDisplay(input.value);
        value.textContent = display || input.getAttribute('data-placeholder') || '选择日期';
        value.classList.toggle('is-placeholder', !display);
        trigger.disabled = input.disabled;
        wrapper.classList.toggle('is-disabled', input.disabled);
    }

    function dateAllowed(input, value) {
        if (input.min && value < input.min) return false;
        if (input.max && value > input.max) return false;
        return true;
    }

    function openDate(input, trigger) {
        closePopover();
        const selectedDate = parseDate(input.value);
        const initial = selectedDate || new Date();
        let viewYear = initial.getFullYear();
        let viewMonth = initial.getMonth();

        function selectDate(value) {
            if (!dateAllowed(input, value)) return;
            setNativeValue(input, value);
            syncDate(input);
            closePopover({ restoreFocus: true });
        }

        function render(focusTarget = 'selected') {
            const calendar = document.createElement('div');
            calendar.className = 'ui-calendar';

            const header = document.createElement('div');
            header.className = 'ui-calendar-header';
            const previous = document.createElement('button');
            previous.type = 'button';
            previous.className = 'ui-calendar-nav';
            previous.setAttribute('aria-label', '上个月');
            previous.append(icon('chevron-left'));
            const title = document.createElement('div');
            title.className = 'ui-calendar-title';
            title.textContent = `${viewYear}年${viewMonth + 1}月`;
            const next = document.createElement('button');
            next.type = 'button';
            next.className = 'ui-calendar-nav';
            next.setAttribute('aria-label', '下个月');
            next.append(icon('chevron-right'));
            previous.addEventListener('click', () => {
                viewMonth -= 1;
                if (viewMonth < 0) {
                    viewMonth = 11;
                    viewYear -= 1;
                }
                render('previous');
            });
            next.addEventListener('click', () => {
                viewMonth += 1;
                if (viewMonth > 11) {
                    viewMonth = 0;
                    viewYear += 1;
                }
                render('next');
            });
            header.append(previous, title, next);

            const weekdays = document.createElement('div');
            weekdays.className = 'ui-calendar-weekdays';
            ['一', '二', '三', '四', '五', '六', '日'].forEach(day => {
                const item = document.createElement('span');
                item.textContent = day;
                weekdays.appendChild(item);
            });

            const grid = document.createElement('div');
            grid.className = 'ui-calendar-grid';
            grid.setAttribute('role', 'group');
            grid.setAttribute('aria-label', `${viewYear}年${viewMonth + 1}月`);
            const firstDay = new Date(viewYear, viewMonth, 1);
            const offset = (firstDay.getDay() + 6) % 7;
            for (let i = 0; i < offset; i += 1) {
                const blank = document.createElement('span');
                blank.className = 'ui-calendar-blank';
                grid.appendChild(blank);
            }

            const days = new Date(viewYear, viewMonth + 1, 0).getDate();
            const today = formatDateInput(new Date());
            for (let day = 1; day <= days; day += 1) {
                const value = formatDateInput(new Date(viewYear, viewMonth, day));
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'ui-calendar-day';
                button.textContent = String(day);
                button.setAttribute('aria-label', formatDateDisplay(value));
                button.setAttribute('aria-pressed', String(value === input.value));
                button.classList.toggle('is-today', value === today);
                button.classList.toggle('is-selected', value === input.value);
                button.disabled = !dateAllowed(input, value);
                button.addEventListener('click', () => selectDate(value));
                grid.appendChild(button);
            }
            while (grid.children.length < 42) {
                const blank = document.createElement('span');
                blank.className = 'ui-calendar-blank';
                blank.setAttribute('aria-hidden', 'true');
                grid.appendChild(blank);
            }

            const footer = document.createElement('div');
            footer.className = 'ui-calendar-footer';
            const todayButton = document.createElement('button');
            todayButton.type = 'button';
            todayButton.className = 'ui-calendar-action';
            todayButton.textContent = '今天';
            todayButton.addEventListener('click', () => selectDate(today));
            const clearButton = document.createElement('button');
            clearButton.type = 'button';
            clearButton.className = 'ui-calendar-action';
            clearButton.textContent = '清除';
            clearButton.addEventListener('click', () => {
                setNativeValue(input, '');
                syncDate(input);
                closePopover({ restoreFocus: true });
            });
            footer.append(todayButton, clearButton);

            calendar.append(header, weekdays, grid, footer);
            popover.replaceChildren(calendar);
            popover.setAttribute('role', 'dialog');
            popover.setAttribute('aria-label', '选择日期');
            refreshIcons(popover);
            positionPopover(trigger, activePlacement);
            requestAnimationFrame(() => {
                if (popover.hidden || activeTrigger !== trigger) return;
                const selected = popover.querySelector('.ui-calendar-day.is-selected:not(:disabled)');
                const current = popover.querySelector('.ui-calendar-day.is-today:not(:disabled)');
                const navigation = focusTarget === 'previous'
                    ? popover.querySelector('.ui-calendar-nav[aria-label="上个月"]')
                    : focusTarget === 'next'
                        ? popover.querySelector('.ui-calendar-nav[aria-label="下个月"]')
                        : null;
                focusWithoutScroll(
                    navigation
                    || selected
                    || current
                    || popover.querySelector('.ui-calendar-day:not(:disabled)')
                );
            });
        }

        popover.replaceChildren();
        popover.hidden = false;
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', '选择日期');
        activeTrigger = trigger;
        activeControl = input;
        activePlacement = { width: datePickerWidth };
        trigger.setAttribute('aria-expanded', 'true');
        trigger.classList.add('is-open');
        render();
        if (popover.hidden) return;
    }

    function enhanceDate(input) {
        if (!(input instanceof HTMLInputElement) || input.dataset.uiEnhanced) return;
        if (input.type !== 'date' || !input.classList.contains('input-field') || !input.isConnected) return;

        const labels = associatedLabels(input);
        const wrapper = document.createElement('div');
        wrapper.className = 'ui-control ui-date';
        moveClasses(input, wrapper);
        wrapper.dataset.uiControl = 'date';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ui-date-trigger ui-control-trigger';
        trigger.id = input.id ? `${input.id}-trigger` : nextId('ui-date-trigger');
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-expanded', 'false');
        applyAccessibleName(trigger, input, '选择日期');

        const value = document.createElement('span');
        value.className = 'ui-control-value';
        trigger.append(value, icon('calendar-days'));

        input.dataset.uiEnhanced = 'date';
        input.tabIndex = -1;
        input.setAttribute('aria-hidden', 'true');
        input.before(wrapper);
        wrapper.append(input, trigger);
        bindAssociatedLabels(input, trigger, labels);
        trigger.addEventListener('click', () => {
            if (activeTrigger === trigger && !popover.hidden) closePopover({ restoreFocus: true });
            else openDate(input, trigger);
        });
        syncDate(input);
    }

    function syncTime(input) {
        const wrapper = input.closest('.ui-control');
        if (!wrapper) return;
        const trigger = wrapper.querySelector('.ui-time-trigger');
        const value = wrapper.querySelector('.ui-control-value');
        if (!trigger || !value) return;
        value.textContent = input.value || input.getAttribute('data-placeholder') || '选择时间';
        value.classList.toggle('is-placeholder', !input.value);
        trigger.disabled = input.disabled;
        wrapper.classList.toggle('is-disabled', input.disabled);
    }

    // Three identical cycles keep the wheel seamless; only the middle cycle is exposed to assistive tech.
    function createTimeWheel(values, initialValue, label, key, onValueChange) {
        const copyCount = 3;
        const middleCopy = 1;
        const valueCount = values.length;
        const totalOptions = valueCount * copyCount;
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const wheel = document.createElement('div');
        wheel.className = 'ui-time-wheel';
        const list = document.createElement('div');
        list.className = 'ui-time-list';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', label);
        list.setAttribute('aria-orientation', 'vertical');
        list.tabIndex = 0;

        const buttons = [];
        let value = Math.max(0, Math.min(valueCount - 1, Number(initialValue) || 0));
        let activeIndex = valueCount + value;
        let scrollFrame = 0;
        let settleTimer = 0;
        let destroyed = false;

        function optionStep() {
            return buttons[0]?.offsetHeight || 40;
        }

        function cycleHeight() {
            return optionStep() * valueCount;
        }

        function paint(nextValue) {
            value = nextValue;
            buttons.forEach((button, index) => {
                const selected = Number(button.dataset.value) === value;
                button.classList.toggle('is-selected', selected);
                if (index >= valueCount && index < valueCount * 2) {
                    button.setAttribute('aria-selected', String(selected));
                }
            });
            const accessibleOption = buttons[valueCount + value];
            if (accessibleOption) {
                list.setAttribute('aria-activedescendant', accessibleOption.id);
                onValueChange(value);
            }
        }

        function applyIndex(nextIndex) {
            activeIndex = Math.max(0, Math.min(totalOptions - 1, nextIndex));
            paint(values[activeIndex % valueCount]);
        }

        function scrollToIndex(nextIndex, behavior) {
            const clamped = Math.max(0, Math.min(totalOptions - 1, nextIndex));
            list.scrollTo({
                top: clamped * optionStep(),
                behavior: behavior === 'smooth' && !reducedMotion.matches ? 'smooth' : 'auto',
            });
        }

        function centerActive(smooth) {
            scrollToIndex(activeIndex, smooth ? 'smooth' : 'auto');
        }

        function normalizeToMiddleCycle() {
            const height = cycleHeight();
            if (!height) return false;
            if (list.scrollTop < height) {
                list.scrollTop += height;
                return true;
            }
            if (list.scrollTop >= height * 2) {
                list.scrollTop -= height;
                return true;
            }
            return false;
        }

        function selectIndex(nextIndex, smooth) {
            applyIndex(nextIndex);
            scrollToIndex(nextIndex, smooth ? 'smooth' : 'auto');
            focusWithoutScroll(list);
        }

        function stepSelection(delta) {
            const nextIndex = activeIndex + delta;
            selectIndex(nextIndex, true);
        }

        function handleScroll() {
            if (scrollFrame) return;
            scrollFrame = requestAnimationFrame(() => {
                scrollFrame = 0;
                if (destroyed) return;
                const nextIndex = Math.round(list.scrollTop / optionStep());
                applyIndex(nextIndex);
                window.clearTimeout(settleTimer);
                settleTimer = window.setTimeout(() => {
                    if (destroyed) return;
                    normalizeToMiddleCycle();
                    const settledIndex = Math.round(list.scrollTop / optionStep());
                    applyIndex(settledIndex);
                    if (Math.abs(list.scrollTop - settledIndex * optionStep()) > 0.5) {
                        scrollToIndex(settledIndex, 'smooth');
                    }
                }, 120);
            });
        }

        for (let copy = 0; copy < copyCount; copy += 1) {
            values.forEach((optionValue, valueIndex) => {
                const index = copy * valueCount + valueIndex;
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'ui-time-option';
                button.dataset.value = String(optionValue);
                button.setAttribute('role', 'option');
                button.setAttribute('aria-label', `${label} ${pad(optionValue)}`);
                button.tabIndex = -1;
                if (copy !== middleCopy) {
                    button.setAttribute('aria-hidden', 'true');
                } else {
                    button.id = nextId(`ui-time-${key}-option`);
                    button.setAttribute('aria-posinset', String(valueIndex + 1));
                    button.setAttribute('aria-setsize', String(valueCount));
                }
                button.textContent = pad(optionValue);
                button.addEventListener('click', () => {
                    selectIndex(index, true);
                });
                buttons.push(button);
                list.appendChild(button);
            });
        }

        list.addEventListener('scroll', handleScroll, { passive: true });
        list.addEventListener('keydown', event => {
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                stepSelection(-1);
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                stepSelection(1);
            } else if (event.key === 'PageUp') {
                event.preventDefault();
                stepSelection(-5);
            } else if (event.key === 'PageDown') {
                event.preventDefault();
                stepSelection(5);
            } else if (event.key === 'Home') {
                event.preventDefault();
                selectIndex(valueCount, true);
            } else if (event.key === 'End') {
                event.preventDefault();
                selectIndex(valueCount * 2 - 1, true);
            }
        });

        paint(value);
        wheel.appendChild(list);

        return {
            element: wheel,
            focusTarget: list,
            getValue: () => value,
            center: () => centerActive(false),
            destroy() {
                destroyed = true;
                window.clearTimeout(settleTimer);
                if (scrollFrame) cancelAnimationFrame(scrollFrame);
            },
        };
    }

    function openTime(input, trigger) {
        const match = /^(\d{2}):(\d{2})/.exec(input.value || '');
        let hour = match ? Number(match[1]) : new Date().getHours();
        let minute = match ? Number(match[2]) : new Date().getMinutes();

        const picker = document.createElement('div');
        picker.className = 'ui-time-picker';
        const title = document.createElement('div');
        title.className = 'ui-time-title';
        title.textContent = '选择时间';
        const columns = document.createElement('div');
        columns.className = 'ui-time-columns';
        const hours = Array.from({ length: 24 }, (_, value) => value);
        const minutes = Array.from({ length: 60 }, (_, value) => value);
        const hourWheel = createTimeWheel(hours, hour, '小时', 'hour', value => {
            hour = value;
        });
        const minuteWheel = createTimeWheel(minutes, minute, '分钟', 'minute', value => {
            minute = value;
        });
        columns.append(hourWheel.element, minuteWheel.element);

        const footer = document.createElement('div');
        footer.className = 'ui-time-footer';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'ui-calendar-action';
        cancel.textContent = '取消';
        cancel.addEventListener('click', () => closePopover({ restoreFocus: true }));
        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = 'ui-calendar-action';
        confirm.textContent = '确定';
        confirm.addEventListener('click', () => {
            setNativeValue(input, `${pad(hourWheel.getValue())}:${pad(minuteWheel.getValue())}`);
            syncTime(input);
            closePopover({ restoreFocus: true });
        });
        footer.append(cancel, confirm);
        picker.append(title, columns, footer);

        openPopover(trigger, input, picker, {
            minimumWidth: 276,
            role: 'dialog',
            focusTarget: hourWheel.focusTarget,
            onClose() {
                hourWheel.destroy();
                minuteWheel.destroy();
            },
        });
        requestAnimationFrame(() => {
            hourWheel.center();
            minuteWheel.center();
        });
    }

    function enhanceTime(input) {
        if (!(input instanceof HTMLInputElement) || input.dataset.uiEnhanced) return;
        if (input.type !== 'time' || !input.classList.contains('input-field') || !input.isConnected) return;

        const labels = associatedLabels(input);
        const wrapper = document.createElement('div');
        wrapper.className = 'ui-control ui-time';
        moveClasses(input, wrapper);
        wrapper.dataset.uiControl = 'time';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ui-time-trigger ui-control-trigger';
        trigger.id = input.id ? `${input.id}-trigger` : nextId('ui-time-trigger');
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-expanded', 'false');
        applyAccessibleName(trigger, input, '选择时间');

        const value = document.createElement('span');
        value.className = 'ui-control-value';
        trigger.append(value, icon('clock-3'));

        input.dataset.uiEnhanced = 'time';
        input.tabIndex = -1;
        input.setAttribute('aria-hidden', 'true');
        input.before(wrapper);
        wrapper.append(input, trigger);
        bindAssociatedLabels(input, trigger, labels);
        trigger.addEventListener('click', () => {
            if (activeTrigger === trigger && !popover.hidden) closePopover({ restoreFocus: true });
            else openTime(input, trigger);
        });
        syncTime(input);
    }

    function syncFile(input) {
        const wrapper = input.closest('.ui-control');
        if (!wrapper) return;
        const trigger = wrapper.querySelector('.ui-file-trigger');
        const value = wrapper.querySelector('.ui-file-name');
        if (!trigger || !value) return;
        const file = input.files && input.files[0];
        value.textContent = file ? file.name : input.getAttribute('data-placeholder') || '选择文件';
        value.classList.toggle('is-placeholder', !file);
        trigger.disabled = input.disabled;
        wrapper.classList.toggle('is-disabled', input.disabled);
    }

    function enhanceFile(input) {
        if (!(input instanceof HTMLInputElement) || input.dataset.uiEnhanced) return;
        if (input.type !== 'file' || !input.classList.contains('input-field') || !input.isConnected) return;

        const labels = associatedLabels(input);
        const wrapper = document.createElement('div');
        wrapper.className = 'ui-control ui-file';
        moveClasses(input, wrapper);
        wrapper.dataset.uiControl = 'file';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ui-file-trigger ui-control-trigger';
        trigger.id = input.id ? `${input.id}-trigger` : nextId('ui-file-trigger');
        applyAccessibleName(trigger, input, '选择文件');

        const value = document.createElement('span');
        value.className = 'ui-file-name';
        const action = document.createElement('span');
        action.className = 'ui-file-action';
        action.textContent = '浏览';
        trigger.append(value, action);

        input.dataset.uiEnhanced = 'file';
        input.tabIndex = -1;
        input.setAttribute('aria-hidden', 'true');
        input.before(wrapper);
        wrapper.append(input, trigger);
        bindAssociatedLabels(input, trigger, labels);
        trigger.addEventListener('click', () => input.click());
        input.addEventListener('change', () => syncFile(input));
        syncFile(input);
    }

    function enhanceTree(root) {
        if (!root || !root.querySelectorAll) return;
        if (root.matches?.('select:not([data-ui-enhanced])')) enhanceSelect(root);
        if (root.matches?.('input[type="date"].input-field:not([data-ui-enhanced])')) enhanceDate(root);
        if (root.matches?.('input[type="time"].input-field:not([data-ui-enhanced])')) enhanceTime(root);
        if (root.matches?.('input[type="file"].input-field:not([data-ui-enhanced])')) enhanceFile(root);
        root.querySelectorAll('select:not([data-ui-enhanced])').forEach(enhanceSelect);
        root.querySelectorAll('input[type="date"].input-field:not([data-ui-enhanced])').forEach(enhanceDate);
        root.querySelectorAll('input[type="time"].input-field:not([data-ui-enhanced])').forEach(enhanceTime);
        root.querySelectorAll('input[type="file"].input-field:not([data-ui-enhanced])').forEach(enhanceFile);
    }

    const observer = new MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'childList') {
                record.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) enhanceTree(node);
                    if (node.nodeType === Node.ELEMENT_NODE && node.matches?.('select[data-ui-enhanced="select"]')) queueRefresh(node);
                });
                const select = record.target.closest?.('select[data-ui-enhanced="select"]');
                if (select) queueRefresh(select);
            } else if (record.type === 'attributes') {
                const control = record.target;
                if (control.matches?.('select, input[type="date"], input[type="time"], input[type="file"]')) {
                    queueRefresh(control);
                }
            }
        }
    });

    document.addEventListener('pointerdown', event => {
        if (popover.hidden) return;
        if (popover.contains(event.target) || (activeTrigger && activeTrigger.contains(event.target))) return;
        closePopover();
    }, true);

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !popover.hidden) {
            event.preventDefault();
            closePopover({ restoreFocus: true });
        }
    });

    window.addEventListener('resize', schedulePopoverReposition);
    window.addEventListener('scroll', event => {
        if (popover.contains(event.target)) return;
        schedulePopoverReposition();
    }, true);
    document.addEventListener('reset', event => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        requestAnimationFrame(() => {
            form.querySelectorAll('[data-ui-enhanced]').forEach(queueRefresh);
        });
    });

    function init() {
        enhanceTree(document);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['disabled', 'value', 'selected'],
        });
        refreshIcons();
    }

    window.ThemeControls = {
        close: closePopover,
        refresh: queueRefresh,
        setValue: setNativeValue,
        enhance: enhanceTree,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
