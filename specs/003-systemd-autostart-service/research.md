# Phase 0 Research: Servicio de arranque automático del daemon (systemd --user)

**Branch**: `003-systemd-autostart-service` | **Date**: 2026-10-13
**Input**: [spec.md](./spec.md), [.specify/memory/constitution.md](../../.specify/memory/constitution.md)

Todos los puntos abiertos del Technical Context y las dependencias/integraciones del
spec quedan resueltos aquí. Formato por hallazgo: **Decision / Rationale /
Alternatives considered**. El contexto heredado (stack, logger, contratos de
configuración) se apoya en research.md de los features 001 y 002.

**Estado de partida verificado en la máquina** (13-oct-2026): la unidad
`whatsapp-status.service` existe solo en `~/.config/systemd/user/` (fuera del repo),
está `enabled` + `active`, `Linger=yes`, y el log crece en
`/home/adonis/whatsapp-status.log`. Es decir: la feature está *instalada a mano* pero
**no versionada** — exactamente lo que el Principio VIII prohíbe.

---

## R1. Ubicación y versionado de la unidad de servicio (FR-009, Principio VIII)

**Decision**: la fuente de verdad pasa a ser una unidad versionada en el repo en
`systemd/whatsapp-status.service`. La instalación se hace con comandos exactos
documentados en `OPERACION.md` (copiar → `daemon-reload` → `enable`); la copia en
`~/.config/systemd/user/` queda como artefacto de máquina. Un test de contrato exige
que, si la copia instalada existe en la máquina, sea **idéntica** a la versionada
(deriva detectable de «instalación a mano»).

**Rationale**: el Principio VIII exige que el mecanismo de arranque esté «definido por
configuración versionada, no por pasos recordados»; FR-011 exige comandos exactos en
`OPERACION.md`; el supuesto del spec es **una sola PC con un operador** ⇒ no hace
falta generación de plantillas ni detección de rutas en tiempo de instalación.

**Alternatives considered**:
- *Plantilla `whatsapp-status.service.in` con placeholders (`@NODE@`, `@WORKDIR@`)*:
  añade un paso de `sed` que puede fallar y que nadie pidió — descartada (código
  sombra; el supuesto es una máquina).
- *`install.sh` / `uninstall.sh`*: FR-011 pide comandos **documentados**, no scripts;
  scripts nuevos son más código que mantener y probar — descartados (confirmado con el
  propietario: «unidad versionada + comandos en OPERACION.md»).
- *Dejar la unidad solo instalada (estado actual)*: viola directamente el Principio
  VIII y hace irreproducible la reinstalación — descartado.

## R2. Política de reintentos acotados (FR-008, US3, SC-004)

**Decision**: la política vive entera en la unidad, sin tocar `index.js`:

| Directriz | Valor | Cumple |
|---|---|---|
| `Restart` | `on-failure` (solo salidas ≠ 0) | FR-008 |
| `RestartSec` | `45` s entre intentos | FR-008, SC-004 (≤ 2 min) |
| `StartLimitIntervalSec` | `600` s (10 min) | «dentro de una ventana de tiempo» |
| `StartLimitBurst` | `5` arranques | «número máximo de intentos» |

Al agotarse el límite, systemd deja la unidad en **`failed`** (estado terminal) y no
vuelve a intentar hasta un `start`/`restart` manual o el siguiente encendido de la PC.
El motivo queda registrado por el propio daemon antes de salir
(`logger.logSystem({ resultado: 'fallo', motivo })` ⇒ línea
`sistema | - | fallo | <motivo>` en el archivo) y por el journal de systemd.

**Rationale**: es exactamente lo que la unidad instalada ya hace (verificado con
`systemctl --user show`: `Restart=on-failure`, `RestartUSec=45s`,
`StartLimitBurst=5`, `StartLimitIntervalUSec=10min`) y lo que `OPERACION.md` ya
promete al operador. `index.js` devuelve código ≠ 0 tanto para `config-invalida` como
para `sesion-no-disponible` (contrato `log-format.md` § códigos de salida) **sin
código diferenciado**: cualquier distinción por código de salida exigiría modificar el
daemon, que el spec declara fuera de alcance.

