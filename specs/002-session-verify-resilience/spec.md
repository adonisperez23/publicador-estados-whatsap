# Feature Specification: Diagnóstico y Resiliencia de la Verificación de Sesión de WhatsApp Web

**Feature Branch**: `002-session-verify-resilience`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description (quoted verbatim as the source of this specification):

> Diagnóstico y resiliencia de la verificación de sesión de WhatsApp Web
>
> El daemon aborta al arrancar con "sesion-no-disponible" aunque el operador acaba de
> vincular la sesión (QR escaneado) y el perfil tiene datos sincronizados. La
> verificación espera un único indicador de la interfaz con un tiempo máximo fijo de
> 30 segundos: si la primera carga es lenta o WhatsApp Web cambia el DOM, se reporta
> erróneamente "sesión no disponible". Tampoco queda evidencia de qué mostró el
> navegador al fallar, por lo que no se puede diagnosticar.
>
> Como operador quiero:
> - Que la verificación distinga entre sesión caducada (pide QR de nuevo), interfaz
>   que no cargó a tiempo y cambio de interfaz, y lo comunique con claridad.
> - Que el tiempo de espera de la verificación sea configurable y respete el valor
>   que indique el orquestador.
> - Que al fallar queden artefactos de diagnóstico (captura y resumen de la interfaz
>   visible) sin exponer el contenido de la sesión.
> - Que la detección de sesión autenticada tolere cambios menores de la interfaz
>   usando varios indicadores estables alternativos.
> - Un comando manual, fuera del ciclo automatizado, para restablecer la sesión
>   escaneando el QR cuando caducó, sin pedir login nunca dentro del ciclo automático.

## Clarifications

### Session 2026-10-11

- Q: Cuando el fallo de verificación ocurre con la interfaz autenticada visible (p. ej.,
  lista de chats en "cambio de interfaz"), ¿la captura incluye esa pantalla completa, se
  omite/limita al resumen estructural, o se enmascara el contenido de la sesión? → A:
  Captura completa de la interfaz visible tal como se ve; restringida a la máquina local,
  fuera del control de versiones y nunca transmitida (el resumen estructural sí excluye
  todo contenido de la sesión).
- Q: Cuando WhatsApp Web es inaccesible por la red durante la verificación, ¿se reporta
  como una cuarta causa aparte de las tres definidas o se agrupa en "interfaz no cargó a
  tiempo"? → A: Cuarta causa explícita "error de red", con su propio mensaje y motivo de
  registro (consistente con el motivo `error-red` ya existente).
- Q: Cuando se agota el tiempo de espera con la página ya terminada de cargar pero sin
  ningún indicador visible, ¿a qué causa pertenece el fallo? → A: "Cambio de interfaz":
  si la página terminó de cargar, la ausencia de indicadores es cambio de interfaz;
  "no cargó a tiempo" queda reservado para cuando la carga no terminó dentro del plazo.
