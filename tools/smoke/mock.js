// Мок-сервер: статика из wwwroot + заглушки API (для смоук-теста фронта)
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.WWWROOT || require('path').join(__dirname, '..', '..', 'RemoteControl.server', 'wwwroot');
let uiStore = null;

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
        const url = req.url.split('?')[0];
        const send = obj => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };

        if (url.startsWith('/api/')) {
            if (url === '/api/ui' && req.method === 'GET') return send({ success: true, config: uiStore || { tabs: {}, settings: { mouseSens: 18, streamSens: 18, edgeEnabled: true, edgeSize: 10, edgeSpeed: 30 }, widgets: { main: [], monitor: [], mouse: [], keys: [] } } });
            if (url === '/api/ui' && req.method === 'POST') { try { uiStore = JSON.parse(body).config; } catch { } return send({ success: true }); }
            if (url === '/api/client/info') return send({ success: true, ip: '192.168.1.77' });
            if (url === '/api/volume') return send({ volume: 42 });
            if (url === '/api/wg/status') return send({ status: 'Stopped' });
            if (url === '/api/keyboard/layout') return send({ layout: 'EN' });
            if (url === '/api/audio/devices') return send({ success: true, devices: [{ name: 'Speakers', isDefault: true }] });
            if (url === '/api/monitor/state') return send({ success: true, available: true, monitor: 'Primary', brightness: 60, brightnessMax: 100, powerOn: true, powerKnown: true });
            if (url === '/api/monitor2/state') return send({ success: true, available: true, monitors: [{ index: 0, description: 'DELL U2723QE' }], index: 0, brightness: 55, brightnessMin: 0, brightnessMax: 100, powerMode: 1, powerOn: true, powerKnown: true });
            if (url === '/api/game/layout') return send({ stick: { x: 10, y: 80, w: 160, h: 160 }, camera: { x: 490, y: 80, w: 240, h: 240 }, scroll: { x: 380, y: 80, w: 42, h: 160 }, ctrl: { x: 10, y: 30, w: 70, h: 36 }, space: { x: 180, y: 80, w: 50, h: 160 }, buy: { x: 280, y: 180, w: 80, h: 44 }, rmb: { x: 430, y: 80, w: 46, h: 76 }, lmb: { x: 430, y: 164, w: 46, h: 76 }, btnE: { x: 490, y: 30, w: 46, h: 36 }, btnF: { x: 544, y: 30, w: 46, h: 36 }, btnR: { x: 598, y: 30, w: 46, h: 36 }, customButtons: [{ label: 'G', type: 'key-hold', action: 'g', color: 'btn-dark', x: 200, y: 150, w: 60, h: 40 }] });
            if (url === '/api/system/config') return send({ success: true, content: '{\n  "Port": 8086\n}' });
            if (url === '/api/screen/state') return send({ zoom: 1, panX: 0.5, panY: 0.5 });
            if (url === '/api/screen/fps') return send({ fps: 60 });
            return send({ success: true, status: 'OK' });
        }

        let file = url === '/' ? '/index.html' : url;
        const p = path.join(ROOT, file);
        fs.readFile(p, (err, data) => {
            if (err) { res.statusCode = 404; return res.end('nf'); }
            res.setHeader('Content-Type', MIME[path.extname(p)] || 'application/octet-stream');
            res.end(data);
        });
    });
});

server.listen(8099, '0.0.0.0', () => console.log('mock on 8099'));
