# Player local de Active Classroom

## Arquitectura

Se continúa la misma aplicación Tauri 2 + TypeScript/Vite. Backend, sincronización, manifest v2 y caché mantienen su contrato.

- `src/player/ClassroomPlayer.ts`: interfaz de clase, comandos, ciclo de vida y recursos asociados/generales. No importa Firebase, Drive ni API de publicaciones.
- `controller.ts`: orden de slides, página principal, asociaciones y páginas de PDFs auxiliares. Abrir un recurso conserva la posición principal.
- `types.ts`: `LocalRenderer`, comandos y selección estricta por **download.mimeType**. El MIME original Drive puede diferir del archivo publicado/exportado.
- `local-source.ts`: usa el resolvedor existente y `convertFileSrc`; rechaza URLs remotas y discrepancias de MIME. Solo permite protocolo asset de Tauri.
- `renderers/Presentation/PdfRenderer.ts`: PDF.js, canvas, navegación, ajuste al área por ResizeObserver, cancelación de render y liberación del worker/documento.
- `renderers/ImageRenderer.ts`, `AudioRenderer.ts`, `VideoRenderer.ts`: renderers independientes. Audio/video comparten `MediaRenderer` y HTMLMediaElement.
- `shortcuts.ts`: teclas traducidas a comandos; ignora inputs, textarea, select, contenteditable, role textbox, modificadores y composición IME.
- `src/offline/library.ts`: reemplaza placeholder, cancela consultas/descargas antes de abrir y evita consultas/rerenders durante clase. Al salir vuelve a comprobar caché, permitiendo reparar daños detectados.

Cada renderer implementa `mount`, `command`, `setPage`, `seek`, `setVolume` y `destroy`. Comandos no aplicables no hacen nada. El controlador no conoce PDF.js, reproductores externos ni proveedores cloud. Cambios rápidos tienen un contador de sesión; resultados atrasados no pueden reemplazar el recurso actual.

## Flujo y archivos

1. `Abrir clase` fija `unitId/version`, cancela actividad remota de Biblioteca y llama `openLocalClass(cache, unitId, version)`.
2. El caché Rust existente valida manifest y objetos; TypeScript valida contrato y hash del manifest. Sesión devuelve `resolveResource(resourceId)` con `{path, mimeType, kind, name}`.
3. Antes de montar cada recurso, `NativeCache.has(sha256, sizeBytes)` vuelve a verificar sus bytes locales. Rutas permanecen en `app_data_dir()/offline-v1/users/<sha256-uid>/objects/<sha256>`; no se duplican archivos ni se crea otra caché.
4. Se convierte ruta absoluta a URL asset local. PDF.js lee bytes locales; imagen/audio/video usan ese mismo protocolo. Las lecturas no llevan ID token ni abren la URL de Drive.
5. Errores de carga/códec/PDF/MIME aparecen dentro de clase. Se puede cambiar de recurso o volver a Biblioteca. Un manifest inválido impide abrir esa Unit, sin cerrar la aplicación.
6. Salir destruye renderer, aborta lecturas pendientes, pausa medios, elimina fuentes/listeners y libera PDF/worker. No se persiste una nueva publicación ni se altera la versión activa.

PDF.js, worker, CMaps, fuentes estándar, WASM y perfiles ICC se empaquetan con Vite dentro de `dist`. No usa CDN, visores externos, anotaciones ejecutables ni navegación a enlaces del documento. CSP habilita asset local, worker propio y WASM; no incorpora dominios nuevos de Internet.

## Slides y páginas

- La lista y botones de clase siguen el orden del manifest.
- Una slide usa `metadata.pageNumber` (base 1); si falta, `index + 1`.
- El PDF tiene además botones de página física y contador actual/total. Al cambiar página, se busca la slide correspondiente y se actualizan sus recursos.
- Página sin slide asociada: se indica explícitamente y no se inventan asociaciones; recursos generales siguen disponibles.
- Una referencia fuera del PDF muestra error recuperable; no se remapea silenciosamente.
- Volver de un recurso restaura la página principal. Un PDF auxiliar recuerda su propia página durante la sesión. La posición no persiste después de cerrar Unit/reiniciar; ese requisito no forma parte de este hito.

