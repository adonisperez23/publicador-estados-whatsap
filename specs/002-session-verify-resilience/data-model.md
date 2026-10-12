# Phase 1 Data Model: Diagnóstico y Resiliencia de la Verificación de Sesión de WhatsApp Web

**Branch**: `002-session-verify-resilience` | **Date**: 2026-10-11
**Input**: [spec.md](./spec.md) (Key Entities + Clarifications), [research.md](./research.md)

Contrato de verificación y comando manual:
[contracts/verification-contract.md](./contracts/verification-contract.md).
Esquema del resumen de diagnóstico:
[contracts/diagnostics.schema.json](./contracts/diagnostics.schema.json).

> Las entidades **Plato** y **Horario de publicación** y su máquina de estados de
> publicación **no cambian** en este feature (alcance: verificación de sesión y su
> diagnóstico — Assumptions del spec). El contrato de configuración se amplía con un
> único campo nuevo, ver abajo.

---

## Entidad: Configuración de verificación (campo de `menu.json`)

Ajuste del ciclo que indique el orquestador (Principio II).

| Campo | Tipo | Reglas | Origen |
|-------|------|--------|--------|
| `sessionVerifyTimeoutSeconds` | número ≥ 1, **sin máximo** | opcional; default **30**; ausente ⇒ default sin aviso; presente e inválido (no numérico, no finito o < 1) ⇒ default **30 + aviso en consola**, nunca `config-invalida` | FR-006, US4 AC2/AC3, research R2 |

**Validación**: sanitización previa a AJV en `lib/config.js` (el valor que llega al
esquema siempre es válido); la propiedad se añade a
`specs/001-whatsapp-status-automator/contracts/menu-config.schema.json` como opcional
(`type: number`, `minimum: 1`, `default: 30`) — el esquema vigente usa
`additionalProperties: false`. **Sin `maximum`**: el valor del orquestador se aplica
tal cual (edge case «valor absurdo»); el valor efectivo se informa en la línea de
arranque (SC-003).

## Entidad: Resultado de verificación de sesión

Dictamen devuelto por `verifySession` (navegador → orquestador).

| Campo | Tipo | Valores / Reglas | Origen |
|-------|------|------------------|--------|
| `autenticado` | boolean | `true` ⇒ no hay `causa` ni evidencia requerida | FR-001 |
| `causa` | enum, solo si `autenticado=false` | `sesion-caducada` \| `interfaz-no-cargo-a-tiempo` \| `cambio-interfaz` \| `error-red` — **exactamente una** (exclusivas) | FR-004, SC-001, Clarificación 2 |
| `detalle` | string | texto humano adicional (tiempo aplicado, «navegador no disponible: …», error de red concreto) | FR-005, edge case arranque |
| `esperaAplicadaMs` | entero ≥ 1 | el valor efectivo del orquestador (tras sanitización), **sin clamp** interno | FR-006, SC-003 |
| `duracionMs` | entero ≥ 0 | tiempo real empleado (≤ `esperaAplicadaMs` en todo momento, salvo fallo rápido de red/arranque) | FR-013, SC-007 |
| `observacion` | objeto | `url`, `readyState`, `senalQr`, `indicadores[]` (nombre + `presente`) — insumo del resumen | FR-007 |
| `evidencia.captura` | Buffer \| `null` | PNG de la página **antes** de cerrar el contexto; `null` si no hay página (fallo de arranque) | FR-007/009, edge case arranque |
| `evidencia.resumen` | objeto | datos estructurales para `summary.json` (deriva de `observacion` + causa + espera) | FR-007 |

**Invariante de privacidad**: ni `observacion` ni `resumen` contienen cuerpos de
mensajes, nombres de contactos ni bytes de `session/` (FR-008). La **captura** sí puede
mostrar la interfaz completa visible (Clarificación 1) y jamás sale de la máquina.

## Entidad: Indicador de autenticación

Señal estable alternativa; el conjunto tiene **≥ 3** entradas (FR-001).

| Campo | Tipo | Reglas | Origen |
|-------|------|--------|--------|
| `nombre` | string | identificador estable del indicador (p. ej. `chat-icon`, `nav-sidebar`, `status-tab`) | FR-007 |
| `selector` | string | solo atributos semánticos: `data-icon`, `role`, `aria-*`; encapsulado en `whatsappBot.js` | FR-002, Principio V |
| `presente` | boolean | evaluado en cada pasada de sondeo; **basta uno** para autenticar | FR-001, SC-002 |

**Relación**: `Resultado.observacion.indicadores` = instantánea del conjunto al momento
de decidir (o al vencer la espera). La señal de QR (`senalQr`) se modela igual pero con
semántica de pantalla de emparejamiento (R1/R3).

## Entidad: Artefacto de diagnóstico

Evidencia local de **un** fallo de verificación.

| Campo | Tipo | Reglas | Origen |
|-------|------|--------|--------|
| `id` | string | `verification-<timestamp ISO>` con caracteres seguros; **único** por fallo (varios fallos ⇒ varias carpetas, no se pisan) | edge case «fallos consecutivos» |
| `screenshot.png` | fichero | captura completa de la interfaz visible tal como se ve (incluso autenticada); ausente si no hay página | FR-007/009, Clarificación 1 |
| `summary.json` | fichero | resumen estructural conforme a [contracts/diagnostics.schema.json](./contracts/diagnostics.schema.json): `timestamp`, `causa`, `esperaAplicadaMs`, `duracionMs`, `pagina{url,readyState}`, `senalQr`, `indicadores[]`, `captura` | FR-007 |

