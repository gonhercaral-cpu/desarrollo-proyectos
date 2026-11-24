# Acomodo por horarios

Ampliación de Digital Signage → Acomodo de salones basada en la distribución de la fotografía de recepción: salones en filas, horarios en columnas y maestros o actividades en cada cruce. Se conserva la modalidad anterior, los catálogos por sucursal, las plantillas guardadas y el sistema de publicación.

## Datos y compatibilidad

La matriz se incorpora como un campo opcional `schedule` del acomodo. Contiene columnas con identificadores y horas de inicio y fin, celdas con referencias estables a la fila y columna, etiquetas reutilizables y vistas de presentación. Las filas siguen siendo las asignaciones existentes del acomodo. Los horarios y las celdas permanecen como datos editables, incluso cuando se utiliza una imagen de fondo.

Cada acomodo conserva sus días y sucursal. La copia permite preparar días o sucursales diferentes sin compartir modificaciones posteriores. Cada regla de aparición puede seleccionar una vista mediante `viewId`; ese identificador no modifica las horas de clase. La selección efectiva de la ventana se entrega al mismo componente de representación que utiliza la vista previa.

Los documentos anteriores sin `schedule` mantienen su representación original. La versión del manifiesto permanece en 1 y los cambios son aditivos. No hay migración destructiva ni escrituras de prueba en producción. Las plantillas publicadas siguen siendo snapshots: guardar un borrador o modificar una plantilla no cambia las pantallas hasta publicar de nuevo.

Se reutilizan las colecciones y las transacciones existentes. Continúan vigentes los límites de publicación por sucursal, el aislamiento entre receptores, la privacidad de borradores, los guards de concurrencia y el máximo de 900 KiB por manifiesto. La capacidad configurada de una matriz no implica que todos sus datos quepan en ese presupuesto; la publicación debe rechazar operaciones demasiado grandes sin escribir un resultado parcial.

## Reproducción

La prioridad existente se conserva: campaña urgente, acomodo vigente, otras campañas y playlist. El reproductor mantiene el contenido normal montado y pausado debajo del acomodo, con las limitaciones existentes de páginas web externas. El hook de programación transmite la vista elegida por la regla ganadora y conserva el reloj corregido, el caché y las comprobaciones de token y sucursal.

Las pantallas que todavía ejecuten un bundle anterior deben recargar su URL del reproductor una vez para incorporar la matriz. Después, la publicación se sincroniza mediante el mecanismo habitual. No se necesita revincular el dispositivo ni cambiar su playlist.

## Coordinación y evidencia

Los contratos, respuestas originales y comprobaciones de esta tarea se conservan localmente en `/private/tmp/signage-matrix-20261123/`; no forman parte del repositorio ni contienen credenciales.

El informe de implementación, validación e integración se completa al verificar los artefactos y el despliegue. Las capturas de emuladores utilizan datos ficticios y no certifican una pantalla física de recepción.

## Operación desde la administración

1. Seleccionar sucursal y acomodo, o crear uno nuevo. Pulsar **Activar Acomodo por Horarios**.
2. Editar nombre y días. En **Cuadrícula de Asignaciones**, seleccionar una celda y escribir un maestro o una actividad, aplicar etiquetas o limpiar. Las sugerencias reúnen nombres del catálogo y de acomodos anteriores.
3. Agregar, ordenar o duplicar horarios y salones. Cada horario permite editar etiqueta, inicio y fin; no queda limitado a intervalos de una hora. Copiar una columna conserva sus asignaciones. Deshacer conserva hasta 25 estados de la edición de la matriz.
4. En **Etiquetas**, crear categorías con nombre y colores. En **Vistas y Paginación**, elegir los horarios incluidos y la cantidad de filas y columnas por página. Desactivar la rotación muestra únicamente la primera página; la vista previa permite recorrer las páginas manualmente.
5. Elegir **Acomodo por horarios — Cuadrícula** o personalizar una plantilla. El editor permite agregar la capa **Cuadrícula horarios**, moverla sobre una imagen de fondo, cambiar tipografía, tamaño, colores, separación, ancho y forma del indicador de salón y redondez de las celdas. Las plantillas anteriores se conservan; para proyectar la matriz deben incorporar esa capa.
6. Revisar la vista previa 16:9, seleccionar su vista, recorrer páginas o ampliarla. Los nombres se adaptan al espacio; ante textos extensos conviene reducir filas o columnas por página para conservar la legibilidad.
7. En cada **Ventana de Aparición**, elegir su vista de horarios, días o fechas, horas de aparición y receptores. La hora de clase no determina la aparición.
8. **Guardar borrador** conserva datos sin actualizar pantallas. **Publicar en pantallas** publica el snapshot completo. Una edición posterior se identifica como pendiente hasta volver a publicar.

Duplicar/copiar permite cambiar días y sucursal y crea filas con identificadores nuevos, remapeando las celdas. Los receptores explícitos del origen no se trasladan a otra sucursal. Cambiar de sucursal o acomodo con cambios pendientes exige confirmar el descarte; la carga inicial bloquea la edición hasta recuperar los catálogos.

Cambiar a la modalidad tradicional elimina la matriz del borrador después de confirmarlo; la versión publicada permanece hasta volver a publicar. Se debe guardar cualquier edición que se quiera recuperar después de cerrar la página.

