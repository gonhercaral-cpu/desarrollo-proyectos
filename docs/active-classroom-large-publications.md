# Publicación de recursos grandes

El rechazo `Máximo 250 MiB por archivo publicado.` estaba en el `Transform`
de `drive/activeClassroomFiles.js`. Era una barrera de aplicación, no un límite
de Drive binario ni de Cloud Storage. El congelado ya calculaba SHA-256/MD5 por
stream; no había un Buffer completo del archivo. Storage también se leía por
stream, pero se descargaba y volvía a subir innecesariamente.

## Transferencia e integridad

- Drive binario usa `files.get(alt: media, responseType: stream)` y upload
  por stream con backpressure y CRC32C. SHA-256 y MD5 se calculan incrementalmente.
  Se comprueban tamaño anunciado, tamaño almacenado, MD5 cuando existe y
  versión/ACL del original antes y después de leerlo.
- Storage usa `File.copy` (rewrite server-side), con generación de origen fija
  y precondición de creación. Después lee la copia por stream para SHA-256;
  valida tamaño y checksums GCS contra el origen. No descarga/resube el archivo.
- Las copias son privadas. Los tokens `firebaseStorageDownloadTokens` se
  eliminan explícitamente tanto al copiar como al escribir metadata final.
- Derivados PDF/PNG ya procesados se conservan exactamente, sin convertirlos
  nuevamente. Publicar verifica disponibilidad, generación, tamaño, MIME y hash
  de todos los archivos entregados, incluyendo cada página PNG.
- El descriptor Desktop conserva schemaVersion 2, endpoint, nombre, MIME,
  path, generación, tamaño, SHA-256, MD5/CRC32C disponibles y fecha de captura.

## Jobs y atomicidad

`publishActiveClassroomUnit` valida el borrador, crea un job y devuelve su ID.
Cloud Tasks invoca `publishActiveClassroomUnitResources`, un recurso por tarea.
La UI escucha `publicationJob` de la Unit y muestra `Publicando recursos…`
con recursos completos/total. Estados: pending, publishing, ready, failed.

El job guarda revisión y recursos originales. Cada paso comprueba que siguen
vigentes. Solo la transacción final crea el manifest, actualiza publishedVersion,
marca ready y retiene originales. Un fallo no modifica el borrador ni activa
una versión parcial. Un reintento reutiliza únicamente snapshots completos y
verificados. Las copias incompletas se eliminan; un paso reejecutado después de
timeout elimina su propio objeto no registrado antes de volver a copiar.
Snapshots completos de pasos previos quedan como caché reutilizable, sin hacer
visible una publicación parcial.

Los pasos duplicados no repiten transferencias confirmadas. Una lease impide
ejecutar simultáneamente el mismo paso. Si falla el enqueue del siguiente paso,
Cloud Tasks reintenta el anterior y vuelve a encolar el paso durable pendiente.
Si falla el enqueue inicial, el mismo borrador permite repetir la solicitud.

## Límites

`drive/activeClassroomPublicationLimits.json` centraliza el límite operativo de
10 GiB por archivo para publicación y caché Desktop. Acota almacenamiento local,
tráfico y trabajo de integridad por tarea; no corresponde al máximo del proveedor.
Stream Node tiene highWaterMark de 64 KiB; no conserva el archivo completo.
Upload usa una sesión resumable GCS y un PUT con cuerpo Readable mediante HTTP
nativo de Node, con backpressure y cancelación directamente sobre el socket. CRC32C se calcula por stream
y se compara con Storage. Un fallo aborta el HTTP, destruye los streams y cancela
la sesión; el job reintenta desde el inicio. La URI privada de sesión nunca se
guarda en manifests ni se registra en logs.
Cada tarea tiene 1 GiB de RAM, concurrencia 1 y timeout
de 1800 s; la transferencia aborta a los 1680 s para permitir limpieza y registrar
un fallo explícito. Una Unit con varios archivos usa varias tareas, no un único
timeout compartido de 540 s.

Cloud Storage permite objetos de hasta 5 TiB:
<https://docs.cloud.google.com/storage/quotas>.
Cloud Tasks/Functions limita cada tarea a 30 minutos:
<https://firebase.google.com/docs/functions/manage-functions>.
Errores `exportSizeLimitExceeded` y HTTP 413 del proveedor se devuelven como
resource-exhausted explícitos. Exportaciones nativas de Workspace conservan sus
límites reales; no se confunden con Drive binario.

La carga manual web/reglas Storage y la conversión Office conservan sus barreras
independientes de 250 MiB. Este cambio permite publicar recursos grandes de Drive
binario y Storage ya existente; no amplía el presupuesto de LibreOffice/PDF ni
las reglas de carga manual. Conversión Office usa archivos temporales; su análisis
PDF/Office tiene requisitos distintos al congelado por stream.

## Despliegue y Desktop

Desplegar en codebase drive:

```powershell
firebase deploy --only functions:drive:publishActiveClassroomUnit,functions:drive:publishActiveClassroomUnitResources,functions:drive:processActiveClassroomDocument,functions:drive:activeClassroomPublicationFile
```

