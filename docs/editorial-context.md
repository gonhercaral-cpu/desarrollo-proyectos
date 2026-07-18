# Editor Editorial — Contexto del módulo

> Documento de contexto persistente. Redactado desde la auditoría real del código
> en `src/editorial`. El código es la fuente de verdad: si algo aquí contradice al
> código, prevalece el código.

## Propósito

Editor interno para crear libros, cuadernillos, actividades, canciones, exámenes,
guías y material académico de Active English School.

## Stack (versiones reales de `package.json`)

- React (`^19.2.6`) + Vite (`^8.0.12`).
- Firebase Auth, Cloud Firestore, Firebase Storage (SDK `firebase ^12.15.0`).
- React Konva (`react-konva ^19.2.5`, `konva ^10.3.0`) para el editor visual.
- jsPDF `^4.2.1` para exportación PDF vectorial.
- JSZip `^3.10.1` para empaquetado de exportaciones.

## Entrada y ruteo

- Módulo cargado por `lazy(() => import("./editorial/EditorialModule"))` en
  [src/App.jsx](../src/App.jsx).
- Rutas React definidas en `App.jsx`: `/editorial` y `/editorial/:projectId`
  (ambas vía `ProtectedEditorialSystem`).
- `EditorialModule.jsx` es una sola vista con conmutación interna de paneles
  (proyectos, editor, estructura, diseño, académico, producción). No usa router
  propio; obtiene `projectId` con `useParams`.
- Acceso restringido a administradores activos y colaboradores activos del
  departamento **Desarrollo de Material** (guard de ruta en `App.jsx` +
  visibilidad de nav en `Dashboard.jsx`, helper `canAccessEditorial`).

## Árbol real de carpetas (`src/editorial`)

```
EditorialModule.jsx
components/
  EditorialConfirmDialog.jsx
  EditorialEditorShell.jsx
  EditorialIcon.jsx
  EditorialProjectDialog.jsx
  EditorialProjectsView.jsx
  academic/
    EditorialAcademicElementInspector.jsx
    EditorialAcademicLibraryPanel.jsx
    EditorialAcademicMetadataDialog.jsx
    EditorialAnswersPanel.jsx
    EditorialExerciseDialog.jsx
    EditorialSongDialog.jsx
  design/
    EditorialDesignDialog.jsx
    EditorialDesignInspector.jsx
    EditorialDesignLibraryPanel.jsx
    EditorialMasterList.jsx
  editor/
    EditorialCanvas.jsx
    EditorialEditorToolbar.jsx
    EditorialElementInspector.jsx
    EditorialElementRenderer.jsx
    EditorialInspectorPanel.jsx
    EditorialLayersPanel.jsx
    EditorialPrintGuides.jsx
    EditorialRulers.jsx
    EditorialSelectionTransformer.jsx
    EditorialWorkspace.jsx
    EditorialZoomControls.jsx
  production/
    EditorialExportDialog.jsx
    EditorialIndexDialog.jsx
    EditorialProductionPanel.jsx
  structure/
    EditorialBottomPanel.jsx
    EditorialPageActionsMenu.jsx
    EditorialPageDialog.jsx
    EditorialPageThumbnail.jsx
    EditorialSectionDialog.jsx
    EditorialStructureDeleteDialog.jsx
    EditorialStructurePanel.jsx
    EditorialStructureTree.jsx
    EditorialThumbnailList.jsx
hooks/         (17 archivos)
models/        (6 archivos)
services/      (15 archivos)
styles/        (10 archivos CSS)
utils/         (17 archivos)
```

### Hooks principales

`useEditorialEditorState` (estado central del editor), `useEditorialProject`,
`useEditorialProjects`, `useEditorialDocumentNavigation`, `useEditorialAutosave`,
`useEditorialHistory`, `useEditorialMasterPages`, `useEditorialComponents`,
`useEditorialStyles`, `useEditorialVariables`, `useEditorialVariant`,
`useEditorialTemplates`, `useEditorialDesignSystem`, `useEditorialOrdering`,
`useEditorialPagePreviewElements`, `useEditorialProduction`,
`useEditorialShortcuts`.

### Servicios (acceso Firestore/Storage)

`editorialProjectsService`, `editorialSectionsService`, `editorialPagesService`,
`editorialElementsService`, `editorialMasterPagesService`,
`editorialComponentsService`, `editorialStylesService`,
`editorialVariablesService`, `editorialTemplatesService`,
`editorialAcademicService`, `editorialProduction… (vía hooks)`,
`editorialExportsService`, `editorialVersionsService`, `editorialSnapshotService`,
`editorialReviewService`, `editorialAssetUsageService`.

### Utilidades principales

`editorialPdfRenderer` (render PDF vectorial desde el modelo, jsPDF),
`editorialPdfMeasurements`, `editorialMeasurements`, `editorialAutomaticIndex`,
`editorialPreflight`, `editorialNumbering`, `editorialSpreads`,
`editorialPageSelection`, `editorialInheritance`, `editorialVariables`,
`editorialVersioning`, `editorialAcademicGenerators`,
`editorialAcademicValidation`, `editorialAcademicVisibility`,
`editorialSongGenerator`.

### Modelos

`editorialModels`, `editorialElements`, `editorialStructure`, `editorialDesign`,
`editorialAcademic`, `editorialProduction`.

## Colecciones Firestore realmente usadas

