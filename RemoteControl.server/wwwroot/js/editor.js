// ============================================================================
// editor.js — редактор лэйаута Game.
// Выбор тапом/свайпом → рамка + resize-хэндл. Двойной тап → дополнительно
// ✎ (слева сверху) и ✕ (слева снизу) — те же по стилю хэндлы, что и resize.
// Слои с приглушением неактуальных, тоггл реальной/полной непрозрачности,
// редактор параметров элемента (модалка, никаких prompt()).
// ============================================================================

const EDITOR_MIN_SIZE = 24;

let editorSelectedId = null;
let editorActiveLayer = 'all';
let editorEntryLayer = 'all';

// ==================== ВХОД / ВЫХОД ====================

// entryLayer: 'all' — из Game Settings (полный доступ);
// 'system' — «общее редактирование» вкладки из глобальных Settings
function enterEditMode(entryLayer) {
    if (!activeProfile()) { toast('No profile'); return; }
    gameEditorElements = JSON.parse(JSON.stringify(activeProfile().elements));
    gameEditMode = true;
    editorSelectedId = null;
    editorActiveLayer = entryLayer || 'all';
    editorEntryLayer = editorActiveLayer;
    editorFullOpacity = false;

    if (currentTab !== 'game') switchToTab('game');

    document.getElementById('layout-editor-overlay')?.classList.add('show');
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
    editorSelectedId = null;
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
        const node = document.querySelector(`#game-area [data-ge-id="${el.id}"]`);
        if (node) applyElementFrame(el, node);
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
        const node = document.querySelector(`#game-area [data-ge-id="${el.id}"]`);
        if (!node) return;
        const dim = editorActiveLayer !== 'all' && el.layer !== editorActiveLayer;
        node.classList.toggle('layer-dim', dim);
        if (dim && editorSelectedId === el.id) editorSelect(null);
    });
}

// ==================== ДЕКОРАЦИЯ / ВЫБОР ====================

function editorFindEl(id) {
    return gameEditorElements?.find(e => e.id === id) || null;
}

function editorSelect(id, showActions) {
    editorSelectedId = id;
    document.querySelectorAll('#game-area .game-element').forEach(n => {
        const sel = n.dataset.geId === id;
        n.classList.toggle('selected', sel);
        if (!sel || !showActions) n.classList.remove('show-actions');
        if (sel && showActions) n.classList.add('show-actions');
    });
}

// вызывается из renderGame() в режиме редактирования
function editorDecorate() {
    const area = document.getElementById('game-area');
    if (!area) return;

    area.querySelectorAll('.game-element').forEach(node => {
        const el = editorFindEl(node.dataset.geId);
        if (!el) return;

        // хэндлы одного семейства: resize (справа снизу), edit (слева сверху), delete (слева снизу)
        node.insertAdjacentHTML('beforeend',
            '<div class="ctl-handle h-resize" data-h="resize">⤡</div>' +
            '<div class="ctl-handle h-edit" data-h="edit">✎</div>' +
            '<div class="ctl-handle h-delete" data-h="delete">✕</div>');

        initEditorInteraction(el, node);
    });

    applyEditorLayerDim();

    if (editorSelectedId) editorSelect(editorSelectedId);
}

