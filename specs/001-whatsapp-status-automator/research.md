# Phase 0 Research: Automatizador de Estados de WhatsApp Business

**Branch**: `001-whatsapp-status-automator` | **Date**: 2026-10-11
**Input**: [spec.md](./spec.md), [.specify/memory/constitution.md](../../.specify/memory/constitution.md)

Todos los NEEDS CLARIFICATION del Technical Context y las dependencias/integraciones
del spec quedan resueltos aquí. Formato por hallazgo: **Decision / Rationale /
Alternatives considered**.

---

## R1. Framework de pruebas (NEEDS CLARIFICATION resuelto)

**Decision**: `node:test` (runner integrado de Node.js) + `node:assert/strict` para
unitarias y de contrato; pruebas de integración/end-to-end con Playwright invocando el
mismo runner. Sin dependencias de testing adicionales.

**Rationale**: la constitución fija el stack en Node.js + Playwright sin mencionar un
framework; `node:test` elimina dependencias, es estable desde Node 18 y suficiente para
un proyecto de este tamaño (validadores, planificador, contrato de config, un e2e
controlado). Menos superficie de mantenimiento = más alineado con «cero código sombra».

**Alternatives considered**:
- *Jest*: ecosistema amplio, pero pesado y con overhead de transformación innecesario
  aquí — descartado por dependencia gratuita.
- *Vitest*: excelente DX, pero requiere tooling ESM/vite — descartado por complejidad.
- *Playwright Test solo*: cubre e2e pero no el runner idóneo para unitarias de
  `lib/config.js` — se usa como complemento, no como único runner.

## R2. Contexto de navegador persistente con Playwright

**Decision**: `chromium.launchPersistentContext('session/', {...})` como única vía de
autenticación. El directorio `session/` ES el perfil de usuario de Chromium persistente;
el estado de login sobrevive a reinicios del proceso (cubre FR-002, SC-004 y el edge
case de «sesión de día anterior»). Contexto **headful** por defecto en la máquina local
del operador.

**Rationale**: es el mecanismo soportado oficialmente por Playwright para conservar
cookies/localStorage de WhatsApp Web entre ejecuciones; un contexto descartable
(`browser.newContext()` + `storageState`) se re-validaría en cada arranque y podría
caducar sin control. Headful reduce fallos de detección automatizada y permite al
operador ver la ventana en la primera configuración.

**Alternatives considered**:
- *`storageState` exportado/importado*: más ligero, pero el estado de WhatsApp Web
  incluye claves en IndexedDB que no se serializan de forma fiable — descartado.
- *whatsapp-web.js / Baileys (APIs no oficiales)*: violan el mandato del spec de
  controlar «WhatsApp Web mediante Playwright» y el Principio V — descartados.
- *Headless*: factible técnicamente, pero WhatsApp Web es más propenso a fallar sin
  ventana real; se deja como opción futura, no como default.

## R3. Detección de sesión al arrancar (sin login interactivo)

**Decision**: al iniciar, si hay un horario próximo, el bot abre la sesión persistente y
**verifica** el estado de autenticación mediante un selector estable de la UI logueada
(p. ej. elemento con `role="navigation"` / `data-icon="chat"` del panel principal). Si
la sesión no está autenticada o el directorio `session/` no existe: se registra el error
y el proceso termina con código de salida ≠ 0 **sin** mostrar QR y **sin** esperar
login (FR-014). El QR solo aparece en un arranque manual de configuración inicial
(documentado en quickstart.md).

**Rationale**: la constitución (Principio I) y FR-014 prohíben cualquier login
interactivo dentro del ciclo automatizado; «sesión ausente = error de configuración del
operador».

**Alternatives considered**:
- *Auto-mostrar QR si no hay sesión*: viola FR-014 directamente — descartado.
- *Reintentar conexión a WhatsApp Web en bucle indefinido*: viola los timeouts
  explícitos (FR-008, Principio VII) — descartado.

## R4. Estrategia de selectores sobre WhatsApp Web

**Decision**: localizadores Playwright exclusivamente sobre atributos estables:
`page.getByRole(...)`, `[data-icon="..."]`, `[aria-label="..."]`. Todos los selectores
viven encapsulados en `whatsappBot.js`; ningún otro módulo conoce el DOM. Regla de
mantenimiento: un selector solo cambia ante un cambio observado del DOM (Principio V),
nunca de forma preventiva.

