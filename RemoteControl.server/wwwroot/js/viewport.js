// ============================================================================
// viewport.js — вьюпорт-элемент: живой стрим как типовой элемент любой вкладки.
// Функционал вкладки Stream: zoom/pan жестами (клиентский transform, коммит на
// сервер в конце жеста), FPS, качество. Для каждой группы свойств — независимая
// политика отображения: always | button | edit | hidden.
// Кадры берутся из StreamHub (stream.js).
// ============================================================================

// Зеркало серверного зума (сервер держит один zoom на весь стрим)
const vpServer = { zoom: 1, panX: 0.5, panY: 0.5 };

async function vpSyncServerState() {
    const d = await apiS('GET', '/api/screen/state');
    if (d && d.zoom !== undefined) {
        vpServer.zoom = d.zoom;
        if (d.panX !== undefined) vpServer.panX = d.panX;
        if (d.panY !== undefined) vpServer.panY = d.panY;
    }
}

const VP_GROUPS = ['fps', 'quality', 'zoom'];
const VP_POLICIES = ['always', 'button', 'edit', 'hidden'];

function vpDefaults() {
    return { fps: 'button', quality: 'button', zoom: 'button', gestures: true };
}

// cfg: элемент с полем vp {fps,quality,zoom,gestures}; instance живёт, пока жив DOM
// opts.withGear — встроенная кнопка ⚙ в углу (для виджетов без отдельного gear-элемента)
function createViewport(cfg, opts) {
    opts = opts || {};
    const vp = Object.assign(vpDefaults(), cfg.vp || {});
    const root = document.createElement('div');
    root.className = 'ge-viewport';

    const canvas = document.createElement('canvas');
    root.appendChild(canvas);

    const msg = document.createElement('div');
    msg.className = 'vp-overlay-msg';
    msg.textContent = 'viewport';
    root.appendChild(msg);

    const info = document.createElement('div');
    info.className = 'vp-info';
    root.appendChild(info);

    const groups = document.createElement('div');
    groups.className = 'vp-groups';
    root.appendChild(groups);

    const inst = {
        id: cfg.id,
        root, canvas, cfg, vp,
        active: false,
        editMode: false,
        panelsOpen: false,

        // клиентский view во время жеста
        viewScale: 1, viewX: 0, viewY: 0, viewActive: false,

        activate() {
            if (this.active) return;
            this.active = true;
            msg.style.display = 'none';
            StreamHub.add('vp-' + this.id, canvas);
            vpSyncServerState().then(() => this.updateInfo());
        },

        deactivate() {
            if (!this.active) return;
            this.active = false;
            StreamHub.remove('vp-' + this.id);
        },

        setEditMode(on) {
            this.editMode = on;
            this.refresh();
        },

        togglePanels() {
            this.panelsOpen = !this.panelsOpen;
            this.refresh();
            return this.panelsOpen;
        },

        refresh() {
            for (const g of VP_GROUPS) {
                const row = groups.querySelector(`[data-g="${g}"]`);
                if (!row) continue;
                const pol = this.vp[g] || 'button';
                const show = pol === 'always' || (pol === 'button' && this.panelsOpen) || (pol === 'edit' && this.editMode);
                row.style.display = show ? 'flex' : 'none';
            }
            canvas.classList.toggle('no-gestures', this.vp.gestures === false);
        },

        updateInfo() {
            const z = vpServer.zoom * (this.viewActive ? this.viewScale : 1);
            info.textContent = z > 1.01 ? z.toFixed(1) + 'x' : '';
            const zl = groups.querySelector('.vp-zoom-label');
            if (zl) zl.textContent = z.toFixed(1) + 'x';
        },

        applyView() {
            if (this.viewActive) {
                canvas.style.transform = `translate(${this.viewX}px, ${this.viewY}px) scale(${this.viewScale})`;
                canvas.style.transformOrigin = '0 0';
            } else {
                canvas.style.transform = '';
            }
            this.updateInfo();
        },

        // конец жеста: один атомарный запрос zoom+pan (математика — как на Stream)
        commitView() {
            if (!this.viewActive) return;
            this.viewActive = false;
            this.applyView();

            const cw = canvas.clientWidth || 1;
            const ch = canvas.clientHeight || 1;
            if (Math.abs(this.viewScale - 1) < 0.02 && Math.abs(this.viewX) < 3 && Math.abs(this.viewY) < 3) {
                this.viewScale = 1; this.viewX = 0; this.viewY = 0;
                return;
            }

            const cx0 = (cw / 2 - this.viewX) / this.viewScale;
            const cy0 = (ch / 2 - this.viewY) / this.viewScale;

            const newZoom = Math.max(1, Math.min(8, vpServer.zoom * this.viewScale));
            let newPanX = vpServer.panX + (cx0 / cw - 0.5) / newZoom;
            let newPanY = vpServer.panY + (cy0 / ch - 0.5) / newZoom;
            const half = 0.5 / newZoom;
            newPanX = Math.max(half, Math.min(1 - half, newPanX));
            newPanY = Math.max(half, Math.min(1 - half, newPanY));

            apiS('POST', '/api/screen/zoom', { action: 'set', level: newZoom, panX: newPanX, panY: newPanY })
                .then(d => {
                    if (d && d.zoom !== undefined) {
                        vpServer.zoom = d.zoom;
                        if (d.panX !== undefined) vpServer.panX = d.panX;
                        if (d.panY !== undefined) vpServer.panY = d.panY;
                    }
                    this.updateInfo();
                });

            this.viewScale = 1; this.viewX = 0; this.viewY = 0;
        }
    };

    buildVpGroups(inst, groups);
    initVpGestures(inst, canvas);

    if (opts.withGear && (vp.fps === 'button' || vp.quality === 'button' || vp.zoom === 'button')) {
        const gear = document.createElement('button');
        gear.className = 'ge-vpgear';
        gear.textContent = '⚙';
        gear.style.position = 'absolute';
        gear.style.right = '4px';
        gear.style.bottom = '4px';
        gear.style.width = '26px';
        gear.style.height = '26px';
        gear.style.zIndex = '6';
        gear.addEventListener('pointerdown', e => e.stopPropagation());
        gear.addEventListener('click', e => {
            e.stopPropagation();
            gear.classList.toggle('on', inst.togglePanels());
        });
        root.appendChild(gear);
    }

    inst.refresh();
    return inst;
}

