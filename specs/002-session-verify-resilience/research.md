# Phase 0 Research: Diagnóstico y Resiliencia de la Verificación de Sesión de WhatsApp Web

**Branch**: `002-session-verify-resilience` | **Date**: 2026-10-11
**Input**: [spec.md](./spec.md), [.specify/memory/constitution.md](../../.specify/memory/constitution.md)

Todos los puntos abiertos del Technical Context y las dependencias/integraciones del
spec quedan resueltos aquí. Formato por hallazgo: **Decision / Rationale /
Alternatives considered**. El contexto heredado (stack, testing, selectores) se apoya en
research.md R1–R10 del feature 001.

---

## R1. Detección multi-indicador de sesión autenticada (FR-001/002/003)

**Decision**: `whatsappBot.js` mantiene un conjunto **frozen** de al menos tres
indicadores alternativos de la interfaz autenticada, todos sobre atributos estables:
`[data-icon="chat"]`, `div[role="navigation"]` (barra lateral) y `[data-icon="status"]`
(entrada de Estados del panel logueado). La verificación ejecuta un **bucle de sondeo**
corto (≈250 ms) hasta el instante límite: en cada pasada evalúa **todos** los
indicadores; si **cualquiera** está visible ⇒ autenticada y retorno **inmediato**
(FR-003, sin agotar la espera). El resultado expone qué indicador/es respondieron
(estado por indicador presente/ausente) para el resumen de diagnóstico.

**Rationale**: la regla «basta uno» elimina el falso negativo por cambio menor del DOM
(US1, SC-002 — ocultar cada indicador por turnos sigue detectando sesión). El sondeo
continuo es la única forma de resolver «tan pronto como se detecte» (FR-003) y de que
el resultado favorable prevalezca hasta el instante límite (edge case «justo al
agotar»). El Principio V exige atributos estables: `data-icon`, `role` y aria son los
mismos que ya usa el flujo de publicación. La lista concreta se confirma empíricamente
contra el DOM real antes de fijarla (Principio V: cambiar solo ante cambio observado).

**Alternatives considered**:
- *Un único indicador (estado actual)*: es exactamente el bug reportado — descartado.
- *`page.waitForSelector` de un solo selector con `Promise.any` encadenados*: no deja
  huella de qué indicadores fallaron (FR-007 exige el estado de cada uno) — descartado
  a favor del sondeo con observación completa.
- *Visión por computadora / screenshots para decidir*: no determinista y
  sobredimensionado — descartado (igual que research R4 del feature 001).

## R2. Configuración del tiempo de espera (FR-006, US4, SC-003)

**Decision**: nuevo campo opcional `sessionVerifyTimeoutSeconds` en `menu.json`
(número ≥ 1, **sin máximo**), gestionado por `lib/config.js`:

1. **Sanitización previa a AJV**: si el valor está presente y no es un número finito ≥ 1
   ⇒ se sustituye por el default **30 s** y se emite un aviso en consola (stderr);
   si está ausente ⇒ default 30 s sin aviso (AJV lo rellena con `default`).
2. **Sin tope superior** en el esquema (a diferencia de `attemptTimeoutSeconds`): el
   valor del orquestador se aplica tal cual (edge case «valor absurdo»).
3. El valor efectivo se informa siempre en la línea de arranque de la verificación y
   se incluye en el mensaje de fallo por espera («espera aplicada: X ms»).

El esquema vigente `specs/001-whatsapp-status-automator/contracts/menu-config.schema.json`
se extiende con la propiedad opcional (usa `additionalProperties: false`, no admite
campos desconocidos).

**Rationale**: la constitución (Principio II) y el spec exigen configuración externa ya
usada por el orquestador; `menu.json` es la fuente única existente, ya validada con
AJV y con defaults (`publishIntervalSeconds`, `attemptTimeoutSeconds`) — seguir ese
patrón es lo de menor fricción. Sanitizar **antes** de AJV cumple FR-006 («inválido ⇒
default + constancia», **no** abortar como `config-invalida`) sin relajar el esquema
para el resto de campos.

**Alternatives considered**:
- *Variable de entorno (`SESSION_VERIFY_TIMEOUT`)*: permitida por la constitución, pero
  crea una segunda fuente de verdad junto a `menu.json` y sale del contrato AJV
  existente — descartada (se puede añadir después sin romper nada).
- *Flag CLI (`node index.js --verify-timeout`)*: el que indica el valor es el
  orquestador, no un usuario humano por invocación — descartado.
- *Dejar el clamp actual de 30 s*: es la causa del bug (FR-006 lo prohíbe
  explícitamente) — descartado.

