// ============================================================================
// blocks.js — builtin-блоки: сложные механизмы как единые элементы страниц
// (двигаются/ресайзятся/удаляются целиком, внутренности не редактируются).
//
// Типы: blk-monitor-cmm | blk-monitor-ddc | blk-mousepad | blk-live-input |
//       blk-send-text | blk-audio | blk-shutdown
// ============================================================================

const BLOCK_DEFS = {
    'blk-monitor-cmm': { label: 'Monitor (ControlMyMonitor)', w: 96, h: 300 },
    'blk-monitor-ddc': { label: 'Monitor low-level (dxva2)', w: 96, h: 330 },
    'blk-mousepad': { label: 'Mouse touchpad (gestures)', w: 96, h: 300 },
    'blk-live-input': { label: 'Live keyboard input', w: 96, h: 60 },
    'blk-send-text': { label: 'Send text (batch)', w: 96, h: 110 },
    'blk-audio': { label: 'Audio output select', w: 96, h: 60 },
    'blk-shutdown': { label: 'Shutdown PC buttons', w: 96, h: 60 }
};

function buildBlockBody(el, ctx) {
    const body = document.createElement('div');
    body.className = 'ge-block ' + el.type;

    switch (el.type) {
        case 'blk-monitor-cmm': buildMonitorCmmBlock(body, ctx); break;
        case 'blk-monitor-ddc': buildMonitorDdcBlock(body, ctx); break;
        case 'blk-mousepad': buildMousepadBlock(el, body, ctx); break;
        case 'blk-live-input': buildLiveInputBlock(body, ctx); break;
        case 'blk-send-text': buildSendTextBlock(body, ctx); break;
        case 'blk-audio': buildAudioBlock(body, ctx); break;
        case 'blk-shutdown': buildShutdownBlock(body, ctx); break;
        default: return null;
    }

    if (ctx.edit) {
        // в редакторе блок «заморожен»: двигаем/ресайзим как единое целое
        const shield = document.createElement('div');
        shield.className = 'blk-shield';
        body.appendChild(shield);
    }
    return body;
}

// ==================== MONITOR: старый путь (ControlMyMonitor) ====================
// Старый функционал сохранён как был; состояние с dxva2-блоком не разделяет.

function buildMonitorCmmBlock(body, ctx) {
    body.innerHTML = `
        <h2>Monitor <span class="monitor-name" id="mon-name"></span></h2>
        <div id="mon-unavailable" class="monitor-warning" style="display:none">
            ControlMyMonitor.exe not found.<br>
            Положи exe рядом с сервером или укажи путь в appsettings: <b>Monitor:CmmPath</b>
        </div>
        <div class="volume-row">
            <span class="volume-value" id="mon-brightness-val">--</span>
            <input type="range" min="0" max="100" value="50" step="1" class="volume-slider" id="mon-brightness-slider">
        </div>
        <div class="monitor-input-row">
            <input type="number" class="keyboard-input" id="mon-brightness-input" min="0" max="100" step="1" placeholder="0-100" inputmode="numeric">
            <button class="btn btn-primary" data-act="apply">Apply</button>
        </div>
        <div class="buttons">
            <button class="btn btn-success btn-wide" data-act="on">On</button>
            <button class="btn btn-danger btn-wide" data-act="off">Off</button>
            <button class="btn btn-dark btn-wide" data-act="toggle">Switch</button>
        </div>
        <div class="monitor-status" id="mon-power">Power: --</div>`;

    if (ctx.edit) return;

    let monTimeout = null;
    const slider = body.querySelector('#mon-brightness-slider');
    const input = body.querySelector('#mon-brightness-input');

    slider.oninput = function () {
        const v = parseInt(this.value);
        const max = parseInt(this.max) || 100;
        body.querySelector('#mon-brightness-val').textContent = v + '%';
        input.value = v;
        this.style.setProperty('--val', Math.min(100, v / max * 100) + '%');
        clearTimeout(monTimeout);
        monTimeout = setTimeout(() => apiS('POST', '/api/monitor/brightness', { level: v }), 150);
    };

    input.addEventListener('keydown', e => { if (e.key === 'Enter') applyMonitorBrightness(); });

    body.querySelectorAll('[data-act]').forEach(b => {
        const act = b.dataset.act;
        b.addEventListener('click', () => act === 'apply' ? applyMonitorBrightness() : monPower(act));
    });

    updateMonitor();
    if (ctx.registerRefresh) ctx.registerRefresh({ id: 'mon-cmm' }, updateMonitor);
}