Flujo publicador (alto nivel, sin código): abrir pestaña de Estado → subir imagen vía
`setInputFiles` en el input de archivo oculto → escribir texto del plato → publicar →
verificar confirmación.

**Rationale**: clases CSS de WhatsApp Web están ofuscadas y rotan en cada despliegue;
`data-icon`/`role`/aria son estables y son los que la constitución exige.

**Alternatives considered**:
- *Selectores por XPath textual o por clase CSS*: frágiles ante i18n y despliegues —
  descartados por Principio V.
- *Screenshots/visión por computadora*: sobredimensionado y no determinista —
  descartado.

## R5. Formato de configuración y sintaxis de horarios

**Decision**: `menu.json` — un único JSON con:
`{ "publishIntervalSeconds": number, "attemptTimeoutSeconds": 90, "dishes": [...],
"schedules": [{ "cron": "0 12 * * *", "dishIds": [...] }] }`.
Los horarios usan **cron de 5 campos en zona horaria local** (mismo dialecto que
`node-cron`); el vínculo imagen↔texto es por `id` de plato referenciado explícitamente
en `dishIds` (Principio III). El esquema JSON oficial vive en
[contracts/menu-config.schema.json](./contracts/menu-config.schema.json) y se valida
con un validador AJV en `lib/config.js` (ver R10).

**Rationale**: JSON es nativo de Node (cero dependencias de parseo), es lo que la
constitución menciona como fuente válida (`config.json`, `menu.json`), y el vínculo por
`id` elimina cualquier emparejamiento ambiguo por nombre o por orden (FR-005). El
esquema permite a `lib/config.js` abortar con «error claro e inmediato» ante config
mal formada (edge case del spec).

**Alternatives considered**:
- *JSON con cron por `HH:MM` simple*: no cubre recurrentes («expresiones … recurrentes»
  de FR-004) — descartado.
- *YAML / .env*: requiere parser adicional o no modela listas de platos — descartados.
- *Convención de nombres de archivo imagen↔texto*: permitida por la constitución pero
  más frágil que un `id` explícito y peor para «agregar plato en ≤3 min» (SC-002) —
  descartado.

## R6. Enforcement del timeout de 90 s por intento (FR-008)

**Decision**: presupuesto global de **90 000 ms por intento de publicación** impuesto
por el orquestador (`Promise.race` / timer global que envuelve toda la llamada al bot),
más timeouts Playwright individuales (navegación, localizadores, subida) configurados
por debajo de ese presupuesto para fallos más informativos. Al vencer: se registra
`timeout` como motivo, se ejecuta el `finally` que cierra/recursos del intento, y el
siguiente horario queda libre (FR-009, FR-011).

**Rationale**: un timeout solo de Playwright no cubriría reintentos internos o esperas
entre acciones; el presupuesto total es lo que SC-006 y SC-001 exigen medir.

**Alternatives considered**:
- *Solo timeouts de localizador*: no garantiza el techo de 90 s — descartado.
- *Timeout por fase sin techo global*: podría exceder 90 s en agregado — descartado.

## R7. Formato de logs (FR-010, Principio VII)

**Decision**: una línea por intento en consola con campos fijos:
`ISO-timestamp | tipo | plato | resultado | motivo(opcional)`, siendo `resultado` ∈
`éxito|fallo` y motivos tipados (`imagen-faltante`, `texto-vacio`, `texto-largo`,
`config-invalida`, `sesion-no-disponible`, `timeout`, `error-interfaz`,
`error-red`). Especificación completa en
[contracts/log-format.md](./contracts/log-format.md). Solo consola — el spec no pide
persistencia en archivo (el entity «Registro de publicación» se materializa en estos
registros).

**Rationale**: SC-005 exige 100% de intentos registrados con resultado y motivo; campos
fijos permiten verificarlo con un grep en quickstart sin dependencias de logging.

**Alternatives considered**:
- *Winston/pino + archivos*: añade dependencias y artefactos no pedidos (código sombra)
  — descartado.
- *JSON por línea*: válido pero menos legible para «saber qué pasó sin ser experto
  técnico» (US3) — se mantiene el formato pipe legible.

## R8. Semántica de agendamiento: serialización, backfill e intervalo