function buildVpGroups(inst, groups) {
    const mkRow = (g, label) => {
        const row = document.createElement('div');
        row.className = 'vp-row';
        row.dataset.g = g;
        const l = document.createElement('span');
        l.className = 'vp-lbl';
        l.textContent = label;
        row.appendChild(l);
        // жесты редактора не должны утаскивать элемент при работе с кнопками
        row.addEventListener('pointerdown', e => { if (!inst.editMode) e.stopPropagation(); });
        groups.appendChild(row);
        return row;
    };

    const mkBtn = (row, text, onClick) => {
        const b = document.createElement('button');
        b.textContent = text;
        b.addEventListener('click', e => { e.stopPropagation(); if (!inst.editMode) onClick(b); });
        row.appendChild(b);
        return b;
    };

    // FPS
    const fpsRow = mkRow('fps', 'FPS');
    [10, 20, 30, 60].forEach(f => {
        mkBtn(fpsRow, String(f), async b => {
            const d = await apiS('POST', '/api/screen/fps', { fps: f });
            if (d && d.fps !== undefined) {
                fpsRow.querySelectorAll('button').forEach(x => x.classList.remove('on'));
                b.classList.add('on');
                toast('FPS: ' + d.fps);
            }
        });
    });

    // Quality
    const qRow = mkRow('quality', 'Q');
    [['Max', 100, 0], ['Med', 75, 0], ['Low', 50, 35]].forEach(([name, pct, jpeg]) => {
        mkBtn(qRow, name, async b => {
            const d = await apiS('POST', '/api/screen/quality', { percent: pct, jpeg });
            if (d && d.success) {
                qRow.querySelectorAll('button').forEach(x => x.classList.remove('on'));
                b.classList.add('on');
                toast('Quality: ' + pct + '%');
            }
        });
    });

    // Zoom
    const zRow = mkRow('zoom', 'Zm');
    mkBtn(zRow, '−', async () => {
        const d = await apiS('POST', '/api/screen/zoom', { action: 'out' });
        if (d && d.zoom !== undefined) { vpServer.zoom = d.zoom; vpServer.panX = d.panX ?? vpServer.panX; vpServer.panY = d.panY ?? vpServer.panY; inst.updateInfo(); }
    });
    const zl = document.createElement('span');
    zl.className = 'vp-lbl vp-zoom-label';
    zl.textContent = '1.0x';
    zRow.appendChild(zl);
    mkBtn(zRow, '+', async () => {
        const d = await apiS('POST', '/api/screen/zoom', { action: 'in' });
        if (d && d.zoom !== undefined) { vpServer.zoom = d.zoom; vpServer.panX = d.panX ?? vpServer.panX; vpServer.panY = d.panY ?? vpServer.panY; inst.updateInfo(); }
    });
    mkBtn(zRow, '⟲', async () => {
        const d = await apiS('POST', '/api/screen/zoom', { action: 'reset' });
        if (d && d.zoom !== undefined) { vpServer.zoom = d.zoom; vpServer.panX = 0.5; vpServer.panY = 0.5; inst.updateInfo(); }
    });
}