function setMonitorBrightnessUI(v, max) {
    max = max || 100;
    const s = $('#mon-brightness-slider');
    if (!s) return;
    s.max = max;
    s.value = v;
    s.style.setProperty('--val', Math.min(100, v / max * 100) + '%');
    $('#mon-brightness-val').textContent = v + '%';
}

async function updateMonitor() {
    if (!$('#mon-brightness-slider')) return;
    const d = await apiS('GET', '/api/monitor/state');
    if (!d) return;
    const unav = $('#mon-unavailable');
    if (unav) unav.style.display = d.available ? 'none' : 'block';
    if (d.monitor && $('#mon-name')) $('#mon-name').textContent = d.monitor;

    if (d.brightness != null) {
        setMonitorBrightnessUI(d.brightness, d.brightnessMax);
        const inp = $('#mon-brightness-input');
        if (inp) inp.value = d.brightness;
    }

    const st = $('#mon-power');
    if (!st) return;
    if (d.powerKnown) {
        st.textContent = d.powerOn ? 'Power: on' : 'Power: off (standby)';
        st.classList.toggle('on', d.powerOn);
    } else if (d.available) {
        st.textContent = 'Power: --';
        st.classList.remove('on');
    }
}

async function applyMonitorBrightness() {
    const inp = $('#mon-brightness-input');
    if (!inp) return;
    let v = parseInt(inp.value);
    if (isNaN(v)) return;
    const max = parseInt($('#mon-brightness-slider').max) || 100;
    v = Math.max(0, Math.min(max, v));
    inp.value = v;
    setMonitorBrightnessUI(v, max);
    const d = await apiS('POST', '/api/monitor/brightness', { level: v });
    if (d && d.brightness != null) setMonitorBrightnessUI(d.brightness, max);
}

async function monPower(action) {
    toast(action === 'on' ? 'Turning on...' : action === 'off' ? 'Turning off...' : 'Switching...');
    await api('POST', '/api/monitor/power', { action }, true);
    setTimeout(updateMonitor, 800);
}

// ==================== MONITOR: низкоуровневый (dxva2 DDC/CI) ====================
// Экспериментальный параллельный путь; выпиливается независимо.

let mon2Index = 0;

function buildMonitorDdcBlock(body, ctx) {
    body.innerHTML = `
        <h2>Monitor · Low-level (dxva2 DDC/CI)</h2>
        <div id="mon2-unavailable" class="monitor-warning" style="display:none">DDC/CI мониторы не найдены (dxva2)</div>
        <select class="device-select" id="mon2-select"></select>
        <div class="volume-row">
            <span class="volume-value" id="mon2-brightness-val">--</span>
            <input type="range" min="0" max="100" value="50" step="1" class="volume-slider" id="mon2-brightness-slider">
        </div>
        <div class="monitor-input-row">
            <input type="number" class="keyboard-input" id="mon2-brightness-input" min="0" max="100" step="1" placeholder="0-100" inputmode="numeric">
            <button class="btn btn-primary" data-act="apply">Apply</button>
        </div>
        <div class="buttons">
            <button class="btn btn-success btn-wide" data-act="on">On</button>
            <button class="btn btn-danger btn-wide" data-act="off">Off</button>
            <button class="btn btn-dark btn-wide" data-act="toggle">Switch</button>
        </div>
        <div class="monitor-status" id="mon2-power">Power: --</div>
        <div class="mon2-note">Экспериментально: прямой WinAPI, без ControlMyMonitor.</div>`;

    if (ctx.edit) return;

    let mon2Timeout = null;
    const slider = body.querySelector('#mon2-brightness-slider');
    const input = body.querySelector('#mon2-brightness-input');

    body.querySelector('#mon2-select').addEventListener('change', function () {
        mon2Index = parseInt(this.value) || 0;
        updateMonitor2();
    });

    slider.addEventListener('input', function () {
        const v = parseInt(this.value);
        const max = parseInt(this.max) || 100;
        body.querySelector('#mon2-brightness-val').textContent = v + '%';
        input.value = v;
        this.style.setProperty('--val', Math.min(100, v / max * 100) + '%');
        clearTimeout(mon2Timeout);
        mon2Timeout = setTimeout(() => apiS('POST', '/api/monitor2/brightness', { level: v, index: mon2Index }), 150);
    });

    input.addEventListener('keydown', e => { if (e.key === 'Enter') applyMonitor2Brightness(); });

    body.querySelectorAll('[data-act]').forEach(b => {
        const act = b.dataset.act;
        b.addEventListener('click', () => act === 'apply' ? applyMonitor2Brightness() : mon2Power(act));
    });

    updateMonitor2();
    if (ctx.registerRefresh) ctx.registerRefresh({ id: 'mon-ddc' }, updateMonitor2);
}

