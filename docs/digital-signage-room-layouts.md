# Acomodo de salones — operación y validación

Implementación asociada al [Issue #34](https://github.com/gonhercaral-cpu/desarrollo-proyectos/issues/34).

## Flujo administrativo

Digital Signage → **Acomodo de salones**. Seleccionar sucursal, abrir un acomodo guardado o crear uno nuevo, elegir días y bloque de clase, capturar maestros y grupos, elegir plantilla y configurar las ventanas de aparición. **Guardar borrador** conserva el trabajo; **Publicar en pantallas** actualiza los receptores. Guardar por sí solo nunca modifica la versión publicada. Despublicar retira inmediatamente el acomodo sin borrar el borrador.

El horario de clase y el horario de aparición son independientes: una ventana de 08:50–09:15 puede mostrar las clases de 09:00–10:00. Las ventanas admiten recurrencia por días, fechas particulares, prioridad, activación y una o varias pantallas del mismo plantel. La selección de todas las pantallas también cubre futuras altas del plantel. Inicio inclusivo y fin exclusivo; se admiten ventanas nocturnas.

El catálogo de salones se configura por plantel: agregar, renombrar, ordenar y habilitar. Aplicarlo al borrador es explícito y conserva maestros/grupos mediante un identificador estable de salón; las filas no coincidentes se conservan. Los nombres de maestros se capturan libremente, con sugerencias de configuraciones y asignaciones existentes. No se encontró un catálogo institucional compatible que se pudiera reutilizar sin mezclar identidades de otros módulos.

Copiar crea un borrador independiente con nuevos identificadores y destino, días y horas editables. No altera el origen ni conserva receptores de otro plantel. Los horarios habituales son atajos editables, sin imponerlos como restricciones.

## Plantillas

Plantillas reutilizables globales, con lienzo horizontal 16:9. Fondo sólido o imagen PNG/JPG/WebP de hasta 10 MB; capas de texto, campos dinámicos, rectángulos, imágenes y rejilla de asignaciones. El editor permite arrastrar, ajustar coordenadas y tamaños numéricamente, modificar fuente/color/alineación, ordenar/duplicar/eliminar capas, configurar columnas/filas y guardar o duplicar plantillas.

Los campos dinámicos de sucursal, día, clase, salón, maestro y grupo se dibujan sobre el fondo, sin editar sus píxeles. Vista previa y reproductor usan el mismo componente. Las asignaciones se paginan cada diez segundos cuando exceden la capacidad de la plantilla. La publicación guarda una copia de la plantilla: editarla no altera versiones publicadas hasta volver a publicar el acomodo.

## Reproductor y prioridades

Orden: campaña **urgente** → acomodo vigente → campaña alta/normal → playlist asignada. Entre acomodos coincidentes gana la prioridad numérica mayor y, en empate, el ID de acomodo y después el ID de regla en orden estable. La administración advierte superposiciones y maestros simultáneos, incluidos cruces de medianoche.

El acomodo conserva visible toda su ventana, independientemente de la duración de los elementos de la playlist. El video permanece montado y pausado; se conserva su posición y el tiempo restante del elemento. La restauración espera metadata cuando la fuente aún está cargando. Un cambio externo de playlist no restaura la posición de un elemento diferente. Un iframe externo se desmonta para detener actividad/audio y se vuelve a cargar al terminar; no se conserva su navegación interna.

La decisión de horario es local, al menos cada segundo, con zona IANA por plantel y soporte de horario de verano. El reloj se corrige con Date/Age de una petición HEAD al mismo origen, al iniciar, recuperar red y cada quince minutos; entre sincronizaciones usa tiempo monotónico. Se avisa si hay desfase o si solo se dispone de hora local.

Manifiesto publicado en almacenamiento local y fondos/logos en la caché existente. Un reproductor abierto puede continuar sin red con lo previamente sincronizado; al reconectar recibe cambios. No se añadió un service worker y no se garantiza arrancar la aplicación desde cero sin conexión si su código no está disponible en la caché del navegador.

## Persistencia y seguridad

Colecciones nuevas: `digitalSignageRoomConfigs`, `digitalSignageRoomLayouts`, `digitalSignageRoomTemplates` y `digitalSignageRoomDisplays`. Catálogos, borradores, plantillas y escrituras son exclusivos de administración. El player solo puede leer el documento de manifiesto de su token de pantalla existente/activa y del plantel vigente; no puede listar manifiestos ni acceder a los borradores.

La publicación/despublicación actualiza snapshot, manifiestos completos y guard de revisión por plantel en una sola transacción. El guard serializa publicaciones y altas concurrentes; las consultas se repiten dentro del callback y los documentos relevantes se leen transaccionalmente. Crear, mover o vincular pantalla guarda pantalla y manifiesto juntos; consumir el código de vinculación participa en la misma transacción. No requiere un administrador abierto ni Functions nuevas.

Storage: `digital-signage/room-templates/...`, imágenes con nombres únicos, lectura/subida por SDK reservadas a administradores, sin sobrescritura. El player usa los enlaces con token y la caché. No hay migración destructiva, borrado de contenido existente, dependencias nuevas, cambios de índices ni cambios de módulos independientes.

Límites explícitos de la primera versión: 200 salones/asignaciones, 200 capas, 100 ventanas por acomodo, 100 acomodos publicados por plantel, 390 pantallas afectadas por publicación, 900 KB por manifiesto y 8 MB por operación. Se rechazan operaciones que los superan; no se publican lotes parciales ni se truncan resultados publicados.

## Participación real

- **Antigravity CLI / Gemini**: generación y reparación de panel administrativo, editor, display compartido y CSS. Trabajó con contexto y contratos proporcionados; entregó artefactos textuales que Codex inspeccionó y materializó. No ejecutó pruebas reales de navegador ni commits. Los reportes automáticos de revisión estática no se consideran pruebas ejecutadas.
- **Claude Code**: modelos, publicación, servicios, integración de altas/vinculación, hook y player, pruebas puras y de servicios con Firebase simulado. Tres rondas reales de implementación/reparación. Reportó 49 pruebas propias aprobadas; lint/build quedaron pendientes en su checkout por dependencias ausentes.
- **Codex**: contrato y coordinación, integración de navegación, reglas y pruebas de seguridad, revisiones independientes y reparaciones de suscripción/estado/async/UI y restauración de video, límite de publicación número 101, pruebas con emuladores y Chrome, commits, integración y despliegue.

Artefactos y transcripciones de coordinación permanecen en `.orquestacion/`, ignorado por Git, sin credenciales en el repositorio.

Archivos principales:

| Área | Archivos |
| --- | --- |
| Administración y plantillas | `SignageRoomLayoutsPanel.jsx`, `RoomLayoutTemplateEditor.jsx`, `RoomLayoutDisplay.jsx`, `digital-signage-rooms.css` |
| Navegación | `DigitalSignageAdmin.jsx`, `signageConstants.js`, importación de estilos del módulo |
| Modelo y publicación | `roomLayouts.js`, `roomPublication.js`, `roomLayoutsService.js` |
| Pantallas | `SignagePlayer.jsx`, `useRoomLayoutPlayback.js`, `devicesService.js`, `pairingService.js` |
| Seguridad y pruebas | `firestore.rules`, `storage.rules`, `firebase-rules.test.mjs`, `digital-signage-room-{layouts,services}.test.mjs` |

## Validación ejecutada

- Interfaz real en Chrome: crear/editar/guardar, domingo, horas, prioridad, fecha particular y receptor persistidos; duplicar plantilla y subir fondo desde Storage; copia con IDs independientes; selector de acomodos; confirmación al salir con cambios. Editor: agregar rectángulo/texto/campo maestro, coordenadas y fuente numéricas, arrastre real, guardar/reabrir y publicación desde UI. Guardar una edición posterior muestra pendiente y conserva el snapshot anterior; despublicar vuelve a borrador. Catálogo: agregar/activar/desactivar/ordenar, guardar zona horaria y aplicar; renombrar conserva maestro/grupo por `roomId`.
- Capturas con datos ficticios: [administración](images/digital-signage-rooms-admin.jpg) y [editor](images/digital-signage-rooms-editor.jpg).
- Matriz visual 320/390/768/1600, claro/oscuro: sin desbordamiento horizontal ni excepciones JavaScript. Editor a 390 con modal de 350 px. Overlay completo y maestros visibles en 3440×1440, 1080×1920 y 1920×1080. La vista previa administrativa se inspeccionó visualmente y se corrigió su contenedor para evitar un lienzo vacío.
- Modelos, servicios simulados y regresión existente de Signage: **71/71** mediante `node --test tests/digital-signage-{model,save-queue,drive-import,room-layouts,room-services}.test.mjs`. Incluye límites exactos, zonas/DST/medianoche, prioridades, atomicidad/reintentos simulados y borrador/publicación.
- Reglas Firestore/Storage: **140/140**, exclusivamente emuladores `security-rules-audit`. Incluye privacidad de catálogos/borradores, ausencia de listados públicos, token/plantel, creación atómica pantalla+manifiesto, límites y archivos de plantillas inmutables.
- Firebase real contra emuladores Auth/Firestore/Storage en proyecto ficticio `demo-signage-rooms-34`: dos publicaciones concurrentes conservadas; fanout completo; aislamiento por sucursal; alta posterior, traslado y vinculación con manifiesto correcto; guardar borrador no altera pantalla; republicar sincroniza; despublicar retira.
- Chrome real, players sin sesión administrativa, video real grabado/importado y reloj controlado: reproducción normal antes de ventana; aparición automática 08:50 para clase 09:00; continuidad durante toda la ventana hasta 09:15; video pausado y mismo nodo/posición aproximada al reanudar; temporizador restante conservado; sucursales distintas muestran sus propios maestros; sin administrador abierto; desconexión/reconexión durante ventana.
- Chrome real: maestro nuevo solo tras publicar; superposición con ganador estable; fondo PNG subido y servido como blob en caché sin red; campaña urgente desplaza acomodo y al terminar vuelve al acomodo; despublicar el ganador restaura el siguiente. Sin excepciones JavaScript en esos players.
- Build de producción correcto. Advertencias existentes de tamaño de bundle/importación dinámica ineficaz. ESLint dirigido de archivos modificados correcto; `npm run lint` global se ejecutó y falla por `typescript-eslint` ausente en la configuración de Active Classroom Desktop, ajena a estos cambios.

No se escribieron datos ficticios en producción ni se inspeccionaron televisores físicos. Las pantallas que mantienen un bundle anterior abierto deben recargar su player una vez para recibir esta funcionalidad; después las asignaciones publicadas se sincronizan automáticamente.