## Formatos

- PDF integrado con PDF.js. Archivos cifrados con contraseña y XFA no se habilitan.
- JPEG, PNG, WebP con imagen nativa del WebView.
- Audio MPEG/MP3, WAV, M4A/MP4, AAC, Ogg, WebM, FLAC reconocidos por MIME.
- Video MP4/WebM reconocido por MIME.
- La decodificación real de audio/video depende de codecs del WebView/WebKitGTK/GStreamer instalado. MIME no garantiza codec: fallos se muestran sin cerrar Unit. Hace falta prueba en el Linux de destino con archivos reales.
- PPT/PPTX/Google Slides exportado a PPTX, DOC/DOCX y otros tipos muestran mensaje de incompatibilidad. No se convierten ni se abren programas externos.

## Comandos

| Comando | Tecla | Comportamiento |
| --- | --- | --- |
| NEXT / PREVIOUS | → / ← | Slides al mostrar presentación; páginas al mostrar PDF auxiliar; ignorado por imagen/audio/video auxiliar |
| PLAY_PAUSE | Espacio | Reproducir/pausar audio/video |
| STOP | Botón Detener | Pausar y volver a tiempo 0 |
| SEEK_BACKWARD / SEEK_FORWARD | J / L | −10 / +10 segundos, limitado a duración |
| VOLUME_UP / VOLUME_DOWN | ↑ / ↓ | ±10%, limitado a 0–100% |
| MUTE | M | Alternar silencio |
| FULLSCREEN | F | Pantalla completa del modo clase |
| Salir de modo | Esc | Salir de fullscreen; volver de recurso a presentación; o cerrar clase |

Progreso temporal y volumen también permiten ajuste con sliders. Espacio en botón mantiene la activación nativa sin disparar otra reproducción. Volumen/silencio se conservan entre recursos de la misma sesión; no hay autoplay al seleccionar recurso.

## Validación y bloqueos

```sh
npm run test:player
npm run test:offline
npm run lint:player
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

- Tests Player cubren selección MIME, orden/asociaciones, posición, comandos/shortcuts, fullscreen, archivos faltantes/corruptos, carreras, cierre y reapertura desde disco sin red. PDF.js real decodifica/dibuja un PDF de dos páginas y rechaza bytes corruptos; pruebas DOM simulan elementos multimedia.
- Vista PDF, worker empaquetable, navegación y regreso a presentación revisados en navegador con fixture temporal. La fixture no forma parte de producción ni reemplaza IPC nativo.
- Tests offline existentes continúan cubriendo SHA-256, versiones, descarga diferencial, fallos y fallback.
- Build frontend y lint específico pasan. Vite avisa del tamaño del chunk PDF.js (carga dinámica); worker y assets están incluidos.
- **Bloqueo comprobado en este equipo Windows: no existen `cargo` ni `rustc` disponibles.** `cargo test` no puede arrancar; `tauri:build` falla en `cargo metadata --no-deps --format-version 1: program not found`. No se instaló ni simuló toolchain.
- Cuatro tests Rust siguen pendientes: `rejects_path_traversal_and_bad_hash`, `verifies_file_bytes_and_size`, `accepts_published_contract`, `committed_cache_survives_reopen_and_failed_update`.
- No se certifica binario Linux: faltan ejecución Rust/Tauri y prueba instalada de protocolo asset, seek/rangos, fullscreen, codecs y reinicio sin red en el equipo de salón. Dependencias Linux posteriores aún no pueden diagnosticarse desde este host sin toolchain.

## Segunda pantalla, siguiente hito

Crear/seleccionar ventana de proyector, presentar una vista sin controles docentes, sincronizar comandos/estado entre ventanas, definir una sola salida de audio y recuperar desconexión/cambio de monitor. Reutilizar `LocalRenderer` y el resolvedor local; no enviar tokens ni introducir dependencias cloud en reproducción.