function setMonitor2BrightnessUI(v, max) {
    max = max || 100;
    const s = $('#mon2-brightness-slider');
    if (!s) return;
    s.max = max;
    s.value = v;
    s.style.setProperty('--val', Math.min(100, v / max * 100) + '%');
    $('#mon2-brightness-val').textContent = v + '%';
}

async function updateMonitor2() {
    if (!$('#mon2-brightness-slider')) return;
    const d = await apiS('GET', '/api/monitor2/state?index=' + mon2Index);
    if (!d) return;

    const unav = $('#mon2-unavailable');
    if (unav) unav.style.display = d.available ? 'none' : 'block';

    const sel = $('#mon2-select');
    if (sel && d.monitors) {
        sel.innerHTML = d.monitors.length
            ? d.monitors.map(m => `<option value="${m.index}"${m.index === mon2Index ? ' selected' : ''}>${m.index}: ${m.description}</option>`).join('')
            : '<option>No DDC/CI monitors</option>';
    }

    if (d.brightness != null) {
        setMonitor2BrightnessUI(d.brightness, d.brightnessMax || 100);
        const inp = $('#mon2-brightness-input');
        if (inp) inp.value = d.brightness;
    }

    const st = $('#mon2-power');
    if (!st) return;
    if (d.powerKnown) {
        st.textContent = d.powerOn ? 'Power: on' : 'Power: off (standby)';
        st.classList.toggle('on', d.powerOn);
    } else {
        st.textContent = 'Power: --';
        st.classList.remove('on');
    }
}

async function applyMonitor2Brightness() {
    const inp = $('#mon2-brightness-input');
    if (!inp) return;
    let v = parseInt(inp.value);
    if (isNaN(v)) return;
    v = Math.max(0, Math.min(100, v));
    inp.value = v;
    setMonitor2BrightnessUI(v, parseInt($('#mon2-brightness-slider').max) || 100);
    await apiS('POST', '/api/monitor2/brightness', { level: v, index: mon2Index });
}

async function mon2Power(action) {
    toast(action === 'on' ? 'DDC: turning on...' : action === 'off' ? 'DDC: turning off...' : 'DDC: switching...');
    await api('POST', '/api/monitor2/power', { action, index: mon2Index }, true);
    setTimeout(updateMonitor2, 1500);
}

// ==================== MOUSEPAD (жесты: tap/dbltap/drag, 2 пальца = скролл) ====================

