# Google Slides en Active Classroom

## Procesamiento

`processActiveClassroomDocument` distingue el MIME del original consultado en Nube AES:

- PPT/PPTX binarios: Drive `files.get(alt: "media")`, snapshot privado y procesador Office/PDF existente.
- `application/vnd.google-apps.presentation`: Slides API `presentations.get` y `presentations.pages.getThumbnail` por página, en el orden devuelto por Google. No exporta PPTX/PDF ni modifica el original.
- PDF y DOC/DOCX mantienen el flujo anterior. Digital Signage conserva su infraestructura de exportación sin cambios.

Solicita PNG `LARGE`, **1600 px de ancho** (puede ser menor en diapositivas verticales), máximo documentado por la [Slides API](https://developers.google.com/workspace/slides/api/reference/rest/v1/presentations.pages/getThumbnail). No existe parámetro estable de 2000 px. Las imágenes representan contenido estático; no preservan animaciones ni multimedia incrustada. Esos archivos pueden seguir como recursos de la Unit.

Descarga cada `contentUrl` inmediatamente, solo desde HTTPS `googleusercontent.com`, sin redirecciones. Nunca persiste ni registra la URL temporal. Verifica PNG, dimensiones, tamaño y SHA-256 contra bytes leídos de Storage. Archivos privados en `active-classroom/publications/files/<hash>` con creación exclusiva `ifGenerationMatch: 0` y generación congelada.

Máximo 200 slides, 20 MiB por PNG y 250 MiB por presentación. Publicación permite 200 archivos en total, contando slides y recursos generales/asociados. Procesa secuencialmente, con intervalo de 1100 ms entre thumbnails y reintentos acotados para 429/5xx. Límite de ejecución 450 s dentro del timeout de Functions de 540 s. Un fallo elimina imágenes parciales del intento y conserva publicaciones previas; reintentar crea otra revisión.

Mantiene estados `pending`, `processing`, `ready`, `failed` y trabajos existentes. Comprueba revisión/orden Slides y versión/fecha Drive antes y después. Si el original cambia, requiere actualizar el borrador y reprocesar manualmente. IDs de slides y asociaciones se conservan por `pageObjectId`; al migrar slides manuales se conservan por índice. Recursos de slides eliminadas regresan a recursos generales.

## Manifest schema 2

Cada PNG es un recurso descargable con `sourceType: "google-slides"`, `originalMime: "application/vnd.google-apps.presentation"`, `deliveryMime: "image/png"`, `original.fileId`, revisión/fingerprint del procesamiento y `download` privado con generación, tamaño y SHA-256. No duplica el original en Storage.

Cada slide incluye `slideId`, `index`, asociaciones y metadata:

```json
{
  "pageObjectId": "g123_page",
  "presentationResourceId": "gs-identificador-estable",
  "pageNumber": 1,
  "storagePath": "active-classroom/publications/files/<64-hex>",
  "size": 123456,
  "sha256": "<64-hex>",
  "width": 1600,
  "height": 900,
  "delivery": {
    "resourceId": "gs-identificador-estable",
    "revision": "<uuid-intento>",
    "generation": "<generacion-storage>",
    "mimeType": "image/png",
    "sizeBytes": 123456,
    "checksum": "<64-hex>"
  }
}
```

La primera imagen reutiliza `mainPresentationId`; las demás usan IDs estables derivados del recurso original y `pageObjectId`. Una publicación congela todos los descriptores de sus PNG. Reprocesar crea rutas nuevas; jamás sobrescribe objetos/publicaciones anteriores.

Desktop **1.0.1** selecciona `metadata.presentationResourceId` y reutiliza ImageRenderer. PDF anteriores continúan usando presentación única/página. Mantiene caché, activación, sincronización y proyector. Requiere instalar nuevo `.deb` para navegar correctamente decks de imágenes.

## Despliegue

Habilitar Slides API en el proyecto de la identidad de servicio existente:

```sh
gcloud services enable slides.googleapis.com --project=sistema-desarrollo-proyectos
firebase deploy --only "functions:drive:processActiveClassroomDocument,functions:drive:saveActiveClassroomUnit,functions:drive:publishActiveClassroomUnit,hosting" --project sistema-desarrollo-proyectos
```

Reutiliza credenciales, scope `drive` y ACL actuales de Nube AES; la presentación debe seguir accesible para esa identidad. No añade secretos, cuentas de servicio ni permisos administrativos en Desktop. Cloud Run Office y reglas Firestore/Storage no cambian; rutas derivadas ya privadas. Endpoints Desktop actuales sirven los PNG congelados.

## Reprocesar Unit 01

1. Instalar Desktop 1.0.1 y desplegar backend/editor anteriores.
2. Web: Biblioteca, Nivel, Unit 01. Recargar borrador y guardar cualquier cambio pendiente.
3. Comprobar cambios de Drive. Si existe nueva versión, **Actualizar borrador desde original**; guardar antes si el editor lo requiere.
4. En presentación principal, **Procesar presentación** o **Reintentar procesamiento**. Esperar `Procesada · N diapositivas`; revisar orden y asociaciones conservadas.
5. **Publicar versión**. Crea la siguiente versión disponible; v1 y demás versiones previas permanecen intactas.
6. Desktop: **Actualizar biblioteca**, descargar nueva versión y abrir clase. La copia local anterior permanece usable hasta verificar/activar todos los PNG.

## Validación

Tests unitarios: media binaria, decks pequeños/grandes, orden, 429, fallo/reintento, corrupción, cambio durante procesamiento, URL segura y error `exportSizeLimitExceeded` explícito. Emuladores reales: Firestore/Storage, bloqueo al publicar, derivado inmutable, manifest validado por Desktop, reprocesamiento y publicaciones previas intactas. Desktop: sincronización/SHA-256, reinicio, navegación PNG y vuelta desde recurso sin Internet. CI Linux existente ejecuta estos tests junto con Rust, Tauri y `.deb`.

Slides API real y presentación de producción requieren comprobarse después del despliegue; los tests automatizados sustituyen únicamente Google, no Firestore/Storage ni contrato Desktop.
