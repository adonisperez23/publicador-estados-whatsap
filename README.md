# Automatizador de Estados de WhatsApp Business

Daemon de Node.js que publica automáticamente Estados de WhatsApp Business
(imagen + nombre + precio + descripción + llamada a la acción) en los horarios
definidos por el operador, usando Playwright sobre WhatsApp Web con sesión
persistente.

## Configuración de platos y horarios (`menu.json`) — US2

Todo el contenido y todos los horarios viven en **`menu.json`** en la raíz del
proyecto. **Nunca es necesario editar código** para cambiar el menú (FR-003,
FR-004, SC-002).

### Cambiar un precio (≤ 3 minutos)

1. Abrí `menu.json`.
2. Editá el campo `price` del plato correspondiente.
3. Reiniciá el daemon (`Ctrl+C` y `node index.js`). La siguiente publicación
   muestra el precio nuevo. Sin asistencia técnica, sin reinstalar nada.

### Mover un horario

1. Editá la expresión `cron` del horario en `schedules` (5 campos:
   `minuto hora día-del-mes mes día-de-semana`, zona horaria local).
2. Reiniciá el daemon para que registre los nuevos horarios.
   Ejemplos: `"0 12 * * *"` = 12:00 todos los días; `"30 19 * * *"` = 19:30;
   `"0 12 * * 1"` = lunes a las 12:00.

### Agregar un plato

1. Copiá la imagen del plato a `assets/` (ej. `assets/hamburguesa.png`).
2. Agregá un objeto en `dishes` con `id` único (minúsculas, números y guiones),
   `image`, `name`, `price`, `description` y `cta` — todos no vacíos.
3. Referenciá el `id` en el/los horario(s) correspondiente(s) (`dishIds`).
4. Reiniciá el daemon. El vínculo imagen↔texto es **siempre por `id`** (FR-005).

### Eliminar un plato

Quitá su objeto de `dishes` y su `id` de cada `dishIds`. Un `dishIds` que
apunte a un plato inexistente invalida la configuración (`config-invalida`).

### Campos globales

| Campo | Defecto | Significado |
|-------|---------|-------------|
| `publishIntervalSeconds` | 60 | Espera mínima entre publicaciones consecutivas (FR-015) |
| `attemptTimeoutSeconds` | 90 | Techo de cada intento, **máximo 90** (FR-008) |
| `schedules` | — | Si está vacío o ausente, el sistema espera en silencio sin errores |

El esquema oficial de la configuración está en
`specs/001-whatsapp-status-automator/contracts/menu-config.schema.json`.

## Setup (una sola vez)

Prerrequisitos: Node.js LTS (v22+) y npm; cuenta de WhatsApp Business verificada;
conexión a internet estable durante los horarios configurados.

```bash
npm install                  # dependencias (playwright, node-cron, ajv)
npx playwright install chromium
```

### Login inicial (única vez, FUERA del ciclo automatizado)

1. Con `menu.json` configurado y al menos una imagen en `assets/`.
2. Ejecutá `node index.js` en una terminal **con sesión abierta en `session/`
   ausente**: en la primera configuración la ventana de Chromium mostrará el
   **QR de WhatsApp Web** (solo en este arranque manual).
3. Escaneá con el teléfono. Verificá la sesión creada:
   `ls -ld session/` → permisos `drwx------` (FR-016).
4. Confirmá que git la ignora: `git status --porcelain` no muestra `session/`.

> A partir de aquí **ningún arranque vuelve a pedir QR** (FR-002, SC-004). Si la
> sesión caduca o falta, el daemon aborta con `sesion-no-disponible` y exit ≠ 0
> **sin** mostrar QR (FR-014): restablecela manualmente con este mismo flujo.

## Uso diario

```bash
node index.js      # arranca el daemon: valida config, verifica sesión, registra crons
npm test           # pruebas unitarias, de contrato e integración (node:test)
```

- Cada intento deja **exactamente una línea** en consola con el formato de
  `specs/001-whatsapp-status-automator/contracts/log-format.md`
  (`timestamp | tipo | plato | resultado | motivo`).
- Motivos posibles: `imagen-faltante`, `texto-vacío`, `texto-largo`,
  `config-invalida`, `sesion-no-disponible`, `timeout`, `error-interfaz`,
  `error-red`.
- Exit codes: config inválida o sesión no disponible ⇒ ≠ 0; sin horarios ⇒
  espera silenciosa (exit 0 al detenerse); un intento fallido aislado ⇒ 0
  (el proceso continúa, FR-011).

### Validación end-to-end (operator)

La guía completa de escenarios S1–S12 (publicación real, red caída, backfill,
multi-plato) está en
`specs/001-whatsapp-status-automator/quickstart.md`; requiere una sesión
autenticada y un teléfono con la cuenta del negocio.

## Estructura

```
index.js          Orquestador (cron, validación, mutex, logs)
whatsappBot.js    Automatización Playwright (selectores estables)
lib/config.js     Carga y validación de menu.json
lib/logger.js     Formato de registro en consola
lib/validateDish.js  Validación previa por intento (imagen/texto)
menu.json         Tu configuración de platos y horarios
assets/           Imágenes de los platos
session/          Sesión de navegador persistente (credencial, gitignored)
tests/            Unit / contract / integration (node:test)
```

Los tests de integración usan una página mock con los mismos selectores
estables y un perfil Chromium temporal: nunca tocan `session/` real.