**Alternatives considered**:
- *`RestartPreventExitStatus=1` (no reintentar ante fallo de configuración/sesión)*:
  sería más fino, pero (a) exige códigos de salida distintos ⇒ tocar `index.js`
  (fuera de alcance) y (b) US3 AC2 pide explícitamente agotar el presupuesto de
  reintentos ante un fallo **persistente** (incluye `menu.json` inválido o sesión
  ausente) antes de quedar detenido — descartado.
- *`Restart=always`*: relanzaría tras un `stop` (SIGTERM ⇒ exit 0) y en modo espera
  silenciosa, generando reintentos no acotados — prohibido por FR-008/Principio VIII —
  descartado.
- *Backoff reintentado dentro de `index.js`*: duplica lo que systemd ya hace, obliga a
  modificar el daemon y contradice «cambios en el código del daemon: fuera de alcance» —
  descartado.

## R3. Log en archivo sin modificar el daemon (FR-007, SC-002)

**Decision**: la unidad redirige **ambos** flujos al mismo archivo:

```
StandardOutput=append:/home/adonis/whatsapp-status.log
StandardError=append:/home/adonis/whatsapp-status.log
```

El daemon sigue emitiendo **exactamente una línea por evento en consola**; el contrato
`specs/001-whatsapp-status-automator/contracts/log-format.md` (formato y enum de
motivos) **no cambia**. `*.log` ya está en `.gitignore` (no se versiona).

**Rationale**: el feature 001 decidió explícitamente «solo consola, sin persistencia»
(001 research R7) y el spec 003 prohíbe cambios en el código del daemon: la
persistencia la aporta el servicio. `lib/logger.js` emite `exito` por `stdout` y
`fallo` por `stderr` ⇒ redirigir los dos al mismo archivo es lo único que da una
historia única ordenada para `tail -f` (SC-002, US2 AC4). La ruta absoluta
`/home/adonis/whatsapp-status.log` coincide con la unidad instalada verificada y con
la que `OPERACION.md` ya documenta.

**Alternatives considered**:
- *Modificar `lib/logger.js` para escribir en archivo*: cambio de código del daemon
  (fuera de alcance) y rompe el contrato de consola de 001 — descartado.
- *Solo journald (`journalctl`)*: FR-007 pide **archivo** y SC-002/US2 miden sobre
  `tail -f`; el journal queda además como canal complementario de errores de arranque —
  descartado.
- *`append:%h/whatsapp-status.log` (specificador de systemd)*: más portable si algún
  día cambia el usuario, pero exige verificar el soporte en la versión instalada y el
  supuesto es una PC/usuario fijo (`/home/adonis`) ya escrito en `OPERACION.md` —
  descartado por ahora; se documenta como mejora futura si se replica en otra máquina.

## R4. Display virtual para publicar sin sesión de escritorio (FR-002/003, US1 AC2)

**Decision**: `ExecStart` lanza `xvfb-run` como proceso principal envolviendo a Node:

```
ExecStart=/usr/bin/xvfb-run -a --server-args="-screen 0 1280x800x24" \
  /home/adonis/.nvm/versions/node/v22.18.0/bin/node index.js
Environment=PATH=/usr/local/bin:/usr/bin:/bin
```

**Rationale**: `publishStatus` corre con `headless: false` (`whatsappBot.js:462`) —
necesita un `DISPLAY` aunque nadie haya iniciado sesión de escritorio (FR-003).
`-a` elige un número de display libre (sin colisión con otros usos de X), y el servidor
X queda como **hijo dentro de la misma cgroup** ⇒ muere con el servicio (cero huérfanos,
FR-006). El `Environment=PATH` explícito cubre FR-010 («sin shell interactivo ni
perfil de usuario»): `xvfb-run` resuelve el binario `Xvfb` por `PATH`, que en un user
manager con linger no está garantizado. Node se invoca por ruta absoluta (nvm no está
en ese `PATH`), igual que la unidad instalada que ya funciona.

