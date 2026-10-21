# Active Classroom: contrato web para Desktop

## Estado y modelo

- Editor existente: nombre, descripción, nivel, estado, metadata, presentación principal de Nube AES, slides manuales ordenadas, recursos generales y asociaciones múltiples. Guardar exige administrador activo y `expectedRevision`; conflicto devuelve `aborted`.
- `activeClassroomFolders/{unitId}` mantiene catálogo e IDs actuales. Primer guardado crea `activeClassroomUnits/{unitId}`; sin migración masiva.
- `activeClassroomUnits/{unitId}` contiene `draft`, `draftRevision`, `publishedVersion`, `publishedDraftRevision`, `updatedAt`, `updatedByUid`. Cambios del borrador no alteran lo publicado. Estado inactivo impide nuevas publicaciones; no retira versiones anteriores.
- `activeClassroomUnits/{unitId}/publications/{version}` contiene `manifest`, `version`, `contentHash`, `draftRevision`, `publishedAt`, `publishedByUid`. Creación transaccional; versiones nunca se sobrescriben. Reintento con contenido idéntico devuelve la versión existente.
- Recursos conservan IDs actuales en `activeClassroomResources`. Importación Drive guarda referencias. Publicación materializa bytes en Storage privado, con SHA-256 y generación exacta; reutiliza el índice privado `activeClassroomFileSnapshots` por identidad/versión de origen. Recursos publicados quedan retenidos contra borrado cliente.
- Slides: `slideId` estable; `index` consecutivo desde cero; `metadata.pageNumber` desde uno; `resourceIds` conserva orden. Quitar asociación no borra recurso. `mainPresentationId` referencia un elemento de `resources` y queda separado de `generalResourceIds`.

## Manifest

[Ejemplo completo](active-classroom-manifest.example.json). IDs, tamaños, generaciones y checksums de archivos del ejemplo son ilustrativos; `integrity.contentHash` sí corresponde al JSON de contenido del ejemplo.

`schemaVersion: 2`. `file` conserva identidad y metadata original; `download` describe los bytes congelados. Google Slides entrega PPTX y Google Docs entrega DOCX mediante la exportación existente de Nube AES. No hay conversión de PPTX a imágenes/PDF.

`integrity.contentHash` = SHA-256 del objeto completo menos `version`, `publishedAt`, `integrity`, serializado UTF-8 sin espacios y ordenando recursivamente claves de objetos. No ordenar arrays. Implementación de referencia: `stableStringify` en `drive/activeClassroomUnit.js`. Para validar cada archivo usar `download.checksums.sha256` sobre bytes descargados. `file.checksums.md5` describe el original Drive cuando existe; MD5/CRC32C de Storage están expresamente marcados Base64. Nunca asumir igualdad entre archivo nativo Google y su exportación.

## Autenticación

Firebase Auth del proyecto `sistema-desarrollo-proyectos`. Desktop usa identidad de equipo y `signInWithCustomToken`, sin login interactivo. Todas las peticiones de publicaciones usan `Authorization: Bearer <FIREBASE_ID_TOKEN>`. El servidor comprueba registro autorizado y generación de dispositivo en cada petición. Los clientes web humanos conservan `users/{uid}.active == true`. Ver [activación y despliegue](active-classroom-device-auth.md).

Listado/manifests mantienen acceso de lectura a perfiles humanos activos. Para humanos se vuelve a evaluar la ACL de Nube AES antes de descargar un recurso Drive. Los equipos autorizados acceden únicamente al snapshot congelado de una publicación; nunca a Drive ni al original. No se crean perfiles `users` para equipos. Revocación del equipo bloquea consultas/descargas inmediatamente, incluso con un ID token aún vigente. Una copia offline no puede recibir revocación hasta recuperar conexión.

## Endpoints exactos

Clientes de equipo reciben metadata opcional `device: { deviceId, deviceName, displayName }` junto al resultado de listado y manifest. No forma parte del manifest/publicación, no cambia su hash ni versión. Humanos y clientes antiguos mantienen contrato previo. Desktop conserva el último alias offline; `displayName` vacío usa hostname. Cambiar nombre no modifica credenciales ni ID y no necesita nueva activación.

Base producción: `https://us-central1-sistema-desarrollo-proyectos.cloudfunctions.net`

