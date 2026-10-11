# Feature Specification: Automatizador de Estados de WhatsApp Business

**Feature Branch**: `001-whatsapp-status-automator`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description (quoted verbatim as the source of this specification):

> # Especificación Funcional (Spec) - Automatizador de Estados de WhatsApp Business
>
> ## 1. Resumen de Características (Features)
>
> **Feature 1: Módulo de Automatización del Navegador y Publicación (`whatsappBot.js`)**
> Control programático de WhatsApp Web mediante Playwright para subir imágenes de platos
> y enviarles un texto descriptivo. Requiere contexto persistente (`session/`) para no
> escanear QR repetidamente; localización de elementos por atributos estables
> (`data-icon`, `role`); cierre garantizado de recursos mediante `try/catch/finally`.
>
> **Feature 2: Gestión Centralizada de Contenido y Horarios (`menu.json` / Configuración)**
> Configuración externa que define qué platos se publicarán y a qué horas, evitando
> modificar el código fuente. Relaciona la ruta de la imagen en `assets/` con su texto
> (nombre del plato, precio y llamada a la acción); horarios modificables mediante
> formato estructurado compatible con expresiones de agendamiento.
>
> **Feature 3: Motor de Tareas Programadas y Ejecución (`index.js`)**
> Orquestador que combina el agendamiento temporal y la validación previa de recursos.
> Integración con `node-cron` para lanzar publicaciones en los horarios clave;
> validación obligatoria de existencia de imagen y texto no vacío antes de invocar al
> bot; registro detallado de logs en consola (éxitos, tiempos de espera, errores de
> selectores o fallos de red).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Publicación programada del menú sin intervención manual (Priority: P1)

Como operador del negocio gastronómico, quiero que el sistema publique por mí en los
Estados de WhatsApp Business las imágenes de los platos del día —cada una con su precio
y descripción— a las horas que yo he definido, para que la difusión del menú ocurra
incluso cuando nadie esté frente a la computadora.

**Why this priority**: Es la razón de ser del producto. Sin publicación automática y
puntual no existe valor: el operador seguiría haciendo el trabajo manual que esta
herramienta busca eliminar. Todas las demás historias son de soporte de esta.

**Independent Test**: Puede probarse por completo configurando un horario cercano y una
imagen de plato válida, esperando la hora, y verificando que el Estado aparezca publicado
sin que nadie toque el teclado.

**Acceptance Scenarios**:

1. **Given** una sesión ya iniciada y un horario configurado para las 12:00, **When**
   llega la hora programada, **Then** la imagen del plato y su texto aparecen publicados
   como Estado dentro de los 2 minutos siguientes.
2. **Given** un día con tres horarios configurados (almuerzo, cena, promoción) y ninguna
   acción del operador, **When** transcurre el día, **Then** cada horario genera su
   publicación correspondiente.
3. **Given** que la publicación de las 12:00 falló, **When** llega el horario de las
   13:00, **Then** esa segunda publicación se intenta con normalidad, sin quedar bloqueada
   por el fallo anterior.
4. **Given** que la sesión ya fue iniciada en un día anterior, **When** se ejecuta la
   publicación programada del día siguiente, **Then** no se solicita escanear ningún
   código QR ni realizar login manual.

---

### User Story 2 - Configuración centralizada de platos y horarios (Priority: P2)

Como operador, quiero definir y modificar en un solo lugar qué platos se publican
(imagen, nombre, precio y llamada a la acción) y a qué horas, para poder ajustar el menú
y las ventanas de difusión sin ayuda técnica ni edición de código.

**Why this priority**: El menú y los precios de un negocio cambian a diario; sin
configuración externa, cada cambio obligaría a modificar el programa, anulando la
flexibilidad que justifica la herramienta.

**Independent Test**: Puede probarse editando el archivo de configuración para cambiar un
precio y un horario, y verificando que la siguiente publicación use el nuevo precio a la
nueva hora, sin tocar ningún archivo de programa.

**Acceptance Scenarios**:

1. **Given** que el operador desea actualizar el precio de un plato, **When** modifica el
   valor en la configuración, **Then** la siguiente publicación muestra el precio nuevo
   sin editar código ni reinstalar nada.
2. **Given** que la publicación de cena está programada a las 19:00, **When** el operador
   la mueve a las 19:30 en la configuración, **Then** las publicaciones ocurren a la nueva
   hora.
3. **Given** un plato nuevo con su imagen y su texto, **When** el operador lo agrega en la
   configuración, **Then** pasa a publicarse en su horario sin intervención adicional.
