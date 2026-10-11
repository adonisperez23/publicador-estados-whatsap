'use strict';

// Carga y validación de menu.json (FR-003, FR-004, FR-005) — research.md R5/R10
// Falla claro e inmediato si la configuración está mal formada: ConfigError con
// motivo 'config-invalida' y cero publicaciones (edge case del spec).

const fs = require('fs');
const path = require('path');
const AjvModule = require('ajv/dist/2020');
const Ajv = AjvModule.default || AjvModule;

const SCHEMA_PATH = path.join(
  __dirname,
  '..',
  'specs',
  '001-whatsapp-status-automator',
  'contracts',
  'menu-config.schema.json'
);

const DEFAULTS = Object.freeze({
  publishIntervalSeconds: 60,
  attemptTimeoutSeconds: 90
});

class ConfigError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ConfigError';
    this.motivo = 'config-invalida';
    this.details = details || [];
  }
}

function compileSchema() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, useDefaults: true });
  return ajv.compile(schema);
}

let cachedValidate = null;

function validateWithSchema(config) {
  if (!cachedValidate) {
    cachedValidate = compileSchema();
  }
  const ok = cachedValidate(config);
  if (!ok) {
    const msgs = (cachedValidate.errors || []).map(
      (e) => `${e.instancePath || '/'} ${e.message}`
    );
    throw new ConfigError(`menu.json no cumple el esquema: ${msgs.join('; ')}`, msgs);
  }
}

function semanticChecks(config) {
  const problems = [];
  const ids = new Set();
  for (const dish of config.dishes) {
    if (ids.has(dish.id)) {
      problems.push(`id duplicado en dishes: "${dish.id}" (vínculo imagen↔texto debe ser inequívoco)`);
    }
    ids.add(dish.id);
  }
  const schedules = config.schedules || [];
  for (const [i, schedule] of schedules.entries()) {
    for (const dishId of schedule.dishIds) {
      if (!ids.has(dishId)) {
        problems.push(`schedules[${i}].dishIds referencia id inexistente: "${dishId}"`);
      }
    }
  }
  if (problems.length > 0) {
    throw new ConfigError(`reglas semánticas violadas: ${problems.join('; ')}`, problems);
  }
}

/**
 * Carga y valida la configuración.
 * @param {string|object} source ruta de menu.json u objeto ya parseado
 * @returns {{publishIntervalSeconds:number, attemptTimeoutSeconds:number, dishes:Array, schedules:Array, hasSchedules:boolean}}
 * @throws {ConfigError} motivo 'config-invalida'
 */
function loadConfig(source) {
  let config = source;
  if (typeof source === 'string') {
    let raw;
    try {
      raw = fs.readFileSync(source, 'utf8');
    } catch (err) {
      throw new ConfigError(`no se pudo leer ${source}: ${err.message}`);
    }
    try {
      config = JSON.parse(raw);
    } catch (err) {
      throw new ConfigError(`${source} no es JSON válido: ${err.message}`);
    }
  }

  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new ConfigError('la configuración debe ser un objeto JSON');
  }

  validateWithSchema(config);
  semanticChecks(config);

  const schedules = Array.isArray(config.schedules) ? config.schedules : [];

  return {
    publishIntervalSeconds: config.publishIntervalSeconds,
    attemptTimeoutSeconds: config.attemptTimeoutSeconds,
    dishes: config.dishes,
    schedules,
    hasSchedules: schedules.length > 0
  };
}

module.exports = { loadConfig, ConfigError, DEFAULTS, SCHEMA_PATH };
