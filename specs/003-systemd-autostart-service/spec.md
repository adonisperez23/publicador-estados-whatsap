# Feature Specification: Servicio de arranque automático del daemon

**Feature Branch**: `003-systemd-autostart-service`

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "Servicio de arranque automático: el daemon index.js debe correr como servicio de systemd --user al encender la PC (linger + Xvfb), con logs en archivo, reintentos acotados, ciclo stop/start limpio sin procesos huérfanos y documentación de operación OPERACION.md"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - La PC se enciende y el daemon queda operativo solo (Priority: P1)

Como operador del negocio, enciendo la PC por la mañana y **no tengo que hacer nada**
para que el daemon esté corriendo: valida la configuración, verifica la sesión de
WhatsApp y queda esperando los horarios del menú. También funciona aunque no abra
sesión de escritorio.

**Why this priority**: sin este comportamiento el daemon no existe a la hora
programada y ese día no se publica ningún Estado — es el valor central de la feature.

**Independent Test**: encender la PC sin tocar nada y comprobar, pasado el arranque,
que el proceso del daemon está activo, que el log registra la línea de «sistema |
exito» y que no requirió comandos manuales.

**Acceptance Scenarios**:

1. **Given** la PC apagada y el servicio ya instalado, **When** se enciende la máquina,
   **Then** el daemon queda corriendo sin intervención del operador antes de que llegue
   el primer horario de publicación.
2. **Given** la PC recién encendida sin que nadie inicie sesión de escritorio,
   **When** transcurre el arranque, **Then** el daemon sigue activo y puede publicar.
3. **Given** el daemon recién iniciado, **When** lee la configuración vigente,
   **Then** toma el contenido de `menu.json` tal como está en ese momento (cualquier
   cambio hecho con la PC apagada queda activo).
4. **Given** la sesión de WhatsApp presente y autenticada, **When** el daemon arranca,
   **Then** registra «sistema | - | exito» y anuncia la cantidad de horarios.

---

### User Story 2 - El operador controla y observa el proceso (Priority: P2)

Como operador, quiero parar, arrancar y reiniciar el proceso con comandos simples, y
ver en un solo lugar si está corriendo y qué está pasando (estado y log), sin ayuda
técnica.

**Why this priority**: después de editar `menu.json` con la PC encendida el reinicio
es obligatorio; sin control y sin logs el operador queda a ciegas.

**Independent Test**: seguir `OPERACION.md` y ejecutar parada, arranque, reinicio y
consulta de estado/log; verificar que cada acción produce el efecto esperado en ≤ 1 min.

**Acceptance Scenarios**:

1. **Given** el daemon corriendo, **When** el operador ejecuta la parada documentada,
   **Then** el proceso termina y en ≤ 10 s no queda ningún proceso residual del
   servicio ni del navegador.
2. **Given** el servicio detenido, **When** el operador ejecuta el arranque documentado,
   **Then** el daemon vuelve a operativo y relee `menu.json`.
3. **Given** el daemon operativo, **When** el operador reinicia el servicio tras
   editar `menu.json`, **Then** los horarios y platos nuevos quedan registrados.
4. **Given** cualquier estado, **When** el operador consulta el log,
   **Then** encuentra una línea con timestamp por cada evento, con el formato
   establecido por el proyecto.
5. **Given** que el proceso terminó, **When** el operador revisa el estado,
   **Then** ve si quedó detenido por fallo y el motivo.

---

### User Story 3 - Fallos acotados y diagnóstico (Priority: P3)

Como operador, quiero que si algo falla (red caída al encender, sesión inválida,
configuración rota) el sistema reintente de forma limitada y después quede detenido
con un motivo claro — nunca en un loop infinito que agote la máquina.

**Why this priority**: protege la PC y hace el fallo visible; sin esto un problema
transitorio se vuelve un problema permanente.

**Independent Test**: provocar un fallo de arranque (p. ej. sin red) y comprobar que
hay un número finito de reintentos, que el servicio termina detenido y que el motivo
queda registrado.

**Acceptance Scenarios**:

