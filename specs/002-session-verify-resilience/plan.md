# Implementation Plan: Diagnóstico y Resiliencia de la Verificación de Sesión de WhatsApp Web

**Branch**: `002-session-verify-resilience` | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-session-verify-resilience/spec.md`

## Summary

Rehacer la verificación de sesión de WhatsApp Web para eliminar los abortos falsos y
hacerlos diagnosticables: (1) la autenticación se detecta con **varios indicadores
estables alternativos** (basta con uno, se resuelve en cuanto aparece); (2) cada fallo
se clasifica en **cuatro causas mutuamente exclusivas** —sesión caducada, interfaz no
cargó a tiempo, cambio de interfaz, error de red— comunicadas con mensaje en lenguaje del
operador y el motivo de registro correspondiente; (3) el tiempo de espera pasa a ser
**configurable desde la configuración externa** (`menu.json`), respetando el valor del
orquestador sin tope fijo interno; (4) ante cada fallo quedan **artefactos locales de
diagnóstico** (captura de la interfaz visible + resumen estructural) en `diagnostics/`
(gitignored, nunca transmitidos); (5) existe **`login.js`**, un comando manual fuera del
ciclo que muestra el QR para restablecer la sesión y se niega si el daemon corre. El
ciclo automatizado jamás muestra QR: la verificación corre en modo headless. Cero
dependencias nuevas; mismos `index.js`/`whatsappBot.js`/`lib/` con la separación de
responsabilidades de la constitución.

## Technical Context

**Language/Version**: Node.js ≥ 22 (LTS), JavaScript CommonJS — sin cambio de stack

**Primary Dependencies**: Playwright (`chromium`, contexto persistente), AJV
(validación de configuración), `node-cron` (agendamiento, intacto) — **cero
dependencias nuevas**

**Storage**: archivos locales — `menu.json` (+ campo `sessionVerifyTimeoutSeconds`),
`session/` (credencial, gitignored, sin cambios), `diagnostics/` (nuevo, gitignored,
una carpeta por fallo: `screenshot.png` + `summary.json`), `.daemon.pid` (nuevo,
gitignored, para que el comando manual detecte al daemon), registros en consola

**Testing**: `node:test` + `node:assert/strict` (decisión R1 del feature 001) con
fixtures HTML locales servidos por un servidor efímero para probar las cuatro causas y
los indicadores vía Playwright — sin WhatsApp ni red externa en pruebas automatizadas;
la validación contra WhatsApp real queda en [quickstart.md](./quickstart.md)

**Target Platform**: equipo local del operador (Linux/Windows/macOS) con conexión a
internet

**Project Type**: CLI/daemon single project con dos entry points: `index.js` (ciclo
automatizado) y `login.js` (comando manual de restablecimiento)

**Performance Goals**: artefactos almacenados ≤ 5 s tras el fallo (SC-004); toda
verificación termina ≤ a su espera configurada, sin esperas indefinidas (SC-007);
detección exitosa tan pronto como aparezca cualquier indicador (FR-003); el operador
identifica causa y acción en < 1 min (SC-006)

**Constraints**: cero QR/login dentro del ciclo automatizado (FR-011, Principio I);
indicadores solo por atributos semánticos estables (FR-002, Principio V); artefactos
solo locales y sin contenido de sesión en el resumen (FR-008/009); el tiempo indicado
por el orquestador se aplica sin tope interno (FR-006); `try/catch/finally` con
liberación de recursos en todo bloque de navegador (FR-013, Principio VII); enum de
motivos de log **sin ampliación** (Assumption del spec — mapeo en
[contracts/verification-contract.md](./contracts/verification-contract.md))

**Scale/Scope**: 1 operador, 1 cuenta; 4 causas de fallo; ~2 módulos nuevos
(`login.js`, `lib/diagnostics.js`) y ~3 modificados (`whatsappBot.js`, `index.js`,
`lib/config.js`); decenas de entradas de diagnóstico como máximo; sin usuarios ni
permisos

**0 NEEDS CLARIFICATION pendientes**: el stack, el almacenamiento y el testing vienen
fijados por la constitución y por el código/contratos existentes; las decisiones
abiertas (estrategia de indicadores, clasificación, artefactos, comando manual,
modo de lanzamiento) se resuelven en [research.md](./research.md).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Fuente: [.specify/memory/constitution.md](../../.specify/memory/constitution.md)
(v1.0.0). Evaluación inicial sobre la intención de diseño:

| # | Principio | Estado | Evidencia prevista en el diseño |
|---|-----------|--------|--------------------------------|
| I | Persistencia de Sesión Obligatoria | PASS | El ciclo sigue abortando sin QR ante sesión ausente/caducada (FR-011); el QR existe solo en `login.js`, entry point manual nunca invocado por `index.js`; la verificación corre headless ⇒ ni siquiera se renderiza un QR en pantalla durante el ciclo (research R6) |
| II | Configuración Externa de Horarios | PASS | El nuevo tiempo de espera vive en `menu.json` (`sessionVerifyTimeoutSeconds`), nunca en código; default documentado 30 s (FR-006, research R2) |
| III | Organización Estructurada de Contenido | PASS | Sin cambios: el flujo de publicación y el vínculo imagen↔texto no se tocan (alcance del spec) |
| IV | Modularidad Estricta y Control de Versiones | PASS | `whatsappBot.js` sigue concentrando el DOM/navegador; `index.js` solo orquesta (pasa la espera, mapea causas, escribe artefactos vía `lib/diagnostics.js`); `login.js` es un entry point aparte; `diagnostics/` y `.daemon.pid` se agregan a `.gitignore` junto a `session/` |
| V | Selectores Robustos de WhatsApp Web | PASS | Los indicadores (autenticados y de QR) usan exclusivamente `role`, `aria-*` y `data-icon`; conjunto encapsulado en `whatsappBot.js`; cambios solo ante DOM observado (research R1) |
| VI | Validación Previa de Assets y Textos | PASS | Sin cambios: la validación previa existente queda intacta fuera del alcance |
| VII | Manejo de Errores y Resiliencia | PASS | Espera explícita y acotada por configuración (FR-013); `try/catch/finally` con cierre del contexto en éxito y fallo; logs con timestamp, causa y motivo; fallo al escribir artefactos nunca enmascara la causa original (FR-010) |

Gates de conducta del agente: estrictamente conforme a `spec.md` (cero código sombra;
el comando manual y los artefactos están pedidos por el spec); ninguna contradicción
detectada con la constitución.

**Resultado: PASS — sin violaciones.** Re-check post-Phase 1 más abajo (sección
«Constitution Check (post-Phase 1)»).

## Project Structure

### Documentation (this feature)

```text
specs/002-session-verify-resilience/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── verification-contract.md      # resultado de verificación, causas, comando manual
│   └── diagnostics.schema.json       # esquema JSON de summary.json
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
index.js                 # orquestador: config, llama verifySession con la espera
                         #   configurada, mapea causa→motivo→mensaje, escribe
                         #   artefactos vía lib/diagnostics.js, gestiona .daemon.pid
