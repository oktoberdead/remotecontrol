// ============================================================================
// pageeditor.js — редактор страницы (вкладки): разделы (добавить/удалить/
// переименовать/высота/порядок) + элементы в разделах (та же логика, что на
// Game: тап/свайп — выбор, ⤡ по выбору, двойной тап — ✎/✕, формы в модалках).
// ============================================================================

const PAGE_ADD_TYPES = [
    ['button', 'Button'],
    ['touchpad', 'Touchpad (X/Y)'],
    ['scrollbar', 'Scrollbar (1 axis)'],
    ['joystick', 'Joystick'],
    ['viewport', 'Viewport (stream)'],
    ['slider', 'Slider (volume/brightness/...)'],
    ['toggle', 'Toggle (power/wg)'],
    ['input', 'Text input'],
    ['label', 'Label (text)'],
    ['sequence', 'Sequence (macro)'],
    ['sys-fs', 'System: Fullscreen'],
    ['blk-monitor-cmm', 'Block: Monitor (CMM)'],
    ['blk-monitor-ddc', 'Block: Monitor low-level'],
    ['blk-mousepad', 'Block: Mouse touchpad'],
    ['blk-live-input', 'Block: Live keyboard'],
    ['blk-send-text', 'Block: Send text'],
    ['blk-audio', 'Block: Audio select'],
    ['blk-shutdown', 'Block: Shutdown PC']
];

// ==================== ВХОД / ВЫХОД ====================

function enterPageEdit(tabId) {
    if (!isPageTab(tabId)) { toast('Not an editable page'); return; }
    if (pageEditTab) exitPageEdit(false);
    if (gameEditMode) exitEditMode(false);
    if (typeof streamEditing !== 'undefined' && streamEditing) exitStreamEdit(false);

    pageEditTab = tabId;
    pageEditorPage = JSON.parse(JSON.stringify(uiCfg.pages[tabId]));
    pageEditorFullOpacity = false;

    if (currentTab !== tabId) switchToTab(tabId);

    EkSel.scope = document.getElementById('tab-' + tabId);
    EkSel.id = null;

    document.getElementById('page-editor-overlay')?.classList.add('show');
    const badge = $('#page-editor-title');
    if (badge) badge.textContent = '✏️ ' + (pageEditorPage.title || tabId);
    renderPage(tabId);
}

function exitPageEdit(save) {
    const tabId = pageEditTab;
    if (!tabId) return;
    if (save && pageEditorPage) {
        uiCfg.pages[tabId] = pageEditorPage;
        saveUiConfig();
        toast('Page saved');
    }
    pageEditTab = null;
    pageEditorPage = null;
    EkSel.id = null;
    EkSel.scope = null;
    document.getElementById('page-editor-overlay')?.classList.remove('show');
    renderPage(tabId);
    renderTabs();
}

$('#btn-page-save')?.addEventListener('click', () => exitPageEdit(true));
$('#btn-page-cancel')?.addEventListener('click', () => exitPageEdit(false));

$('#btn-page-opacity')?.addEventListener('click', function () {
    pageEditorFullOpacity = !pageEditorFullOpacity;
    this.classList.toggle('btn-primary', pageEditorFullOpacity);
    this.classList.toggle('btn-dark', !pageEditorFullOpacity);
    if (pageEditTab) renderPage(pageEditTab);
});

$('#btn-page-add-section')?.addEventListener('click', () => {
    if (!pageEditorPage) return;
    pageEditorPage.sections.push({ id: uid(), title: 'Section', h: 160, elements: [] });
    renderPage(pageEditTab);
});

// ==================== ДЕКОРАЦИЯ ====================

function peFindEl(id) {
    if (!pageEditorPage) return null;
    for (const sec of pageEditorPage.sections) {
        const el = sec.elements.find(e => e.id === id);
        if (el) return { el, sec };
    }
    return null;
}

