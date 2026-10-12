'use strict';

// T023: flujo completo de publicación contra una página controlada que replica la
// estructura de selectores estables de WhatsApp Web OBSERVADA en oct-2026 (roles
// ARIA de la lista de chats, aria-label del compositor y data-icon del envío).
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
  body { font-family: sans-serif; margin: 0; }
  [role="grid"], [role="listitem"], button { display: block; }
  [role="grid"] { min-height: 40px; padding: 6px; }
  #composer { min-height: 60px; padding: 8px; }
  #preview { display: block; width: 160px; height: 120px; background: #eee; }
  [contenteditable] { display: block; min-height: 24px; border: 1px solid #ccc; }
  #send { display: inline-block; width: 24px; height: 24px; background: #00a884; }
</style>
</head>
<body>
  <!-- Autenticación (DOM vigente): roles ARIA de la lista de chats -->
  <button aria-label="Chats" id="nav-chats">Chats</button>
  <div role="tablist" id="chat-filters"></div>
  <div role="grid" id="chat-grid"><div role="listitem">Chat de ejemplo</div></div>

  <!-- Pestaña de Estados y compositor -->
  <button aria-label="Estados" id="status-tab">Estados</button>
  <button aria-label="Add Status" id="add-status" style="display:none">Add Status</button>
  <button data-testid="status-header" id="my-status" style="display:none">
    <span id="my-status-text">Hoy, 12:00</span>
  </button>
  <div role="menu" id="status-menu" style="display:none">
    <button role="menuitem" aria-label="Fotos y videos" id="menu-photo">Fotos y videos</button>
    <button role="menuitem" aria-label="Texto" id="menu-text">Texto</button>
  </div>
  <input type="file" id="file" style="display:none" />
  <div id="composer" style="display:none">
    <div id="preview-box"></div>
    <div role="textbox" contenteditable="true" aria-label="Añade un comentario" id="caption"></div>
    <span data-icon="wds-ic-send-filled" id="send"></span>
  </div>
  <script>
    const params = new URLSearchParams(location.search);
    if (params.get('auth') === '0') {
      // Sin indicadores estables: multi-indicador (US1) exige ausencia de TODOS
      document.getElementById('nav-chats').remove();
      document.getElementById('chat-filters').remove();
      document.getElementById('chat-grid').remove();
    }
    document.getElementById('status-tab').addEventListener('click', () => {
      document.getElementById('add-status').style.display = 'block';
      document.getElementById('my-status').style.display = 'block';
    });
    document.getElementById('add-status').addEventListener('click', () => {
      document.getElementById('status-menu').style.display = 'block';
    });
    document.getElementById('menu-photo').addEventListener('click', () => {
      // igual que el WhatsApp real: el menú dispara el selector de archivos nativo
      document.getElementById('file').click();
    });
    document.getElementById('file').addEventListener('change', () => {
      document.getElementById('status-menu').style.display = 'none';
      // como en WhatsApp Web: la imagen se previsualiza mientras el cliente la
      // decodifica (700 ms en el mock); hasta entonces la carga NO ha terminado
      const img = document.createElement('img');
      img.id = 'preview';
      img.alt = 'preview';
      img.src = '/preview.png?delay=' + (params.get('delay') || '700');
      document.getElementById('preview-box').appendChild(img);
      document.getElementById('composer').style.display = 'block';
    });
    document.getElementById('send').addEventListener('click', () => {
      const img = document.getElementById('preview');
      if (img && !img.complete) {
        // el cliente descarta el estado si se envía con la imagen a medio cargar
        window.__sendPrematuro = true;
        return;
      }
      window.__posted = document.getElementById('caption').textContent;
      document.getElementById('composer').style.display = 'none';
      // como en WhatsApp Web: el compositor se cierra al instante, pero la imagen
      // sigue subiendo al CDN — la fila «Mi estado» queda en «Enviando…» mientras
      // dura la petición de subida (si el navegador se cierra, esta se aborta)
      const texto = document.getElementById('my-status-text');
      texto.textContent = 'Enviando…';
      fetch('/upload?delay=' + (params.get('upload') || '1000')).then(() => {
        texto.textContent = 'Hoy, 12:00';
      });
    });
  </script>
</body></html>`;

let server;
let baseUrl;
// Estado de la subida al CDN del último intento: el test exige que termine y que
// NUNCA se aborte (el bot no debe cerrar el navegador con la subida en vuelo)
const subida = { terminada: false, abortada: false };
// Perfil Chromium temporal: la integración NUNCA toca session/ real (FR-016)
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-session-'));
before(async () => {
  const png = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'ensalada.png'));
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    // Vista previa con retardo: replica la decodificación de la imagen en el
    // compositor (el bot DEBE esperarla antes de pulsar «enviar»)
    if (url.pathname === '/preview.png') {
      const delay = Number(url.searchParams.get('delay')) || 0;
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(png);
      }, delay);
      return;
    }
    // Subida al CDN con retardo: si el navegador se cierra antes, la petición se
    // aborta y `subida.terminada` nunca llega a ser true
    if (url.pathname === '/upload') {
      const delay = Number(url.searchParams.get('delay')) || 0;
      const timer = setTimeout(() => {
        subida.terminada = true;
        try {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('ok');
        } catch {
          // la conexión ya no existe
        }
      }, delay);
      res.on('close', () => {
        if (!res.writableEnded) {
          clearTimeout(timer);
          subida.abortada = true;
        }
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(MOCK_HTML);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('verifySession: authenticated mock → autenticado: true (contrato §1)', async () => {
  const result = await bot.verifySession({ url: `${baseUrl}?auth=1`, headless: true, timeoutMs: 15000, sessionDir });
  assert.equal(result.autenticado, true, result.detalle || result.causa || '');
  assert.equal(typeof result.esperaAplicadaMs, 'number');
  assert.ok(Array.isArray(result.observacion.indicadores));
});

test('verifySession: sin ningún indicador estable → autenticado: false, sin QR ni login (FR-011)', async () => {
  const result = await bot.verifySession({ url: `${baseUrl}?auth=0`, headless: true, timeoutMs: 5000, sessionDir });
  assert.equal(result.autenticado, false);
});

test('publishStatus: full flow — open status, upload image, write text, publish, confirm', async () => {
  const imagePath = path.join(__dirname, '..', '..', 'assets', 'ensalada.png');
  assert.ok(fs.existsSync(imagePath));
  subida.terminada = false;
  subida.abortada = false;

  const result = await bot.publishStatus({
    imagePath,
    text: 'Ensalada César\n$8.50\nLechuga y pollo\nPide la tuya',
    timeoutMs: 20000,
    url: `${baseUrl}?auth=1`,
    headless: true,
    sessionDir
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(subida.abortada, false, 'el navegador se cerró con la subida en vuelo');
  assert.equal(subida.terminada, true, 'el estado no llegó a subirse al CDN');
});

test('publishStatus: espera a que la imagen del compositor termine de cargar antes de enviar', async () => {
  const imagePath = path.join(__dirname, '..', '..', 'assets', 'ensalada.png');
  const inicio = Date.now();

  // el mock rechaza el envío si la vista previa sigue cargando (delay=1500 ms)
  const result = await bot.publishStatus({
    imagePath,
    text: 'Ensalada César\n$8.50',
    timeoutMs: 25000,
    url: `${baseUrl}?auth=1&delay=1500`,
    headless: true,
    sessionDir
  });

  assert.deepEqual(result, { ok: true });
  assert.ok(Date.now() - inicio >= 1500, 'la publicación no esperó a que la imagen terminara de cargar');
});

test('publishStatus: espera a que el estado termine de SUBIRSE antes de cerrar el navegador', async () => {
  const imagePath = path.join(__dirname, '..', '..', 'assets', 'ensalada.png');
  subida.terminada = false;
  subida.abortada = false;

  // la subida al CDN dura 1200 ms: cerrar el navegador al enviar la abortaría
  const result = await bot.publishStatus({
    imagePath,
    text: 'Ensalada César\n$8.50',
    timeoutMs: 25000,
    url: `${baseUrl}?auth=1&upload=1200`,
    headless: true,
    sessionDir
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(subida.abortada, false, 'el navegador se cerró con la subida en vuelo');
  assert.equal(subida.terminada, true, 'la subida al CDN no terminó antes de cerrar');
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
  // Página cargada sin la app: ningún rol ARIA de la interfaz autenticada
  const bare = `<!doctype html><html><body><p>Cargando WhatsApp…</p></body></html>`;
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