1. **Given** un fallo transitorio al arrancar (p. ej. la red aún no está disponible),
   **When** pasan los reintentos, **Then** el daemon se recupera solo sin
   intervención del operador.
2. **Given** un fallo persistente (p. ej. sesión de WhatsApp ausente o `menu.json`
   inválido), **When** se agota el presupuesto de reintentos,
   **Then** el servicio queda en estado terminal detenido, con el motivo registrado
   y sin nuevos intentos automáticos.
3. **Given** cualquier fallo, **When** se revisa el log,
   **Then** aparece el motivo tipado correspondiente (uno de los ya definidos por el
   proyecto: `config-invalida`, `sesion-no-disponible`, `error-red`, `timeout`,
   `error-interfaz`).

---

### User Story 4 - Instalación, retiro y desinstalación documentados (Priority: P3)

Como operador (o quien mantenga la PC), quiero una única guía en el repositorio con
todo el ciclo de vida: prerrequisitos, instalación, verificación, uso diario,
solución de problemas y desinstalación completa.

**Why this priority**: sin documentación versionada el proceso vive solo en la
memoria de quien lo instaló; el Principio VIII de la constitución lo exige.

**Independent Test**: alguien que no participó de la instalación sigue
`OPERACION.md` y logra instalar, verificar, operar y desinstalar sin pasos extra.

**Acceptance Scenarios**:

1. **Given** `OPERACION.md` en el repositorio, **When** un operador busca cómo parar
   el proceso, **Then** encuentra el comando exacto en la sección inicial.
2. **Given** la guía, **When** se siguen los pasos de instalación en una PC limpia,
   **Then** el servicio queda habilitado para arrancar en cada encendido.
3. **Given** la guía, **When** se ejecutan los pasos de desinstalación,
   **Then** no queda ni el servicio habilitado, ni sus archivos, ni la modificación
   de arranque del sistema.

---

### Edge Cases

- **La red no está disponible cuando la PC enciende**: el daemon no debe abandonar;
  reintenta de forma acotada y se recupera si la red llega a tiempo.
- **`session/` ausente o la sesión de WhatsApp caducada**: el servicio termina en
  estado de fallo con motivo `sesion-no-disponible`, **sin** mostrar QR y sin
  reintento infinito; la recuperación es manual y documentada.
- **`menu.json` inválido**: el servicio termina con motivo `config-invalida` y queda
  detenido hasta corregir y reiniciar.
- **El display virtual no puede iniciarse** (dependencia de arranque faltante):
  fallo visible en el estado del servicio, sin loops.
- **Cierre de sesión de escritorio con la PC encendida**: el daemon debe seguir
  operando y publicando.
- **Apagado de la PC**: el servicio se detiene con el sistema y no deja procesos
  residuales.
- **Edición de `menu.json` con el servicio corriendo**: los cambios NO aplican hasta
  reiniciar (limitación conocida, documentada con el comando exacto).
