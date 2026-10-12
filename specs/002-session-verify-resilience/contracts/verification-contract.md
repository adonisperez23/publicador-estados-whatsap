# Contract: Verificación de sesión, causas de fallo y comando manual (FR-004–FR-014)

**Rama**: `002-session-verify-resilience` | **Fecha**: 2026-10-11
**Consumidor**: `index.js` (orquestador), `login.js` (comando manual), tests de
contrato y el operador humano (US2/US5). Contrato de log heredado:
[log-format.md](../001-whatsapp-status-automator/contracts/log-format.md) — **sin
cambios** (enum de motivos sin ampliar).

## 1. Resultado de `verifySession`

```js
{
  autenticado: boolean,          // true ⇒ causa/evidencia no aplican
  causa: string | null,          // ver §2 — exactamente una si autenticado=false
  detalle: string,               // texto humano extra (tiempo, error concreto)
  esperaAplicadaMs: integer ≥ 1, // valor efectivo del orquestador, sin clamp
  duracionMs: integer ≥ 0,       // duración de la clasificación (≤ esperaAplicadaMs)
  observacion: {
    url: string,
    readyState: 'loading' | 'interactive' | 'complete' | '',
    senalQr: boolean | null,     // null si no hubo página (fallo de arranque)
    indicadores: [{ nombre: string, presente: boolean }]   // ≥ 3 indicadores
  },
  evidencia: {
    captura: Buffer | null,      // PNG antes de cerrar el contexto; null sin página
    resumen: object              // base de summary.json (ver diagnostics.schema.json)
  }
}
```

**Invariantes del resultado**:

1. `autenticado=true` ⇔ algún `observacion.indicadores[].presente` en alguna pasada
   (basta uno; retorno inmediato — FR-001/003).
2. `autenticado=false` ⇒ `causa` ∈ enum de §2 y `duracionMs ≤ esperaAplicadaMs`
   (fallo de red/arranque puede ser menor, nunca mayor — FR-013, SC-007).
3. El resultado **nunca** incluye cuerpos de mensajes, contactos ni datos de `session/`
   (FR-008) — solo la captura, que es un fichero local.

## 2. Causas, motivos de log y plantillas de mensaje

Enum de causas (exclusivas, FR-004 — regla de desempate de la Clarificación 2: si al
vencer la espera la interfaz era observable ⇒ `cambio-interfaz`, no
`interfaz-no-cargo-a-tiempo`):

| `causa` | Motivo de log | Plantilla de mensaje en consola |
|---------|---------------|--------------------------------|
| `sesion-caducada` | `sesion-no-disponible` | `sesion-no-disponible: sesión caducada — restablece la sesión con "npm run login" (escanea el QR); el ciclo automatizado nunca pide login. Evidencia: <ruta>` |
| `interfaz-no-cargo-a-tiempo` | `timeout` | `timeout: la interfaz no cargó a tiempo (espera aplicada: <esperaAplicadaMs> ms) — aumenta sessionVerifyTimeoutSeconds o revisa la conexión. Evidencia: <ruta>` |
| `interfaz-no-cargo-a-tiempo` (arranque) | `timeout` | `timeout: la interfaz no cargó a tiempo (navegador no disponible: <error>) — reinstala chromium (`npx playwright install chromium`). Evidencia: <ruta>` |
| `cambio-interfaz` | `error-interfaz` | `error-interfaz: la interfaz cargó sin los indicadores esperados — posible cambio de WhatsApp Web; revisa la evidencia en <ruta>` |
| `error-red` | `error-red` | `error-red: no se pudo alcanzar WhatsApp Web (<detalle>) — revisa la conectividad. Evidencia: <ruta>` |
| (carpeta `session/` ausente — comprobación previa, no es verificación) | `sesion-no-disponible` | `sesion-no-disponible: session/ no existe. Restablece la sesión manualmente; nunca se inicia login dentro del ciclo automatizado.` (mensaje existente, sin cambios) |

`<ruta>` = carpeta `diagnostics/verification-<timestamp>/` creada para ese fallo.

**Línea de log** (por cada fallo de verificación, exactamente una):
`<ts ISO-8601 local> | sistema | - | fallo | <motivo>` — y en éxito
`<ts> | sistema | - | exito | -` (comportamiento actual conservado).

## 3. Campo de configuración

| Regla | Valor |
|-------|-------|
| Campo | `sessionVerifyTimeoutSeconds` en `menu.json` (opcional) |
| Tipo | número ≥ 1; **sin máximo** (el valor del orquestador se aplica tal cual) |
| Ausente | default **30** (segundos); sin aviso |
| Inválido (no numérico / no finito / < 1) | default **30** + aviso en stderr; **nunca** `config-invalida` |
| Efectivo | informado en la línea de arranque de la verificación y en el mensaje de fallo por espera |