login.js                 # NUEVO entry point manual: restablece la sesión mostrando
                         #   el QR; se niega si el daemon corre; nunca lo llama index.js
whatsappBot.js           # navegador: verifySession ampliada (multi-indicador,
                         #   clasificación de 4 causas, captura de evidencia headless);
                         #   publishStatus sin cambios de alcance
lib/
├── config.js            # + sessionVerifyTimeoutSeconds (sanitización: ausente o
│                        #   inválido ⇒ default 30 s + aviso; sin máximo)
├── diagnostics.js       # NUEVO: escritura de artifacts (screenshot.png +
│                        #   summary.json) en diagnostics/verification-<ts>/; fs puro
└── logger.js            # SIN cambios de contrato (mismo enum de motivos)
menu.json                # + sessionVerifyTimeoutSeconds (opcional)
session/                 # contexto de navegador — GITIGNORED (sin cambios)
diagnostics/             # NUEVO: evidencia de fallos — GITIGNORED, auto-creado
.daemon.pid              # NUEVO: pid del daemon — GITIGNORED (limpieza al salir)
specs/001-whatsapp-status-automator/contracts/
└── menu-config.schema.json  # EXTENDIDO con la propiedad opcional
                         #   sessionVerifyTimeoutSeconds (contrato de config vigente)
