'use strict';

// Formato de registro (FR-010, SC-005) — contrato: specs/001-whatsapp-status-automator/contracts/log-format.md
// Una sola línea por evento: <timestamp ISO-8601 local> | <tipo> | <plato> | <resultado> | <motivo>

const TIPOS = Object.freeze(['intento', 'omision', 'sistema']);
const RESULTADOS = Object.freeze(['exito', 'fallo']);
const MOTIVOS = Object.freeze([
  'imagen-faltante',
  'texto-vacío',
  'texto-largo',
  'config-invalida',
  'sesion-no-disponible',
  'timeout',
  'error-interfaz',
  'error-red'
]);

function pad(n) {
  return String(n).padStart(2, '0');
}

function localIso(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function formatLine({ timestamp, tipo, plato = '-', resultado, motivo = '-' }) {
  if (!TIPOS.includes(tipo)) {
    throw new TypeError(`tipo inválido: ${tipo}`);
  }
  if (!RESULTADOS.includes(resultado)) {
    throw new TypeError(`resultado inválido: ${resultado}`);
  }
  const needsMotivo = resultado === 'fallo' || tipo === 'omision';
  if (needsMotivo && (motivo === '-' || !MOTIVOS.includes(motivo))) {
    throw new TypeError(`motivo requerido/inválido para tipo=${tipo}, resultado=${resultado}: ${motivo}`);
  }
  if (motivo !== '-' && !MOTIVOS.includes(motivo)) {
    throw new TypeError(`motivo desconocido: ${motivo}`);
  }
  const ts = timestamp || localIso();
  return `${ts} | ${tipo} | ${plato} | ${resultado} | ${motivo}`;
}

function emit(entry) {
  const line = formatLine(entry);
  if (entry.resultado === 'exito') {
    console.log(line);
  } else {
    console.error(line);
  }
  return line;
}

function logAttempt({ plato, resultado, motivo = '-', timestamp }) {
  return emit({ timestamp, tipo: 'intento', plato, resultado, motivo });
}

function logOmission({ plato, motivo, timestamp }) {
  return emit({ timestamp, tipo: 'omision', plato, resultado: 'fallo', motivo });
}

function logSystem({ resultado, motivo = '-', timestamp }) {
  return emit({ timestamp, tipo: 'sistema', plato: '-', resultado, motivo });
}

module.exports = {
  TIPOS,
  RESULTADOS,
  MOTIVOS,
  localIso,
  formatLine,
  logAttempt,
  logOmission,
  logSystem
};
