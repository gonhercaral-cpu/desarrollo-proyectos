# Active Classroom web

Módulo administrativo integrado al Sistema de Desarrollo de Proyectos. Reutiliza autenticación, perfil y rol `admin` del sistema; no conserva login demostrativo ni almacenamiento local del prototipo original.

## Arquitectura

```text
Dashboard (admin)
  -> ActiveClassroomModule (carga diferida)
     -> componentes de Biblioteca / Publicaciones / Equipos / Ajustes
     -> useActiveClassroomLibrary
        -> activeClassroomService
           -> Firestore: activeClassroomFolders
           -> Firestore: activeClassroomResources
           -> Storage: active-classroom/resources/{resourceId}/{fileName}
```

- `src/active-classroom/components/`: vistas y controles aislados.
- `src/active-classroom/hooks/`: sincronización y estado de interfaz.
- `src/active-classroom/services/`: único punto de acceso Firebase.
- `src/active-classroom/utils/`: clasificación y formato de recursos.
- `src/active-classroom/styles/`: estilos responsive y dark mode del módulo.

Al primer acceso administrador se completan `Nivel 1` a `Nivel 5` y `Unit 01` a `Unit 16` dentro de cada Nivel. Nunca se sobrescribe una carpeta existente. La inicialización guarda primero los cinco Niveles y después lotes de 16 Units por Nivel; así respeta el límite de 20 lecturas de reglas por solicitud de varias escrituras.

## Permisos

- Administradores activos: leen y administran carpetas, recursos y binarios.
- Perfiles activos no administradores: leen estructura y recursos publicados.
- Borradores: solo administradores.
- Archivos permitidos: presentaciones, documentos, PDF, hojas de cálculo, imágenes, audio y video; máximo 250 MB.
- Frontend no abre listeners ni ejecuta inicialización hasta tener UID, perfil activo y rol `admin` normalizado.

Las reglas viven en `firestore.rules` y `storage.rules`. El URL de descarga no se persiste en Firestore; se obtiene desde Storage cuando un usuario autorizado abre el Inspector.

## Alcance actual

Biblioteca, niveles/Units, búsqueda, filtros, lista/cuadrícula, carga, drag-and-drop, preview, descarga, publicación, eliminación, Publicaciones, Equipos y Ajustes están integrados. Panel de anuncios, Observaciones y Sugerencias permanecen marcados como futuros porque prototipo original solo tenía navegación visual para esas secciones.

Aplicación docente Tauri original no fue modificada. Su adaptador local debe reemplazarse por lectura Firebase autenticada para consumir `activeClassroomFolders` y una consulta a `activeClassroomResources` con `published == true`.

## Hito 1: referencias de Nube AES

Dentro de una Unit, **Importar desde Nube AES** abre la raíz configurada en
`systemSettings/drive`. Permite navegar, buscar por nombre dentro de una carpeta,
seleccionar archivos de varias carpetas y registrar referencias como borradores.
Los errores se muestran por archivo; reintentar conserva los éxitos del lote.

Se reutilizan `getDriveRootSettings`, `listDriveFolder`, `getCloudFileContent` y
el cliente/credenciales/permisos de `drive/index.js`. El procesamiento por lote
vive ahora en `src/utils/driveImport.js`; la ruta previa de Digital Signage
reexporta el mismo contrato. Digital Signage continúa copiando sus assets a Storage.

La callable `importDriveFileToActiveClassroom`, en el codebase `drive`, exige
admin activo, comprueba acceso efectivo al original con
`assertCanAccessDriveItem(requireWrite: false)` y consulta metadata en Drive.
Recibe exclusivamente `driveFileId` y `folderId`; no confía en nombre, MIME,
publicación ni nivel enviados por cliente. Valida Unit y Nivel activos en una
transacción. ID SHA-256 de Unit/Drive evita duplicados concurrentes en esa Unit;
el mismo original puede referenciarse desde otras Units.

