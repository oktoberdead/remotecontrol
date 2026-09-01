// ============================================================================
// widgets.js — кастомные элементы на вкладках main/monitor/mouse/keys
// (+ вьюпорт-виджет) и вкладка Settings (tabs / mouse-stream / widget editor)
// ============================================================================
// ==================== WIDGETS ====================
const WIDGET_TABS = ['main', 'monitor', 'mouse', 'keys'];

function actionFor(w) {
    if (!w.action) return null;
    if (w.action.startsWith('/api/')) return { kind: 'api', path: w.action };
    if (w.action.includes('+')) return { kind: 'combo', keys: w.action.split('+').map(s => s.trim()).filter(Boolean) };
    return { kind: 'key', key: w.action };
}

function fireAction(a) {
    if (!a) return;
    if (a.kind === 'api') fire('POST', a.path);
    else if (a.kind === 'combo') fire('POST', '/api/combo', { keys: a.keys, delay: 25 });
    else keyPress(a.key);
}

function newWidget(type) {
    const base = { id: Math.random().toString(36).substring(2, 10), type, label: '', x: 5, y: 5, w: 30, h: 15 };
    switch (type) {
        case 'button': Object.assign(base, { action: 'enter', pressMode: 'click', repeatCount: 3, repeatInterval: 80, color: 'btn-primary' }); break;
        case 'touchpad': Object.assign(base, { axes: 2, edgeZone: true, sensitivity: 0, w: 35, h: 35 }); break;
        case 'sequence': Object.assign(base, { steps: [{ kind: 'key', value: 'f5', delay: 100 }] }); break;
        case 'slider': Object.assign(base, { binding: 'volume', min: 0, max: 100 }); break;
        case 'toggle': Object.assign(base, { binding: 'power' }); break;
        case 'input': Object.assign(base, { label: 'Text', h: 12 }); break;
        case 'viewport': Object.assign(base, { w: 60, h: 40, vp: vpDefaults() }); break;
    }
    return base;
}

function createWidgetEl(w, isPreview, tab) {
    const el = document.createElement('div');
    el.className = 'widget widget-' + w.type;
    el.style.left = w.x + '%';
    el.style.top = w.y + '%';
    el.style.width = w.w + '%';
    el.style.height = w.h + '%';
    el.dataset.wid = w.id;

    switch (w.type) {
        case 'button':
        case 'sequence': {
            el.classList.add('btn', w.color || 'btn-primary');
            el.textContent = w.label || (w.type === 'sequence' ? '▶ Seq' : w.action || 'Btn');
            if (!isPreview) initWidgetBehavior(w, el);
            break;
        }
        case 'touchpad': {
            el.classList.add('widget-touchpad');
            el.textContent = (w.axes === 1 ? 'Scroll' : 'Pad') + (w.edgeZone === false ? '' : ' · edge');
            if (!isPreview) initTouchpadWidget(w, el);
            break;
        }
        case 'slider': {
            el.classList.add('widget-slider');
            el.innerHTML = `<span class="widget-val">${w.label || w.binding}</span><input type="range" min="${w.min ?? 0}" max="${w.max ?? 100}" step="1">`;
            if (!isPreview) initSliderWidget(w, el);
            break;
        }
        case 'toggle': {
            el.classList.add('btn', 'btn-dark', 'widget-toggle');
            el.textContent = w.label || w.binding || 'toggle';
            if (!isPreview) initToggleWidget(w, el);
            break;
        }
        case 'input': {
            el.classList.add('widget-input');
            el.innerHTML = `<input placeholder="${w.label || 'Text'}" ${isPreview ? 'readonly' : ''}>`;
            if (!isPreview) initInputWidget(el);
            break;
        }
        case 'viewport': {
            // живой стрим как виджет любой вкладки (см. viewport.js)
            if (isPreview) {
                el.classList.add('widget-viewport-preview');
                el.textContent = '🖥 viewport';
                el.style.background = '#000';
                el.style.border = '1px solid rgba(67,97,238,.35)';
                el.style.borderRadius = '10px';
                el.style.display = 'flex';
                el.style.alignItems = 'center';
                el.style.justifyContent = 'center';
                el.style.color = '#555';
                el.style.fontSize = '11px';
            } else {
                const inst = createViewport(w, { withGear: true });
                inst.root.classList.add('widget');
                inst.root.style.left = w.x + '%';
                inst.root.style.top = w.y + '%';
                inst.root.style.width = w.w + '%';
                inst.root.style.height = w.h + '%';
                inst.root.dataset.wid = w.id;
                widgetVpInstances.set(w.id, { inst, tab });
                return inst.root;
            }
            break;
        }
    }
    return el;
}

