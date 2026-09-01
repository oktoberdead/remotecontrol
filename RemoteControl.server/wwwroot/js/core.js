// ============================================================================
// core.js — утилиты, API, вкладки, статус, громкость, тачпады Mouse/Stream,
// клавиатура, shutdown, конфиг сервера, ui-конфиг (raw, схему держит клиент)
// ============================================================================
// ==================== UTILS ====================
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function toast(m, d = 1500) {
    const t = $('#toast');
    t.textContent = m;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), d);
}

async function api(method, path, body = null, silent = false) {
    try {
        const opts = { method };
        if (body) {
            opts.headers = { 'Content-Type': 'application/json' };
            opts.body = JSON.stringify(body);
        }
        const r = await fetch(path, opts);
        const d = await r.json();
        if (!silent) {
            toast(d.status || d.key || d.layout || d.name || 'OK');
        }
        return d;
    } catch (e) {
        console.error(path, e);
        if (!silent) toast('Error');
        return { success: false };
    }
}

const apiS = (m, p, b) => api(m, p, b, true);

function fire(method, path, body = null) {
    const opts = { method };
    if (body) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
    }
    fetch(path, opts).catch(() => { });
}

// ==================== KEY/MOUSE HELPERS ====================
function keyDown(k) { fire('POST', `/api/key/down/${encodeURIComponent(k)}`); }
function keyUp(k) { fire('POST', `/api/key/up/${encodeURIComponent(k)}`); }
function keyPress(k) { fire('POST', `/api/key/${encodeURIComponent(k)}`); }
function mouseDown(btn) { fire('POST', `/api/mouse/down/${btn}`); }
function mouseUp(btn) { fire('POST', `/api/mouse/up/${btn}`); }
function mouseMove(dx, dy) { fire('POST', '/api/mouse/move', { x: dx, y: dy, absolute: false }); }
function mouseWheel(delta) { fire('POST', '/api/mouse/scroll', { delta }); }
function mouseClick(btn) { fire('POST', `/api/mouse/click/${btn}`); }

// ==================== TABS (динамические, из ui-конфига) ====================
let currentTab = 'main';

const TAB_DEFS = [
    { id: 'main', label: 'Main' },
    { id: 'monitor', label: 'Monitor' },
    { id: 'mouse', label: 'Mouse' },
    { id: 'keys', label: 'Keys' },
    { id: 'stream', label: 'Stream' },
    { id: 'game', label: 'Game' },
];
const SETTINGS_TAB = { id: 'settings', label: 'Settings' };
function allTabDefs() { return [...TAB_DEFS, SETTINGS_TAB]; }

// Хуки вкладок: модули регистрируют своё поведение при входе/выходе
// (стрим, геймпад, вьюпорты и т.д.) — ядро не знает деталей
const tabEnterHooks = [];  // fn(id)
const tabLeaveHooks = [];  // fn(oldId, newId)

function switchToTab(id) {
    $$('.tab').forEach(x => x.classList.remove('active'));
    $$('.content').forEach(x => x.classList.remove('active'));
    const btn = document.querySelector(`.tab[data-tab="${id}"]`);
    if (btn) btn.classList.add('active');
    const content = $('#tab-' + id);
    if (content) content.classList.add('active');
    hideTabMenu();

    const prev = currentTab;
    currentTab = id;
    if (prev !== id) tabLeaveHooks.forEach(h => { try { h(prev, id); } catch (e) { console.error(e); } });
    tabEnterHooks.forEach(h => { try { h(id); } catch (e) { console.error(e); } });
}

function renderTabs() {
    const bar = $('#tab-bar');
    if (!bar) return;
    bar.innerHTML = '';

    allTabDefs().forEach(t => {
        const tc = (uiCfg.tabs && uiCfg.tabs[t.id]) || {};
        if (tc.visible === false || tc.inDropdown) return;
        const b = document.createElement('button');
        b.className = 'tab' + (t.id === currentTab ? ' active' : '');
        b.dataset.tab = t.id;
        b.textContent = t.label;
        b.onclick = () => switchToTab(t.id);
        bar.appendChild(b);
    });

    const more = document.createElement('button');
    more.className = 'tab tab-more';
    more.textContent = '⋯';
    more.onclick = e => { e.stopPropagation(); toggleTabMenu(); };
    bar.appendChild(more);

    const menu = document.createElement('div');
    menu.className = 'tab-menu';
    menu.id = 'tab-menu';
    bar.appendChild(menu);
}

