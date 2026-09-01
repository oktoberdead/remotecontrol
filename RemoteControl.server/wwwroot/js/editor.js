// ============================================================================
// editor.js — редактор лэйаута Game (на общем тулките editkit.js).
// Выбор тапом/свайпом → рамка + resize-хэндл. Двойной тап → дополнительно
// ✎ (слева сверху) и ✕ (слева снизу). Хэндлы — вне body, всегда 100% opacity.
// Слои с приглушением, тоггл реальной/полной непрозрачности, формы в модалках.
// ============================================================================

let editorActiveLayer = 'all';

// ==================== ВХОД / ВЫХОД ====================

// entryLayer: 'all' — полный доступ; 'system' — акцент на системном слое
function enterEditMode(entryLayer) {
    if (!activeProfile()) { toast('No profile'); return; }
    // одна сессия редактирования за раз
    if (typeof pageEditTab !== 'undefined' && pageEditTab) exitPageEdit(false);
    if (typeof streamEditing !== 'undefined' && streamEditing) exitStreamEdit(false);
    gameEditorElements = JSON.parse(JSON.stringify(activeProfile().elements));
    gameEditMode = true;
    editorActiveLayer = entryLayer || 'all';
    editorFullOpacity = false;

    if (currentTab !== 'game') switchToTab('game');

    EkSel.scope = document.getElementById('game-area');
    EkSel.id = null;

    const ov = document.getElementById('layout-editor-overlay');
    ov?.classList.add('show', 'collapsed');
    renderEditorLayerBar();
    renderGame();
    activateGameViewports(); // вьюпорты живут и в редакторе (видно общую картину)
}

function exitEditMode(save) {
    if (save && gameEditorElements) {
        const p = activeProfile();
        if (p) p.elements = gameEditorElements;
        saveUiConfig();
        toast('Layout saved');
    }
    gameEditMode = false;
    gameEditorElements = null;
    EkSel.id = null;
    EkSel.scope = null;
    document.getElementById('layout-editor-overlay')?.classList.remove('show');
    renderGame();
}

$('#btn-save-layout')?.addEventListener('click', () => exitEditMode(true));
$('#btn-cancel-layout')?.addEventListener('click', () => exitEditMode(false));

$('#btn-editor-opacity')?.addEventListener('click', function () {
    editorFullOpacity = !editorFullOpacity;
    this.classList.toggle('btn-primary', editorFullOpacity);
    this.classList.toggle('btn-dark', !editorFullOpacity);
    // только пересчёт прозрачности, без пересоздания DOM
    gameEditorElements?.forEach(el => {
        const wrap = document.querySelector(`#game-area [data-ge-id="${el.id}"]`);
        if (wrap) applyElementFrame(el, wrap);
    });
});

// ==================== СЛОИ ====================

function renderEditorLayerBar() {
    const bar = $('#editor-layerbar');
    if (!bar) return;
    bar.innerHTML = '';
    const mk = (id, label) => {
        const b = document.createElement('button');
        b.className = 'lbtn' + (editorActiveLayer === id ? ' on' : '');
        b.textContent = label;
        b.onclick = () => {
            editorActiveLayer = id;
            renderEditorLayerBar();
            applyEditorLayerDim();
        };
        bar.appendChild(b);
    };
    mk('all', 'All');
    GAME_LAYERS.forEach(l => mk(l, l));
}

function applyEditorLayerDim() {
    if (!gameEditMode) return;
    gameEditorElements?.forEach(el => {
        const wrap = document.querySelector(`#game-area [data-ge-id="${el.id}"]`);
        if (!wrap) return;
        const dim = editorActiveLayer !== 'all' && el.layer !== editorActiveLayer;
        wrap.classList.toggle('layer-dim', dim);
        if (dim && EkSel.id === el.id) EkSel.clear();
    });
}

// ==================== ДЕКОРАЦИЯ ====================

function editorFindEl(id) {
    return gameEditorElements?.find(e => e.id === id) || null;
}

// вызывается из renderGame() в режиме редактирования
function editorDecorate() {
    const area = document.getElementById('game-area');
    if (!area) return;
    EkSel.scope = area;

    area.querySelectorAll('.ge-wrap').forEach(wrap => {
        const el = editorFindEl(wrap.dataset.geId);
        if (!el) return;

        ekInjectHandles(wrap, {});

        ekBindInteraction(wrap, el.id, {
            isEditing: () => gameEditMode,
            getFrame: () => ({ x: el.x, y: el.y, w: el.w, h: el.h }),
            setFrame: f => { el.x = Math.round(f.x); el.y = Math.round(f.y); el.w = Math.round(f.w); el.h = Math.round(f.h); },
            applyFrame: () => applyElementFrame(el, wrap),
            toUnits: (dx, dy) => ({ dx, dy }),
            square: wrap.dataset.square === '1',
            minW: EK_MIN_SIZE, minH: EK_MIN_SIZE,
            onEdit: () => openElementEditor(el.id),
            onDelete: () => editorDeleteElement(el.id)
        });
    });

    applyEditorLayerDim();
    if (EkSel.id) EkSel.set(EkSel.id);
}

// тап по пустому месту — снять выделение
document.getElementById('game-area')?.addEventListener('pointerdown', e => {
    if (!gameEditMode) return;
    if (!e.target.closest('.ge-wrap')) EkSel.clear();
});

async function editorDeleteElement(id) {
    const el = editorFindEl(id);
    if (!el) return;
    if (!await rcConfirm('Delete this element?')) return;

    let removeIds = [id];
    // вьюпорт удаляется вместе со своей кнопкой настроек
    if (el.type === 'viewport') {
        gameEditorElements.forEach(x => { if (x.type === 'vpgear' && x.gearFor === id) removeIds.push(x.id); });
    }

    gameEditorElements = gameEditorElements.filter(x => !removeIds.includes(x.id));
    EkSel.id = null;
    renderGame();
}

