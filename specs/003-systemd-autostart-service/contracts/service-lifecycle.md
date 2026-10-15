# Contract: ciclo de vida del servicio `whatsapp-status.service`

**Feature**: `003-systemd-autostart-service` | **Fecha**: 2026-10-13
**Fuente**: [spec.md](../spec.md), [research.md](../research.md), [data-model.md](../data-model.md)

Contrato normativo de la unidad de systemd y de los comandos con los que el operador la
controla. La **unidad versionada** `systemd/whatsapp-status.service` es la fuente de
verdad; la copia instalada en `~/.config/systemd/user/` debe ser idéntica. La
estructura obligatoria de la documentación vive en
[operacion-sections.json](./operacion-sections.json). El formato de las líneas de log
no cambia: ver [log-format.md](../../001-whatsapp-status-automator/contracts/log-format.md).

---

## 1. Directrices obligatorias de la unidad

Cualquier desviación de este tabla es una ruptura de contrato (la cubre
`tests/contract/test_service_unit.test.js`).

| Sección | Directriz | Valor obligatorio | Cumple |
|---|---|---|---|
| `[Unit]` | `StartLimitIntervalSec` | `600` | FR-008 (ventana de tiempo) |
| `[Unit]` | `StartLimitBurst` | `5` | FR-008 (máximo de intentos) |
| `[Service]` | `Type` | `simple` | FR-013 (estado observable) |
| `[Service]` | `WorkingDirectory` | `/home/adonis/Desktop/projects/automatizador-estados-whatsap` | FR-004/010 |
| `[Service]` | `ExecStart` | `/usr/bin/xvfb-run -a --server-args="-screen 0 1280x800x24" …/node index.js` | FR-003/004 |
| `[Service]` | `Environment` | `PATH=/usr/local/bin:/usr/bin:/bin` | FR-010 |
| `[Service]` | `Restart` | `on-failure` | FR-008 (nunca reintento infinito) |
| `[Service]` | `RestartSec` | `45` | FR-008, SC-004 |
| `[Service]` | `KillMode` | `control-group` | FR-006, SC-003 |
| `[Service]` | `KillSignal` | `SIGTERM` | FR-006, Principio VII |
| `[Service]` | `TimeoutStopSec` | `10` | SC-003 (≤ 10 s) |
| `[Service]` | `SendSIGKILL` | `yes` | SC-003 |
| `[Service]` | `StandardOutput` | `append:/home/adonis/whatsapp-status.log` | FR-007, SC-002 |
| `[Service]` | `StandardError` | `append:/home/adonis/whatsapp-status.log` | FR-007 (un solo archivo) |
| `[Install]` | `WantedBy` | `default.target` | FR-001/009 |

Rutas con marcador de posición: `<node>` =
`/home/adonis/.nvm/versions/node/v22.18.0/bin/node` (la ruta absoluta de Node en la PC;
se documenta en `OPERACION.md` § Prerrequisitos cómo verificarla con `command -v node`).

## 2. Invariantes

1. **I1 — Arranque sin intervención**: con la unidad `enabled` y `Linger=yes`, cada
   encendido de la PC deja el daemon `active (running)` antes del primer horario de
   publicación, sin comandos manuales (FR-001, SC-001).
2. **I2 — Sin sesión de escritorio**: el arranque funciona con el user manager
   persistente y el display virtual; cerrar la sesión de escritorio **no** detiene ni
   afecta al servicio (FR-002/003, US1 AC2).
3. **I3 — Cero huérfanos**: `stop`/`restart`/apagado ⇒ a los ≤ 10 s, 0 procesos de la
   unidad y 0 de Chromium/Xvfb (FR-006, SC-003).
4. **I4 — Reintentos acotados**: solo `Restart=on-failure`, 45 s entre intentos, 5
   arranques en 600 s; agotados ⇒ `failed` y **ningún** intento automático nuevo
   (FR-008, US3 AC1/AC2, SC-004). Prohibido cualquier reintento infinito.
5. **I5 — Motivo registrado**: todo proceso que termina con fallo dejó antes su última
   línea `sistema | - | fallo | <motivo>` con uno de los motivos del enum vigente; el
   journal conserva además el exit code (FR-007/013, US3 AC3).
6. **I6 — Logs en archivo, formato intacto**: ambos flujos de consola del daemon caen
   en `/home/adonis/whatsapp-status.log`; el formato de línea es el del contrato 001 y
   el archivo está gitignored (FR-007, SC-002).