function initEditorInteraction(el, node) {
    let mode = null;
    let startX = 0, startY = 0, startL = 0, startT = 0, startW = 0, startH = 0;
    let moved = false, downTime = 0;
    let lastTapAt = 0;
    const isSquare = node.dataset.square === '1';

    const hitHandle = e => {
        for (const h of node.querySelectorAll('.ctl-handle')) {
            if (getComputedStyle(h).display === 'none') continue;
            const r = h.getBoundingClientRect();
            if (e.clientX >= r.left - 8 && e.clientX <= r.right + 8 &&
                e.clientY >= r.top - 8 && e.clientY <= r.bottom + 8) {
                return h.dataset.h;
            }
        }
        return null;
    };

    node.addEventListener('pointerdown', e => {
        if (!gameEditMode) return;
        e.preventDefault();
        e.stopPropagation();
        node.setPointerCapture(e.pointerId);

        const wasSelected = editorSelectedId === el.id;
        const h = wasSelected ? hitHandle(e) : null;

        if (h === 'edit') { openElementEditor(el.id); return; }
        if (h === 'delete') { editorDeleteElement(el.id); return; }

        startX = e.clientX;
        startY = e.clientY;
        startL = el.x;
        startT = el.y;
        startW = el.w;
        startH = el.h;
        moved = false;
        downTime = Date.now();

        // выбор тапом или сразу свайпом
        if (!wasSelected) editorSelect(el.id);

        if (h === 'resize') {
            mode = 'resize';
            node.classList.add('resizing');
        } else {
            mode = 'move';
        }
    });

    node.addEventListener('pointermove', e => {
        if (!mode || !gameEditMode) return;
        e.preventDefault();

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!moved && Math.hypot(dx, dy) > 6) moved = true;

        if (mode === 'move') {
            el.x = Math.max(0, Math.round(startL + dx));
            el.y = Math.max(0, Math.round(startT + dy));
        } else {
            let w = Math.max(EDITOR_MIN_SIZE, Math.round(startW + dx));
            let h = Math.max(EDITOR_MIN_SIZE, Math.round(startH + dy));
            if (isSquare) w = h = Math.max(w, h);
            el.w = w;
            el.h = h;
        }
        applyElementFrame(el, node);
    });

    const end = () => {
        if (!mode) return;
        const wasResize = mode === 'resize';
        mode = null;
        node.classList.remove('resizing');

        // двойной тап: короткое нажатие без движения дважды подряд
        if (!wasResize && !moved && Date.now() - downTime < 400) {
            const now = Date.now();
            if (now - lastTapAt < 350) {
                lastTapAt = 0;
                editorSelect(el.id, true); // показать ✎ / ✕
            } else {
                lastTapAt = now;
            }
        }
    };

    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', () => { mode = null; node.classList.remove('resizing'); });
}

// тап по пустому месту — снять выделение
document.getElementById('game-area')?.addEventListener('pointerdown', e => {
    if (!gameEditMode) return;
    if (!e.target.closest('.game-element')) editorSelect(null);
});

function editorDeleteElement(id) {
    const el = editorFindEl(id);
    if (!el) return;
    if (!confirm('Delete this element?')) return;

    let removeIds = [id];
    // вьюпорт удаляется вместе со своей кнопкой настроек и наоборот
    if (el.type === 'viewport') {
        gameEditorElements.forEach(x => { if (x.type === 'vpgear' && x.gearFor === id) removeIds.push(x.id); });
    }

    gameEditorElements = gameEditorElements.filter(x => !removeIds.includes(x.id));
    editorSelectedId = null;
    renderGame();
}

// ==================== ДОБАВЛЕНИЕ ЭЛЕМЕНТА ====================

$('#btn-add-element')?.addEventListener('click', () => {
    const typeSel = $('#add-el-type');
    if (typeSel) typeSel.value = 'button';
    updateAddElementForm();
    showModal('add-element-overlay');
});

$('#add-el-type')?.addEventListener('change', updateAddElementForm);

function updateAddElementForm() {
    const t = $('#add-el-type')?.value;
    const showBtn = t === 'button';
    $('#add-el-row-label').style.display = showBtn ? '' : 'none';
    $('#add-el-row-action').style.display = showBtn ? '' : 'none';
}