// вызывается из renderPage() в режиме редактирования
function pageEditorDecorate(content) {
    EkSel.scope = content;

    // панели секций
    content.querySelectorAll('.page-section').forEach(secEl => {
        const sec = pageEditorPage.sections.find(s => s.id === secEl.dataset.secId);
        if (!sec) return;

        const bar = document.createElement('div');
        bar.className = 'sec-toolbar';
        bar.innerHTML =
            '<button class="btn btn-success btn-sm" data-a="add">+ El</button>' +
            '<button class="btn btn-dark btn-sm" data-a="edit">✎</button>' +
            '<button class="btn btn-dark btn-sm" data-a="up">↑</button>' +
            '<button class="btn btn-dark btn-sm" data-a="down">↓</button>' +
            '<button class="btn btn-danger btn-sm" data-a="del">✕</button>';

        bar.addEventListener('click', e => {
            const a = e.target?.dataset?.a;
            if (!a) return;
            const idx = pageEditorPage.sections.indexOf(sec);
            if (a === 'add') {
                openAddElementModal(PAGE_ADD_TYPES, spec => {
                    const el = makePageElement(spec);
                    if (el) {
                        sec.elements.push(el);
                        if (el._gear) { sec.elements.push(el._gear); delete el._gear; }
                        EkSel.id = el.id;
                        renderPage(pageEditTab);
                    }
                });
            } else if (a === 'edit') {
                openSectionEditor(sec);
            } else if (a === 'up' && idx > 0) {
                pageEditorPage.sections.splice(idx, 1);
                pageEditorPage.sections.splice(idx - 1, 0, sec);
                renderPage(pageEditTab);
            } else if (a === 'down' && idx < pageEditorPage.sections.length - 1) {
                pageEditorPage.sections.splice(idx, 1);
                pageEditorPage.sections.splice(idx + 1, 0, sec);
                renderPage(pageEditTab);
            } else if (a === 'del') {
                if (!confirm(`Delete section "${sec.title || '(без названия)'}" со всеми элементами?`)) return;
                pageEditorPage.sections = pageEditorPage.sections.filter(s => s !== sec);
                renderPage(pageEditTab);
            }
        });

        secEl.insertBefore(bar, secEl.firstChild);
    });

    // элементы
    content.querySelectorAll('.ge-wrap').forEach(wrap => {
        const found = peFindEl(wrap.dataset.geId);
        if (!found) return;
        const { el } = found;
        const canvas = wrap.closest('.page-canvas');

        ekInjectHandles(wrap, {});

        ekBindInteraction(wrap, el.id, {
            isEditing: () => pageEditTab !== null,
            getFrame: () => ({ x: el.x, y: el.y, w: el.w, h: el.h }),
            setFrame: f => { el.x = f.x; el.y = f.y; el.w = f.w; el.h = f.h; },
            applyFrame: () => applyWrapFrame(el, wrap, pageElCtx(pageEditTab)),
            toUnits: (dxPx, dyPx) => {
                const r = canvas.getBoundingClientRect();
                return { dx: r.width ? dxPx / r.width * 100 : 0, dy: r.height ? dyPx / r.height * 100 : 0 };
            },
            square: wrap.dataset.square === '1',
            minW: 3, minH: 3, maxW: 100, maxH: 100,
            onEdit: () => openPageElementEditor(el.id),
            onDelete: () => {
                if (!confirm('Delete this element?')) return;
                const f = peFindEl(el.id);
                if (f) {
                    f.sec.elements = f.sec.elements.filter(x => x.id !== el.id);
                    // связанный gear вьюпорта
                    if (el.type === 'viewport') {
                        pageEditorPage.sections.forEach(s => {
                            s.elements = s.elements.filter(x => !(x.type === 'vpgear' && x.gearFor === el.id));
                        });
                    }
                    EkSel.id = null;
                    renderPage(pageEditTab);
                }
            }
        });
    });

    // тап по пустому месту канваса — снять выделение
    content.querySelectorAll('.page-canvas').forEach(c => {
        c.addEventListener('pointerdown', e => {
            if (!e.target.closest('.ge-wrap')) EkSel.clear();
        });
    });

    if (EkSel.id) EkSel.set(EkSel.id);
}

