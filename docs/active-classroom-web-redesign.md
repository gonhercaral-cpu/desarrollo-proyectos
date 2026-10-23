# Active Classroom Web: rediseño para revisión local

Rama `codex/active-classroom-web-redesign-1.0.18`, basada en `active-classroom-v1.0.18` (`386138e69fd3a05db54a85fbe03057758f8c2f83`). Los cambios anteriores del propietario permanecen en el checkout principal. La revisión inicial fue local; el propietario autorizó después commits, integración y publicación Web el 23 de octubre de 2026. La release nativa de Desktop continúa separada.

## Funcionalidad

- Biblioteca: tarjetas compactas y apertura directa; selector visual de niveles; búsqueda, filtros, orden, lista/cuadrícula e inspector; acceso directo a recursos e importación Nube AES; paginación. Tamaño pequeño/mediano/grande y campos visibles persisten por usuario y navegador. La preferencia anterior de vista/orden se lee como transición compatible.
- Editor: seis secciones con navegación por teclado, acciones permanentes de guardar/publicar/recargar, resumen compacto y distribución de diapositivas, vista previa y recursos. Lista paginada de ocho diapositivas con miniaturas diferidas. Se conservan procesamiento, interactividad v2, asociaciones generales/por diapositiva, actualización, reemplazo, exclusión e importación. La música anterior sigue disponible en un desplegable.
- Niveles: apertura directa, inspector y acciones existentes; subir, reemplazar y quitar portada PNG/JPEG/WebP de hasta 5 MiB. Sin portada se conserva el ícono; los datos antiguos siguen válidos.
- Ajustes: menú debajo del encabezado; música en el contenido normal; miniaturas con muestra; preferencias generales y tabla de permisos existente. No se amplían privilegios.
- Música: pista predeterminada del catálogo compartido, selección individual por Unit, herencia y desactivación explícita; selector y vista previa de audio autorizada. Guardar modifica el borrador; publicar crea otra versión. No se duplican los archivos del catálogo.

## Persistencia, permisos y compatibilidad

La portada opcional del nivel es `cover: { storagePath, mimeType, sizeBytes }` o `null`. `manageActiveClassroomLevel` valida ruta, metadatos y referencia esperada para evitar sobrescrituras concurrentes. Storage permite crear archivos nuevos en `active-classroom/level-covers/{levelId}/{id}.{png|jpg|webp}` con el permiso existente `manageLevels`; prohíbe sobrescribirlos y borrar una portada aún referenciada. Lectura requiere `access`. Firestore Rules no cambian.

La música predeterminada usa la playlist reservada `module-default` dentro del catálogo existente, con una pista o ninguna. La acción `set-default` del callable de música requiere `orderMaterial` y versión esperada. Se conservan formato, hash, snapshots, historial y sincronización del catálogo. Reemplazar una pista actualiza las referencias de playlists.

El borrador y las nuevas publicaciones admiten el campo opcional `unitMusic: { mode: "inherit" | "custom" | "none", trackId: string | null }`. `custom` requiere el SHA de una pista activa. El backend reutiliza su snapshot inmutable como recurso publicado y conserva la lista `backgroundMusic` compatible. Validación, límites, revisión de borrador y publicación inmutable siguen activos; cambios durante la preparación abortan la publicación. Publicaciones anteriores no se reescriben.

En el código Desktop basado en 1.0.18, selección individual tiene prioridad sobre catálogo global; herencia consulta la pista predeterminada del último catálogo sincronizado y, sin catálogo local, usa la pista congelada en la publicación. Sin `unitMusic` se conserva el comportamiento anterior. Reutiliza caché, verificación y reproductor existentes; no cambia Rust ni formato del catálogo.

**Límite del ejecutable instalado:** el binario 1.0.18 original prioriza su biblioteca global y no conoce la nueva selección por Unit. Los datos siguen siendo compatibles, pero la nueva prioridad musical necesita compilar e instalar posteriormente este código actualizado. No se ha firmado, publicado ni instalado una release. Falta validación manual del ejecutable y de sincronización offline real.

No hay migración masiva ni escritura sobre datos existentes. La publicación Web requiere Hosting, Storage Rules y ocho funciones del codebase Drive: `manageActiveClassroomLevel`, `saveActiveClassroomUnit`, `validateActiveClassroomPublication`, `publishActiveClassroomUnit`, `publishActiveClassroomUnitResources`, `editActiveClassroomAmbient`, `importActiveClassroomAmbient` y `uploadActiveClassroomAmbient`. Se conserva la URL del procesador existente. El cliente Desktop actualizado requiere validación y release independiente.

## Archivos y componentes

