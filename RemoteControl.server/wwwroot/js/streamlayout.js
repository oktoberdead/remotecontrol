// ============================================================================
// streamlayout.js — вкладка Stream остаётся как есть функционально, но её
// блоки (экран, панель настроек, тачпад, кнопки мыши, инпут, quick-keys)
// можно переставлять/ресайзить ОТДЕЛЬНО для портретной и альбомной ориентаций.
//
// Конфиг: uiCfg.streamLayout = {
//   portrait:  { custom: bool, blocks: { view:{x,y,w,h}, ... } },  // % от .stream-wrap
//   landscape: { custom: bool, blocks: {...} }
// }
// Пока custom=false — работает прежний flex-лэйаут (ничего не менялось).
// ============================================================================

const STREAM_BLOCKS = ['view', 'settings', 'touchpad', 'buttons', 'input', 'quickkeys'];

let streamEditing = false;
let streamEditBlocks = null;  // рабочая копия фреймов текущей ориентации
let streamEditOrient = null;  // ориентация, В КОТОРОЙ шло редактирование

function streamOrient() {
    return (window.matchMedia && window.matchMedia('(orientation: landscape)').matches) ? 'landscape' : 'portrait';
}

function streamLayoutCfg() {
    if (!uiCfg.streamLayout) uiCfg.streamLayout = { portrait: { custom: false, blocks: {} }, landscape: { custom: false, blocks: {} } };
    return uiCfg.streamLayout;
}

function streamBlockEl(id) {
    return document.querySelector(`#tab-stream [data-sblock="${id}"]`);
}

// применить конфиг текущей ориентации (или вернуть дефолтный flex)
function applyStreamLayout() {
    const wrap = document.querySelector('#tab-stream .stream-wrap');
    if (!wrap) return;
    const cfg = streamLayoutCfg()[streamOrient()];
    const custom = streamEditing || (cfg && cfg.custom);

    wrap.classList.toggle('custom-layout', !!custom);

    STREAM_BLOCKS.forEach(id => {
        const el = streamBlockEl(id);
        if (!el) return;
        const f = streamEditing ? streamEditBlocks[id] : (cfg && cfg.blocks && cfg.blocks[id]);
        if (custom && f) {
            el.style.left = f.x + '%';
            el.style.top = f.y + '%';
            el.style.width = f.w + '%';
            el.style.height = f.h + '%';
        } else {
            el.style.left = el.style.top = el.style.width = el.style.height = '';
        }
    });
}

// стартовые фреймы: из сохранённых или с текущей раскладки (rect → %)
function snapshotStreamFrames() {
    const wrap = document.querySelector('#tab-stream .stream-wrap');
    const wr = wrap.getBoundingClientRect();
    const saved = streamLayoutCfg()[streamOrient()];
    const out = {};
    STREAM_BLOCKS.forEach(id => {
        if (saved && saved.custom && saved.blocks[id]) {
            out[id] = Object.assign({}, saved.blocks[id]);
            return;
        }
        const el = streamBlockEl(id);
        if (!el || !wr.width || !wr.height) {
            out[id] = { x: 2, y: 2, w: 40, h: 20 };
            return;
        }
        const r = el.getBoundingClientRect();
        out[id] = {
            x: ekRound((r.left - wr.left) / wr.width * 100),
            y: ekRound((r.top - wr.top) / wr.height * 100),
            w: Math.max(4, ekRound(r.width / wr.width * 100)),
            h: Math.max(3, ekRound(r.height / wr.height * 100))
        };
    });
    return out;
}

// ==================== РЕДАКТИРОВАНИЕ ====================

