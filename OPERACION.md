# Operación del servicio automático (systemd)

Guía de operación del daemon `index.js` cuando corre como servicio de sistema.
Para todo lo demás (menú, horarios, login QR) seguí el [`README.md`](README.md).

## Ruta rápida — los 4 comandos

| Qué querés hacer | Comando |
|---|---|
| **APAGAR el proceso** | `systemctl --user stop whatsapp-status.service` |
| **ARRANCAR el proceso** | `systemctl --user start whatsapp-status.service` |
| **Reiniciar** (obligatorio tras editar `menu.json` con la PC encendida) | `systemctl --user restart whatsapp-status.service` |
| Ver si está corriendo | `systemctl --user status whatsapp-status.service` |

> `--user` es obligatorio: es un servicio del usuario, no del sistema.
> Si te dice *"Failed to connect to bus"* es porque no hay sesión gráfica
> abierta; con `Linger=yes` activo el servicio arranca igual, sin login.

## Detener el proceso

```bash
systemctl --user stop whatsapp-status.service
systemd-cgls --user | grep -i chromium   # opcional: confirmar cero Chromium residual
```

- systemd envía `SIGTERM` al daemon: `index.js` sale limpio (`SIGINT`/`SIGTERM`
  en `keepAlive`) y **mata toda la cgroup**, incluidos los procesos Chromium del
  último intento → sin huérfanos (FR-009).
- Detener no desinstala: al encender la PC de nuevo (o con `start`) vuelve a
  correr.

## Arrancar / reiniciar

```bash
systemctl --user start whatsapp-status.service     # desde detenido
systemctl --user restart whatsapp-status.service   # corta y vuelve a arrancar
```

**Cuándo reiniciar es obligatorio:** después de editar `menu.json` con la PC
encendida (precios, platos, horarios). El daemon solo lee el archivo al arrancar
(`index.js` → `loadConfig`), así que hasta que no reinicie no aplica el cambio.

**A tener en cuenta al reiniciar:**

- node-cron **no re-ejecuta horarios ya pasados ese día** (solo ocurrencias
  futuras). Si reiniciás a las 19:45 y el horario era 19:42, esa tanda se pierde
  hasta mañana.
- El arranque vuelve a verificar la sesión (≤ 30 s, headless) y solo entonces
  registra los crons. Si la sesión caducó, el servicio queda en fallo con
  `sesion-no-disponible` (ver tabla de motivos más abajo).

## Ver estado y logs

```bash
systemctl --user status whatsapp-status.service     # estado, PID, últimos eventos
tail -f /home/adonis/whatsapp-status.log            # log del daemon (seguimiento)
tail -100 /home/adonis/whatsapp-status.log          # últimas 100 líneas
journalctl --user -u whatsapp-status -b             # journal desde el arranque (errores de systemd)
systemctl --user show whatsapp-status -p NRestarts  # cuántos reintentos acumuló
```

- **Log del daemon**: `/home/adonis/whatsapp-status.log` (gitignored). Una línea
  por evento: `<timestamp ISO-8601> | tipo | plato | resultado | motivo`
  (contrato en `specs/001-whatsapp-status-automator/contracts/log-format.md`).
- **journal**: errores de arranque de systemd (binario faltante, exit codes).
- Para vaciar el log: `> /home/adonis/whatsapp-status.log`.

### Motivos de fallo y qué hacer

| Motivo en el log / journal | Significado | Acción |
|---|---|---|
| `config-invalida` | `menu.json` mal formado o `dishIds` que apuntan a platos inexistentes | Corregir el archivo y `restart` |
| `sesion-no-disponible` | Falta `session/` o la sesión caducó (el ciclo nunca muestra QR) | Re-autenticar manualmente: borrar `session/`, correr `node index.js` en una terminal, escanear QR; luego `restart` del servicio |
| `timeout` | Un intento superó el presupuesto de 90 s | Revisar conexión; si es constante, subir `attemptTimeoutSeconds` (máx. 90) en `menu.json` |
| `error-red` | No se alcanzó WhatsApp Web | Revisar internet; el servicio reintenta solo (45 s, máx. 5 veces en 10 min) |
| `error-interfaz` | Cambio de interfaz de WhatsApp Web o fallo de Chromium | Buscar en el log la línea `[detalle]` del intento: indica `etapa=` exacta (interfaz, pestana-estados, selector-archivos, comentario, carga-imagen, envio, subida); revisar `diagnostics/` si existe; reinstalar chromium con `npx playwright install chromium` |
| `imagen-faltante` / `texto-vacío` / `texto-largo` | Validación de un plato falló (omisión, no bloquea) | Completar/corregir el plato en `menu.json` y `assets/` |

## Comportamiento en el arranque de la PC

1. `loginctl enable-linger adonis` → el user manager de systemd arranca **sin
   login**, al encender la máquina.
2. La unidad `whatsapp-status.service` (`WantedBy=default.target`) se activa sola.
3. `xvfb-run` levanta un display virtual (`:99`) → Chromium corre **headful**
   aunque nadie haya iniciado sesión.
4. `index.js` arranca de cero: **relee `menu.json` completo** (precios, platos,
   horarios) y verifica la sesión; si está todo bien loguea
   `sistema | - | exito | -` y espera a los crons (`daemon listo: N horario(s)`).
5. Si falla (p. ej. la red todavía no subió): reintenta a los 45 s, máximo
   **5 veces en 10 minutos**; luego queda `failed` hasta intervención manual.
6. Al apagar la PC el servicio se detiene con el sistema; no queda nada corriendo.

**Uso diario:** encender la PC e iniciar sesión → ya está publicando en los
horarios del menú. Apagar de noche. Cualquier cambio hecho con la PC apagada se
toma en el siguiente encendido.

## Archivos del sistema

| Qué | Ruta |
|---|---|
| Unidad del servicio | `~/.config/systemd/user/whatsapp-status.service` |
| Log del daemon | `/home/adonis/whatsapp-status.log` |
| Working directory | `/home/adonis/Desktop/projects/automatizador-estados-whatsap` |
| Configuración (menú/horarios) | `menu.json` (en el working directory) |
| Sesión de WhatsApp | `session/` (gitignored, permisos `drwx------`) |
| Dependencias | `~/.nvm/versions/node/v22.18.0/bin/node` + Xvfb (`/usr/bin/xvfb-run`) |

## Desinstalar / deshabilitar

```bash
systemctl --user disable --now whatsapp-status.service   # deja de arrancar al boot y detiene
rm ~/.config/systemd/user/whatsapp-status.service        # borra la unidad
systemctl --user daemon-reload
sudo loginctl disable-linger adonis                      # vuelve al arranque por login
sudo apt-get remove --purge xvfb                         # opcional
rm /home/adonis/whatsapp-status.log                      # opcional
```