### 1. `listActiveClassroomPublications` (callable)

`POST /listActiveClassroomPublications`

```json
{"data":{"limit":25,"cursor":null}}
```

Respuesta HTTP callable bajo `result`:

```json
{"result":{"publications":[{"unitId":"level-1-unit-01","version":1,"name":"Unit 01: Greetings","levelId":"level-1","schemaVersion":2,"publishedAt":"2026-09-28T18:01:00.000Z","contentHash":"..."}],"nextCursor":null}}
```

`limit` entre 1 y 50. `cursor` es el `nextCursor` anterior. Se pagina sobre IDs de Units, incluyendo borradores que se omiten de la respuesta: continuar hasta `nextCursor == null`, incluso si una página viene vacía. No requiere índice compuesto. Nombre/nivel proceden de la publicación, nunca del borrador actual.

### 2. `getActiveClassroomPublication` (callable)

`POST /getActiveClassroomPublication`

```json
{"data":{"unitId":"level-1-unit-01","version":1}}
```

Respuesta: `{"result":{"manifest":{...}}}`. Omitir `version` obtiene la última; para sincronizar usar la versión exacta devuelta por listado. Las versiones históricas se consultan por número. El SDK Firebase `httpsCallable` ya maneja el sobre `data`/`result` y entrega `.data.manifest`.

### 3. `activeClassroomPublicationFile` (HTTP GET)

