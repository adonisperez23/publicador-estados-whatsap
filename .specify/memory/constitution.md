<!--
Sync Impact Report
==================
- Version change: unfilled template scaffold (no version) -> 1.0.0 (initial ratification)
- Modified principles: N/A (initial fill; no prior principles existed)
- Newly defined principles (Core Principles):
  - I. Persistencia de Sesión Obligatoria
  - II. Configuración Externa de Horarios
  - III. Organización Estructurada de Contenido
  - IV. Modularidad Estricta y Control de Versiones
  - V. Selectores Robustos de WhatsApp Web
  - VI. Validación Previa de Assets y Textos
  - VII. Manejo de Errores y Resiliencia
- Added sections: Project Nature and Technology Stack (replaces [SECTION_2_NAME]),
  AI Agent Conduct (replaces [SECTION_3_NAME]), Governance (replaces [GOVERNANCE_RULES])
- Removed sections: none (template placeholders only)
- Follow-up TODOs: none. All [ALL_CAPS_IDENTIFIER] placeholders resolved; no deferred slots.
- Note: this HTML comment is temporary scratch material and MUST be removed before commit.
-->

# Automatizador de Estados de WhatsApp Business Constitution

## Core Principles

### I. Persistencia de Sesión Obligatoria

- El sistema MUST operar sobre un contexto de navegador Playwright persistente
  almacenado en `session/`.
- Las ejecuciones automatizadas MUST NOT requerir autenticación manual por código QR;
  una sesión ausente o inválida es un error de configuración del operador, no una
  oportunidad de caer en login interactivo.
- El directorio `session/` y los datos sensibles del entorno se gestionan como
  credenciales: se conservan localmente y nunca se versionan.

**Rationale**: las publicaciones corren desatendidas a horarios fijos; una
re-autenticación interactiva bloquearía o silenciaría la publicación programada.

### II. Configuración Externa de Horarios

- Todos los horarios de publicación MUST definirse en una fuente de configuración
  externa (`config.json`, `menu.json` o variables de entorno), nunca incrustados en
  código fuente JavaScript.
- El operador MUST poder cambiar los horarios sin editar código ni ejecutar flujos
  de desarrollo.
- Los cambios horarios MUST permitir ajustar con sencillez las ventanas comerciales
  clave (almuerzos, cenas, promociones).

**Rationale**: los horarios del negocio cambian con frecuencia; su edición debe ser
rápida, segura y ajena a revisión de código.

### III. Organización Estructurada de Contenido

- Cada plato a publicar MUST contar con su archivo de imagen físicamente presente
  en `assets/`.
- Cada plato MUST tener un texto asociado (precio, descripción y llamada a la acción)
  vinculado por un mecanismo explícito: un archivo de configuración (ej. `menu.json`)
  o una convención de nombres estricta y documentada.
- El vínculo imagen↔texto MUST ser predecible; emparejamientos ambiguos, faltantes o
  vacíos MUST bloquear la rutina de publicación.

**Rationale**: la publicación debe ser determinista; imágenes rotas o precios
inconsistentes dañan la credibilidad del negocio.

### IV. Modularidad Estricta y Control de Versiones

- La lógica de control del navegador y automatización (`whatsappBot.js`) MUST
  mantenerse completamente desacoplada del motor de tareas programadas y de la
  definición de horarios/contenido (`index.js` y archivos de configuración).
- Ningún módulo MUST introducir preocupaciones de agendamiento en la capa de
  navegador, ni lógica de navegador en la capa de tareas.
- La carpeta que almacena el contexto de sesión (`session/`) y los datos sensibles
  del entorno MUST excluirse mediante `.gitignore`.

**Rationale**: el desacoplamiento permite que selectores, horarios y contenido
evolucionen de forma independiente y que cada cambio sea verificable por separado.

### V. Selectores Robustos de WhatsApp Web

- La interacción con la interfaz de WhatsApp Web MUST priorizar atributos estables
  (`data-icon`, `role`, atributos aria) por encima de clases CSS dinámicas u
  ofuscadas.
- Un cambio de selectores MUST justificarse por un cambio observado del DOM, no por
  intuición.

**Rationale**: WhatsApp Web publica clases CSS ofuscadas y cambiantes en cada
despliegue; los atributos estables sobreviven a esas actualizaciones.

