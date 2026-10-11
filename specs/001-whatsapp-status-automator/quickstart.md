# Quickstart & Validación: Automatizador de Estados de WhatsApp Business

**Rama**: `001-whatsapp-status-automator` | **Fecha**: 2026-10-11
**Propósito**: guía ejecutable de validación end-to-end. No contiene implementación;
los detalles de estructura están en [data-model.md](./data-model.md) y los contratos en
[contracts/](./contracts/).

## Prerrequisitos

- Node.js LTS (v22+) y npm en la máquina local del operador
- Cuenta de WhatsApp Business verificada y teléfono cerca (solo para el login inicial)
- Conexión a internet estable durante los horarios configurados
- Una imagen de plato en `assets/` (ej. `ensalada.jpg`)

## Setup (una sola vez)

```bash
npm install                # dependencias del proyecto (playwright, node-cron, ajv)
npx playwright install chromium
```

### Login inicial (única vez, fuera del ciclo automatizado)

1. Crear `menu.json` mínimo (ver escenario S1) y asegurar `assets/ensalada.jpg`.
2. Ejecutar el arranque de configuración documentado en el README del proyecto; la
   ventana de Chromium mostrará el **QR de WhatsApp Web**.
3. Escanear con el teléfono. Verificar que `session/` queda creada:
   `ls -ld session/` → permisos `drwx------` (FR-016).
4. Confirmar que `git status` **no** muestra `session/` (está en `.gitignore`).

> A partir de aquí ningún arranque vuelve a pedir QR (FR-002, SC-004).

## Comandos

| Acción | Comando |
|--------|---------|
| Pruebas unitarias/de contrato | `npm test` (equiv. `node --test tests/`) |
| Validar config contra el contrato | incluido en `npm test` (tests/contract) |
| Ejecutar el daemon | `node index.js` |
| Verificar invariantes de log | `node index.js 2>&1 \| grep \|` (ver abajo) |

## Configuración de prueba (entrada de validación)

`menu.json` para el escenario S1 (horario a 2 minutos vista, hora local):

```json
{
  "publishIntervalSeconds": 30,
  "attemptTimeoutSeconds": 90,
  "dishes": [
    { "id": "ensalada-cesar", "image": "ensalada.jpg",
      "name": "Ensalada César", "price": "$8.50",
      "description": "Lechuga, pollo y parmesano", "cta": "Pide la tuya hoy" }
  ],
  "schedules": [
    { "cron": "* * * * *", "dishIds": ["ensalada-cesar"] }
  ]
}
```

(Para uso real: cron de 5 campos, p. ej. `"0 12 * * *"` — ver
[contracts/menu-config.schema.json](./contracts/menu-config.schema.json).)

## Escenarios de validación

Cada escenario es **independiente** y mapea a criterios del spec. Salida esperada según
[contracts/log-format.md](./contracts/log-format.md).

| # | Escenario (Given/When/Then abreviado) | Comprobación | Cubre |
|---|----------------------------------------|--------------|-------|
| S1 | Sesión activa + cron a las 2 min → aparece el Estado publicado sin tocar teclado | Línea `… \| intento \| ensalada-cesar \| exito \| -` y Estado visible en el teléfono | US1 AC1, SC-001 |
| S2 | `image` apunta a archivo inexistente → se omite, se registra, el resto continúa | Línea `… \| omision \| <id> \| fallo \| imagen-faltante`; el siguiente plato del día sí se intenta | US3 AC1, FR-006 |
| S3 | `price: "   "` → se omite y se deja constancia | Línea con motivo `texto-vacío`; cero Estados publicados para ese plato | US3 AC2, SC-003 |
| S4 | `menu.json` mal formado (JSON roto o `dishIds` huérfano) → error claro e inmediato, ninguna publicación | Exit code ≠ 0 + línea `sistema … config-invalida`; ningún `intento` ese día | edge case config |
| S5 | Renombrar `session/` → ejecución programada | Exit code ≠ 0 + `sistema … sesion-no-disponible`; **no** aparece QR en consola ni ventana | FR-014, US3 AC4 |
| S6 | Detener el proceso 15 min con un cron vencido → reiniciar | Ese cron **no** se ejecuta; solo corren los futuros (sin líneas `intento` retroactivas) | Clarificación 1 (edge case backfill) |
| S7 | Un horario con 2 platos (`dishIds: [a, b]`, `publishIntervalSeconds: 30`) | Dos líneas `intento` **secuenciales** separadas ≥ 30 s; jamás superpuestas | FR-001, FR-015, FR-013, SC-001 |
| S8 | WhatsApp Web inaccesible (sin red) → intento | El intento termina ≤ 90 s con `fallo \| timeout` (o `error-red`); procesos Playwright liberados (`ps` sin chromium huérfano); el siguiente cron se intenta | FR-008/009/011, SC-006/007 |
| S9 | `schedules` con horarios válidos pero red caída durante uno → luego red OK | Tras el fallo aislado, el 100% de horarios posteriores genera su línea `intento` | SC-007, US1 AC3 |
| S10 | Dos crons coincidentes (mismo minuto) | Las bandas se serializan vía mutex: nunca dos líneas `intento` en paralelo | FR-013, edge case solape |
| S11 | Cambiar `price` en `menu.json` (cron siguiente) | El nuevo Estado muestra el precio nuevo sin tocar código; ≤ 3 min de edición | US2 AC1, SC-002 |
| S12 | Quitar todos los horarios válidos | El proceso queda en espera, sin errores ni publicaciones | edge case sin horarios |

## Verificación de invariantes (post-ejecución)

```bash
# SC-005: todo intento con resultado y, si falló, con motivo
grep " | intento | " salida.log | grep -v " | exito | -" | grep -v " | fallo | "

# FR-016: la sesión nunca aparece en logs ni en git
grep -i "session/" salida.log ; git status --porcelain | grep session/

# SC-003: cero publicaciones cuando hubo validaciones fallidas
grep " | omision | " salida.log
```

Los tres comandos deben devolver **vacío** (excepto la tercera, que lista las omisiones
esperadas del escenario activo).

## Criterios de done de la validación

- S1–S12 ejecutados con salida conforme a `contracts/log-format.md`
- `npm test` en verde (unit + contract)
- Ningún chromium huérfano tras cada intento (FR-009/SC-006)
- `session/` gitignored con permisos restringidos (FR-016)