- Q: Si el operador ejecuta el comando manual de restablecimiento mientras el daemon está
  en marcha, ¿qué debe hacer el comando? → A: Negarse con un mensaje claro ("el daemon
  está en marcha") y no tocar la sesión; el operador lo reintentará después.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Detección de sesión autenticada tolerante a cambios de interfaz (Priority: P1)

Como operador, quiero que la verificación reconozca la sesión como autenticada cuando
cualquiera de varios indicadores estables de la interfaz está presente —no solo uno—,
para que una primera carga lenta o un cambio menor de la interfaz de WhatsApp Web no
provoque un aborto falso con "sesión no disponible" justo después de haber vinculado
la sesión con QR.

**Why this priority**: Es la causa directa del fallo reportado. Sin detección
resiliente, el daemon no arranca aunque la sesión sea válida y ninguna de las demás
mejoras (diagnóstico, artefactos, comando manual) llega a ejecutarse.

**Independent Test**: Puede probarse haciendo que falte —por turnos— cada uno de los
indicadores individuales (simulando un cambio de interfaz) y verificando que la sesión
sigue clasificándose como autenticada y el daemon continúa su arranque.

**Acceptance Scenarios**:

1. **Given** una sesión recién vinculada por QR con el perfil sincronizado, **When**
   el daemon ejecuta la verificación, **Then** la sesión se clasifica como autenticada
   y el arranque continúa, aunque uno de los indicadores tradicionales no esté presente.
2. **Given** que WhatsApp Web oculta o renombra un indicador tras una actualización,
   **When** la verificación evalúa el conjunto completo de indicadores, **Then** la
   detección se apoya en los indicadores restantes y no se reporta un falso fallo.
3. **Given** que la primera carga de la interfaz es lenta pero los indicadores aparecen
   dentro del tiempo de espera configurado, **When** transcurre ese tiempo, **Then** la
   sesión se clasifica como autenticada sin abortar.
4. **Given** que un indicador ya está visible, **When** la verificación lo detecta,
   **Then** el resultado se emite de inmediato, sin agotar el tiempo de espera completo.

---

### User Story 2 - Causa diferenciada del fallo y comunicación clara (Priority: P2)

Como operador, quiero que cuando la verificación falle, el sistema distinga y me
comunique claramente la causa —sesión caducada (vuelve a pedir QR), interfaz que no
cargó a tiempo, cambio de interfaz o error de red— para que yo sepa qué acción
correcta tomar en cada caso.

**Why this priority**: Sin causa diferenciada, todos los fallos se ven iguales y el
operador no sabe si debe relinkar la sesión, revisar la red o atender un cambio de la
plataforma; el diagnóstico es el segundo valor pedido y depende de que la verificación
haya podido ejecutarse (US1).

**Independent Test**: Puede provocarse cada una de las condiciones por separado
(sesión caducada, carga que excede el tiempo configurado, página cargada sin
indicadores, red inaccesible) y verificarse que la salida del sistema nombra causas
distintas en cada caso.

**Acceptance Scenarios**:

1. **Given** una sesión caducada en la que WhatsApp Web muestra el código QR,
   **When** el daemon ejecuta la verificación, **Then** el sistema reporta
   "sesión caducada" e indica que debe restablecerse con el comando manual, sin usar
   un mensaje genérico.
2. **Given** una primera carga que no termina dentro del tiempo de espera configurado,
   **When** la verificación agota ese tiempo, **Then** el sistema reporta "la interfaz
   no cargó a tiempo" e informa el tiempo de espera que se aplicó.
3. **Given** una página que terminó de cargar pero en la que no aparece ninguno de los
   indicadores esperados, **When** la verificación concluye sin detectarlos —incluso si
   lo constata al agotarse el plazo—, **Then** el sistema reporta "cambio de interfaz",
   diferenciándolo explícitamente de una sesión caducada.
4. **Given** una red caída o inaccesible, **When** el daemon ejecuta la verificación,
   **Then** el sistema reporta "error de red", diferenciándolo de una interfaz lenta o
   de una sesión caducada.
5. **Given** cualquiera de los fallos, **When** se emite el resultado, **Then**
   queda un registro con marca de tiempo y la causa, en un lenguaje comprensible para
   el operador.

---

### User Story 3 - Artefactos de diagnóstico sin exponer la sesión (Priority: P2)

Como operador, quiero que cuando la verificación falle queden guardados localmente una
captura de la interfaz visible y un resumen estructural de lo que el navegador mostró,
para poder diagnosticar el problema después —qué vio el navegador, qué indicadores
había— sin que esos artefactos expongan el contenido de mi sesión de WhatsApp.

**Why this priority**: Es lo que hace posible el diagnóstico de US2 en la práctica;
sin evidencia, la causa reportada no es verificable y cualquier fallo futuro vuelve a
ser una suposición.

**Independent Test**: Puede provocarse cada fallo y comprobarse que existen, en la
carpeta local de diagnóstico, la captura y el resumen correspondientes, y que su
revisión manual no revela contenido de mensajes ni datos de la sesión.

**Acceptance Scenarios**:

1. **Given** una verificación que falla por cualquiera de las cuatro causas, **When**
   termina, **Then** quedan almacenados localmente una captura de la interfaz visible
   y un resumen que describe el estado de la página, los indicadores evaluados y su
   resultado, y la causa del fallo.
2. **Given** los artefactos de un fallo, **When** el operador los revisa, **Then** no
   contienen cuerpos de mensajes, credenciales ni archivos de la sesión.
3. **Given** que el sistema no puede escribir los artefactos (por ejemplo, falta de
   espacio o permisos), **When** falla el almacenamiento, **Then** la causa original de
   la verificación sigue reportándose con claridad y no queda enmascarada por el error
   secundario.
4. **Given** los artefactos almacenados, **When** se inspecciona el repositorio,
   **Then** están excluidos del control de versiones y no se transmiten fuera de la
   máquina.

---

### User Story 4 - Tiempo de espera configurable respetado por el orquestador (Priority: P3)

Como operador, quiero que el tiempo de espera de la verificación sea configurable y
que el sistema use exactamente el valor que indique el orquestador —sin un tope fijo
interno que lo anule—, para poder adaptar la verificación a entornos con primera carga
lenta.

**Why this priority**: Reduce los falsos abortos por lentitud, pero su valor es
correctivo y complementario: con US1 la detección ya es resiliente; aun así, el valor
del orquestador nunca debe ser ignorado.

**Independent Test**: Puede configurarse un tiempo de espera mayor que el valor fijo
histórico y verificarse que la verificación realmente espera ese tiempo antes de
declarar fallo.

**Acceptance Scenarios**:

1. **Given** que el orquestador indica un tiempo de espera mayor al valor tradicional,
   **When** la verificación ejecuta con ese valor, **Then** espera el tiempo indicado
   y no lo reduce silenciosamente.
2. **Given** que no se indica ningún valor, **When** se ejecuta la verificación,
   **Then** se aplica el valor por defecto documentado.
3. **Given** un valor inválido (no numérico o no positivo), **When** se ejecuta la
   verificación, **Then** se aplica el valor por defecto y se deja constancia del
   problema.
4. **Given** un tiempo de espera configurado, **When** la página no termina de cargar
   dentro de ese plazo, **Then** el fallo se declara recién al agotarse el plazo y se
   comunica como "no cargó a tiempo"; si en ese mismo momento la página sí cargó y no
   hay indicadores, se comunica como "cambio de interfaz".

---

### User Story 5 - Comando manual de restablecimiento de sesión por QR (Priority: P3)

Como operador, quiero disponer de un comando manual —fuera del ciclo automatizado—
para restablecer la sesión escaneando el QR cuando esta caducó, sin que el ciclo
automático pida login jamás.

**Why this priority**: Es la vía de recuperación cuando la causa es "sesión caducada";
es operativamente esencial, pero solo se necesita cuando ya se produjo ese fallo, por
lo que va detrás de la detección y el diagnóstico.

**Independent Test**: Puede caducarse la sesión (por ejemplo, renombrando la carpeta
de sesión) y ejecutarse el comando manual, verificando que muestra el QR y que la
sesión vuelve a quedar vinculada; en paralelo, ejecutarse el ciclo automatizado y
comprobar que nunca muestra QR.

**Acceptance Scenarios**:

1. **Given** una sesión caducada, **When** el operador ejecuta el comando manual,
   **Then** se muestra el código QR para volver a vincular y, tras escanearlo, la
   sesión queda guardada para las siguientes ejecuciones automáticas.
2. **Given** cualquier resultado de la verificación dentro del ciclo automatizado
   (incluida la sesión caducada), **When** el daemon maneja ese resultado, **Then**
   nunca se muestra un QR ni se inicia un login interactivo: se aborta con la causa
   indicada.
3. **Given** que la sesión sigue siendo válida, **When** el operador ejecuta el
   comando manual, **Then** el sistema informa que no es necesario restablecerla y no
   altera la sesión existente sin que el operador confirme.
4. **Given** el daemon en marcha, **When** el operador ejecuta el comando manual,
   **Then** el comando se niega con un mensaje claro indicando que el daemon está en
   marcha, sin tocar la sesión.
5. **Given** que el comando manual termina, **When** el operador vuelve a arrancar el
   daemon, **Then** la verificación reconoce la sesión como autenticada.

---

### Edge Cases

- ¿Qué sucede si la carpeta de sesión no existe en absoluto? → Se aborta como error de
  configuración con un mensaje claro (la sesión nunca fue vinculada); no se muestra QR
  dentro del ciclo automatizado.
- ¿Qué sucede si la red está caída o inaccesible durante la verificación? → Se comunica
  como causa "error de red" (distinta de las otras) y también quedan los artefactos de
  diagnóstico disponibles para revisión.
- ¿Qué sucede si el navegador no puede siquiera iniciarse (entorno sin soporte gráfico,
  recursos insuficientes)? → No es posible tomar captura; igualmente se produce el
  resumen con el error del arranque y se reporta la causa original.
- ¿Qué sucede si el indicador aparece exactamente en el instante en que se agota el
  tiempo de espera? → Se considera autenticada: el resultado favorable prevalece
  mientras no se haya declarado el fallo.
- ¿Qué sucede si la escritura de los artefactos falla? → Se registra el problema
  secundario pero la causa original de la verificación sigue siendo la reportada.
- ¿Qué sucede si hay varios fallos consecutivos? → Cada fallo deja sus propios
  artefactos con su marca de tiempo, de modo que no se pisan entre sí.
- ¿Qué sucede si el comando manual se ejecuta mientras el ciclo automatizado está en
  marcha? → El comando se niega con un mensaje claro ("el daemon está en marcha") y no
  toca la sesión; el operador lo reintentará cuando el daemon termine.
- ¿Qué sucede si todos los indicadores están ausentes pero también falla la carga de la
  página? → Prevalece la causa que impidió observar la interfaz (error de red si la
  página no fue accesible; no cargó a tiempo si no terminó de cargar) sobre la de cambio
  de interfaz: se reporta lo que impidió observar la interfaz, no una hipótesis sobre
  ella.
- ¿Qué sucede si se agota el tiempo de espera con la página ya cargada y sin
  indicadores? → Se reporta "cambio de interfaz": la carga completada de la página prima
  sobre la expiración del plazo; "no cargó a tiempo" queda para cuando la carga no
  terminó.
- ¿Qué sucede si el valor de tiempo de espera configurado es absurdo (muy grande)? → Se
  aplica tal como lo indicó el orquestador (es su decisión operativa), pero la
  verificación sigue siendo acotada: nunca espera indefinidamente.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La verificación MUST determinar que la sesión está autenticada ante la
  presencia de cualquiera de un conjunto de al menos tres indicadores alternativos y
  estables de la interfaz; la ausencia de un indicador aislado MUST NOT producir un
  fallo si otro está presente.
- **FR-002**: Los indicadores de autenticación MUST basarse en atributos semánticos
  estables de la interfaz (roles, etiquetas accesibles, iconos identificables), no en
  clases visuales o gráficas propensas a cambiar.
- **FR-003**: La verificación MUST terminar en cuanto detecte un indicador, sin agotar
  el tiempo de espera restante.
- **FR-004**: Ante un fallo, la verificación MUST distinguir y reportar de forma
  exclusiva una de estas causas: (a) **sesión caducada** —la interfaz vuelve a solicitar
  el código QR—, (b) **interfaz no cargó a tiempo** —se agotó el tiempo de espera
  configurado sin que la página terminara de cargar—, (c) **cambio de interfaz** —la
  página terminó de cargar pero ninguno de los indicadores esperados está presente,
  incluso cuando ello se constata al agotarse el plazo—, (d) **error de red** —la
  página de WhatsApp Web no pudo alcanzarse por un fallo de conectividad—. La regla de
  desempate es: la carga completada de la página prima sobre la expiración del plazo
  para elegir entre (b) y (c).
- **FR-005**: Cada causa MUST comunicarse con una identificación distinguible y un
  mensaje en lenguaje del operador que name la causa y sugiera la acción pertinente
  (relinkar la sesión, revisar la conectividad, ampliar el tiempo de espera, atender un
  cambio de la interfaz).
- **FR-006**: El tiempo de espera de la verificación MUST ser configurable y el valor
  indicado por el orquestador MUST ser el tiempo efectivamente aplicado; MUST NOT
  existir un tope fijo interno que lo reduzca silenciosamente. Si el valor no se
  indica o es inválido, MUST aplicarse un valor por defecto documentado y dejarse
  constancia.
- **FR-007**: Cuando la verificación falla, el sistema MUST producir de inmediato dos
  artefactos locales de diagnóstico: una captura de la interfaz visible en ese momento
  y un resumen estructural que incluya la marca de tiempo, la causa, el tiempo de
  espera aplicado y el estado de cada indicador evaluado (presente/ausente).
- **FR-008**: Los artefactos de diagnóstico y los registros del sistema MUST NO
  incluir cuerpos de mensajes, credenciales ni archivos de la sesión; MUST permanecer
  solo en la máquina local, MUST excluirse del control de versiones y MUST NOT
  transmitirse fuera de la máquina.
- **FR-009**: Cuando la interfaz autenticada está visible durante el fallo, la captura
  MUST incluir esa pantalla completa tal como se ve (es la evidencia diagnóstica
  buscada), con las mismas restricciones de FR-008: solo en la máquina local, fuera del
  control de versiones y nunca transmitida fuera de ella.
- **FR-010**: Un fallo en la escritura de los artefactos MUST NOT enmascarar la causa
  original de la verificación: el sistema MUST registrar el problema secundario y
  reportar igualmente la causa del fallo de verificación.
- **FR-011**: El ciclo automatizado MUST NO iniciar nunca un login interactivo ni
  mostrar un código QR, sin importar el resultado de la verificación; una sesión
  caducada detectada en el ciclo automático MUST abortar con la causa "sesión caducada".
- **FR-012**: MUST existir un comando manual, ejecutable únicamente fuera del ciclo
  automatizado y documentado para el operador, que restablezca la sesión mediante el
  escaneo del código QR cuando esta caducó; su ejecución cuando la sesión sigue válida
  MUST informarlo y MUST NO alterar la sesión sin confirmación del operador. Si el
  daemon está en marcha, el comando MUST negarse con un mensaje claro y MUST NO tocar
  la sesión.
- **FR-013**: La verificación MUST terminar siempre dentro del tiempo de espera
  configurado (sin esperas indefinidas) y MUST liberar los recursos que haya abierto,
  tanto en el éxito como en el fallo.
- **FR-014**: Cada resultado de verificación fallida MUST quedar registrado con marca
  de tiempo y causa en el registro de eventos del sistema, de forma consistente con el
  contrato de registro existente.

### Key Entities *(include if feature involves data)*

- **Resultado de verificación de sesión**: Dictamen de una ejecución de verificación.
  Atributos: estado (autenticado / no autenticado), causa del fallo cuando exista,
  tiempo de espera aplicado, tiempo empleado, y el estado de cada indicador evaluado.
- **Artefacto de diagnóstico**: Evidencia local de un fallo. Atributos: marca de tiempo
  del fallo, causa asociada, captura de la interfaz visible y resumen estructural de la
  página. Restricción: nunca contiene contenido de la sesión; solo existe en la máquina
  local y fuera del control de versiones.
- **Configuración de verificación**: Valor del tiempo de espera que el orquestador
  indica para la verificación, o el valor por defecto cuando no se indica.
- **Sesión de WhatsApp**: Estado autenticado del operador que permite las ejecuciones
  desatendidas. Puede estar vigente o caducada; cuando caduca, solo el comando manual
  (fuera del ciclo) puede restablecerla.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los fallos de verificación identifican una de las cuatro causas
  definidas (caducada, no cargó a tiempo, cambio de interfaz, error de red) en la salida
  del sistema; cero mensajes genéricos de "sesión no disponible" sin causa
  diferenciada.
- **SC-002**: Con sesión recién vinculada, la verificación la clasifica como autenticada
  en el 100% de los casos probados en los que se oculta, por turnos, cada uno de los
  indicadores individuales (tolerancia a cambios menores de interfaz).
- **SC-003**: El tiempo de espera efectivo de la verificación coincide con el valor
  indicado por el orquestador en el 100% de las ejecuciones con valor válido; sin valor
  indicado se aplica el por defecto documentado.
- **SC-004**: Tras cada fallo de verificación, en 5 segundos o menos quedan almacenados
  localmente la captura y el resumen, y su revisión manual confirma cero contenido de
  mensajes, credenciales o archivos de sesión en los artefactos y en los registros.
- **SC-005**: Cero escaneos de QR o logins interactivos dentro del ciclo automatizado
  durante 30 días de operación, mientras que el comando manual muestra el QR en el
  100% de sus invocaciones con sesión caducada.
- **SC-006**: Ante cualquier fallo, un operador identifica la causa y la acción correcta
  en menos de 1 minuto leyendo la salida del sistema y, si hace falta, los artefactos.
- **SC-007**: Ninguna verificación dura más allá de su tiempo de espera configurado:
  cero esperas indefinidas y cero procesos residuales tras terminar, en el éxito y en el
  fallo.

## Assumptions

- El tiempo de espera se configura en la fuente de configuración externa ya usada por
  el orquestador (archivo de configuración o variables de entorno); su valor por
  defecto, cuando no se indica, es de 30 segundos.
- Las causas se comunican reutilizando el contrato de motivos de registro ya existente:
  caducada ⇒ `sesion-no-disponible` (con detalle "sesión caducada, relinkar con el
  comando manual"), no cargó a tiempo ⇒ `timeout`, cambio de interfaz ⇒
  `error-interfaz`, error de red ⇒ `error-red`; no se amplía el conjunto de motivos salvo
  que la planificación lo requiera.
- El alcance es la verificación de sesión (al arrancar el daemon) y su diagnóstico; el
  flujo de publicación de Estados no cambia, salvo compartir el valor de tiempo de
  espera si así se decide en planificación.
- Los artefactos se guardan en un directorio local de diagnóstico ignorado por el
  control de versiones, una entrada por fallo con su marca de tiempo; su retención y
  depuración corre a cargo del operador (no hay subida a servicios externos).
- La detección de "sesión caducada" se apoya en que la interfaz vuelve a mostrar la
  pantalla de código QR de WhatsApp Web.
- El comando manual se ejecuta desde la línea de comandos y se documenta en el README
  junto con el flujo de vinculación inicial; no forma parte del arranque del daemon.
- La verificación ocurre una sola vez, al arrancar el daemon y antes de registrar los
  horarios (comportamiento actual que se conserva).
- El escaneo manual del QR requiere el teléfono del operador cerca; ese paso, por
  definición, ocurre fuera del ciclo automatizado.
- Es una cuenta y un solo operador: no hay gestión de usuarios ni permisos sobre los
  artefactos de diagnóstico.