function buildMousepadBlock(el, body, ctx) {
    body.innerHTML = `
        <div class="touchpad blk-pad">
            <div class="pad-edge-zone"></div>
            <div>Drag to move</div>
            <div class="touchpad-hint">Tap | DoubleTap | Tap-Hold-Drag</div>
            <div class="touchpad-hint">Two fingers = Scroll</div>
        </div>`;
    const pad = body.querySelector('.blk-pad');
    const s = uiCfg.settings;
    pad.querySelector('.pad-edge-zone').style.setProperty('--edge-size', (s.edgeSize || 10) + '%');
    if (s.edgeEnabled === false) pad.querySelector('.pad-edge-zone').style.display = 'none';
    if (!ctx.edit) initTouchpad(pad, el.sensKey || 'mouseSens');
}

// ==================== KEYBOARD БЛОКИ ====================

function buildLiveInputBlock(body, ctx) {
    body.innerHTML = `<h2>Live Input (realtime)</h2>
        <input type="text" class="keyboard-input" placeholder="Type here - sends instantly..." autocomplete="off">`;
    if (ctx.edit) return;

    const inp = body.querySelector('input');
    let buffer = '';
    let sendTimer = null;

    inp.oninput = e => {
        const data = e.data;
        if (data) buffer += data;
        clearTimeout(sendTimer);
        sendTimer = setTimeout(() => {
            if (buffer) {
                apiS('POST', '/api/type', { text: buffer });
                buffer = '';
            }
            inp.value = '';
        }, 120);
    };

    inp.onkeydown = e => {
        const map = {
            Backspace: 'backspace', Enter: 'enter', Tab: 'tab', Escape: 'esc',
            ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'
        };
        if (map[e.key]) {
            e.preventDefault();
            if (buffer) {
                apiS('POST', '/api/type', { text: buffer });
                buffer = '';
                inp.value = '';
            }
            apiS('POST', '/api/key/' + map[e.key]);
        }
    };
}

function buildSendTextBlock(body, ctx) {
    body.innerHTML = `<h2>Send Text (batch)</h2>
        <input type="text" class="keyboard-input" placeholder="Type, then press Send..." autocomplete="off">
        <div class="buttons" style="margin-top:8px">
            <button class="btn btn-primary btn-wide" data-act="send">Send</button>
            <button class="btn btn-dark" data-act="clear">Clear</button>
        </div>`;
    if (ctx.edit) return;

    const inp = body.querySelector('input');
    body.querySelector('[data-act="send"]').addEventListener('click', () => {
        if (inp.value) {
            api('POST', '/api/type', { text: inp.value });
            inp.value = '';
        }
    });
    body.querySelector('[data-act="clear"]').addEventListener('click', () => { inp.value = ''; });
}

// ==================== AUDIO ====================

function buildAudioBlock(body, ctx) {
    body.innerHTML = `<select class="device-select"></select>`;
    if (ctx.edit) return;
    const sel = body.querySelector('select');

    const load = async () => {
        const d = await apiS('GET', '/api/audio/devices');
        if (!sel.isConnected && ctx.registerRefresh) return;
        if (d && d.success && d.devices && d.devices.length) {
            sel.innerHTML = d.devices.map(x =>
                `<option value="${x.name}"${x.isDefault ? ' selected' : ''}>${x.name}</option>`
            ).join('');
        } else {
            sel.innerHTML = '<option>No devices</option>';
        }
    };

    sel.onchange = async function () {
        const name = this.value;
        toast('Switching...');
        const result = await api('POST', '/api/audio/device', { name }, true);
        toast(result && result.success ? 'Switched to: ' + name : 'Failed to switch');
        setTimeout(() => { load(); updateStatus(); }, 1000);
    };

    load();
}

// ==================== SHUTDOWN ====================

function buildShutdownBlock(body, ctx) {
    body.innerHTML = `
        <div class="buttons">
            <button class="btn btn-danger btn-wide" id="btn-shutdown">⏻ Shutdown PC</button>
            <button class="btn btn-dark btn-wide" id="btn-cancel-shutdown" style="display:none">⏹ Cancel</button>
        </div>`;
    if (ctx.edit) return;
    body.querySelector('#btn-shutdown').addEventListener('click', openShutdownPrompt);
    body.querySelector('#btn-cancel-shutdown').addEventListener('click', cancelScheduledShutdown);
}