function toggleTabMenu() {
    const menu = $('#tab-menu');
    if (!menu) return;
    if (menu.classList.contains('show')) { hideTabMenu(); return; }

    menu.innerHTML = '';
    let any = false;
    allTabDefs().forEach(t => {
        const tc = (uiCfg.tabs && uiCfg.tabs[t.id]) || {};
        if (tc.visible === false || !tc.inDropdown) return;
        any = true;
        const b = document.createElement('button');
        b.className = 'tab-menu-item';
        b.textContent = t.label;
        b.onclick = () => switchToTab(t.id);
        menu.appendChild(b);
    });
    if (any) menu.classList.add('show');
}

function hideTabMenu() {
    $('#tab-menu')?.classList.remove('show');
}

document.addEventListener('click', e => {
    if (!e.target.closest('#tab-menu') && !e.target.closest('.tab-more')) hideTabMenu();
});

// ==================== STATUS ====================
async function updateStatus() {
    try {
        const vol = await apiS('GET', '/api/volume');
        if (vol && vol.volume !== undefined && vol.volume >= 0) {
            setVolumeUI(vol.volume);
        }
        const wg = await apiS('GET', '/api/wg/status');
        if (wg && wg.status) {
            $('#wg-status').textContent = wg.status;
            $('#wg-dot').classList.toggle('on', wg.status === 'Running');
        }
        const layout = await apiS('GET', '/api/keyboard/layout');
        if (layout && layout.layout) {
            $('#layout-badge').textContent = layout.layout;
        }
        if (currentTab === 'monitor') updateMonitor();
        refreshWidgetSliders();
    } catch (e) {
        console.error('updateStatus', e);
    }
}

function setVolumeUI(v) {
    $('#vol-display').textContent = v + '%';
    $('#vol-value').textContent = v + '%';
    $('#vol-slider').value = v;
    $('#vol-slider').style.setProperty('--val', v + '%');
}

async function toggleWireGuard() {
    toast('Toggling...');
    await api('POST', '/api/wg/toggle');
    setTimeout(updateStatus, 500);
}

function toggleLayout() {
    api('POST', '/api/keyboard/layout/toggle').then(() => setTimeout(updateStatus, 200));
}

// ==================== VOLUME ====================
let volTimeout;
$('#vol-slider').oninput = function () {
    const v = this.value;
    setVolumeUI(v);
    clearTimeout(volTimeout);
    volTimeout = setTimeout(() => apiS('POST', '/api/volume/set', { level: parseInt(v) }), 100);
};

async function volAction(action) {
    if (action === 'mute') {
        await apiS('POST', '/api/volume/mute');
    } else if (action === 'up') {
        await apiS('POST', '/api/key/volup');
    } else if (action === 'down') {
        await apiS('POST', '/api/key/voldown');
    }
    setTimeout(updateStatus, 200);
}

// ==================== AUDIO DEVICES ====================
async function loadAudioDevices() {
    const d = await apiS('GET', '/api/audio/devices');
    const sel = $('#audio-device');
    if (d && d.success && d.devices && d.devices.length) {
        sel.innerHTML = d.devices.map(x =>
            `<option value="${x.name}"${x.isDefault ? ' selected' : ''}>${x.name}</option>`
        ).join('');
    } else {
        sel.innerHTML = '<option>No devices</option>';
    }
}

$('#audio-device').onchange = async function () {
    const name = this.value;
    toast('Switching...');
    const result = await api('POST', '/api/audio/device', { name }, true);
    if (result && result.success) {
        toast('Switched to: ' + name);
    } else {
        toast('Failed to switch');
    }
    setTimeout(() => {
        loadAudioDevices();
        updateStatus();
    }, 1000);
};

// ==================== GLOBAL TOUCH STATE ====================
const activeTouches = new Map();