$('#btn-confirm-add-el')?.addEventListener('click', () => {
    const type = $('#add-el-type')?.value || 'button';
    const label = $('#add-el-label')?.value.trim() || '';
    const action = $('#add-el-action')?.value.trim() || 'x';

    const base = { id: uid(), opacity: 100, x: 220, y: 140 };
    let el = null;

    switch (type) {
        case 'button':
            el = Object.assign(base, {
                type: 'button', layer: 'controls', w: 60, h: 40,
                label: label || action.toUpperCase(), kind: 'key', action,
                mode: 'hold', pressMs: 60, intervalMs: 120, color: 'btn-dark'
            });
            break;
        case 'touchpad':
            el = Object.assign(base, {
                type: 'touchpad', layer: 'controls', w: 200, h: 200,
                label: label || 'Pad', sens: null, lmbTap: null,
                edgeEnabled: null, edgeSizePx: null, edgeSpeed: null
            });
            break;
        case 'scrollbar':
            el = Object.assign(base, { type: 'scrollbar', layer: 'controls', w: 42, h: 160, axis: 'y', label: label || 'Scroll' });
            break;
        case 'joystick':
            el = Object.assign(base, { type: 'joystick', layer: 'controls', w: 160, h: 160 });
            break;
        case 'viewport': {
            el = Object.assign(base, {
                type: 'viewport', layer: 'viewport', x: 40, y: 40, w: 320, h: 200,
                vp: vpDefaults()
            });
            // связанная кнопка настроек вьюпорта — самостоятельный элемент:
            // двигается и ресайзится как любой другой
            gameEditorElements.push({
                id: uid(), type: 'vpgear', layer: 'overlay', gearFor: el.id,
                x: el.x + el.w + 6, y: el.y, w: 32, h: 32, opacity: 100
            });
            break;
        }
    }

    if (el) {
        gameEditorElements.push(el);
        editorSelectedId = el.id;
        renderGame();
    }
    hideModal('add-element-overlay');
});

$('#btn-cancel-add-el')?.addEventListener('click', () => hideModal('add-element-overlay'));

// ==================== РЕДАКТОР ПАРАМЕТРОВ ЭЛЕМЕНТА ====================

