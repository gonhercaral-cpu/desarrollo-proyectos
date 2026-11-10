# Publicación de recursos grandes

Este documento describe el flujo de publicación de Active Classroom implementado
en el repositorio. Los límites y opciones indicados son los declarados por el
código; no certifican la configuración ni el estado de un entorno desplegado.

## Alcance y límites

[activeClassroomPublicationLimits.json](../drive/activeClassroomPublicationLimits.json)
centraliza los límites de publicación. El validador de manifiestos Desktop
([manifest.ts](../active-classroom-desktop/src/offline/manifest.ts)) y la caché
nativa ([offline_cache.rs](../active-classroom-desktop/src-tauri/src/offline_cache.rs))
leen el mismo límite por archivo.

| Capa | Límite declarado | Alcance |
| --- | --- | --- |
| Archivo publicado y caché Desktop | 10 GiB (10.737.418.240 bytes) | Límite operativo por archivo; no es una cuota del proveedor ni una garantía de rendimiento. |
| Stream de transferencia Node | `highWaterMark` de 64 KiB | Umbral de backpressure; no representa toda la memoria usada por el proceso. |
| Paso de publicación | Señal de cancelación a los 1680 s (28 min) | Deja un margen nominal de dos minutos respecto al timeout del worker para limpieza y registro del fallo. |
| Worker de Cloud Tasks | 1800 s, 1 GiB de memoria, concurrencia 1 | Opciones de la función; la cola permite hasta 5 dispatches concurrentes. |
| Callable de inicio | 60 s | Inicia o recupera el trabajo; no transfiere todos los archivos en una sola llamada. |
| Carga manual web y reglas Storage | Menos de 250 MiB | Rechazan también el tamaño exactamente igual a 250 MiB. |
| Conversión Office | Hasta 250 MiB y 200 páginas | Presupuesto separado de la publicación de archivos ya preparados. |
| Manifiesto de Unit | Hasta 200 recursos entregados y 200 diapositivas | Las páginas PNG, estados y assets incorporados cuentan para el límite de recursos. |
| Índice MP4 `moov` que debe reubicarse | Hasta 64 MiB | Límite de metadatos de fast-start; no es el tamaño máximo del video. |

Las opciones del worker están en [drive/index.js](../drive/index.js). La carga
manual está limitada en el [servicio web](../src/active-classroom/services/activeClassroomService.js)
y en [storage.rules](../storage.rules); el conversor mantiene sus propios
presupuestos en [converter.py](../active-classroom-processor/converter.py).
Poder publicar un archivo grande de Drive binario o de Storage existente no
amplía los permisos de carga manual ni los límites de conversión o exportación.

## Congelado de archivos e integridad

[activeClassroomFiles.js](../drive/activeClassroomFiles.js) prepara snapshots
privados e inmutables bajo `active-classroom/publications/files/`:

- **Drive binario:** abre `files.get(alt: media)` como stream y escribe mediante
  una sesión resumable de Storage y un PUT HTTP con backpressure. Calcula
  SHA-256, MD5 y CRC32C incrementalmente; compara el tamaño anunciado cuando
  existe, el tamaño almacenado, MD5 cuando está disponible y CRC32C. Comprueba
  los metadatos/versiones disponibles y la posibilidad de descarga antes y
  después de leer el original. Requiere una señal estable de origen: versión,
  fecha de modificación o MD5.
- **Storage:** fija la generación del original y usa `File.copy` con precondición
  de creación del destino. Compara tamaño y checksums de Storage con el origen;
  lee la copia por stream para calcular SHA-256. No descarga y vuelve a subir el
  original por el proceso Node.
- **Derivados procesados:** [activeClassroomProcessing.js](../drive/activeClassroomProcessing.js)
  prepara o reutiliza primero el snapshot original de Office y comprueba los
  metadatos de generación, tamaño, SHA-256 almacenado y tipo de contenido de los
  derivados PDF/PNG, sin reconvertirlos. Incluye páginas, estados de revelado y
  verificación de assets de animación. Google Slides usa su propia verificación.
  La selección final de assets depende del contenido e interacciones de la Unit.

