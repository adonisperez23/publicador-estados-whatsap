'use strict';

// Orquestador: carga config, valida, registra cron, serializa intentos (Principio IV:
// cero lógica de navegador aquí — el bot vive en whatsappBot.js).
// FR-001 banda secuencial · FR-008 presupuesto 90 s · FR-011 fallo no bloquea ·
// FR-013 mutex global · FR-015 intervalo configurable · FR-016 chmod session/.

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { loadConfig } = require('./lib/config');
const { validateDish, composeStatusText } = require('./lib/validateDish');
const logger = require('./lib/logger');

const MENU_PATH = path.join(__dirname, 'menu.json');
const SESSION_DIR = path.join(__dirname, 'session');
const ASSETS_DIR = path.join(__dirname, 'assets');

/**
 * Mutex global con cola FIFO e intervalo entre publicaciones consecutivas.
 * GARANTÍA: cero concurrencia (FR-013); un fallo jamás envenena la cola (FR-011).
 */
function createMutex({ intervalMs = 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let chain = Promise.resolve();
  let lastEnd = 0;
  let hasRun = false;

  function run(task) {
    const result = chain.then(async () => {
      if (hasRun && intervalMs > 0) {
        const wait = intervalMs - (Date.now() - lastEnd);
        if (wait > 0) await sleep(wait);
      }
      hasRun = true;
      try {
        return await task();
      } finally {
        lastEnd = Date.now();
      }
    });
    chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  return { run };
}

/**
 * Registra SOLO ocurrencias futuras de cada cron (node-cron no hace backfill por
 * diseño — Clarificación 1). Una expresión inválida aborta el registro completo.
 */
function registerSchedules(schedules, cronImpl, onFire) {
  const jobs = [];
  try {
    for (const schedule of schedules) {
      if (typeof cronImpl.validate !== 'function' || !cronImpl.validate(schedule.cron)) {
        throw Object.assign(new Error(`cron inválido: "${schedule.cron}"`), {
          motivo: 'config-invalida'
        });
      }
      jobs.push(cronImpl.schedule(schedule.cron, () => onFire(schedule)));
    }
  } catch (err) {
    for (const job of jobs) job.stop();
    throw err;
  }
  return {
    stop() {
      for (const job of jobs) job.stop();
    }
  };
}

function ensureSessionPermissions() {
  if (!fs.existsSync(SESSION_DIR)) return false;
  try {
    fs.chmodSync(SESSION_DIR, 0o700);
  } catch {
    // FS sin soporte de chmod (p. ej. Windows): el control lo da el perfil de usuario (R9)
  }
  return true;
}

/**
 * Un intento de publicación de UN plato, con presupuesto global (FR-008).
 * Emite EXACTAMENTE una línea de log: exito, fallo+motivo o omision+motivo (SC-005).
 * Nunca lanza: el siguiente horario reanuda siempre (FR-011).
 */
async function attemptPublish(dish, config) {
  const budgetMs = config.attemptTimeoutSeconds * 1000;
  let timer;
  const budget = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error(`intento superó ${budgetMs} ms`), { motivo: 'timeout' }));
    }, budgetMs);
  });

  try {
    await Promise.race([
      (async () => {
        // Validación previa DENTRO del presupuesto del intento (research.md R6, FR-006):
        // falla ⇒ omisión con motivo + continuidad con los pendientes; jamás contenido vacío (FR-007)
        const motivo = validateDish(dish, ASSETS_DIR);
        if (motivo) {
          throw Object.assign(new Error(`omisión: ${motivo}`), { motivo, omission: true });
        }
        const bot = require('./whatsappBot');
        await bot.publishStatus({
          imagePath: path.join(ASSETS_DIR, dish.image),
          text: composeStatusText(dish),
          timeoutMs: budgetMs
        });
      })(),
      budget
    ]);
    logger.logAttempt({ plato: dish.id, resultado: 'exito' });
    return true;
  } catch (err) {
    if (err && err.omission) {
      logger.logOmission({ plato: dish.id, motivo: err.motivo });
    } else {
      logger.logAttempt({ plato: dish.id, resultado: 'fallo', motivo: err.motivo || 'error-interfaz' });
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function keepAlive() {
  const timer = setInterval(() => {}, 1 << 30);
  const bye = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

// T016 (US2): mapeo causa ⇒ motivo de log (enum SIN ampliar, Assumption del spec)
// y plantillas de mensaje en lenguaje del operador — contracts/verification-contract.md §2.
const CAUSA_MOTIVO = Object.freeze({
  'sesion-caducada': 'sesion-no-disponible',
  'interfaz-no-cargo-a-tiempo': 'timeout',
  'cambio-interfaz': 'error-interfaz',
  'error-red': 'error-red'
});

/**
 * Compone el mensaje de operador para un fallo de verificación (FR-005, SC-001):
 * `<motivo>: <causa> — <acción sugerida>`, con la ruta de evidencia cuando existe.
 * @param {{causa: string, esperaAplicadaMs: number, detalle: string}} session
 * @param {string|null} ruta carpeta diagnostics/verification-<ts>/ creada para el fallo
 */
function componerMensajeFallo(session, ruta) {
  const causa = session && session.causa;
  const motivo = CAUSA_MOTIVO[causa];
  if (!motivo) {
    throw new TypeError(`causa de verificación desconocida: ${causa}`);
  }
  const evidencia = ruta ? ` Evidencia: ${ruta}` : '';
  const detalle = String((session && session.detalle) || '');

  switch (causa) {
    case 'sesion-caducada':
      return (
        `${motivo}: sesión caducada — restablece la sesión con "npm run login" ` +
        `(escanea el QR); el ciclo automatizado nunca pide login.${evidencia}`
      );
    case 'interfaz-no-cargo-a-tiempo':
      if (detalle.startsWith('navegador no disponible')) {
        return (
          `${motivo}: la interfaz no cargó a tiempo (${detalle}) — ` +
          `reinstala chromium (\`npx playwright install chromium\`).${evidencia}`
        );
      }
      return (
        `${motivo}: la interfaz no cargó a tiempo (espera aplicada: ${session.esperaAplicadaMs} ms) — ` +
        `aumenta sessionVerifyTimeoutSeconds o revisa la conexión.${evidencia}`
      );
    case 'cambio-interfaz':
      return ruta
        ? `${motivo}: la interfaz cargó sin los indicadores esperados — posible cambio de WhatsApp Web; revisa la evidencia en ${ruta}`
        : `${motivo}: la interfaz cargó sin los indicadores esperados — posible cambio de WhatsApp Web (artefactos de diagnóstico no disponibles)`;
    case 'error-red':
      return (
        `${motivo}: no se pudo alcanzar WhatsApp Web (${detalle || 'sin detalle'}) — ` +
        `revisa la conectividad.${evidencia}`
      );
    default:
      throw new TypeError(`causa de verificación desconocida: ${causa}`);
  }
}

async function main() {
  let config;
  try {
    config = loadConfig(MENU_PATH);
  } catch (err) {
    logger.logSystem({ resultado: 'fallo', motivo: 'config-invalida' });
    console.error(`config-invalida: ${err.message}`);
    return 1;
  }

  if (!config.hasSchedules) {
    // Edge case «sin horarios»: espera silenciosa, sin errores ni publicaciones (exit 0)
    keepAlive();
    return 0;
  }

  if (!ensureSessionPermissions()) {
    logger.logSystem({ resultado: 'fallo', motivo: 'sesion-no-disponible' });
    console.error(
      'sesion-no-disponible: session/ no existe. Restablece la sesión manualmente; ' +
        'nunca se inicia login dentro del ciclo automatizado (FR-014).'
    );
    return 1;
  }

  const bot = require('./whatsappBot');
  const session = await bot.verifySession({ timeoutMs: 30000 });
  if (!session.autenticado) {
    // T016: causa → motivo → plantilla (FR-005/014, SC-001). La ruta de evidencia
    // la añade US3 (T022); el motivo sale del enum vigente sin ampliación.
    const motivo = CAUSA_MOTIVO[session.causa] || 'sesion-no-disponible';
    logger.logSystem({ resultado: 'fallo', motivo });
    console.error(
      session.causa
        ? componerMensajeFallo(session, null)
        : `sesion-no-disponible: ${session.detalle || 'sesión no autenticada'}`
    );
    return 1;
  }

  logger.logSystem({ resultado: 'exito' });
  console.error(`daemon listo: ${config.schedules.length} horario(s), intervalo ${config.publishIntervalSeconds}s`);

  const mutex = createMutex({ intervalMs: config.publishIntervalSeconds * 1000 });
  registerSchedules(config.schedules, cron, (schedule) => {
    // Banda: los platos se encolan uno tras otro → serial global + intervalo (FR-001, FR-013, FR-015)
    for (const dishId of schedule.dishIds) {
      const dish = config.dishes.find((d) => d.id === dishId);
      if (!dish) {
        logger.logOmission({ plato: dishId, motivo: 'config-invalida' });
        continue;
      }
      mutex.run(() => attemptPublish(dish, config)).catch(() => {});
    }
  });

  return new Promise(() => {}); // los jobs de node-cron mantienen vivo el proceso
}

if (require.main === module) {
  main().then((code) => {
    if (typeof code === 'number' && code !== 0) process.exitCode = code;
  });
}

module.exports = {
  createMutex,
  registerSchedules,
  composeStatusText,
  ensureSessionPermissions,
  attemptPublish,
  main,
  MENU_PATH,
  SESSION_DIR,
  ASSETS_DIR,
  CAUSA_MOTIVO,
  componerMensajeFallo
};
