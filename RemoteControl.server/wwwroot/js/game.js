// ============================================================================
// game.js — вкладка Game как декларативный конструктор.
// Профили per-host (по IP), элементы: joystick / touchpad / scrollbar / button /
// viewport (+ gear) / системные (fullscreen, settings, gp-badge).
// Слои: background → viewport → controls → overlay → system.
// Глобальные настройки Game + override на элементе (null = глобальное).
// ============================================================================

const GAME_LAYERS = ['background', 'viewport', 'controls', 'overlay', 'system'];
const GAME_LAYER_Z = { background: 10, viewport: 20, controls: 30, overlay: 40, system: 50 };

let gameEditMode = false;      // editor.js переключает
let gameEditorElements = null; // рабочая копия при редактировании
let clientIp = 'unknown';

const gameVpInstances = new Map(); // elementId -> viewport instance

function gset() { return uiCfg.game.settings; }

// эффективное значение: override элемента или глобальное
function eff(el, key, globalKey) {
    const v = el[key];
    return (v === null || v === undefined || v === '') ? gset()[globalKey] : v;
}

// ==================== ПРОФИЛИ ====================

function gameHost() {
    const hosts = uiCfg.game.hosts;
    return hosts[clientIp] || null;
}

function activeProfile() {
    const host = gameHost();
    if (!host || !host.profiles.length) return null;
    return host.profiles.find(p => p.id === host.lastUsed) || host.profiles[0];
}

function gameElements() {
    if (gameEditMode && gameEditorElements) return gameEditorElements;
    return activeProfile()?.elements || [];
}

// Дефолтный шаблон: джойстик слева, тачпад камеры справа + системные элементы
function defaultProfileElements() {
    return [
        { id: uid(), type: 'joystick', layer: 'controls', x: 14, y: 120, w: 170, h: 170, opacity: 100 },
        {
            id: uid(), type: 'touchpad', layer: 'controls', x: 470, y: 70, w: 250, h: 250, opacity: 100,
            label: 'Camera', sens: null, lmbTap: null, edgeEnabled: null, edgeSizePx: null, edgeSpeed: null
        },
        { id: uid(), type: 'sys-fs', layer: 'system', x: 8, y: 6, w: 96, h: 30, opacity: 100 },
        { id: uid(), type: 'sys-gp', layer: 'system', x: 112, y: 6, w: 66, h: 30, opacity: 100 },
        { id: uid(), type: 'sys-settings', layer: 'system', x: 186, y: 6, w: 44, h: 30, opacity: 100 }
    ];
}

// Миграция старого формата (/api/game/layout: stick/camera/... + customButtons)
function migrateLegacyLayout(old) {
    const els = [];
    const put = (o, extra) => { if (o) els.push(Object.assign({ id: uid(), opacity: 100, x: o.x, y: o.y, w: o.w, h: o.h }, extra)); };

    put(old.stick, { type: 'joystick', layer: 'controls' });
    put(old.camera, { type: 'touchpad', layer: 'controls', label: 'Camera', sens: null, lmbTap: null, edgeEnabled: null, edgeSizePx: null, edgeSpeed: null });
    put(old.scroll, { type: 'scrollbar', layer: 'controls', axis: 'y', label: 'Scroll' });
    put(old.ctrl, { type: 'button', layer: 'controls', label: 'Ctrl', kind: 'key', action: 'ctrl', mode: 'toggle', color: 'btn-dark' });
    put(old.space, { type: 'button', layer: 'controls', label: 'Space', kind: 'key', action: 'space', mode: 'hold', color: 'btn-primary' });
    put(old.buy, { type: 'button', layer: 'controls', label: 'B', kind: 'key', action: 'b', mode: 'hold', color: 'btn-warning' });
    put(old.rmb, { type: 'button', layer: 'controls', label: 'RMB', kind: 'mouse', action: 'right', mode: 'hold', color: 'btn-primary' });
    put(old.lmb, { type: 'button', layer: 'controls', label: 'LMB', kind: 'mouse', action: 'left', mode: 'hold', color: 'btn-primary' });
    put(old.btnE, { type: 'button', layer: 'controls', label: 'E', kind: 'key', action: 'e', mode: 'hold', color: 'btn-dark' });
    put(old.btnF, { type: 'button', layer: 'controls', label: 'F', kind: 'key', action: 'f', mode: 'hold', color: 'btn-dark' });
    put(old.btnR, { type: 'button', layer: 'controls', label: 'R', kind: 'key', action: 'r', mode: 'hold', color: 'btn-dark' });

    (old.customButtons || []).forEach(b => {
        if (b.type === 'touchpad1') {
            put(b, { type: 'scrollbar', layer: 'controls', axis: 'y', label: b.label || 'Scroll' });
        } else if (b.type === 'touchpad2') {
            put(b, { type: 'touchpad', layer: 'controls', label: b.label || 'Pad', sens: null, lmbTap: false, edgeEnabled: null, edgeSizePx: null, edgeSpeed: null });
        } else {
            const mode = b.type === 'key-press' ? 'click' : b.type === 'key-toggle' ? 'toggle' : 'hold';
            const kind = b.type === 'mouse-hold' ? 'mouse' : 'key';
            put(b, { type: 'button', layer: 'controls', label: b.label || b.action, kind, action: b.action, mode, color: b.color || 'btn-dark' });
        }
    });

    // системные элементы (раньше жили в топбаре)
    els.push({ id: uid(), type: 'sys-fs', layer: 'system', x: 8, y: 6, w: 96, h: 30, opacity: 100 });
    els.push({ id: uid(), type: 'sys-gp', layer: 'system', x: 112, y: 6, w: 66, h: 30, opacity: 100 });
    els.push({ id: uid(), type: 'sys-settings', layer: 'system', x: 186, y: 6, w: 44, h: 30, opacity: 100 });
    return els;
}

