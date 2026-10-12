'use strict';

// T010 (US2): función pura de clasificación (research R3) — testeable sin navegador.
// Cubre las 4 causas exclusivas, la regla de desempate de la Clarificación 2 y el
// orden favorable: indicador > QR > plazo (FR-004, SC-001).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyVerification } = require('../../whatsappBot');

function obs(extra) {
  return {
    arranqueFallido: null,
    errorRed: null,
    autenticado: false,
    senalQr: false,
    paginaObservable: false,
    plazoVencido: false,
    esperaAplicadaMs: 30000,
    ...extra
  };
}

test('FR-001/003: indicador visible ⇒ autenticado, incluso al vencer el plazo', () => {
  const r = classifyVerification(obs({ autenticado: true, plazoVencido: true }));
  assert.equal(r.decidir, true);
  assert.equal(r.autenticado, true);
  assert.equal(r.causa, null);
});

test('FR-004a: pantalla de QR visible ⇒ sesion-caducada (sin esperar el plazo)', () => {
  const r = classifyVerification(obs({ senalQr: true }));
  assert.equal(r.decidir, true);
  assert.equal(r.autenticado, false);
  assert.equal(r.causa, 'sesion-caducada');
});

test('FR-004d: error de red en la navegación ⇒ error-red, fallo rápido (sin plazo)', () => {
  const r = classifyVerification(obs({ errorRed: 'net::ERR_CONNECTION_REFUSED' }));
  assert.equal(r.decidir, true);
  assert.equal(r.causa, 'error-red');
  assert.equal(r.detalle, 'net::ERR_CONNECTION_REFUSED');
});

test('edge case arranque: chromium no inicia ⇒ interfaz-no-cargo-a-tiempo con detalle', () => {
  const r = classifyVerification(obs({ arranqueFallido: 'Executable doesn\u0027t exist' }));
  assert.equal(r.decidir, true);
  assert.equal(r.causa, 'interfaz-no-cargo-a-tiempo');
  assert.match(r.detalle, /navegador no disponible: .*Executable/);
});

test('FR-004b: plazo vencido SIN interfaz observable ⇒ interfaz-no-cargo-a-tiempo', () => {
  const r = classifyVerification(
    obs({ plazoVencido: true, paginaObservable: false, esperaAplicadaMs: 45000 })
  );
  assert.equal(r.decidir, true);
  assert.equal(r.causa, 'interfaz-no-cargo-a-tiempo');
  assert.match(r.detalle, /espera aplicada: 45000 ms/);
});

test('FR-004c / Clarificación 2: plazo vencido CON interfaz observable ⇒ cambio-interfaz', () => {
  const r = classifyVerification(obs({ plazoVencido: true, paginaObservable: true }));
  assert.equal(r.decidir, true);
  assert.equal(r.causa, 'cambio-interfaz');
});

test('orden: indicador autenticado prima sobre QR y sobre el plazo vencido', () => {
  const r = classifyVerification(obs({ autenticado: true, senalQr: true, plazoVencido: true }));
  assert.equal(r.autenticado, true);
  assert.equal(r.causa, null);
});

test('orden: error de red prima sobre QR (lo que impidió observar la interfaz)', () => {
  const r = classifyVerification(obs({ errorRed: 'net::ERR_NAME_NOT_RESOLVED', senalQr: true }));
  assert.equal(r.causa, 'error-red');
});

test('sin condición decisoria ⇒ pendiente (no decide)', () => {
  const r = classifyVerification(obs({}));
  assert.equal(r.decidir, false);
  assert.equal(r.causa, null);
});

test('enum de causas: exactamente las 4 definidas (SC-001)', () => {
  const causas = new Set();
  const escenarios = [
    obs({ senalQr: true }),
    obs({ errorRed: 'x' }),
    obs({ arranqueFallido: 'x' }),
    obs({ plazoVencido: true, paginaObservable: true }),
    obs({ plazoVencido: true, paginaObservable: false })
  ];
  for (const e of escenarios) causas.add(classifyVerification(e).causa);
  assert.deepEqual(
    [...causas].sort(),
    ['cambio-interfaz', 'error-red', 'interfaz-no-cargo-a-tiempo', 'sesion-caducada']
  );
});
