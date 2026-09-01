// ============================================================================
// pages.js — декларативные страницы (вкладки): разделы-миниканвасы с
// элементами. Дефолтные конфиги воспроизводят прежние Main/Monitor/Mouse/Keys.
//
// Модель (в uiCfg):
//   tabOrder: ['main','monitor','mouse','keys','stream','game', ...custom]
//   pages: { <tabId>: { title, sections: [{ id, title, h(px), elements: [...] }] } }
//
// Элементы: units '%', те же типы, что на Game (+ slider/toggle/input/label/
// sequence/blk-*). Game/Stream/Settings — специальные вкладки, не страницы.
// ============================================================================

const SPECIAL_TABS = { stream: 'Stream', game: 'Game', settings: 'Settings' };

const pageVpInstances = new Map();   // elId -> { inst, tab }
const pageRefreshFns = new Map();    // tab -> [fn...]

function isPageTab(id) { return !!uiCfg.pages && !!uiCfg.pages[id]; }

// ==================== ДЕФОЛТЫ ====================

function pgEl(type, x, y, w, h, extra) {
    return Object.assign({ id: uid(), type, x, y, w, h, opacity: 100 }, extra || {});
}

function pgBtn(label, kind, action, x, y, w, h, extra) {
    return pgEl('button', x, y, w, h, Object.assign(
        { label, kind, action, mode: 'click', pressMs: 60, intervalMs: 120, color: 'btn-dark' }, extra || {}));
}

function defaultPages() {
    return {
        main: {
            title: 'Main',
            sections: [
                {
                    id: uid(), title: 'Volume', h: 170, elements: [
                        pgEl('slider', 2, 4, 96, 22, { binding: 'volume', label: '', min: 0, max: 100 }),
                        pgBtn('🔇', 'api', '/api/volume/mute', 14, 32, 20, 28),
                        pgBtn('🔉', 'key', 'voldown', 40, 32, 20, 28),
                        pgBtn('🔊', 'key', 'volup', 66, 32, 20, 28),
                        pgEl('blk-audio', 2, 66, 96, 28, {})
                    ]
                },
                {
                    id: uid(), title: 'Media', h: 84, elements: [
                        pgBtn('⏪', 'key', 'left', 2, 10, 14, 70),
                        pgBtn('⏮', 'key', 'prev', 18, 10, 14, 70),
                        pgBtn('⏯', 'key', 'playpause', 34, 10, 14, 70, { color: 'btn-primary' }),
                        pgBtn('⏭', 'key', 'next', 50, 10, 14, 70),
                        pgBtn('⏩', 'key', 'right', 66, 10, 14, 70),
                        pgBtn('⏹', 'key', 'stop', 82, 10, 14, 70)
                    ]
                },
                {
                    id: uid(), title: 'System', h: 150, elements: [
                        pgBtn('Desktop', 'combo', 'win+d', 2, 5, 23, 28, { color: 'btn-warning' }),
                        pgBtn('Alt+Tab', 'combo', 'alt+tab', 27, 5, 23, 28, { color: 'btn-warning' }),
                        pgBtn('Alt+F4', 'combo', 'alt+f4', 52, 5, 23, 28, { color: 'btn-danger' }),
                        pgBtn('F11', 'key', 'f11', 77, 5, 21, 28),
                        pgEl('blk-shutdown', 2, 42, 96, 32, {})
                    ]
                },
                {
                    id: uid(), title: 'WireGuard', h: 70, elements: [
                        pgBtn('Toggle VPN', 'api', '/api/wg/toggle', 2, 8, 96, 40, { color: 'btn-primary' })
                    ]
                }
            ]
        },
        monitor: {
            title: 'Monitor',
            sections: [
                { id: uid(), title: '', h: 360, elements: [pgEl('blk-monitor-ddc', 0, 0, 100, 100, {})] }
            ]
        },
        mouse: {
            title: 'Mouse',
            sections: [
                {
                    id: uid(), title: 'Touchpad', h: 400, elements: [
                        pgEl('blk-mousepad', 0, 0, 100, 82, { sensKey: 'mouseSens' }),
                        pgBtn('Left', 'mouse', 'left', 0, 85, 32, 14, { mode: 'hold', color: 'btn-primary' }),
                        pgBtn('Mid', 'mouse', 'middle', 34, 85, 32, 14, { mode: 'hold' }),
                        pgBtn('Right', 'mouse', 'right', 68, 85, 32, 14, { mode: 'hold', color: 'btn-primary' })
                    ]
                }
            ]
        },
        keys: {
            title: 'Keys',
            sections: [
                { id: uid(), title: 'Live Input (realtime)', h: 84, elements: [pgEl('blk-live-input', 0, 0, 100, 100, {})] },
                { id: uid(), title: 'Send Text (batch)', h: 130, elements: [pgEl('blk-send-text', 0, 0, 100, 100, {})] },
                {
                    id: uid(), title: 'Arrows', h: 170, elements: [
                        pgBtn('↑', 'key', 'up', 36, 2, 28, 30),
                        pgBtn('←', 'key', 'left', 4, 35, 28, 30),
                        pgBtn('↵', 'key', 'enter', 36, 35, 28, 30, { color: 'btn-primary' }),
                        pgBtn('→', 'key', 'right', 68, 35, 28, 30),
                        pgBtn('↓', 'key', 'down', 36, 68, 28, 30)
                    ]
                },
                {
                    id: uid(), title: 'Common', h: 80, elements: [
                        pgBtn('Space', 'key', 'space', 2, 10, 18, 60),
                        pgBtn('Tab', 'key', 'tab', 22, 10, 18, 60),
                        pgBtn('Esc', 'key', 'esc', 42, 10, 18, 60),
                        pgBtn('⌫', 'key', 'backspace', 62, 10, 18, 60),
                        pgBtn('Del', 'key', 'delete', 82, 10, 16, 60)
                    ]
                },
                {
                    id: uid(), title: 'Combos', h: 80, elements: [
                        pgBtn('^C', 'combo', 'ctrl+c', 2, 10, 15, 60, { color: 'btn-primary' }),
                        pgBtn('^V', 'combo', 'ctrl+v', 18.5, 10, 15, 60, { color: 'btn-primary' }),
                        pgBtn('^Z', 'combo', 'ctrl+z', 35, 10, 15, 60, { color: 'btn-primary' }),
                        pgBtn('^A', 'combo', 'ctrl+a', 51.5, 10, 15, 60, { color: 'btn-primary' }),
                        pgBtn('^S', 'combo', 'ctrl+s', 68, 10, 15, 60, { color: 'btn-primary' }),
                        pgBtn('TaskMgr', 'combo', 'ctrl+shift+esc', 84.5, 10, 14, 60, { color: 'btn-warning' })
                    ]
                }
            ]
        }
    };
}

