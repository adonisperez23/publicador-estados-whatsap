'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig, ConfigError } = require('../../lib/config');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-config-'));

function writeConfig(name, content) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, content);
  return file;
}

function validConfig() {
  return {
    publishIntervalSeconds: 30,
    attemptTimeoutSeconds: 90,
    dishes: [
      {
        id: 'pizza-margherita',
        image: 'pizza.png',
        name: 'Pizza Margherita',
        price: '$10.00',
        description: 'Mozzarella, tomate y albahaca',
        cta: 'Pide la tuya'
      }
    ],
    schedules: [{ cron: '0 12 * * *', dishIds: ['pizza-margherita'] }]
  };
}

test('missing config file → config-invalida (edge case del spec)', () => {
  assert.throws(
    () => loadConfig(path.join(tmp, 'no-existe.json')),
    (err) => err instanceof ConfigError && err.motivo === 'config-invalida'
  );
});

test('malformed JSON → config-invalida with clear message', () => {
  const file = writeConfig('malformado.json', '{ "dishes": [ ');
  assert.throws(
    () => loadConfig(file),
    (err) => err instanceof ConfigError && err.motivo === 'config-invalida' && /JSON/.test(err.message)
  );
});

test('non-object JSON → config-invalida', () => {
  const file = writeConfig('array.json', '[1, 2, 3]');
  assert.throws(
    () => loadConfig(file),
    (err) => err instanceof ConfigError && err.motivo === 'config-invalida'
  );
});

test('empty dishes array → config-invalida (FR-003)', () => {
  const cfg = validConfig();
  cfg.dishes = [];
  assert.throws(
    () => loadConfig(cfg),
    (err) => err instanceof ConfigError && err.motivo === 'config-invalida'
  );
});

test('duplicate dish id → config-invalida (FR-005, vínculo inequívoco)', () => {
  const cfg = validConfig();
  cfg.dishes.push({ ...cfg.dishes[0] });
  assert.throws(
    () => loadConfig(cfg),
    (err) => err instanceof ConfigError && err.motivo === 'config-invalida' && /duplicado/.test(err.message)
  );
});

test('orphan dishIds → config-invalida (FR-005)', () => {
  const cfg = validConfig();
  cfg.schedules[0].dishIds = ['fantasma'];
  assert.throws(
    () => loadConfig(cfg),
    (err) => err instanceof ConfigError && err.motivo === 'config-invalida' && /fantasma/.test(err.message)
  );
});

test('attemptTimeoutSeconds 91 → config-invalida (FR-008, techo 90 s)', () => {
  const cfg = validConfig();
  cfg.attemptTimeoutSeconds = 91;
  assert.throws(
    () => loadConfig(cfg),
    (err) => err instanceof ConfigError && err.motivo === 'config-invalida'
  );
});

test('absent/empty schedules → VALID silent-wait selection (edge case sin horarios)', () => {
  const absent = validConfig();
  delete absent.schedules;
  const loaded = loadConfig(absent);
  assert.equal(loaded.hasSchedules, false);
  assert.deepEqual(loaded.schedules, []);

  const empty = validConfig();
  empty.schedules = [];
  assert.equal(loadConfig(empty).hasSchedules, false);
});

test('defaults applied when optional fields absent', () => {
  const cfg = validConfig();
  delete cfg.publishIntervalSeconds;
  delete cfg.attemptTimeoutSeconds;
  const loaded = loadConfig(cfg);
  assert.equal(loaded.publishIntervalSeconds, 60);
  assert.equal(loaded.attemptTimeoutSeconds, 90);
});

test('loads a real config file from disk end-to-end', () => {
  const file = writeConfig('ok.json', JSON.stringify(validConfig()));
  const loaded = loadConfig(file);
  assert.equal(loaded.dishes.length, 1);
  assert.equal(loaded.hasSchedules, true);
  assert.equal(loaded.dishes[0].id, 'pizza-margherita');
});
