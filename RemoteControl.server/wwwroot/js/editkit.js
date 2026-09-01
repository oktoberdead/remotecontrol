// ============================================================================
// editkit.js — общий тулкит конструктора: билдеры форм, инъекция хэндлов,
// выбор/драг/ресайз (одна логика для Game-канваса и канвасов разделов страниц).
//
// Структура элемента (единая):
//   <div class="ge-wrap game-element" data-ge-id>   ← позиция/размер, outline, хэндлы
//       <div|button class="ge-body ...">...</div>   ← визуал + opacity элемента
//       <div class="ctl-handle h-resize|h-edit|h-delete">
//   </div>
// Хэндлы — дети wrap, а НЕ body: опасити элемента на них не влияет (всегда 100%).
// ============================================================================

const EK_MIN_SIZE = 24;

// ---------- selection (одна сессия редактирования за раз) ----------
const EkSel = {
    id: null,
    scope: null, // корневой контейнер текущей сессии

    set(id, showActions) {
        this.id = id;
        const root = this.scope || document;
        root.querySelectorAll('.ge-wrap').forEach(n => {
            const sel = id !== null && n.dataset.geId === id;
            n.classList.toggle('selected', sel);
            if (sel && showActions) n.classList.add('show-actions');
            else n.classList.remove('show-actions');
        });
    },

    clear() { this.set(null); }
};

// ---------- handles ----------
function ekInjectHandles(wrap, opts) {
    opts = opts || {};
    let html = '';
    if (opts.resize !== false) html += '<div class="ctl-handle h-resize" data-h="resize">⤡</div>';
    if (opts.edit !== false) html += '<div class="ctl-handle h-edit" data-h="edit">✎</div>';
    if (opts.del !== false) html += '<div class="ctl-handle h-delete" data-h="delete">✕</div>';
    wrap.insertAdjacentHTML('beforeend', html);
}

// ---------- generic interaction: tap/swipe = select, dbltap = actions,
// drag = move, ⤡ = resize ----------
// ctx: {
//   isEditing(): bool
//   getFrame(): {x,y,w,h}      — в единицах модели
//   setFrame(f)                — коммит в модель
//   applyFrame()               — перерисовать wrap по модели
//   toUnits(dxPx, dyPx): {dx,dy} — конверсия пикселей в единицы модели
//   square: bool, minW, minH   — в единицах модели
//   maxW?, maxH?               — опционально (для %-канвасов)
//   onEdit(), onDelete()       — кнопки ✎ / ✕
//   canEdit: bool, canDelete: bool
// }
function ekBindInteraction(wrap, id, ctx) {
    let mode = null;
    let startX = 0, startY = 0, start = null;
    let moved = false, downTime = 0, lastTapAt = 0;

    const hitHandle = e => {
        for (const h of wrap.querySelectorAll('.ctl-handle')) {
            if (getComputedStyle(h).display === 'none') continue;
            const r = h.getBoundingClientRect();
            if (e.clientX >= r.left - 8 && e.clientX <= r.right + 8 &&
                e.clientY >= r.top - 8 && e.clientY <= r.bottom + 8) {
                return h.dataset.h;
            }
        }
        return null;
    };

    wrap.addEventListener('pointerdown', e => {
        if (!ctx.isEditing()) return;
        e.preventDefault();
        e.stopPropagation();
        wrap.setPointerCapture(e.pointerId);

        const wasSelected = EkSel.id === id;
        const h = wasSelected ? hitHandle(e) : null;

        if (h === 'edit') { if (ctx.canEdit !== false) ctx.onEdit(); return; }
        if (h === 'delete') { if (ctx.canDelete !== false) ctx.onDelete(); return; }

        startX = e.clientX;
        startY = e.clientY;
        start = ctx.getFrame();
        moved = false;
        downTime = Date.now();

        if (!wasSelected) EkSel.set(id); // выбор тапом или сразу свайпом

        if (h === 'resize') {
            mode = 'resize';
            wrap.classList.add('resizing');
        } else {
            mode = 'move';
        }
    });

    wrap.addEventListener('pointermove', e => {
        if (!mode || !ctx.isEditing()) return;
        e.preventDefault();

        const dxPx = e.clientX - startX;
        const dyPx = e.clientY - startY;
        if (!moved && Math.hypot(dxPx, dyPx) > 6) moved = true;

        const { dx, dy } = ctx.toUnits(dxPx, dyPx);
        const f = ctx.getFrame();

        if (mode === 'move') {
            f.x = Math.max(0, ekRound(start.x + dx));
            f.y = Math.max(0, ekRound(start.y + dy));
            if (ctx.maxW !== undefined) f.x = Math.min(f.x, Math.max(0, ctx.maxW - f.w));
            if (ctx.maxH !== undefined) f.y = Math.min(f.y, Math.max(0, ctx.maxH - f.h));
        } else {
            let w = Math.max(ctx.minW ?? EK_MIN_SIZE, ekRound(start.w + dx));
            let h = Math.max(ctx.minH ?? EK_MIN_SIZE, ekRound(start.h + dy));
            if (ctx.maxW !== undefined) w = Math.min(w, ctx.maxW - f.x);
            if (ctx.maxH !== undefined) h = Math.min(h, ctx.maxH - f.y);
            if (ctx.square) w = h = Math.max(w, h);
            f.w = w;
            f.h = h;
        }
        ctx.setFrame(f);
        ctx.applyFrame();
    });

    const end = () => {
        if (!mode) return;
        const wasResize = mode === 'resize';
        mode = null;
        wrap.classList.remove('resizing');

        // двойной тап: два коротких нажатия без движения → ✎ / ✕
        if (!wasResize && !moved && Date.now() - downTime < 400) {
            const now = Date.now();
            if (now - lastTapAt < 350) {
                lastTapAt = 0;
                EkSel.set(id, true);
            } else {
                lastTapAt = now;
            }
        }
    };

    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', () => { mode = null; wrap.classList.remove('resizing'); });
}

