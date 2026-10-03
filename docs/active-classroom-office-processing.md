# Procesamiento Office de Active Classroom

## Arquitectura

Cloud Run privado `active-classroom-office`: Python 3.12, LibreOffice headless,
pypdf y fuentes libres. Concurrencia 1, 2 CPU, 2 GiB, máximo 2 instancias;
escala a cero. Desktop no instala conversores. Imagen construida y probada
por el mismo workflow Linux existente, sin credenciales CI.

`processActiveClassroomDocument({unitId, resourceId, expectedRevision})`
requiere administrador activo. Reutiliza `createPublicationFiles`: ACL Nube AES,
revisión Drive y snapshot SHA-256 privado. Functions registra trabajo y recurso
como `pending`, `processing`, `ready` o `failed`; un lease permite reintentar
solicitudes interrumpidas después de nueve minutos. Revocación de equipo no cambia.

Funciones invoca Cloud Run con ID token de servicio y audiencia exacta. Solo esa
identidad tiene `roles/run.invoker`. Procesador usa cuenta propia sin roles de
Drive, Firestore ni Storage. Recibe dos capacidades V4 de diez minutos, internas:
lectura de un snapshot/generación y escritura de un objeto nuevo con
`x-goog-if-generation-match: 0`. Nunca llegan al navegador, Desktop ni manifest.
No se abre bucket ni se cambia su modalidad IAM. Referencias:
[autenticación entre servicios](https://cloud.google.com/run/docs/authenticating/service-to-service),
[URLs firmadas](https://cloud.google.com/storage/docs/access-control/signed-urls),
[precondiciones](https://cloud.google.com/storage/docs/request-preconditions).

## Conversión y publicación

PPT/PPTX y exportaciones Google Slides producen un único PDF. DOC/DOCX y
exportaciones Google Docs producen PDF. Se valida firma Office, límites ZIP,
referencias externas, tamaño y SHA-256 original. LibreOffice ejecuta sin shell,
perfil temporal aislado, macros deshabilitadas y sin credenciales en su entorno.
PDF se verifica con pypdf: no cifrado, 1–200 páginas, máximo 250 MiB. Timeout
de conversión: 180 s. Fuentes Liberation, Carlito, DejaVu y Noto; documentos con
fuentes particulares pueden variar visualmente. No extracción de texto ni OCR.

Worker devuelve metadata, nunca PDF en respuesta HTTP. Functions obtiene el
objeto privado y valida firma `%PDF-`, generación, tamaño y SHA-256 completo.
Derivados usan `active-classroom/publications/files/{hash-del-intento}`, cubiertos
por reglas privadas actuales y endpoint autenticado por bloques existente.
El original Drive y snapshots anteriores permanecen intactos.

`activeClassroomProcessingJobs/{attemptId}` es exclusivamente backend. El estado
visible está en `activeClassroomResources/{resourceId}.processing`; cliente no
puede escribirlo. Borrador recibe slides consecutivas desde páginas reales, con
IDs estables por página; conserva título, notas y asociaciones de páginas
existentes. Recursos de páginas eliminadas pasan a generales. Cada procesamiento
aplicado incrementa `draftRevision`; editores concurrentes deben recargar.

Publicación bloquea todo recurso Office usado que no tenga PDF vigente. Revalida
ACL/original y fingerprint, luego congela PDF/generación/revisión exactos. Cambiar
Drive obliga a actualizar y reprocesar borrador; nunca modifica publicaciones.
Slides de presentación procesada no se agregan, eliminan o reordenan manualmente.
Títulos, notas y recursos asociados siguen editables.

## Manifest compatible

Conserva `schemaVersion: 2`, `file` original y todos los IDs actuales.
Añade `originalMime`, `deliveryMime`, `original.snapshot`, `derivative` con
revisión, versión del procesador, fingerprint, páginas, timestamps y archivo.
`download` siempre describe PDF entregado. `slides[].metadata.pageNumber` mapea
al único PDF; `metadata.delivery` incluye recurso, revisión, generación, MIME,
tamaño y SHA-256. Texto futuro queda reservado como `textExtraction: null`.
[Ejemplo Office completo](active-classroom-manifest.office.example.json).

Desktop 0.1.3 ya resuelve `download.mimeType` y usa PDF Renderer, con caché y
comprobaciones existentes. No requiere reinstalación para consumir v2.

## Despliegue

Desde PowerShell en raíz, después de CI verde:

```powershell
./scripts/deploy-active-classroom-processor.ps1
firebase deploy --only "functions:drive:processActiveClassroomDocument,functions:drive:saveActiveClassroomUnit,functions:drive:publishActiveClassroomUnit,functions:drive:refreshActiveClassroomDriveResource" --project sistema-desarrollo-proyectos
npm run build
firebase deploy --only hosting --project sistema-desarrollo-proyectos
```

Script conserva otras variables de `drive/.env.sistema-desarrollo-proyectos`,
archivo ignorado. Nuevas claves privadas/secrets: ninguno. Functions necesita
firmar con `iam.serviceAccounts.signBlob` sobre su cuenta, ya usado por activación.
No desplegar reglas: default deny protege trabajos, estado y snapshots. No se
publica automáticamente Unit 01 ni se cambia v1 durante despliegue.

## Reprocesar Unit 01 y publicar v2

1. Active Classroom / Biblioteca / Nivel 1 / Unit 01. Recargar borrador.
2. Si Drive cambió: comprobar cambios y actualizar borrador desde original.
3. Elegir PPTX existente como presentación principal; guardar borrador.
4. Pulsar **Procesar presentación**. Esperar **Procesada · N diapositivas**;
   páginas e IDs se generan desde PDF real. No introducir cantidad manual.
5. En cada recurso DOCX usado, pulsar **Procesar documento**. Si falla, revisar
   original y **Reintentar procesamiento**. Guarda cambios de asociaciones/notas.
6. Pulsar **Publicar versión**. Con v1 como única versión previa crea v2; v1
   y sus archivos originales permanecen intactos. Versiones siguientes incrementan.
7. Desktop: actualizar biblioteca, descargar v2, esperar **Local: v2**, abrir
   clase. Presentación y documentos ahora son PDF locales; v1 queda conservada.
