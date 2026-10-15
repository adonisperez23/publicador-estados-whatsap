# Quickstart & Validación: Servicio de arranque automático del daemon (systemd --user)

**Rama**: `003-systemd-autostart-service` | **Fecha**: 2026-10-13
**Propósito**: guía ejecutable de validación end-to-end en la PC real del operador. No
contiene implementación; el detalle vive en [data-model.md](./data-model.md) y en los
contratos [service-lifecycle.md](./contracts/service-lifecycle.md) y
[operacion-sections.json](./contracts/operacion-sections.json).

## Prerrequisitos

- PC Linux con `systemd` (user manager) y permisos de administrador puntuales
  (`sudo loginctl …`)
- Node.js ≥ 22 en ruta absoluta (`command -v node`) y `xvfb-run`
  (`command -v xvfb-run`); Chromium de Playwright instalado
- Sesión de WhatsApp ya autenticada en `session/` (flujo del
  [README](../../../README.md)) — **excepto** S8/S9, que la rompen a propósito
- `Linger` activo o activable: `loginctl show-user "$USER" -p Linger`
- La unidad versionada `systemd/whatsapp-status.service` disponible en la raíz del repo

## Setup

```bash
npm install
npx playwright install chromium
npm test        # S1: debe quedar en verde antes de tocar el servicio
```

## Comandos

| Acción | Comando |
|--------|---------|
| Instalar/actualizar la unidad | seguir `OPERACION.md` § Instalación |
| Estado | `systemctl --user status whatsapp-status.service` |
| Parar / arrancar / reiniciar | `systemctl --user {stop,start,restart} whatsapp-status.service` |
| Habilitar / deshabilitar arranque | `systemctl --user {enable,disable} whatsapp-status.service` |
| Log del daemon | `tail -f /home/adonis/whatsapp-status.log` |
| Errores de systemd | `journalctl --user -u whatsapp-status -b` |
| Reintentos acumulados | `systemctl --user show whatsapp-status.service -p NRestarts` |
| Procesos residuales | `systemd-cgls --user \| grep -iE "chromium\|Xvfb"` |

## Escenarios de validación

Cada escenario es independiente y mapea a criterios del spec. La salida esperada de
estados y reintentos se define en
[service-lifecycle.md §3](./contracts/service-lifecycle.md).

| # | Escenario (Given / When / Then abreviado) | Comprobación | Cubre |
|---|-------------------------------------------|--------------|-------|
| S1 | `npm test` | unit + contrato + integración en verde, **incluidos** `test_service_unit.test.js` y `test_operacion_doc.test.js` | FR-011, Principio VIII |
| S2 | Sigo § Instalación con la unidad versionada → `diff` con la instalada | `cp` + `daemon-reload` + `enable`; `is-enabled` = `enabled`; `diff systemd/whatsapp-status.service ~/.config/systemd/user/whatsapp-status.service` **vacío** (la copia previa «a mano» estaba desfasada) | FR-009, SC-007 (punto de partida), Principio VIII |
| S3 | Servicio operativo → `systemctl --user stop` cronometrado | a los ≤ 10 s: `is-active` = `inactive`, **0** procesos de la unidad, **0** de Chromium y **0** de Xvfb (`systemd-cgls --user` / `pgrep`) | FR-006, SC-003, US2 AC1 |
| S4 | Editar `menu.json` (plato u horario nuevo) con el servicio corriendo → `restart` | nueva línea `daemon listo: N horario(s)` con N actualizado; los platos/horarios nuevos aparecen registrados | FR-004/012, US2 AC3, SC-006 |
| S5 | **Encendido real de la PC** sin tocar nada | pasados ≤ 3 min desde que el sistema queda usable: `active (running)`, en el log `sistema \| - \| exito \| -` y `daemon listo: N horario(s)`; cero comandos manuales | FR-001, US1 AC1, SC-001 |
| S6 | Cerrar la sesión de escritorio (o no iniciarla) dejando la PC encendida | el servicio sigue `active` y publica en el próximo horario (display virtual `:99` activo) | FR-002/003, US1 AC2 |
| S7 | Sin conexión de red → `start` | cada 45 s un intento (`NRestarts` crece, estado `activating (auto-restart)`); al volver la red ⇒ `active` en ≤ 2 min, sin Intervención | US3 AC1, SC-004 |
| S8 | `mv session session.bak` → `restart` | motivo `sesion-no-disponible` en el log; **5** arranques en 10 min y luego `failed` (sin intentos nuevos); recuperación con `stop` → `npm run login` → `start` **[requiere `login.js` de 002, T032]** | US3 AC2/AC3, edge case, FR-008 |
| S9 | `menu.json` mal formado → `restart` | motivo `config-invalida` en el log; presupuesto de reintentos agotado ⇒ `failed`; corregir + `restart` ⇒ operativo | US3 AC2, edge case |
| S10 | Recorrer la tabla de [service-lifecycle.md §3](./contracts/service-lifecycle.md) con los comandos de `OPERACION.md` § Estados | los 4 estados se distinguen: operativo / reintentando / detenido por fallo / detenido manual | FR-013, US2 AC5 |
| S11 | Revisar el archivo de log tras los escenarios anteriores | **100 %** de los eventos con `timestamp \| tipo \| plato \| resultado \| motivo`; `grep -cE` del formato == número de líneas; ninguna línea «suelta» de Node | FR-007, SC-002 |
| S12 | Un operador que no instaló sigue `OPERACION.md` para parar, arrancar, reiniciar y leer el log | las 4 acciones completadas en ≤ 1 min sin asistencia técnica | US4, SC-005 |
| S13 | `OPERACION.md` § Desinstalar / deshabilitar | `is-enabled` = `disabled`, unidad y log borrados (0 archivos propios); **reinstalar al final** para no dejar la PC sin servicio | FR-009/011, SC-007 |
| S14 | Apagar la PC con el servicio corriendo | el servicio se detiene con el sistema; al reencender vuelve a S5 (cero procesos residuales tras el apagado) | FR-001/006, edge case |