Límites explícitos: 200 filas, 48 horarios, 9600 celdas dispersas, 48 vistas, 100 etiquetas y 10 etiquetas por celda. Cada página admite 1–12 salones y 1–6 horarios, con rotación de 3–120 segundos. El borrador se acota a 400 KiB y borrador más snapshot a 900 KiB por el límite de documento de Firestore. Los límites de capacidad no garantizan que una matriz completamente llena quepa en ese presupuesto. Cada columna requiere inicio y fin distintos en el mismo día; las ventanas de aparición conservan el soporte previo de cruces de medianoche.

## Participación y revisión

- **Antigravity** entregó el componente de edición de la matriz y los parches del panel, editor de plantillas, representación compartida y CSS. La primera ejecución no pudo utilizar comandos en modo no interactivo; la entrega efectiva se obtuvo como artefactos textuales con el contexto de código autorizado. Codex los revisó y materializó. Antigravity no ejecutó pruebas de navegador ni realizó commits o despliegues.
- **Claude Code** implementó `roomSchedule.js`, la ampliación de `roomLayouts.js`, persistencia/publicación y pruebas de modelo y servicios en una copia aislada. Trabajó con herramientas de lectura y edición; las pruebas que escribió fueron ejecutadas por Codex.
- **Codex** definió el contrato compartido, actualizó la base a `origin/main` con Active Classroom 1.0.25, integró y revisó los artefactos. Corrigió edición de espacios, exclusión maestro/actividad, orden y límites de columnas, referencias a vistas eliminadas, guardado de la modalidad tradicional, selección de vistas en el hook, controles de vista previa, carga inicial y ajuste de las ocho filas. Añadió la comprobación de capa de matriz antes de publicar y ejecutó las verificaciones de navegador, seguridad, integración y despliegue.

Archivos principales:

| Área | Archivos |
| --- | --- |
| Edición y vista previa | `RoomScheduleEditor.jsx`, `SignageRoomLayoutsPanel.jsx` |
| Plantillas y representación | `RoomLayoutTemplateEditor.jsx`, `RoomLayoutDisplay.jsx`, `digital-signage-rooms.css` |
| Modelo y programación | `roomSchedule.js`, `roomLayouts.js`, `roomPublication.js`, `useRoomLayoutPlayback.js` |
| Persistencia | `roomLayoutsService.js` |
| Pruebas nuevas y ampliadas | `digital-signage-room-schedule.test.mjs`, `digital-signage-room-services.test.mjs`, `digital-signage-schedule-browser.test.cjs` |

No se modificaron fuentes de Active Classroom, Functions, reglas de Firestore/Storage, índices, dependencias ni workflows para esta actualización. No requiere migraciones ni un release de escritorio.

## Validación ejecutada

| Verificación | Resultado |
| --- | --- |
| Modelos, servicios, guardado, caché y captura de Signage | 113 pruebas aprobadas, ninguna omitida |
| Reglas Firestore/Storage, emuladores aislados | 143 pruebas aprobadas |
| Control seguro contra Firestore emulado | 12 pruebas aprobadas |
| Regresión anterior panel–Functions–player en Chrome real | Aprobada, 180,7 segundos |
| Nuevo editor–publicación–player en Chrome real | Aprobada, 14,9 segundos |
| ESLint de todos los archivos modificados | Aprobado |
| Compilación de producción | Aprobada; advertencias existentes de tamaño e importaciones dinámicas |

El flujo nuevo verifica creación desde la interfaz con ocho salones y tres columnas; escritura de «María José» conservando espacios; etiquetas creadas y aplicadas desde el editor; copiar/pegar, duplicar columna, deshacer y agregar un noveno salón; paginación manual; crear/eliminar vistas y reparar la selección de las ventanas; protección al cambiar accidentalmente de sucursal; guardar y recuperar tras recargar; copiar a otra sucursal y día remapeando celdas; personalizar forma y fuente; subir un PNG real y comprobar su decodificación; ampliar la vista previa; guardar sin alterar el snapshot; publicar y republicar; transición automática entre ventanas con vistas distintas mediante reloj controlado; desconexión/reconexión y sincronización; despublicar y recuperar la playlist asignada.

La geometría de las ocho filas se verifica dentro del lienzo; 16:9 y ausencia de excepciones JavaScript. La administración se comprueba sin desbordamiento horizontal a 320, 390, 768 y 1600 px, en claro y oscuro. Los tests puros cubren matrices mayores, orden arbitrario, límites y rechazo atómico de referencias o tamaños inválidos. Las pruebas anteriores de Chrome conservan las comprobaciones de pausa/reanudación de playlist y las seis funciones de control.

Las primeras ejecuciones de reglas sobre un entorno compartido con Functions activas sufrieron bloqueos de limpieza y reutilización de una imagen inmutable. Se resolvió ejecutando la suite completa en emuladores nuevos sin disparadores, con 143/143 aprobadas. La prueba nueva de Chrome se ajustó para mantener coherentes los relojes simulados de servidor y cliente y utilizar los nombres accesibles reales de los controles.

`npm run lint` global se ejecutó y falla por `typescript-eslint` ausente en la configuración independiente de Active Classroom Desktop. No se modificó ese paquete. Las pruebas no escribieron datos ficticios en producción. Quedan pendientes la inspección presencial del televisor Windows en kiosco y la comprobación de legibilidad a la distancia real de recepción; las pruebas de Chrome no sustituyen esa aceptación física.

Capturas con datos de prueba: [pantalla con tres horarios](assets/digital-signage-matriz-pantalla.png) y [editor integrado](assets/digital-signage-matriz-editor.png).