Las escrituras usan `private, no-store` y eliminan
`firebaseStorageDownloadTokens`. La URI privada de la sesión resumable no se
persiste ni se registra; ante un fallo se intenta cancelar la sesión y limpiar
el objeto incompleto. No se acumula el archivo completo en un Buffer.

El registro `activeClassroomFileSnapshots` permite reutilizar snapshots completos
de la misma fuente. Antes de reutilizarlos, `verifyDownload` consulta los
metadatos de la generación fijada y contrasta tamaño, MIME y SHA-256 almacenado.
**Esta comprobación no vuelve a calcular el hash de todos los bytes.** El hash
se calcula al preparar el snapshot; la descarga Desktop comprueba después el
tamaño y SHA-256 de los bytes recibidos.

El manifiesto de publicación usa `schemaVersion: 2`. Cada descriptor `download`
incluye endpoint, nombre, MIME, path, generación, tamaño, SHA-256, MD5/CRC32C
cuando están disponibles y fecha de captura. El endpoint
`activeClassroomPublicationFile` sirve la generación fijada con autorización y
soporte de rangos HTTP; véase [activeClassroomDesktop.js](../drive/activeClassroomDesktop.js).
No entrega una URL pública permanente del objeto.

### Entrega de video MP4

[activeClassroomVideoDelivery.js](../drive/activeClassroomVideoDelivery.js) aplica
la política `mp4-faststart-co64-v1` a `video/mp4`. Si el contenedor necesita
fast-start, genera otro objeto privado colocando `moov` antes de los datos y
reescribiendo offsets como `co64`; las muestras codificadas se transmiten sin
recodificar. Conserva el snapshot original y registra el derivado en
`activeClassroomVideoSnapshots`, con sus propios tamaño, generación y checksum.
La promoción a `co64` puede aumentar el tamaño; el descriptor del derivado
también debe respetar el límite de 10 GiB.

Un MP4 con `moov` ya anterior a `mdat`, o con las marcas de fragmentación
reconocidas, conserva sus bytes. Contenedores inválidos o estructuras no
soportadas pueden impedir la preparación. El límite de 64 MiB se aplica al
`moov` que necesita reubicarse; los datos del video siguen pasando por stream.
Si ese índice supera el límite, o hay más de 10.000 cajas de nivel superior,
falla la preparación y no se continúa publicando el original como alternativa;
el snapshot original se conserva. La preparación del original y del derivado
fast-start comparten la misma señal de cancelación de 1680 s por recurso.
Este ajuste del contenedor no garantiza compatibilidad de todos los códecs.

## Trabajos, reintentos y activación atómica

[activeClassroomPublicationJobs.js](../drive/activeClassroomPublicationJobs.js)
implementa `publishActiveClassroomUnit` y el worker
`publishActiveClassroomUnitResources`. Publicar exige el permiso
`publishVersions`; el worker vuelve a consultar el perfil del solicitante en
cada paso.

1. El inicio valida disponibilidad de recursos y condiciones de publicación,
   exige la revisión esperada del borrador y crea un trabajo en
   `activeClassroomPublicationJobs`. Si ya existe uno `pending` o `publishing`,
   lo reutiliza. La tarea contiene solo `jobId` y `step`.
2. Cada paso prepara un recurso y persiste su descriptor y el siguiente paso.
   Antes de hacerlo revalida revisión, recursos y permisos. Un token y una lease
   de 1800 s protegen el paso frente a ejecuciones simultáneas.
3. Un paso final verifica las generaciones entregadas, incluidas páginas,
   revelados y assets de animación, y llama a
   [activeClassroomUnit.js](../drive/activeClassroomUnit.js). La transacción final
   revalida el borrador y los recursos, crea el manifiesto, actualiza
   `publishedVersion`, marca el trabajo `ready` y retiene los originales.
   Si el contenido coincide con la versión anterior, devuelve `unchanged`
   y no crea otra versión.

El borrador no se reemplaza ni se activa una versión parcial si falla la
preparación. Snapshots completos de pasos anteriores pueden quedar como caché
reutilizable. El objeto de staging determinista de un paso se puede limpiar al
repetirlo si todavía no tiene registro completo.

Hay dos mecanismos de reintento distintos:

