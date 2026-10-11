'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadConfig, ConfigError } = require('../../lib/config');

const SCHEMA_PATH = path.join(
  __dirname, '..', '..', 'specs', '001-whatsapp-status-automator',
  'contracts', 'menu-config.schema.json'
);

const AjvModule = require('ajv/dist/2020');
const Ajv = AjvModule.default || AjvModule;
const schema = require(SCHEMA_PATH);
const ajv = new Ajv({ allErrors: true, useDefaults: true });

function validConfig() {
  return {
    publishIntervalSeconds: 30,
    attemptTimeoutSeconds: 90,
    dishes: [
      {
        id: 'ensalada-cesar',
        image: 'ensalada.jpg',
        name: 'Ensalada César',
        price: '$8.50',
        description: 'Lechuga, pollo y parmesano',
        cta: 'Pide la tuya hoy'
      }
    ],
    schedules: [{ cron: '0 12 * * *', dishIds: ['ensalada-cesar'] }]
  };
}

test('valid config passes the contract schema', () => {
  const validate = ajv.compile(schema);
  const ok = validate(validConfig());
  assert.equal(ok, true, JSON.stringify(validate.errors, null, 2));
});

test('absent schedules passes the contract schema (silent-wait semantics)', () => {
  const cfg = validConfig();
  delete cfg.schedules;
  const validate = ajv.compile(schema);
  assert.equal(validate(cfg), true, JSON.stringify(validate.errors, null, 2));
});

test('empty schedules array passes the contract schema (quickstart S12)', () => {
  const cfg = validConfig();
  cfg.schedules = [];
  const validate = ajv.compile(schema);
  assert.equal(validate(cfg), true, JSON.stringify(validate.errors, null, 2));
});

test('attemptTimeoutSeconds > 90 fails the contract schema (FR-008)', () => {
  const cfg = validConfig();
  cfg.attemptTimeoutSeconds = 91;
  const validate = ajv.compile(schema);
  assert.equal(validate(cfg), false);
});

test('publishIntervalSeconds negative fails the contract schema (FR-015)', () => {
  const cfg = validConfig();
  cfg.publishIntervalSeconds = -1;
  const validate = ajv.compile(schema);
  assert.equal(validate(cfg), false);
});

test('empty text field (price: "") fails the contract schema (FR-007)', () => {
  const cfg = validConfig();
  cfg.dishes[0].price = '';
  const validate = ajv.compile(schema);
  assert.equal(validate(cfg), false);
});

test('empty dishes array fails the contract schema (FR-003)', () => {
  const cfg = validConfig();
  cfg.dishes = [];
  const validate = ajv.compile(schema);
  assert.equal(validate(cfg), false);
});

test('loadConfig applies defaults: publishIntervalSeconds 60, attemptTimeoutSeconds 90', () => {
  const cfg = validConfig();
  delete cfg.publishIntervalSeconds;
  delete cfg.attemptTimeoutSeconds;
  const result = loadConfig(cfg);
  assert.equal(result.publishIntervalSeconds, 60);
  assert.equal(result.attemptTimeoutSeconds, 90);
});

test('loadConfig rejects orphan dishIds with config-invalida (FR-005)', () => {
  const cfg = validConfig();
  cfg.schedules[0].dishIds = ['plato-inexistente'];
  assert.throws(() => loadConfig(cfg), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.equal(err.motivo, 'config-invalida');
    return true;
  });
});

test('loadConfig rejects duplicate dish ids with config-invalida (FR-005, vínculo inequívoco)', () => {
  const cfg = validConfig();
  cfg.dishes.push({ ...cfg.dishes[0] });
  assert.throws(() => loadConfig(cfg), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.equal(err.motivo, 'config-invalida');
    return true;
  });
});

test('loadConfig selects silent-wait mode when schedules absent or empty', () => {
  const noSchedules = validConfig();
  delete noSchedules.schedules;
  const loaded = loadConfig(noSchedules);
  assert.deepEqual(loaded.schedules, []);
  assert.equal(loaded.hasSchedules, false);

  const emptySchedules = validConfig();
  emptySchedules.schedules = [];
  const loaded2 = loadConfig(emptySchedules);
  assert.equal(loaded2.hasSchedules, false);
});