4. **Given** la configuración actual, **When** se evalúa el vínculo de cada plato,
   **Then** cada imagen queda asociada de forma inequívoca a su propio texto de precio y
   descripción.

---

### User Story 3 - Validación previa y trazabilidad de resultados (Priority: P3)

Como operador, quiero que el sistema verifique antes de publicar que la imagen existe y
que el texto no está vacío, y que me deje un registro claro de cada intento, para que
nunca se cuelguen Estados rotos y yo pueda saber qué pasó sin ser experto técnico.

**Why this priority**: Publicar contenido incompleto daña la imagen del negocio; es un
riesgo de calidad, por eso va después de que la publicación y la configuración funcionen
pero antes de dar el sistema por terminado.

**Independent Test**: Puede probarse apuntando la configuración a una imagen inexistente y
a un plato con texto vacío, verificando que no se publique nada y que aparezca el motivo
en el registro de salida.

**Acceptance Scenarios**:

1. **Given** un plato cuya imagen no existe en la carpeta de assets, **When** llega su
   horario, **Then** no se publica nada para ese plato, se registra el motivo, y el resto
   de publicaciones del día continúa.
2. **Given** un plato con texto de precio vacío, **When** llega su horario, **Then** la
   publicación se omite y se deja constancia del error.
3. **Given** cualquier intento de publicación, **When** termina (éxito o fallo), **Then**
   queda un registro con hora, plato, resultado y motivo del fallo si lo hubo.
4. **Given** que la sesión no está disponible, **When** se llega a un horario programado,
   **Then** el sistema registra un error claro y no intenta un login interactivo dentro de
   la ejecución automatizada.

---

### Edge Cases

- ¿Qué sucede si la imagen de un plato no existe o no es legible? → Se omite esa
  publicación, se registra el motivo y se continúa con las siguientes.
- ¿Qué sucede si el texto de un plato está vacío o solo contiene espacios? → Se omite la
  publicación y se registra el error; nunca se publica contenido vacío.
- ¿Qué sucede si el texto supera el límite de caracteres que la plataforma admite en un
  Estado? → Se valida antes de publicar: se omite y se registra, en lugar de publicar un
  texto truncado que podría cortar el precio.
- ¿Qué sucede si el archivo de configuración no existe o está mal formado? → No se ejecuta
  ninguna publicación y se emite un error claro e inmediato.
- ¿Qué sucede si la sesión caducó o nunca se inició? → Se aborta la ejecución con un error
  claro que indique que debe restablecerse la sesión manualmente; nunca se pide un escaneo
  dentro del ciclo automatizado.
- ¿Qué sucede si la red está caída o WhatsApp Web responde muy lento? → El intento termina
  al superar su tiempo máximo de espera, se registra como fallo de red/timeout y se
  liberan los recursos; el siguiente horario se intenta igualmente.
- ¿Qué sucede si WhatsApp Web cambia su interfaz? → El intento falla con un registro de
  error de interfaz y no queda ninguna acción a medias.
- ¿Qué sucede si dos horarios coinciden o un intento anterior sigue en curso? → No se
  ejecutan publicaciones concurrentes; el sistema evita el solape.
- ¿Qué sucede si no hay ningún horario configurado? → El sistema queda en espera sin
  emitir errores ni publicar nada.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: En cada horario configurado, el sistema MUST publicar la imagen de un plato
  junto con su texto asociado (nombre, precio, descripción y llamada a la acción) como
  Estado de WhatsApp Business, sin intervención manual.
- **FR-002**: El sistema MUST reutilizar la sesión ya autenticada del operador entre
  ejecuciones; las publicaciones programadas MUST NOT requerir escanear un código QR ni
  ningún login manual.
- **FR-003**: El operador MUST poder dar de alta, editar y eliminar platos (imagen +
  nombre + precio + descripción + llamada a la acción) mediante un archivo de
  configuración externo, sin modificar el código del programa.
- **FR-004**: El operador MUST poder modificar los horarios de publicación en ese mismo
  archivo de configuración, usando expresiones de tiempo estructuradas y recurrentes, sin
  modificar el código del programa.
- **FR-005**: Cada plato configurado MUST tener su imagen disponible físicamente en la
  carpeta de assets y MUST quedar vinculado de forma inequívoca a su texto; los
  emparejamientos ambiguos o faltantes MUST bloquear esa publicación.
- **FR-006**: Antes de publicar, el sistema MUST verificar que la imagen exista y que el
  texto no esté vacío; si la validación falla, MUST omitir esa publicación, registrar el
  motivo y continuar con las publicaciones pendientes.
