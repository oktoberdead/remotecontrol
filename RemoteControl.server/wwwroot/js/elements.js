// ============================================================================
// elements.js — единый рантайм типовых элементов (Game-канвас И канвасы
// разделов страниц): построение DOM (wrap+body) и поведения.
//
// wrap  — позиция/размер/выделение/хэндлы (opacity всегда 100%)
// body  — визуал элемента, на него применяется opacity из конфига
//
// ctx (контекст построения):
//   edit: bool                — режим редактирования (поведения не вешаем)
//   units: 'px' | '%'         — единицы фреймов
//   vpReg: Map                — реестр viewport-инстансов (для vpgear)
//   zIndex(el): number|null   — z-index (game: по слою; страницы: не нужен)
//   fullOpacity: bool         — тоггл редактора «все 100%»
//   registerRefresh(el, fn)   — периодический рефреш (слайдеры/тогглы)
//   sys: { fs(), settings() } — обработчики системных кнопок
// ============================================================================

function mkElementWrap(el, body) {
    const wrap = document.createElement('div');
    wrap.className = 'ge-wrap game-element';
    wrap.dataset.geId = el.id;
    if (el.type === 'joystick') wrap.dataset.square = '1';
    body.classList.add('ge-body');
    wrap.appendChild(body);
    return wrap;
}

function applyWrapFrame(el, wrap, ctx) {
    const u = ctx.units === '%' ? '%' : 'px';
    wrap.style.left = el.x + u;
    wrap.style.top = el.y + u;
    wrap.style.width = el.w + u;
    wrap.style.height = el.h + u;
    const z = ctx.zIndex ? ctx.zIndex(el) : null;
    if (z !== null && z !== undefined) wrap.style.zIndex = z;
    const body = wrap.querySelector('.ge-body');
    if (body) {
        const op = Math.max(5, Math.min(100, el.opacity ?? 100));
        body.style.opacity = (ctx.edit && ctx.fullOpacity) ? 1 : op / 100;
    }
}

// ==================== ПОСТРОЕНИЕ BODY ПО ТИПУ ====================