- Los fallos capturados de transferencia, validación o permisos dejan el trabajo
  en `failed` con un error explícito; el worker retorna y el usuario debe volver
  a solicitar la publicación. No todos los fallos activan un reintento automático.
- Si falla el enqueue del siguiente paso, el error sale del worker. Cloud Tasks
  puede reintentar la entrega anterior. Los errores al adquirir la lease
  (incluida una lease aún vigente) y al reencolar un paso repetido también quedan
  fuera del manejador de fallos. Si el paso ya avanzó, la entrega repetida detecta
  ese avance durable y encola el pendiente sin repetir la transferencia
  confirmada. Las opciones de cola declaran hasta 10 intentos, con backoff de
  60 a 600 s. Si falla el enqueue inicial y el trabajo sigue `pending`, se marca
  `failed` y se permite repetir la solicitud.

La [UI de Unit](../src/active-classroom/components/UnitEditor.jsx) observa
`publicationJob` y muestra `Publicando recursos…` con recursos completos/total.
Los estados son `pending`, `publishing`, `ready` y `failed`. Completar todos los
recursos todavía requiere el paso final para activar la publicación.

El trabajo inicial y el manifiesto tienen cada uno un presupuesto de 700.000
bytes JSON. Son límites independientes del tamaño de los archivos. El control
del trabajo se ejecuta al crearlo; no se repite cuando se añaden los descriptores
de `downloads` durante los pasos siguientes.

## Drive nativo y caché Desktop

[activeClassroomDriveContent.js](../drive/activeClassroomDriveContent.js)
distingue binarios de documentos nativos de Workspace. Los errores del proveedor
`exportSizeLimitExceeded` y HTTP 413 se traducen a `resource-exhausted`; el límite
operativo de 10 GiB no elimina restricciones de exportación. Google Slides usa
su flujo de procesamiento específico; no se debe tratar como un PPTX binario
descargable por `alt: media`.

Desktop descarga a objetos temporales por bloques, valida tamaño/SHA-256 antes
de confirmar cada objeto y activa la versión mediante el rename final del
manifiesto. Una actualización incompleta no sustituye la versión activa. El
inventario rápido de caché consulta presencia y tamaño; no equivale por sí solo
a verificar íntegramente los bytes.

## Validación local reproducible

Desde la raíz del repositorio, con Node compatible con los paquetes, Java 21 y
Firebase CLI disponibles en `PATH`. Si faltan dependencias, ejecutar `npm ci`,
`npm --prefix drive ci` y `npm --prefix active-classroom-desktop ci`.
Los comandos son compatibles con shells de macOS/Linux:

```sh
node --test --test-concurrency=1 tests/active-classroom-unit.test.cjs tests/active-classroom-video-delivery.test.cjs

XDG_CONFIG_HOME="$(mktemp -d)" firebase emulators:exec \
  --config firebase.rules-test.json --project security-rules-audit \
  --only firestore,storage \
  "node --test --test-concurrency=1 tests/active-classroom-large-publication-emulator.test.cjs tests/active-classroom-unit-emulator.test.cjs tests/active-classroom-video-emulator.test.cjs"

npm --prefix active-classroom-desktop run test:offline
```

La configuración local es [firebase.rules-test.json](../firebase.rules-test.json)
(Firestore 8180, Storage 9299). Los emuladores deben tener esos puertos libres.
El perfil temporal de Firebase CLI evita depender de una sesión de producción.

La [prueba de publicación grande](../tests/active-classroom-large-publication-emulator.test.cjs)
genera datos por bloques: verifica un stream de 300 MiB, copia Storage de
251 MiB, integridad de bytes, conservación de derivados, limpieza, reintentos,
duplicados y edición concurrente. Drive se sustituye por un `Readable` y el
dispatch de tareas por una cola en memoria; Firestore y Storage usan emuladores.
Las [pruebas de video](../tests/active-classroom-video-emulator.test.cjs) cubren
además el congelado y la entrega MP4.

Estas comprobaciones no certifican IAM, cuotas, dispatch real de Cloud Tasks,
descarga autenticada de Drive ni latencia de producción. Los resultados de una
ejecución deben registrarse en el PR correspondiente; no se consideran vigentes
los benchmarks, instaladores ni despliegues históricos del documento recuperado.
