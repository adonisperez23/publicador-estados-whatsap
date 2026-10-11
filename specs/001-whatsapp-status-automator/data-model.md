# Phase 1 Data Model: Automatizador de Estados de WhatsApp Business

**Branch**: `001-whatsapp-status-automator` | **Date**: 2026-10-11
**Input**: [spec.md](./spec.md) (Key Entities + Clarifications), [research.md](./research.md)

Contrato formal de la configuración: [contracts/menu-config.schema.json](./contracts/menu-config.schema.json).
Formato de registro: [contracts/log-format.md](./contracts/log-format.md).

---

## Entidad: Configuración (`menu.json`, raíz)

Instancia única cargada al arranque por `lib/config.js`. No es una entidad de negocio
pero modela los ajustes globales.

| Campo | Tipo | Regla | Origen |
|-------|------|-------|--------|
| `publishIntervalSeconds` | entero ≥ 0 | espera entre publicaciones consecutivas; default 60 | FR-015 |
| `attemptTimeoutSeconds` | entero 1–90 | techo de cada intento; default 90, **nunca > 90** | FR-008 |
| `dishes[]` | lista de Plato | ≥ 1 elemento | FR-003 |
| `schedules[]` | lista de Horario | ≥ 1 elemento; si el array está vacío el sistema queda en espera silenciosa | edge case «sin horarios» |

**Validación (nivel config)**: JSON parseable + esquema AJV ⇒ si falla: log
`config-invalida`, **cero** publicaciones y salida con error claro e inmediato
(edge case del spec). Regla semántica adicional (no expresable en JSON Schema estándar):
todo `schedule.dishIds[x]` MUST existir en `dishes[].id` — si no, `config-invalida`.

## Entidad: Plato

Un plato del menú a publicar.

| Campo | Tipo | Reglas de validación | Origen |
|-------|------|----------------------|--------|
| `id` | string, patrón `^[a-z0-9][a-z0-9-]*$` | **único** en `dishes[]` (identidad) | FR-005 (vínculo inequívoco) |
| `image` | string (nombre de archivo) | existe y es legible en `assets/`, tamaño > 0 — validado **por intento**, no solo al cargar | FR-006, edge case imagen |
| `name` | string | `trim()` no vacío | FR-006 |
| `price` | string | `trim()` no vacío | FR-006, US3 AC2 |
| `description` | string | `trim()` no vacío | FR-006 |
| `cta` | string | `trim()` no vacío | FR-001 |

**Regla de composición**: el mensaje final (nombre + precio + descripción + cta, con
separadores fijos) MUST tener **≤ 1024 caracteres**; si no, se omite con motivo
`texto-largo` (edge case «límite de caracteres»; constante
`MAX_STATUS_TEXT_LENGTH = 1024`, ver research.md R10).

**Relaciones**: pertenece a uno o más Horarios (N:M, mediada por `schedule.dishIds`).

**Unicidad de imagen↔texto**: el vínculo es exclusivamente por `id`; nunca por nombre
de plato ni por orden de aparición (FR-005, Principio III). Emparejamiento ambiguo =
`config-invalida`.

## Entidad: Horario de publicación

Ventana temporal en la que se dispara una difusión.

| Campo | Tipo | Reglas | Origen |
|-------|------|--------|--------|
| `cron` | string, 5 campos (`m h dom mon dow`) | zona horaria local de la máquina; debe parsear con `node-cron` | FR-004, Assumption zona horaria |
| `dishIds[]` | array de string, `uniqueItems` | ≥ 1; cada entrada existe en `dishes[].id` | FR-001 (multi-plato), FR-005 |

**Relaciones**: referencia a 1..n Plato. Un mismo plato puede estar en varios horarios.

**Semántica de disparo** (research.md R8):
- Solo ocurrencias **futuras** registradas al arranque ⇒ horarios vencidos mientras el
  proceso estaba caído **se omiten** (Clarificación 1; no existe estado «atrasado»).
- Un cron ⇒ 1 **tanda**; dentro de la banda, los platos se procesan **secuencialmente**
  con `publishIntervalSeconds` entre cada uno (FR-001 «uno tras otro», FR-015).
- La ejecución de una banda NO reintenta jamás tras fallo (Assumptions); el siguiente
  horario reanuda (FR-011).