## R3. Árbol de clasificación de las cuatro causas (FR-004/005, US2, SC-001)

**Decision**: función **pura** `classifyVerification(observación)` — testeable sin
navegador — aplicada por `whatsappBot.js` sobre un conjunto de observaciones tomadas
durante el sondeo. Orden de decisión:

1. **Navegación con error de red** (`net::ERR_*`, DNS, conexión rechazada al hacer
   `goto`) ⇒ **`error-red`** (no espera el plazo completo: falla rápido).
2. **Algún indicador autenticado visible** (en cualquier pasada, hasta el instante
   límite inclusive) ⇒ **autenticado** (éxito; el favorable siempre prima).
3. **Pantalla de QR/emparejamiento visible** (señal estable del bloque de emparejamiento,
   ver R1) ⇒ **`sesion-caducada`** (detectada cuanto aparece, sin esperar el plazo).
4. Al vencer el plazo: **la interfaz pudo observarse** (DOM listo: `readyState` ≠
   `loading`, sin error de navegación) pero sin indicadores ⇒ **`cambio-interfaz`**
   (regla de desempate de la Clarificación 2: la carga completada prima sobre la
   expiración); **no** pudo observarse (carga a medias o espera agotada en navegación)
   ⇒ **`interfaz-no-cargo-a-tiempo`**.
5. **Fallo de arranque del navegador** (chromium no disponible) ⇒ clasificado como
   **`interfaz-no-cargo-a-tiempo`** con detalle «navegador no disponible: <error>» y
   captura imposible (edge case del spec: se produce el resumen con el error).

El mapeo a motivos de log (enum **sin ampliación**, Assumption del spec):
`sesion-caducada` ⇒ `sesion-no-disponible`, `interfaz-no-cargo-a-tiempo` ⇒ `timeout`,
`cambio-interfaz` ⇒ `error-interfaz`, `error-red` ⇒ `error-red`.

**Rationale**: «interfaz pudo observarse» = `readyState !== 'loading'` es el criterio
operativo de «la página terminó de cargar»: WhatsApp Web puede no alcanzar
`readyState === 'complete'` por recursos continuos, y lo que la causa (b)/(c) necesita
saber es si el DOM fue visible para buscar indicadores. El árbol respeta el edge case
«prevalece la causa que impidió observar la interfaz» y la regla de desempate
explicitada en FR-004. La función pura permite probar las cuatro causas en unitarias
con observaciones sintéticas (SC-001).

**Alternatives considered**:
- *Clasificar por el mensaje de la excepción de Playwright*: opaco y cubre solo 2 de 4
  causas — descartado (se conserva el regex de red de `classify()` como paso 1).
- *Esperar siempre el plazo antes de clasificar*: retrasa el aborto de «caducada» y
  «error de red» sin aportar información — descartado.
- *Ampliar el enum de motivos con una causa propia de lanzamiento*: rompería el
  contrato de log vigente del feature 001 sin necesidad (el detalle vive en el mensaje
  de consola y en el resumen) — descartado.

## R4. Artefactos de diagnóstico (FR-007/008/009/010, US3, SC-004)

**Decision**: ante cada fallo de verificación, el directorio `diagnostics/` (auto-creado,
gitignored) recibe una carpeta `verification-<timestamp ISO con caracteres seguros>/`
con exactamente dos ficheros:

- `screenshot.png`: captura de la página **tal como se ve**, incluida la interfaz
  autenticada si estaba visible (Clarificación 1), tomada **antes** de cerrar el
  contexto. Si no hay página (fallo de arranque), no se crea.
- `summary.json`: **estructural** — timestamp, causa, espera aplicada, duración, URL y
  `readyState` de la página, estado de cada indicador (presente/ausente) y señal de QR;
  validado por [contracts/diagnostics.schema.json](./contracts/diagnostics.schema.json).
  **Nunca** contiene cuerpos de mensajes, contactos, credenciales ni nada leído de
  `session/` (FR-008, SC-004).

El navegador (que posee la página) captura la evidencia y la devuelve en el resultado
de `verifySession`; **`index.js` la persiste** mediante `lib/diagnostics.js` (fs puro).
Cualquier error de escritura se captura y se registra por consola **sin** alterar la
causa original (FR-010). Retención: a cargo del operador, sin purga automática
(Assumption del spec).

**Rationale**: separar «capturar» (navegador) de «persistir» (fs puro) mantiene el
Principio IV — `lib/diagnostics.js` se prueba con un directorio temporal sin Playwright
— y cumple que la evidencia exista **antes** de `closeQuietly` (FR-007 «de inmediato»,
SC-004 ≤ 5 s). El resumen estructural, no un volcado del DOM: un snapshot HTML completo
sí contendría texto de mensajes y violaría FR-008.