function ekRound(v) { return Math.round(v * 10) / 10; }

// ---------- билдеры форм (модалки, никаких prompt()) ----------
function ekRow(container, label, ctrl) {
    const r = document.createElement('div');
    r.className = 'rc-form-row';
    const sp = document.createElement('span');
    sp.textContent = label;
    r.append(sp, ctrl);
    container.appendChild(r);
    return r;
}

function ekNote(container, text) {
    const n = document.createElement('div');
    n.className = 'rc-form-note';
    n.textContent = text;
    container.appendChild(n);
    return n;
}

function ekText(value, oncommit) {
    const i = document.createElement('input');
    i.type = 'text';
    i.value = value ?? '';
    i.addEventListener('change', () => oncommit(i.value));
    return i;
}

function ekNum(value, oncommit, min, max) {
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
    });
    return i;
}

// override-число: пусто = глобальное значение
function ekNumOverride(value, globalVal, oncommit) {
    const i = document.createElement('input');
    i.type = 'number';
    i.placeholder = 'global (' + globalVal + ')';
    i.value = (value === null || value === undefined) ? '' : value;
    i.addEventListener('change', () => {
        const v = i.value.trim() === '' ? null : parseInt(i.value);
        oncommit(v === null || isNaN(v) ? null : v);
    });
    return i;
}

function ekSelect(options, value, oncommit) {
    const sel = document.createElement('select');
    options.forEach(o => {
        const [val, lbl] = Array.isArray(o) ? o : [o, o];
        const op = document.createElement('option');
        op.value = val;
        op.textContent = lbl;
        if (String(value) === val) op.selected = true;
        sel.appendChild(op);
    });
    sel.addEventListener('change', () => oncommit(sel.value));
    return sel;
}

// override-булево: global / on / off
function ekBoolOverride(value, oncommit) {
    return ekSelect(
        [['global', 'global'], ['true', 'on'], ['false', 'off']],
        value === null || value === undefined ? 'global' : String(value),
        v => oncommit(v === 'global' ? null : v === 'true')
    );
}