**Alternatives considered**:
- *Unidad `xvfb.service` aparte con `BindsTo=/After=`*: dos unidades que instalar,
  versionar y documentar, con un modo de fallo más (X caído ⇒ daemon caído) que el
  spec no pide — descartado.
- *`Xvfb :99` a nivel de sistema + `Environment=DISPLAY=:99`*: el proceso X puede
  quedar huérfano fuera de la cgroup del servicio y obliga a gestionar
  `.Xauthority`/pantallas previas — descartado (violaría FR-006).
- *Chromium headless (cambiar `headless:false`)*: toca `whatsappBot.js` (fuera de
  alcance) — descartado.

## R5. Parada limpia: cero procesos residuales (FR-006, SC-003)

**Decision**: en `[Service]`:

| Directriz | Valor | Por qué |
|---|---|---|
| `KillMode` | `control-group` (explícito) | mata **todos** los procesos de la cgroup: `index.js`, Chromium y `Xvfb` |
| `KillSignal` | `SIGTERM` (explícito) | `keepAlive()` de `index.js` ya convierte SIGTERM en salida limpia (`exit 0`) |
| `TimeoutStopSec` | `10` | SIGKILL de respaldo a los 10 s ⇒ SC-003 «0 residuales en ≤ 10 s» |
| `SendSIGKILL` | `yes` (explícito) | garantía de que algo no cooperativo no sobrevive |

Con `Restart=on-failure` y salida `0` tras SIGTERM, un `stop`/`restart` **nunca**
dispara un relanzamiento (sin «restart fantasma»).

**Rationale**: al enviar SIGTERM a toda la cgroup de forma simultánea, Chromium y el
servidor X mueren en paralelo con el daemon (la mayoría sale en < 1 s); el respaldo
SIGKILL a los 10 s es el techo que exige SC-003. `systemctl --user show` confirma que
la unidad instalada ya corre con `KillMode=control-group` (default) — lo hacemos
**explícito** porque es una garantía contractual de la feature, no un default
implícito.

**Alternatives considered**:
- *`TimeoutStopSec` por defecto (90 s)*: excedería SC-003 en el peor caso — descartado.
- *`KillMode=process` (solo el PID principal)*: dejaría Chromium y X huérfanos —
  descartado (es exactamente el bug que la feature elimina).
- *`KillSignal=SIGKILL` directo*: mata el daemon sin cierre ordenado del contexto de
  navegador (Principio VII exige `finally`/cierre determinista) — descartado.

## R6. Arranque en el encendido sin sesión de escritorio (FR-001/002/009/010, US1)

**Decision**: la fórmula completa de arranque es:

1. `loginctl enable-linger adonis` (una vez, ya activo: `Linger=yes`) ⇒ el user
   manager de systemd arranca **sin login**.
2. Unidad con `[Install] WantedBy=default.target` + `systemctl --user enable` ⇒ se
   activa en cada arranque del usuario persistente.
3. `Type=simple`, `WorkingDirectory=/home/adonis/Desktop/projects/automatizador-estados-whatsap`
   y `ExecStart` con rutas absolutas ⇒ arranque sin shell, sin perfil y sin
   dependencia del entorno de la terminal (FR-010).
4. `After=default.target` (orden de arranque simple; la red no se espera: los
   reintentos de R2 cubren el edge case «red caída al encender»).

**Rationale**: cumple a la vez FR-001 (automático), FR-002 (sin login), FR-009
(`enable`/`disable` con un comando) y FR-010 (sin entorno interactivo). Verificado en
la máquina: `is-enabled = enabled`, `Linger=yes`, unidad `active` en este arranque.

**Alternatives considered**:
- *Unidad de sistema (`system`) con `User=adonis`*: exige privilegios de root en cada
  cambio y el spec pide explícitamente `systemctl --user` — descartado.
- *Autostart por `.bashrc` / `.profile` / escritorio*: solo corre si hay sesión de
  escritorio (rompe FR-002) y no es configuración versionada de servicio (Principio
  VIII) — descartado.