## 4. Artefactos de diagnóstico (en todo fallo de verificación)

```text
diagnostics/
└── verification-<timestamp ISO, caracteres seguros>/
    ├── screenshot.png    # captura completa de la interfaz visible (si hubo página)
    └── summary.json      # resumen estructural — contracts/diagnostics.schema.json
```

**Invariantes de privacidad y lifecycle**:

1. `diagnostics/` está en `.gitignore`, se auto-crea, nunca se transmite fuera de la
   máquina (FR-008) — test de contrato.
2. `summary.json` valida contra
   [diagnostics.schema.json](./diagnostics.schema.json); el esquema solo admite campos
   estructurales (por diseño no puede contener contenido de mensajes).
3. La captura se toma **antes** de cerrar el contexto y puede mostrar la interfaz
   completa visible, incluida autenticada (Clarificación 1).
4. Fallo de escritura ⇒ aviso en stderr con timestamp; la causa original se reporta
   igual (FR-010) — la línea de log nunca cambia por este fallo secundario.
5. Éxito ⇒ **cero** artefactos; cada fallo ⇒ su propia carpeta (no se pisan).
6. Los artefactos quedan almacenados ≤ 5 s tras el fallo (SC-004).

## 5. Comando manual: `login.js` (`npm run login`)

**Sinopsis**: `node login.js` — invocado solo por el operador; `index.js` no lo importa
ni lo ejecuta (FR-011).

| # | Escenario | Salida (estructura) | Exit |
|---|-----------|---------------------|------|
| 1 | Daemon en marcha (`.daemon.pid` con proceso vivo) | stderr: `login: el daemon está en marcha (pid <pid>); ciérralo antes de restablecer la sesión.` — **no toca `session/`** | 1 |
| 2 | Sesión válida, sin confirmación | stdout: `login: la sesión sigue vinculada; no es necesario restablecerla.` + prompt `¿Quieres desvincular y volver a vincular? [y/N] `; respuesta ≠ `y` ⇒ `login: sin cambios.` | 0 |
| 3 | Sesión válida, confirmación `y` | se limpia el perfil (solo con confirmación) y se muestra el QR; sigue el escenario 4 | según 4 |
| 4 | Sesión caducada/no vinculada | ventana **headful** con el QR + stdout: `login: escanea el QR con el teléfono (espera máx 300000 ms).`; tras escanear: `login: sesión vinculada correctamente.` | 0 |
| 5 | Espera del QR agotada (5 min) | `login: tiempo de espera agotado (300000 ms); vuelve a ejecutar el comando.` | 1 |

**Invariantes**: la sesión válida **nunca** se altera sin confirmación explícita
(FR-012); tras vincular, `session/` conserva permisos restringidos; el comando espera
explícitamente (nunca indefinido — Principio VII).

## 6. Códigos de salida del proceso

| Situación | Exit code |
|-----------|-----------|
| Arranque correcto de la verificación (sesión autenticada) | 0 (el daemon continúa) |
| Cualquier causa de fallo de verificación | ≠ 0 |
| `session/` inexistente (comprobación previa) | ≠ 0 (sin QR — sin cambios) |
| `login.js` rechazado por daemon en marcha | ≠ 0 |
| `login.js` sin cambios (sesión válida sin confirmar) | 0 |
| `login.js` con QR escaneado | 0 |
| `login.js` con espera del QR agotada | ≠ 0 |

## 7. Invariantes verificables (tests de contrato / quickstart)

1. **SC-001**: el 100 % de los fallos produce una línea `sistema … fallo <motivo>` con
   motivo del mapping §2 y un mensaje que nombra la causa y la acción; cero mensajes
   genéricos sin causa.
2. **FR-011 / SC-005**: ninguna salida ni ventana del ciclo automatizado muestra un QR
   (verificación headless; `login.js` entry separado).
3. **SC-003**: `esperaAplicadaMs` del resultado == `sessionVerifyTimeoutSeconds·1000`
   cuando el valor es válido; == 30000 cuando no se indica o es inválido (+ aviso).
4. **SC-004**: tras cada fallo existe la carpeta con `summary.json` válido (+ captura si
   hubo página), dentro de 5 s; `git status` jamás lista `diagnostics/` ni
   `.daemon.pid`.
5. **FR-013 / SC-007**: `duracionMs ≤ esperaAplicadaMs` en todos los resultados; cero
   procesos chromium residuales tras el retorno (éxito o fallo).
6. **FR-012**: con `.daemon.pid` vivo, `login.js` sale con código 1 sin modificar
   `session/` (hash de la carpeta intacto antes/después).