function openElementEditor(id) {
    const el = editorFindEl(id);
    if (!el) return;

    const body = $('#element-editor-body');
    const title = $('#element-editor-title');
    if (!body) return;
    body.innerHTML = '';
    title.textContent = 'Element: ' + el.type;

    const rerender = () => { renderGame(); editorSelect(el.id); };

    const row = (label, ctrl) => {
        const r = document.createElement('div');
        r.className = 'rc-form-row';
        const sp = document.createElement('span');
        sp.textContent = label;
        r.append(sp, ctrl);
        body.appendChild(r);
        return r;
    };

    const mkText = (value, oncommit) => {
        const i = document.createElement('input');
        i.type = 'text';
        i.value = value ?? '';
        i.addEventListener('change', () => { oncommit(i.value); rerender(); });
        return i;
    };

    const mkNum = (value, oncommit, min, max) => {
        const i = document.createElement('input');
        i.type = 'number';
        i.value = value ?? '';
        i.addEventListener('change', () => {
            let v = parseInt(i.value);
            if (isNaN(v)) v = min ?? 0;
            if (min !== undefined) v = Math.max(min, v);
            if (max !== undefined) v = Math.min(max, v);
            i.value = v;
            oncommit(v);
            rerender();
        });
        return i;
    };

    // override-число: пусто = глобальное значение
    const mkNumOverride = (value, globalVal, oncommit) => {
        const i = document.createElement('input');
        i.type = 'number';
        i.placeholder = 'global (' + globalVal + ')';
        i.value = (value === null || value === undefined) ? '' : value;
        i.addEventListener('change', () => {
            const v = i.value.trim() === '' ? null : parseInt(i.value);
            oncommit(isNaN(v) ? null : v);
            rerender();
        });
        return i;
    };

    const mkSelect = (options, value, oncommit) => {
        const sel = document.createElement('select');
        options.forEach(([val, lbl]) => {
            const o = document.createElement('option');
            o.value = val;
            o.textContent = lbl;
            if (String(value) === val) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', () => { oncommit(sel.value); rerender(); });
        return sel;
    };

    // override-булево: global / on / off
    const mkBoolOverride = (value, oncommit) => mkSelect(
        [['global', 'global'], ['true', 'on'], ['false', 'off']],
        value === null || value === undefined ? 'global' : String(value),
        v => oncommit(v === 'global' ? null : v === 'true')
    );

    const mkOpacity = () => {
        const wrap = document.createElement('div');
        wrap.className = 'game-setting-control';
        const r = document.createElement('input');
        r.type = 'range';
        r.className = 'game-slider';
        r.min = 5; r.max = 100;
        r.value = el.opacity ?? 100;
        const v = document.createElement('span');
        v.className = 'rc-val';
        v.textContent = (el.opacity ?? 100) + '%';
        r.oninput = () => {
            el.opacity = parseInt(r.value);
            v.textContent = el.opacity + '%';
            const node = document.querySelector(`#game-area [data-ge-id="${el.id}"]`);
            if (node) applyElementFrame(el, node);
        };
        wrap.append(r, v);
        return wrap;
    };

    // --- общие поля ---
    if (!el.type.startsWith('sys-') && el.type !== 'vpgear' && el.type !== 'joystick') {
        row('Label', mkText(el.label, v => { el.label = v; }));
    }
    row('Layer', mkSelect(GAME_LAYERS.map(l => [l, l]), el.layer, v => { el.layer = v; }));
    row('Opacity', mkOpacity());

    // --- по типам ---
    if (el.type === 'button') {
        row('Kind', mkSelect([['key', 'Keyboard key'], ['mouse', 'Mouse button']], el.kind || 'key', v => { el.kind = v; }));
        row('Key / Button', mkText(el.action, v => { el.action = v.trim(); }));
        row('Mode', mkSelect(
            [['click', 'Click (однократно)'], ['hold', 'Hold (пока нажата)'], ['toggle', 'Toggle'], ['repeat', 'Repeat (спам)']],
            el.mode || 'hold', v => { el.mode = v; }));
        row('Press ms (repeat)', mkNum(el.pressMs ?? 60, v => { el.pressMs = v; }, 10, 5000));
        row('Interval ms (repeat)', mkNum(el.intervalMs ?? 120, v => { el.intervalMs = v; }, 10, 10000));
        row('Color', mkSelect(
            [['btn-dark', 'Dark'], ['btn-primary', 'Blue'], ['btn-success', 'Green'], ['btn-warning', 'Orange'], ['btn-danger', 'Red']],
            el.color || 'btn-dark', v => { el.color = v; }));
    } else if (el.type === 'touchpad') {
        row('Sens ×0.1', mkNumOverride(el.sens, gset().sens, v => { el.sens = v; }));
        row('LMB on tap', mkBoolOverride(el.lmbTap, v => { el.lmbTap = v; }));
        row('Edge zone', mkBoolOverride(el.edgeEnabled, v => { el.edgeEnabled = v; }));
        row('Edge size px', mkNumOverride(el.edgeSizePx, gset().edgeSizePx, v => { el.edgeSizePx = v; }));
        row('Edge speed', mkNumOverride(el.edgeSpeed, gset().edgeSpeed, v => { el.edgeSpeed = v; }));
        const note = document.createElement('div');
        note.className = 'rc-form-note';
        note.textContent = 'Пустое поле / global — используется глобальная настройка Game.';
        body.appendChild(note);
    } else if (el.type === 'scrollbar') {
        // эдж-зоны скроллбару не нужны — это скроллбар, мать его :)
        row('Axis', mkSelect([['y', 'Vertical (Y)'], ['x', 'Horizontal (X)']], el.axis || 'y', v => { el.axis = v; }));
    } else if (el.type === 'viewport') {
        el.vp = Object.assign(vpDefaults(), el.vp || {});
        const polOpts = [['always', 'Always'], ['button', 'Settings button'], ['edit', 'Edit-only'], ['hidden', 'Hidden']];
        row('FPS controls', mkSelect(polOpts, el.vp.fps, v => { el.vp.fps = v; }));
        row('Quality controls', mkSelect(polOpts, el.vp.quality, v => { el.vp.quality = v; }));
        row('Zoom controls', mkSelect(polOpts, el.vp.zoom, v => { el.vp.zoom = v; }));
        row('Gestures (pinch/pan)', mkSelect([['true', 'Enabled'], ['false', 'Disabled']],
            String(el.vp.gestures !== false), v => { el.vp.gestures = v === 'true'; }));
    }
    // joystick: без edge-зон — это же джойстик :)

    showModal('element-editor-overlay');
}

$('#element-editor-close')?.addEventListener('click', () => hideModal('element-editor-overlay'));
