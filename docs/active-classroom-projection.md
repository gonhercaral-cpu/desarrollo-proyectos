# Active Classroom Desktop: proyector local

Versión 0.1.5. Sin cambios en Firebase, publicaciones o sincronización.

## Arquitectura

- Ventana `teacher`: `ClassroomPlayer` usa `ClassSessionController`, única autoridad de Unit, slide, recurso, página, reproducción, posición, volumen y estado del proyector. Conserva recursos, controles, shortcuts y notas del manifest.
- `ProjectionCoordinator` consulta monitores nativos cada segundo. Persiste nombre, resolución y posición del monitor seleccionado en `localStorage` (`active-classroom-projection-monitor`). Reutiliza identidad exacta o nombre único cuando cambian posición/resolución.
- Rust `classroom_projection` crea/reutiliza `audience`, la posiciona con coordenadas físicas y activa fullscreen. Transporta snapshots en memoria y eventos Tauri locales. Bloquea controles desde cualquier ventana distinta de `teacher`.
- `audience` inicia únicamente `mountProjection`, sin Firebase, credenciales ni biblioteca. `ProjectionPlayer` consume snapshots ordenados y reutiliza los renderers PDF.js, imagen y video existentes. No recibe nombres, notas ni UI administrativa. Solo admite URLs del protocolo asset local.
- El caché y el resolvedor existentes siguen verificando cada recurso en la ventana docente antes de compartir su URL local. PDF.js, worker, CMaps, fuentes, ICC y WASM permanecen empaquetados.
- Capabilities de audiencia: solamente escuchar/desregistrar eventos. No se amplía CSP ni se concede acceso a credenciales, mutaciones del caché o diálogo de archivos.

## Audio y preview

El único propietario del audio es `teacher`, para audio y video. El video de `audience` permanece con `muted=true` y `volume=0`, incluso al cambiar volumen/mute en el profesor. Para un recurso audio, el proyector muestra únicamente un símbolo musical, sin elemento multimedia adicional. La salida física del sonido depende del dispositivo de audio seleccionado en Zorin.

El contenido principal del profesor sirve como vista previa. No se crea un tercer renderer/decoder. Cada ventana visible sí necesita su propio canvas PDF o decoder de video; la audiencia ajusta su posición al reloj docente, con corrección de desfases mayores a 350 ms y snapshots periódicos. No es sincronización de video cuadro por cuadro.

## Desconexión y cierre

Al perder el monitor seleccionado, Rust oculta la audiencia. La sesión docente continúa, incluido sonido, slide, recurso y tiempo multimedia. Tras reconectar aparece `Restaurar proyección`; vuelve al contenido actual, no al estado anterior a la desconexión. Cerrar la audiencia equivale a detener la proyección. Cerrar la Unit retira su sesión para ignorar eventos tardíos. Cerrar la ventana docente destruye la audiencia.

## Validación automatizada

`npm run test:projection`: autoridad y revisiones, monitores persistentes/reconexión simulada, errores IPC, navegación, multimedia silenciado, audio único, cambios rápidos/cierre, shortcuts, URLs exclusivamente locales y capabilities.

CI Ubuntu ejecuta además tests existentes de Player/offline/dispositivo/empaquetado, tests Rust de caché/identidad/proyección, llavero Linux, `cargo check --locked` y build Tauri `.deb`. Las pruebas DOM simulan HDMI y reproducción; no acreditan hardware real ni códecs del equipo destino.

## Aceptación física en Zorin (pendiente de hardware real)

1. Instalar `Active Classroom_0.1.5_amd64.deb` y conservar el caché existente.
2. Conectar segundo monitor en modo extendido. Abrir Unit ya descargada.
3. Confirmar `Segunda pantalla conectada`, nombres, principal/secundario, resolución y posición. Seleccionar monitor y pulsar `Proyectar`.
4. Verificar fullscreen y solo contenido en proyector; notas/controles solo en profesor.
5. Cambiar slides y páginas PDF. Abrir imagen, PDF asociado y volver: posición de presentación conservada.
6. Reproducir audio y video; pausar, buscar, cambiar volumen y detener. Verificar un único sonido y que video siga al profesor.
7. Usar shortcuts existentes desde profesor. Confirmar que proyector no altera la sesión por teclado.
8. Desconectar HDMI durante video y durante PDF. Continuar clase principal sin perder posición/recurso.
9. Reconectar, pulsar `Restaurar proyección` y comprobar contenido/tiempo actuales.
10. Reiniciar aplicación y comprobar monitor recordado. Cerrar Unit/aplicación durante reproducción: sin audio ni ventana huérfana.
11. Desconectar Internet, reiniciar y repetir pasos con Unit local. No debe solicitar Firebase ni Drive durante la clase.

Probar tanto X11 como Wayland si ambos se usan en los salones: el compositor puede afectar posicionamiento/fullscreen y foco. Probar MP4/AAC según códecs instalados; no se añaden códecs en este hito.