// Разовая миграция старых настроек Game из localStorage
function migrateLegacyGameSettings() {
    try {
        const saved = localStorage.getItem('gameSettings');
        if (!saved) return;
        const old = JSON.parse(saved);
        const s = gset();
        if (old.camSens) s.sens = old.camSens;
        if (old.touchpadLmb !== undefined) s.lmbTap = !!old.touchpadLmb;
        if (old.edgeZone !== undefined) s.edgeEnabled = !!old.edgeZone;
        if (old.edgeSize) s.edgeSizePx = Math.round(old.edgeSize * 2.4); // % от ~240px пэда -> px
        if (old.edgeSpeed) s.edgeSpeed = old.edgeSpeed;
    } catch { }
}

async function initGame() {
    try {
        const d = await apiS('GET', '/api/client/info');
        if (d && d.ip) clientIp = d.ip;
    } catch { }

    if (!uiCfg.game.hosts[clientIp]) {
        let elements = null;
        const firstRun = Object.keys(uiCfg.game.hosts).length === 0;

        if (firstRun) {
            migrateLegacyGameSettings();
            try {
                const legacy = await apiS('GET', '/api/game/layout');
                if (legacy && legacy.stick) elements = migrateLegacyLayout(legacy);
            } catch { }
        }

        const p = { id: uid(), name: 'Default', elements: elements || defaultProfileElements() };
        uiCfg.game.hosts[clientIp] = { profiles: [p], lastUsed: p.id };
        saveUiConfigSoon();
    }

    renderGame();
    renderGameSettingsModal();
    const hostLbl = $('#profiles-host');
    if (hostLbl) hostLbl.textContent = 'Host: ' + clientIp;
}

function switchProfile(id) {
    const host = gameHost();
    if (!host) return;
    host.lastUsed = id;
    saveUiConfigSoon();
    renderGame();
    renderProfilesModal();
    toast('Profile: ' + (activeProfile()?.name || '?'));
}

// ==================== РЕНДЕР ====================

function destroyGameViewports() {
    for (const inst of gameVpInstances.values()) inst.deactivate();
    gameVpInstances.clear();
}

function renderGame() {
    const area = document.getElementById('game-area');
    if (!area) return;

    destroyGameViewports();
    area.innerHTML = '';
    area.classList.toggle('edit-mode', gameEditMode);

    gameElements().forEach(el => {
        const node = buildGameElement(el);
        if (node) area.appendChild(node);
    });

    if (gameEditMode && typeof editorDecorate === 'function') editorDecorate();
    if (currentTab === 'game') activateGameViewports();
}

function activateGameViewports() {
    for (const inst of gameVpInstances.values()) {
        inst.setEditMode(gameEditMode);
        inst.activate();
    }
}

function applyElementFrame(el, node) {
    node.style.left = el.x + 'px';
    node.style.top = el.y + 'px';
    node.style.width = el.w + 'px';
    node.style.height = el.h + 'px';
    node.style.zIndex = GAME_LAYER_Z[el.layer] || 30;
    const op = Math.max(5, Math.min(100, el.opacity ?? 100));
    node.style.opacity = (gameEditMode && editorFullOpacity) ? 1 : op / 100;
}

