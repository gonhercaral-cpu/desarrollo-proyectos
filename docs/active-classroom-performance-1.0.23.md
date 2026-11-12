# Active Classroom Desktop 1.0.23 — rendimiento al cambiar unidades

Estado: **1.0.23 publicada en canal estable e integrada en main**. Issue #26 conserva pendiente la aceptación física de aula.

Release: https://github.com/gonhercaral-cpu/desarrollo-proyectos/releases/tag/active-classroom-v1.0.23
VALIDATION verde: https://github.com/gonhercaral-cpu/desarrollo-proyectos/actions/runs/42921987714
Firma/publicación verde: https://github.com/gonhercaral-cpu/desarrollo-proyectos/actions/runs/43125257942
PR integrado: https://github.com/gonhercaral-cpu/desarrollo-proyectos/pull/27
SHA certificado/tag: `74806b4fcc1d19f063a7170f148ada6a495c101b`. Merge: `d4159bee123b4dc579795f8148c2aa999d0f8216`. Sus árboles Git son idénticos.
Base: `8db82a5fa48b46a575924656aa9860c72c23b8ac` (`main`, versión 1.0.22).
La rama inicial de traslado contenía 1.0.9; no se utilizó para la corrección.

## Causas demostradas y alcance de la evidencia

1. `library.ts` llamaba a `list()` tras cada cierre y al recuperar errores de apertura. `offline_cache::execute("list")` recorría unidades/versiones y verificaba todos sus objetos mediante SHA-256. Ese trabajo retenía `CacheGate`; `has` podía esperar aunque `open` ya estuviera fuera del mutex en 1.0.22.
2. `open`, `has`, activación y `local_media::inspect_object` recalculaban verificaciones de los mismos bytes sin reutilización entre operaciones. Abrir repetidamente una unidad amplificaba I/O aunque el contenido no cambiara.
3. Las precargas de capas animadas usaban `Promise.all` sin límite ni cancelación al cerrar. `ImageRenderer.setSource` no retiraba la fuente de su imagen temporal cuando se reemplazaba o destruía. `showBuild` verificaba pasos futuros antes de alcanzarlos.

Esto demuestra trabajo redundante y recursos temporales sin cancelación. No demuestra que las fotografías correspondan a esas rutas concretas, ni establece todavía la causa del cierre de WebKitWebProcess. El aviso de falta de memoria para analizar el cierre tampoco demuestra por sí solo un OOM del proceso. Se requiere correlación en Linux con el contenido y hardware afectados.

## Trabajo delegado y revisión

Antigravity CLI: diagnóstico de I/O y propuesta de parche sobre `offline_cache.rs` y `local_media.rs`, recibidos en ejecuciones nuevas con código 0 y estado success. Propuso caché volátil de verificaciones y sustitución de la auditoría global por inventario. Codex corrigió la cola auxiliar de la caché, el contador de bytes y el aislamiento de las pruebas; no aceptó el descarte de hipótesis WebKit sin ejecución real.

Claude Code: implementación aislada de biblioteca/ciclo de vida, diagnóstico por proceso y regresiones de 20 cambios; propuesta adicional para limitar concurrencia a dos precargas. Un primer intento agotó turnos y una consulta agotó presupuesto: sus salidas no se trataron como informes válidos. Nuevos contratos acotados verificaron y completaron los cambios con éxito. Codex revisó los diffs, corrigió un fixture sin `order` y propagó la señal interna de cancelación a Player.

No se delegaron secretos, shell, red, publicación, firma ni integración. Los auxiliares no ejecutaron pruebas. Los contratos y respuestas permanecen privados en `.orquestacion/`, fuera de Git.

## Correcciones

