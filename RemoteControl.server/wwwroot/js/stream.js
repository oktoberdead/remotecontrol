// ============================================================================
// stream.js — вкладка Stream (WS, latest-frame, клиентский zoom/pan)
// + StreamHub: общий поток кадров для вьюпорт-элементов на любых вкладках
// ============================================================================
// ==================== STREAM ====================
let ws = null;
let currentZoom = 1;
let serverPanX = 0.5, serverPanY = 0.5;

// Локальный view во время жеста: CSS-transform вместо HTTP-спамa на сервер
let viewScale = 1, viewX = 0, viewY = 0, viewActive = false;

const canvas = $('#stream-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const streamView = $('#stream-view');

function startStream() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    const overlay = $('#stream-overlay');
    if (overlay) { overlay.style.display = 'flex'; overlay.textContent = 'Connecting...'; }
    loadFps();
    loadQuality();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws/screen`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
        if (overlay) overlay.style.display = 'none';
        updateZoomLabel();
    };

    // Только последний кадр: старые отбрасываются (отзывчивость, а не история)
    ws.onmessage = e => {
        if (!ctx) return;
        if (pendingFrame) URL.revokeObjectURL(pendingFrame.url);
        pendingFrame = { url: URL.createObjectURL(new Blob([e.data], { type: 'image/jpeg' })) };
        if (!decodingFrame) startDecodeFrame();
    };

    ws.onclose = () => {
        ws = null;
        if (overlay) { overlay.style.display = 'flex'; overlay.textContent = 'Tap to start'; }
    };

    ws.onerror = () => { if (ws) ws.close(); };
}

// latest-frame: максимум один кадр на декодировании + один в ожидании
let pendingFrame = null, decodingFrame = null;

function startDecodeFrame() {
    const f = pendingFrame;
    pendingFrame = null;
    if (!f) return;
    decodingFrame = f;
    const img = new Image();
    img.onload = () => {
        if (decodingFrame !== f) { URL.revokeObjectURL(f.url); return; }
        decodingFrame = null;
        if (pendingFrame) { startDecodeFrame(); return; } // пришёл более свежий
        URL.revokeObjectURL(f.url);
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
    };
    img.onerror = () => {
        if (decodingFrame !== f) { URL.revokeObjectURL(f.url); return; }
        decodingFrame = null;
        URL.revokeObjectURL(f.url);
        if (pendingFrame) startDecodeFrame();
    };
    img.src = f.url;
}

function stopStream() {
    if (pendingFrame) { URL.revokeObjectURL(pendingFrame.url); pendingFrame = null; }
    if (decodingFrame) { URL.revokeObjectURL(decodingFrame.url); decodingFrame = null; }
    if (ws) { ws.close(); ws = null; }
}

// Вкладка браузера скрыта -> рвём сессию, видимая -> подхватываем
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (currentTab === 'stream') stopStream();
    } else {
        if (currentTab === 'stream' && !ws) startStream();
    }
});

if (streamView) {
    streamView.onclick = e => {
        if (e.target.id === 'stream-overlay') {
            if (!ws || ws.readyState !== WebSocket.OPEN) startStream();
        }
    };
}

async function zoomIn() {
    const d = await apiS('POST', '/api/screen/zoom', { action: 'in' });
    if (d) updateZoomFromResponse(d);
}

async function zoomOut() {
    const d = await apiS('POST', '/api/screen/zoom', { action: 'out' });
    if (d) updateZoomFromResponse(d);
}

async function zoomReset() {
    const d = await apiS('POST', '/api/screen/zoom', { action: 'reset' });
    if (d) updateZoomFromResponse(d);
    toast('Reset');
}

async function zoomSet(level) {
    const d = await apiS('POST', '/api/screen/zoom', { action: 'set', level });
    if (d) updateZoomFromResponse(d);
}

async function panBy(dx, dy) {
    await apiS('POST', '/api/screen/pan', { x: dx, y: dy, absolute: false });
}

function updateZoomFromResponse(d) {
    if (d.zoom !== undefined) {
        currentZoom = d.zoom;
        if (d.panX !== undefined) serverPanX = d.panX;
        if (d.panY !== undefined) serverPanY = d.panY;
        updateZoomLabel();
    }
}

function updateZoomLabel() {
    const z = currentZoom * (viewActive ? viewScale : 1);
    const label = $('#zoom-label');
    if (label) label.textContent = z.toFixed(1) + 'x';
    const info = $('#stream-info');
    if (info) info.textContent = z > 1 ? z.toFixed(1) + 'x' : '';
}

function applyView() {
    if (!canvas) return;
    if (viewActive) {
        canvas.style.transform = `translate(${viewX}px, ${viewY}px) scale(${viewScale})`;
        canvas.style.transformOrigin = '0 0';
    } else {
        canvas.style.transform = '';
    }
    updateZoomLabel();
}

// В конце жеста: один запрос на сервер (zoom + абсолютный pan атомарно)
function commitView() {
    if (!viewActive || !canvas) return;
    viewActive = false;
    applyView();

    const cw = canvas.clientWidth || 1;
    const ch = canvas.clientHeight || 1;
    if (Math.abs(viewScale - 1) < 0.02 && Math.abs(viewX) < 3 && Math.abs(viewY) < 3) {
        viewScale = 1; viewX = 0; viewY = 0;
        return;
    }

    // Точка под центром канваса после локального трансформа -> новый центр кадра
    const cx0 = (cw / 2 - viewX) / viewScale;
    const cy0 = (ch / 2 - viewY) / viewScale;

    const newZoom = Math.max(1, Math.min(8, currentZoom * viewScale));
    let newPanX = serverPanX + (cx0 / cw - 0.5) / newZoom;
    let newPanY = serverPanY + (cy0 / ch - 0.5) / newZoom;
    const half = 0.5 / newZoom;
    newPanX = Math.max(half, Math.min(1 - half, newPanX));
    newPanY = Math.max(half, Math.min(1 - half, newPanY));

    apiS('POST', '/api/screen/zoom', { action: 'set', level: newZoom, panX: newPanX, panY: newPanY })
        .then(d => { if (d) updateZoomFromResponse(d); });

    viewScale = 1; viewX = 0; viewY = 0;
}

async function setFps(fps) {
    const d = await apiS('POST', '/api/screen/fps', { fps });
    if (d && d.fps !== undefined) {
        document.getElementById('fps-display').textContent = d.fps;
        document.querySelectorAll('.fps-control .btn').forEach(btn => {
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-dark');
        });
        const activeBtn = document.querySelector(`.fps-control .btn[onclick="setFps(${fps})"]`);
        if (activeBtn) {
            activeBtn.classList.remove('btn-dark');
            activeBtn.classList.add('btn-primary');
        }
        toast('FPS: ' + d.fps);
    }
}

async function loadFps() {
    const d = await apiS('GET', '/api/screen/fps');
    if (d && d.fps !== undefined) {
        document.getElementById('fps-display').textContent = d.fps;
    }
}

function toggleFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => { });
    } else {
        document.documentElement.requestFullscreen().catch(() => { });
    }
}

async function setQuality(pct, jpeg) {
    const d = await apiS('POST', '/api/screen/quality', { percent: pct, jpeg });
    if (d && d.success) {
        document.getElementById('q-display').textContent = d.percent;
        localStorage.setItem('streamQuality', d.percent);
        document.querySelectorAll('.qbtn').forEach(btn => {
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-dark');
        });
        const activeBtn = document.querySelector(`.qbtn[onclick="setQuality(${pct}, ${jpeg})"]`);
        if (activeBtn) {
            activeBtn.classList.remove('btn-dark');
            activeBtn.classList.add('btn-primary');
        }
        toast('Quality: ' + pct + '%');
    }
}

async function loadQuality() {
    const q = parseInt(localStorage.getItem('streamQuality')) || 100;
    document.getElementById('q-display').textContent = q;
    const preset = q === 100 ? [100, 0] : q === 75 ? [75, 0] : [50, 35];
    setQuality(preset[0], preset[1]);
}

// Pinch zoom / pan on canvas — мгновенно на клиенте, коммит на сервер в конце жеста
if (canvas) {
    let lastTouches = null;
    let lastPinchDist = null;
    let isPanning = false;

    function beginView() {
        if (!viewActive) {
            viewActive = true;
            viewScale = 1;
            viewX = 0;
            viewY = 0;
        }
    }

    canvas.addEventListener('touchstart', e => {
        e.preventDefault();
        if (e.touches.length === 2) {
            beginView();
            lastPinchDist = getPinchDist(e.touches);
            lastTouches = [
                { x: e.touches[0].clientX, y: e.touches[0].clientY },
                { x: e.touches[1].clientX, y: e.touches[1].clientY }
            ];
        } else if (e.touches.length === 1 && (currentZoom > 1 || viewScale > 1.01)) {
            beginView();
            isPanning = true;
            lastTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', e => {
        e.preventDefault();
        if (e.touches.length === 2 && lastPinchDist !== null) {
            const dist = getPinchDist(e.touches);
            const scale = dist / lastPinchDist;
            lastPinchDist = dist;

            const rect = canvas.getBoundingClientRect();
            const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

            // зум вокруг середины пинча
            const oldS = viewScale;
            viewScale = Math.max(0.25, Math.min(4, viewScale * scale));
            const ratio = viewScale / oldS;
            viewX = cx - (cx - viewX) * ratio;
            viewY = cy - (cy - viewY) * ratio;

            // панорама по движению середины пинча
            const lastCx = (lastTouches[0].x + lastTouches[1].x) / 2;
            const lastCy = (lastTouches[0].y + lastTouches[1].y) / 2;
            viewX += (e.touches[0].clientX + e.touches[1].clientX) / 2 - lastCx;
            viewY += (e.touches[0].clientY + e.touches[1].clientY) / 2 - lastCy;

            lastTouches = [
                { x: e.touches[0].clientX, y: e.touches[0].clientY },
                { x: e.touches[1].clientX, y: e.touches[1].clientY }
            ];
            applyView();
        } else if (e.touches.length === 1 && isPanning && lastTouches) {
            viewX += lastTouches[0].x - e.touches[0].clientX;
            viewY += lastTouches[0].y - e.touches[0].clientY;
            lastTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
            applyView();
        }
    }, { passive: false });

    canvas.addEventListener('touchend', e => {
        if (e.touches.length < 2) {
            lastPinchDist = null;
            if (e.touches.length === 1) {
                lastTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
            }
        }
        if (e.touches.length === 0) {
            isPanning = false;
            lastTouches = null;
            commitView();
        }
    });

    function getPinchDist(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
    }
}

$('#stream-overlay')?.addEventListener('click', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) startStream();
});


// Вкладка Stream: вход/выход через хуки ядра
tabEnterHooks.push(id => { if (id === 'stream') startStream(); });
tabLeaveHooks.push(oldId => { if (oldId === 'stream') stopStream(); });

// ==================== STREAM HUB (для вьюпорт-элементов) ====================
// Отдельное WS-подключение, живёт пока есть хотя бы один активный подписчик.
// Кадр декодируется один раз и рисуется во все подписанные канвасы.
const StreamHub = {
    subs: new Map(),      // id -> { canvas }
    ws: null,
    pending: null,
    decoding: null,

    add(id, canvas) {
        this.subs.set(id, { canvas });
        this._ensure();
    },

    remove(id) {
        this.subs.delete(id);
        if (this.subs.size === 0) this._stop();
    },

    _ensure() {
        if (this.subs.size === 0) return;
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const sock = new WebSocket(`${proto}//${location.host}/ws/screen`);
        sock.binaryType = 'arraybuffer';
        this.ws = sock;

        sock.onmessage = e => {
            if (this.pending) URL.revokeObjectURL(this.pending.url);
            this.pending = { url: URL.createObjectURL(new Blob([e.data], { type: 'image/jpeg' })) };
            if (!this.decoding) this._decode();
        };
        sock.onclose = () => {
            if (this.ws === sock) this.ws = null;
            // авто-reconnect, пока есть подписчики
            if (this.subs.size > 0) setTimeout(() => this._ensure(), 1200);
        };
        sock.onerror = () => { try { sock.close(); } catch { } };
    },

    _stop() {
        if (this.pending) { URL.revokeObjectURL(this.pending.url); this.pending = null; }
        if (this.decoding) { URL.revokeObjectURL(this.decoding.url); this.decoding = null; }
        if (this.ws) { try { this.ws.close(); } catch { } this.ws = null; }
    },

    _decode() {
        const f = this.pending;
        this.pending = null;
        if (!f) return;
        this.decoding = f;
        const img = new Image();
        img.onload = () => {
            if (this.decoding !== f) { URL.revokeObjectURL(f.url); return; }
            this.decoding = null;
            if (this.pending) { this._decode(); return; }
            URL.revokeObjectURL(f.url);
            for (const { canvas: c } of this.subs.values()) {
                if (!c.isConnected) continue;
                if (c.width !== img.width) c.width = img.width;
                if (c.height !== img.height) c.height = img.height;
                c.getContext('2d').drawImage(img, 0, 0);
            }
        };
        img.onerror = () => {
            if (this.decoding !== f) { URL.revokeObjectURL(f.url); return; }
            this.decoding = null;
            URL.revokeObjectURL(f.url);
            if (this.pending) this._decode();
        };
        img.src = f.url;
    }
};

// Вкладка браузера скрыта — StreamHub тоже рвём (сессия стрима не висит зря)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        StreamHub._stop();
    } else if (StreamHub.subs.size > 0) {
        StreamHub._ensure();
    }
});
