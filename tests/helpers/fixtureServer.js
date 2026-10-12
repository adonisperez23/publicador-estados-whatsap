'use strict';

// Servidor HTTP efímero para las fixtures locales de verificación (sin WhatsApp,
// sin red externa — plan.md Testing). Sirve tests/fixtures/*.html; la ruta
// /eternal-load escribe solo un prefijo truncado y NUNCA cierra la respuesta para
// que la página quede en readyState 'loading' (causa «interfaz no cargó a tiempo»).

const http = require('http');
const fs = require('fs');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
const ETERNAL_PREFIX =
  '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
  '<title>Carga eterna</title><script src="/hang.js"';

function startFixtureServer() {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname === '/eternal-load') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.write(ETERNAL_PREFIX);
      // la respuesta queda abierta: domcontentloaded nunca se dispara
      return;
    }
    if (pathname === '/hang.js') {
      // nunca se responde: el parser queda bloqueado a la espera del script
      return;
    }
    const file = path.join(FIXTURES_DIR, path.basename(pathname));
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('fixture no encontrada');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close() {
          for (const socket of sockets) socket.destroy();
          return new Promise((r) => server.close(r));
        }
      });
    });
  });
}

module.exports = { startFixtureServer, FIXTURES_DIR };