```text
GET /activeClassroomPublicationFile?unitId=level-1-unit-01&version=1&resourceId=drive-presentation
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

Devuelve bytes originales o exportados de esa publicación. Headers: `Content-Type`, `Content-Length`, `Content-Disposition`, `X-Content-SHA256`, `Cache-Control: private, no-store`. Resuelve la ruta y generación exclusivamente desde el manifest servidor; no acepta una ruta arbitraria, URL, ni ID Drive como destino.

Desktop recorre `manifest.resources` en orden, descarga cada `resourceId`, comprueba tamaño y SHA-256 y solo activa localmente la versión cuando tiene todos los archivos. Presentación: `mainPresentationId`; generales: `generalResourceIds`; por slide: `slides[index].resourceIds`. `download.path` es identidad interna, no URL pública ni permiso para usar Storage directamente. Desktop 0.1.3 descarga archivos grandes con rangos de hasta 4 MiB; un reintento comienza un temporal nuevo y conserva la última versión activa.

El endpoint admite CORS para clientes Desktop/web y expone headers de checksum y descarga; autorización sigue exigiendo Bearer. El prototipo Tauri existente tiene CSP limitada a su servidor local: su futura integración deberá permitir Firebase o usar HTTP nativo. Este hito no cambia configuración ni código Desktop.

Errores HTTP: 400 identificadores inválidos; 401 sesión inválida; 403 permiso/perfil; 404 Unit/versión/recurso ausente; 409 versión antigua sin snapshot; 500 fallo interno. Callables usan errores estándar Firebase. No sustituir silenciosamente un archivo de versión antigua por el actual de Drive.

## Cambios de Drive y publicación

1. Administrador abre Unit; importa/elige presentación y recursos usando selector/ACL/cliente Drive existentes.
2. Define slides y asociaciones; guarda borrador.
3. `checkActiveClassroomDriveChanges` compara `modifiedTime`, `version`, MD5, nombre y MIME. UI muestra nueva versión disponible. `refreshActiveClassroomDriveResource` actualiza referencia y revisión del borrador, nunca publicaciones.
4. `publishActiveClassroomUnit` prepara archivos fuera de la transacción, comprueba origen Drive antes/después de descargar, y verifica revisión/recursos nuevamente al crear versión. Si cambia el original, exige actualizar borrador. Si cambia otro administrador, devuelve `aborted`.
5. Una publicación completa queda disponible a Desktop. Fallo de descarga/preparación no crea publicación parcial. Copias preparadas pueden quedar sin publicación después de un conflicto; se reutilizan. No hay borrado automático que arriesgue versiones históricas.

## Despliegue

No desplegado por esta tarea. Desde la raíz:

```powershell
firebase deploy --only "functions:drive:saveActiveClassroomUnit,functions:drive:publishActiveClassroomUnit,functions:drive:checkActiveClassroomDriveChanges,functions:drive:refreshActiveClassroomDriveResource,functions:drive:importDriveFileToActiveClassroom,functions:drive:listActiveClassroomPublications,functions:drive:getActiveClassroomPublication,functions:drive:activeClassroomPublicationFile,firestore:rules,storage" --project sistema-desarrollo-proyectos
npm run build
firebase deploy --only hosting --project sistema-desarrollo-proyectos
```

Codebase `drive`, región `us-central1`, runtime Node 24. Cuenta de ejecución existente debe conservar Drive API/ACL actuales y acceso Admin a Firestore y al bucket configurado; nueva función de archivos requiere invocación HTTP pública a nivel Cloud Run/IAM para recibir Firebase ID tokens y autenticar dentro del handler (igual patrón que `driveFileContent`). No conceder acceso público a objetos Storage. Sin nuevas claves Google, dependencias ni índices compuestos.

Deploy de reglas protege documentos y snapshots; luego publicar una Unit de prueba y validar GET autenticado con una cuenta de salón. Publicaciones previas `schemaVersion:1` permanecen legibles, pero requieren nueva publicación para obtener snapshots. No reescribirlas ni migrarlas en sitio.

## Validaciones y límites

- Tests puros: `npm run test:active-classroom`; regresión Signage/Drive: `node --test tests/digital-signage-drive-import.test.mjs tests/drive-file-content.test.cjs tests/drive-location-access.test.cjs`.
- Emuladores: `firebase emulators:exec --config firebase.rules-test.json --project security-rules-audit --only firestore,storage "node --test --test-concurrency=1 tests/firebase-rules.test.mjs tests/active-classroom-unit-emulator.test.cjs tests/active-classroom-drive-emulator.test.cjs"`.
- Máximo 200 slides, 200 recursos por publicación, 700 KB por borrador/manifest, 250 MiB por archivo; callable publicación 540 segundos. Para una Unit que exceda tiempo/límites, reducir contenido; procesamiento asíncrono queda fuera del MVP.
- Exportación nativa Google conserva el límite de Drive `files.export` (10 MB; documentado también en tipos del SDK instalado). Subir un PPTX/PDF binario es alternativa cuando la exportación nativa exceda ese límite.
- No extracción automática de páginas PDF: cantidad/orden manuales, con `pageNumber`. Linux tendrá que interpretar PDF o disponer de un renderizador para PPT/PPTX; no hay slides visuales convertidas.
- Pruebas de Drive usan respuestas/streams controlados y ACL existentes; no acreditan acceso real al tenant. Hace falta prueba tras despliegue con archivos reales y perfil de salón. No impide desarrollar Linux contra el contrato/emuladores.
# Descarga por bloques (Desktop 0.1.3)

`activeClassroomPublicationFile` conserva autenticación Firebase ID token,
validación del dispositivo/versión y referencia congelada por generación.
Archivos mayores de 4 MiB requieren `Range: bytes=inicio-fin` (un rango,
máximo 4 MiB por solicitud). Cada bloque devuelve HTTP 206, `Content-Range`,
`Content-Length` del bloque y `X-Content-SHA256` del archivo completo.
Estos headers están expuestos por CORS. Rangos inválidos devuelven 416;
descarga completa de archivos grandes devuelve 409 para evitar el límite
de respuesta de Functions. Archivos pequeños conservan HTTP 200.

Desktop concatena bloques en el temporal existente, comprueba tamaño y
SHA-256 completo mediante Rust antes de activar el manifest local. Revalida
autorización en cada bloque; nunca entrega una URL pública ni un token Storage.
No cambia manifests ni publicaciones existentes.

Diagnóstico seguro: `LIST_OK`, `MANIFEST_OK`, `MANIFEST_401/403/404/5XX`,
`MANIFEST_ERROR`, `DOWNLOAD_START`, `DOWNLOAD_HTTP_xxx`, `DOWNLOAD_ERROR`,
`HASH_MISMATCH`, `CACHE_WRITE_ERROR`, `VERSION_ACTIVATED`.
Solo incluye operación, versión, HTTP y número de bytes; omite credenciales,
identidades, nombres, URLs y cuerpos. Un error de una Unit no invalida un
listado exitoso ni bloquea otras clases locales.
