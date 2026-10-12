'use strict';

// T012 (US2): las cuatro causas contra fixtures locales (servidor efímero, sin
// WhatsApp). SC-001: cada fallo nombra una causa distinta con su motivo y su
// mensaje de operador; nunca un genérico «sesión no disponible».

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const bot = require('../../whatsappBot');
const { CAUSA_MOTIVO, componerMensajeFallo } = require('../../index');
const { startFixtureServer } = require('../helpers/fixtureServer');

let server;
let puertoLibre;
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-us2-'));

before(async () => {
  server = await startFixtureServer();
  // Puerto TCP sin servidores: provoca un error de conexión inmediato (error-red)
  const s = net.createServer();
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  puertoLibre = s.address().port;
  await new Promise((resolve) => s.close(resolve));
});

after(async () => {
  if (server) await server.close();
});

function assertFalloValido(resultado, esperaAplicadaMs) {
  assert.equal(resultado.autenticado, false);
  assert.ok(
    ['sesion-caducada', 'interfaz-no-cargo-a-tiempo', 'cambio-interfaz', 'error-red'].includes(
      resultado.causa
    ),
    `causa inválida: ${resultado.causa}`
  );
  assert.ok(resultado.duracionMs <= esperaAplicadaMs, 'FR-013: duración ≤ espera aplicada');
  const motivo = CAUSA_MOTIVO[resultado.causa];
  const msg = componerMensajeFallo(resultado, 'diagnostics/verification-test');
  assert.ok(msg.startsWith(`${motivo}: `), `mensaje debe empezar con el motivo: ${msg}`);
  assert.doesNotMatch(msg, /^sesion-no-disponible: sesión no autenticada$/);
}

test('FR-004a: pantalla QR ⇒ causa sesion-caducada, rápido y con mensaje propio', async () => {
  const espera = 15000;
  const r = await bot.verifySession({
    url: `${server.baseUrl}/qr-screen.html`,
    headless: true,
    timeoutMs: espera,
    sessionDir
  });
  assertFalloValido(r, espera);
  assert.equal(r.causa, 'sesion-caducada');
  assert.ok(r.duracionMs < 5000, `debe detectarse cuanto aparece, duró ${r.duracionMs} ms`);
  assert.equal(r.observacion.senalQr, true);
  assert.match(componerMensajeFallo(r, 'diagnostics/x'), /npm run login/);
});

test('FR-004c / Clarificación 2: página cargada sin indicadores ⇒ cambio-interfaz', async () => {
  const espera = 1500;
  const r = await bot.verifySession({
    url: `${server.baseUrl}/loaded-no-indicators.html`,
    headless: true,
    timeoutMs: espera,
    sessionDir
  });
  assertFalloValido(r, espera);
  assert.equal(r.causa, 'cambio-interfaz');
  assert.notEqual(r.observacion.readyState, 'loading', 'la página terminó de cargar');
});

test('FR-004b: carga que excede el plazo ⇒ interfaz-no-cargo-a-tiempo con la espera', async () => {
  const espera = 2000;
  const r = await bot.verifySession({
    url: `${server.baseUrl}/eternal-load`,
    headless: true,
    timeoutMs: espera,
    sessionDir
  });
  assertFalloValido(r, espera);
  assert.equal(r.causa, 'interfaz-no-cargo-a-tiempo');
  assert.match(componerMensajeFallo(r, 'diagnostics/x'), /espera aplicada: 2000 ms/);
});

test('FR-004d: red inaccesible ⇒ error-red, fallo rápido sin gastar el plazo', async () => {
  const espera = 8000;
  const r = await bot.verifySession({
    url: `http://127.0.0.1:${puertoLibre}/`,
    headless: true,
    timeoutMs: espera,
    sessionDir
  });
  assertFalloValido(r, espera);
  assert.equal(r.causa, 'error-red');
  assert.ok(r.duracionMs < 4000, `debe fallar rápido, duró ${r.duracionMs} ms`);
});

test('SC-001: las cuatro causas producen mensajes distintos y motivos del enum', async () => {
  const escenarios = [
    { url: `${server.baseUrl}/qr-screen.html`, timeoutMs: 12000, esperada: 'sesion-caducada' },
    { url: `${server.baseUrl}/eternal-load`, timeoutMs: 1500, esperada: 'interfaz-no-cargo-a-tiempo' },
    { url: `${server.baseUrl}/loaded-no-indicators.html`, timeoutMs: 1500, esperada: 'cambio-interfaz' },
    { url: `http://127.0.0.1:${puertoLibre}/`, timeoutMs: 8000, esperada: 'error-red' }
  ];
  const mensajes = new Set();
  for (const esc of escenarios) {
    const r = await bot.verifySession({ url: esc.url, headless: true, timeoutMs: esc.timeoutMs, sessionDir });
    assert.equal(r.causa, esc.esperada, `${esc.url} ⇒ ${r.causa}`);
    const motivo = CAUSA_MOTIVO[r.causa];
    assert.ok(motivo, 'toda causa tiene motivo de log');
    mensajes.add(componerMensajeFallo(r, 'diagnostics/verification-test'));
  }
  assert.equal(mensajes.size, 4, 'los cuatro mensajes deben ser distintos (SC-001)');
});