const DEFAULT_TAB_ORDER = ['main', 'monitor', 'mouse', 'keys', 'stream', 'game'];

// ==================== МИГРАЦИЯ СТАРЫХ ВИДЖЕТОВ ====================

function migrateWidgetToElement(w) {
    const base = { id: w.id || uid(), x: w.x, y: w.y, w: w.w, h: w.h, opacity: 100, label: w.label || '' };
    switch (w.type) {
        case 'button': {
            const a = w.action || '';
            const kind = a.startsWith('/api/') ? 'api' : a.includes('+') ? 'combo' : 'key';
            const mode = w.pressMode === 'hold' ? 'hold' : w.pressMode === 'repeat' ? 'repeat' : 'click';
            return Object.assign(base, { type: 'button', kind, action: a, mode, pressMs: 60, intervalMs: w.repeatInterval || 120, color: w.color || 'btn-primary' });
        }
        case 'touchpad':
            if (w.axes === 1) return Object.assign(base, { type: 'scrollbar', axis: 'y' });
            return Object.assign(base, {
                type: 'touchpad', sens: w.sensitivity || null, lmbTap: false,
                edgeEnabled: w.edgeZone === false ? false : null, edgeSizePx: null, edgeSpeed: null
            });
        case 'sequence': return Object.assign(base, { type: 'sequence', steps: w.steps || [] });
        case 'slider': return Object.assign(base, { type: 'slider', binding: w.binding || 'volume', min: w.min ?? 0, max: w.max ?? 100 });
        case 'toggle': return Object.assign(base, { type: 'toggle', binding: w.binding || 'power' });
        case 'input': return Object.assign(base, { type: 'input' });
        case 'viewport': return Object.assign(base, { type: 'viewport', vp: Object.assign(vpDefaults(), w.vp || {}) });
    }
    return null;
}

function ensurePages() {
    if (!uiCfg.pages || !Object.keys(uiCfg.pages).length) {
        uiCfg.pages = defaultPages();

        // старые кастомные виджеты → секция Custom соответствующей страницы
        const widgets = uiCfg.widgets || {};
        for (const tab of Object.keys(widgets)) {
            const list = (widgets[tab] || []).map(migrateWidgetToElement).filter(Boolean);
            if (!list.length || !uiCfg.pages[tab]) continue;
            uiCfg.pages[tab].sections.push({ id: uid(), title: 'Custom', h: 240, elements: list });
        }
        delete uiCfg.widgets;
        saveUiConfigSoon();
    }
    if (!uiCfg.tabOrder || !uiCfg.tabOrder.length) {
        uiCfg.tabOrder = DEFAULT_TAB_ORDER.slice();
    }
    // миграция: ControlMyMonitor-блок снесён — вычищаем из сохранённых конфигов
    Object.values(uiCfg.pages).forEach(page => {
        (page.sections || []).forEach(sec => {
            const before = sec.elements.length;
            sec.elements = sec.elements.filter(e => e.type !== 'blk-monitor-cmm');
            if (sec.elements.length !== before) saveUiConfigSoon();
        });
        // пустые секции, оставшиеся от cmm-блока, не трогаем — юзер сам решит
    });

    // новые страницы, не попавшие в порядок (после апдейтов/добавлений)
    Object.keys(uiCfg.pages).forEach(id => {
        if (!uiCfg.tabOrder.includes(id)) uiCfg.tabOrder.splice(uiCfg.tabOrder.length, 0, id);
    });
    Object.keys(SPECIAL_TABS).forEach(id => {
        if (id !== 'settings' && !uiCfg.tabOrder.includes(id)) uiCfg.tabOrder.push(id);
    });
}

