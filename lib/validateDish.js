'use strict';

// Validación previa de assets y textos POR INTENTO (FR-006, FR-007, research.md R10,
// Principio VI). Devuelve null si el plato es publicable, o el motivo tipado:
// 'imagen-faltante' | 'texto-vacío' | 'texto-largo'.

const fs = require('fs');
const path = require('path');

// Límite de caracteres del mensaje de un Estado (research.md R10)
const MAX_STATUS_TEXT_LENGTH = 1024;

const TEXT_FIELDS = Object.freeze(['name', 'price', 'description', 'cta']);

function composeStatusText(dish) {
  return [dish.name, dish.price, dish.description, dish.cta].join('\n');
}

function imageOk(imagePath) {
  try {
    fs.accessSync(imagePath, fs.constants.R_OK);
    const stat = fs.statSync(imagePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

/**
 * @param {{image: string, name: string, price: string, description: string, cta: string}} dish
 * @param {string} assetsDir directorio assets/
 * @returns {null|'imagen-faltante'|'texto-vacío'|'texto-largo'}
 */
function validateDish(dish, assetsDir) {
  if (!imageOk(path.join(assetsDir, dish.image))) {
    return 'imagen-faltante';
  }
  for (const field of TEXT_FIELDS) {
    const value = dish[field];
    if (typeof value !== 'string' || value.trim() === '') {
      return 'texto-vacío';
    }
  }
  if (composeStatusText(dish).length > MAX_STATUS_TEXT_LENGTH) {
    return 'texto-largo';
  }
  return null;
}

module.exports = { validateDish, composeStatusText, MAX_STATUS_TEXT_LENGTH, TEXT_FIELDS };