- *`cron @reboot`*: sin estados, sin journal, sin política de reintentos acotada y sin
  `stop/start` estándar ⇒ no cumple FR-005/FR-008/FR-013 — descartado.

## R7. Mapeo de estados «operativo / reintentando / detenido por fallo» (FR-013, US2)

**Decision**: traducir los estados que systemd ya expone a los tres términos del
operador, en tabla dentro de `OPERACION.md` y en
[contracts/service-lifecycle.md](./contracts/service-lifecycle.md):

| Operador (FR-013) | systemd (`systemctl --user status`) | Comprobación |
|---|---|---|
| **operativo** | `active (running)` | `is-active` = `active`; en el log: `sistema \| - \| exito \| -` |
| **reintentando** | `activating (auto-restart)` | `NRestarts` crece; journal: «Scheduled restart job» |
| **detenido por fallo** | `failed` | `show -p Result` = `exit-code`/`start-limit`; motivo en log + journal |
| detenido manual | `inactive (dead)` | decisión del operador, sin motivo de fallo |

**Rationale**: son los estados reales ya observados con `systemctl --user show` sobre
la unidad instalada; el operador aprende cuatro comandos que ya usa (FR-005) y no
necesita scripts nuevos. Cubre US2 AC5 («detenido por fallo y el motivo»).

**Alternatives considered**:
- *Pidfile/estado propio escrito por `index.js`*: modifica el daemon (fuera de alcance)
  y duplica información que systemd ya tiene — descartado.
- *Script `estado.sh`*: introduce un comando no estándar donde FR-005 pide comandos
  estándar — descartado.

## R8. Secciones que faltan en `OPERACION.md` (FR-011, US4)

**Decision**: completar la guía con las secciones que FR-011 enumera y hoy no están,
conservando lo que ya funciona:

| Sección FR-011 | Estado actual | Acción |
|---|---|---|
| Prerrequisitos | ausente | **añadir** (Linux+systemd, `node`/`xvfb-run`, sesión ya autenticada, linger) |
| Instalación | ausente | **añadir** (copiar unidad versionada → `daemon-reload` → `enable` → `enable-linger`) |
| Verificación | parcial (`status`/`logs`) | **añadir** bloque de verificación de la instalación (`is-enabled`, `is-active`, `journalctl`, `NRestarts`) |
| Uso diario / 4 comandos | presente | conservar |
| Tabla de motivos → acción | presente | conservar y corregir el comando de recuperación (R9) |
| Desinstalación | presente | conservar (ya cubre SC-007) |
| Estados (FR-013) | ausente | **añadir** la tabla de R7 |
| Regla de recarga de `menu.json` (FR-012) | presente | conservar |

La estructura obligatoria queda como contrato machine-checkable en
[contracts/operacion-sections.json](./contracts/operacion-sections.json), que consumen
los tests de contrato.

**Rationale**: FR-011 es literal sobre los seis bloques del ciclo de vida; hoy faltan
tres. `README.md` ya enlaza `OPERACION.md` y documenta el reinicio obligatorio ⇒ no
requiere cambios.

**Alternatives considered**:
- *Reescribir `OPERACION.md` entera*: ya cubre correctamente 4 de 6 bloques y está
  enlazada desde el README — descartado (riesgo de perder información buena).
- *Mover la guía a `docs/`*: FR-011 fija el nombre y la ubicación en el repositorio —
  descartado.

## R9. Recuperación de sesión documentada (edge case sesión ausente/caducada)

**Decision** (confirmada con el propietario): la línea actual de `OPERACION.md`
(«borrar `session/`, correr `node index.js`, escanear QR») **se corrige** a:

```
systemctl --user stop whatsapp-status.service
npm run login            # escanea el QR (fuera del ciclo automatizado)
systemctl --user start whatsapp-status.service
```

El comando depende de `login.js` (feature **002**, tarea **T032** aún pendiente). Hasta
que 002 lo entregue, ese paso de la guía **no es ejecutable** y queda marcado como
prerrequisito en [quickstart.md](./quickstart.md) y en `tasks.md`.