**Alternatives considered**:
- *Solo log de consola sin captura*: es el estado actual y el spec lo rechaza
  («no queda evidencia de qué mostró el navegador») — descartado.
- *Subir artefactos a un servicio/almacenamiento remoto*: viola FR-008 (solo local,
  nunca transmitido) — descartado.
- *Volcado del DOM completo (`page.content()`)*: incluiría contenido de la sesión —
  descartado por FR-008.
- *Un único fichero JSON con la imagen en base64*: menos diagnóstico manual (hay que
  decodificar) y ficheros enormes — descartado.

## R5. Comando manual y detección del daemon (FR-012, US5, Clarificación 3)

**Decision**: nuevo entry point **`login.js`** + script npm `"login": "node login.js"`,
con este orden de comprobaciones:

1. **Daemon en marcha** ⇒ **negarse** con mensaje «el daemon está en marcha» y salir
   con código ≠ 0 **sin tocar la sesión** (Clarificación 3). Detección: `index.js`
   escribe `.daemon.pid` (pid en claro) al arrancar y lo borra en su salida (`exit`/
   `SIGINT`/`SIGTERM`); `login.js` verifica que el proceso existe con
   `process.kill(pid, 0)` y limpia el fichero si está obsoleto (pid reciclado/inexistente).
2. **Sesión válida** ⇒ informar «no es necesaria la vinculación» y pedir confirmación
   explícita (readline `y/N`) antes de re-linkar; sin confirmación ⇒ salir sin alterar
   nada (FR-012). Confirmada la intención ⇒ se archiva/limpia el perfil `session/` (paso
   explícitamente confirmado) para volver a un estado de vinculación.
3. **Sesión caducada/no vinculada** ⇒ abrir contexto persistente **headful**, mostrar
   el QR, esperar el escaneo con espera explícita de **5 minutos** (Principio VII: nada
   indefinido; se reintentará con otra invocación) y cerrar limpiamente; al terminar,
   `session/` queda lista para el ciclo.

`index.js` **nunca** invoca `login.js` ni muestra QR (FR-011); el comando solo existe
como flujo manual documentado en [quickstart.md](./quickstart.md).

**Rationale**: el pidfile es el mecanismo más simple para la regla de concurrencia pedida
(sin dependencias, funciona en las tres plataformas) y su obsolescencia se resuelve con
la comprobación de vida del proceso. Entrada separada de `node index.js --login` deja el
ciclo automatizado intocable y testeable de forma independiente. Borrar el perfil solo
tras confirmación es la vía más directa de mostrar un QR partiendo de una sesión válida
(volver al estado de vinculación), evitando automatizar el menú «Log out» de WhatsApp
Web, que sería frágil contra el Principio V.

**Alternatives considered**:
- *Flag `--login` de `index.js`*: mezcla el flujo manual con el entry del ciclo y
  obliga a ramificar `main()` — descartado (mayor riesgo de regresión FR-011).
- *Detección por puerto/socket o librería de lockfiles*: infraestructura/mayor
  complejidad de lo que pide una regla binaria de concurrencia — descartado.
- *Automatizar «Log out» por menú de WhatsApp Web para re-linkar sesión válida*:
  selectors de menú frágiles (Principio V) — descartado.

## R6. Modo de lanzamiento de la verificación: headless (FR-011, Principio I)

**Decision**: `verifySession` pasa a lanzar el contexto en modo **headless** con
normalización del `User-Agent` (eliminando la marca `HeadlessChrome`); `publishStatus`
y `login.js` siguen **headful** (como hasta hoy). La verificación, además, cierra el
contexto en cuanto clasifica (ya sea éxito o fallo).

**Rationale**: FR-011 prohíbe **mostrar** un QR dentro del ciclo «sin importar el
resultado de la verificación». Con contexto headful, una sesión caducada renderizaría
la pantalla de QR en una ventana visible durante los segundos de detección — violación
literal. Headless garantiza que el ciclo jamás pinte un QR en pantalla, además de ser
más rápido y apto para entornos sin soporte gráfico (edge case «navegador no puede
iniciarse» se reduce). La normalización del UA evita que WhatsApp Web trate el
navegador como «no soportado»; la evidencia contra el DOM real queda en quickstart S4.

**Alternatives considered**:
- *Mantener headful y confiar en la detección rápida del QR*: la ventana con QR sería
  visible aunque fuera breve — viola FR-011 en lectura estricta — descartado.
- *Headful con ventana minimizada/ofuscada*: hack no determinista y sigue «mostrando»
  el QR al sistema — descartado.
