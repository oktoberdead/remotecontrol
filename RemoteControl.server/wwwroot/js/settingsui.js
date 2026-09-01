// ============================================================================
// settingsui.js — вкладка Settings: менеджер вкладок (создание / удаление /
// переименование / порядок / скрытие / дропдаун / вход в редактор) и
// глобальные настройки Mouse/Stream.
// ============================================================================

// ==================== TABS MANAGER ====================

function tabTitle(id) {
    if (uiCfg.pages && uiCfg.pages[id]) return uiCfg.pages[id].title || id;
    return SPECIAL_TABS[id] || id;
}

function tabEditable(id) {
    return isPageTab(id) || id === 'game' || id === 'stream';
}

function startTabEdit(id) {
    if (isPageTab(id)) enterPageEdit(id);
    else if (id === 'game') enterEditMode();
    else if (id === 'stream') enterStreamEdit();
    else toast('This tab is not editable');
}

function renderTabsManager() {
    const box = $('#tabs-manager');
    if (!box) return;
    box.innerHTML = '';
    const order = uiCfg.tabOrder || [];

    // settings не показываем: её нельзя двигать/прятать/удалять
    const ids = order.filter(id => isPageTab(id) || (SPECIAL_TABS[id] && id !== 'settings'));

    ids.forEach(id => {
        const tc = uiCfg.tabs[id] || (uiCfg.tabs[id] = {});
        const row = document.createElement('div');
        row.className = 'settings-row tabman-row';
        row.dataset.tabId = id;

        // ⠿ — хэндл перетаскивания (порядок вкладок)
        const grip = document.createElement('span');
        grip.className = 'tabman-grip';
        grip.textContent = '⠿';
        initTabDrag(grip, row, id);

        const label = document.createElement('span');
        label.className = 'tabman-name';
        label.textContent = tabTitle(id);

        row.append(grip, label);

        if (tc.visible === false) {
            const mark = document.createElement('span');
            mark.className = 'tabman-hidden-mark';
            mark.textContent = 'hidden';
            row.appendChild(mark);
        } else if (tc.inDropdown) {
            const mark = document.createElement('span');
            mark.className = 'tabman-hidden-mark';
            mark.textContent = '⋯';
            row.appendChild(mark);
        }

        // ✏️ — всё управление вкладкой в модалке (ничего не уезжает за экран)
        const edit = document.createElement('button');
        edit.className = 'btn btn-sm btn-warning';
        edit.textContent = '✏️';
        edit.onclick = () => openTabModal(id);
        row.appendChild(edit);

        box.appendChild(row);
    });
}

// ---------- drag-reorder за хэндл ----------
function initTabDrag(grip, row, id) {
    grip.addEventListener('pointerdown', e => {
        e.preventDefault();
        grip.setPointerCapture(e.pointerId);
        const box = row.parentElement;
        const startY = e.clientY;
        row.classList.add('dragging');

        const move = ev => {
            row.style.transform = `translateY(${ev.clientY - startY}px)`;
            const rows = [...box.querySelectorAll('.tabman-row')];
            const myRect = row.getBoundingClientRect();
            const myMid = myRect.top + myRect.height / 2;
            for (const other of rows) {
                if (other === row) continue;
                const r = other.getBoundingClientRect();
                if (myMid > r.top && myMid < r.bottom) {
                    // поменять местами в DOM (transform пересчитается от новой базы)
                    const after = myRect.top < r.top;
                    box.insertBefore(row, after ? other.nextSibling : other);
                    row.style.transform = '';
                    // и в конфиге
                    const a = uiCfg.tabOrder.indexOf(id);
                    const b = uiCfg.tabOrder.indexOf(other.dataset.tabId);
                    if (a >= 0 && b >= 0) {
                        uiCfg.tabOrder.splice(a, 1);
                        uiCfg.tabOrder.splice(b, 0, id);
                    }
                    break;
                }
            }
        };
        const up = () => {
            grip.removeEventListener('pointermove', move);
            grip.removeEventListener('pointerup', up);
            grip.removeEventListener('pointercancel', up);
            row.classList.remove('dragging');
            row.style.transform = '';
            saveUiConfigSoon();
            renderTabs();
        };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', up);
        grip.addEventListener('pointercancel', up);
    });
}

