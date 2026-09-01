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

    const allIds = [...order.filter(id => isPageTab(id) || SPECIAL_TABS[id]), 'settings'];

    allIds.forEach(id => {
        const tc = uiCfg.tabs[id] || (uiCfg.tabs[id] = {});
        const row = document.createElement('div');
        row.className = 'settings-row tabman-row';

        const label = document.createElement('span');
        label.className = 'tabman-name';
        label.textContent = tabTitle(id);
        if (isPageTab(id)) {
            label.title = 'Tap to rename';
            label.onclick = () => {
                const inp = document.createElement('input');
                inp.type = 'text';
                inp.className = 'cfg-mini';
                inp.value = uiCfg.pages[id].title || id;
                row.replaceChild(inp, label);
                inp.focus();
                const commit = () => {
                    uiCfg.pages[id].title = inp.value.trim() || id;
                    saveUiConfigSoon();
                    renderTabs();
                    renderTabsManager();
                };
                inp.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
                inp.addEventListener('blur', commit);
            };
        }

        const mkBtn = (txt, cls, fn, disabled) => {
            const b = document.createElement('button');
            b.className = 'btn btn-sm ' + cls;
            b.textContent = txt;
            if (disabled) b.disabled = true;
            else b.onclick = fn;
            row.appendChild(b);
            return b;
        };

        row.appendChild(label);

        // Edit
        mkBtn('✏️', tabEditable(id) ? 'btn-warning' : 'btn-dark', () => startTabEdit(id), !tabEditable(id));

        // Hide / Show (settings прятать нельзя — потеряешь доступ к настройкам)
        mkBtn(tc.visible === false ? 'Show' : 'Hide', tc.visible === false ? 'btn-warning' : 'btn-dark',
            () => { tc.visible = tc.visible === false ? true : false; persistTabs(); }, id === 'settings');

        // Bar / dropdown
        mkBtn(tc.inDropdown ? '⋯' : 'Bar', tc.inDropdown ? 'btn-primary' : 'btn-dark',
            () => { tc.inDropdown = !tc.inDropdown; persistTabs(); });

        // порядок (settings всегда последняя, не двигается)
        const idx = order.indexOf(id);
        mkBtn('↑', 'btn-dark', () => {
            if (idx > 0) {
                order.splice(idx, 1);
                order.splice(idx - 1, 0, id);
                persistTabs();
            }
        }, id === 'settings' || idx <= 0);
        mkBtn('↓', 'btn-dark', () => {
            if (idx >= 0 && idx < order.length - 1) {
                order.splice(idx, 1);
                order.splice(idx + 1, 0, id);
                persistTabs();
            }
        }, id === 'settings' || idx < 0 || idx >= order.length - 1);

        // удаление — только страницы (game/stream/settings — кодовые)
        mkBtn('✕', 'btn-danger', () => {
            if (!confirm(`Delete tab "${tabTitle(id)}" со всем содержимым?`)) return;
            delete uiCfg.pages[id];
            uiCfg.tabOrder = order.filter(x => x !== id);
            delete uiCfg.tabs[id];
            if (currentTab === id) switchToTab('settings');
            saveUiConfig();
            renderAllPages();
            renderTabs();
            renderTabsManager();
        }, !isPageTab(id));

        box.appendChild(row);
    });
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
