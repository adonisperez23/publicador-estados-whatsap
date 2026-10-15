# Phase 1 Data Model: Servicio de arranque automático del daemon (systemd --user)

**Branch**: `003-systemd-autostart-service` | **Date**: 2026-10-13
**Input**: [spec.md](./spec.md) (Key Entities + Edge Cases), [research.md](./research.md)

Contrato normativo del servicio:
[contracts/service-lifecycle.md](./contracts/service-lifecycle.md).
Estructura obligatoria de la guía: [contracts/operacion-sections.json](./contracts/operacion-sections.json).

> Las entidades **Plato**, **Horario de publicación** y **Configuración de
> verificación** (campos de `menu.json`) **no cambian** en este feature (alcance:
> servicio de arranque, logs en archivo, reintentos y documentación — Assumptions del
> spec). `index.js`, `whatsappBot.js` y `lib/*.js` no se modifican (research R11).

---

## Entidad: Unidad de servicio

Definición versionada que dice qué proceso ejecutar, desde dónde, con qué política de
reinicio y a dónde mandar los logs (spec § Key Entities).

| Campo | Valor | Reglas / Origen |
|---|---|---|
| `id` | `whatsapp-status.service` | nombre único; idéntico en la versión del repo y en la instalada (FR-005/009) |
| `descripcion` | «Automatizador de Estados WhatsApp (daemon index.js)» | informativa |
| `workingDirectory` | `/home/adonis/Desktop/projects/automatizador-estados-whatsap` | ruta absoluta; `menu.json`, `assets/` y `session/` se resuelven respecto a él (FR-004, FR-010) |
| `execStart` | `/usr/bin/xvfb-run -a --server-args="-screen 0 1280x800x24" <node-absoluto> index.js` | display virtual + `index.js` completo; rutas absolutas, sin shell (FR-003/004/010, research R4) |
| `environment.PATH` | `/usr/local/bin:/usr/bin:/bin` | `xvfb-run` resuelve `Xvfb` por `PATH` sin depender del perfil (FR-010) |
| `type` | `simple` | el proceso hijo es el daemon; estado observable al instante (FR-013) |
| `logDestino` | `/home/adonis/whatsapp-status.log` (stdout **y** stderr, modo `append:`) | una sola historia cronológica; gitignored vía `*.log` (FR-007, SC-002, research R3) |
| `politicaReintentos` | ver entidad **Política de reintentos** | FR-008 |
| `politicaParada` | `KillMode=control-group`, `KillSignal=SIGTERM`, `TimeoutStopSec=10`, `SendSIGKILL=yes` | cero procesos residuales en ≤ 10 s (FR-006, SC-003, research R5) |
| `habilitacion` | `[Install] WantedBy=default.target` + `systemctl --user enable` | arranca en cada encendido; `disable` en un solo comando (FR-001/009, research R6) |
| `ubicacionVersionada` | `systemd/whatsapp-status.service` (en el repo) | **fuente de verdad** (Principio VIII) |
| `ubicacionInstalada` | `~/.config/systemd/user/whatsapp-status.service` | artefacto de máquina; debe ser **idéntica** a la versionada (test de contrato) |

**Relaciones**: la unidad *referencia* al daemon (`index.js` como `WorkingDirectory` +
`ExecStart`), *produce* Registros de evento en el archivo de log y es *descrita* por la
Guía de operación (los comandos de la guía operan sobre esta unidad).

## Entidad: Política de reintentos

Presupuesto de reintentos ante fallo, acotado por intentos **dentro de una ventana de
tiempo** (FR-008, Principio VIII).

| Campo | Tipo | Valor | Reglas / Origen |
|---|---|---|---|
| `restart` | enum | `on-failure` | solo salidas ≠ 0; tras SIGTERM (parada) sale `0` ⇒ sin relanzamiento |
| `esperaEntreIntentosSeg` | entero | `45` | recuperación de un fallo transitorio ≤ 2 min (SC-004) |
| `maxIntentos` | entero | `5` | número máximo de arranques (FR-008) |
| `ventanaSeg` | entero | `600` | ventana de 10 min que agrupa los intentos (FR-008) |
| `estadoTerminal` | enum | `failed` | agotado el presupuesto: sin nuevos intentos automáticos (FR-008, US3 AC2) |

**Transiciones**: cada arranque fallido incrementa el contador dentro de la ventana;
al alcanzar `maxIntentos` la unidad pasa a `failed` y solo sale de ahí con un
`start`/`restart` manual o con un nuevo encendido de la PC (el límite se reinicia por
arranque del user manager).

## Entidad: Estado del servicio

Los tres estados que el operador debe distinguir (FR-013) más la parada voluntaria.

| Estado (operador) | Estado systemd | Cuándo entra | Evidencia |
|---|---|---|---|
| **operativo** | `active (running)` | arranque satisfactorio (config + sesión OK) | log: `sistema \| - \| exito \| -`; `daemon listo: N horario(s)` |
| **reintentando** | `activating (auto-restart)` | salió con código ≠ 0 y no se agotó el presupuesto | `NRestarts` crece; journal: «Scheduled restart job» |
| **detenido por fallo** | `failed` | presupuesto agotado (`StartLimitBurst`) o fallo de arranque no reiniciable | log: `sistema \| - \| fallo \| <motivo>`; `show -p Result` |
| detenido (voluntario) | `inactive (dead)` | `systemctl --user stop` / apagado de la PC | sin motivo de fallo; cero procesos en la cgroup |

