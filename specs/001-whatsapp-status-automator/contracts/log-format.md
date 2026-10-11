# Contract: Formato de registro en consola (FR-010, SC-005)

**Rama**: `001-whatsapp-status-automator` | **Fecha**: 2026-10-11
**Consumidor**: operador humano (US3) y verificación automatizable en quickstart.md.

## Línea de registro

Cada evento se emite como **una sola línea** en `stdout`/`stderr` con campos separados
por ` | ` (espacio-pipe-espacio):

```text
<timestamp> | <tipo> | <plato> | <resultado> | <motivo>
```

| Campo | Formato | Valores |
|-------|---------|---------|
| `timestamp` | ISO-8601 con offset local | ej. `2026-10-11T12:00:02-04:00` |
| `tipo` | enum fijo | `intento` · `omision` · `sistema` |
| `plato` | `id` del plato o `-` | `-` para eventos de sistema (arranque, config) |
| `resultado` | enum fijo | `exito` · `fallo` |
| `motivo` | enum fijo, solo si `resultado=fallo` o `tipo=omision` | ver abajo; `-` si no aplica |

**Motivos tipados**:

| Motivo | Cuándo | Origen |
|--------|--------|--------|
| `imagen-faltante` | imagen inexistente/ilegible/vacía en `assets/` | edge case imagen |
| `texto-vacío` | algún campo de texto vacío tras `trim` | FR-006 |
| `texto-largo` | mensaje compuesto > 1024 caracteres | edge case límite |
| `config-invalida` | JSON o esquema inválidos, o `dishIds` huérfanos | edge case config |
| `sesion-no-disponible` | sesión ausente/caducada al arrancar | FR-014 |
| `timeout` | intento superó `attemptTimeoutSeconds` (≤ 90 s) | FR-008, Clarificación |
| `error-interfaz` | selector/DOM de WhatsApp Web falló | edge case interfaz |
| `error-red` | fallo de red o WhatsApp Web muy lento (no timeout propio) | edge case red |

## Invariantes (verificables)

1. **SC-005**: cada intento programado produce exactamente **una** línea con
   `tipo=intento` y `resultado ∈ {exito, fallo}`; cada validación fallida produce una
   línea `tipo=omision`.
2. Toda línea con `resultado=fallo` o `tipo=omision` lleva `motivo` distinto de `-`.
3. Ninguna línea contiene información del contenido de `session/` (FR-016).
4. Los eventos de sistema usan `tipo=sistema` con `plato=-`.

## Ejemplos

```text
2026-10-11T12:00:02-04:00 | intento | pasta-carbonara | exito | -
2026-10-11T12:00:35-04:00 | omision | ensalada-cesar | fallo | imagen-faltante
2026-10-11T13:00:01-04:00 | intento | pizza-margherita | fallo | timeout
2026-10-11T08:00:00-04:00 | sistema | - | fallo | config-invalida
2026-10-11T08:00:00-04:00 | sistema | - | fallo | sesion-no-disponible
```

## Códigos de salida del proceso

| Situación | Exit code |
|-----------|-----------|
| Configuración inválida al arranque | ≠ 0 (cero publicaciones) |
| Sesión no disponible | ≠ 0 (sin QR, sin login interactivo) |
| Sin horarios configurados | 0, en espera silenciosa |
| Fallo aislado de un intento | 0 (el proceso continúa; FR-011) |