> S8/S9 provocan estados `failed` reales: siempre terminar con un `restart` que deje
> el servicio operativo (o con S13 si la validación termina ahí).

## Verificación de invariantes (post-ejecución)

```bash
# I3 / SC-003: cero huérfanos tras stop
systemctl --user stop whatsapp-status.service
sleep 10
systemd-cgls --user | grep -iE "chromium|Xvfb" || echo "OK: sin residuales"

# I5 / SC-002: cada línea del log cumple el formato del contrato 001
grep -cE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[^ ]+ \| (intento|omision|sistema) \| [^ ]+ \| (exito|fallo) \| (-|[a-z-]+)$' \
  /home/adonis/whatsapp-status.log
wc -l < /home/adonis/whatsapp-status.log     # ambos números deben coincidir

# I4 / FR-008: sin reintentos infinitos en 24 h (máx. 5 por ventana de 10 min)
journalctl --user -u whatsapp-status --since "24 hours ago" | grep -c "Scheduled restart job"

# I1 / FR-001: habilitado para el próximo encendido
systemctl --user is-enabled whatsapp-status.service   # enabled
loginctl show-user "$USER" -p Linger                  # Linger=yes

# I8: la unidad instalada es idéntica a la versionada
diff systemd/whatsapp-status.service ~/.config/systemd/user/whatsapp-status.service && echo "OK: sincronizada"

# I9: el servicio jamás pide QR
grep -iE "qr|escanear" /home/adonis/whatsapp-status.log || echo "OK: sin QR en el ciclo"

# I7: el log del servicio no se versiona
git status --porcelain | grep -E "\.log$" || echo "OK: log no trackeado"
```

## Criterios de done de la validación

- S1–S14 ejecutados con salida conforme a
  [service-lifecycle.md](./contracts/service-lifecycle.md)
- `npm test` en verde (unit + contract + integración con fixtures)
- Escenario S5 (encendido real) verificado al menos una vez en la PC
- Tras S3 y S14: 0 procesos residuales; tras S8/S9: estado `failed` con motivo
  registrado y **exactamente** un número finito de reintentos
- `OPERACION.md` cumple [operacion-sections.json](./contracts/operacion-sections.json)
  (`npm test` lo garantiza)
- Servicio reinstalado y `active` al terminar (la feature deja la PC operativa)