Formatos: PPT/PPTX/Google Slides, PDF, DOC/DOCX/TXT/Google Docs, MP3/WAV/M4A,
MP4/WEBM y JPG/JPEG/PNG/WEBP. Carpetas, shortcuts y otros tipos nativos no se importan.
No hay descarga ni copia de binarios al registrar; no se aplica el límite de
250 MiB de Storage a referencias. La apertura posterior depende de límites y
permisos del servicio de contenido existente y descarga el archivo a memoria.

### Contrato de recurso Drive (schemaVersion 2)

Se conserva `activeClassroomResources`, junto a recursos Storage existentes:

- `source: "drive"`, `storagePath: ""`, `driveFileId`: origen sin URL pública ni token.
- `folderId`: Unit canónica; `levelId`: Nivel validado por backend.
- `name`, `sourceName`, `mimeType`, `kind`, `sizeBytes`: metadata original;
  tamaño desconocido de Google nativo se representa con `null`.
- `driveModifiedTime`, `driveVersion`, `driveMd5Checksum`, `driveParentIds`,
  `sourceCheckedAt`: snapshot para comparación futura con el original.
- `association: { scope: "unit", presentationResourceId: null, slideId: null }`:
  recurso general. Asociaciones a diapositivas quedan reservadas; cliente no puede cambiarlas.
- `version: 1`, `published`, `publishedVersion`, `publishedAt`, `archived`:
  versión de referencia y publicación. No constituye una copia inmutable del binario.
- `createdAt/updatedAt`, `createdByUid/updatedByUid`, `createdByName/updatedByName`:
  auditoría y fechas del servidor.

Reglas bloquean creación directa de referencias y modificación de su origen,
asociación o versión. Admin activo puede publicar/despublicar con metadata de
publicación consistente, o quitar referencia. Recursos Storage antiguos mantienen
su contrato. Publicar no concede permisos adicionales de Drive: lectores deben
seguir autorizados por Nube AES para descargar el original.

Inspector carga Drive solo al pulsar **Abrir archivo**. Reutiliza descarga HTTP
autenticada; Docs/Slides emplean las exportaciones DOCX/PPTX ya existentes en Nube AES.
PDF utiliza iframe de Blob compatible con CSP; imágenes/audio/video usan Blob local.
URLs temporales se revocan al cambiar selección/desmontar. Eliminar referencia
no elimina ni modifica el original de Drive.

Pendiente: revisiones inmutables, detección periódica de cambios, asociaciones por
diapositiva y protocolo/caché de sincronización Linux. No se implementan reproductor,
segunda pantalla ni conversión/render de presentaciones.

### Validación y activación

- `npm run test:active-classroom`: clasificación, validación y contrato del importador.
- `node --test tests/digital-signage-drive-import.test.mjs tests/drive-file-content.test.cjs tests/drive-location-access.test.cjs`: regresiones compartidas.
- `tests/firebase-rules.test.mjs`: permisos y referencias Drive bajo Firestore/Storage Emulator.
- `tests/active-classroom-drive-emulator.test.cjs`: transacciones concurrentes con Firestore Emulator.
- `npm run build`, `npm run lint`: compilación y diagnóstico global.

Para activar este hito se requiere desplegar la nueva callable del codebase `drive`,
las reglas Firestore y Hosting. No requiere cambios de Storage, índices, credenciales
ni despliegue de otras Functions. En Windows, el script existente `test:rules` utiliza
una asignación Unix; ejecutar su comando `firebase emulators:exec` directamente.

## Validación

```sh
npm run test:active-classroom
npm run build
npm run lint
npm run test:rules
```

`npm run lint` revisa repositorio completo y puede reportar deuda previa fuera de este módulo. Para validar solo integración:

```sh
npx eslint src/active-classroom tests/active-classroom-utils.test.mjs
```

## Despliegue

La integración inicial cambió Hosting, reglas de Firestore y reglas de Storage.
El hito de Nube AES agrega la callable descrita arriba, sin índices compuestos nuevos.

```sh
npm run build
firebase deploy --only firestore:rules,storage,hosting
```

Para desplegar reglas sin publicar frontend:

```sh
firebase deploy --only firestore:rules,storage
```