function buildElementBody(el, ctx) {
    let body;

    switch (el.type) {
        case 'button': {
            body = document.createElement('button');
            body.className = `btn ${el.color || 'btn-dark'} ge-button`;
            body.textContent = el.label || el.action || 'Btn';
            if (!ctx.edit) initButtonBehavior(el, body);
            break;
        }
        case 'joystick': {
            body = document.createElement('div');
            body.className = 'ge-joystick';
            body.innerHTML = '<span class="el-label">Move</span><div class="stick-knob"></div>';
            if (!ctx.edit) initJoystickBehavior(el, body);
            break;
        }
        case 'touchpad': {
            body = document.createElement('div');
            body.className = 'ge-touchpad';
            body.innerHTML = `<span class="el-label">${el.label || 'Pad'}</span>` +
                '<div class="camera-edge-zone"></div><div class="camera-inner-zone"></div>';
            updatePadEdgeVisual(el, body);
            if (!ctx.edit) initTouchpadBehavior(el, body);
            break;
        }
        case 'scrollbar': {
            body = document.createElement('div');
            body.className = 'ge-scrollbar';
            body.innerHTML = el.axis === 'x'
                ? `<span class="el-label">${el.label || 'Scroll'}</span>`
                : `<span class="el-label-v">${el.label || 'Scroll'}</span>`;
            if (!ctx.edit) initScrollbarBehavior(el, body);
            break;
        }
        case 'viewport': {
            const inst = createViewport(el, { withGear: ctx.vpGearInline === true });
            body = inst.root;
            if (ctx.vpReg) ctx.vpReg.set(el.id, inst);
            break;
        }
        case 'vpgear': {
            body = document.createElement('button');
            body.className = 'ge-vpgear';
            body.textContent = '⚙';
            if (!ctx.edit) {
                body.addEventListener('click', () => {
                    const inst = ctx.vpReg && ctx.vpReg.get(el.gearFor);
                    if (inst) body.classList.toggle('on', inst.togglePanels());
                    else toast('Viewport not found');
                });
            }
            break;
        }
        case 'sys-fs': {
            body = document.createElement('button');
            body.className = 'btn btn-dark';
            body.textContent = el.label || 'Fullscreen';
            if (!ctx.edit) body.addEventListener('click', () => (ctx.sys && ctx.sys.fs ? ctx.sys.fs() : sysFsToggle(el)));
            break;
        }
        case 'sys-settings': {
            body = document.createElement('button');
            body.className = 'btn btn-dark';
            body.textContent = '⚙️';
            if (!ctx.edit && ctx.sys && ctx.sys.settings) body.addEventListener('click', ctx.sys.settings);
            break;
        }
        case 'sys-gp': {
            body = document.createElement('div');
            body.className = 'ge-badge';
            body.dataset.sys = 'gp';
            body.textContent = (typeof gpActive !== 'undefined' && gpActive) ? 'GP: on' : 'GP: off';
            body.classList.toggle('on', typeof gpActive !== 'undefined' && gpActive);
            break;
        }
        case 'slider': {
            body = document.createElement('div');
            body.className = 'ge-slider';
            body.innerHTML = `<span class="volume-value widget-val">--</span>` +
                `<input type="range" class="volume-slider" min="${el.min ?? 0}" max="${el.max ?? 100}" step="1">`;
            if (!ctx.edit) initSliderBehavior(el, body, ctx);
            break;
        }
        case 'toggle': {
            body = document.createElement('button');
            body.className = 'btn btn-dark ge-toggle';
            body.textContent = el.label || el.binding || 'toggle';
            if (!ctx.edit) initToggleBehavior(el, body, ctx);
            break;
        }
        case 'input': {
            body = document.createElement('div');
            body.className = 'ge-input widget-input';
            body.innerHTML = `<input placeholder="${el.label || 'Text'}" ${ctx.edit ? 'readonly' : ''}>`;
            if (!ctx.edit) initInputBehavior(body);
            break;
        }
        case 'label': {
            body = document.createElement('div');
            body.className = 'ge-label';
            body.textContent = el.label || 'Label';
            body.style.fontSize = (el.size || 13) + 'px';
            break;
        }
        case 'sequence': {
            body = document.createElement('button');
            body.className = `btn ${el.color || 'btn-primary'} ge-sequence`;
            body.textContent = el.label || '▶ Seq';
            if (!ctx.edit) body.addEventListener('click', () => runSequenceSteps(el.steps));
            break;
        }
        default: {
            // builtin-блоки (blk-*) строит blocks.js
            if (String(el.type).startsWith('blk-') && typeof buildBlockBody === 'function') {
                body = buildBlockBody(el, ctx);
                if (body) break;
            }
            return null;
        }
    }

    return body;
}

// Полный элемент: wrap + body (+ поведение)
function buildElementNode(el, ctx) {
    const body = buildElementBody(el, ctx);
    if (!body) return null;
    const wrap = mkElementWrap(el, body);
    applyWrapFrame(el, wrap, ctx);
    return wrap;
}

// ==================== ПОВЕДЕНИЯ: КНОПКА ====================

function comboKeysOf(action) {
    return String(action || '').split('+').map(s => s.trim()).filter(Boolean);
}

function initButtonBehavior(el, node) {
    const kind = el.kind || 'key';
    const act = el.action || 'x';
    const pressMs = Math.max(10, el.pressMs || 60);
    const intervalMs = Math.max(10, el.intervalMs || 120);

    // combo / api: дискретные срабатывания (down/up не имеют смысла)
    if (kind === 'combo' || kind === 'api') {
        const fireOnce = kind === 'combo'
            ? () => fire('POST', '/api/combo', { keys: comboKeysOf(act), delay: 25 })
            : () => fire('POST', act);

        if (el.mode === 'repeat') {
            let timer = null;
            node.addEventListener('pointerdown', e => {
                e.preventDefault();
                e.stopPropagation();
                node.setPointerCapture(e.pointerId);
                node.classList.add('btn-on');
                fireOnce();
                timer = setInterval(fireOnce, intervalMs);
            });
            const stop = () => { clearInterval(timer); timer = null; node.classList.remove('btn-on'); };
            node.addEventListener('pointerup', stop);
            node.addEventListener('pointercancel', stop);
        } else {
            node.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fireOnce(); });
        }
        return;
    }

    const isMouse = kind === 'mouse';
    const down = () => { isMouse ? mouseDown(act) : keyDown(act); node.classList.add('btn-on'); };
    const up = () => { isMouse ? mouseUp(act) : keyUp(act); node.classList.remove('btn-on'); };

    if (el.mode === 'click') {
        // честный клик: down → pressMs → up
        node.addEventListener('pointerdown', e => {
            e.preventDefault();
            e.stopPropagation();
            down();
            setTimeout(up, pressMs);
        });
    } else if (el.mode === 'toggle') {
        let on = false;
        node.addEventListener('pointerdown', e => {
            e.preventDefault();
            e.stopPropagation();
            on = !on;
            on ? down() : up();
        });
    } else if (el.mode === 'repeat') {
        // спам: down → pressMs → up → intervalMs → down → ... до отпускания
        let active = false, timer = null;
        const cycle = () => {
            if (!active) return;
            down();
            timer = setTimeout(() => {
                up();
                if (active) timer = setTimeout(cycle, intervalMs);
            }, pressMs);
        };
        const stop = () => {
            if (!active) return;
            active = false;
            clearTimeout(timer);
            up();
        };
        node.addEventListener('pointerdown', e => {
            e.preventDefault();
            e.stopPropagation();
            node.setPointerCapture(e.pointerId);
            if (active) return;
            active = true;
            cycle();
        });
        node.addEventListener('pointerup', stop);
        node.addEventListener('pointercancel', stop);
    } else { // hold
        node.addEventListener('pointerdown', e => {
            e.preventDefault();
            e.stopPropagation();
            node.setPointerCapture(e.pointerId);
            down();
        });
        node.addEventListener('pointerup', up);
        node.addEventListener('pointercancel', up);
    }
}