let editorFullOpacity = false; // тоггл редактора: реальная / полная непрозрачность

function buildGameElement(el) {
    let node;

    switch (el.type) {
        case 'button': {
            node = document.createElement('button');
            node.className = `btn ${el.color || 'btn-dark'} game-element ge-button`;
            node.textContent = el.label || el.action || 'Btn';
            if (!gameEditMode) initGameButton(el, node);
            break;
        }
        case 'joystick': {
            node = document.createElement('div');
            node.className = 'game-element ge-joystick';
            node.dataset.square = '1';
            node.innerHTML = '<span class="el-label">Move</span><div class="stick-knob"></div>';
            if (!gameEditMode) initGameJoystick(el, node);
            break;
        }
        case 'touchpad': {
            node = document.createElement('div');
            node.className = 'game-element ge-touchpad';
            node.innerHTML = `<span class="el-label">${el.label || 'Pad'}</span>` +
                '<div class="camera-edge-zone"></div><div class="camera-inner-zone"></div>';
            updatePadEdgeVisual(el, node);
            if (!gameEditMode) initGameTouchpad(el, node);
            break;
        }
        case 'scrollbar': {
            node = document.createElement('div');
            node.className = 'game-element ge-scrollbar';
            node.innerHTML = el.axis === 'x'
                ? `<span class="el-label">${el.label || 'Scroll'}</span>`
                : `<span class="el-label-v">${el.label || 'Scroll'}</span>`;
            if (!gameEditMode) initGameScrollbar(el, node);
            break;
        }
        case 'viewport': {
            const inst = createViewport(el);
            node = inst.root;
            node.classList.add('game-element');
            gameVpInstances.set(el.id, inst);
            break;
        }
        case 'vpgear': {
            node = document.createElement('button');
            node.className = 'game-element ge-vpgear';
            node.textContent = '⚙';
            if (!gameEditMode) {
                node.addEventListener('click', () => {
                    const inst = gameVpInstances.get(el.gearFor);
                    if (inst) node.classList.toggle('on', inst.togglePanels());
                    else toast('Viewport not found');
                });
            }
            break;
        }
        case 'sys-fs': {
            node = document.createElement('button');
            node.className = 'btn btn-dark game-element';
            node.textContent = 'Fullscreen';
            if (!gameEditMode) node.addEventListener('click', toggleGameFullscreen);
            break;
        }
        case 'sys-settings': {
            node = document.createElement('button');
            node.className = 'btn btn-dark game-element';
            node.textContent = '⚙️';
            if (!gameEditMode) node.addEventListener('click', openGameSettings);
            break;
        }
        case 'sys-gp': {
            node = document.createElement('div');
            node.className = 'game-element ge-badge';
            node.dataset.sys = 'gp';
            node.textContent = gpActive ? 'GP: on' : 'GP: off';
            node.classList.toggle('on', gpActive);
            break;
        }
        default:
            return null;
    }

    node.dataset.geId = el.id;
    applyElementFrame(el, node);
    return node;
}

// ==================== ПОВЕДЕНИЯ ====================

