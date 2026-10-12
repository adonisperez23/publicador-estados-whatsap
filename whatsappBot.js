'use strict';

// Automatización Playwright de WhatsApp Web — publica UN Estado (FR-001, FR-002).
// Principio IV: módulo de navegador 100% desacoplado del orquestador (index.js).
// Principio V: selectores SOLO por atributos estables (data-icon, role, aria-label);
// ningún otro módulo conoce el DOM. Principio VII: try/catch/finally en todo bloque.

const path = require('path');
const { chromium } = require('playwright');

const SESSION_DIR = path.join(__dirname, 'session');
const WHATSAPP_URL = 'https://web.whatsapp.com';

// User-Agent normalizado sin la marca HeadlessChrome (research R6): WhatsApp Web
// no debe tratar la verificación como navegador «no soportado».
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

// Selectores encapsulados (research.md R4). Solo cambian ante un cambio observado del DOM.
// Observados en WhatsApp Web (oct-2026): la interfaz ya NO usa data-icon de navegación
// ni role="navigation"/"main"; la app se identifica por roles ARIA de la lista de chats
// y la publicación por aria-label + data-icon del compositor de Estados.
const SELECTORS = Object.freeze({
  authenticated: 'div[role="grid"]',
  // T007 (US1): indicadores estables alternativos de la interfaz autenticada
  // (FR-001: ≥ 3, basta con uno; FR-002 / Principio V: solo data-icon, role, aria-*).
  // Los tres primeros son independientes del idioma de la cuenta; el cuarto cubre el
  // caso «cuenta sin chats» (la barra de navegación siempre está presente).
  authIndicators: Object.freeze([
    Object.freeze({ nombre: 'chat-grid', selector: 'div[role="grid"]' }),
    Object.freeze({ nombre: 'chat-filters', selector: 'div[role="tablist"]' }),
    Object.freeze({ nombre: 'chat-row', selector: 'div[role="listitem"]' }),
    Object.freeze({ nombre: 'nav-chats', selector: 'button[aria-label="Chats"]' })
  ]),
  // T013 (US2): señal estable de la pantalla de QR/emparejamiento (research R1/R3;
  // Principio V: data-icon / role, sin clases ofuscadas). El canvas de emparejamiento
  // lleva aria-label fijo en inglés («Scan this QR code to link a device!»).
  qrSignal: 'canvas[aria-label*="QR" i]',
  // La pestaña de Estados tiene aria-label localizado (ES/EN) y la ruta #/statuses no.
  statusTab: 'button[aria-label="Estados"], button[aria-label="Status"]',
  statusesUrl: 'https://web.whatsapp.com/#/statuses',
  // aria-label en inglés SIN localizar: idéntico en cualquier idioma de la cuenta.
  addStatus: 'button[aria-label="Add Status"]',
  // «Fotos y videos» es el primer ítem del menú; el orden del menú es estable.
  statusMenu: 'div[role="menu"] [role="menuitem"]',
  fileInput: 'input[type="file"]',
  caption: 'div[role="textbox"][contenteditable="true"]',
  send: 'span[data-icon="wds-ic-send-filled"]',
  // Fila «Mi estado» del panel de Estados. Tras enviar, el cliente muestra ahí
  // «Enviando…» mientras sube la imagen al CDN de WhatsApp.
  myStatusRow: 'button[data-testid="status-header"]'
});

// Espera para confirmar la pestaña de Estados antes de recurrir a la ruta #/statuses
const STATUS_TAB_TIMEOUT_MS = 10000;

// La publicación es ASÍNCRONA: el compositor se cierra al instante, pero la imagen
// sigue subiendo al CDN (la fila «Mi estado» muestra «Enviando…»). Cerrar el
// navegador en ese lapso aborta la subida y el estado NUNCA llega a publicarse,
// pese a que el flujo no lanza ningún error (pantallazo observado oct-2026).
const UPLOAD_PENDING_PATTERN = /\b(env[ií]ando|sending|subiendo|uploading)\b/i;
const UPLOAD_PENDING_APPEAR_MS = 10000;
const UPLOAD_CONFIRM_TIMEOUT_MS = 45000;
const UPLOAD_FLUSH_MS = 10000;