package.json             # + script "login": "node login.js"
tests/
├── unit/                # + clasificación de causas (función pura), sanitización
│                        #   de la espera, generación del summary
├── contract/            # + .gitignore contiene diagnostics/ y .daemon.pid;
│                        #   summary.json contra contracts/diagnostics.schema.json;
│                        #   mapea causa→motivo→mensaje según verification-contract.md
└── integration/         # + fixtures HTML locales (autenticado/QR/carga eterna/
                         #   cargado-sin-indicadores/sin red) servidos por servidor
                         #   efímero — prueba las 4 causas sin tocar WhatsApp
```

**Structure Decision**: se conserva el single project plano de la raíz fijado por el
feature 001 (`index.js`, `whatsappBot.js`, `lib/`, `menu.json`, `session/`). Este
feature añade un segundo entry point `login.js` —equivalente en nivel a `index.js`—
porque el Principio I/FR-011 exigen que el QR viva **fuera** del ciclo automatizado, y
un módulo `lib/diagnostics.js` puro de filesystem para que la escritura de artefactos
sea testeable sin navegador. La lógica de DOM/indicadores permanece encapsulada en
`whatsappBot.js` (Principio IV y V). El esquema de configuración vigente
(`menu-config.schema.json`, referenciado por `lib/config.js`) se extiende con la nueva
propiedad opcional — es el contrato de configuración único del proyecto.

## Complexity Tracking

> No hay violaciones de la Constitución Check; tabla vacía.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_ | — | — |

## Constitution Check (post-Phase 1)

*Re-evaluación tras generar `research.md`, `data-model.md`, `contracts/` y
`quickstart.md`*:

| # | Principio | Estado post-diseño | Evidencia en artefactos |
|---|-----------|--------------------|-------------------------|
| I | Persistencia de Sesión Obligatoria | PASS | research.md R6 (verificación headless ⇒ el ciclo nunca renderiza QR) y R5 (`login.js` es entry point aparte, no invocado por `index.js`); contract: invariante «ciclo sin QR»; quickstart S4/S9/S11 |
| II | Configuración Externa de Horarios | PASS | research.md R2 + data-model.md «Configuración de verificación»: `sessionVerifyTimeoutSeconds` en `menu.json`, default 30 s, sin máximo; contract documenta el campo |
| III | Organización Estructurada de Contenido | PASS | Alcance intacto: data-model.md señala que Plato/Horario y la validación de assets no cambian |
| IV | Modularidad Estricta y Control de Versiones | PASS | plan árbol de fuente: DOM en `whatsappBot.js`, orquestación en `index.js`, fs en `lib/diagnostics.js`, entry manual `login.js`; research R4/R5; contract: `diagnostics/` y `.daemon.pid` gitignored (test de contrato) |
| V | Selectores Robustos de WhatsApp Web | PASS | research.md R1: indicadores solo `role`/`aria-*`/`data-icon`, conjunto encapsulado, empirismo antes de cambiar; quickstart S6/S8 validan contra DOM real/fixtures |
| VI | Validación Previa de Assets y Textos | PASS | Sin cambios de alcance (data-model.md); los tests de 001 siguen en verde (quickstart S12) |
| VII | Manejo de Errores y Resiliencia | PASS | research.md R3 (árbol de clasificación con espera acotada) y R4 (fallo al escribir artefactos no enmascara la causa, FR-010); contracts/verification-contract.md invariantes 3–5; quickstart S7 y verificación de «sin chromium huérfano» |

**Resultado post-diseño: PASS — sin violaciones, sin NEEDS CLARIFICATION pendientes
(Technical Context cerrado; todas las decisiones abiertas resueltas en research.md
R1–R8).**
