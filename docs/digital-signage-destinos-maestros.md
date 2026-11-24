# Acomodos independientes y maestros de Firmas

Ampliación posterior al PR #50. Un acomodo se crea en una biblioteca general y sus destinos se eligen después, por sucursal y por pantalla. El catálogo de salones de una sucursal sirve como referencia para capturar las filas; cambiar ese catálogo no cambia el acomodo abierto ni sus destinatarios.

## Uso previsto

- Crear un acomodo, elegir sus días, horarios, plantilla y asignaciones; guardarlo sin destinos como borrador.
- En **Destinos de proyección**, agregar una o varias sucursales. Elegir todas sus pantallas activas y futuras, o seleccionar pantallas específicas. En Plaza Estrella se pueden asignar acomodos diferentes a Arriba y Abajo sin inventar sucursales distintas.
- Las ventanas de aparición pueden restringir todavía más las pantallas de esos destinos. No amplían los destinatarios del acomodo.
- Publicar actualiza los receptores de forma atómica. Guardar una edición no cambia el snapshot publicado. Al publicar una reasignación se retira el acomodo de los destinos anteriores; despublicar lo retira de todos.
- Los acomodos anteriores conservan su sucursal y sus reglas. La acción de convertirlos a la biblioteca general conserva el destino original y las restricciones de sus ventanas. No se ejecuta ninguna migración automática de datos.
- Duplicar un acomodo independiente copia sus datos y genera referencias de filas nuevas, con destinos vacíos para revisarlos antes de publicar.

## Maestros

El selector visible de maestro usa la misma colección `certificateSigners` que Imprenta → Firmas. Reutiliza `normalizeCertificateSignerType`, `isActiveCertificatePerson` y la normalización de nombres del módulo de certificados. Incluye maestros activos de todas las sucursales, deduplica nombres y muestra sus sucursales de referencia. Excluye directores, inactivos y registros eliminados o archivados; admite las convenciones de registros antiguos sin bandera de actividad explícita.

Solo se entregan al editor identificador, nombre y sucursales. No se copian imágenes de firmas, notas ni datos de auditoría al acomodo o al player. Desactivar, renombrar o eliminar a alguien en Firmas no borra una asignación ya capturada ni modifica una publicación. Los nombres anteriores siguen disponibles como nombre guardado y permanece una opción explícita de nombre personalizado. Imprenta no se modifica y no se amplían sus permisos.

## Modelo y sincronización

`destinations` es opcional: su ausencia mantiene el modelo anterior ligado a `plantel`; su presencia, incluso vacía, identifica un acomodo independiente. Una lista vacía admite guardado pero impide publicación. Cada destino tiene `plantel` y `deviceIds`; una lista explícitamente vacía de IDs significa todas las pantallas de esa sucursal. Se validan los tipos y las referencias antes de normalizar; los destinos mal tipados nunca se convierten implícitamente en todas las pantallas.

Las publicaciones independientes utilizan `publishedPlanteles`, mientras que las anteriores conservan `publishedPlantel`. Las lecturas combinan ambas consultas, deduplican IDs y mantienen el límite de 100 acomodos por sucursal. Se protegen con guards tanto los destinos publicados anteriores como los nuevos; la actualización de snapshot, manifiestos y guards es una sola transacción. Se mantiene el máximo combinado de 390 pantallas y se incluyen los guards en el presupuesto de 400 operaciones y 8 MiB. No requiere índices compuestos nuevos: `array-contains` utiliza el índice de campo existente por defecto.

Cada manifiesto se proyecta para su receptor: muestra su plantel real, conserva solo las ventanas aplicables y omite los destinos y los IDs de otras sucursales. Alta, reubicación y revinculación recomponen los manifiestos con las publicaciones anteriores e independientes. No se modifican la identidad de las pantallas, sus playlists, la pausa/reanudación ni la caché.

## Componentes afectados y despliegue

- Interfaz: `SignageRoomLayoutsPanel`, `RoomLayoutDestinationsEditor`, `RoomTeacherPicker`, `RoomScheduleEditor` y CSS propio de Signage.
- Datos: `roomLayouts`, `roomPublication`, `roomLayoutsService`, `teachersService` y `teachers`.
- Backend: proyección y consulta de acomodos en `functions/digitalSignage.js`, consumidas por la vinculación de `signageControl`. Los otros dos callables no necesitan despliegue.
- Seguridad: cambio mínimo en `validSignageRoomLayout` para admitir un `plantel` vacío con destinos explícitos, manteniendo escritura administrativa y máximo 20 sucursales. No cambian Storage ni permisos de otras aplicaciones.

Orden compatible previsto, después de completar las comprobaciones y contar con autorización para el PR correspondiente: `functions:default:signageControl`, `firestore:rules`, después `hosting`. No desplegar todas las Functions, Storage, índices, updater ni releases de Active Classroom.

## Estado de validación

La base pasó 143 pruebas de reglas antes del ajuste. Las reglas nuevas pasan 145 pruebas. La compilación local con `vite build --configLoader native`, el lint dirigido y 134 pruebas de modelos, persistencia simulada, destinos, maestros, caché y captura pasan. Incluyen publicación multisucursal, pantallas distintas dentro del mismo plantel, reasignación/despublicación, concurrencia, alta/reubicación, límites, ausencia de datos de otros destinos y compatibilidad anterior.

Las entregas de Antigravity (interfaz) y Claude Code (modelo, publicación, backend y pruebas) fueron integradas y revisadas por Codex. Codex añadió el catálogo y selector de Firmas, reglas y pruebas de seguridad, validación defensiva y la ampliación del flujo de Chrome. No se consideran ejecutadas las pruebas que los agentes solamente escribieron.

La regresión final con emuladores y Chrome pasó 15/15 pruebas: flujo anterior completo de controles (189,5 s), 13 casos del backend —incluidos alta/revinculación/reubicación con destinos independientes— y flujo nuevo (18,8 s). En conjunto con las pruebas puras y de reglas son 294 comprobaciones aprobadas, ninguna omitida. El flujo nuevo comprueba lista de Firmas, exclusión de inactivos/directores, conservación de un nombre desactivado, cambio de catálogo sin cambiar el acomodo, guardado y copia sin receptores, destino de arriba excluyendo abajo, envío a otra sucursal, contenido diferente en la pantalla de abajo, publicación y sincronización, ventanas automáticas, desconexión y retorno a playlist. Se revisaron las capturas y la geometría 16:9; la administración no desborda a 320, 390, 768 y 1600 px en claro y oscuro.

Se corrigió una espera de prueba que trataba una opción de un select cerrado como visible. Después se interrumpió temporalmente la autorización de pruebas por límite de gasto del espacio de trabajo; la revisión volvió a estar disponible y se completó la regresión. El lint global se ejecutó y conserva el bloqueo anterior por `typescript-eslint` ausente en Active Classroom Desktop; el lint de los archivos cambiados sí pasa. No se modificó ese paquete.

Pendiente: autorización del PR y de los tres destinos de despliegue indicados arriba, entrega a producción y verificación posterior. No se han escrito datos ficticios en producción ni se ha verificado un televisor físico.

Captura de pruebas: [biblioteca y destinos por pantalla](assets/digital-signage-destinos-editor.png).