// ==================== ПОВЕДЕНИЯ: ДЖОЙСТИК ====================

function initJoystickBehavior(el, node) {
    const knob = node.querySelector('.stick-knob');
    let pid = null, cx = 0, cy = 0, radius = 0;
    let sx = 0, sy = 0, sendTimer = null;
    const DEADZONE = 0.08, HZ = 60;

    function setKnob(nx, ny) {
        knob.style.left = '50%';
        knob.style.top = '50%';
        knob.style.transform = `translate(calc(-50% + ${nx * radius}px), calc(-50% + ${ny * radius}px))`;
    }

    function update(e) {
        let nx = (e.clientX - cx) / radius;
        let ny = (e.clientY - cy) / radius;
        const len = Math.hypot(nx, ny);
        if (len > 1) { nx /= len; ny /= len; }
        if (len < DEADZONE) { nx = ny = 0; }
        sx = nx; sy = ny;
        setKnob(nx, ny);
    }

    node.addEventListener('pointerdown', e => {
        e.preventDefault();
        node.setPointerCapture(e.pointerId);
        pid = e.pointerId;
        node.classList.add('active');
        const r = node.getBoundingClientRect();
        cx = r.left + r.width / 2;
        cy = r.top + r.height / 2;
        radius = Math.min(r.width, r.height) * 0.35;
        update(e);
        if (!sendTimer) sendTimer = setInterval(() => gpSendLS(sx, -sy), 1000 / HZ);
    });

    node.addEventListener('pointermove', e => { if (pid === e.pointerId) update(e); });

    const up = e => {
        if (pid !== e.pointerId) return;
        pid = null;
        sx = sy = 0;
        setKnob(0, 0);
        node.classList.remove('active');
        if (sendTimer) { clearInterval(sendTimer); sendTimer = null; }
        gpZero();
    };
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
}

// ==================== ПОВЕДЕНИЯ: ТАЧПАД ====================

// Edge-визуал тачпада: размер в ПИКСЕЛЯХ (ровно и на неквадратных пэдах)
function updatePadEdgeVisual(el, body) {
    const enabled = eff(el, 'edgeEnabled', 'edgeEnabled');
    const sizePx = eff(el, 'edgeSizePx', 'edgeSizePx');
    const edgeZone = body.querySelector('.camera-edge-zone');
    const innerZone = body.querySelector('.camera-inner-zone');
    if (edgeZone) {
        edgeZone.style.setProperty('--edge-size', sizePx + 'px');
        edgeZone.classList.toggle('hidden', !enabled);
    }
    if (innerZone) {
        innerZone.style.top = sizePx + 'px';
        innerZone.style.left = sizePx + 'px';
        innerZone.style.right = sizePx + 'px';
        innerZone.style.bottom = sizePx + 'px';
        innerZone.classList.toggle('hidden', !enabled);
    }
}