// Вьюпорт-виджеты: id -> { inst, tab }; активны только на текущей видимой вкладке
const widgetVpInstances = new Map();

function syncWidgetViewports() {
    for (const { inst, tab } of widgetVpInstances.values()) {
        if (tab === currentTab && !document.hidden) inst.activate();
        else inst.deactivate();
    }
}

tabEnterHooks.push(() => syncWidgetViewports());
document.addEventListener('visibilitychange', syncWidgetViewports);

function renderCustomWidgets() {
    for (const { inst } of widgetVpInstances.values()) inst.deactivate();
    widgetVpInstances.clear();

    WIDGET_TABS.forEach(tab => {
        const area = document.getElementById('custom-area-' + tab);
        if (!area) return;
        area.innerHTML = '';
        (uiCfg.widgets[tab] || []).forEach(w => {
            area.appendChild(createWidgetEl(w, false, tab));
        });
    });
    renderWidgetPreview();
    syncWidgetViewports();
}

// --- поведения виджетов ---
function initWidgetBehavior(w, el) {
    const a = actionFor(w);

    if (w.type === 'sequence') {
        el.addEventListener('click', () => runSequence(w));
        return;
    }

    if (w.pressMode === 'hold') {
        el.addEventListener('pointerdown', () => {
            if (a && a.kind === 'key') keyDown(a.key);
            el.classList.add('btn-on');
        });
        const up = () => {
            if (a && a.kind === 'key') keyUp(a.key);
            el.classList.remove('btn-on');
        };
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
    } else if (w.pressMode === 'repeat') {
        el.addEventListener('click', () => {
            const n = w.repeatCount || 3, iv = w.repeatInterval || 80;
            for (let i = 0; i < n; i++) setTimeout(() => fireAction(a), i * iv);
        });
    } else {
        el.addEventListener('click', () => fireAction(a));
    }
}

function runSequence(w) {
    let t = 0;
    (w.steps || []).forEach(s => {
        setTimeout(() => {
            if (s.kind === 'key') fireAction({ kind: 'key', key: s.value });
            else if (s.kind === 'combo') fireAction({ kind: 'combo', keys: s.value.split('+').map(x => x.trim()).filter(Boolean) });
            else if (s.kind === 'type') apiS('POST', '/api/type', { text: s.value });
            // pause — ничего
        }, t);
        t += s.delay || 50;
    });
}

function initTouchpadWidget(w, el) {
    let pid = null, lastX = 0, lastY = 0;
    let edgeTimer = null, edgeEx = 0, edgeEy = 0;
    const stopEdge = () => { if (edgeTimer) { clearInterval(edgeTimer); edgeTimer = null; } el.classList.remove('edge-active'); };

    el.addEventListener('pointerdown', e => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        pid = e.pointerId;
        lastX = e.clientX;
        lastY = e.clientY;
    });

    el.addEventListener('pointermove', e => {
        if (pid !== e.pointerId) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;

        const st = uiCfg.settings;
        if (w.edge !== false && st.edgeEnabled) {
            const r = el.getBoundingClientRect();
            if (r.width && r.height) {
                const nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
                const edge = (st.edgeSize || 10) / 100;
                const sp = st.edgeSpeed || 30;
                let ex = 0, ey = 0;
                if (nx < edge) ex = -sp; else if (nx > 1 - edge) ex = sp;
                if (ny < edge) ey = -sp; else if (ny > 1 - edge) ey = sp;
                if (ex || ey) {
                    if (ex !== edgeEx || ey !== edgeEy || !edgeTimer) {
                        edgeEx = ex; edgeEy = ey;
                        if (edgeTimer) clearInterval(edgeTimer);
                        edgeTimer = setInterval(() => mouseMove(edgeEx, edgeEy), 16);
                        el.classList.add('edge-active');
                    }
                    return;
                }
            }
            stopEdge();
        }

        if (w.axes === 1) {
            if (dy) mouseWheel(Math.round(-dy * 3));
        } else {
            const sens = (w.sensitivity || uiCfg.settings.mouseSens || 18) / 10;
            const mx = Math.round(dx * sens), my = Math.round(dy * sens);
            if (mx || my) mouseMove(mx, my);
        }
    });

    const up = e => { if (pid === e.pointerId) { pid = null; stopEdge(); } };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
}