// ANTES de publicar, el compositor decodifica y previsualiza el archivo elegido. Si
// se escribe el comentario y se pulsa «enviar» mientras esa carga sigue en curso,
// WhatsApp Web descarta el estado sin ningún error visible (oct-2026). Se espera a
// que termine: vista previa decodificada + ningún indicador de progreso + envío no
// bloqueado, estable durante dos sondeos seguidos (Principio V: solo data-icon,
// role y aria-*).
const MEDIA_LOADING_SELECTORS = Object.freeze([
  'div[role="progressbar"]',
  '[aria-busy="true"]',
  'span[data-icon*="spinner" i]',
  'span[data-icon*="loading" i]'
]);
const IMAGE_LOAD_TIMEOUT_MS = 30000;
const IMAGE_LOAD_POLL_MS = 300;
const IMAGE_LOAD_STABLE_TICKS = 2;
const IMAGE_LOAD_FLUSH_MS = 5000;
// niveles que se sube desde el textbox hasta el contenedor común del compositor
const COMPOSER_ANCESTOR_LEVELS = 6;

// Sondeo de verificación (research R1) y tope de cada pasada de observación (FR-013)
const POLL_MS = 250;
const OBSERVAR_MS = 1000;

function tagMotivo(err, motivo) {
  try {
    err.motivo = motivo;
  } catch {
    const wrapped = new Error(String(err && err.message));
    wrapped.motivo = motivo;
    return wrapped;
  }
  return err;
}

function esErrorRed(err) {
  const msg = String((err && err.message) || err || '');
  return /net::|ERR_|ECONN|ENOTFOUND|EAI_AGAIN|getaddrinfo|socket hang up|ECONNREFUSED/i.test(msg);
}

function classify(err) {
  if (err && err.motivo) return err;
  if (esErrorRed(err)) {
    return tagMotivo(err, 'error-red');
  }
  return tagMotivo(err, 'error-interfaz');
}

/**
 * T014 (US2): clasificación PURA de una verificación (research R3, FR-004/005) —
 * testeable sin navegador. Orden de decisión:
 *  (1) fallo de arranque de chromium ⇒ interfaz-no-cargo-a-tiempo («navegador no disponible»)
 *  (2) error de red en la navegación ⇒ error-red (fallo rápido, no gasta el plazo)
 *  (3) indicador autenticado visible ⇒ autenticado (el favorable siempre prima)
 *  (4) pantalla de QR visible ⇒ sesion-caducada (detectada cuanto aparece)
 *  (5) plazo vencido: interfaz observable ⇒ cambio-interfaz; no observable ⇒
 *      interfaz-no-cargo-a-tiempo (regla de desempate de la Clarificación 2)
 * Sin condición decisoria ⇒ { decidir: false } (el sondeo continúa).
 */
function classifyVerification(observacion) {
  const {
    arranqueFallido = null,
    errorRed = null,
    autenticado = false,
    senalQr = false,
    paginaObservable = false,
    plazoVencido = false,
    esperaAplicadaMs = 0
  } = observacion || {};

  if (arranqueFallido) {
    return {
      decidir: true,
      autenticado: false,
      causa: 'interfaz-no-cargo-a-tiempo',
      detalle: `navegador no disponible: ${arranqueFallido}`
    };
  }
  if (errorRed) {
    return { decidir: true, autenticado: false, causa: 'error-red', detalle: errorRed };
  }
  if (autenticado) {
    return { decidir: true, autenticado: true, causa: null, detalle: '' };
  }
  if (senalQr) {
    return { decidir: true, autenticado: false, causa: 'sesion-caducada', detalle: '' };
  }
  if (plazoVencido) {
    if (paginaObservable) {
      return { decidir: true, autenticado: false, causa: 'cambio-interfaz', detalle: '' };
    }
    return {
      decidir: true,
      autenticado: false,
      causa: 'interfaz-no-cargo-a-tiempo',
      detalle: `espera aplicada: ${esperaAplicadaMs} ms`
    };
  }
  return { decidir: false, autenticado: false, causa: null, detalle: '' };
}