- *Headless también en `publishStatus`*: fuera de alcance (el spec no pide cambiar la
  publicación) y el research 001 R2 justificó headful ahí — se mantiene.

## R7. Estructura y responsabilidades de módulos (Principio IV)

**Decision**:

- `whatsappBot.js` (navegador): `verifySession({ timeoutMs, ... })` devuelve
  `{ autenticado, causa?, detalle?, observacion, evidencia: { captura?, resumen } }`;
  concentra DOM, sondeo, clasificación (llama a la función pura) y captura de evidencia.
  `SELECTORS` gana los indicadores alternativos y la señal de QR (sigue encapsulado).
- `lib/diagnostics.js` (fs puro): `escribirArtefactos({ resumen, captura })` ⇒ ruta
  creada o lanza error controlado; nada de Playwright.
- `lib/config.js`: sanitización y default del nuevo campo (R2).
- `index.js` (orquestación): pasa la espera configurada, mapea
  causa ⇒ motivo/mensaje, escribe artefactos, emite el registro de sistema y los exit
  codes; gestiona `.daemon.pid`.
- `login.js` (manual): orquestación del flujo QR según R5, reutilizando
  `whatsappBot.js` para el navegador.

**Rationale**: conserva exactamente la separación que exige el Principio IV (DOM en el
bot, orquestación en `index.js`) y la regla de que ningún otro módulo conoce el DOM
(Principio V). La función pura de clasificación y el escritor de artefactos quedan
aislados para unitarias rápidas.

**Alternatives considered**:
- *Que `index.js` sondee el DOM*: viola Principio IV/V — descartado.
- *Que el navegador escriba los ficheros directamente*: acopla fs al módulo de navegador
  y complica el testeo — descartado a favor del retorno de evidencia.

## R8. Contrato de salida: mensajes, motivos y exit codes (FR-005/014, SC-001/006)

**Decision**: el enum de motivos de `lib/logger.js` **no se amplía** (Assumption del
spec). Cada fallo de verificación emite:

1. **Una línea de sistema** `<ts> | sistema | - | fallo | <motivo>` con el motivo mapeado
   (R3) — contrato de [log-format.md](../001-whatsapp-status-automator/contracts/log-format.md)
   intacto.
2. **Un mensaje en consola** con estructura fija:
   `<motivo>: <causa en lenguaje del operador> — <acción sugerida>` (p. ej.
   `sesion-no-disponible: sesión caducada — restablece la sesión con "npm run login"; nunca se pide login en el ciclo automatizado`), incluyendo la espera aplicada cuando la
   causa es `timeout`.
3. **Exit code ≠ 0** para cualquier causa (como hoy).

El detalle completo (plantillas de mensaje, campos del resultado, contrato del comando
manual e invariantes) vive en
[contracts/verification-contract.md](./contracts/verification-contract.md).

**Rationale**: SC-001 exige causa diferenciada en el 100 % de los fallos y SC-006
acceso en < 1 min; mantener el formato de log existente evita romper el contrato y los
tests del feature 001, y el mensaje de consola es el canal de «lenguaje del operador».

**Alternatives considered**:
- *Ampliar el enum con motivos propios (`sesion-caducada`, etc.)*: rompería
  `log-format.md` y los consumidores existentes sin necesidad (el mensaje de consola y
  el `summary.json` ya diferencian) — descartado; la planificación decide que **no** se
  requiere ampliar.
- *Solo mensaje de consola sin línea de log*: SC-001/FR-014 piden registro trazable —
  descartado.

---

## Necesidades de investigación: estado

| Origen | Estado |
|--------|--------|
| Detección autenticada multi-indicador (FR-001/002/003) | Resuelto → R1 |
| Configuración de la espera (FR-006, US4) | Resuelto → R2 |
| Clasificación de causas y mapeo a motivos (FR-004/005) | Resuelto → R3, R8 |
| Artefactos de diagnóstico (FR-007–010, US3) | Resuelto → R4 |
| Comando manual y concurrencia con el daemon (FR-012, US5) | Resuelto → R5 |
| Modo de lanzamiento y FR-011 | Resuelto → R6 |
| Responsabilidades de módulos (Principio IV) | Resuelto → R7 |
| Contrato de salida (SC-001/006, FR-014) | Resuelto → R8 |
| Dependencia Playwright (best practices: sondeo, headless, UA) | Resuelto → R1, R6 |
| Integración WhatsApp Web (indicadores/QR estables) | Resuelto → R1, R3 (confirmación empírica en quickstart) |

**0 NEEDS CLARIFICATION pendientes.**