function initSliderWidget(w, el) {
    const range = el.querySelector('input[type=range]');
    const val = el.querySelector('.widget-val');
    let t = null;
    range.oninput = () => {
        val.textContent = w.label ? `${w.label}: ${range.value}` : range.value;
        clearTimeout(t);
        t = setTimeout(() => sliderApply(w, parseInt(range.value)), 150);
    };
    sliderRefresh(w, el);
}

async function sliderApply(w, v) {
    if (w.binding === 'volume') await apiS('POST', '/api/volume/set', { level: v });
    else if (w.binding === 'brightness') await apiS('POST', '/api/monitor/brightness', { level: v });
    else if (w.binding === 'zoom') await apiS('POST', '/api/screen/zoom', { action: 'set', level: v });
    else if (w.binding === 'fps') await apiS('POST', '/api/screen/fps', { fps: v });
}

async function sliderRefresh(w, el) {
    let v = null;
    if (w.binding === 'volume') { const d = await apiS('GET', '/api/volume'); v = d ? d.volume : null; }
    else if (w.binding === 'brightness') { const d = await apiS('GET', '/api/monitor/state'); v = d ? d.brightness : null; }
    if (v != null && el.isConnected) {
        el.querySelector('input[type=range]').value = v;
        const val = el.querySelector('.widget-val');
        if (val) val.textContent = w.label ? `${w.label}: ${v}` : v;
    }
}

function refreshWidgetSliders() {
    const area = document.getElementById('custom-area-' + currentTab);
    if (!area) return;
    (uiCfg.widgets[currentTab] || []).forEach(w => {
        if (w.type !== 'slider') return;
        const el = area.querySelector(`.widget[data-wid="${w.id}"]`);
        if (el) sliderRefresh(w, el);
    });
}

function initToggleWidget(w, el) {
    const upd = async () => {
        let on = false;
        if (w.binding === 'power') { const d = await apiS('GET', '/api/monitor/state'); on = d ? d.powerOn === true : false; }
        else if (w.binding === 'wg') { const d = await apiS('GET', '/api/wg/status'); on = d ? d.status === 'Running' : false; }
        if (el.isConnected) {
            el.classList.toggle('btn-on', on);
            el.textContent = (w.label || w.binding || 'toggle') + (on ? ' ●' : ' ○');
        }
    };
    upd();
    el.addEventListener('click', async () => {
        if (w.binding === 'power') await apiS('POST', '/api/monitor/power', { action: 'toggle' });
        else if (w.binding === 'wg') await apiS('POST', '/api/wg/toggle');
        setTimeout(upd, 800);
    });
}

