# Revelados progresivos — Desktop 1.0.8

El schema 2 sigue siendo compatible con clientes anteriores. PNG/PDF estáticos
conservan su navegación; clientes antiguos ignoran `interaction` y `builds`.
Desktop 1.0.8 interpreta los pasos. Publicaciones existentes no se reescriben.

## Representación

PPTX: PresentationML `p:timing`, `cTn` con `nodeType=clickEffect`, clase `entr`,
preset 1 (aparición) / 10 (fade), targets completos `spTgt`. El procesador crea un
PPTX temporal con estados acumulativos, comparte los medios originales y exporta
una sola vez a PDF; Poppler rasteriza estados PNG de hasta 1600 px. Fade se
representa como revelado del estado final, sin reproducir duración del efecto.

No se interpretan paths, Morph, objetos con triggers, párrafos/caracteres
individuales, grupos, salidas, énfasis, efectos 3D ni secuencias temporizadas o
mixtas. Una slide con timing no compatible queda estática completa y conserva un
aviso para el editor. El resto de slides sigue procesándose normalmente.

Manual: capas acumulativas de texto, respuesta o imagen, con posición/tamaño en
porcentajes del área de la diapositiva, excluyendo letterboxing. Color y tamaño
de texto configurables. Cada paso añade una capa en el editor inicial; el modelo
acepta múltiples capas por paso. Assets se refieren a recursos de la misma Unit.
No HTML, scripts, URLs remotas ni paths arbitrarios. Máximo 50 pasos/capas por
slide. Se mantiene el límite existente de 200 archivos y 700 KB por manifest.

```json
{
  "interactionMode": "builds",
  "buildCount": 2,
  "interaction": { "mode": "builds", "buildCount": 2, "source": "pptx" },
  "builds": [
    { "order": 1, "resourceId": "gs-raster-1" },
    { "order": 2, "resourceId": "gs-raster-2" }
  ]
}
```

`metadata.presentationResourceId` referencia el PNG inicial. Cada PNG aparece
en `resources` con SHA-256, MIME, tamaño, path y generación. Al publicar, cada
build incorpora `assets`, `sizeBytes` y checksum del descriptor completo. Texto
y posiciones son metadata congelada, cubierta también por el hash del manifest.
Los mismos bytes pueden deduplicarse por SHA-256 en la infraestructura existente.

## Procesamiento y publicación

Cloud Run permanece sin credenciales de datos. `/plan` analiza el original
congelado; Functions firma capacidades de escritura para cada objeto del plan.
`/convert` vuelve a verificar el original y el plan, rasteriza y sube por stream.
Functions verifica PNG, dimensiones, generación, tamaño y SHA-256 incremental.
No guarda URLs temporales en Firestore o manifests. Intentos fallidos eliminan
sus objetos; commits confirmados nunca se eliminan por un error de respuesta.

La publicación usa el job existente y comprueba todos los estados y assets antes
de activar la versión, conservando borrador y publicación anterior ante fallos.
PPTX legado en PDF sigue disponible; para extraer timing debe reprocesarse desde
el editor. PPT, DOC/DOCX y Google Slides mantienen sus rutas existentes.

## Sesión y controles

`ClassSessionController.currentBuild` empieza en cero. ADVANCE revela siguiente
paso o cambia slide; BACK retrocede un paso o slide. Clic en presentación, Espacio,
flechas y botones usan este comportamiento. Inputs, edición y controles multimedia
mantienen sus shortcuts. Al seleccionar una slide su build empieza en cero; abrir
un recurso y volver conserva el paso. Recursos asociados pertenecen a toda slide.

El proyector recibe `currentBuild` y fuentes/capas locales del profesor. No tiene
contador de pasos ni estado de navegación propio. Imágenes se decodifican antes
de sustituirse y capas existentes se reutilizan. Todo funciona sin Internet tras
la sincronización y verificación existentes.

## Despliegue

1. Desplegar imagen Cloud Run del procesador (añade Poppler y builds.py).
2. Desplegar Functions de Drive: `processActiveClassroomDocument`,
   `getActiveClassroomBuildPreview`, `saveActiveClassroomUnit`,
   `publishActiveClassroomUnit`, `publishActiveClassroomUnitResources`.
3. Desplegar web con el editor; publicar Desktop **1.0.8**, distribuible mediante
   el updater firmado existente. Sin migración de caché, identidad o activación.
4. Reprocesar PPTX deseados, revisar preview inicial/pasos y publicar nueva Unit.

La rama de implementación genera un .deb firmado en CI. La release estable y
el backend se habilitan mediante el despliegue coordinado anterior.