function initTouchpadBehavior(el, node) {
    const edgeZoneEl = node.querySelector('.camera-edge-zone');
    let pid = null, rect = null, lastX = 0, lastY = 0;
    let movedPx = 0, downAt = 0;
    let edgeTimer = null;
    let lastTapTime = 0, dragging = false, dragTimer = null, isSecondTouch = false;

    const TAP_WINDOW = 300, HOLD_MS = 120, MOVE_THRESH = 6, TAP_MAX_MS = 180, EDGE_HZ = 60;

    function startEdge(dx, dy) {
        if (edgeZoneEl) edgeZoneEl.classList.add('edge-active');
        if (!edgeTimer) edgeTimer = setInterval(() => mouseMove(dx, dy), 1000 / EDGE_HZ);
    }
    function stopEdge() {
        if (edgeTimer) { clearInterval(edgeTimer); edgeTimer = null; }
        if (edgeZoneEl) edgeZoneEl.classList.remove('edge-active');
    }
    function startDrag() {
        if (!dragging) { dragging = true; mouseDown('left'); node.classList.add('dragging'); }
    }
    function endDrag() {
        if (dragging) { dragging = false; mouseUp('left'); node.classList.remove('dragging'); }
    }

    node.addEventListener('pointerdown', e => {
        e.preventDefault();
        node.setPointerCapture(e.pointerId);
        pid = e.pointerId;
        node.classList.add('active');
        rect = node.getBoundingClientRect();
        lastX = e.clientX;
        lastY = e.clientY;
        movedPx = 0;
        downAt = performance.now();
        stopEdge();
        if (dragTimer) clearTimeout(dragTimer);

        if (!eff(el, 'lmbTap', 'lmbTap')) return;
        isSecondTouch = (performance.now() - lastTapTime) < TAP_WINDOW;
        if (isSecondTouch) {
            dragTimer = setTimeout(() => {
                if (pid !== null && movedPx < MOVE_THRESH) startDrag();
            }, HOLD_MS);
        }
    });

    node.addEventListener('pointermove', e => {
        if (pid !== e.pointerId || !rect) return;

        const edgeEnabled = eff(el, 'edgeEnabled', 'edgeEnabled');
        const edgePx = eff(el, 'edgeSizePx', 'edgeSizePx');
        const edgeSpeed = eff(el, 'edgeSpeed', 'edgeSpeed');
        let ex = 0, ey = 0;

        if (edgeEnabled && rect.width && rect.height) {
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            if (px < edgePx) ex = -edgeSpeed;
            else if (px > rect.width - edgePx) ex = edgeSpeed;
            if (py < edgePx) ey = -edgeSpeed;
            else if (py > rect.height - edgePx) ey = edgeSpeed;
        }

        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        movedPx += Math.hypot(dx, dy);

        if (ex || ey) { startEdge(ex, ey); return; }
        stopEdge();

        const s = eff(el, 'sens', 'sens') / 10;
        const mx = Math.round(dx * s), my = Math.round(dy * s);
        if (mx || my) mouseMove(mx, my);

        if (eff(el, 'lmbTap', 'lmbTap') && isSecondTouch && !dragging && movedPx >= MOVE_THRESH) {
            clearTimeout(dragTimer);
            startDrag();
        }
    });

    const up = e => {
        if (pid !== e.pointerId) return;
        stopEdge();
        clearTimeout(dragTimer);
        node.classList.remove('active');

        const isTap = movedPx < MOVE_THRESH && (performance.now() - downAt) < TAP_MAX_MS;
        if (eff(el, 'lmbTap', 'lmbTap')) {
            if (dragging) endDrag();
            else if (isTap) { mouseClick('left'); lastTapTime = performance.now(); }
        }

        isSecondTouch = false;
        pid = null;
        rect = null;
        movedPx = 0;
    };
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
}

// ==================== ПОВЕДЕНИЯ: СКРОЛЛБАР ====================

function initScrollbarBehavior(el, node) {
    let pid = null, last = 0;
    const horizontal = el.axis === 'x';

    node.addEventListener('pointerdown', e => {
        e.preventDefault();
        node.setPointerCapture(e.pointerId);
        pid = e.pointerId;
        last = horizontal ? e.clientX : e.clientY;
        node.classList.add('active');
    });

    node.addEventListener('pointermove', e => {
        if (pid !== e.pointerId) return;
        const cur = horizontal ? e.clientX : e.clientY;
        const d = cur - last;
        last = cur;
        if (Math.abs(d) > 1) mouseWheel(Math.round(-d * 3));
    });

    const up = e => {
        if (pid === e.pointerId) { pid = null; node.classList.remove('active'); }
    };
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
}