// ==================== РЕНДЕР ====================

let pageEditTab = null;       // id вкладки в режиме редактирования (pageeditor.js)
let pageEditorPage = null;    // рабочая копия страницы

function pageData(tabId) {
    if (pageEditTab === tabId && pageEditorPage) return pageEditorPage;
    return uiCfg.pages[tabId];
}

function pageElCtx(tabId) {
    const editing = pageEditTab === tabId;
    return {
        edit: editing,
        units: '%',
        vpReg: {
            set: (id, inst) => pageVpInstances.set(id, { inst, tab: tabId }),
            get: id => pageVpInstances.get(id)?.inst
        },
        vpGearInline: false,
        zIndex: null,
        fullOpacity: editing && pageEditorFullOpacity,
        registerRefresh: (el, fn) => {
            if (!pageRefreshFns.has(tabId)) pageRefreshFns.set(tabId, []);
            pageRefreshFns.get(tabId).push(fn);
        },
        // fs: null → элемент sys-fs использует sysFsToggle(el) со своими
        // опциями (landscape-lock, скрытие шапки)
        sys: { fs: null, settings: null }
    };
}

let pageEditorFullOpacity = false;

function renderPage(tabId) {
    const page = pageData(tabId);
    if (!page) return;

    let content = document.getElementById('tab-' + tabId);
    if (!content) {
        content = document.createElement('div');
        content.id = 'tab-' + tabId;
        content.className = 'content';
        document.getElementById('pages-root')?.appendChild(content);
    }

    // почистить вьюпорты/рефреши этой вкладки
    for (const [id, rec] of [...pageVpInstances]) {
        if (rec.tab === tabId) { rec.inst.deactivate(); pageVpInstances.delete(id); }
    }
    pageRefreshFns.set(tabId, []);

    content.innerHTML = '';
    content.classList.toggle('page-editing', pageEditTab === tabId);
    content.classList.toggle('active', currentTab === tabId);

    const ctx = pageElCtx(tabId);

    page.sections.forEach(sec => {
        const secEl = document.createElement('div');
        secEl.className = 'section page-section';
        secEl.dataset.secId = sec.id;

        if (sec.title || pageEditTab === tabId) {
            const h2 = document.createElement('h2');
            h2.textContent = sec.title || '(без названия)';
            secEl.appendChild(h2);
        }

        const canvas = document.createElement('div');
        canvas.className = 'page-canvas' + (pageEditTab === tabId ? ' edit-mode' : '');
        canvas.style.height = (sec.h || 200) + 'px';
        canvas.dataset.secId = sec.id;

        sec.elements.forEach(el => {
            const node = buildElementNode(el, ctx);
            if (node) canvas.appendChild(node);
        });

        secEl.appendChild(canvas);
        content.appendChild(secEl);
    });

    if (pageEditTab === tabId && typeof pageEditorDecorate === 'function') pageEditorDecorate(content);

    syncPageViewports();
}

function renderAllPages() {
    ensurePages();
    (uiCfg.tabOrder || []).forEach(id => { if (isPageTab(id)) renderPage(id); });
    // выпилить контейнеры удалённых вкладок
    document.querySelectorAll('#pages-root .content').forEach(c => {
        const id = c.id.replace(/^tab-/, '');
        if (!isPageTab(id)) c.remove();
    });
}

// ==================== АКТИВНОСТЬ (вьюпорты / рефреш) ====================

function syncPageViewports() {
    for (const { inst, tab } of pageVpInstances.values()) {
        if (tab === currentTab && !document.hidden) inst.activate();
        else inst.deactivate();
        inst.setEditMode(pageEditTab === tab);
    }
}

function pagesRefresh(tabId) {
    (pageRefreshFns.get(tabId) || []).forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
}

tabEnterHooks.push(id => {
    syncPageViewports();
    if (isPageTab(id)) pagesRefresh(id);
});
document.addEventListener('visibilitychange', syncPageViewports);

uiReadyHooks.push(() => {
    renderAllPages();
});