// ==================== MOUSE BUTTONS ====================
document.querySelectorAll('.mouse-btn').forEach(btn => {
    const btnType = btn.dataset.btn;
    if (!btnType) return;

    btn.addEventListener('touchstart', e => {
        e.preventDefault();
        e.stopPropagation();
        for (const touch of e.changedTouches) {
            activeTouches.set(touch.identifier, 'button');
        }
        btn.classList.add('active');
        fire('POST', `/api/mouse/down/${btnType}`);
    }, { passive: false, capture: true });

    btn.addEventListener('touchend', e => {
        e.preventDefault();
        e.stopPropagation();
        for (const touch of e.changedTouches) {
            activeTouches.delete(touch.identifier);
        }
        btn.classList.remove('active');
        fire('POST', `/api/mouse/up/${btnType}`);
    }, { passive: false, capture: true });

    btn.addEventListener('touchcancel', e => {
        for (const touch of e.changedTouches) {
            activeTouches.delete(touch.identifier);
        }
        btn.classList.remove('active');
        fire('POST', `/api/mouse/up/${btnType}`);
    }, { capture: true });

    btn.addEventListener('mousedown', () => {
        if ('ontouchstart' in window) return;
        btn.classList.add('active');
        fire('POST', `/api/mouse/down/${btnType}`);
    });

    btn.addEventListener('mouseup', () => {
        if ('ontouchstart' in window) return;
        btn.classList.remove('active');
        fire('POST', `/api/mouse/up/${btnType}`);
    });

    btn.addEventListener('mouseleave', () => {
        if (btn.classList.contains('active')) {
            btn.classList.remove('active');
            fire('POST', `/api/mouse/up/${btnType}`);
        }
    });
});

