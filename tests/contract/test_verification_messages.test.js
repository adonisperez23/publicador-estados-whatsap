'use strict';

// T011 (US2): contrato causa → motivo → plantilla de mensaje
// (specs/002-session-verify-resilience/contracts/verification-contract.md §2).
// El enum de motivos NO se amplía (Assumption del spec) y cada mensaje nombra la
// causa y la acción pertinente (FR-005, SC-001).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CAUSA_MOTIVO, componerMensajeFallo } = require('../../index');
const logger = require('../../lib/logger');

const RUTA = 'diagnostics/verification-2026-10-11T12-00-00-000Z';

test('mapeo causa → motivo ⊆ enum de motivos vigente (sin ampliación)', () => {
  assert.deepEqual(CAUSA_MOTIVO, {
    'sesion-caducada': 'sesion-no-disponible',
    'interfaz-no-cargo-a-tiempo': 'timeout',
    'cambio-interfaz': 'error-interfaz',
    'error-red': 'error-red'
  });
  for (const motivo of Object.values(CAUSA_MOTIVO)) {
    assert.ok(logger.MOTIVOS.includes(motivo), `${motivo} debe existir en lib/logger.js`);
  }
});

test('sesión caducada: nombra la causa y remite a npm run login (FR-005)', () => {
  const msg = componerMensajeFallo(
    { causa: 'sesion-caducada', esperaAplicadaMs: 30000, detalle: '' },
    RUTA
  );
  assert.ok(msg.startsWith('sesion-no-disponible: '), msg);
  assert.match(msg, /sesión caducada/);
  assert.match(msg, /npm run login/);
  assert.match(msg, /nunca pide login/);
  assert.ok(msg.includes(RUTA));
});

test('interfaz no cargó a tiempo: incluye la espera aplicada y la acción (FR-005/006)', () => {
  const msg = componerMensajeFallo(
    { causa: 'interfaz-no-cargo-a-tiempo', esperaAplicadaMs: 45000, detalle: 'espera aplicada: 45000 ms' },
    RUTA
  );
  assert.ok(msg.startsWith('timeout: '), msg);
  assert.match(msg, /espera aplicada: 45000 ms/);
  assert.match(msg, /sessionVerifyTimeoutSeconds/);
  assert.ok(msg.includes(RUTA));
});

test('arranque del navegador: plantilla específica con reinstalación de chromium', () => {
  const msg = componerMensajeFallo(
    {
      causa: 'interfaz-no-cargo-a-tiempo',
      esperaAplicadaMs: 30000,
      detalle: 'navegador no disponible: boom'
    },
    RUTA
  );
  assert.ok(msg.startsWith('timeout: '), msg);
  assert.match(msg, /navegador no disponible: boom/);
  assert.match(msg, /npx playwright install chromium/);
  assert.ok(msg.includes(RUTA));
});

test('cambio de interfaz: nombra la causa y remite a la evidencia (FR-005)', () => {
  const msg = componerMensajeFallo(
    { causa: 'cambio-interfaz', esperaAplicadaMs: 30000, detalle: '' },
    RUTA
  );
  assert.ok(msg.startsWith('error-interfaz: '), msg);
  assert.match(msg, /sin los indicadores esperados/);
  assert.match(msg, /revisa la evidencia en diagnostics\//);
});

test('error de red: nombra el detalle concreto y la acción (FR-005)', () => {
  const msg = componerMensajeFallo(
    { causa: 'error-red', esperaAplicadaMs: 30000, detalle: 'net::ERR_CONNECTION_REFUSED' },
    RUTA
  );
  assert.ok(msg.startsWith('error-red: '), msg);
  assert.match(msg, /net::ERR_CONNECTION_REFUSED/);
  assert.match(msg, /revisa la conectividad/);
  assert.ok(msg.includes(RUTA));
});

test('sin ruta de evidencia (escritura fallida): el mensaje sigue nombrando la causa (FR-010)', () => {
  const msg = componerMensajeFallo(
    { causa: 'error-red', esperaAplicadaMs: 30000, detalle: 'net::ERR_TIMED_OUT' },
    null
  );
  assert.ok(msg.startsWith('error-red: '), msg);
  assert.match(msg, /revisa la conectividad/);
  assert.doesNotMatch(msg, /null/);
});

test('causa desconocida ⇒ TypeError defensivo (contrato §2, enum cerrado)', () => {
  assert.throws(
    () => componerMensajeFallo({ causa: 'otra-cosa', esperaAplicadaMs: 1, detalle: '' }, RUTA),
    TypeError
  );
});
