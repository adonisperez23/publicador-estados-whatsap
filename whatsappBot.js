'use strict';

// Automatización Playwright de WhatsApp Web — publica UN Estado (FR-001, FR-002).
// Principio IV: módulo de navegador 100% desacoplado del orquestador (index.js).
// Principio V: selectores SOLO por atributos estables (data-icon, role, aria-label);
// ningún otro módulo conoce el DOM. Principio VII: try/catch/finally en todo bloque.

const path = require('path');
const { chromium } = require('playwright');

const SESSION_DIR = path.join(__dirname, 'session');
const WHATSAPP_URL = 'https://web.whatsapp.com';

// Selectores encapsulados (research.md R4). Solo cambian ante un cambio observado del DOM.
const SELECTORS = Object.freeze({
  authenticated: '[data-icon="chat"]',
  statusTab: '[data-icon="status"]',
  addStatus: '[data-icon="plus"]',
  composerDialog: 'div[role="dialog"]',
  fileInput: 'div[role="dialog"] input[type="file"]',
  caption: 'div[role="dialog"] div[contenteditable="true"][aria-label]',
  send: 'div[role="dialog"] [data-icon="send"]'
});

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

function classify(err) {
  if (err && err.motivo) return err;
  const msg = String((err && err.message) || '');
  if (/net::|ERR_|ECONN|ENOTFOUND|EAI_AGAIN|getaddrinfo|socket hang up|ECONNREFUSED/i.test(msg)) {
    return tagMotivo(err, 'error-red');
  }
  return tagMotivo(err, 'error-interfaz');
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

/**
 * Verifica la autenticación de la sesión persistente SIN login interactivo (FR-014, R3).
 * Nunca muestra ni escanea un QR: si no está autenticada, el caller aborta.
 * @returns {Promise<{authenticated: boolean, reason?: string}>}
 */
async function verifySession({ timeoutMs = 30000, url = WHATSAPP_URL, headless = false, sessionDir = SESSION_DIR } = {}) {
  let context;
  try {
    context = await chromium.launchPersistentContext(sessionDir, { headless });
    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(stepTimeout(timeoutMs));
    try {
      await page.goto(url, { timeout: stepTimeout(timeoutMs), waitUntil: 'domcontentloaded' });
      await page
        .locator(SELECTORS.authenticated)
        .first()
        .waitFor({ state: 'visible', timeout: stepTimeout(timeoutMs) });
      return { authenticated: true };
    } catch (err) {
      return { authenticated: false, reason: classify(err).message };
    }
  } catch (err) {
    return { authenticated: false, reason: String((err && err.message) || err) };
  } finally {
    await closeQuietly(context);
  }
}

/**
 * Publica UN Estado: imagen + texto del plato. Lanza Error con `.motivo` tipado
 * ('error-interfaz' | 'error-red' | 'sesion-no-disponible') o timeout interno.
 * @param {{imagePath: string, text: string, timeoutMs: number}} params
 */
async function publishStatus({ imagePath, text, timeoutMs = 90000, url = WHATSAPP_URL, headless = false, sessionDir = SESSION_DIR }) {
  let context;
  let stage = 'navegacion';
  try {
    context = await chromium.launchPersistentContext(sessionDir, { headless });
    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(stepTimeout(timeoutMs));

    stage = 'navegacion';
    await page.goto(url, { timeout: stepTimeout(timeoutMs), waitUntil: 'domcontentloaded' });

    stage = 'interfaz';
    await page.locator(SELECTORS.authenticated).first().waitFor({ state: 'visible', timeout: stepTimeout(timeoutMs) });

    // Abrir pestaña de Estados y el compositor («Añadir estado»)
    await page.locator(SELECTORS.statusTab).first().click();
    await page.locator(SELECTORS.addStatus).first().click();

    // Subir la imagen del plato por el input de archivo oculto del compositor
    await page.locator(SELECTORS.fileInput).first().setInputFiles(imagePath);

    // Escribir el texto del plato (nombre, precio, descripción y CTA)
    const caption = page.locator(SELECTORS.caption).last();
    await caption.waitFor({ state: 'visible', timeout: stepTimeout(timeoutMs) });
    await caption.fill(text);

    // Publicar y verificar confirmación (el compositor se cierra)
    await page.locator(SELECTORS.send).first().click();
    await page
      .locator(SELECTORS.caption)
      .last()
      .waitFor({ state: 'hidden', timeout: stepTimeout(timeoutMs) });

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

module.exports = { verifySession, publishStatus, SELECTORS, SESSION_DIR, WHATSAPP_URL };