- **Crecimiento indefinido del archivo de log**: fuera de alcance en esta iteración;
  la retención queda a cargo del operador (ver Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El servicio MUST iniciar automáticamente con el encendido de la PC,
  sin intervención manual, en cada encendido.
- **FR-002**: El servicio MUST operar también cuando nadie inició sesión de
  escritorio (arranque con usuario persistente).
- **FR-003**: El daemon MUST poder ejecutar sus publicaciones aunque no exista una
  sesión de escritorio abierta (entorno gráfico virtual disponible para el
  navegador).
- **FR-004**: Al iniciar, el proceso MUST ejecutar `index.js` completo: lectura y
  validación de `menu.json`, verificación de sesión y registro de horarios.
- **FR-005**: El operador MUST poder detener, iniciar y reiniciar el proceso con
  comandos estándar, y consultar su estado, desde cualquier terminal.
- **FR-006**: Detener el proceso MUST dejar cero procesos residuales del servicio y
  del navegador (sin huérfanos).
- **FR-007**: Cada evento del daemon MUST quedar registrado en un archivo de log del
  sistema, una línea por evento con timestamp, en el formato ya establecido por el
  proyecto (`timestamp | tipo | plato | resultado | motivo`).
- **FR-008**: Ante un fallo, el servicio MUST reintentar con una política acotada:
  espera entre intentos y número máximo de intentos dentro de una ventana de tiempo;
  agotados, MUST quedar en estado terminal detenido con el motivo registrado.
  Está prohibido el reintento infinito.
- **FR-009**: El servicio MUST quedar habilitado para arrancar en cada encendido y
  MUST poder deshabilitarse con un único comando.
- **FR-010**: El arranque MUST funcionar sin shell interactivo ni sesión de terminal
  (no depende del entorno del perfil del usuario).
- **FR-011**: Todo el ciclo de vida (prerrequisitos, instalación, verificación,
  uso diario, tabla de motivos de fallo, desinstalación) MUST estar documentado en
  `OPERACION.md` dentro del repositorio, con comandos exactos y rutas.
- **FR-012**: La documentación MUST incluir la regla de recarga de configuración:
  cambios en `menu.json` hechos con la PC apagada aplican en el próximo encendido;
  si el servicio está corriendo, MUST indicar el reinicio obligatorio y advertir que
  los horarios ya pasados del día no se re-ejecutan.
- **FR-013**: El estado del servicio MUST distinguir entre «operativo», «reintentando»
  y «detenido por fallo» para que el operador sepa si debe intervenir.

### Key Entities

- **Unidad de servicio**: definición versionada que describe qué proceso ejecutar,
  desde qué directorio, con qué política de reinicio y a dónde escribir los logs.
  Atributos: identificador, binario y directorio de trabajo, política de reintentos,
  destino de logs, estado de habilitación.
- **Registro de evento (log)**: línea inmutable con timestamp, tipo de evento,
  plato (si aplica), resultado y motivo. Es la única evidencia operativa del daemon.
- **Guía de operación (`OPERACION.md`)**: documento del repositorio con los comandos
  de ciclo de vida, rutas del sistema y tabla de motivos → acción.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Tras encender la PC, el daemon está operativo (con sesión verificada y
  horarios registrados) en ≤ 3 minutos desde que el sistema queda usable, con cero
  comandos manuales.
- **SC-002**: El 100 % de los eventos del daemon quedan en el archivo de log con
  timestamp y motivo; no hay eventos sin registrar.
- **SC-003**: Tras la parada documentada, en ≤ 10 s hay **0** procesos del servicio
  y **0** procesos de navegador residuales.
- **SC-004**: Un fallo transitorio se recupera solo en ≤ 2 minutos; un fallo
  persistente produce exactamente un número finito de reintentos y luego estado
  detenido — 0 reintents infinitos en cualquier ventana de 24 h.
- **SC-005**: Siguiendo `OPERACION.md`, un operador realiza parada, arranque,
  reinicio y lectura del log en ≤ 1 minuto, sin asistencia técnica.
- **SC-006**: El 100 % de los cambios hechos en `menu.json` con la PC apagada quedan
  activos en el siguiente encendido.
- **SC-007**: Tras la desinstalación documentada, queda 0 servicio habilitado y
  0 archivo propio de la feature en la máquina.

## Assumptions

- La PC corre un sistema Linux con systemd como gestor de servicios; la plataforma
  concreta (servicio de usuario, usuario persistente, display virtual) es un
  requerimiento de la feature según la descripción de entrada y el Principio VIII
  de la constitución.
- La instalación inicial requiere privilegios de administrador (una sola vez) y
  alguien las ejecuta siguiendo `OPERACION.md`.
- La sesión de WhatsApp en `session/` ya fue autenticada manualmente por el flujo
  del README; este feature no toca la autenticación.
- El runtime de Node.js está instalado en una ruta fija de la máquina; su
  actualización queda fuera de alcance.
- El archivo de log no se rota automáticamente en esta iteración: crece y su
  retención/vaciado es responsabilidad del operador (documentado).
- Los horarios ya transcurridos el día del reinicio no se re-ejecutan (comportamiento
  existente de node-cron, sin backfill).
- **Fuera de alcance**: notificaciones de fallo (correo/mensajes), control remoto,
  rotación de logs, auto-reparación de sesión caducada, soporte de Windows/macOS,
  cambios en el código del daemon (`index.js`/`whatsappBot.js`).
