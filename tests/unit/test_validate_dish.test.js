'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateDish, composeStatusText, MAX_STATUS_TEXT_LENGTH } = require('../../lib/validateDish');

const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
fs.writeFileSync(path.join(assets, 'ok.png'), Buffer.from('89504e470d0a1a0a', 'hex'));

function dish(overrides = {}) {
  return {
    id: 'pollo-frito',
    image: 'ok.png',
    name: 'Pollo Frito',
    price: '$9.00',
    description: 'Crujiente con papas',
    cta: 'Pedí el tuyo',
    ...overrides
  };
}

test('valid dish returns null (nothing blocks publication)', () => {
  assert.equal(validateDish(dish(), assets), null);
});

test('missing image → imagen-faltante (FR-006, edge case imagen)', () => {
  assert.equal(validateDish(dish({ image: 'no-existe.png' }), assets), 'imagen-faltante');
});

test('zero-size image → imagen-faltante (nunca publicar contenido vacío)', () => {
  const empty = path.join(assets, 'vacia.png');
  fs.writeFileSync(empty, '');
  assert.equal(validateDish(dish({ image: 'vacia.png' }), assets), 'imagen-faltante');
});

test('image outside assets (traversal to missing file) → imagen-faltante', () => {
  assert.equal(validateDish(dish({ image: 'sub/dir/no.png' }), assets), 'imagen-faltante');
});

test('whitespace-only price → texto-vacío (US3 AC2, quickstart S3)', () => {
  assert.equal(validateDish(dish({ price: '   ' }), assets), 'texto-vacío');
});

test('empty name → texto-vacío (FR-006)', () => {
  assert.equal(validateDish(dish({ name: '' }), assets), 'texto-vacío');
});

test('whitespace-only description → texto-vacío', () => {
  assert.equal(validateDish(dish({ description: '\t \n' }), assets), 'texto-vacío');
});

test('empty cta → texto-vacío (FR-001)', () => {
  assert.equal(validateDish(dish({ cta: '' }), assets), 'texto-vacío');
});

test('composite message exactly at the limit passes', () => {
  const d = dish();
  const overhead = composeStatusText(d).length - d.name.length;
  d.name = 'x'.repeat(MAX_STATUS_TEXT_LENGTH - overhead);
  assert.equal(composeStatusText(d).length, MAX_STATUS_TEXT_LENGTH);
  assert.equal(validateDish(d, assets), null);
});

test('composite message over the limit → texto-largo (edge case límite, R10)', () => {
  const d = dish({ description: 'x'.repeat(MAX_STATUS_TEXT_LENGTH) });
  assert.equal(validateDish(d, assets), 'texto-largo');
});

test('composeStatusText uses fixed separators for name/price/description/cta', () => {
  const d = dish();
  assert.equal(
    composeStatusText(d),
    ['Pollo Frito', '$9.00', 'Crujiente con papas', 'Pedí el tuyo'].join('\n')
  );
});

test('MAX_STATUS_TEXT_LENGTH is 1024 (research.md R10)', () => {
  assert.equal(MAX_STATUS_TEXT_LENGTH, 1024);
});