// ==================== СОЗДАНИЕ ЭЛЕМЕНТОВ (страница, units %) ====================

function makePageElement(spec) {
    const base = { id: uid(), opacity: 100, x: 5, y: 8 };
    const t = spec.type;

    if (String(t).startsWith('blk-')) {
        const def = BLOCK_DEFS[t] || { w: 96, h: 100 };
        return Object.assign(base, { type: t, x: 2, y: 0, w: def.w, h: 90 }, t === 'blk-mousepad' ? { sensKey: 'mouseSens' } : {});
    }

    switch (t) {
        case 'button':
            return Object.assign(base, {
                type: 'button', w: 20, h: 25,
                label: spec.label || (spec.action || 'x').toUpperCase(), kind: 'key', action: spec.action || 'x',
                mode: 'click', pressMs: 60, intervalMs: 120, color: 'btn-dark'
            });
        case 'touchpad':
            return Object.assign(base, {
                type: 'touchpad', w: 45, h: 60, label: spec.label || 'Pad',
                sens: null, lmbTap: null, edgeEnabled: null, edgeSizePx: null, edgeSpeed: null
            });
        case 'scrollbar':
            return Object.assign(base, { type: 'scrollbar', w: 12, h: 70, axis: 'y', label: spec.label || 'Scroll' });
        case 'joystick':
            return Object.assign(base, { type: 'joystick', w: 30, h: 60 });
        case 'viewport': {
            const el = Object.assign(base, { type: 'viewport', w: 60, h: 70, vp: vpDefaults() });
            el._gear = { id: uid(), type: 'vpgear', gearFor: el.id, x: 68, y: 8, w: 8, h: 12, opacity: 100 };
            return el;
        }
        case 'slider': return Object.assign(base, { type: 'slider', w: 60, h: 18, label: spec.label || '', binding: 'volume', min: 0, max: 100 });
        case 'toggle': return Object.assign(base, { type: 'toggle', w: 30, h: 20, label: spec.label || '', binding: 'power' });
        case 'input': return Object.assign(base, { type: 'input', w: 60, h: 18, label: spec.label || 'Text' });
        case 'label': return Object.assign(base, { type: 'label', w: 40, h: 12, label: spec.label || 'Label', size: 13 });
        case 'sequence': return Object.assign(base, { type: 'sequence', w: 25, h: 20, label: spec.label || '▶ Seq', steps: [{ kind: 'key', value: 'f5', delay: 100 }] });
        case 'sys-fs': return Object.assign(base, { type: 'sys-fs', w: 25, h: 18 });
    }
    return null;
}

// ==================== ФОРМЫ ====================

function openPageElementEditor(id) {
    const found = peFindEl(id);
    if (!found) return;
    const { el } = found;

    const body = $('#element-editor-body');
    const title = $('#element-editor-title');
    if (!body) return;
    title.textContent = 'Element: ' + el.type;

    ekBuildElementForm(body, el, {
        units: '%',
        showLayer: false,
        gset,
        rerender: () => { renderPage(pageEditTab); EkSel.set(el.id); },
        applyFrameLive: e => {
            const wrap = document.querySelector(`#tab-${pageEditTab} [data-ge-id="${e.id}"]`);
            if (wrap) applyWrapFrame(e, wrap, pageElCtx(pageEditTab));
        }
    });

    showModal('element-editor-overlay');
}

function openSectionEditor(sec) {
    const body = $('#element-editor-body');
    const title = $('#element-editor-title');
    if (!body) return;
    title.textContent = 'Section';
    body.innerHTML = '';

    ekRow(body, 'Title', ekText(sec.title, v => { sec.title = v; renderPage(pageEditTab); }));
    ekRow(body, 'Height px', ekNum(sec.h, v => { sec.h = v; renderPage(pageEditTab); }, 40, 2000));

    showModal('element-editor-overlay');
}
