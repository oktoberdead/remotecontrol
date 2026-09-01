// Смоук-тест фронта на jsdom: волна 2 — конструктор всей страницы.
// Прогоняет: init, дефолтные страницы, миграцию виджетов, page-редактор
// (секции/элементы/формы), tabs-менеджер, game-регресс, stream-layout.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.WWWROOT || require('path').join(__dirname, '..', '..', 'RemoteControl.server', 'wwwroot');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('JSDOM: ' + e.message));
vc.on('error', (...a) => errors.push('CONSOLE.ERROR: ' + a.join(' ')));

// --- мок API; стартовый ui-конфиг = следы волны 1 (widgets + game-профили) ---
let uiStore = {
    tabs: {},
    settings: { mouseSens: 18, streamSens: 18, edgeEnabled: true, edgeSize: 10, edgeSpeed: 30 },
    widgets: {
        main: [{ id: 'w1', type: 'button', label: 'OldBtn', action: 'ctrl+k', pressMode: 'click', x: 5, y: 5, w: 30, h: 15, color: 'btn-primary' }],
        monitor: [], mouse: [], keys: []
    },
    game: {
        settings: { sens: 15, lmbTap: true, edgeEnabled: true, edgeSizePx: 20, edgeSpeed: 12 },
        hosts: {
            '192.168.1.77': {
                profiles: [{
                    id: 'prof1', name: 'Default', elements: [
                        { id: 'g1', type: 'joystick', layer: 'controls', x: 14, y: 120, w: 170, h: 170, opacity: 100 },
                        { id: 'g2', type: 'touchpad', layer: 'controls', x: 470, y: 70, w: 250, h: 250, opacity: 40, label: 'Camera', sens: null, lmbTap: null, edgeEnabled: null, edgeSizePx: null, edgeSpeed: null },
                        { id: 'g3', type: 'button', layer: 'controls', x: 10, y: 10, w: 60, h: 40, opacity: 100, label: 'E', kind: 'key', action: 'e', mode: 'hold', color: 'btn-dark' },
                        { id: 'g4', type: 'sys-fs', layer: 'system', x: 8, y: 6, w: 96, h: 30, opacity: 100 }
                    ]
                }],
                lastUsed: 'prof1'
            }
        }
    }
};

const api = (url, method, body) => {
    if (url.startsWith('/api/ui') && method === 'GET') return { success: true, config: uiStore };
    if (url.startsWith('/api/ui') && method === 'POST') { uiStore = JSON.parse(body).config; return { success: true }; }
    if (url.startsWith('/api/client/info')) return { success: true, ip: '192.168.1.77' };
    if (url.startsWith('/api/volume')) return { volume: 42 };
    if (url.startsWith('/api/wg/status')) return { status: 'Stopped' };
    if (url.startsWith('/api/keyboard/layout')) return { layout: 'EN' };
    if (url.startsWith('/api/audio/devices')) return { success: true, devices: [{ name: 'Speakers', isDefault: true }] };
    if (url.startsWith('/api/monitor2/state')) return { success: true, available: true, monitors: [{ index: 0, description: 'DELL U2723QE' }], index: 0, brightness: 55, brightnessMin: 0, brightnessMax: 100, powerMode: 1, powerOn: true, powerKnown: true };
    if (url.startsWith('/api/monitor/state')) return { success: true, available: true, monitor: 'Primary', brightness: 60, brightnessMax: 100, powerOn: true, powerKnown: true };
    if (url.startsWith('/api/game/layout')) return {};
    if (url.startsWith('/api/system/config')) return { success: true, content: '{ "Port": 8086 }' };
    if (url.startsWith('/api/screen/state')) return { zoom: 1, panX: 0.5, panY: 0.5 };
    if (url.startsWith('/api/screen/fps')) return { fps: 60 };
    return { success: true, status: 'OK' };
};

const dom = new JSDOM(html, {
    url: 'http://localhost:8099/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc
});

const { window } = dom;