// ==================== ПОВЕДЕНИЯ: SLIDER / TOGGLE / INPUT / SEQUENCE ====================

async function elSliderApply(binding, v) {
    if (binding === 'volume') await apiS('POST', '/api/volume/set', { level: v });
    else if (binding === 'brightness') await apiS('POST', '/api/monitor2/brightness', { level: v, index: typeof mon2Index !== 'undefined' ? mon2Index : 0 });
    else if (binding === 'zoom') await apiS('POST', '/api/screen/zoom', { action: 'set', level: v });
    else if (binding === 'fps') await apiS('POST', '/api/screen/fps', { fps: v });
}

async function elSliderFetch(binding) {
    if (binding === 'volume') { const d = await apiS('GET', '/api/volume'); return d ? d.volume : null; }
    if (binding === 'brightness') { const d = await apiS('GET', '/api/monitor2/state'); return d ? d.brightness : null; }
    return null;
}

function initSliderBehavior(el, body, ctx) {
    const range = body.querySelector('input[type=range]');
    const val = body.querySelector('.widget-val');
    const min = el.min ?? 0, max = el.max ?? 100;
    const paint = v => {
        val.textContent = (el.label ? el.label + ' ' : '') + v + (el.binding === 'volume' || el.binding === 'brightness' ? '%' : '');
        range.style.setProperty('--val', Math.min(100, (v - min) / Math.max(1, max - min) * 100) + '%');
    };
    let t = null;
    range.oninput = () => {
        const v = parseInt(range.value);
        paint(v);
        clearTimeout(t);
        t = setTimeout(() => elSliderApply(el.binding || 'volume', v), 150);
    };
    const refresh = async () => {
        const v = await elSliderFetch(el.binding || 'volume');
        if (v != null && body.isConnected) {
            range.value = v;
            paint(v);
        }
    };
    refresh();
    if (ctx.registerRefresh) ctx.registerRefresh(el, refresh);
}

function initToggleBehavior(el, body, ctx) {
    const refresh = async () => {
        let on = false;
        if (el.binding === 'power') { const d = await apiS('GET', '/api/monitor2/state'); on = d ? d.powerOn === true : false; }
        else if (el.binding === 'wg') { const d = await apiS('GET', '/api/wg/status'); on = d ? d.status === 'Running' : false; }
        if (body.isConnected) {
            body.classList.toggle('btn-on', on);
            body.textContent = (el.label || el.binding || 'toggle') + (on ? ' ●' : ' ○');
        }
    };
    refresh();
    body.addEventListener('click', async () => {
        if (el.binding === 'power') await apiS('POST', '/api/monitor2/power', { action: 'toggle' });
        else if (el.binding === 'wg') await apiS('POST', '/api/wg/toggle');
        setTimeout(refresh, 1200);
    });
    if (ctx.registerRefresh) ctx.registerRefresh(el, refresh);
}

function initInputBehavior(body) {
    const inp = body.querySelector('input');
    const send = () => {
        const v = inp.value.trim();
        if (v) { apiS('POST', '/api/type', { text: v }); inp.value = ''; }
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    inp.addEventListener('blur', send);
}

function runSequenceSteps(steps) {
    let t = 0;
    (steps || []).forEach(s => {
        setTimeout(() => {
            if (s.kind === 'key') keyPress(s.value);
            else if (s.kind === 'combo') fire('POST', '/api/combo', { keys: comboKeysOf(s.value), delay: 25 });
            else if (s.kind === 'type') apiS('POST', '/api/type', { text: s.value });
            // pause — ничего
        }, t);
        t += s.delay || 50;
    });
}


// ==================== FULLSCREEN (страничная кнопка sys-fs) ====================
// el.landscape (default true) — лочить альбомную ориентацию
// el.hideBars  (default true) — прятать шапку и вкладки (максимум места вьюпорту)

async function sysFsToggle(el) {
    const entering = !document.fullscreenElement;
    if (entering) {
        try { await document.documentElement.requestFullscreen(); } catch { }
        if (el.landscape !== false) {
            try { await screen.orientation.lock('landscape'); } catch { }
        }
        if (el.hideBars !== false) document.body.classList.add('bars-hidden');
    } else {
        try { await document.exitFullscreen(); } catch { }
    }
}

// системный выход из фуллскрина (жест/Esc) — вернуть панели
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
        document.body.classList.remove('bars-hidden');
        try { screen.orientation.unlock(); } catch { }
    }
});
