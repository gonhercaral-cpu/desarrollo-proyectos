# Administración de Active Classroom

Niveles viven en `activeClassroomFolders`, con ID estable, `kind: level`, nombre,
posición y estado activo. No existe bootstrap que recree Nivel 1–5 ni Units de
ejemplo. Los registros existentes se conservan. El callable de administración
valida administrador activo; ordenar es transaccional. Eliminar requiere nivel
sin Units ni borradores que lo referencien. Desactivar impide nuevas publicaciones;
reasignar desde el editor cambia solo catálogo y borrador.

Editor muestra Nombre, Nivel y Estado. Metadata anterior permanece guardada.
`excludedResourceIds` pertenece únicamente al borrador: quitar desvincula el
archivo; reemplazar presentación limpia slides/builds del original anterior y
conserva recursos asociados como generales. Objetos Storage y referencias que
puedan pertenecer a publicaciones se retienen; no se ejecuta borrado físico de
generaciones ni garbage collection inseguro. No cambia el manifest publicado.

Importación reutiliza Nube AES, permite elegir presentación/recurso general y
procesa Office/Google Slides automáticamente. Actualizar recupera metadata desde
Drive, invalida procesamiento solo si cambió el original y reprocesa. Lotes usan
revisiones secuenciales; un fallo conserva operaciones ya completadas y permite
reintento. Ausencia/permisos se distinguen de fallo de red.

Antes de publicar se valida presentación, slides, estado activo, procesamiento
y originales. La UI identifica archivos nuevos y permite actualizar y continuar.
No se ofrece publicar bytes anteriores: el modelo actual no garantiza un snapshot
reutilizable para todos los recursos del borrador. Se conservan verificación,
transferencia incremental y activación atómica de publicaciones.

Biblioteca Desktop recibe `levels[]` adicional en `listActiveClassroomPublications`.
Manifests e IDs no cambian. Clientes anteriores ignoran metadata adicional y
reciben Units de niveles nuevos, pero 1.0.8 muestra el ID para niveles personalizados.
La adaptación de nombres/orden requiere instalar una versión Desktop actualizada
una vez; después crear/renombrar/reordenar niveles solo requiere sincronizar.
Catálogo local de nombres conserva disponibilidad offline; no toca caché de Units.

## Despliegue

Hosting: build web habitual. Functions de codebase Drive:

- `manageActiveClassroomLevel` (nueva)
- `validateActiveClassroomPublication` (nueva)
- `saveActiveClassroomUnit`
- `refreshActiveClassroomDriveResource`
- `checkActiveClassroomDriveChanges`
- `publishActiveClassroomUnit`
- `publishActiveClassroomUnitResources`
- `listActiveClassroomPublications`
- `processActiveClassroomDocument`
- `getActiveClassroomBuildPreview`

No requieren cambios de rules, índices, Cloud Run ni Digital Signage. No publicar
nuevo Desktop con la misma versión 1.0.8: se preparó 1.0.9 para updater. Este cambio no crea una release de producción.
