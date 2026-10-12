'use strict';

// T005 (US1): contrato de los indicadores de autenticación.
// FR-001: conjunto de al menos tres indicadores alternativos.
// FR-002 / Principio V: solo atributos semánticos estables (data-icon, role, aria-*),
// nunca clases CSS dinámicas ni ids.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SELECTORS } = require('../../whatsappBot');

test('FR-001: SELECTORS.authIndicators tiene al menos 3 indicadores alternativos', () => {
  assert.ok(Array.isArray(SELECTORS.authIndicators), 'authIndicators debe ser un array');
  assert.ok(
    SELECTORS.authIndicators.length >= 3,
    `se exigen ≥ 3 indicadores, hay ${SELECTORS.authIndicators.length}`
  );
  const nombres = SELECTORS.authIndicators.map((i) => i.nombre);
  assert.equal(new Set(nombres).size, nombres.length, 'los nombres de indicador deben ser únicos');
  for (const indicador of SELECTORS.authIndicators) {
    assert.equal(typeof indicador.nombre, 'string');
    assert.ok(indicador.nombre.length > 0, 'nombre de indicador no vacío');
    assert.equal(typeof indicador.selector, 'string');
    assert.ok(indicador.selector.length > 0, 'selector de indicador no vacío');
  }
});

test('FR-002 / Principio V: cada selector usa solo atributos semánticos (sin clases ni ids)', () => {
  for (const indicador of SELECTORS.authIndicators) {
    const sel = indicador.selector;
    assert.doesNotMatch(
      sel,
      /[.#][A-Za-z_-]/,
      `selector "${sel}" (${indicador.nombre}) no debe usar clases CSS ni ids`
    );
    assert.match(
      sel,
      /(data-icon|role|aria-)/,
      `selector "${sel}" (${indicador.nombre}) debe apoyarse en data-icon, role o aria-*`
    );
  }
});
