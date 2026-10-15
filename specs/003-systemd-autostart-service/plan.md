# Implementation Plan: Servicio de arranque automático del daemon (systemd --user)

**Branch**: `003-systemd-autostart-service` | **Date**: 2026-10-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-systemd-autostart-service/spec.md`

## Summary

Convertir el daemon `index.js` en un servicio de systemd **de usuario** que arranca
solo con el encendido de la PC (`Linger` + `WantedBy=default.target`), publica con un
display virtual `Xvfb` aunque nadie inicie sesión de escritorio, escribe sus eventos en
**archivo de log** (redirección de stdout/stderr desde la unidad, sin tocar el
código), reintenta de forma **acotada** (45 s × 5 arranques en 10 min ⇒ estado
terminal `failed` con motivo), se detiene **sin procesos huérfanos** (SIGTERM a toda la
cgroup + respaldo SIGKILL a los 10 s) y queda todo documentado en `OPERACION.md` con
comandos exactos. La pieza clave que hoy falta es que la unidad **exista versionada en
el repo** (`systemd/whatsapp-status.service`): hoy solo vive instalada a mano en
`~/.config/systemd/user/`, exactamente lo que el Principio VIII prohíbe. Cero cambios
en `index.js`/`whatsappBot.js`/`lib/` (fuera de alcance del spec).

## Technical Context

**Language/Version**: JavaScript CommonJS sobre Node.js ≥ 22 (nvm `v22.18.0`) — sin
cambio de stack; el feature añade **cero código de aplicación**

**Primary Dependencies**: Playwright (`chromium`, `headless: false` en publicación) y
`node-cron` intactos; capa de servicio nueva = `systemd` (user manager),
`loginctl enable-linger`, `xvfb-run`. **Cero dependencias npm nuevas**

**Storage**: archivos locales — `menu.json` (configuración, sin cambios),
`session/` (credencial, gitignored), log del daemon en
`/home/adonis/whatsapp-status.log` (`append:`, gitignored vía `*.log`), unidad
versionada `systemd/whatsapp-status.service` instalada en
`~/.config/systemd/user/whatsapp-status.service`

**Testing**: `node --test` + `node:assert/strict` (estilo 001/002) — 2 tests de
contrato nuevos que leen la unidad versionada y `OPERACION.md` desde el repo; la
validación real de systemd (encendido, huérfanos, reintentos) queda en
[quickstart.md](./quickstart.md) sobre la PC del operador

**Target Platform**: Linux con systemd, PC local del operador (usuario `adonis`),
funciona **sin sesión de escritorio** (linger + Xvfb)

**Project Type**: daemon single-project en la raíz (`index.js`) + **unidad de servicio
de usuario versionada** en `systemd/` (nuevo directorio) + guía de operación en la
raíz (`OPERACION.md`)

**Performance Goals**: operativo ≤ 3 min tras el encendido con 0 comandos manuales
(SC-001); parada con 0 residuales en ≤ 10 s (SC-003); fallo transitorio se recupera
solo en ≤ 2 min (SC-004); operador completa parada/arrancar/reiniciar/log en ≤ 1 min
(SC-005); 100 % de eventos en el archivo de log (SC-002)

**Constraints**: reintentos acotados y estado terminal — **prohibido el reintento
infinito** (FR-008, Principio VIII); sin cambios en el código del daemon
(`index.js`/`whatsappBot.js` — Assumptions); formato de log y enum de motivos **sin
ampliación** (contrato 001); `OPERACION.md` con comandos exactos (FR-011); regla de
recarga de `menu.json` documentada (FR-012); cero código sombra

**Scale/Scope**: 1 PC, 1 usuario, 1 servicio; 1 archivo de unidad nuevo + 2 tests de
contrato + secciones nuevas en `OPERACION.md` + 6 artefactos de especificación; sin
usuarios, permisos ni red

**0 NEEDS CLARIFICATION pendientes**: stack, plataforma y testing vienen fijados por
el spec y la constitución; las decisiones abiertas (ubicación/versionado de la unidad,
política de reintentos, redirección de logs, display virtual, política de parada,
mapeo de estados, secciones que faltan en la guía, comando de recuperación y
estrategia de validación) se resuelven en [research.md](./research.md) R1–R11.
Decisiones del propietario incorporadas: unidad versionada + comandos en
`OPERACION.md` (R1) y recuperación vía `npm run login` dependiente de 002 (R9).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Fuente: [.specify/memory/constitution.md](../../.specify/memory/constitution.md)
(v1.1.0). Evaluación inicial sobre la intención de diseño:

| # | Principio | Estado | Evidencia prevista en el diseño |
|---|-----------|--------|--------------------------------|
| I | Persistencia de Sesión Obligatoria | PASS | La unidad solo invoca `index.js`, que verifica en modo headless y **nunca** muestra QR; la recuperación manual es `npm run login` fuera del ciclo (invariante I9, research R9); `session/` sigue gitignored |
| II | Configuración Externa de Horarios | PASS | Sin cambios: `menu.json` sigue siendo la única fuente de horarios/contenido; el servicio solo la relee en cada arranque (I7) y documenta el reinicio obligatorio (FR-012) |
| III | Organización Estructurada de Contenido | PASS | Sin cambios: `assets/`, `menu.json` y la validación de imágenes/textos no se tocan (fuera de alcance) |
| IV | Modularidad Estricta y Control de Versiones | PASS | Cero cambios de código: la capa de servicio (systemd) vive fuera de `whatsappBot.js`/`index.js`, sin mezclar navegador y agendamiento; `*.log` y la unidad instalada no se versionan, la unidad fuente sí |
| V | Selectores Robustos de WhatsApp Web | PASS | Sin cambios: ningún selector ni interacción del DOM se modifica |
| VI | Validación Previa de Assets y Textos | PASS | Sin cambios: `validateDish` y el aborto por asset inválido quedan intactos; los tests de 001 siguen en verde |
| VII | Manejo de Errores y Resiliencia | PASS | Parada con SIGTERM + respaldo SIGKILL acotado (I3); reintentos con espera explícita y ventana (I4); cada fallo deja línea con timestamp y motivo (I5); sin esperas indefinidas nuevas |
| VIII | Operación Desatendida y Reproducible | PASS | Unidad **versionada** en `systemd/` (I8) + `OPERACION.md` con instalación/operación/desinstalación (I10); `Linger` + `WantedBy` para arranque sin intervención (I1); política acotada con estado terminal (I4); parada sin huérfanos y log con el formato vigente (I3/I6) |

Gates de conducta del agente: estrictamente conforme a `spec.md` (cero código sombra —
ni healthcheck, ni pidfile, ni rotación de log, ni notificaciones: todo está en
Assumptions como fuera de alcance); una sola contradicción detectada en la base
existente («recuperar sesión con `node index.js`», que no puede funcionar) resuelta
documentando `npm run login` según decisión del propietario (research R9) — no
introduce código nuevo.

**Resultado: PASS — sin violaciones.** Re-check post-Phase 1 más abajo (sección
«Constitution Check (post-Phase 1)»).

## Project Structure

### Documentation (this feature)

```text
specs/003-systemd-autostart-service/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command) — R1–R11
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── service-lifecycle.md        # unidad, invariantes, estados, comandos
│   └── operacion-sections.json     # estructura obligatoria de OPERACION.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
systemd/
└── whatsapp-status.service   # NUEVO: unidad versionada (fuente de verdad, Principio VIII)
                              #   [Unit]  StartLimitIntervalSec=600, StartLimitBurst=5
                              #   [Service] Type=simple, WorkingDirectory=<repo>,
                              #     ExecStart=xvfb-run -a … <node> index.js,
                              #     Environment=PATH=/usr/local/bin:/usr/bin:/bin,
                              #     Restart=on-failure, RestartSec=45,
                              #     KillMode=control-group, KillSignal=SIGTERM,
                              #     TimeoutStopSec=10, SendSIGKILL=yes,
                              #     StandardOutput/Error=append:/home/adonis/whatsapp-status.log
                              #   [Install] WantedBy=default.target