// ==================== ДОБАВЛЕНИЕ ЭЛЕМЕНТА (game) ====================

const GAME_ADD_TYPES = [
    ['button', 'Button'],
    ['touchpad', 'Touchpad (X/Y)'],
    ['scrollbar', 'Scrollbar (1 axis)'],
    ['joystick', 'Joystick'],
    ['viewport', 'Viewport (stream)'],
    ['sys-fs', 'System: Fullscreen'],
    ['sys-settings', 'System: Game Settings'],
    ['sys-gp', 'System: Gamepad badge']
];

$('#btn-add-element')?.addEventListener('click', () => {
    openAddElementModal(GAME_ADD_TYPES, spec => {
        const el = makeGameElement(spec);
        if (!el) return;
        gameEditorElements.push(el);
        if (el._gear) { gameEditorElements.push(el._gear); delete el._gear; }
        EkSel.id = el.id;
        renderGame();
    });
});

// spec: { type, label, action }
function makeGameElement(spec) {
    const base = { id: uid(), opacity: 100, x: 220, y: 140 };
    switch (spec.type) {
        case 'button':
            return Object.assign(base, {
                type: 'button', layer: 'controls', w: 60, h: 40,
                label: spec.label || (spec.action || 'x').toUpperCase(), kind: 'key', action: spec.action || 'x',
                mode: 'hold', pressMs: 60, intervalMs: 120, color: 'btn-dark'
            });
        case 'touchpad':
            return Object.assign(base, {
                type: 'touchpad', layer: 'controls', w: 200, h: 200,
                label: spec.label || 'Pad', sens: null, lmbTap: null,
                edgeEnabled: null, edgeSizePx: null, edgeSpeed: null
            });
        case 'scrollbar':
            return Object.assign(base, { type: 'scrollbar', layer: 'controls', w: 42, h: 160, axis: 'y', label: spec.label || 'Scroll' });
        case 'joystick':
            return Object.assign(base, { type: 'joystick', layer: 'controls', w: 160, h: 160 });
        case 'viewport': {
            const el = Object.assign(base, {
                type: 'viewport', layer: 'viewport', x: 40, y: 40, w: 320, h: 200,
                vp: vpDefaults()
            });
            // связанная кнопка настроек вьюпорта — самостоятельный элемент
            el._gear = {
                id: uid(), type: 'vpgear', layer: 'overlay', gearFor: el.id,
                x: el.x + el.w + 6, y: el.y, w: 32, h: 32, opacity: 100
            };
            return el;
        }
        case 'sys-fs':
            return Object.assign(base, { type: 'sys-fs', layer: 'system', x: 8, y: 6, w: 96, h: 30 });
        case 'sys-settings':
            return Object.assign(base, { type: 'sys-settings', layer: 'system', x: 186, y: 6, w: 44, h: 30 });
        case 'sys-gp':
            return Object.assign(base, { type: 'sys-gp', layer: 'system', x: 112, y: 6, w: 66, h: 30 });
    }
    return null;
}

// ==================== ОБЩАЯ МОДАЛКА ДОБАВЛЕНИЯ ====================
// types: [[value, label], ...]; onAdd({type,label,action})

let addElOnAdd = null;

function openAddElementModal(types, onAdd) {
    addElOnAdd = onAdd;
    const sel = $('#add-el-type');
    sel.innerHTML = '';
    types.forEach(([v, l]) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = l;
        sel.appendChild(o);
    });
    sel.value = types[0][0];
    updateAddElementForm();
    showModal('add-element-overlay');
}

$('#add-el-type')?.addEventListener('change', updateAddElementForm);

function updateAddElementForm() {
    const t = $('#add-el-type')?.value || '';
    const showLabel = ['button', 'touchpad', 'scrollbar', 'label', 'toggle', 'slider', 'input', 'sequence'].includes(t);
    const showAction = t === 'button';
    $('#add-el-row-label').style.display = showLabel ? '' : 'none';
    $('#add-el-row-action').style.display = showAction ? '' : 'none';
}

$('#btn-confirm-add-el')?.addEventListener('click', () => {
    const spec = {
        type: $('#add-el-type')?.value || 'button',
        label: $('#add-el-label')?.value.trim() || '',
        action: $('#add-el-action')?.value.trim() || ''
    };
    hideModal('add-element-overlay');
    $('#add-el-label').value = '';
    $('#add-el-action').value = '';
    if (addElOnAdd) addElOnAdd(spec);
});

$('#btn-cancel-add-el')?.addEventListener('click', () => hideModal('add-element-overlay'));

// ==================== РЕДАКТОР ПАРАМЕТРОВ ЭЛЕМЕНТА (game) ====================

function openElementEditor(id) {
    const el = editorFindEl(id);
    if (!el) return;

    const body = $('#element-editor-body');
    const title = $('#element-editor-title');
    if (!body) return;
    title.textContent = 'Element: ' + el.type;

    ekBuildElementForm(body, el, {
        units: 'px',
        showLayer: true,
        gset,
        rerender: () => { renderGame(); EkSel.set(el.id); },
        applyFrameLive: e => {
            const wrap = document.querySelector(`#game-area [data-ge-id="${e.id}"]`);
            if (wrap) applyElementFrame(e, wrap);
        }
    });

    showModal('element-editor-overlay');
}

$('#element-editor-close')?.addEventListener('click', () => hideModal('element-editor-overlay'));