// ==================== TOUCHPAD ====================
function initTouchpad(id, sensKey) {
    const pad = document.getElementById(id);
    if (!pad) return;

    let lastPos = null;
    let tapStartTime = 0;
    let hasMoved = false;
    let firstTapTime = 0;
    let waitingSecondTap = false;
    let isDragging = false;
    let dragStarted = false;
    let singleTapTimer = null;
    let dragTimer = null;
    let padTouches = new Set();

    const TAP_TIMEOUT = 280;
    const DRAG_DELAY = 140;

    // Edge-зоны (8 направлений): палец у края — курсор уезжает
    let edgeTimer = null, edgeEx = 0, edgeEy = 0;
    const edgeZoneEl = pad.querySelector('.pad-edge-zone');
    function edgeStart(dx, dy) {
        edgeEx = dx; edgeEy = dy;
        if (!edgeTimer) {
            edgeTimer = setInterval(() => fire('POST', '/api/mouse/move', { x: edgeEx, y: edgeEy }), 16);
            pad.classList.add('edge-active');
        }
    }
    function edgeStop() {
        if (edgeTimer) { clearInterval(edgeTimer); edgeTimer = null; }
        pad.classList.remove('edge-active');
    }
    function edgeCheck(touch) {
        const st = uiCfg.settings;
        if (!st.edgeEnabled) return false;
        const r = pad.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        const nx = (touch.clientX - r.left) / r.width;
        const ny = (touch.clientY - r.top) / r.height;
        const edge = (st.edgeSize || 10) / 100;
        const sp = st.edgeSpeed || 30;
        let ex = 0, ey = 0;
        if (nx < edge) ex = -sp; else if (nx > 1 - edge) ex = sp;
        if (ny < edge) ey = -sp; else if (ny > 1 - edge) ey = sp;
        if (ex || ey) { edgeStart(ex, ey); return true; }
        return false;
    }

    pad.addEventListener('touchstart', e => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            if (activeTouches.get(touch.identifier) === 'button') continue;
            activeTouches.set(touch.identifier, 'touchpad');
            padTouches.add(touch.identifier);
        }

        const count = padTouches.size;
        if (count === 0) return;

        pad.classList.add('active');

        let touchOnPad = null;
        for (const touch of e.touches) {
            if (padTouches.has(touch.identifier)) {
                touchOnPad = touch;
                break;
            }
        }
        if (!touchOnPad) return;

        if (count >= 2) {
            let sumX = 0, sumY = 0, n = 0;
            for (const touch of e.touches) {
                if (padTouches.has(touch.identifier)) {
                    sumX += touch.clientX;
                    sumY += touch.clientY;
                    n++;
                }
            }
            lastPos = { x: sumX / n, y: sumY / n };
            clearTimeout(singleTapTimer);
            clearTimeout(dragTimer);
            waitingSecondTap = false;
            isDragging = false;
            return;
        }

        lastPos = { x: touchOnPad.clientX, y: touchOnPad.clientY };
        tapStartTime = Date.now();
        hasMoved = false;

        if (waitingSecondTap && (Date.now() - firstTapTime) < TAP_TIMEOUT) {
            clearTimeout(singleTapTimer);
            waitingSecondTap = false;
            isDragging = true;
            dragTimer = setTimeout(() => {
                if (isDragging && !hasMoved && !dragStarted) {
                    dragStarted = true;
                    pad.classList.add('dragging');
                    fire('POST', '/api/mouse/down/left');
                }
            }, DRAG_DELAY);
        }
    }, { passive: false });

    pad.addEventListener('touchmove', e => {
        e.preventDefault();
        if (!lastPos) return;

        const padTouchList = [];
        for (const touch of e.touches) {
            if (padTouches.has(touch.identifier)) {
                padTouchList.push(touch);
            }
        }

        const count = padTouchList.length;
        if (count === 0) return;

        if (count >= 2) {
            let sumX = 0, sumY = 0;
            for (const t of padTouchList) {
                sumX += t.clientX;
                sumY += t.clientY;
            }
            const cx = sumX / count;
            const cy = sumY / count;
            const dy = lastPos.y - cy;
            lastPos = { x: cx, y: cy };
            if (Math.abs(dy) > 1) {
                fire('POST', '/api/mouse/scroll', { delta: Math.round(-dy * 4) });
            }
        } else {
            const touch = padTouchList[0];

            // edge-зона: фиксируем позицию, чтобы не было скачка при выходе
            if (!isDragging && edgeCheck(touch)) {
                lastPos = { x: touch.clientX, y: touch.clientY };
                hasMoved = true;
                return;
            }
            edgeStop();

            const dx = touch.clientX - lastPos.x;
            const dy = touch.clientY - lastPos.y;

            if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
                hasMoved = true;
                lastPos = { x: touch.clientX, y: touch.clientY };

                if (isDragging && !dragStarted) {
                    clearTimeout(dragTimer);
                    dragStarted = true;
                    pad.classList.add('dragging');
                    fire('POST', '/api/mouse/down/left');
                }

                const sens = (uiCfg.settings[sensKey] || 18) / 10;
                const moveDx = Math.round(dx * sens);
                const moveDy = Math.round(dy * sens);
                if (moveDx || moveDy) {
                    fire('POST', '/api/mouse/move', { x: moveDx, y: moveDy });
                }
            }
        }
    }, { passive: false });

    pad.addEventListener('touchend', e => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            padTouches.delete(touch.identifier);
            activeTouches.delete(touch.identifier);
        }

        const remaining = padTouches.size;

        if (remaining === 0) {
            pad.classList.remove('active', 'dragging');
            clearTimeout(dragTimer);
            edgeStop();

            if (dragStarted) {
                fire('POST', '/api/mouse/up/left');
                isDragging = false;
                dragStarted = false;
            } else if (isDragging) {
                isDragging = false;
                fire('POST', '/api/mouse/click/double');
            } else if (!hasMoved && (Date.now() - tapStartTime) < TAP_TIMEOUT) {
                firstTapTime = Date.now();
                waitingSecondTap = true;
                singleTapTimer = setTimeout(() => {
                    if (waitingSecondTap) {
                        waitingSecondTap = false;
                        fire('POST', '/api/mouse/click/left');
                    }
                }, TAP_TIMEOUT);
            }
            lastPos = null;
        } else {
            let sumX = 0, sumY = 0, n = 0;
            for (const touch of e.touches) {
                if (padTouches.has(touch.identifier)) {
                    sumX += touch.clientX;
                    sumY += touch.clientY;
                    n++;
                }
            }
            if (n > 0) {
                lastPos = { x: sumX / n, y: sumY / n };
            }
        }
    }, { passive: false });

    pad.addEventListener('touchcancel', e => {
        for (const touch of e.changedTouches) {
            padTouches.delete(touch.identifier);
            activeTouches.delete(touch.identifier);
        }
        if (padTouches.size === 0) {
            pad.classList.remove('active', 'dragging');
            edgeStop();
            if (dragStarted) {
                fire('POST', '/api/mouse/up/left');
            }
            clearTimeout(singleTapTimer);
            clearTimeout(dragTimer);
            isDragging = false;
            dragStarted = false;
            waitingSecondTap = false;
            lastPos = null;
        }
    });
}

initTouchpad('touchpad', 'mouseSens');
initTouchpad('stream-touchpad', 'streamSens');

