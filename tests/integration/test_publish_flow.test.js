'use strict';

// T023: flujo completo de publicación contra una página controlada que replica la
// estructura de selectores estables de WhatsApp Web (data-icon, role, aria-label).
// Cubre: sesión autenticada/no autenticada, subida de imagen, texto y confirmación.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const bot = require('../../whatsappBot');

const MOCK_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Mock WhatsApp</title>
<style>
  span[data-icon] { display: inline-block; width: 16px; height: 16px; background: #667; }
  div[contenteditable] { display: block; min-height: 24px; }
  input[type="file"] { display: block; }
  #composer { min-height: 60px; }
</style>
</head>
<body>
  <nav aria-label="Chats"><span data-icon="chat"></span></nav>
  <button id="status-tab"><span data-icon="status"></span></button>
  <button id="add-status"><span data-icon="plus"></span></button>
  <div id="composer" role="dialog" style="display:none">
    <input type="file" id="file" />
    <div contenteditable="true" aria-label="Agrega una descripción" id="caption"></div>
    <button id="send"><span data-icon="send"></span></button>
  </div>
  <script>
    const params = new URLSearchParams(location.search);
    if (params.get('auth') === '0') document.querySelector('[data-icon="chat"]').remove();
    document.getElementById('status-tab').addEventListener('click', () => {});
    document.getElementById('add-status').addEventListener('click', () => {
      document.getElementById('composer').style.display = 'block';
    });
    document.getElementById('send').addEventListener('click', () => {
      const caption = document.getElementById('caption');
      window.__posted = caption.textContent;
      document.getElementById('composer').style.display = 'none';
    });
  </script>
</body></html>`;

let server;
let baseUrl;
// Perfil Chromium temporal: la integración NUNCA toca session/ real (FR-016)
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-session-'));
before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(MOCK_HTML);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('verifySession: authenticated mock → authenticated: true', async () => {
  const result = await bot.verifySession({ url: `${baseUrl}?auth=1`, headless: true, timeoutMs: 15000, sessionDir });
  assert.equal(result.authenticated, true, result.reason);
});

test('verifySession: missing stable selector → authenticated: false, no QR/interactive login', async () => {
  const result = await bot.verifySession({ url: `${baseUrl}?auth=0`, headless: true, timeoutMs: 5000, sessionDir });
  assert.equal(result.authenticated, false);
});

test('publishStatus: full flow — open status, upload image, write text, publish, confirm', async () => {
  const imagePath = path.join(__dirname, '..', '..', 'assets', 'ensalada.png');
  assert.ok(fs.existsSync(imagePath));

  const result = await bot.publishStatus({
    imagePath,
    text: 'Ensalada César\n$8.50\nLechuga y pollo\nPide la tuya',
    timeoutMs: 20000,
    url: `${baseUrl}?auth=1`,
    headless: true,
    sessionDir
  });
  assert.deepEqual(result, { ok: true });
});

test('publishStatus: navigation failure → tagged error-red (FR-010 motivo)', async () => {
  await assert.rejects(
    bot.publishStatus({
      imagePath: path.join(__dirname, '..', '..', 'assets', 'ensalada.png'),
      text: 'x',
      timeoutMs: 8000,
      url: 'http://127.0.0.1:1/nope',
      headless: true,
      sessionDir
    }),
    (err) => err.motivo === 'error-red'
  );
});

test('publishStatus: missing stable selectors → tagged error-interfaz (FR-012)', async () => {
  // Página con auth pero sin componedor: el localizador del status/add falla como interfaz
  const bare = `<!doctype html><html><body><span data-icon="chat"></span></body></html>`;
  const bareServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(bare);
  });
  await new Promise((resolve) => bareServer.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(
      bot.publishStatus({
        imagePath: path.join(__dirname, '..', '..', 'assets', 'ensalada.png'),
        text: 'x',
        timeoutMs: 6000,
        url: `http://127.0.0.1:${bareServer.address().port}/`,
        headless: true,
        sessionDir
      }),
      (err) => err.motivo === 'error-interfaz'
    );
  } finally {
    await new Promise((resolve) => bareServer.close(resolve));
  }
});