function stepTimeout(timeoutMs) {
  return Math.min(30000, Math.max(1000, timeoutMs));
}

async function closeQuietly(context) {
  if (context) {
    try {
      await context.close();
    } catch {
      // el contexto ya estaba cerrado; nada que liberar (FR-009)
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function textoFila(fila, timeoutMs = 1000) {
  try {
    return (await fila.innerText({ timeout: timeoutMs })).trim();
  } catch {
    return '';
  }
}

async function drenarRed(page, ms) {
  if (!(ms > 0) || !page) return;
  await page.waitForLoadState('networkidle', { timeout: ms }).catch(() => {});
}

/**
 * Instantánea de la carga del medio dentro del compositor (nunca lanza):
 *  - `previaPendiente`: alguna imagen visible del compositor aún no terminó de
 *    decodificar (la vista previa local del archivo);
 *  - `progreso`: hay un indicador de carga visible (progressbar / aria-busy / spinner);
 *  - `envioBloqueado`: el cliente mantiene «enviar» en aria-disabled.
 * Si el compositor aún no existe devuelve `{observable: false}` para no confundir
 * «no abrió» con «terminó de cargar».
 * @param {import('playwright').Page} page
 */
async function estadoCargaImagen(page) {
  try {
    return await page.evaluate(
      ({ indicadores, niveles }) => {
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const textboxes = document.querySelectorAll('div[role="textbox"][contenteditable="true"]');
        const textbox = textboxes[textboxes.length - 1];
        if (!textbox) return { observable: false, previaPendiente: false, progreso: false, envioBloqueado: false };

        // Del textbox se sube hasta el contenedor común (vista previa + comentario)
        let contenedor = textbox;
        for (let i = 0; i < niveles && contenedor.parentElement && contenedor.parentElement !== document.body; i++) {
          contenedor = contenedor.parentElement;
        }

        const previas = Array.from(contenedor.querySelectorAll('img')).filter(visible);
        const previaPendiente = previas.some((img) => !img.complete);
        const progreso = Array.from(contenedor.querySelectorAll(indicadores.join(','))).some(visible);
        const enviar = document.querySelector('span[data-icon="wds-ic-send-filled"]');
        const envioBloqueado = !!enviar && enviar.closest('[aria-disabled="true"]') !== null;

        return { observable: true, previaPendiente, progreso, envioBloqueado };
      },
      { indicadores: MEDIA_LOADING_SELECTORS, niveles: COMPOSER_ANCESTOR_LEVELS }
    );
  } catch {
    return { observable: false, previaPendiente: false, progreso: false, envioBloqueado: false };
  }
}

/**
 * Espera a que el compositor TERMINE de cargar la imagen seleccionada antes de
 * escribir el comentario y publicar. Se exige que la señal de «listo» permanezca
 * estable IMAGE_LOAD_STABLE_TICKS sondeos seguidos y se drena la red al final.
 * Mejor esfuerzo: devuelve false si se agota el plazo (se continúa igualmente) y
 * jamás lanza, para no convertir una espera larga en un fallo de publicación.
 * @param {import('playwright').Page} page
 * @param {number} timeoutMs techo total de la espera
 */
async function esperarCargaImagen(page, timeoutMs) {
  const limite = Date.now() + Math.max(0, timeoutMs);
  let listosSeguidos = 0;

  while (Date.now() < limite) {
    const estado = await estadoCargaImagen(page);
    if (estado.observable && !estado.previaPendiente && !estado.progreso && !estado.envioBloqueado) {
      listosSeguidos += 1;
      if (listosSeguidos >= IMAGE_LOAD_STABLE_TICKS) {
        await drenarRed(page, Math.min(IMAGE_LOAD_FLUSH_MS, limite - Date.now()));
        return true;
      }
    } else {
      listosSeguidos = 0;
    }
    await sleep(IMAGE_LOAD_POLL_MS);
  }

  await drenarRed(page, Math.min(IMAGE_LOAD_FLUSH_MS, limite - Date.now()));
  return false;
}

/**
 * Espera a que el cliente termine de SUBIR el estado al CDN antes de cerrar el
 * navegador. El compositor se cierra al instante al enviar, pero la imagen sigue
 * subiendo: cerrar el navegador en ese lapso aborta la subida y el estado nunca
 * llega a publicarse (aunque el flujo no lanza ningún error).
 * Dos señales, ambas acotadas y jamás lanzan (mejor esfuerzo):
 *  (1) el indicador «Enviando…» de la fila «Mi estado» deja de estar visible;
 *  (2) la red queda SIN peticiones en vuelo 500 ms — la subida es una petición,
 *      así que al quedar quieta terminó de subirse.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} fila «Mi estado» del panel de Estados
 * @param {number} timeoutMs techo total de la espera
 * @returns {Promise<boolean>} true si ambas señales confirmaron la subida
 */
async function esperarSubidaEstado(page, fila, timeoutMs) {
  const limite = Date.now() + Math.max(0, timeoutMs);

  // 1) si «Enviando…» ya está, la subida sigue en curso: se espera a que desaparezca
  const indicadorLimpioAntes = await esperarFinIndicadorSubida(fila, limite);

  // 2) la subida como red: 500 ms sin peticiones en vuelo ⇒ el cliente terminó
  await drenarRed(page, Math.min(UPLOAD_FLUSH_MS, limite - Date.now()));

  // 3) y el indicador de nuevo, por si la red quedó quieta antes que el cliente
  const indicadorLimpioDespues = await esperarFinIndicadorSubida(fila, limite);

  return indicadorLimpioAntes && indicadorLimpioDespues;
}

/**
 * Sondea la fila «Mi estado» hasta que el indicador «Enviando…» desaparezca (o el
 * plazo). Si el indicador no está —subida ya terminada o fila no observable— el
 * retorno es inmediato.
 * @param {import('playwright').Locator} fila
 * @param {number} limite marca de tiempo absoluta de corte
 */
async function esperarFinIndicadorSubida(fila, limite) {
  for (;;) {
    if (!UPLOAD_PENDING_PATTERN.test(await textoFila(fila))) return true;
    if (Date.now() >= limite) return false;
    await sleep(POLL_MS);
  }
}

function conLimite(promesa, ms) {
  let timer;
  const expira = new Promise((_, rechazar) => {
    timer = setTimeout(() => rechazar(new Error(`observación superó ${ms} ms`)), ms);
  });
  return Promise.race([promesa, expira]).finally(() => clearTimeout(timer));
}

function observacionVacia(huboPagina) {
  return {
    url: '',
    readyState: '',
    senalQr: huboPagina ? false : null,
    indicadores: SELECTORS.authIndicators.map((i) => ({ nombre: i.nombre, presente: false }))
  };
}

async function esVisible(page, selector) {
  try {
    return await page.locator(selector).first().isVisible();
  } catch {
    return false;
  }
}

/**
 * Instantánea de la página para el sondeo (FR-007): URL, readyState y el estado
 * de TODOS los indicadores. Nunca lanza: si la observación no es posible devuelve
 * una instantánea vacía (interfaz no observable) acotada en el tiempo (FR-013).
 */
async function tomarObservacion(page) {
  if (!page) return observacionVacia(false);
  try {
    const instantanea = await conLimite(
      (async () => {
        const readyState = await page.evaluate(() => document.readyState);
        const indicadores = [];
        for (const indicador of SELECTORS.authIndicators) {
          indicadores.push({
            nombre: indicador.nombre,
            presente: await esVisible(page, indicador.selector)
          });
        }
        const senalQr = await esVisible(page, SELECTORS.qrSignal);
        return { url: page.url(), readyState, indicadores, senalQr };
      })(),
      OBSERVAR_MS
    );
    return instantanea;
  } catch {
    return observacionVacia(true);
  }
}

/**
 * Verifica la autenticación de la sesión persistente SIN login interactivo (FR-011).
 * Nunca muestra ni escanea un QR: corre en modo headless por defecto (research R6) y
 * el caller aborta si no está autenticada.
 * T008 (US1): bucle de sondeo multi-indicador — cada pasada evalúa TODOS los
 * indicadores; «basta uno» y el retorno es inmediato (FR-001/FR-003). El resultado
 * favorable prevalece hasta el instante límite inclusive (edge case «justo al agotar»).
 * T015 (US2): cada pasada se clasifica con la función pura classifyVerification —
 * exactamente una de las cuatro causas ante un fallo (FR-004), fallo rápido ante
 * error de red o pantalla de QR, y desempate al vencer el plazo (Clarificación 2).
 * @returns {Promise<{autenticado: boolean, causa: string|null, detalle: string,
 *   esperaAplicadaMs: number, duracionMs: number,
 *   observacion: {url: string, readyState: string, senalQr: boolean|null, indicadores: Array<{nombre: string, presente: boolean}>},
 *   evidencia: {captura: Buffer|null, resumen: object|null}}>}
 */
async function verifySession({ timeoutMs = 30000, url = WHATSAPP_URL, headless = true, sessionDir = SESSION_DIR } = {}) {
  // clamp temporal heredado (stepTimeout): FR-006 exige eliminar el tope en T026
  const esperaAplicadaMs = stepTimeout(timeoutMs);
  const inicio = Date.now();
  const limite = inicio + esperaAplicadaMs;
  let context = null;
  let arranqueFallido = null;
  let errorRed = null;
  let observacion = observacionVacia(false);
  let dictamen = { decidir: false, autenticado: false, causa: null, detalle: '' };

  const decidir = (plazoVencido) =>
    classifyVerification({
      arranqueFallido,
      errorRed,
      autenticado: observacion.indicadores.some((i) => i.presente),
      senalQr: observacion.senalQr === true,
      paginaObservable:
        !arranqueFallido &&
        !errorRed &&
        observacion.readyState !== '' &&
        observacion.readyState !== 'loading',
      plazoVencido,
      esperaAplicadaMs
    });

  try {
    let page = null;
    try {
      context = await chromium.launchPersistentContext(sessionDir, { headless, userAgent: USER_AGENT });
      page = context.pages()[0] || (await context.newPage());
      page.setDefaultTimeout(esperaAplicadaMs);
    } catch (err) {
      arranqueFallido = String((err && err.message) || err);
    }

    if (page) {
      try {
        await page.goto(url, { timeout: esperaAplicadaMs, waitUntil: 'domcontentloaded' });
      } catch (err) {
        // sin error de red, la carga quedó pendiente: el sondeo y el plazo deciden
        if (esErrorRed(err)) errorRed = String((err && err.message) || err);
      }

      for (;;) {
        observacion = await tomarObservacion(page);
        dictamen = decidir(Date.now() >= limite);
        if (dictamen.decidir) break; // FR-003: favorable ⇒ retorno inmediato
        await sleep(Math.min(POLL_MS, limite - Date.now()));
      }
    } else {
      dictamen = decidir(true); // sin página: decide ya (fallo de arranque)
    }
  } finally {
    await closeQuietly(context);
  }

  if (!dictamen.decidir) dictamen = decidir(true);

  return {
    autenticado: dictamen.autenticado,
    causa: dictamen.autenticado ? null : dictamen.causa,
    detalle: dictamen.detalle,
    esperaAplicadaMs,
    duracionMs: Math.min(Date.now() - inicio, esperaAplicadaMs),
    observacion,
    evidencia: { captura: null, resumen: null }
  };
}

/**
 * Publica UN Estado: imagen + texto del plato. Lanza Error con `.motivo` tipado
 * ('error-interfaz' | 'error-red' | 'sesion-no-disponible') o timeout interno.
 * Flujo vigente (oct-2026): pestaña Estados → «Add Status» → menú «Fotos y videos»
 * (abre el selector de archivos nativo) → comentario → enviar.
 * @param {{imagePath: string, text: string, timeoutMs: number}} params
 */
async function publishStatus({ imagePath, text, timeoutMs = 90000, url = WHATSAPP_URL, headless = false, sessionDir = SESSION_DIR }) {
  let context;
  let stage = 'navegacion';
  try {
    context = await chromium.launchPersistentContext(sessionDir, { headless, userAgent: USER_AGENT });
    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(stepTimeout(timeoutMs));

    stage = 'navegacion';
    await page.goto(url, { timeout: stepTimeout(timeoutMs), waitUntil: 'domcontentloaded' });

    stage = 'interfaz';
    await page.locator(SELECTORS.authenticated).first().waitFor({ state: 'visible', timeout: stepTimeout(timeoutMs) });

    // Abrir la pestaña de Estados. El aria-label está localizado: si el clic no abre
    // el compositor (otro idioma de la cuenta), se navega por la ruta estable.
    await page.locator(SELECTORS.statusTab).first().click();
    try {
      await page.locator(SELECTORS.addStatus).first().waitFor({ state: 'visible', timeout: STATUS_TAB_TIMEOUT_MS });
    } catch {
      await page.goto(SELECTORS.statusesUrl, { timeout: stepTimeout(timeoutMs), waitUntil: 'domcontentloaded' });
      await page.locator(SELECTORS.addStatus).first().waitFor({ state: 'visible', timeout: stepTimeout(timeoutMs) });
    }

    // «Add Status» despliega el menú; «Fotos y videos» dispara el selector de archivos
    // nativo, que Playwright intercepta como filechooser.
    await page.locator(SELECTORS.addStatus).first().click();
    const fileChooser = page
      .waitForEvent('filechooser', { timeout: stepTimeout(timeoutMs) })
      .catch(() => null);
    await page.locator(SELECTORS.statusMenu).first().click();
    const chooser = await fileChooser;
    if (chooser) {
      await chooser.setFiles(imagePath);
    } else {
      await page.locator(SELECTORS.fileInput).first().setInputFiles(imagePath);
    }

    // Escribir el texto del plato (nombre, precio, descripción y CTA). El textbox
    // del compositor es también la señal de que la vista previa ya está montada.
    const caption = page.locator(SELECTORS.caption).last();
    await caption.waitFor({ state: 'visible', timeout: stepTimeout(timeoutMs) });

    // Paso de carga de imagen: esperar a que el cliente termine de decodificar el
    // archivo. Publicar antes de tiempo hace que el estado se descarte en silencio.
    stage = 'carga-imagen';
    await esperarCargaImagen(page, Math.min(IMAGE_LOAD_TIMEOUT_MS, stepTimeout(timeoutMs)));

    await caption.fill(text);

    // Publicar y verificar confirmación (el compositor se cierra)
    await page.locator(SELECTORS.send).first().click();
    await caption.waitFor({ state: 'hidden', timeout: stepTimeout(timeoutMs) });

    // La publicación es ASÍNCRONA: el compositor ya se cerró, pero la imagen sigue
    // subiendo al CDN. Cerrar el navegador AHORA aborta la subida y el estado no se
    // publica (silenciosamente), así que se espera antes de salir de este bloque.
    stage = 'subida';
    await esperarSubidaEstado(
      page,
      page.locator(SELECTORS.myStatusRow).first(),
      Math.min(UPLOAD_CONFIRM_TIMEOUT_MS, stepTimeout(timeoutMs))
    );

    return { ok: true };
  } catch (err) {
    if (stage === 'navegacion') {
      throw classify(tagMotivo(err, 'error-red'));
    }
    throw classify(err);
  } finally {
    await closeQuietly(context);
  }
}

module.exports = {
  verifySession,
  publishStatus,
  classifyVerification,
  SELECTORS,
  SESSION_DIR,
  WHATSAPP_URL
};