- El cierre y recuperación de errores consultan `inventory()`. La activación de pendientes se conserva; resultados de otra sesión/cola se descartan.
- Caché de éxitos SHA-256 exclusivamente en RAM, limitada a 1024 entradas en Unix. Clave: ruta, hash esperado y tamaño; firma: dispositivo, inodo, tamaño, mtime y ctime con nanosegundos. Solo se reutilizan firmas cuya ctime ya tenía al menos dos segundos al empezar la verificación; archivos recientes o timestamps inválidos/futuros se verifican completos sin esperar. No se persiste confianza entre reinicios. Sin firma equivalente en otras plataformas se recalcula el hash.
- Cambios de identidad, contenido o metadatos invalidan confianza. Se rechazan enlaces simbólicos y archivos no regulares; se compara descriptor/ruta antes y después. Ningún mutex de caché se retiene durante hashing; `has` sale del gate de escritura.
- Multimedia comparte esa validación y lee cabecera/descritores de códec; mantiene Range, streaming acotado, grants y leases. No se modifican archivos descargados, identidad, auth, reglas ni infraestructura.
- Animaciones cancelables con un máximo de dos cargas/decodificaciones simultáneas por operación; fallback estático y orden de capas conservados. Revelados futuros se verifican al alcanzarlos. Las capas GIF retiradas liberan `src`, nodos y referencias al cerrar.
- Diagnóstico opcional añade swap en KiB, identidad PID/starttime, `rchar`, `readBytes` y `writeBytes`, junto con hitos de catálogo/apertura/cierre. `unit-open-ready` mide el montaje del panel, no la primera imagen o frame; la preparación multimedia tiene sus propios eventos. No hay sondeo adicional por defecto ni rutas/credenciales en el reporte.

## Medición comparable de componente en macOS

Arnés temporal que compila el código real de caché sin el envoltorio Tauri; build **debug**, mismo equipo y fixture: ocho unidades con un objeto de 4 MiB por unidad, compartido por sus recursos. Veinte ciclos de apertura y retorno al catálogo. Contador de hashes multiplicado por el tamaño conocido de cada objeto; no son lecturas físicas del dispositivo ni tiempos del programa completo. Preparación del fixture, asentamiento de timestamps y calentamiento de verificaciones quedan fuera del cronómetro. La espera de asentamiento existe solo en el arnés de pruebas; la aplicación nunca duerme para permitir un hit de caché.

| Variante | Bytes hasheados en 20 ciclos | Tiempo total | Mediana por ciclo | P95 por ciclo |
| --- | ---: | ---: | ---: | ---: |
| 1.0.22: open + list al cerrar | 754 974 720 (720 MiB) | 36 742 ms | 1 823,378 ms | 1 972,866 ms |
| 1.0.23: caché vaciada antes del primer ciclo | 33 554 432 (32 MiB) | 1 998 ms | 23,220 ms | 216,890 ms |
| 1.0.23: objetos asentados ya verificados | 0 | 492 ms | 21,985 ms | 24,913 ms |