Raíz: `editorialProjects/{projectId}`.

Subcolecciones (confirmadas en servicios y en `firestore.rules`):

- `documents/{documentId}`
  - `sections/{sectionId}`
  - `pages/{pageId}` → `elements/{elementId}`
  - `masterPages/{masterPageId}` → `elements/{elementId}`
  - `comments/{commentId}`
  - `versions/{versionId}`
  - `exports/{exportId}`
- `components/{componentId}` → `elements/{elementId}`
- `styles/{styleId}`
- `variables/{variableId}`
- `comments/{commentId}` (a nivel proyecto)

Ruta legacy conservada en reglas: `editorialProjects/{projectId}/pages/{pageId}/elements/{elementId}`
(compatibilidad con proyectos previos al modelo por documento).

## Reglas técnicas deducidas del código

- El PDF se genera desde el modelo editorial (`editorialPdfRenderer` + jsPDF),
  no desde capturas del navegador.
- Contextos de edición separados: página, página maestra y componente
  (hooks y renderers distintos; los elementos de maestra no se duplican en la
  página, se referencian/heredan vía `editorialInheritance`).
- Variables académicas y de render son render-only: no mutan el elemento base.
- Variantes Alumno/Maestro se resuelven en render (`useEditorialVariant` +
  `editorialAcademicVisibility`); no se duplican páginas por variante.
- Operaciones estructurales usan batches de Firestore (servicios de
  pages/sections/masterPages/components).
- Autoguardado + respaldo local + historial por página; se fuerza guardado antes
  de cambiar de contexto.
- Numeración arábiga y romana calculada en `editorialNumbering`; pliegos reales
  en `editorialSpreads`.
- Índice automático (`editorialAutomaticIndex`) y preflight
  (`editorialPreflight`) operan sobre el modelo.
- Persistencia preserva campos desconocidos de Firestore (merge, no overwrite
  total).

## Fases terminadas (1–6)

### Fase 1 — Base
- Rutas `/editorial` y `/editorial/:projectId`.
- Catálogo de proyectos.
- Configuración de tamaño, orientación, márgenes y sangrado. Preset 8 × 10 in.
- Shell editorial. Persistencia y limpieza profunda. Modo oscuro y permisos.

### Fase 2 — Editor visual
- Konva. Texto, imagen y rectángulo. Transformer. Capas. Inspector.
- Guías de impresión. Zoom y desplazamiento. Atajos. Historial. Autoguardado.
  Respaldo local.

### Fase 3 — Páginas y estructura
- CRUD de páginas. Secciones. Drag-and-drop. Pliegos reales. Miniaturas.
- Numeración arábiga y romana. Historial por página. Compatibilidad legacy.

### Fase 4 — Diseño reutilizable
- Páginas maestras. Overrides. Plantillas. Componentes vinculados. Estilos
  globales. Variables render-only. Contextos separados para página, maestra y
  componente.

### Fase 5 — Herramientas académicas
- Metadata de serie, nivel, libro, unidad y lección. 18 bloques académicos.
  Cinco generadores de ejercicios. Hojas de canciones. Alumno/Maestro.
  Respuestas. Variables académicas. Biblioteca y validaciones académicas.

### Fase 6 — Producción
- Índice automático. Preflight. Revisión y comentarios. Checklist. Versiones y
  restauración. PDF revisión, imprenta y parcial. Exportación Alumno/Maestro.
  PNG, JPG y ZIP. Historial de exportaciones. Render PDF vectorial desde el
  modelo, sin capturar navegador.

## Invariantes

- No guardar páginas completas como imágenes.
- No duplicar elementos de páginas maestras.
- No sustituir permanentemente placeholders.
- No duplicar páginas para Alumno/Maestro.
- No perder campos desconocidos.
- No borrar assets compartidos.
- Forzar guardado antes de cambiar de contexto.
- Operaciones de generación como una sola acción de historial.
- Usar batches en operaciones estructurales.
- Mantener compatibilidad con proyectos legacy.

## Limitaciones conocidas

- Fuentes personalizadas requieren archivos embebibles autorizados.
- Firebase Rules E2E bloqueado porque Java no está instalado.
- Reglas locales pueden no estar desplegadas.
- Vite puede mostrar advertencia de chunks mayores de 500 kB.
- No corregir errores globales fuera del módulo.

## No implementado

- Fase 7.
- Nube AES.
- Imprenta.
- Proyectos.
- Publicaciones.
- Permisos editoriales granulares.
- Edición simultánea.
- Portal público.
- Calificación de alumnos.

## Baseline confirmado

- Build editorial funcional.
- ESLint editorial limpio (`src/editorial` + `tests/editorial-*.test.mjs`).
- Tests editoriales: 24/24.
- `git diff --check` limpio.

## Diferencias entre este resumen y el código

- Sin contradicciones detectadas. Precisiones menores añadidas desde el código:
  - Las colecciones `styles` y `variables` existen como subcolecciones de
    `editorialProjects/{projectId}` (respaldan "estilos globales" y "variables"
    de Fase 4).
  - Existe una ruta legacy `editorialProjects/{projectId}/pages/{pageId}/elements`
    en `firestore.rules`, previa al modelo por documento (compatibilidad legacy).
  - Las rutas `/editorial` y `/editorial/:projectId` se declaran en `App.jsx`,
    no dentro de `EditorialModule.jsx` (que conmuta paneles internamente).