// Pinch-zoom / pan — как на вкладке Stream, но per-instance
function initVpGestures(inst, canvas) {
    let lastTouches = null;
    let lastPinchDist = null;
    let isPanning = false;

    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    function begin() {
        if (!inst.viewActive) {
            inst.viewActive = true;
            inst.viewScale = 1;
            inst.viewX = 0;
            inst.viewY = 0;
        }
    }

    canvas.addEventListener('touchstart', e => {
        if (inst.editMode || inst.vp.gestures === false) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.touches.length === 2) {
            begin();
            lastPinchDist = dist(e.touches);
            lastTouches = [
                { x: e.touches[0].clientX, y: e.touches[0].clientY },
                { x: e.touches[1].clientX, y: e.touches[1].clientY }
            ];
        } else if (e.touches.length === 1 && (vpServer.zoom > 1 || inst.viewScale > 1.01)) {
            begin();
            isPanning = true;
            lastTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', e => {
        if (inst.editMode || inst.vp.gestures === false) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.touches.length === 2 && lastPinchDist !== null) {
            const d = dist(e.touches);
            const scale = d / lastPinchDist;
            lastPinchDist = d;

            const rect = canvas.getBoundingClientRect();
            const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

            // масштаб вокруг центра щипка
            inst.viewX = cx - (cx - inst.viewX) * scale;
            inst.viewY = cy - (cy - inst.viewY) * scale;
            inst.viewScale *= scale;

            if (lastTouches && lastTouches.length === 2) {
                const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - (lastTouches[0].x + lastTouches[1].x) / 2;
                const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - (lastTouches[0].y + lastTouches[1].y) / 2;
                inst.viewX += mx;
                inst.viewY += my;
            }

            lastTouches = [
                { x: e.touches[0].clientX, y: e.touches[0].clientY },
                { x: e.touches[1].clientX, y: e.touches[1].clientY }
            ];
            inst.applyView();
        } else if (e.touches.length === 1 && isPanning && lastTouches) {
            inst.viewX += e.touches[0].clientX - lastTouches[0].x;
            inst.viewY += e.touches[0].clientY - lastTouches[0].y;
            lastTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
            inst.applyView();
        }
    }, { passive: false });

    canvas.addEventListener('touchend', e => {
        if (inst.editMode || inst.vp.gestures === false) return;
        e.stopPropagation();
        if (e.touches.length < 2) {
            lastPinchDist = null;
            if (e.touches.length === 1) {
                lastTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
            }
        }
        if (e.touches.length === 0) {
            isPanning = false;
            lastTouches = null;
            inst.commitView();
        }
    });
}