### VI. Validación Previa de Assets y Textos

- Antes de iniciar cualquier rutina de publicación, el sistema MUST verificar que la
  imagen exista físicamente y que el mensaje de precio/descripción no esté vacío.
- Un asset inválido MUST abortar la rutina con un registro de log claro; el sistema
  MUST NOT publicar contenido parcial o vacío.

**Rationale**: fallar rápido evita publicar Estados rotos (imagen en blanco, precio
ausente), que son más costosos que no publicar.

### VII. Manejo de Errores y Resiliencia

- Todo bloque de interacción con el navegador mediante Playwright MUST implementarse
  bajo estructuras `try/catch/finally` para garantizar que el contexto y los
  procesos del navegador se cierren siempre, evitando procesos huérfanos.
- Las demoras de red o de carga de la interfaz de WhatsApp Web MUST manejarse con
  tiempos de espera explícitos, nunca con esperas indefinidas.
- Cualquier fallo MUST producir registros detallados en consola (timestamp, rutina,
  asset, motivo).

**Rationale**: las ejecuciones programadas fallan en silencio si no hay limpieza
determinista y trazas; los logs son el único canal de depuración.

## Project Nature and Technology Stack

**Naturaleza**: herramienta de automatización basada en Node.js y Playwright para un
negocio gastronómico. Publica contenido visual (imágenes de platos acompañados de sus
precios y descripciones) directamente en los Estados de WhatsApp Web a horarios
específicos, reduciendo la intervención manual y optimizando la difusión diaria del menú.

**Stack tecnológico**:

- **Runtime**: Node.js (versión LTS).
- **Automatización de navegador**: Playwright (`chromium`) con contextos persistentes
  para la sesión.
- **Gestión de tiempos/agendamiento**: `node-cron` para la ejecución automática de
  tareas programadas.
- **Control de entorno**: gestión local de archivos multimedia y variables de
  configuración.

## AI Agent Conduct

- **Respeto a la arquitectura**: el agente MUST atenerse estrictamente a la separación
  modular definida en esta constitución al proponer nuevas funciones o refactorizaciones.
- **Preservación de la configuración externa**: ante cambios en horarios o en la forma
  de cargar imágenes, el agente MUST priorizar soluciones basadas en archivos de
  configuración externos (`json` o `env`) que el usuario pueda modificar sin tocar el
  código fuente del bot.
- **Análisis previo ante cambios en el DOM**: si la interfaz de WhatsApp Web rompe los
  selectores, el agente MUST NO modificar el código a ciegas; MUST proponer la
  actualización basándose en los atributos estables permitidos por el Principio V.
- **Cero Código Sombra**: el agente MUST construir estrictamente lo documentado en
  `spec.md`. MUST NO añadir características "por si acaso" (pasarelas de pago, perfiles
  complejos, etc.).
- **Fuente de la Verdad**: si una instrucción del usuario contradice esta constitución
  o se detecta una falla lógica, el agente MUST detenerse, advertir del problema y
  solicitar actualizar el `spec.md` antes de tocar el código fuente.

## Governance

- **Procedimiento de enmienda**: toda modificación a esta constitución MUST realizarse
  mediante el flujo `/speckit.constitution`, documentarse en el Sync Impact Report y
  ser aprobada por el propietario del proyecto antes de su adopción.
- **Política de versionado**: se aplica versionado semántico — MAJOR para eliminaciones
  o redefiniciones de principios incompatibles hacia atrás; MINOR para adición o
  expansión material de principios o secciones; PATCH para aclaraciones, redacción y
  correcciones que no cambian el significado.
- **Revisión de cumplimiento**: cada spec, plan y conjunto de tareas MUST verificarse
  contra los Core Principles antes de la implementación; el trabajo no conforme MUST
  bloquearse o enmendarse. Esta constitución prevalece sobre cualquier práctica
  conflictinga documentada en otro lugar del repositorio.
- **Guía de runtime**: la orientación de desarrollo diario pertenece a `spec.md` y a
  los artefactos derivados de él, los cuales MUST NO contradecir esta constitución.

**Version**: 1.0.0 | **Ratified**: 2026-10-11 | **Last Amended**: 2026-10-11
