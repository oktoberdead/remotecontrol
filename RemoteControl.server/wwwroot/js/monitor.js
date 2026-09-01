// ============================================================================
// monitor.js — вкладка Monitor: старый путь (ControlMyMonitor) — как был,
// плюс НОВЫЙ низкоуровневый путь (dxva2 DDC/CI, /api/monitor2/*) отдельным
// блоком ниже. Состояние не разделяют, новый блок можно выпилить независимо.
// ============================================================================
// ==================== MONITOR (ControlMyMonitor / DDC/CI) ====================
let monTimeout;

function setMonitorBrightnessUI(v, max) {
    max = max || 100;
    const s = $('#mon-brightness-slider');
    s.max = max;
    s.value = v;
    s.style.setProperty('--val', Math.min(100, v / max * 100) + '%');
    $('#mon-brightness-val').textContent = v + '%';
}

async function updateMonitor() {
    const d = await apiS('GET', '/api/monitor/state');
    if (!d) return;
    $('#mon-unavailable').style.display = d.available ? 'none' : 'block';
    if (d.monitor) $('#mon-name').textContent = d.monitor;

    if (d.brightness != null) {
        setMonitorBrightnessUI(d.brightness, d.brightnessMax);
        $('#mon-brightness-input').value = d.brightness;
    }

    const st = $('#mon-power');
    if (d.powerKnown) {
        st.textContent = d.powerOn ? 'Power: on' : 'Power: off (standby)';
        st.classList.toggle('on', d.powerOn);
    } else if (d.available) {
        st.textContent = 'Power: --';
        st.classList.remove('on');
    }
}

$('#mon-brightness-slider').oninput = function () {
    const v = parseInt(this.value);
    const max = parseInt(this.max) || 100;
    $('#mon-brightness-val').textContent = v + '%';
    $('#mon-brightness-input').value = v;
    this.style.setProperty('--val', Math.min(100, v / max * 100) + '%');
    clearTimeout(monTimeout);
    monTimeout = setTimeout(() => apiS('POST', '/api/monitor/brightness', { level: v }), 150);
};

async function applyMonitorBrightness() {
    const inp = $('#mon-brightness-input');
    let v = parseInt(inp.value);
    if (isNaN(v)) return;
    const max = parseInt($('#mon-brightness-slider').max) || 100;
    v = Math.max(0, Math.min(max, v));
    inp.value = v;
    setMonitorBrightnessUI(v, max);
    const d = await apiS('POST', '/api/monitor/brightness', { level: v });
    if (d && d.brightness != null) setMonitorBrightnessUI(d.brightness, max);
}

$('#mon-brightness-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') applyMonitorBrightness();
});

async function monPower(action) {
    toast(action === 'on' ? 'Turning on...' : action === 'off' ? 'Turning off...' : 'Switching...');
    await api('POST', '/api/monitor/power', { action }, true);
    setTimeout(updateMonitor, 800);
}


tabEnterHooks.push(id => { if (id === 'monitor') { updateMonitor(); updateMonitor2(); } });

// ==================== MONITOR v2 (низкоуровневый DDC/CI) ====================
let mon2Timeout = null;
let mon2Index = 0;

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
    if (st) {
        if (d.powerKnown) {
            st.textContent = d.powerOn ? 'Power: on' : 'Power: off (standby)';
            st.classList.toggle('on', d.powerOn);
        } else {
            st.textContent = 'Power: --';
            st.classList.remove('on');
        }
    }
}

$('#mon2-select')?.addEventListener('change', function () {
    mon2Index = parseInt(this.value) || 0;
    updateMonitor2();
});

$('#mon2-brightness-slider')?.addEventListener('input', function () {
    const v = parseInt(this.value);
    const max = parseInt(this.max) || 100;
    $('#mon2-brightness-val').textContent = v + '%';
    const inp = $('#mon2-brightness-input');
    if (inp) inp.value = v;
    this.style.setProperty('--val', Math.min(100, v / max * 100) + '%');
    clearTimeout(mon2Timeout);
    mon2Timeout = setTimeout(() => apiS('POST', '/api/monitor2/brightness', { level: v, index: mon2Index }), 150);
});

async function applyMonitor2Brightness() {
    const inp = $('#mon2-brightness-input');
    let v = parseInt(inp.value);
    if (isNaN(v)) return;
    v = Math.max(0, Math.min(100, v));
    inp.value = v;
    setMonitor2BrightnessUI(v, parseInt($('#mon2-brightness-slider').max) || 100);
    await apiS('POST', '/api/monitor2/brightness', { level: v, index: mon2Index });
}

$('#mon2-brightness-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') applyMonitor2Brightness();
});

async function mon2Power(action) {
    toast(action === 'on' ? 'DDC: turning on...' : action === 'off' ? 'DDC: turning off...' : 'DDC: switching...');
    await api('POST', '/api/monitor2/power', { action, index: mon2Index }, true);
    setTimeout(updateMonitor2, 1500);
}