Habilitar Cloud Tasks API. Identidad de ejecución necesita Cloud Tasks Enqueuer
y permiso de invocación de la tarea; conceder permisos sobre esa cola/servicio,
según <https://firebase.google.com/docs/functions/task-functions#iam_permissions>.
La tarea permanece privada. Publicar también el build web con progreso.
No cambian reglas Firebase, autenticación, Player ni segunda pantalla.

Identidad de ejecución verificada:
`826143652602-compute@developer.gserviceaccount.com`. Cloud Tasks Enqueuer se
concede sobre la cola `publishActiveClassroomUnitResources`; Cloud Run Invoker,
sobre el worker privado; Service Account User, sobre su propia identidad OIDC.
El servicio no concede acceso a `allUsers`. Prueba de dispatch recibida: HTTP 204.

Despliegue realizado el 2026-10-06 en `sistema-desarrollo-proyectos`: las cuatro
Functions anteriores, Cloud Tasks API/cola/IAM y Hosting. Worker ACTIVE con
1024 MiB, concurrencia 1 y timeout 1800 s; callable ACTIVE con timeout 60 s.
Hosting devuelve HTTP 200 y sirve el nuevo build con progreso.

Desktop requiere recompilar `.deb`: validadores TypeScript/Rust y caché antes
rechazaban más de 250 MiB. Siguen descargando a temporal por bloques, verificando
tamaño/SHA-256 y activando mediante rename final del manifest.

## Pruebas reproducibles

```powershell
$env:XDG_CONFIG_HOME = Join-Path (Get-Location) ".firebase/cli-config"
firebase emulators:exec --config firebase.rules-test.json --project security-rules-audit --only firestore,storage "node --test --test-concurrency=1 tests/active-classroom-large-publication-emulator.test.cjs tests/active-classroom-unit-emulator.test.cjs tests/active-classroom-office-emulator.test.cjs tests/active-classroom-slides-emulator.test.cjs"
npm --prefix active-classroom-desktop run test:offline
```

Los archivos grandes se generan en bloques de 64 KiB. Drive remoto se sustituye
por un Readable; Firestore, Storage y la copia rewrite usan los SDK/emuladores
reales. Prueba de 300 MiB verifica bytes almacenados por lectura incremental;
la de 251 MiB comprueba server-side copy sin abrir stream del origen.
No constituye una prueba de cuotas, permisos Cloud Tasks ni latencia de producción.

Validación local: 20/20 pruebas de emuladores, 29/29 pruebas offline Desktop,
build web y build frontend Desktop correctos. Archivo de 300 MiB con SHA-256
`681522b4162e1e3345c0016e2bfcd5336815a569f62d8f73eb1bb1f0c5d7bc3f`;
crecimiento máximo de memoria externa del proceso emisor: 1,2 MiB. Copia
Storage de 251 MiB y conservación de derivado de 300 MiB verificadas.
Lint de archivos del cambio pasa; lint global mantiene errores anteriores
en otros módulos. Desktop se versiona 1.0.2; el build nativo se ejecuta en Ubuntu
22.04 mediante `scripts/active-classroom-linux-cloudbuild.yaml`, dentro del mismo
proyecto Firebase. Solo se envían fuentes Desktop, límites y fixtures de manifest;
no se envían credenciales ni variables de entorno. El instalador y SHA-256 quedan
como artefactos privados hasta descargarlos para entregar al usuario.

Prueba adicional contra GCS real completada: stream sintético de 300 MiB y copia
server-side de 300 MiB, SHA-256
`461adf920fda37cc3db5bb2a3ea79304056dd1029019f20837f0dafe6c6af375`, tamaño,
generación y ausencia de tokens públicos verificados. La copia no abrió stream
del origen. Fixtures privados eliminados; no se modificaron Units ni documentos
Firestore. Este smoke comprueba Storage real; el Readable sustituye al origen
Drive, así que no equivale a una descarga autenticada real de Drive.
Repetido en Cloud Build con Node 24 e identidad de ejecución del proyecto:
`120aa34c-80fb-4dc7-98a8-34e7481e6da6`, SUCCESS. Mismo SHA-256 de 300 MiB;
streaming, server-side copy y limpieza completos.

Build Ubuntu 22.04: 29 tests offline, 22 de identidad, 20 Player, 18 proyección,
2 release y 18 Rust pasan. Test Rust adicional verifica caché/activación de
300 MiB; un test de llavero marcado ignored no se ejecuta en este build.
Paquete `Active Classroom_1.0.2_amd64.deb`, 7.497.868 bytes, dependencias Debian
y metadata verificados. SHA-256:
`d775020af24d04c664b1d0c35dd5fba6393a55ff5003929dcde885d1ed622885`.
Cloud Build `9150988e-eac3-46fc-939b-ff514037da54` terminó compilación/tests
correctamente, pero marcó fallo al entregar artefactos después de subir el `.deb`.
El paquete se recuperó de Storage, se verificó su MD5 remoto y se guardó SHA-256
junto al instalador. El YAML utiliza ahora transferencia explícita `gcloud storage cp`.
Entrega local en `releases/active-classroom/1.0.2/`; esos binarios no se versionan.
