# Quickstart & Validación: Diagnóstico y Resiliencia de la Verificación de Sesión

**Rama**: `002-session-verify-resilience` | **Fecha**: 2026-10-11
**Propósito**: guía ejecutable de validación end-to-end. No contiene implementación;
el detalle vive en [data-model.md](./data-model.md) y en los contratos
[verification-contract.md](./contracts/verification-contract.md) y
[diagnostics.schema.json](./contracts/diagnostics.schema.json).

## Prerrequisitos

- Node.js LTS (v22+) y npm en la máquina local del operador
- Chromium instalado para Playwright (`npx playwright install chromium`)
- Sesión vinculada siguiendo el flujo inicial del
  [quickstart del feature 001](../001-whatsapp-status-automator/quickstart.md)
  (solo la primera vez)
- Conexión a internet (salvo para el escenario de red caída)

## Setup

```bash
npm install
npx playwright install chromium
```

`diagnostics/` y `.daemon.pid` se auto-crean/gestionan en runtime; ambos están en
`.gitignore`.

## Comandos

| Acción | Comando |
|--------|---------|
| Pruebas unitarias/de contrato/integración (fixtures) | `npm test` |
| Ejecutar el daemon (ciclo automatizado) | `node index.js` |
| Restablecer sesión manualmente con QR (fuera del ciclo) | `npm run login` (equiv. `node login.js`) |
| Ver tiempo de espera efectivo | línea de arranque de la verificación en consola |

## Escenarios de validación

Cada escenario es **independiente** y mapea a criterios del spec. Salida esperada según
[verification-contract.md §2](./contracts/verification-contract.md).

| # | Escenario (Given/When/Then abreviado) | Comprobación | Cubre |
|---|----------------------------------------|--------------|-------|
| S1 | Sesión vigente → `node index.js` | Línea `… \| sistema \| - \| exito \| -` + arranque informa la espera efectiva (30000 ms por defecto); cero carpetas nuevas en `diagnostics/` | US1, SC-003, SC-007 |
| S2 | `sessionVerifyTimeoutSeconds: 90` en `menu.json` → arranque | La salida informa `90000 ms`; con carga lenta, la verificación espera realmente ~90 s antes de fallar (no 30) | US4 AC1, SC-003, FR-006 |
| S3 | `"sessionVerifyTimeoutSeconds": 0` o `"abc"` → arranque | Aviso en stderr + default 30000 ms aplicado; el daemon **continúa** (no aborta como `config-invalida`) | US4 AC3, FR-006 |
| S4 | `mv session session.bak && mkdir session` (perfil vacío ⇒ QR) → `node index.js` | Causa `sesion-caducada`: línea `… \| sistema \| - \| fallo \| sesion-no-disponible`, mensaje con acción `npm run login`, exit ≠ 0, carpeta `diagnostics/verification-*/` con `screenshot.png` + `summary.json`; **ninguna ventana visible ni QR en pantalla** | US2 AC1, US5 AC2, FR-004a/007/011, SC-001/004/005 |
| S5 | Sin conexión a red → `node index.js` | Causa `error-red` (fallo rápido, sin gastar la espera): motivo `error-red` + mensaje «revisa la conectividad» + artefactos | US2 AC4, FR-004d |
| S6 | Interfaz cargada sin indicadores → clasificador | Causa `cambio-interfaz`, motivo `error-interfaz`; determinista con los fixtures de `npm test` (página cargada, indicadores ocultos) | US2 AC3, FR-004c, Clarificación 2 |
| S7 | Carga que excede la espera → clasificador | Causa `interfaz-no-cargo-a-tiempo`, motivo `timeout`, mensaje con la espera aplicada; fixture de carga eterna con espera corta en `npm test` | US2 AC2, US4 AC4, FR-004b |
| S8 | Fixture con solo **1 de 3** indicadores visibles (por turnos) → verificación | Sesión clasificada **autenticada** en los tres casos; retorno inmediato sin agotar la espera | US1 AC1–2, FR-001/003, SC-002 |
| S9 | Daemon en marcha → `npm run login` | `login: el daemon está en marcha (pid …)` y exit 1; `session/` intacto (compara `ls -la session/` antes/después) | US5 AC4, FR-012, Clarificación 3 |
| S10 | Daemon detenido, sesión vigente → `npm run login` | Informa «la sesión sigue vinculada» + prompt; responder `N` ⇒ `login: sin cambios.`, exit 0, `session/` intacto | US5 AC3, FR-012 |
| S11 | `mv session session.bak` → `npm run login` → escanear QR → `node index.js` | Ventana **headful** con QR (único lugar del sistema donde aparece); tras escanear: `login: sesión vinculada correctamente.`; el arranque posterior clasifica **autenticada** | US5 AC1/5, SC-005 |
| S12 | `npm test` | Unit + contrato + integración en verde: clasificación de las 4 causas, sanitización de la espera, `summary.json` contra el esquema, `.gitignore` con `diagnostics/` y `.daemon.pid` | SC-001/002/003/004 |
| S13 | Revisión manual de un fallo (S4/S5) | `cat diagnostics/verification-*/summary.json` válido y **sin** cuerpos de mensajes/contactos/credenciales; `git status --porcelain \| grep diagnostics` vacío | FR-008/009, SC-004 |

> S6–S8 se validan de forma determinista con los fixtures HTML locales que ejecuta
> `npm test` (sin tocar WhatsApp); la contraparte real con WhatsApp Web se comprueba en
> S4/S11, que ejercitan los indicadores estables contra el DOM auténtico.

## Verificación de invariantes (post-ejecución)

```bash
# FR-011/SC-005: el ciclo automatizado jamás pide QR (ninguna ventana aparece)
grep -i "qr\|login" salida-daemon.log   # solo el mensaje que REMITE a npm run login

# SC-001: cero fallos de verificación sin causa diferenciada
grep " | sistema | - | fallo | " salida-daemon.log | grep -v -E "sesion-no-disponible|timeout|error-interfaz|error-red"

# FR-008/SC-004: los artefactos no se versionan ni salen de la máquina
git status --porcelain | grep -E "diagnostics|\.daemon\.pid"

# FR-013/SC-007: sin chromium huérfano tras cada arranque/verificación
pgrep -af "chromium|headless" || echo "OK: sin procesos residuales"
```

Los cuatro comandos deben devolver **vacío** (o «OK» en el último).

## Criterios de done de la validación

- S1–S13 ejecutados con salida conforme a
  [verification-contract.md](./contracts/verification-contract.md)
- `npm test` en verde (unit + contract + integración con fixtures)
- Cada fallo provocado dejó su carpeta en `diagnostics/` con `summary.json` válido
- Ningún QR visible durante el ciclo automatizado; el único flujo con QR es
  `npm run login` (S11)
- Ningún chromium huérfano tras cada verificación; `session/` y `diagnostics/`
  gitignored
