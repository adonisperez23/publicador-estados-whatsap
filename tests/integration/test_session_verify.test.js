'use strict';

// T006 (US1): detección multi-indicador contra fixtures locales (servidor efímero).
// SC-002: la sesión sigue clasificándose como autenticada ocultando cada indicador
// por turnos. FR-003: retorno inmediato sin agotar la espera.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const bot = require('../../whatsappBot');
const { startFixtureServer } = require('../helpers/fixtureServer');

let server;
// Perfil Chromium temporal: nunca se toca session/ real
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-us1-'));

before(async () => {
  server = await startFixtureServer();
});

after(async () => {
  if (server) await server.close();
});

test('FR-003: indicador visible ⇒ autenticado con retorno inmediato (sin agotar la espera)', async () => {
  const resultado = await bot.verifySession({
    url: `${server.baseUrl}/authenticated.html`,
    headless: true,
    timeoutMs: 15000,
    sessionDir
  });
  assert.equal(resultado.autenticado, true, resultado.detalle || resultado.causa || '');
  assert.ok(
    resultado.duracionMs < 5000,
    `debe retornar de inmediato; duró ${resultado.duracionMs} ms`
  );
  assert.equal(resultado.esperaAplicadaMs, 15000);
});

test('T026 / FR-006: sin tope interno de 30 s — timeoutMs se aplica tal cual', async () => {
  // La primera carga real de WhatsApp Web puede superar 30 s («Cargando tus
  // chats… descargando mensajes»); el clamp heredado recortaba 32000 a 30000.
  const resultado = await bot.verifySession({
    url: `${server.baseUrl}/authenticated.html`,
    headless: true,
    timeoutMs: 32000,
    sessionDir
  });
  assert.equal(resultado.autenticado, true);
  assert.equal(resultado.esperaAplicadaMs, 32000, 'el tope de 30 s debe estar eliminado');
  assert.ok(resultado.duracionMs < 5000, 'retorno inmediato: el plazo no se consume');
});

test('SC-002: sigue autenticada ocultando CADA indicador por turnos', async () => {
  for (const hide of ['chats', 'grid', 'tablist', 'listitem']) {
    const resultado = await bot.verifySession({
      url: `${server.baseUrl}/authenticated.html?hide=${hide}`,
      headless: true,
      timeoutMs: 15000,
      sessionDir
    });
    assert.equal(resultado.autenticado, true, `hide=${hide} debe seguir autenticada`);
  }
});

test('sin NINGÚN indicador ⇒ autenticado: false (cero falsos positivos)', async () => {
  const resultado = await bot.verifySession({
    url: `${server.baseUrl}/authenticated.html?hide=all`,
    headless: true,
    timeoutMs: 1500,
    sessionDir
  });
  assert.equal(resultado.autenticado, false);
  assert.ok(resultado.duracionMs <= resultado.esperaAplicadaMs, 'FR-013: termina dentro de su espera');
});

test('FR-007: el resultado expone el estado presente/ausente de cada indicador', async () => {
  const resultado = await bot.verifySession({
    url: `${server.baseUrl}/authenticated.html?hide=listitem`,
    headless: true,
    timeoutMs: 15000,
    sessionDir
  });
  assert.equal(resultado.autenticado, true);
  const estados = Object.fromEntries(
    resultado.observacion.indicadores.map((i) => [i.nombre, i.presente])
  );
  assert.equal(estados['chat-row'], false, 'chat-row estaba oculto');
  assert.ok(
    resultado.observacion.indicadores.some((i) => i.presente),
    'al menos otro indicador respondió'
  );
});