**Decision**: `node-cron` registra **solo** las ocurrencias futuras de cada `cron` de
`menu.json` al arrancar ⇒ los horarios ocurridos mientras el proceso estaba caído
**nunca se ejecutan** (sin lógica de backfill — coincide con la clarificación de
sesión). Un **mutex global** (`isPublishing`) + cola simple garantizan: (a) cero
publicaciones concurrentes aunque dos crons coincidan (FR-013); (b) entre
publicaciones consecutivas se inserta `publishIntervalSeconds` de espera (FR-015); (c)
un intento en curso no bloquea el siguiente horario más allá de ese solape controlado
(edge case «dos horarios coinciden»). Mismo intento jamás se reintenta (Assumptions).

**Rationale**: `node-cron` dispara por diseño solo ocurrencias futuras tras registrar el
job — el requisito «omitir perdidos» se cumple por construcción, sin código extra. El
mutex es la forma más simple de satisfacer FR-013 + FR-011 a la vez.

**Alternatives considered**:
- *Volver a evaluar crons vencidos al arranque y publicarlos*: viola la clarificación —
  descartado.
- *Bull/Redis u otras colas*: infraestructura externa desproporcionada para 1 operador
  — descartado.
- *`setTimeout` encadenados en vez de cron*: perdería la recurrencia semanal diaria de
  FR-004 — descartado.

## R9. Seguridad de la sesión (FR-016, Principio I/IV)

**Decision**: `session/` se agrega a `.gitignore` (nunca se versiona); al arrancar el
proceso se verifica/aplica `chmod 700` sobre `session/` (y `600` sobre archivos
sensibles internos si el FS lo permite, en Windows se documenta que el control lo da el
perfil de usuario). El contenido de `session/` nunca se loguea ni se copia. Comprobación
automatizable: test de contrato que afirma que `.gitignore` contiene `session/`.

**Rationale**: la carpeta equivale a la cuenta de WhatsApp; la clarificación de sesión y
los Principios I/IV la tratan como credencial.

**Alternatives considered**:
- *Cifrado en reposo del perfil*: innecesariamente complejo para una máquina personal —
  descartado (permisos + gitignore bastan).
- *No hacer nada*: riesgo de fuga de credenciales — descartado.

## R10. Validación de contenido previa (FR-005/006/007 + edge cases)

**Decision**: validación en dos niveles, antes de invocar al bot:
1. **Config** (`lib/config.js`): JSON válido + esquema AJV ⇒ si falla, error claro e
   inmediato y **cero** publicaciones (edge case del spec). Referencia cruzada:
   todo `dishIds` debe existir en `dishes` (vínculo inequívoco, FR-005).
2. **Plato** (por intento): imagen existe y es legible (`fs.access(R_OK)`, tamaño > 0);
   texto (nombre/precio/descripción/CTA) no vacío tras `trim`; **longitud total del
   mensaje ≤ 1024 caracteres** (límite de pie de foto de Estados de WhatsApp; valor
   confirmado como constante `MAX_STATUS_TEXT_LENGTH` para que el spec's «límite que la
   plataforma admite» sea comprobable). Cualquier fallo ⇒ log con motivo + omisión +
   continuidad con los pendientes.

**Rationale**: SC-003 exige cero Estados rotos; el límite de 1024 evita el truncamiento
que el edge case prohíbe.

**Alternatives considered**:
- *Validar solo al cargar la config*: insuficiente (la imagen puede borrarse después) —
  se valida también por intento.
- *Dejar el límite a Playwright*: WhatsApp lo recortaría silenciosamente — descartado.

---

## Necesidades de investigación: estado

| Origen | Estado |
|--------|--------|
| Technical Context `Testing` (NEEDS CLARIFICATION) | Resuelto → R1 |
| Dependencia Playwright (best practices) | Resuelto → R2, R4, R6 |
| Dependencia node-cron (best practices) | Resuelto → R8 |
| Integración WhatsApp Web (selectores/DOM) | Resuelto → R4 |
| Formato de config y sintaxis de horarios | Resuelto → R5 |
| Seguridad de sesión | Resuelto → R9 |
| Validación de assets/textos y límite de texto | Resuelto → R10 |
| Formato de logs | Resuelto → R7 |
| Backfill/serialización/intervalo | Resuelto → R8 |

**0 NEEDS CLARIFICATION pendientes.**