function initGameButton(el, node) {
    const isMouse = el.kind === 'mouse';
    const act = el.action || 'x';
    const down = () => { isMouse ? mouseDown(act) : keyDown(act); node.classList.add('btn-on'); };
    const up = () => { isMouse ? mouseUp(act) : keyUp(act); node.classList.remove('btn-on'); };
    const press = () => { isMouse ? mouseClick(act) : keyPress(act); };

    if (el.mode === 'click') {
        node.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); press(); });
    } else if (el.mode === 'toggle') {
        let on = false;
        node.addEventListener('pointerdown', e => {
            e.preventDefault();
            e.stopPropagation();
            on = !on;
            on ? down() : up();
        });
    } else if (el.mode === 'repeat') {
        // спам: down -> pressMs -> up -> intervalMs -> down -> ... до отпускания
        let active = false, timer = null;
        const pressMs = Math.max(10, el.pressMs || 60);
        const intervalMs = Math.max(10, el.intervalMs || 120);

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

function initGameJoystick(el, node) {
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

// Edge-визуал тачпада: размер в ПИКСЕЛЯХ (ровно и на неквадратных пэдах)
function updatePadEdgeVisual(el, node) {
    const enabled = eff(el, 'edgeEnabled', 'edgeEnabled');
    const sizePx = eff(el, 'edgeSizePx', 'edgeSizePx');
    const edgeZone = node.querySelector('.camera-edge-zone');
    const innerZone = node.querySelector('.camera-inner-zone');
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

function initGameTouchpad(el, node) {
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

function initGameScrollbar(el, node) {
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

// ==================== FULLSCREEN ====================

async function toggleGameFullscreen() {
    if (document.fullscreenElement) {
        try { screen.orientation.unlock?.(); } catch { }
        try { await document.exitFullscreen(); } catch { }
        document.body.classList.remove('game-fs');
    } else {
        document.body.classList.add('game-fs');
        try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { }
        try { await screen.orientation.lock('landscape'); } catch { }
    }
}

document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) document.body.classList.remove('game-fs');
});

// ==================== GAMEPAD WS ====================

let gpWs = null;
let gpActive = false;

function gpConnect() {
    if (gpWs && gpWs.readyState === WebSocket.OPEN) return;
    fire('POST', '/api/gamepad/start');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    gpWs = new WebSocket(`${proto}//${location.host}/ws/gamepad`);
    gpWs.onopen = () => { gpActive = true; updateGpState(); };
    gpWs.onclose = () => { gpActive = false; updateGpState(); gpWs = null; fire('POST', '/api/gamepad/stop'); };
    gpWs.onerror = () => { try { gpWs.close(); } catch { } };
}

function gpDisconnect() {
    try { if (gpWs) gpWs.close(); } catch { }
    gpWs = null;
    gpActive = false;
    fire('POST', '/api/gamepad/stop');
    updateGpState();
}

function gpSendLS(x, y) {
    if (!gpWs || gpWs.readyState !== WebSocket.OPEN) return;
    gpWs.send(JSON.stringify({ t: 'ls', x, y }));
}

function gpZero() {
    if (!gpWs || gpWs.readyState !== WebSocket.OPEN) return;
    gpWs.send(JSON.stringify({ t: 'zero' }));
}

function updateGpState() {
    document.querySelectorAll('.ge-badge[data-sys="gp"]').forEach(b => {
        b.textContent = gpActive ? 'GP: on' : 'GP: off';
        b.classList.toggle('on', gpActive);
    });
}

// ==================== ХУКИ ВКЛАДКИ ====================

tabEnterHooks.push(id => {
    if (id === 'game') {
        gpConnect();
        activateGameViewports();
    }
});
tabLeaveHooks.push(oldId => {
    if (oldId === 'game') {
        gpDisconnect();
        for (const inst of gameVpInstances.values()) inst.deactivate();
    }
});

document.addEventListener('visibilitychange', () => {
    if (currentTab !== 'game') return;
    if (document.hidden) {
        gpDisconnect();
        for (const inst of gameVpInstances.values()) inst.deactivate();
    } else {
        gpConnect();
        activateGameViewports();
    }
});

// ==================== GAME SETTINGS MODAL ====================

function openGameSettings() {
    renderGameSettingsModal();
    showModal('game-settings-overlay');
}

function closeGameSettings() {
    hideModal('game-settings-overlay');
}

function renderGameSettingsModal() {
    const box = $('#game-settings-body');
    if (!box) return;
    const s = gset();
    box.innerHTML = '';

    const row = (label, ctrl) => {
        const r = document.createElement('div');
        r.className = 'rc-form-row';
        const sp = document.createElement('span');
        sp.textContent = label;
        r.append(sp, ctrl);
        box.appendChild(r);
        return r;
    };

    // Edit Layout — наверху (по просьбе)
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-warning';
    editBtn.textContent = '✏️ Edit';
    editBtn.onclick = () => { closeGameSettings(); enterEditMode(); };
    row('Edit Layout', editBtn);

    // Профили — отдельная менюха, чтобы не перегружать
    const profBtn = document.createElement('button');
    profBtn.className = 'btn btn-primary';
    profBtn.textContent = '👥 Profiles';
    profBtn.onclick = () => { closeGameSettings(); openProfilesModal(); };
    row('Profiles', profBtn);

    const mkToggle = (key) => {
        const t = document.createElement('div');
        t.className = 'game-toggle' + (s[key] ? ' on' : '');
        t.onclick = () => {
            s[key] = !s[key];
            t.classList.toggle('on', s[key]);
            saveUiConfigSoon();
            if (!gameEditMode) renderGame();
        };
        return t;
    };

    const mkRange = (key, min, max, fmt) => {
        const wrap = document.createElement('div');
        wrap.className = 'game-setting-control';
        const r = document.createElement('input');
        r.type = 'range';
        r.className = 'game-slider';
        r.min = min; r.max = max; r.value = s[key];
        const v = document.createElement('span');
        v.className = 'game-slider-value';
        v.textContent = fmt(s[key]);
        r.oninput = () => {
            s[key] = parseInt(r.value);
            v.textContent = fmt(s[key]);
            saveUiConfigSoon();
            if (!gameEditMode) renderGame();
        };
        wrap.append(r, v);
        return wrap;
    };

    // Один глобальный sens для всех тачпадоподобных (camera sens — рудимент, убран)
    row('Sensitivity', mkRange('sens', 5, 30, v => (v / 10).toFixed(1) + 'x'));
    row('Touchpad LMB Mode', mkToggle('lmbTap'));
    row('Edge Zone', mkToggle('edgeEnabled'));
    row('Edge Size', mkRange('edgeSizePx', 5, 80, v => v + 'px'));
    row('Edge Speed', mkRange('edgeSpeed', 5, 30, v => String(v)));

    const note = document.createElement('div');
    note.className = 'rc-form-note';
    note.textContent = 'Глобальные значения. Для конкретного элемента — override в редакторе (двойной тап → ✎).';
    box.appendChild(note);
}

// ==================== PROFILES MODAL ====================

function openProfilesModal() {
    renderProfilesModal();
    showModal('profiles-overlay');
}

function renderProfilesModal() {
    const list = $('#profiles-list');
    if (!list) return;
    const host = gameHost();
    list.innerHTML = '';
    if (!host) return;

    const active = activeProfile();

    host.profiles.forEach(p => {
        const row = document.createElement('div');
        row.className = 'profile-row' + (active && p.id === active.id ? ' active' : '');

        const name = document.createElement('span');
        name.className = 'pname';
        name.textContent = p.name + (active && p.id === active.id ? ' ✓' : '');
        name.onclick = () => switchProfile(p.id);

        const ren = document.createElement('button');
        ren.className = 'btn btn-dark';
        ren.textContent = '✎';
        ren.title = 'Rename';
        ren.onclick = () => {
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.value = p.name;
            inp.className = 'game-input';
            inp.style.flex = '1';
            row.replaceChild(inp, name);
            inp.focus();
            const commit = () => {
                p.name = inp.value.trim() || p.name;
                saveUiConfigSoon();
                renderProfilesModal();
            };
            inp.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
            inp.addEventListener('blur', commit);
        };

        const dup = document.createElement('button');
        dup.className = 'btn btn-dark';
        dup.textContent = '⧉';
        dup.title = 'Duplicate';
        dup.onclick = () => {
            const copy = { id: uid(), name: p.name + ' copy', elements: JSON.parse(JSON.stringify(p.elements)) };
            host.profiles.push(copy);
            saveUiConfigSoon();
            renderProfilesModal();
        };

        const del = document.createElement('button');
        del.className = 'btn btn-danger';
        del.textContent = '✕';
        del.onclick = () => {
            if (host.profiles.length <= 1) { toast('Last profile — can\'t delete'); return; }
            if (!confirm(`Delete profile "${p.name}"?`)) return;
            host.profiles = host.profiles.filter(x => x.id !== p.id);
            if (host.lastUsed === p.id) host.lastUsed = host.profiles[0].id;
            saveUiConfigSoon();
            renderGame();
            renderProfilesModal();
        };

        row.append(name, ren, dup, del);
        list.appendChild(row);
    });
}

$('#btn-profile-new')?.addEventListener('click', () => {
    const host = gameHost();
    if (!host) return;
    const inp = $('#profile-new-name');
    const name = (inp?.value || '').trim() || ('Profile ' + (host.profiles.length + 1));
    // новый профиль — по дефолтному шаблону (джойстик слева, тачпад справа)
    const p = { id: uid(), name, elements: defaultProfileElements() };
    host.profiles.push(p);
    host.lastUsed = p.id;
    if (inp) inp.value = '';
    saveUiConfigSoon();
    renderGame();
    renderProfilesModal();
});

$('#profiles-close')?.addEventListener('click', () => hideModal('profiles-overlay'));
$('#game-settings-close')?.addEventListener('click', closeGameSettings);