// ---------- модалка вкладки: rename / edit / hide / dropdown / delete ----------
function openTabModal(id) {
    const body = $('#element-editor-body');
    const title = $('#element-editor-title');
    if (!body) return;
    const tc = uiCfg.tabs[id] || (uiCfg.tabs[id] = {});
    title.textContent = 'Tab: ' + tabTitle(id);
    body.innerHTML = '';

    if (isPageTab(id)) {
        ekRow(body, 'Name', ekText(uiCfg.pages[id].title || id, v => {
            uiCfg.pages[id].title = v.trim() || id;
            saveUiConfigSoon();
            renderTabs();
            renderTabsManager();
            title.textContent = 'Tab: ' + tabTitle(id);
        }));
    }

    const actions = document.createElement('div');
    actions.className = 'tabman-modal-actions';

    const mk = (txt, cls, fn) => {
        const b = document.createElement('button');
        b.className = 'btn btn-wide ' + cls;
        b.textContent = txt;
        b.onclick = fn;
        actions.appendChild(b);
        return b;
    };

    if (tabEditable(id)) {
        mk('✏️ Edit layout', 'btn-warning', () => {
            hideModal('element-editor-overlay');
            startTabEdit(id);
        });
    }

    mk(tc.visible === false ? '👁 Show tab' : '🙈 Hide tab', 'btn-dark', function () {
        tc.visible = tc.visible === false ? true : false;
        this.textContent = tc.visible === false ? '👁 Show tab' : '🙈 Hide tab';
        persistTabs();
    });

    mk(tc.inDropdown ? '📌 Move to bar' : '⋯ Move to dropdown', 'btn-dark', function () {
        tc.inDropdown = !tc.inDropdown;
        this.textContent = tc.inDropdown ? '📌 Move to bar' : '⋯ Move to dropdown';
        persistTabs();
    });

    if (isPageTab(id)) {
        mk('🗑 Delete tab', 'btn-danger', async () => {
            if (!await rcConfirm(`Delete tab "${tabTitle(id)}" со всем содержимым?`)) return;
            hideModal('element-editor-overlay');
            delete uiCfg.pages[id];
            uiCfg.tabOrder = uiCfg.tabOrder.filter(x => x !== id);
            delete uiCfg.tabs[id];
            if (currentTab === id) switchToTab('settings');
            saveUiConfig();
            renderAllPages();
            renderTabs();
            renderTabsManager();
        });
    }

    body.appendChild(actions);
    showModal('element-editor-overlay');
}

function persistTabs() {
    saveUiConfig().then(() => {
        renderTabs();
        renderTabsManager();
    });
}

$('#btn-tab-add')?.addEventListener('click', () => {
    const inp = $('#tab-new-name');
    const name = (inp?.value || '').trim() || 'New tab';
    const id = 'p_' + uid();
    uiCfg.pages[id] = { title: name, sections: [{ id: uid(), title: 'Section', h: 200, elements: [] }] };
    // новая вкладка — перед stream/game (в конец «страничной» зоны)
    const order = uiCfg.tabOrder;
    const at = order.findIndex(x => x === 'stream' || x === 'game');
    order.splice(at < 0 ? order.length : at, 0, id);
    if (inp) inp.value = '';
    saveUiConfig();
    renderAllPages();
    renderTabs();
    renderTabsManager();
    toast('Tab added: ' + name);
});

// вернуть недостающие дефолтные вкладки (main/monitor/mouse/keys)
$('#btn-tabs-restore')?.addEventListener('click', () => {
    const defs = defaultPages();
    let added = 0;
    Object.keys(defs).forEach(id => {
        if (!uiCfg.pages[id]) {
            uiCfg.pages[id] = defs[id];
            if (!uiCfg.tabOrder.includes(id)) uiCfg.tabOrder.unshift(id);
            added++;
        }
    });
    if (!added) { toast('All default tabs are present'); return; }
    saveUiConfig();
    renderAllPages();
    renderTabs();
    renderTabsManager();
    toast('Restored: ' + added);
});

// ==================== MOUSE / STREAM SETTINGS ====================

function applyPadEdgeSize() {
    const s = uiCfg.settings;
    document.querySelectorAll('.touchpad .pad-edge-zone').forEach(z => {
        z.style.setProperty('--edge-size', (s.edgeSize || 10) + '%');
        z.style.display = s.edgeEnabled === false ? 'none' : '';
    });
}

function renderStreamSettings() {
    const s = uiCfg.settings;
    const bindRange = (id, valId, value, fmt, onChange) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = value;
        document.getElementById(valId).textContent = fmt(value);
        el.oninput = () => {
            const v = parseInt(el.value);
            document.getElementById(valId).textContent = fmt(v);
            onChange(v);
            saveUiConfigSoon();
        };
    };
    bindRange('set-mouse-sens', 'set-mouse-sens-val', s.mouseSens, v => (v / 10).toFixed(1) + 'x', v => { s.mouseSens = v; });
    bindRange('set-stream-sens', 'set-stream-sens-val', s.streamSens, v => (v / 10).toFixed(1) + 'x', v => { s.streamSens = v; });
    bindRange('set-edge-size', 'set-edge-size-val', s.edgeSize, v => v + '%', v => { s.edgeSize = v; applyPadEdgeSize(); });
    bindRange('set-edge-speed', 'set-edge-speed-val', s.edgeSpeed, v => String(v), v => { s.edgeSpeed = v; });
    const cb = $('#set-edge-on');
    if (cb) {
        cb.checked = s.edgeEnabled !== false;
        cb.onchange = () => { s.edgeEnabled = cb.checked; applyPadEdgeSize(); saveUiConfig(); };
    }
}

function renderSettingsAll() {
    renderTabsManager();
    renderStreamSettings();
}

uiReadyHooks.push(() => {
    renderSettingsAll();
    applyPadEdgeSize();
});