7. **I7 — Configuración re-leída en cada arranque**: el daemon arranca con
   `WorkingDirectory` fijo ⇒ lee `menu.json` tal como está en ese momento; con el
   servicio corriendo los cambios no aplican hasta `restart` (FR-004/012, SC-006).
8. **I8 — Unidad sincronizada**: si `~/.config/systemd/user/whatsapp-status.service`
   existe, su contenido es idéntico al de `systemd/whatsapp-status.service` (Principio
   VIII; evita «instalación a mano» fuera de versión).
9. **I9 — Ciclo sin QR**: la unidad solo invoca `index.js`; ningún comando del
   servicio muestra el QR de WhatsApp (Principio I). La recuperación manual es
   `npm run login`, fuera del ciclo (§6).
10. **I10 — Documentación exacta**: `OPERACION.md` contiene, con comandos exactos,
    prerrequisitos, instalación, verificación, uso diario, estados, tabla de motivos y
    desinstalación (FR-011, US4) — estructura en [operacion-sections.json](./operacion-sections.json).

## 3. Estados: del operador a systemd (FR-013)

| Operador | `systemctl --user status` | Comprobación exacta | Significado / acción |
|---|---|---|---|
| **operativo** | `active (running)` | `systemctl --user is-active whatsapp-status.service` ⇒ `active` | sin intervención; en el log hay `sistema \| - \| exito \| -` |
| **reintentando** | `activating (auto-restart)` | `systemctl --user show whatsapp-status.service -p NRestarts` (valor creciente) | fallo transitorio; esperar ≤ 2 min (SC-004) |
| **detenido por fallo** | `failed` | `systemctl --user show whatsapp-status.service -p Result` ⇒ `exit-code` o `start-limit` | intervenir: leer motivo en log/journal y seguir la tabla de motivos |
| detenido (voluntario) | `inactive (dead)` | `is-active` ⇒ `inactive` | parada del operador o apagado de la PC; sin motivo de fallo |

## 4. Comandos de ciclo de vida (FR-005, SC-005)

```bash
systemctl --user start   whatsapp-status.service   # arrancar
systemctl --user stop    whatsapp-status.service   # detener (≤ 10 s, sin residuales)
systemctl --user restart whatsapp-status.service   # obligatorio tras editar menu.json
systemctl --user status  whatsapp-status.service   # estado + PID + últimos eventos
```

Habilitar / deshabilitar arranque automático (FR-009):

```bash
systemctl --user enable  whatsapp-status.service
systemctl --user disable whatsapp-status.service
```

## 5. Instalación y desinstalación (FR-009/011, SC-007)

Instalación (una sola vez, desde la raíz del repo):

```bash
mkdir -p ~/.config/systemd/user
cp systemd/whatsapp-status.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable whatsapp-status.service
sudo loginctl enable-linger "$USER"     # arranque sin sesión de escritorio
```

Desinstalación completa:

```bash
systemctl --user disable --now whatsapp-status.service
rm ~/.config/systemd/user/whatsapp-status.service
systemctl --user daemon-reload
sudo loginctl disable-linger "$USER"
rm -f /home/adonis/whatsapp-status.log      # opcional
```

**SC-007**: tras desinstalar ⇒ 0 servicios habilitados y 0 archivos propios de la
feature (la unidad y su log); `systemd/whatsapp-status.service` y `OPERACION.md`
permanecen en el repositorio (son el producto versionado).

## 6. Recuperación de sesión (edge case; dependencia de 002)

Cuando el motivo es `sesion-no-disponible` la unidad queda `failed` sin reintentos
útiles; la recuperación es manual y **no** puede ser `node index.js` (el ciclo corre
headless y nunca muestra QR — Principio I):

```bash
systemctl --user stop whatsapp-status.service
npm run login            # genera el QR (login.js — feature 002, tarea T032)
systemctl --user start whatsapp-status.service
```

**Dependencia**: hasta que 002 entregue `login.js`, este paso no es ejecutable; debe
constar como prerrequisito en [quickstart.md](../quickstart.md) y en `tasks.md`
(decisión R9, confirmada por el propietario).

## 7. Fuera de contrato

- Rotación/retención del log, notificaciones de fallo, control remoto, auto-reparación
  de sesión, soporte Windows/macOS y cambios en `index.js`/`whatsappBot.js`: **fuera de
  alcance** (Assumptions del spec).
- Política de reintentos escrita en el propio daemon, pidfiles o scripts de estado:
  prohibida (Principio VIII + research R2/R7).