- **FR-007**: El sistema MUST NOT publicar contenido parcial o vacío bajo ninguna
  circunstancia.
- **FR-008**: Cada intento de publicación MUST finalizar dentro de tiempos de espera
  explícitos; superarlos MUST registrarse como fallo en lugar de esperar indefinidamente.
- **FR-009**: Al terminar cada intento (éxito o fallo), el sistema MUST liberar todos los
  recursos que haya consumido, sin dejar procesos activos en segundo plano.
- **FR-010**: El sistema MUST registrar en consola el resultado de cada intento (hora,
  plato, resultado y motivo del fallo), cubriendo éxitos, timeouts, errores de interfaz y
  fallos de red.
- **FR-011**: El fallo de una publicación programada MUST NOT impedir que las siguientes
  publicaciones programadas se intenten.
- **FR-012**: El sistema MUST seguir operativo ante actualizaciones visuales de WhatsApp
  Web, identificando los elementos de la interfaz por atributos estables y no por su
  apariencia gráfica, que cambia con cada actualización de la plataforma.
- **FR-013**: El sistema MUST NOT ejecutar dos publicaciones concurrentemente.
- **FR-014**: Si la sesión autenticada no está disponible, el sistema MUST abortar la
  ejecución con un error claro y MUST NOT intentar un login interactivo durante una
  ejecución automatizada.

### Key Entities

- **Plato**: Un plato del menú a publicar. Atributos: referencia a su imagen, nombre,
  precio, descripción y llamada a la acción. Relación: pertenece a uno o más horarios de
  publicación.
- **Horario de publicación**: Ventana temporal en la que se dispara una difusión.
  Atributos: expresión de tiempo recurrente y los platos que publica en ella.
- **Registro de publicación**: Constancia de un intento. Atributos: fecha y hora, plato,
  resultado (éxito/fallo) y motivo del fallo cuando exista.
- **Sesión de WhatsApp**: Estado autenticado del operador que permite las publicaciones
  desatendidas. Se conserva entre ejecuciones y no requiere re-autenticación manual en
  cada publicación.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Con sesión activa y conectividad estable, al menos el 95% de las
  publicaciones programadas de un día operativo ocurren dentro de los 2 minutos
  posteriores a su hora configurada.
- **SC-002**: El operador puede cambiar un precio, agregar un plato o mover un horario en
  3 minutos o menos, sin asistencia técnica y sin editar código.
- **SC-003**: Cero Estados publicados con imagen faltante o texto vacío en todas las
  ejecuciones del sistema.
- **SC-004**: Cero escaneos de código QR o logins manuales requeridos durante 30 días de
  operación automatizada tras la configuración inicial.
- **SC-005**: El 100% de los intentos de publicación quedan registrados con su resultado
  y, en caso de fallo, con el motivo.
- **SC-006**: Cada intento termina dentro de su tiempo máximo definido y el sistema vuelve
  a reposo sin dejar procesos activos en segundo plano.
- **SC-007**: Ante un fallo aislado, el 100% de los horarios posteriores del día se intenta
  de todos modos.
- **SC-008**: El tiempo diario que el operador dedica a publicar el menú baja a menos de
  5 minutos, dedicados únicamente a revisar o editar la configuración.

## Assumptions

- El operador posee una cuenta de WhatsApp Business verificada y realiza el escaneo
  inicial de sesión manualmente, fuera del alcance de la ejecución automatizada.
- El equipo que ejecuta el sistema cuenta con conexión a internet estable durante los
  horarios configurados.
- Las imágenes de los platos se preparan con antelación en la carpeta de assets, en
  formatos de imagen habituales, con calidad apta para Estados.
- Cada plato configurado corresponde a una publicación individual de Estado; las
  publicaciones masivas o combinadas están fuera de alcance.
- Las expresiones horarias se interpretan en la zona horaria local de la máquina donde
  opera el sistema.
- Cada horario programado se intenta una sola vez; no se define reintento automático
  inmediato tras un fallo (el siguiente horario reanuda el ciclo).
- Las publicaciones se destinan únicamente al Estado del perfil del negocio; publicar en
  grupos o a contactos individuales está fuera de alcance.
- El sistema solo crea Estados; no edita ni elimina Estados ya publicados.
- Es una cuenta y un solo operador: no hay gestión de usuarios ni permisos.
- El formato concreto del archivo de configuración, la sintaxis de los horarios y la
  estructura de módulos del programa se definen en la fase de planificación, conforme a
  la constitución del proyecto.