// ==================== KEYBOARD ====================
const liveInput = $('#live-input');
if (liveInput) {
    let buffer = '';
    let sendTimer = null;

    liveInput.oninput = e => {
        const data = e.data;
        if (data) buffer += data;
        clearTimeout(sendTimer);
        sendTimer = setTimeout(() => {
            if (buffer) {
                apiS('POST', '/api/type', { text: buffer });
                buffer = '';
            }
            liveInput.value = '';
        }, 120);
    };

    liveInput.onkeydown = e => {
        const map = {
            Backspace: 'backspace', Enter: 'enter', Tab: 'tab', Escape: 'esc',
            ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'
        };
        if (map[e.key]) {
            e.preventDefault();
            if (buffer) {
                apiS('POST', '/api/type', { text: buffer });
                buffer = '';
                liveInput.value = '';
            }
            apiS('POST', '/api/key/' + map[e.key]);
        }
    };
}

function sendText() {
    const inp = $('#text-input');
    if (inp && inp.value) {
        api('POST', '/api/type', { text: inp.value });
        inp.value = '';
    }
}

const streamInput = $('#stream-input');
const streamControls = $('#stream-controls');

if (streamInput) {
    let buffer = '';
    let sendTimer = null;

    streamInput.oninput = e => {
        const data = e.data;
        if (data) buffer += data;
        clearTimeout(sendTimer);
        sendTimer = setTimeout(() => {
            if (buffer) {
                apiS('POST', '/api/type', { text: buffer });
                buffer = '';
            }
            streamInput.value = '';
        }, 120);
    };

    streamInput.onkeydown = e => {
        const map = {
            Backspace: 'backspace', Enter: 'enter', Tab: 'tab', Escape: 'esc',
            ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'
        };
        if (map[e.key]) {
            e.preventDefault();
            if (buffer) {
                apiS('POST', '/api/type', { text: buffer });
                buffer = '';
                streamInput.value = '';
            }
            apiS('POST', '/api/key/' + map[e.key]);
        }
    };

    streamInput.onfocus = () => streamControls.classList.add('kb-mode');
    streamInput.onblur = () => streamControls.classList.remove('kb-mode');

    // Софтклава на телефоне закрывается кнопкой "назад" без blur'а —
    // детектим по возвращению высоты visualViewport
    if (window.visualViewport) {
        let kbWasOpen = false;
        window.visualViewport.addEventListener('resize', () => {
            const h = window.visualViewport.height;
            const open = h < window.innerHeight * 0.9;
            if (!kbWasOpen && open) kbWasOpen = true;
            else if (kbWasOpen && !open) {
                kbWasOpen = false;
                if (streamControls.classList.contains('kb-mode')) {
                    streamControls.classList.remove('kb-mode');
                }
            }
        });
    }
}

$('#btn-toggle-kb')?.addEventListener('click', () => {
    if (streamControls.classList.contains('kb-mode')) {
        streamControls.classList.remove('kb-mode');
        streamInput.blur();
    } else {
        streamControls.classList.add('kb-mode');
        setTimeout(() => streamInput.focus(), 50);
    }
});

// ==================== SHUTDOWN ====================
let cancelLeft = 0, cancelTick = null;

function openShutdownPrompt() { $('#shutdown-modal').classList.add('show'); }
function closeShutdownPrompt() { $('#shutdown-modal').classList.remove('show'); }

async function scheduleShutdown(delay) {
    if (delay === 0 && !confirm('Мгновенно? Без шанса спастись. (режим троллинга)')) return;
    closeShutdownPrompt();
    const d = await apiS('POST', '/api/system/shutdown', delay === 0 ? { instant: true } : { delay });
    if (d && d.success) {
        toast(delay === 0 ? 'Выключение...' : `Выключение через ${d.delay} сек`);
        if (delay > 0) showCancelShutdown(d.delay);
    } else {
        toast('Shutdown failed');
    }
}

function showCancelShutdown(seconds) {
    cancelLeft = seconds;
    $('#btn-shutdown').style.display = 'none';
    const btn = $('#btn-cancel-shutdown');
    btn.style.display = '';
    btn.textContent = `⏹ Cancel (${cancelLeft})`;
    clearInterval(cancelTick);
    cancelTick = setInterval(() => {
        cancelLeft--;
        if (cancelLeft <= 0) { hideCancelShutdown(); return; }
        btn.textContent = `⏹ Cancel (${cancelLeft})`;
    }, 1000);
}