- Consola: `src/active-classroom/ActiveClassroomModule.jsx`; `components/UnitCatalog.jsx`, `UnitCover.jsx`, `LevelsPanel.jsx`, `SettingsPanel.jsx`, `AmbientMusicLibrary.jsx`.
- Nuevos componentes en esa carpeta: `ContentCover.jsx`, `ThumbnailControls.jsx`, `SlideThumbnail.jsx`, `UnitMusicPanel.jsx`.
- Editor: `components/UnitEditor.jsx`; nuevos `styles/unit-editor.css` y `styles/web-redesign.css`. Los overrides del encabezado se limitan al módulo porque el shell global impone altura con `!important`.
- Servicios y preferencias: `services/activeClassroomService.js`, nuevo `services/musicService.js`, `utils/webPreferences.js` y nuevo `utils/libraryPreferences.js`.
- Backend: `drive/activeClassroomLevels.js`, `activeClassroomAmbient.js`, `activeClassroomUnit.js`, nuevo `activeClassroomUnitMusic.js`, `drive/index.js` y `storage.rules`.
- Desktop: `active-classroom-desktop/src/offline/library.ts`, `manifest.ts`, `src/player/ClassroomPlayer.ts` y nuevo `src/player/unit-music.ts`.
- Pruebas: `tests/active-classroom-admin-ui.test.mjs`, `firebase-rules.test.mjs`, nuevos `active-classroom-redesign.test.mjs` y `active-classroom-redesign-emulator.test.cjs`; Desktop `tests/ambient.test.mjs` y nuevo `tests/unit-music.test.mjs`. Los scripts de pruebas en ambos `package.json` incluyen las regresiones nuevas correspondientes. Sin cambios de dependencias.

## Validación ejecutada

| Verificación | Resultado |
| --- | --- |
| Build Web Vite | Aprobado; avisos existentes de chunks grandes/importación dinámica |
| Build Desktop 1.0.18 (TypeScript/Vite y bundle) | Aprobado; 2 pruebas de bundle |
| Build administración Desktop | Aprobado |
| `npm run test:active-classroom` | 34/34 |
| Todos los tests Active Classroom de backend/UI fuera de emuladores | 95/95 |
| Música/backend unitarios adicionales | 7/7, además de las 2 regresiones nuevas incluidas arriba |
| Desktop: música, catálogo, reproductor, offline y proyección | 84/84 |
| Reglas Firestore/Storage en emuladores | 132/132 |
| Backend en emuladores: rediseño, administración, Unit, música, Drive, Office, Slides y dispositivos | 23/23 |
| ESLint del módulo y backend modificado, salvo el archivo global `drive/index.js` | Aprobado |
| `npm --prefix active-classroom-desktop run lint:player` | Aprobado |
| `git diff --check` | Aprobado |
| ESLint global | 137 errores y 37 advertencias preexistentes, en módulos ajenos y defectos previos de `drive/index.js` |

Revisión visual local con componentes reales y servicios simulados: cinco vistas a 1440 px; editor/niveles a 1024 px; Biblioteca, editor, música, niveles y ajustes a 390 px. Sin desbordamiento horizontal del documento en las medidas verificadas. Las tablas y navegación conservan desplazamiento horizontal propio cuando lo requieren. Miniaturas guardadas sobreviven a una recarga. Las portadas de prueba son ilustraciones de muestra; las fotos de las referencias no se incorporaron como contenido del producto.

Logs, contratos, respuesta de Claude y capturas permanecen en `.orquestacion/` del checkout principal, excluidos de Git. La vista de prueba con servicios simulados tampoco usa Firebase ni datos reales. Para probar la aplicación completa con tu entorno local: `npm run dev` desde el checkout de esta rama.

## Colaboración

Codex: arquitectura, implementación de Biblioteca/Niveles/Ajustes/música, backend, Storage, Desktop, revisión e integración del editor, pruebas y revisión visual. Claude Code: contrato acotado del editor y miniaturas; código inspeccionado antes de integrarlo; las pruebas las ejecutó Codex. Antigravity: consulta intentada; primera ejecución falló por conexión y el reintento terminó sin respuesta útil porque `read_file` fue denegado en modo headless. No se atribuyen resultados a Gemini ni se reutilizan respuestas antiguas.

## Prueba manual recomendada antes de publicación

1. Desde este checkout, abrir Biblioteca con roles administrador, colaborador autorizado y lector; probar filtros, tarjetas, tres tamaños, recarga y cambio de usuario.
2. Crear un nivel local; subir/reemplazar/quitar portada; verificar ícono sin imagen y rechazo de formato/tamaño inválidos. Probar dos sesiones concurrentes.
3. En una Unit de prueba, importar presentación y documento desde Nube AES, procesar, aplicar diapositivas, asociar recursos, actualizar y reemplazar; comprobar interactividad, exclusión y publicación nueva. Abrir versión anterior y verificar contenido inmutable.
4. Seleccionar pista predeterminada, publicar una Unit heredada y otra individual; cambiar predeterminada y sincronizar Desktop actualizado. La heredada cambia, la individual conserva su pista. Probar silencio explícito y configuración antigua.
5. Desconectar red tras sincronizar: abrir ambas Units, cambiar diapositivas, reproducir música y recursos, alternar proyección. Revisar comportamiento del ejecutable instalado 1.0.18 por separado y planificar actualización del cliente.
6. Revisar 390/1024/1440 px, teclado, zoom y tema oscuro con datos reales. No ejecutar estas pruebas de escritura contra producción sin autorización.
