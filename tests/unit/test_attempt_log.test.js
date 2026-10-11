'use strict';

// T022 / SC-005 / contracts/log-format.md: EXACTAMENTE UNA línea por intento.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const botPath = require.resolve('../../whatsappBot.js');
let botStub = { publishStatus: async () => ({ ok: true }), verifySession: async () => ({ authenticated: true }) };
require.cache[botPath] = {
  id: botPath,
  filename: botPath,
  loaded: true,
  exports: botStub
};

const { attemptPublish, composeStatusText } = require('../../index.js');

const dish = {
  id: 'milanesa',
  image: 'ensalada.png', // placeholder real en assets/ del repo
  name: 'Milanesa',
  price: '$9.00',
  description: 'Napolitana',
  cta: 'Vení a probarla'
};

let captured;

function capture() {
  captured = [];
  console.log = (line) => captured.push({ stream: 'out', line });
  console.error = (line) => captured.push({ stream: 'err', line });
}

function restore() {
  console.log = originalLog;
  console.error = originalError;
}

const originalLog = console.log;
const originalError = console.error;

function config(overrides = {}) {
  return { publishIntervalSeconds: 0, attemptTimeoutSeconds: 90, dishes: [dish], schedules: [], hasSchedules: true, ...overrides };
}

beforeEach(() => {
  botStub.publishStatus = async () => ({ ok: true });
  capture();
});

afterEach(() => {
  restore();
});

test('successful attempt emits exactly one line: intento | exito | -', async () => {
  await attemptPublish(dish, config());
  assert.equal(captured.length, 1, `esperaba 1 línea, hubo ${captured.length}: ${JSON.stringify(captured)}`);
  assert.match(captured[0].line, /\| intento \| milanesa \| exito \| -$/);
});

test('bot failure emits exactly one line with typed motivo', async () => {
  botStub.publishStatus = async () => {
    throw Object.assign(new Error('net::ERR_INTERNET_DISCONNECTED'), { motivo: 'error-red' });
  };
  await attemptPublish(dish, config());
  assert.equal(captured.length, 1);
  assert.match(captured[0].line, /\| intento \| milanesa \| fallo \| error-red$/);
});

test('failed validation emits exactly one omision line, bot never invoked', async () => {
  let invoked = 0;
  botStub.publishStatus = async () => { invoked += 1; };
  await attemptPublish({ ...dish, image: 'no-existe.png' }, config());
  assert.equal(captured.length, 1);
  assert.match(captured[0].line, /\| omision \| milanesa \| fallo \| imagen-faltante$/);
  assert.equal(invoked, 0, 'FR-006: el bot no se invoca con validación fallida');
});

test('whitespace price emits exactly one omision texto-vacío line (US3 AC2)', async () => {
  await attemptPublish({ ...dish, price: '   ' }, config());
  assert.equal(captured.length, 1);
  assert.match(captured[0].line, /\| omision \| milanesa \| fallo \| texto-vacío$/);
});

test('budget overrun emits exactly one line with motivo timeout (FR-008)', async () => {
  botStub.publishStatus = () => new Promise((resolve) => setTimeout(resolve, 400));
  await attemptPublish(dish, config({ attemptTimeoutSeconds: 0.05 }));
  assert.equal(captured.length, 1);
  assert.match(captured[0].line, /\| intento \| milanesa \| fallo \| timeout$/);
});

test('untagged bot error falls back to error-interfaz (single line)', async () => {
  botStub.publishStatus = async () => { throw new Error('locator smashed'); };
  await attemptPublish(dish, config());
  assert.equal(captured.length, 1);
  assert.match(captured[0].line, /\| intento \| milanesa \| fallo \| error-interfaz$/);
});

test('log lines never leak session/ content (FR-016 invariant)', async () => {
  botStub.publishStatus = async () => {
    throw Object.assign(new Error('fallo con session/Default/abc'), { motivo: 'error-interfaz' });
  };
  await attemptPublish(dish, config());
  assert.equal(captured.length, 1);
  // el texto del error no se propaga al registro; solo el motivo tipado
  assert.ok(!captured[0].line.includes('session/'), 'el registro no debe contener rutas de session/');
});

test('composeStatusText is shared with validation (same separators)', () => {
  assert.equal(composeStatusText(dish), ['Milanesa', '$9.00', 'Napolitana', 'Vení a probarla'].join('\n'));
});