window.fetch = (url, opts = {}) => {
    const data = api(url, opts.method || 'GET', opts.body);
    return Promise.resolve({ json: () => Promise.resolve(data) });
};
window.WebSocket = class {
    constructor() { this.readyState = 0; setTimeout(() => { if (this.onerror) this.onerror(); if (this.onclose) this.onclose(); }, 5); }
    send() { }
    close() { if (this.onclose) this.onclose(); }
};
window.WebSocket.OPEN = 1;
window.HTMLCanvasElement.prototype.getContext = () => null;
window.confirm = () => true;
window.Element.prototype.setPointerCapture = () => { };
window.Element.prototype.releasePointerCapture = () => { };
if (!window.screen.orientation) window.screen.orientation = { lock: async () => { }, unlock: () => { } };

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const code = [...window.document.querySelectorAll('script[src]')]
        .map(s => fs.readFileSync(path.join(ROOT, s.getAttribute('src')), 'utf8'))
        .join('\n;\n') + `
;window.__test = {
  get uiCfg() { return uiCfg; },
  get gameEditMode() { return gameEditMode; },
  get gameEditorElements() { return gameEditorElements; },
  get pageEditTab() { return pageEditTab; },
  get pageEditorPage() { return pageEditorPage; },
  get streamEditing() { return streamEditing; },
  get streamEditBlocks() { return streamEditBlocks; },
  get EkSel() { return EkSel; }
};`;
    try { window.eval(code); }
    catch (e) { errors.push('EVAL: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')); }

    await sleep(700);

    const w = window;
    const doc = w.document;
    const T = () => w.__test;
    const report = {};
    const check = (name, cond, extra) => { report[name] = cond ? 'OK' : 'FAIL' + (extra !== undefined ? ' (' + JSON.stringify(extra) + ')' : ''); };

    // ==================== СТРАНИЦЫ: ДЕФОЛТЫ + МИГРАЦИЯ ====================
    check('tabsRendered', doc.querySelectorAll('.tab').length >= 6, doc.querySelectorAll('.tab').length);
    check('pagesBuilt', ['main', 'monitor', 'mouse', 'keys'].every(id => doc.getElementById('tab-' + id)), Object.keys(T().uiCfg.pages || {}));

    const mainTitles = [...doc.querySelectorAll('#tab-main .page-section h2')].map(e => e.textContent);
    check('mainSections', ['Volume', 'Media', 'System', 'WireGuard', 'Custom'].every(t => mainTitles.includes(t)), mainTitles);
    check('widgetMigrated', (() => {
        const custom = T().uiCfg.pages.main.sections.find(s => s.title === 'Custom');
        const el = custom && custom.elements[0];
        return el && el.type === 'button' && el.kind === 'combo' && el.action === 'ctrl+k';
    })());
    check('monitorBlocks', !!doc.querySelector('#tab-main') && !!doc.querySelector('#tab-monitor .blk-monitor-cmm') && !!doc.querySelector('#tab-monitor .blk-monitor-ddc'));
    check('mousepadBlock', !!doc.querySelector('#tab-mouse .blk-mousepad .blk-pad'));
    check('keysBlocks', !!doc.querySelector('#tab-keys .blk-live-input input') && !!doc.querySelector('#tab-keys .blk-send-text'));
    check('mainActive', doc.getElementById('tab-main').classList.contains('active'));

    // монитор-блоки живые (данные пришли)
    w.switchToTab('monitor');
    await sleep(300);
    check('monCmmLive', doc.getElementById('mon-brightness-val')?.textContent === '60%', doc.getElementById('mon-brightness-val')?.textContent);
    check('monDdcLive', doc.getElementById('mon2-brightness-val')?.textContent === '55%', doc.getElementById('mon2-brightness-val')?.textContent);

    // ==================== PAGE EDITOR ====================
    w.enterPageEdit('main');
    await sleep(150);
    check('pageEditOn', T().pageEditTab === 'main' && doc.getElementById('page-editor-overlay').classList.contains('show'));
    check('secToolbars', doc.querySelectorAll('#tab-main .sec-toolbar').length === T().pageEditorPage.sections.length);

    // структура wrap/body: хэндлы — сиблинги body → opacity элемента их не трогает
    const anyWrap = doc.querySelector('#tab-main .ge-wrap');
    check('wrapStructure', !!anyWrap.querySelector('.ge-body') && anyWrap.querySelectorAll(':scope > .ctl-handle').length === 3);
    const handleInBody = doc.querySelector('#tab-main .ge-body .ctl-handle');
    check('handlesOutsideBody', !handleInBody);

    // выбор + двойной тап (через EkSel — общая логика)
    const firstId = T().pageEditorPage.sections[0].elements[0].id;
    T().EkSel.set(firstId);
    check('pageSelect', doc.querySelector(`#tab-main [data-ge-id="${firstId}"]`).classList.contains('selected'));
    T().EkSel.set(firstId, true);
    check('pageDblActions', doc.querySelector(`#tab-main [data-ge-id="${firstId}"]`).classList.contains('show-actions'));

    // добавление секции
    const secCountBefore = T().pageEditorPage.sections.length;
    doc.getElementById('btn-page-add-section').click();
    await sleep(80);
    check('sectionAdded', T().pageEditorPage.sections.length === secCountBefore + 1);

    // добавление элемента в новую секцию через модалку
    const newSec = T().pageEditorPage.sections[T().pageEditorPage.sections.length - 1];
    const addBtn = [...doc.querySelectorAll('#tab-main .page-section')].pop().querySelector('[data-a="add"]');
    addBtn.click();
    await sleep(50);
    check('addModalShown', doc.getElementById('add-element-overlay').classList.contains('show'));
    doc.getElementById('add-el-type').value = 'slider';
    doc.getElementById('btn-confirm-add-el').click();
    await sleep(80);
    check('elementAdded', newSec.elements.length === 1 && newSec.elements[0].type === 'slider');

    // форма кнопки: mouse → селект LMB/RMB/MMB; поля ms по режимам
    const btnEl = T().pageEditorPage.sections.flatMap(s => s.elements).find(e => e.type === 'button');
    btnEl.kind = 'mouse'; btnEl.action = 'left'; btnEl.mode = 'hold';
    w.openPageElementEditor(btnEl.id);
    await sleep(50);
    const formRows = () => [...doc.querySelectorAll('#element-editor-body .rc-form-row')];
    const rowByLabel = l => formRows().find(r => r.querySelector('span')?.textContent === l);
    const btnSel = rowByLabel('Button')?.querySelector('select');
    check('mouseSelect', !!btnSel && [...btnSel.options].map(o => o.value).join(',') === 'left,right,middle', btnSel && [...btnSel.options].map(o => o.value));
    check('holdHidesMs', rowByLabel('Press duration ms')?.style.display === 'none' && rowByLabel('Repeat interval ms')?.style.display === 'none');
    // switch mode → click: press виден, interval скрыт
    const modeSel = rowByLabel('Mode').querySelector('select');
    modeSel.value = 'click';
    modeSel.dispatchEvent(new w.Event('change'));
    await sleep(30);
    check('clickShowsPressOnly', rowByLabel('Press duration ms')?.style.display !== 'none' && rowByLabel('Repeat interval ms')?.style.display === 'none');
    modeSel.value = 'repeat';
    modeSel.dispatchEvent(new w.Event('change'));
    await sleep(30);
    check('repeatShowsBoth', rowByLabel('Press duration ms')?.style.display !== 'none' && rowByLabel('Repeat interval ms')?.style.display !== 'none');
    w.hideModal('element-editor-overlay');

    // секция: rename/height через форму
    w.openSectionEditor(newSec);
    await sleep(30);
    const titleInp = rowByLabel('Title').querySelector('input');
    titleInp.value = 'MySec';
    titleInp.dispatchEvent(new w.Event('change'));
    await sleep(50);
    check('sectionRenamed', newSec.title === 'MySec');
    w.hideModal('element-editor-overlay');

    // save
    w.exitPageEdit(true);
    await sleep(300);
    check('pageSaved', uiStore.pages.main.sections.some(s => s.title === 'MySec'));
    check('widgetsKeyGone', uiStore.widgets === undefined);

    // ==================== TABS MANAGER ====================
    w.switchToTab('settings');
    await sleep(100);
    check('tabsManagerRows', doc.querySelectorAll('#tabs-manager .tabman-row').length >= 7, doc.querySelectorAll('#tabs-manager .tabman-row').length);

    doc.getElementById('tab-new-name').value = 'TestTab';
    doc.getElementById('btn-tab-add').click();
    await sleep(150);
    const newTabId = Object.keys(T().uiCfg.pages).find(id => T().uiCfg.pages[id].title === 'TestTab');
    check('tabAdded', !!newTabId && !!doc.getElementById('tab-' + newTabId));
    check('tabOrderPlacement', T().uiCfg.tabOrder.indexOf(newTabId) < T().uiCfg.tabOrder.indexOf('stream'));

    // редактируемость новой вкладки
    w.enterPageEdit(newTabId);
    await sleep(100);
    check('newTabEditable', T().pageEditTab === newTabId);
    w.exitPageEdit(false);

    // удаление вкладки
    w.switchToTab('settings');
    await sleep(50);
    const delRow = [...doc.querySelectorAll('#tabs-manager .tabman-row')].find(r => r.querySelector('.tabman-name')?.textContent === 'TestTab');
    delRow.querySelector('.btn-danger').click();
    await sleep(150);
    check('tabDeleted', !T().uiCfg.pages[newTabId] && !doc.getElementById('tab-' + newTabId));

    // дропдаун: Edit-пункт для текущей вкладки
    w.switchToTab('main');
    await sleep(50);
    w.toggleTabMenu();
    check('dropdownEdit', !!doc.querySelector('#tab-menu .tab-menu-edit'));
    w.hideTabMenu();

    // ==================== GAME (регресс) ====================
    w.switchToTab('game');
    await sleep(200);
    check('gameRendered', doc.querySelectorAll('#game-area .ge-wrap').length === 4, doc.querySelectorAll('#game-area .ge-wrap').length);

    // opacity 40% на body, wrap — без opacity
    const padWrap = doc.querySelector('#game-area [data-ge-id="g2"]');
    check('opacityOnBody', padWrap.querySelector('.ge-body').style.opacity === '0.4' && padWrap.style.opacity === '');

    w.enterEditMode();
    await sleep(150);
    check('gameEditOn', T().gameEditMode === true);
    check('gameHandles', doc.querySelectorAll('#game-area .ctl-handle').length === 4 * 3);
    // хэндлы вне body и в game
    check('gameHandlesOutsideBody', !doc.querySelector('#game-area .ge-body .ctl-handle'));

    // add modal game: системные типы в списке
    doc.getElementById('btn-add-element').click();
    await sleep(50);
    const gameTypes = [...doc.getElementById('add-el-type').options].map(o => o.value);
    check('gameSysTypes', ['sys-fs', 'sys-settings', 'sys-gp'].every(t => gameTypes.includes(t)), gameTypes);
    doc.getElementById('add-el-type').value = 'sys-gp';
    doc.getElementById('btn-confirm-add-el').click();
    await sleep(100);
    check('sysGpAdded', T().gameEditorElements.some(e => e.type === 'sys-gp'));

    w.exitEditMode(true);
    await sleep(300);
    check('gameSaved', uiStore.game.hosts['192.168.1.77'].profiles[0].elements.some(e => e.type === 'sys-gp'));

    // ==================== STREAM LAYOUT ====================
    w.switchToTab('stream');
    await sleep(150);
    w.enterStreamEdit();
    await sleep(100);
    check('streamEditOn', T().streamEditing === true);
    const swrap = doc.querySelector('#tab-stream .stream-wrap');
    check('streamCustomClass', swrap.classList.contains('custom-layout') && swrap.classList.contains('edit-mode'));
    check('streamBlocksMarked', doc.querySelectorAll('#tab-stream [data-sblock].ge-wrap').length === 6);
    // только resize-хэндлы, без ✎/✕
    check('streamOnlyResize', doc.querySelectorAll('#tab-stream [data-sblock] .ctl-handle.h-resize').length === 6 &&
        doc.querySelectorAll('#tab-stream [data-sblock] .ctl-handle.h-edit').length === 0);

    T().streamEditBlocks.view.x = 50; // подвинули
    doc.getElementById('btn-page-save').click();
    await sleep(300);
    check('streamSaved', uiStore.streamLayout && uiStore.streamLayout.portrait.custom === true && uiStore.streamLayout.portrait.blocks.view.x === 50, uiStore.streamLayout);
    check('streamEditOff', T().streamEditing === false);
    check('streamAppliedAfterSave', swrap.classList.contains('custom-layout'));

    report.jsErrors = errors;
    console.log(JSON.stringify(report, null, 1));
    const fails = Object.entries(report).filter(([k, v]) => typeof v === 'string' && v.startsWith('FAIL'));
    process.exit(fails.length || errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); console.log('errors:', errors); process.exit(1); });