function enterStreamEdit() {
    if (streamEditing) return;
    if (gameEditMode) exitEditMode(false);
    if (pageEditTab) exitPageEdit(false);
    if (currentTab !== 'stream') switchToTab('stream');

    streamEditing = true;
    streamEditOrient = streamOrient();
    streamEditBlocks = snapshotStreamFrames();

    const wrap = document.querySelector('#tab-stream .stream-wrap');
    wrap.classList.add('edit-mode', 'stream-editing');
    EkSel.scope = wrap;
    EkSel.id = null;

    document.getElementById('page-editor-overlay')?.classList.add('show', 'collapsed');
    const badge = $('#page-editor-title');
    if (badge) badge.textContent = '✏️ Stream · ' + streamOrient();
    // секции/добавление к стриму не применимы
    $('#btn-page-add-section').style.display = 'none';
    $('#btn-stream-reset').style.display = '';

    STREAM_BLOCKS.forEach(id => {
        const el = streamBlockEl(id);
        if (!el) return;
        // классы редактора ВРЕМЕННЫЕ: .ge-wrap делает блок absolute, поэтому
        // при выходе обязательно снимаем (иначе вкладка рассыпается)
        el.classList.add('ge-wrap', 'game-element', 'stream-block');
        el.dataset.geId = 'sb-' + id;
        if (!el.querySelector('.ctl-handle')) {
            ekInjectHandles(el, { edit: false, del: false }); // только перестановка/ресайз
        }

        if (!el.dataset.ekBound) {
            el.dataset.ekBound = '1';
            ekBindInteraction(el, 'sb-' + id, {
                isEditing: () => streamEditing,
                getFrame: () => Object.assign({}, streamEditBlocks[id]),
                setFrame: f => { streamEditBlocks[id] = f; },
                applyFrame: () => applyStreamLayout(),
                toUnits: (dxPx, dyPx) => {
                    const r = wrap.getBoundingClientRect();
                    return { dx: r.width ? dxPx / r.width * 100 : 0, dy: r.height ? dyPx / r.height * 100 : 0 };
                },
                minW: 4, minH: 3, maxW: 100, maxH: 100
            });
        }
    });

    applyStreamLayout();
}

function exitStreamEdit(save) {
    if (!streamEditing) return;
    if (save) {
        streamLayoutCfg()[streamEditOrient || streamOrient()] = { custom: true, blocks: streamEditBlocks };
        saveUiConfig();
        toast('Stream layout saved (' + (streamEditOrient || streamOrient()) + ')');
    }
    streamEditOrient = null;
    streamEditing = false;
    streamEditBlocks = null;
    EkSel.clear();
    EkSel.scope = null;

    const wrap = document.querySelector('#tab-stream .stream-wrap');
    wrap?.classList.remove('edit-mode', 'stream-editing');

    // снять редакторные классы и хэндлы с блоков — вне редактора они статичны
    STREAM_BLOCKS.forEach(id => {
        const el = streamBlockEl(id);
        if (!el) return;
        el.classList.remove('ge-wrap', 'game-element', 'stream-block', 'selected', 'show-actions', 'resizing');
        el.querySelectorAll(':scope > .ctl-handle').forEach(h => h.remove());
    });
    document.getElementById('page-editor-overlay')?.classList.remove('show');
    $('#btn-page-add-section').style.display = '';
    $('#btn-stream-reset').style.display = 'none';

    applyStreamLayout();
}

// сброс текущей ориентации на дефолтный flex-лэйаут
$('#btn-stream-reset')?.addEventListener('click', async () => {
    if (!streamEditing) return;
    const o = streamEditOrient || streamOrient();
    if (!await rcConfirm('Сбросить лэйаут Stream (' + o + ') на дефолтный?')) return;
    streamLayoutCfg()[o] = { custom: false, blocks: {} };
    saveUiConfig();
    exitStreamEdit(false);
});

// ==================== ХУКИ ====================

// Save/Cancel в page-editor-overlay обслуживают и stream-сессию
$('#btn-page-save')?.addEventListener('click', () => { if (streamEditing) exitStreamEdit(true); });
$('#btn-page-cancel')?.addEventListener('click', () => { if (streamEditing) exitStreamEdit(false); });

window.addEventListener('resize', () => {
    // смена ориентации посреди редактирования — выходим без сохранения,
    // чтобы правки не уехали в чужую ориентацию
    if (streamEditing && streamOrient() !== streamEditOrient) {
        toast('Orientation changed — edit cancelled');
        exitStreamEdit(false);
        return;
    }
    applyStreamLayout();
});

tabEnterHooks.push(id => { if (id === 'stream') applyStreamLayout(); });
uiReadyHooks.push(() => applyStreamLayout());