OPERACION.md               # AMPLIADO: + Prerrequisitos, + Instalación, + Verificación,
                              #   + Estados del servicio (FR-013), + recuperación con
                              #   `npm run login` (depende de 002 T032); se conservan
                              #   ruta rápida, stop/start/restart, logs, motivos,
                              #   comportamiento en encendido y desinstalación
index.js                   # SIN CAMBIOS (fuera de alcance) — ya sale con código ≠0 en
                              #   config-invalida/sesion-no-disponible y traga SIGTERM
whatsappBot.js             # SIN CAMBIOS (publicación headful requiere el Xvfb del servicio)
lib/                       # SIN CAMBIOS (logger sigue emitiendo una línea por evento en consola)
menu.json                  # SIN CAMBIOS (fuente externa de horarios, Principio II)
session/                   # SIN CAMBIOS — GITIGNORED (Principio I)
/home/adonis/whatsapp-status.log   # log del servicio (append, gitignored vía *.log)
tests/
└── contract/
    ├── test_service_unit.test.js   # NUEVO: directrices de la unidad + I8 (diff con la instalada)
    └── test_operacion_doc.test.js  # NUEVO: OPERACION.md vs contracts/operacion-sections.json
README.md                  # SIN CAMBIOS (ya enlaza OPERACION.md y documenta los comandos)
```

**Structure Decision**: se conserva el single project plano de la raíz fijado por los
features 001/002. Este feature **no añade código de aplicación**: su «código» es la
unidad de systemd, que vive en un directorio propio `systemd/` (separable, testeable y
diferente de la app) porque es configuración versionada del sistema, no lógica del
daemon. La documentación operativa permanece en `OPERACION.md` en la raíz, como exige
FR-011. Los dos tests nuevos se suman a `tests/contract/` siguiendo el patrón
existente (`fs.readFileSync` sobre archivos del repo): la documentación y la unidad son
producto de esta feature, así que se contratan igual que `.gitignore` o `menu.json`.

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
| I | Persistencia de Sesión Obligatoria | PASS | research R9 + contract §2 I9 y §6 (recuperación solo con `npm run login`, fuera del ciclo); data-model «Unidad de servicio» sin comandos de QR; quickstart S8/S14 e invariante «sin QR en el log» |
| II | Configuración Externa de Horarios | PASS | data-model § «Entidades que no cambian» (regla de recarga FR-012) + contract I7; quickstart S4 valida la recarga tras `restart` |
| III | Organización Estructurada de Contenido | PASS | data-model § «Entidades que no cambian»: Plato/Horario/validación intactos; ningún archivo de `assets/` ni `menu.json` se toca |
| IV | Modularidad Estricta y Control de Versiones | PASS | research R11 (árbol de cambios: solo `systemd/`, `OPERACION.md` y tests); contract I8 (unidad versionada ↔ instalada idénticas); `*.log` gitignored (quickstart invariante) |
| V | Selectores Robustos de WhatsApp Web | PASS | research R11 y data-model: `whatsappBot.js` sin cambios; quickstart no toca selectores |
| VI | Validación Previa de Assets y Textos | PASS | data-model § «Entidades que no cambian»; `npm test` (S1) mantiene en verde los tests de 001 |
| VII | Manejo de Errores y Resiliencia | PASS | research R2/R5; contract §1 (RestartSec/StartLimit/TimeoutStopSec) + invariantes I3/I4/I5; quickstart S3 (parada ≤ 10 s), S7 (recuperación ≤ 2 min), S8/S9 (estado terminal con motivo) |
| VIII | Operación Desatendida y Reproducible | PASS | research R1/R6/R8; contract §5 (instalación/desinstalación exactas) e I1/I2/I6/I10; data-model (unidad, política de reintentos, estados, guía); quickstart S2/S5/S6/S12/S13 |

**Resultado post-diseño: PASS — sin violaciones, 0 NEEDS CLARIFICATION pendientes
(Technical Context cerrado; todas las decisiones abiertas resueltas en research.md
R1–R11).** Pendientes de **otras features** (no bloquean este plan): `login.js` del
feature 002 (T032), requerido solo por el escenario de recuperación de sesión S8.
