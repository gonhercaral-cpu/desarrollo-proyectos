# Active Classroom Desktop: proyector local

Versión 1.0.0; Tauri Rust/API/CLI 2.12.1. Sin cambios en Firebase, publicaciones o sincronización. Piloto físico Zorin confirmado por el usuario; validación de cada nueva instalación en [guía 1.0.0](active-classroom-1.0.0.md).

## Arquitectura

- Ventana `teacher`: `ClassroomPlayer` usa `ClassSessionController`, única autoridad de Unit, slide, recurso, página, reproducción, posición, volumen y estado del proyector. Conserva recursos, controles, shortcuts y notas del manifest.
- `ProjectionCoordinator` consulta monitores nativos cada segundo. Persiste nombre, resolución y posición del monitor seleccionado en `localStorage` (`active-classroom-projection-monitor`). Reutiliza identidad exacta o nombre único cuando cambian posición/resolución.
- Si Wayland no informa monitor principal del sistema, se identifica como principal la salida donde está el panel del profesor. No se reposiciona ese panel.
- Rust `classroom_projection` crea/reutiliza `audience` oculta mediante `prepare`. El SDK docente consulta `availableMonitors()` y ejecuta `audience.setFullscreenOnMonitor(selectedMonitor.position)` con el objeto físico real, sin dividir coordenadas por `scaleFactor`. Después, `activate` revalida monitor/operación y muestra la ventana. No se usa `setPosition` ni fullscreen genérico para abrir o mover proyección. Las operaciones canceladas no pueden volver a mostrarla.
- Puede cambiarse el selector mientras se proyecta: reutiliza la ventana y conserva recursos, reproducción y posición de clase. La ventana docente solo recupera foco; no se mueve ni se cambia su fullscreen.
- `audience` inicia únicamente `mountProjection`, sin Firebase, credenciales ni biblioteca. `ProjectionPlayer` consume snapshots ordenados y reutiliza los renderers PDF.js, imagen y video existentes. No recibe nombres, notas ni UI administrativa. Solo admite URLs del protocolo asset local.
- El caché y el resolvedor existentes siguen verificando cada recurso en la ventana docente antes de compartir su URL local. PDF.js, worker, CMaps, fuentes, ICC y WASM permanecen empaquetados.
- Capability adicional **solo en teacher**: `core:window:allow-set-fullscreen-on-monitor`. Audiencia conserva únicamente escuchar/desregistrar eventos. No se amplía CSP ni se concede acceso a credenciales, mutaciones del caché o diálogo de archivos.

## Audio y preview

El único propietario del audio es `teacher`, para audio y video. El video de `audience` permanece con `muted=true` y `volume=0`, incluso al cambiar volumen/mute en el profesor. Para un recurso audio, el proyector muestra únicamente un símbolo musical, sin elemento multimedia adicional. La salida física del sonido depende del dispositivo de audio seleccionado en Zorin.

El contenido principal del profesor sirve como vista previa. No se crea un tercer renderer/decoder. Cada ventana visible sí necesita su propio canvas PDF o decoder de video; la audiencia ajusta su posición al reloj docente, con corrección de desfases mayores a 350 ms y snapshots periódicos. No es sincronización de video cuadro por cuadro.

## Desconexión y cierre

Al perder el monitor seleccionado, Rust oculta la audiencia. La sesión docente continúa, incluido sonido, slide, recurso y tiempo multimedia. Tras reconectar aparece `Restaurar proyección`; vuelve al contenido actual, no al estado anterior a la desconexión. Cerrar la audiencia equivale a detener la proyección. Cerrar la Unit retira su sesión para ignorar eventos tardíos. Cerrar la ventana docente destruye la audiencia.

## Validación automatizada

`npm run test:projection`: autoridad y revisiones, monitores persistentes/reconexión simulada, errores IPC, navegación, multimedia silenciado, audio único, cambios rápidos/cierre, shortcuts, URLs exclusivamente locales y capabilities. También verifica el SDK Tauri real: orden prepare/fullscreen/activate, monitor secundario, coordenadas negativas, HiDPI sin transformación, cambio de monitor y fallos que nunca muestran audiencia ni usan fallback genérico.

CI Ubuntu ejecuta además tests existentes de Player/offline/dispositivo/empaquetado, tests Rust de caché/identidad/proyección, llavero Linux, `cargo check --locked` y build Tauri `.deb`. `tests/wayland-projection.sh` ejecuta un binario Tauri real (`examples/wayland_projection.rs`) contra Weston con dos salidas virtuales y `GDK_BACKEND=wayland`: verifica selección secundaria, cambio/restauración y monitor docente conservado. Xvfb aloja el compositor Weston, no el cliente Tauri. El fixture nativo usa páginas vacías sin Auth, Player, caché ni red; no se empaqueta en el instalador.

La validación virtual no acredita HDMI físico, GNOME/Mutter de Zorin, desconexión real ni códecs. El piloto Zorin fue confirmado por el usuario; repetir aceptación física en cada nuevo salón.

## Diagnóstico Wayland

Ejecutar `active-classroom 2>&1 | tee active-classroom-projection.log`. Los eventos `[Active Classroom Projection]` registran nombre de monitor, posición física x/y, resolución, `scaleFactor`, principal, monitor seleccionado, sesión Wayland/X11 y resultado de apertura. El SDK registra además resultado de `setFullscreenOnMonitor` en consola WebView. No se registran credenciales ni contenido de clase.

API y permiso oficiales: [setFullscreenOnMonitor](https://v2.tauri.app/reference/javascript/api/namespacewindow/#setfullscreenonmonitor).

## Aceptación física en cada salón

1. Instalar `Active Classroom_1.0.0_amd64.deb` y conservar el caché existente. Confirmar `echo $XDG_SESSION_TYPE` muestra `wayland` si se usa esa sesión.
2. Conectar segundo monitor en modo extendido. Abrir Unit ya descargada.
3. Confirmar `Segunda pantalla conectada`, nombres, principal/secundario, resolución y posición. Seleccionar monitor y pulsar `Proyectar`.
4. Verificar fullscreen y solo contenido en monitor secundario; panel, notas y controles permanecen en principal. Cambiar monitor seleccionado mientras se proyecta y verificar que se mueve la salida sin perder posición/reproducción.
5. Cambiar slides y páginas PDF. Abrir imagen, PDF asociado y volver: posición de presentación conservada.
6. Reproducir audio y video; pausar, buscar, cambiar volumen y detener. Verificar un único sonido y que video siga al profesor.
7. Usar shortcuts existentes desde profesor. Confirmar que proyector no altera la sesión por teclado.
8. Desconectar HDMI durante video y durante PDF. Continuar clase principal sin perder posición/recurso.
9. Reconectar, pulsar `Restaurar proyección` y comprobar contenido/tiempo actuales.
10. Reiniciar aplicación y comprobar monitor recordado. Cerrar Unit/aplicación durante reproducción: sin audio ni ventana huérfana.
11. Desconectar Internet, reiniciar y repetir pasos con Unit local. No debe solicitar Firebase ni Drive durante la clase.

Probar tanto X11 como Wayland si ambos se usan en los salones. Probar MP4/AAC según códecs instalados; no se añaden códecs en este hito.