El caso frío reduce bytes hasheados un 95,56%; cada objeto se valida una vez. Estos números no permiten estimar RAM, swap, latencia Linux ni garantía de toda una jornada. `rchar` cuenta bytes de llamadas de lectura, incluso servidos desde page cache; `read_bytes` cuenta I/O atribuido a la capa de almacenamiento. No se deben sumar RSS compartidos como RAM física única. Referencia: [documentación /proc del kernel](https://www.kernel.org/doc/html/next/filesystems/proc.html).

## Pruebas y aceptación

- Línea base 1.0.22: 136 pruebas JS seleccionadas, 0 fallos; siete pruebas nativas originales de caché, 0 fallos.
- Prueba nueva de biblioteca con 20 unidades: falla sobre fuente original al esperar el cierre; pasa con corrección, conserva catálogo, orden, error recuperable y cero peticiones remotas offline. `list` está deliberadamente bloqueado en el arnés.
- Rust: 19 pruebas de caché y siete de medios pasan; suite completa de biblioteca: 92 pruebas, 0 fallos en macOS. Incluye corrupción con tamaño/mtime restaurado, cambio de inodo, symlink, límite de tabla, integridad/activación y streaming de 600 MiB con buffers acotados.
- Lint Desktop, build TypeScript/Vite y `cargo check --all-targets --locked` pasan. Suite amplia JS inicial: 285 pasan, tres pruebas de empaquetado Linux fallan con Bash antiguo de macOS. No se atribuyen a Linux ni se declaran verdes; CI ejecutará Bash/Linux reales. Las pruebas nuevas de concurrencia/cancelación pasan por separado; suite candidata sin los seis casos de empaquetado Linux: 287 pruebas, cero fallos (antes de añadir la regresión de capas GIF).
- Lint global de los checkouts inicial y vigente falla por problemas ajenos al cambio (137 errores y 37 avisos). No se modificaron esos archivos.
- Prueba nativa existente `media-browser.mjs` ampliada de diez a veinte reaperturas reales de video/proyector. Mantiene techos existentes: principal <256 MiB, cada WebKitWebProcess <768 MiB, incremento tras calentamiento <160 MiB, descriptores +32 y threads +16. Su ejecución real Linux pasó en el runner y en las doce combinaciones de distribución/paquete/backend gráfico, con veinte ciclos por ejecución.

Criterios deterministas: cero auditorías globales al cerrar/error, 20 cambios consecutivos completados, cero hashes adicionales de objetos sin cambios tras verificación, invalidación frente a mutaciones y cero trabajos nuevos después de abortar. En Linux se deben contrastar ciclos del mismo contenido/hardware, latencias P50/P95, RSS/PSS/swap, `rchar`/`read_bytes`, CPU, procesos y streams. El margen de latencia física debe fijarse con línea base del equipo soportado, no extrapolar el benchmark debug.

## Verificación en Ubuntu y Zorin

CI existente compila en Ubuntu 22.04 y comprueba paquetes en Ubuntu 22.04/24.04/26.04. No equivale a Zorin físico ni a equipos limitados del aula. No hubo Ubuntu/Zorin local en esta Mac. La matriz CI Ubuntu 22.04/24.04/26.04 aprobó instalación APT/Gdebi/Dpkg, AppImage offline y medios reales en X11/Wayland; Zorin físico sigue pendiente. Deben repetirse veinte ciclos con unidades reales (imágenes grandes, GIF, audio, video, diapositivas y proyección), reposo, cierre completo/reinicio, offline y actualización.

En Ajustes > Acerca de > Diagnóstico multimedia: iniciar, reproducir la secuencia, guardar reporte en Descargas y detener. Correlacionar `unit-open-start`, `unit-open-ready`, eventos multimedia y `unit-close` con diferencias por `(pid,startTicks)`; contadores ausentes son null. Para atribución a archivos, usar una traza local acotada de open/read del PID señalado y conservarla fuera del repositorio; no activar trazas permanentes ni registrar buffers de contenido. Complementar con `pidstat -r -u -d -p PID 1` durante una ventana corta y PSS de `smaps_rollup` si está disponible. No vaciar page cache ni alterar swap como parte de la corrección.

## Defecto detectado por la primera VALIDATION Ubuntu

Run [42918901172](https://github.com/gonhercaral-cpu/desarrollo-proyectos/actions/runs/42918901172), SHA `6bc30abec47564c380cb82277d618f20dea458c2`: falló `local_media::tests::missing_hash_and_mime_fail_before_grant` en el target `media_playback` (esperaba `damaged`, observó `format`). Una reescritura inmediata pudo conservar la firma de timestamps y reutilizar un SHA antiguo. No se publicó ese candidato ni se cambió la expectativa de la prueba.

Corrección adicional de Claude revisada por Codex: lookup e inserción requieren que ctime ya estuviera asentada al **inicio** de la verificación; el tiempo empleado hasheando no legitima un archivo reciente. No hay esperas en producción. Las pruebas de caché caliente esperan una sola vez por fixture, y las de archivos no asentados verifican que no entren en caché. Límites de tiempo/validez se prueban con reloj inyectado en la función de elegibilidad. Catorce pruebas de inicio/caché y el target concreto que falló pasan localmente tras la corrección; la VALIDATION completa del candidato final también pasó en Ubuntu.

La granularidad variable del kernel está documentada en [Multigrain timestamps](https://www.kernel.org/doc/html/v7.0/filesystems/multigrain-ts.html). La confianza de esta caché supone filesystem local con timestamps normales; no promete resistencia frente a root, retrocesos arbitrarios del reloj ni filesystem remoto. Archivos con timestamps futuros o inválidos usan SHA completo.

## Compatibilidad de cabeceras multimedia

La revisión añadió una regresión para MP4 con un box `free` de 8 KiB antes de `ftyp`: la propuesta de cabecera de 4 KiB lo rechazaba como `format`, mientras la ventana original de 64 KiB lo admitía. La nueva prueba falla antes de restaurar esa ventana; se conserva lectura acotada de 64 KiB y el ahorro del SHA compartido. No se reduce la compatibilidad para ahorrar unos KiB.

## Publicación y comprobaciones finales

Versión final: **1.0.23**. Release público, estable, sin draft ni prerelease; siete assets: `.deb`, AppImage, dos firmas, dos SHA-256 y `latest.json`. Workflow verificó criptografía y versión de las firmas con la clave pública existente antes de publicar. Se comprobaron después los hashes publicados contra los digests SHA-256 de GitHub y la correspondencia de la firma del manifiesto.

Endpoint usado por los equipos existentes, consultado después de publicar, devuelve **1.0.23**: https://github.com/gonhercaral-cpu/desarrollo-proyectos/releases/latest/download/latest.json. Apunta al `.deb` publicado y su firma coincide con el asset. La actualización instalada y persistencia pasaron en el entorno Linux aislado; no se afirma instalación en los equipos reales de los maestros.

Artefactos:
- `Active.Classroom_1.0.23_amd64.deb`: 151606744 bytes, SHA-256 `97ddbdefa9ccd7d522d0b71673bc0e05e1536a740046f13d7f4ef8d4a41a9377`.
- `Active-Classroom-1.0.23-x86_64.AppImage`: 185817592 bytes, SHA-256 `edfa00ee6da593d24d9f74ff62bb717a5a78cb600d6c065e97c1cd587aa111c3`.

No se cambió el workflow, infraestructura, reglas, dependencias, clave pública ni endpoint. El timeout vigente ya era de 120 minutos; la referencia inicial de 60 minutos pertenecía al checkout anterior y no produjo cambios.

## Memoria observada en Linux: alcance y límites

Los logs completos contienen **13 reportes `MEDIA_NATIVE_RESULT`, todos con ok=true y veinte reaperturas**, un runner y doce combinaciones Ubuntu 22.04/24.04/26.04 × deb/AppImage × X11/Wayland. Todos aprobaron los límites existentes. Tras los veinte ciclos, el mayor RSS observado entre reportes fue 215,36 MiB en el proceso principal y 631,09 MiB en un WebKitWebProcess; swap registrado: 0 KiB. No se suman RSS como memoria física única.

El mayor incremento de RSS de un WebKitWebProcess entre baseline calentada y cierre final fue **103,84 MiB**, por debajo del límite existente de 160 MiB. En el runner, ambos procesos WebKit oscilaron y sus medianas tardías descendieron; en una combinación instalada la mediana de los cinco últimos cierres creció **44,52 MiB** frente a los cinco anteriores. Esto **no prueba un plateau durante toda una jornada ni descarta una fuga con contenido real**. Los datos permiten afirmar aprobación del ensayo de veinte ciclos y memoria acotada dentro de sus criterios, no ausencia absoluta de crecimiento a largo plazo.

El cierre WebKitWebProcess fotografiado no se reprodujo en estos ensayos. La causa de I/O redundante sí está demostrada y corregida; la causalidad exacta del cierre y la aceptación en Zorin/equipos limitados siguen pendientes de medición física. La instrumentación añadida permite correlacionar las operaciones con RAM/PSS/swap/CPU/I/O en esa comprobación.

## Commits y archivos

- `6bc30ab`: evita relecturas al cambiar unidades y cancela recursos obsoletos.
- `6a88d64`: revalida archivos recién escritos y protege frente a timestamps coincidentes.
- `74806b4`: conserva cabeceras MP4 antes admitidas.
- `d4159be`: integración del PR #27 en main.

Archivos del cambio funcional validado:
- `active-classroom-desktop/CHANGELOG.md`
- `active-classroom-desktop/package-lock.json`
- `active-classroom-desktop/package.json`
- `active-classroom-desktop/src-tauri/Cargo.lock`
- `active-classroom-desktop/src-tauri/Cargo.toml`
- `active-classroom-desktop/src-tauri/src/local_media.rs`
- `active-classroom-desktop/src-tauri/src/media_report.rs`
- `active-classroom-desktop/src-tauri/src/offline_cache.rs`
- `active-classroom-desktop/src-tauri/tauri.conf.json`
- `active-classroom-desktop/src/offline/library.ts`
- `active-classroom-desktop/src/player/ClassroomPlayer.ts`
- `active-classroom-desktop/src/player/InteractionSurface.ts`
- `active-classroom-desktop/src/player/animated-source.ts`
- `active-classroom-desktop/src/player/renderers/ImageRenderer.ts`
- `active-classroom-desktop/tests/animated-slides.test.mjs`
- `active-classroom-desktop/tests/builds.test.mjs`
- `active-classroom-desktop/tests/media-browser.mjs`
- `active-classroom-desktop/tests/player.test.mjs`
- `active-classroom-desktop/tests/startup-cache.test.mjs`
- `docs/active-classroom-performance-1.0.23.md`
