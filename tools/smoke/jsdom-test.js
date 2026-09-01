// Смоук-тест фронта на jsdom: init-поток, миграция, профили, редактор, модалки
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.WWWROOT || require('path').join(__dirname, '..', '..', 'RemoteControl.server', 'wwwroot');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('JSDOM: ' + e.message));
vc.on('error', (...a) => errors.push('CONSOLE.ERROR: ' + a.join(' ')));

// --- мок API ---
let uiStore = null;
const api = (url, method, body) => {
    if (url.startsWith('/api/ui') && method === 'GET') return { success: true, config: uiStore || { tabs: {}, settings: { mouseSens: 18, streamSens: 18, edgeEnabled: true, edgeSize: 10, edgeSpeed: 30 }, widgets: { main: [], monitor: [], mouse: [], keys: [] } } };
    if (url.startsWith('/api/ui') && method === 'POST') { uiStore = JSON.parse(body).config; return { success: true }; }
    if (url.startsWith('/api/client/info')) return { success: true, ip: '192.168.1.77' };
    if (url.startsWith('/api/volume')) return { volume: 42 };
    if (url.startsWith('/api/wg/status')) return { status: 'Stopped' };
    if (url.startsWith('/api/keyboard/layout')) return { layout: 'EN' };
    if (url.startsWith('/api/audio/devices')) return { success: true, devices: [{ name: 'Speakers', isDefault: true }] };
    if (url.startsWith('/api/monitor2/state')) return { success: true, available: true, monitors: [{ index: 0, description: 'DELL U2723QE' }], index: 0, brightness: 55, brightnessMin: 0, brightnessMax: 100, powerMode: 1, powerOn: true, powerKnown: true };
    if (url.startsWith('/api/monitor/state')) return { success: true, available: true, monitor: 'Primary', brightness: 60, brightnessMax: 100, powerOn: true, powerKnown: true };
    if (url.startsWith('/api/game/layout')) return { stick: { x: 10, y: 80, w: 160, h: 160 }, camera: { x: 490, y: 80, w: 240, h: 240 }, scroll: { x: 380, y: 80, w: 42, h: 160 }, ctrl: { x: 10, y: 30, w: 70, h: 36 }, space: { x: 180, y: 80, w: 50, h: 160 }, buy: { x: 280, y: 180, w: 80, h: 44 }, rmb: { x: 430, y: 80, w: 46, h: 76 }, lmb: { x: 430, y: 164, w: 46, h: 76 }, btnE: { x: 490, y: 30, w: 46, h: 36 }, btnF: { x: 544, y: 30, w: 46, h: 36 }, btnR: { x: 598, y: 30, w: 46, h: 36 }, customButtons: [{ label: 'G', type: 'key-hold', action: 'g', color: 'btn-dark', x: 200, y: 150, w: 60, h: 40 }] };
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

// element.setPointerCapture отсутствует в jsdom
window.Element.prototype.setPointerCapture = () => { };
window.Element.prototype.releasePointerCapture = () => { };
if (!window.screen.orientation) window.screen.orientation = { lock: async () => { }, unlock: () => { } };

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {

    const code = [...window.document.querySelectorAll('script[src]')]
        .map(s => fs.readFileSync(path.join(ROOT, s.getAttribute('src')), 'utf8'))
        .join('\n;\n') + `
;window.__test = {
  get gameEditMode() { return gameEditMode; },
  get gameEditorElements() { return gameEditorElements; },
  set editorActiveLayer(v) { editorActiveLayer = v; },
  get editorSelectedId() { return editorSelectedId; },
  get uiCfg() { return uiCfg; },
  get clientIp() { return clientIp; }
};`;
    try { window.eval(code); }
    catch (e) { errors.push('EVAL: ' + e.message); }
    await sleep(600);

    const w = window;
    const T = () => w.__test;
    const report = {};
    const check = (name, cond, extra) => { report[name] = cond ? 'OK' : 'FAIL' + (extra !== undefined ? ' (' + JSON.stringify(extra) + ')' : ''); };

    check('tabsRendered', w.document.querySelectorAll('.tab').length >= 5, w.document.querySelectorAll('.tab').length);

    // --- game: миграция ---
    w.switchToTab('game');
    await sleep(300);
    const els = w.activeProfile()?.elements || [];
    const types = els.map(e => e.type);
    check('migration14els', els.length === 15, els.length); // 11 старых + custom G + 3 системных
    check('migrationTypes', types.includes('joystick') && types.includes('touchpad') && types.includes('scrollbar') && types.includes('sys-fs') && types.includes('sys-settings') && types.includes('sys-gp'), types);
    check('gameDomCount', w.document.querySelectorAll('#game-area .game-element').length === els.length, w.document.querySelectorAll('#game-area .game-element').length);

    // --- settings modal ---
    w.openGameSettings();
    const rows = [...w.document.querySelectorAll('#game-settings-body .rc-form-row > span:first-child')].map(e => e.textContent);
    check('gameSettingsRows', rows[0] === 'Edit Layout' && rows.includes('Profiles') && rows.includes('Sensitivity') && rows.includes('Edge Size') && !rows.includes('Camera Sensitivity'), rows);
    w.closeGameSettings();

    // --- профили ---
    w.openProfilesModal();
    check('profilesHost', w.document.getElementById('profiles-host').textContent.includes('192.168.1.77'), w.document.getElementById('profiles-host').textContent);
    w.document.getElementById('profile-new-name').value = 'TestProf';
    w.document.getElementById('btn-profile-new').click();
    await sleep(100);
    check('profileNew', w.gameHost().profiles.length === 2 && w.activeProfile().name === 'TestProf');
    check('profileNewTemplate', w.activeProfile().elements.length === 5, w.activeProfile().elements.map(e => e.type));
    w.switchProfile(w.gameHost().profiles[0].id);
    await sleep(100);
    check('profileSwitchBack', w.activeProfile().name === 'Default' && w.gameHost().lastUsed === w.gameHost().profiles[0].id);
    w.hideModal('profiles-overlay');

    // --- редактор ---
    w.enterEditMode();
    await sleep(100);
    check('editModeOn', T().gameEditMode === true && w.document.getElementById('game-area').classList.contains('edit-mode'));
    check('layerBar', [...w.document.querySelectorAll('#editor-layerbar .lbtn')].map(b => b.textContent).join(',') === 'All,background,viewport,controls,overlay,system');
    const handleCount = w.document.querySelectorAll('#game-area .ctl-handle').length;
    check('handlesInjected', handleCount === (T().gameEditorElements.length * 3), handleCount);

    // выбор
    const firstId = T().gameEditorElements[0].id;
    w.editorSelect(firstId);
    check('selection', w.document.querySelector(`[data-ge-id="${firstId}"]`).classList.contains('selected'));
    w.editorSelect(firstId, true);
    check('dblTapActions', w.document.querySelector(`[data-ge-id="${firstId}"]`).classList.contains('show-actions'));

    // элемент-эдитор для touchpad
    const pad = T().gameEditorElements.find(e => e.type === 'touchpad');
    w.openElementEditor(pad.id);
    const padRows = [...w.document.querySelectorAll('#element-editor-body .rc-form-row > span:first-child')].map(e => e.textContent);
    check('padEditorRows', padRows.includes('Sens ×0.1') && padRows.includes('Edge size px') && padRows.includes('LMB on tap') && padRows.includes('Layer') && padRows.includes('Opacity'), padRows);
    w.hideModal('element-editor-overlay');

    // джойстик — без edge-полей
    const joy = T().gameEditorElements.find(e => e.type === 'joystick');
    w.openElementEditor(joy.id);
    const joyRows = [...w.document.querySelectorAll('#element-editor-body .rc-form-row > span:first-child')].map(e => e.textContent);
    check('joyNoEdge', !joyRows.some(r => r.toLowerCase().includes('edge')), joyRows);
    w.hideModal('element-editor-overlay');

    // кнопка: repeat-поля
    const btn = T().gameEditorElements.find(e => e.type === 'button');
    w.openElementEditor(btn.id);
    const btnRows = [...w.document.querySelectorAll('#element-editor-body .rc-form-row > span:first-child')].map(e => e.textContent);
    check('btnEditorRows', btnRows.includes('Mode') && btnRows.includes('Press ms (repeat)') && btnRows.includes('Interval ms (repeat)'), btnRows);
    w.hideModal('element-editor-overlay');

    // добавление вьюпорта → +vpgear
    w.document.getElementById('btn-add-element').click();
    w.document.getElementById('add-el-type').value = 'viewport';
    w.document.getElementById('btn-confirm-add-el').click();
    await sleep(100);
    const tAfter = T().gameEditorElements.map(e => e.type);
    check('vpAdded', tAfter.includes('viewport') && tAfter.includes('vpgear'), tAfter);

    // слои
    T().editorActiveLayer = 'controls';
    w.applyEditorLayerDim();
    const dimmed = w.document.querySelectorAll('#game-area .game-element.layer-dim').length;
    const totalEls = T().gameEditorElements.length;
    const ctlEls = T().gameEditorElements.filter(e => e.layer === 'controls').length;
    check('layerDim', dimmed === totalEls - ctlEls, { dimmed, totalEls, ctlEls });

    // save
    w.exitEditMode(true);
    await sleep(400);
    check('savedVp', w.activeProfile().elements.some(e => e.type === 'viewport'));
    check('uiStorePersisted', !!(uiStore && uiStore.game && uiStore.game.hosts && uiStore.game.hosts['192.168.1.77']));
    check('lastUsedPersisted', uiStore.game.hosts['192.168.1.77'].lastUsed === w.gameHost().profiles[0].id);

    // --- монитор ---
    w.switchToTab('monitor');
    await sleep(300);
    check('mon1Brightness', w.document.getElementById('mon-brightness-val').textContent === '60%', w.document.getElementById('mon-brightness-val').textContent);
    check('mon2Brightness', w.document.getElementById('mon2-brightness-val').textContent === '55%', w.document.getElementById('mon2-brightness-val').textContent);
    check('mon2Power', w.document.getElementById('mon2-power').textContent === 'Power: on');
    check('mon2Select', w.document.getElementById('mon2-select').options.length === 1);

    // --- settings ---
    w.switchToTab('settings');
    await sleep(100);
    check('tabsRows', w.document.querySelectorAll('#tabs-rows .settings-row').length === 7, w.document.querySelectorAll('#tabs-rows .settings-row').length);
    check('widgetTypes', [...w.document.querySelectorAll('#widget-type-sel option')].map(o => o.value).includes('viewport'));

    // виджет-вьюпорт на main
    w.document.getElementById('widget-type-sel').value = 'viewport';
    w.addWidget();
    await sleep(100);
    check('vpWidgetAdded', (uiCfg => uiCfg.widgets.main.some(x => x.type === 'viewport'))(T().uiCfg));
    w.switchToTab('main');
    await sleep(100);
    check('vpWidgetDom', !!w.document.querySelector('#custom-area-main .ge-viewport'));

    report.jsErrors = errors;
    console.log(JSON.stringify(report, null, 1));
    const fails = Object.entries(report).filter(([k, v]) => typeof v === 'string' && v.startsWith('FAIL'));
    process.exit(fails.length || errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); console.log('errors:', errors); process.exit(1); });