**Rationale**: `index.js` corre la verificación en modo headless y **nunca** muestra un
QR (Principio I; `whatsappBot.js` solo lo haría en un flujo manual), así que el texto
actual no puede funcionar: terminaría en `sesion-no-disponible`. FR-011 exige
«comandos exactos», y `package.json` + `README.md` ya declaran `npm run login` como el
comando del proyecto.

**Alternatives considered**:
- *Implementar `login.js` dentro de 003*: duplicaría el alcance de 002 y el spec pone
  los cambios de código del daemon fuera de alcance — descartado (decisión del
  propietario: «documentar `npm run login` (depende de 002)»).
- *Mantener el texto actual*: instrucción inviable que incumple FR-011 — descartado.

## R10. Estrategia de validación (FR-007/009, SC-001…SC-007)

**Decision**: dos niveles.

1. **Tests de contrato automatizados** (`node --test`, estilo repo: `node:test` +
   `node:assert/strict`, archivos leídos con `path.join(__dirname, …)`):
   - `tests/contract/test_service_unit.test.js` — la unidad versionada existe y
     contiene cada directriz obligatoria (R2/R4/R5/R6); si existe la copia instalada en
     `~/.config/systemd/user/`, es idéntica a la versionada (R1).
   - `tests/contract/test_operacion_doc.test.js` — `OPERACION.md` contiene las
     secciones y comandos de `contracts/operacion-sections.json` (R8/R9), incluida la
     tabla de estados y `npm run login`.
   - `*.log` presente en `.gitignore` (el log del servicio no se versiona).
2. **Validación real de systemd** en [quickstart.md](./quickstart.md): encendido real,
   parada con conteo de huérfanos, reintentos acotados, estados y desinstalación. No se
   automatiza: exige la PC del operador (linger, unidad instalada, sesión de WhatsApp) y
   no hay precedente de `child_process` en los tests del repo.

**Rationale**: la documentación es producto de esta feature (FR-011/SC-005), así que se
testea como cualquier otro contrato; el comportamiento del servicio solo es observable
en la máquina real, que es justamente donde vive la feature.

**Alternatives considered**:
- *Tests que ejecuten `systemctl`*: dependen del estado real de la máquina ⇒ no
  deterministas en otra PC o en CI — descartados.
- *Sin tests de documento*: dejaría FR-011/SC-007 sin verificación automática
  (regresión silenciosa al editar `OPERACION.md`) — descartado.

## R11. Alcance de cambios: cero código del daemon (spec + Cero Código Sombra)

**Decision**: 003 **no modifica** `index.js`, `whatsappBot.js`, `lib/*.js`,
`menu.json` ni los contratos de 001/002. Cambios del feature:

| Archivo | Acción |
|---|---|
| `systemd/whatsapp-status.service` | **nuevo** (unidad versionada) |
| `OPERACION.md` | **ampliado** (prerrequisitos, instalación, verificación, estados, comando de recuperación) |
| `tests/contract/test_service_unit.test.js` | **nuevo** |
| `tests/contract/test_operacion_doc.test.js` | **nuevo** |
| `README.md` | **sin cambios** (ya enlaza `OPERACION.md` y documenta los comandos) |
| `specs/003-…/` (plan, research, data-model, contracts, quickstart, tasks) | artefactos de especificación |

**Rationale**: el spec declara fuera de alcance «cambios en el código del daemon»; el
Principio VIII se satisface íntegramente con configuración versionada + documentación.
Todo lo demás (horarios, selectores, validación de assets) queda intacto.

**Alternatives considered**: ni healthcheck, ni pidfile, ni rotación de log ni
notificaciones — todos declarados fuera de alcance en Assumptions del spec (código
sombra).

---

**Resultado**: 0 NEEDS CLARIFICATION. R1–R11 cubren ubicación de la unidad, política
de reintentos, persistencia de logs, display virtual, parada sin huérfanos, arranque
sin sesión de escritorio, estados del servicio, documentación, comando de recuperación,
estrategia de validación y alcance de cambios.