function ekRange(value, min, max, fmt, oninput) {
    const wrap = document.createElement('div');
    wrap.className = 'game-setting-control';
    const r = document.createElement('input');
    r.type = 'range';
    r.className = 'game-slider';
    r.min = min; r.max = max; r.value = value;
    const v = document.createElement('span');
    v.className = 'rc-val';
    v.textContent = fmt(value);
    r.oninput = () => {
        const val = parseInt(r.value);
        v.textContent = fmt(val);
        oninput(val);
    };
    wrap.append(r, v);
    return wrap;
}

// ============================================================================
// ОБЩАЯ ФОРМА РЕДАКТИРОВАНИЯ ЭЛЕМЕНТА (Game и страницы — одна логика)
// ctx: {
//   units: 'px' | '%'
//   showLayer: bool         — слои есть только на Game-канвасе
//   gset(): {...}           — глобальные Game-настройки (для override-плейсхолдеров)
//   rerender()              — перерисовать канвас (сохранив выбор)
//   applyFrameLive(el)      — живое применение opacity без пересоздания
// }
// ============================================================================
function ekBuildElementForm(body, el, ctx) {
    body.innerHTML = '';
    const R = (label, ctrl) => ekRow(body, label, ctrl);
    const re = () => ctx.rerender();

    // --- общие поля ---
    if (!String(el.type).startsWith('sys-') && el.type !== 'vpgear' && el.type !== 'joystick' && !String(el.type).startsWith('blk-')) {
        R('Label', ekText(el.label, v => { el.label = v; re(); }));
    }
    if (ctx.showLayer) {
        R('Layer', ekSelect(GAME_LAYERS.map(l => [l, l]), el.layer, v => { el.layer = v; re(); }));
    }
    R('Opacity', ekRange(el.opacity ?? 100, 5, 100, v => v + '%', v => {
        el.opacity = v;
        ctx.applyFrameLive(el);
    }));

    // --- по типам ---
    switch (el.type) {
        case 'button': {
            const modeRows = { press: null, interval: null };

            const syncModeRows = () => {
                const m = el.mode || 'hold';
                // длительность нажатия: click и repeat; интервал: ТОЛЬКО repeat
                if (modeRows.press) modeRows.press.style.display = (m === 'click' || m === 'repeat') ? '' : 'none';
                if (modeRows.interval) modeRows.interval.style.display = (m === 'repeat') ? '' : 'none';
            };

            R('Kind', ekSelect(
                [['key', 'Keyboard key'], ['mouse', 'Mouse button'], ['combo', 'Combo (a+b+c)'], ['api', 'API call']],
                el.kind || 'key',
                v => { el.kind = v; re(); ekBuildElementForm(body, el, ctx); }));

            if (el.kind === 'mouse') {
                // конкретный селект вместо голого инпута
                R('Button', ekSelect(
                    [['left', 'LMB (left)'], ['right', 'RMB (right)'], ['middle', 'MMB (middle)']],
                    el.action || 'left', v => { el.action = v; re(); }));
            } else if (el.kind === 'combo') {
                R('Keys (a+b+c)', ekText(el.action, v => { el.action = v.trim(); re(); }));
            } else if (el.kind === 'api') {
                R('POST path', ekText(el.action, v => { el.action = v.trim(); re(); }));
            } else {
                R('Key', ekText(el.action, v => { el.action = v.trim(); re(); }));
            }

            const modeOpts = (el.kind === 'combo' || el.kind === 'api')
                ? [['click', 'Click'], ['repeat', 'Repeat (спам)']]
                : [['click', 'Click (однократно)'], ['hold', 'Hold (пока нажата)'], ['toggle', 'Toggle'], ['repeat', 'Repeat (спам)']];
            R('Mode', ekSelect(modeOpts, el.mode || 'hold', v => {
                el.mode = v;
                syncModeRows();
                re();
            }));

            modeRows.press = R('Press duration ms', ekNum(el.pressMs ?? 60, v => { el.pressMs = v; }, 10, 5000));
            modeRows.interval = R('Repeat interval ms', ekNum(el.intervalMs ?? 120, v => { el.intervalMs = v; }, 10, 10000));
            syncModeRows();

            R('Color', ekSelect(
                [['btn-dark', 'Dark'], ['btn-primary', 'Blue'], ['btn-success', 'Green'], ['btn-warning', 'Orange'], ['btn-danger', 'Red']],
                el.color || 'btn-dark', v => { el.color = v; re(); }));
            break;
        }

        case 'touchpad': {
            const g = ctx.gset();
            R('Sens ×0.1', ekNumOverride(el.sens, g.sens, v => { el.sens = v; re(); }));
            R('LMB on tap', ekBoolOverride(el.lmbTap, v => { el.lmbTap = v; re(); }));
            R('Edge zone', ekBoolOverride(el.edgeEnabled, v => { el.edgeEnabled = v; re(); }));
            R('Edge size px', ekNumOverride(el.edgeSizePx, g.edgeSizePx, v => { el.edgeSizePx = v; re(); }));
            R('Edge speed', ekNumOverride(el.edgeSpeed, g.edgeSpeed, v => { el.edgeSpeed = v; re(); }));
            ekNote(body, 'Пустое поле / global — используется глобальная настройка.');
            break;
        }

        case 'scrollbar':
            // это скроллбар, мать его — никаких edge-зон :)
            R('Axis', ekSelect([['y', 'Vertical (Y)'], ['x', 'Horizontal (X)']], el.axis || 'y', v => { el.axis = v; re(); }));
            break;

        case 'viewport': {
            el.vp = Object.assign(vpDefaults(), el.vp || {});
            const polOpts = [['always', 'Always'], ['button', 'Settings button'], ['edit', 'Edit-only'], ['hidden', 'Hidden']];
            R('FPS controls', ekSelect(polOpts, el.vp.fps, v => { el.vp.fps = v; re(); }));
            R('Quality controls', ekSelect(polOpts, el.vp.quality, v => { el.vp.quality = v; re(); }));
            R('Zoom controls', ekSelect(polOpts, el.vp.zoom, v => { el.vp.zoom = v; re(); }));
            R('Gestures (pinch/pan)', ekSelect([['true', 'Enabled'], ['false', 'Disabled']],
                String(el.vp.gestures !== false), v => { el.vp.gestures = v === 'true'; re(); }));
            break;
        }

        case 'slider':
            R('Binding', ekSelect(['volume', 'brightness', 'zoom', 'fps'], el.binding || 'volume', v => { el.binding = v; re(); }));
            R('Min', ekNum(el.min ?? 0, v => { el.min = v; re(); }));
            R('Max', ekNum(el.max ?? 100, v => { el.max = Math.max((el.min ?? 0) + 1, v); re(); }));
            break;

        case 'toggle':
            R('Binding', ekSelect(['power', 'wg'], el.binding || 'power', v => { el.binding = v; re(); }));
            break;

        case 'input':
            break; // только Label/Opacity

        case 'label':
            R('Size px', ekNum(el.size ?? 13, v => { el.size = v; re(); }, 8, 48));
            break;

        case 'sequence': {
            const ta = document.createElement('textarea');
            ta.className = 'cfg-mini steps-area';
            ta.value = (el.steps || []).map(s => [s.kind, s.value, s.delay].join(' ')).join('\n');
            ta.placeholder = 'key e 100\ntype hello 200\ncombo ctrl+c 100\npause 500';
            ta.addEventListener('change', () => {
                el.steps = ta.value.split('\n').map(line => {
                    line = line.trim();
                    if (!line) return null;
                    const parts = line.split(/\s+/);
                    const kind = parts[0];
                    const delay = /^\d+$/.test(parts[parts.length - 1]) ? parseInt(parts.pop()) : 50;
                    const value = parts.slice(1).join(' ');
                    return { kind, value, delay };
                }).filter(Boolean);
                re();
            });
            R('Steps', ta);
            break;
        }
    }
    // joystick / sys-* / vpgear / blk-* — только общие поля
}