function initInputWidget(el) {
    const inp = el.querySelector('input');
    const send = () => {
        const v = inp.value.trim();
        if (v) { apiS('POST', '/api/type', { text: v }); inp.value = ''; }
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    inp.addEventListener('blur', send);
}

// ==================== WIDGET EDITOR (settings tab) ====================
let widgetEditTab = 'main';
let selectedWidgetId = null;

function currentWidgets() {
    return uiCfg.widgets[widgetEditTab] || (uiCfg.widgets[widgetEditTab] = []);
}

function renderSettingsAll() {
    renderTabsRows();
    renderStreamSettings();
    renderWidgetEditor();
}

function renderTabsRows() {
    const rows = $('#tabs-rows');
    if (!rows) return;
    rows.innerHTML = '';
    allTabDefs().forEach(t => {
        const tc = uiCfg.tabs[t.id] || (uiCfg.tabs[t.id] = {});
        const row = document.createElement('div');
        row.className = 'settings-row';

        const label = document.createElement('span');
        label.textContent = t.label;

        const bHide = document.createElement('button');
        bHide.className = 'btn btn-sm ' + (tc.visible === false ? 'btn-warning' : 'btn-dark');
        bHide.textContent = tc.visible === false ? 'Show' : 'Hide';
        bHide.onclick = () => { tc.visible = tc.visible === false ? true : false; persistTabs(); };

        const bDrop = document.createElement('button');
        bDrop.className = 'btn btn-sm ' + (tc.inDropdown ? 'btn-primary' : 'btn-dark');
        bDrop.textContent = tc.inDropdown ? '⋯' : 'Bar';
        bDrop.onclick = () => { tc.inDropdown = !tc.inDropdown; persistTabs(); };

        row.append(label, bHide, bDrop);
        rows.appendChild(row);
    });
}

function persistTabs() {
    saveUiConfig().then(() => { renderTabs(); renderTabsRows(); });
}

function applyPadEdgeSize() {
    const s = uiCfg.settings;
    document.querySelectorAll('.touchpad .pad-edge-zone').forEach(z => {
        z.style.setProperty('--edge-size', (s.edgeSize || 10) + '%');
        // фикс: при выключенных edge-зонах визуал зоны не рисуем
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

function renderWidgetEditor() {
    const sel = $('#widget-tab-sel');
    if (!sel) return;
    WIDGET_TABS.forEach(t => { if (!uiCfg.widgets[t]) uiCfg.widgets[t] = []; });
    if (!sel.dataset.init) {
        sel.innerHTML = WIDGET_TABS.map(t => `<option value="${t}">${t}</option>`).join('');
        sel.onchange = () => {
            widgetEditTab = sel.value;
            selectedWidgetId = null;
            renderWidgetPreview();
            renderWidgetForm();
        };
        sel.dataset.init = '1';
    }
    renderWidgetPreview();
    renderWidgetForm();
}

function addWidget() {
    const sel = $('#widget-type-sel');
    const type = sel ? sel.value : 'button';
    const w = newWidget(type);
    currentWidgets().push(w);
    selectedWidgetId = w.id;
    renderCustomWidgets();
    renderWidgetPreview();
    renderWidgetForm();
    saveUiConfigSoon();
}

function deleteSelectedWidget() {
    const list = currentWidgets();
    const idx = list.findIndex(w => w.id === selectedWidgetId);
    if (idx < 0) { toast('Select an element first'); return; }
    if (!confirm('Delete the element?')) return;
    list.splice(idx, 1);
    selectedWidgetId = null;
    renderCustomWidgets();
    renderWidgetPreview();
    renderWidgetForm();
    saveUiConfig();
}

function renderWidgetPreview() {
    const area = $('#widget-preview');
    if (!area) return;
    area.innerHTML = '';
    currentWidgets().forEach(w => {
        const el = createWidgetEl(w, true);
        el.classList.add('widget-editable');
        area.appendChild(el);
        initPreviewDrag(w, el, area);
    });
}

function initPreviewDrag(w, el, area) {
    let pid = null, startX = 0, startY = 0, startLeft = 0, startTop = 0, moved = false;

    el.addEventListener('pointerdown', e => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        pid = e.pointerId;
        startX = e.clientX; startY = e.clientY;
        startLeft = w.x; startTop = w.y;
        moved = false;
        selectedWidgetId = w.id;
    });

    el.addEventListener('pointermove', e => {
        if (pid !== e.pointerId) return;
        if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 4) moved = true;
        const r = area.getBoundingClientRect();
        w.x = Math.round(Math.max(0, Math.min(100 - w.w, startLeft + (e.clientX - startX) / r.width * 100)));
        w.y = Math.round(Math.max(0, Math.min(100 - w.h, startTop + (e.clientY - startY) / r.height * 100)));
        el.style.left = w.x + '%';
        el.style.top = w.y + '%';
    });

    const up = e => {
        if (pid !== e.pointerId) return;
        pid = null;
        if (moved) saveUiConfigSoon();
        else { renderWidgetForm(); }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
}

function renderWidgetForm() {
    const form = $('#widget-form');
    if (!form) return;
    form.innerHTML = '';
    const w = currentWidgets().find(x => x.id === selectedWidgetId);
    if (!w) return;

    const reRender = () => setTimeout(() => {
        renderWidgetPreview();
        renderWidgetForm();
        saveUiConfigSoon();
    }, 50);

    const addField = (label, input) => {
        const row = document.createElement('div');
        row.className = 'settings-row widget-form-row';
        const s = document.createElement('span');
        s.textContent = label;
        row.append(s, input);
        form.appendChild(row);
    };
    const mkInput = (value, oncommit) => {
        const i = document.createElement('input');
        i.className = 'cfg-mini';
        i.value = value;
        i.addEventListener('change', () => oncommit(i.value));
        return i;
    };
    const mkNum = (value, oncommit) => {
        const i = mkInput(value, v => oncommit(parseInt(v) || 0));
        i.type = 'number';
        return i;
    };
    const mkSelect = (options, value, oncommit) => {
        const i = document.createElement('select');
        i.className = 'cfg-mini';
        options.forEach(o => {
            const op = document.createElement('option');
            op.value = o;
            op.textContent = o;
            if (o === value) op.selected = true;
            i.appendChild(op);
        });
        i.addEventListener('change', () => oncommit(i.value));
        return i;
    };

    addField('Label', mkInput(w.label || '', v => { w.label = v; reRender(); }));
    addField('X %', mkNum(w.x, v => { w.x = v; reRender(); }));
    addField('Y %', mkNum(w.y, v => { w.y = v; reRender(); }));
    addField('W %', mkNum(w.w, v => { w.w = Math.max(5, v); reRender(); }));
    addField('H %', mkNum(w.h, v => { w.h = Math.max(5, v); reRender(); }));

    if (w.type === 'button') {
        addField('Action', mkInput(w.action || '', v => { w.action = v; reRender(); }));
        addField('Mode', mkSelect(['click', 'hold', 'repeat'], w.pressMode || 'click', v => { w.pressMode = v; reRender(); }));
        addField('Repeat N', mkNum(w.repeatCount || 3, v => { w.repeatCount = Math.max(1, v); }));
        addField('Interval ms', mkNum(w.repeatInterval || 80, v => { w.repeatInterval = Math.max(10, v); }));
        addField('Color', mkSelect(['btn-primary', 'btn-dark', 'btn-warning', 'btn-danger', 'btn-success'], w.color || 'btn-primary', v => { w.color = v; reRender(); }));
    } else if (w.type === 'touchpad') {
        addField('Axes', mkSelect(['1', '2'], String(w.axes || 2), v => { w.axes = parseInt(v); reRender(); }));
        addField('Edge zone', mkSelect(['on', 'off'], w.edgeZone === false ? 'off' : 'on', v => { w.edgeZone = v === 'on'; reRender(); }));
        addField('Sens (0=global)', mkNum(w.sensitivity || 0, v => { w.sensitivity = v; }));
    } else if (w.type === 'sequence') {
        const ta = document.createElement('textarea');
        ta.className = 'cfg-mini steps-area';
        ta.value = (w.steps || []).map(s => [s.kind, s.value, s.delay].join(' ')).join('\n');
        ta.placeholder = 'key e 100\ntype hello 200\ncombo ctrl+c 100\npause 500';
        ta.addEventListener('change', () => {
            w.steps = ta.value.split('\n').map(line => {
                line = line.trim();
                if (!line) return null;
                const parts = line.split(/\s+/);
                const kind = parts[0];
                const delay = /^\d+$/.test(parts[parts.length - 1]) ? parseInt(parts.pop()) : 50;
                const value = parts.slice(1).join(' ');
                return { kind, value, delay };
            }).filter(Boolean);
            reRender();
        });
        addField('Steps', ta);
    } else if (w.type === 'slider') {
        addField('Binding', mkSelect(['volume', 'brightness', 'zoom', 'fps'], w.binding || 'volume', v => { w.binding = v; reRender(); }));
        addField('Min', mkNum(w.min ?? 0, v => { w.min = v; reRender(); }));
        addField('Max', mkNum(w.max ?? 100, v => { w.max = Math.max(w.min + 1, v); reRender(); }));
    } else if (w.type === 'toggle') {
        addField('Binding', mkSelect(['power', 'wg'], w.binding || 'power', v => { w.binding = v; reRender(); }));
    } else if (w.type === 'viewport') {
        w.vp = Object.assign(vpDefaults(), w.vp || {});
        const pols = ['always', 'button', 'edit', 'hidden'];
        addField('FPS ctrls', mkSelect(pols, w.vp.fps, v => { w.vp.fps = v; reRender(); }));
        addField('Quality ctrls', mkSelect(pols, w.vp.quality, v => { w.vp.quality = v; reRender(); }));
        addField('Zoom ctrls', mkSelect(pols, w.vp.zoom, v => { w.vp.zoom = v; reRender(); }));
        addField('Gestures', mkSelect(['on', 'off'], w.vp.gestures === false ? 'off' : 'on', v => { w.vp.gestures = v === 'on'; reRender(); }));
    }
}


// ==================== ИНИЦИАЛИЗАЦИЯ ПО ГОТОВНОСТИ КОНФИГА ====================
uiReadyHooks.push(() => {
    renderCustomWidgets();
    renderSettingsAll();
    applyPadEdgeSize();
});

// «Общее редактирование» вкладки Game из глобальных Settings:
// системный слой (fullscreen/settings/gp-badge, вьюпорты и прочее вне геймпада)
$('#btn-edit-game-tab')?.addEventListener('click', () => enterEditMode('system'));