## Entidad: Registro de publicación

Constancia de cada intento. **Solo vive en la salida de consola** (FR-010 no pide
persistencia en disco).

| Campo | Tipo | Valores | Origen |
|-------|------|---------|--------|
| `timestamp` | ISO-8601 local | — | FR-010 |
| `tipo` | enum | `intento` \| `omision` \| `sistema` | FR-006, FR-010 |
| `plato` | string | `id` del plato (o `-` para eventos de sistema) | FR-010 |
| `resultado` | enum | `exito` \| `fallo` | Key Entity «Registro» |
| `motivo` | enum, opcional | `imagen-faltante`, `texto-vacio`, `texto-largo`, `config-invalida`, `sesion-no-disponible`, `timeout`, `error-interfaz`, `error-red` | edge cases + Clarificación 5 |

**Cobertura (SC-005)**: el 100% de los intentos genera **exactamente una** línea —
tanto `exito` como `fallo` como `omision` (una omisión de validación también es
trazable, exige US3). Especificación exacta: [contracts/log-format.md](./contracts/log-format.md).

## Entidad: Sesión de WhatsApp

Estado autenticado del operador que permite publicaciones desatendidas.

| Campo | Representación | Reglas | Origen |
|-------|----------------|--------|--------|
| Perfil Chromium | directorio `session/` | persistente entre ejecuciones; **gitignored**; `chmod 700` al arranque | FR-002, FR-016, Principios I/IV |
| Estado de auth | derivado del DOM (selector estable) | autenticado ⇒ publicar; no autenticado ⇒ log `sesion-no-disponible` + abort, **nunca** QR en ciclo automatizado | FR-014, Clarificación previa |

**Transiciones de estado**:

```text
[no-existe | no-autenticado] --(QR manual, fuera del ciclo)--> [autenticado]
[autenticado] --(caducó / detectado en arranque)--> [no-autenticado] => aborta ejecución
[autenticado] --(OK)--> se reutiliza en todas las publicaciones del día
```

## Máquina de estados: intento de publicación (por plato)

```text
PROGRAMADO (cron dispara)
   │  (mutex global libre; si ocupado → espera en cola; cero concurrencia FR-013)
   ▼
VALIDANDO ── fallo de validación ──► OMITIDO ──► (log omision + motivo) ──► fin
   │ ok
   ▼
PUBLICANDO (bot Playwright, presupuesto ≤ attemptTimeoutSeconds)
   │                                │
   │ ok                             ├─ timeout ─────────► FALLADO (motivo timeout)
   │                                ├─ DOM/selector ────► FALLADO (motivo error-interfaz)
   │                                ├─ red ─────────────► FALLADO (motivo error-red)
   ▼                                ▼
EXITO (log exito)             fin — finally libera recursos (FR-009);
                              el siguiente horario se intenta igual (FR-011)
```

Notas:
- El presupuesto de tiempo cubre **todo** el intento desde `VALIDANDO` (research.md R6).
- Un fallo **nunca** transiciona a reintentos: cada PROGRAMADO se consume una sola vez
  (Assumptions).
- Coincidencia de horarios: el mutex serializa ⇒ las tandas se ejecutan una tras otra,
  respetando también el intervalo entre publicaciones consecutivas (Clarificación 3).

## Reglas de validación resumidas (mapeo FR → regla)

| FR | Regla en el modelo |
|----|--------------------|
| FR-001 | banda secuencial, 1 Estado por plato |
| FR-002 / FR-014 | sesión persistente; estado no-autenticado ⇒ abort |
| FR-003 / FR-004 | todo en `menu.json` (esquema del contrato) |
| FR-005 | `id` único + cross-ref `dishIds` ⇒ si no, `config-invalida` |
| FR-006 / FR-007 | validación por intento de imagen/texto; ningún campo vacío llega al bot |
| FR-008 | `attemptTimeoutSeconds` ≤ 90 |
| FR-009 | `finally` en cada intento |
| FR-010 / SC-005 | 1 línea de log por intento, enum de motivos cerrado |
| FR-011 | fallo no bloquea el siguiente PROGRAMADO |
| FR-013 | mutex global de banda |
| FR-015 | `publishIntervalSeconds` entre publicaciones consecutivas |
| FR-016 | `.gitignore` + `chmod 700` sobre `session/` |