**Máquina de estados** (transiciones válidas):

```text
(no instalada) --install+enable--> inactive(dead)   [habilitada, no corre]
inactive(dead) --boot / start--> active(running)             [operativo]
active(running) --exit != 0--> activating(auto-restart)      [reintentando, espera 45 s]
activating(auto-restart) --arranque OK--> active(running)
activating(auto-restart) --5 arranques / 600 s--> failed      [detenido por fallo]
failed --start|restart|nuevo boot--> active(running)          [contador reiniciado]
active(running)|inactive --stop--> inactive(dead)             [parada; SIGTERM a la cgroup]
active(running) --apagado de la PC--> inactive(dead)
```

No hay transición de `failed` automática hacia `active`: esa salida solo ocurre por
intervención del operador o un nuevo encendido (FR-008: «sin nuevos intentos
automáticos»).

**Consulta** (los cuatro comandos del operador, FR-005/013):
`systemctl --user status|is-active whatsapp-status.service` y
`systemctl --user show whatsapp-status.service -p NRestarts -p Result`.

## Entidad: Registro de evento (log)

**Sin cambios de formato**: es el mismo registro del contrato
[log-format.md](../001-whatsapp-status-automator/contracts/log-format.md); lo nuevo es
**dónde vive**.

| Campo | Reglas | Origen |
|---|---|---|
| `timestamp` | ISO-8601 local con offset | contrato 001 |
| `tipo` | `intento` \| `omision` \| `sistema` | contrato 001 |
| `plato` | id del plato o `-` | contrato 001 |
| `resultado` | `exito` \| `fallo` | contrato 001 |
| `motivo` | enum cerrado (`imagen-faltante`…`error-red`) o `-` | contrato 001 — **sin ampliación** |
| **destino** | `/home/adonis/whatsapp-status.log` (append, gestionado por systemd) | FR-007, SC-002, research R3 |

**Invariantes**:
1. Una línea por evento, en el mismo archivo, sin importar que el daemon lo escribiera
   por `stdout` (`exito`) o `stderr` (`fallo`).
2. El archivo es de solo agregado durante la vida del servicio; el que lo vacía es el
   operador (`> /home/adonis/whatsapp-status.log`), documentado en `OPERACION.md`.
3. `*.log` está en `.gitignore`: el log **nunca** se versiona.
4. El servicio que agota reintentos siempre dejó, como última línea del daemon, la
   causa tipada (`config-invalida`, `sesion-no-disponible`, `timeout`, `error-red`,
   `error-interfaz`) — US3 AC3.

## Entidad: Guía de operación (`OPERACION.md`)

Documento versionado en la raíz del repositorio; su **estructura** es contrato
(máquina de verdad en [contracts/operacion-sections.json](./contracts/operacion-sections.json)).

| Sección | Contenido mínimo | Origen |
|---|---|---|
| Ruta rápida | los 4 comandos (parar/arrancar/reiniciar/estado) | FR-011, US4 AC1, SC-005 |
| Prerrequisitos | Linux + systemd, `node` y `xvfb-run` con sus rutas, sesión ya autenticada, `Linger` | FR-011 |
| Instalación | copiar `systemd/whatsapp-status.service` → `daemon-reload` → `enable` → `enable-linger` | FR-011/009, Principio VIII |
| Verificación | `is-enabled`, `is-active`, `status`, `journalctl`, `tail`, `NRestarts` | FR-011 |
| Estados | tabla Estado operador ↔ systemd (entidad anterior) | FR-013 |
| Detener / Arrancar / Reiniciar | comandos + regla de recarga de `menu.json` | FR-005/012 |
| Logs y motivos | rutas, formato de línea, tabla motivo → acción | FR-007/011 |
| Comportamiento en el encendido | linger → unidad → Xvfb → releer `menu.json` → reintentos | US1, FR-001/004 |
| Recuperación de sesión | `stop` → `npm run login` → `start` (depende de 002 T032) | edge case, research R9 |
| Desinstalación | `disable --now` → borrar unidad → `daemon-reload` → `disable-linger` | FR-011, SC-007 |

**Relaciones**: la guía *opera sobre* la Unidad de servicio, *describe* la máquina de
estados y *referencia* el archivo de Registros de evento.

## Entidades que no cambian

| Entidad | Motivo |
|---|---|
| Plato / Horario de publicación / Configuración (`menu.json`) | fuera de alcance (Assumptions); la única regla nueva es de **recarga**: cambios con la PC apagada aplican en el próximo encendido; con el servicio corriendo, reinicio obligatorio (FR-012) |
| Resultado de verificación de sesión (002) | intacto; el servicio solo propagará su motivo al salir |
| Publicación (001) | intacta: validación de assets, mutex, presupuesto de intento |