**Restricciones**: dentro de `diagnostics/` (auto-creado, **gitignored**, jamás
transmitido — FR-008); retención a cargo del operador (Assumptions); un error de
escritura no altera la causa original del fallo (FR-010); no se crean artefactos en el
éxito.

**Relaciones**: 1 resultado fallido ⇒ 1 artefacto (1:1). El motivo de log y el mensaje
de consola referencian la misma causa que el `summary.json`.

## Entidad: Sesión de WhatsApp (actualización de la 001)

| Estado | Representación | Reglas | Origen |
|--------|----------------|--------|--------|
| `no-existe` | falta `session/` | aborto de configuración en `index.js` (previo a la verificación); sin QR | edge case spec, FR-011 |
| `vigente` | perfil autenticado | la verificación la reconoce con cualquier indicador | FR-001 |
| `caducada` | perfil presente pero WhatsApp pide QR | solo `login.js` (manual) puede re-linkarla | FR-011/012 |

**Transiciones**:

```text
[no-existe] --(login.js, fuera del ciclo, escanea QR)--> [vigente]
[vigente]   --(WhatsApp invalida la sesión)--> [caducada]
[caducada]  --(detectada en arranque del ciclo)--> abort con causa sesion-caducada
             (el ciclo NUNCA pide QR: FR-011, Principio I)
[caducada]  --(login.js: QR escaneado)--> [vigente]
[vigente]   --(login.js con confirmación explícita)--> limpia perfil --> [no-existe]
             --(login.js: QR escaneado)--> [vigente]
```

## Máquina de estados: verificación de sesión (al arranque)

```text
INICIO (espera efectiva T = sessionVerifyTimeoutSeconds·1000, headless)
   │
   ├─ chromium no arranca ──────────────────────► FALLO (interfaz-no-cargo-a-tiempo,
   │                                               detalle «navegador no disponible»,
   │                                               sin captura — solo resumen)
   ▼
NAVEGANDO (goto WhatsApp Web, sin clamp de 30 s)
   │ ├─ error de red (net::ERR_*, DNS, rechazo) ► FALLO (error-red — falla rápido,
   │ │                                              no gasta el plazo completo)
   ▼
SONDEANDO (cada ≈250 ms, hasta T INCLUSIVE)
   │ ├─ ¿algún indicador autenticado? ──────────► AUTENTICADO (retorno inmediato;
   │ │                                              el favorable prevalece hasta T)
   │ ├─ ¿pantalla de QR/emparejamiento? ────────► FALLO (sesion-caducada — detectada
   │ │                                              cuanto aparece)
   │ └─ T vencido:
   │      ├─ interfaz observable (readyState ≠ loading, sin error de red)
   │      │        sin indicadores ─────────────► FALLO (cambio-interfaz)   ◄ Clarificación 2
   │      └─ interfaz NO observable ────────────► FALLO (interfaz-no-cargo-a-tiempo)
   ▼
FALLO ⇒ captura + resumen (evidencia, antes de cerrar contexto)
      ⇒ index.js persiste artefactos (error de escritura ⇒ aviso, causa intacta)
      ⇒ línea `sistema | - | fallo | <motivo>` + mensaje de operador + exit ≠ 0
```

**Garantías**: toda rama termina dentro de `T` (FR-013, SC-007); el `finally` cierra
siempre el contexto (sin chromium huérfano); el motivo de log sale del mapeo de
research R3 sin ampliar el enum.

## Mapeo causa → motivo de log → mensaje (resumen)

Detalle completo y plantillas en
[contracts/verification-contract.md](./contracts/verification-contract.md):

| Causa (spec) | `causa` interna | Motivo de log | Acción sugerida al operador |
|--------------|-----------------|---------------|-----------------------------|
| Sesión caducada | `sesion-caducada` | `sesion-no-disponible` | relinkar con `npm run login` |
| Interfaz no cargó a tiempo | `interfaz-no-cargo-a-tiempo` | `timeout` | revisar conexión / subir la espera |
| Cambio de interfaz | `cambio-interfaz` | `error-interfaz` | revisar indicadores (evidencia en `diagnostics/`) |
| Error de red | `error-red` | `error-red` | revisar conectividad |
| (carpeta `session/` ausente — previo a verificar) | — | `sesion-no-disponible` | vincular sesión por primera vez con `npm run login` |

## Reglas de validación resumidas (mapeo FR → regla)

| FR | Regla en el modelo |
|----|--------------------|
| FR-001 | conjunto de indicadores ≥ 3; autenticado si `presente` de cualquiera |
| FR-002 | `selector` solo `data-icon`/`role`/`aria-*` |
| FR-003 | retorno inmediato en la primera pasada con indicador |
| FR-004 | `causa` enum exclusivo de 4 + regla de desempate (interfaz observable ⇒ cambio) |
| FR-005 | campo `detalle` + plantillas de mensaje del contrato |
| FR-006 | `sessionVerifyTimeoutSeconds` sanitizado, sin `maximum`, valor efectivo informado |
| FR-007 | `observacion` + `evidencia` en todo fallo; captura antes de cerrar contexto |
| FR-008/009 | resumen estructural sin contenido; captura completa solo local; `diagnostics/` gitignored |
| FR-010 | error de escritura ⇒ aviso aparte; `causa` intacta |
| FR-011 | verificación headless + `login.js` entry aparte; `index.js` no importa QR |
| FR-012 | contrato CLI de `login.js` (negar si daemon corre; confirmar si sesión válida) |
| FR-013 | todas las rutas ≤ `esperaAplicadaMs`; `finally` cierra contexto |
| FR-014 | línea `sistema … fallo <motivo>` por cada fallo (enum sin ampliar) |
