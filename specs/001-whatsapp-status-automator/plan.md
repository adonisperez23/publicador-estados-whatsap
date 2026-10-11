# Implementation Plan: Automatizador de Estados de WhatsApp Business

**Branch**: `001-whatsapp-status-automator` | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-whatsapp-status-automator/spec.md`

## Summary

Un daemon de Node.js que, mediante Playwright sobre WhatsApp Web con contexto de
navegador persistente (`session/`), publica automáticamente Estados de platos del menú
(imagen + nombre + precio + descripción + llamada a la acción) en horarios definidos por
`node-cron` a partir de una configuración externa (`menu.json`). El orquestador
(`index.js`) valida assets/textos antes de invocar al bot (`whatsappBot.js`), respeta un
intervalo configurable entre publicaciones consecutivas, aplica un timeout máximo de 90 s
por intento, serializa las publicaciones (sin concurrencia), omite horarios perdidos sin
backfill y registra cada intento en consola. La sesión se gestiona como credencial
(excluida de git, permisos restringidos) y los selectores se basan en atributos estables
(`data-icon`, `role`, aria) según la constitución.

## Technical Context

**Language/Version**: Node.js LTS (v22 o superior), JavaScript (CommonJS o ESM, decidir
en tasks)

**Primary Dependencies**: Playwright (`chromium`, contexto persistente), `node-cron`;
sin frameworks web ni bases de datos

**Storage**: archivos locales — `menu.json` (configuración), `assets/` (imágenes),
`session/` (contexto de navegador persistente, gitignored), `Registro de publicación` en
logs de consola (FR-010: solo consola, sin persistencia en disco)

**Testing**: `node:test` + `node:assert/strict` (runner integrado, sin dependencias) para
unit/contract, más Playwright para integración/e2e — decisión y alternativas en
[research.md](./research.md) R1 (cerraba el único NEEDS CLARIFICATION del template)

**Target Platform**: equipo local del operador (Linux/Windows/macOS) con conexión a
internet; zona horaria local de la máquina

**Project Type**: aplicación CLI/daemon de automatización (single project, sin frontend
ni API)

**Performance Goals**: 95% de publicaciones dentro de los 2 min de su hora (SC-001,
ampliado por el intervalo configurado en horarios multi-plato); intento ≤ 90 s (FR-008);
edición de configuración ≤ 3 min sin tocar código (SC-002)

**Constraints**: cero publicaciones concurrentes (FR-013); intervalo configurable entre
publicaciones (FR-015); `session/` fuera de VCS con permisos restringidos (FR-016);
validación previa de imagen/texto y nunca contenido vacío (FR-006/FR-007); login
interactivo prohibido en ejecución automatizada (FR-014); sin reintento inmediato tras
fallo (Assumptions); solo Estados del perfil, sin edición/borrado

**Scale/Scope**: 1 operador, 1 cuenta; decenas de platos y pocas publicaciones por día
(3–10 horarios); ~3–5 módulos de código; sin usuarios ni permisos

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Fuente: [.specify/memory/constitution.md](../../.specify/memory/constitution.md)
(v1.0.0). Evaluación inicial:

| # | Principio | Estado | Evidencia en el diseño |
|---|-----------|--------|------------------------|
| I | Persistencia de Sesión Obligatoria | PASS | Contexto Playwright persistente en `session/`; sesión ausente ⇒ error (FR-014), nunca login interactivo |
| II | Configuración Externa de Horarios | PASS | Todos los horarios y platos viven en `menu.json`; cero horarios en código |
| III | Organización Estructurada de Contenido | PASS | Imagen físicamente en `assets/` + vínculo explícito imagen↔texto por `id` en `menu.json`; vínculo ambiguo/faltante bloquea la publicación (FR-005) |
| IV | Modularidad Estricta y Control de Versiones | PASS | `whatsappBot.js` (navegador) totalmente desacoplado de `index.js` (agendamiento); `session/` en `.gitignore` (FR-016) |
| V | Selectores Robustos de WhatsApp Web | PASS | Selectores por `data-icon`, `role`, aria; aislados en `whatsappBot.js`; cambios de selector solo ante cambio observado del DOM |
| VI | Validación Previa de Assets y Textos | PASS | Validación de existencia/legibilidad de imagen y texto no vacío antes de invocar al bot (FR-006); fallo ⇒ log + omisión, nunca publicación parcial (FR-007) |
| VII | Manejo de Errores y Resiliencia | PASS | `try/catch/finally` en todo bloque de navegador; timeout global de 90 s por intento (FR-008); logs detallados con timestamp, plato, resultado y motivo (FR-010) |

Gates de conducta del agente: código estrictamente conforme a `spec.md` (cero código
sombra); sin contradicciones con la constitución detectadas.

**Resultado: PASS — sin violaciones.** Re-check post-Phase 1 más abajo (sección
«Constitution Check (post-Phase 1)»).

## Project Structure

### Documentation (this feature)

```text
specs/001-whatsapp-status-automator/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── menu-config.schema.json
│   └── log-format.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
index.js                 # Entry point: carga config, valida, registra cron, serializa intentos
whatsappBot.js           # Automatización Playwright: publica UN Estado; selectores estables
lib/
├── config.js            # Carga y validación de menu.json (falla claro si está mal formado)
└── logger.js            # Formato de log de consola (FR-010)
menu.json                # Configuración externa: platos, horarios, intervalo, timeouts
assets/                  # Imágenes de platos (presencia verificada antes de publicar)
session/                 # Contexto de navegador persistente — GITIGNORED, chmod 700
.gitignore               # Excluye session/ y datos sensibles (FR-016, Principio IV)
tests/
├── unit/                # config.js, validaciones de plato/texto, planificador
├── contract/            # menu.json contra contracts/menu-config.schema.json
└── integration/         # flujo completo con Playwright (mock/e2e según research.md)
```

**Structure Decision**: single project plano en la raíz, con los nombres de módulos
fijados por el propio spec (`index.js`, `whatsappBot.js`, `menu.json`, `assets/`,
`session/`) y una capa mínima `lib/` para config y logging — la estructura de módulos
queda definida aquí conforme a la Assumption del spec («la estructura de módulos del
programa se define en la fase de planificación»). Principio IV exige únicamente el
desacople bot ↔ orquestador, que esta estructura garantiza.

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
| I | Persistencia de Sesión Obligatoria | PASS | research.md R3 (arranque detecta sesión y aborta sin QR); quickstart escenario S6 |
| II | Configuración Externa de Horarios | PASS | contracts/menu-config.schema.json define `schedules[]`; research.md R5 |
| III | Organización Estructurada de Contenido | PASS | data-model.md: `Plato` con `id` único, imagen en `assets/` validada por intento y vínculo imagen↔texto exclusivamente por `id`; contrato exige campos de texto por plato |
| IV | Modularidad Estricta y Control de Versiones | PASS | árbol de fuente separa `whatsappBot.js` de `index.js`; contrato prohíbe exponer `session/`; research.md R9 |
| V | Selectores Robustos de WhatsApp Web | PASS | research.md R4 (solo `role`/`data-icon`/aria; selectores encapsulados) |
| VI | Validación Previa de Assets y Textos | PASS | data-model.md máquina de estados intento: `validando → publicando → éxito/fallo`; quickstart S2/S3 |
| VII | Manejo de Errores y Resiliencia | PASS | research.md R6/R7 (timeout 90 s, `try/catch/finally`, formato de log en contracts/log-format.md) |

**Resultado post-diseño: PASS — sin violaciones, sin NEEDS CLARIFICATION pendientes
(Technical Context cerrado en research.md R1).**