function hideCancelShutdown() {
    clearInterval(cancelTick);
    $('#btn-cancel-shutdown').style.display = 'none';
    $('#btn-shutdown').style.display = '';
}

async function cancelScheduledShutdown() {
    await apiS('POST', '/api/system/shutdown/cancel');
    hideCancelShutdown();
    toast('Cancelled');
}

// ==================== SERVER CONFIG ====================
async function loadConfigText() {
    const d = await apiS('GET', '/api/system/config');
    const ta = $('#cfg-text');
    if (!ta) return;
    if (d && d.success) ta.value = d.content;
    else ta.value = '// ' + ((d && d.error) || 'failed to load');
}

async function saveConfigText() {
    const content = $('#cfg-text').value;
    try { JSON.parse(content); } catch { toast('Invalid JSON'); return; }
    const d = await apiS('POST', '/api/system/config', { content });
    toast(d && d.success ? 'Saved (Port — after restart)' : 'Save failed');
}

async function restartServer() {
    if (!confirm('Restart the server? (a few seconds of downtime)')) return;
    toast('Restarting...');
    await apiS('POST', '/api/system/restart');
    let tries = 0;
    const t = setInterval(async () => {
        tries++;
        const d = await apiS('GET', '/api/system/info');
        if (d && d.Success) {
            clearInterval(t);
            toast('Server is up');
            loadConfigText();
        } else if (tries > 30) {
            clearInterval(t);
            toast('No response — check the server');
        }
    }, 1000);
}


// ==================== UI CONFIG (raw, схему держит клиент) ====================
const UI_DEFAULTS = {
    tabs: { mouse: { inDropdown: true }, settings: { inDropdown: true } },
    settings: { mouseSens: 18, streamSens: 18, edgeEnabled: true, edgeSize: 10, edgeSpeed: 30 },
    widgets: { main: [], monitor: [], mouse: [], keys: [] },
    game: {
        // Глобальные параметры Game: один sens для всех тачпадоподобных элементов,
        // edge-зоны в ПИКСЕЛЯХ; всё переопределяется на конкретном элементе (null = глобальное)
        settings: { sens: 15, lmbTap: true, edgeEnabled: true, edgeSizePx: 20, edgeSpeed: 12 },
        // Профили per-host (ключ — IP): { profiles: [{id,name,elements}], lastUsed: id }
        hosts: {}
    }
};

let uiCfg = JSON.parse(JSON.stringify(UI_DEFAULTS));

// Модули подписываются на готовность конфига
const uiReadyHooks = []; // fn()

function mergeGameCfg(g) {
    const base = JSON.parse(JSON.stringify(UI_DEFAULTS.game));
    if (!g) return base;
    return {
        settings: Object.assign(base.settings, g.settings || {}),
        hosts: g.hosts || {}
    };
}

async function loadUiConfig() {
    const d = await apiS('GET', '/api/ui');
    if (d && d.success && d.config) {
        const c = d.config;
        uiCfg.tabs = Object.assign({}, UI_DEFAULTS.tabs, c.tabs || {});
        uiCfg.settings = Object.assign({}, UI_DEFAULTS.settings, c.settings || {});
        uiCfg.widgets = Object.assign({}, UI_DEFAULTS.widgets, c.widgets || {});
        uiCfg.game = mergeGameCfg(c.game);
    }
    renderTabs();
    uiReadyHooks.forEach(h => { try { h(); } catch (e) { console.error(e); } });
}

async function saveUiConfig() {
    const d = await apiS('POST', '/api/ui', { config: uiCfg });
    if (!(d && d.success)) console.error('ui save failed');
    return d;
}

let uiSaveTimer = null;
function saveUiConfigSoon() {
    clearTimeout(uiSaveTimer);
    uiSaveTimer = setTimeout(saveUiConfig, 300);
}

// ==================== ОБЩИЕ ХЕЛПЕРЫ ДЛЯ МОДАЛОК ====================
function showModal(id) { document.getElementById(id)?.classList.add('show'); }
function hideModal(id) { document.getElementById(id)?.classList.remove('show'); }

// Закрытие модалки тапом по фону
document.addEventListener('click', e => {
    if (e.target.classList && e.target.classList.contains('rc-modal-overlay') && e.target.dataset.static === undefined) {
        e.target.classList.remove('show');
    }
});

function uid() { return Math.random().toString(36).substring(2, 10); }
