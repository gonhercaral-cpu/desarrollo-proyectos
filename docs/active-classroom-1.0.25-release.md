# Active Classroom 1.0.25 — preparación del release

Estado: **1.0.25 publicada como estable**, con aceptación expresa del usuario de las limitaciones físicas documentadas. Las 12 pruebas físicas de esta matriz siguen **pendientes**; no se consideran realizadas por la publicación.

## Resultado de publicación

- [PR #48 integrado](https://github.com/gonhercaral-cpu/desarrollo-proyectos/pull/48), merge `3191a612e598d7f2e44c8c5192337b2121a24700`.
- Código certificado y tag: `f1677c0b5613caf881fe98a08e994d9c6608eccf`.
- [VALIDATION completa aprobada](https://github.com/gonhercaral-cpu/desarrollo-proyectos/actions/runs/45251651419).
- [RELEASE aprobado: firma y verificación criptográfica de ambos instaladores](https://github.com/gonhercaral-cpu/desarrollo-proyectos/actions/runs/45277063304).
- [Release público 1.0.25](https://github.com/gonhercaral-cpu/desarrollo-proyectos/releases/tag/active-classroom-v1.0.25), con `.deb`, AppImage, firmas, hashes, certificado e informes. Se publicaron los mismos bytes de VALIDATION.
- El manifiesto público del actualizador apunta a 1.0.25. La actualización sobre equipos físicos permanece pendiente. El test instalado de CI usa fixtures 1.0.6 → 1.0.7.
- La validación de instalación y reproducción offline pasó en contenedores Ubuntu 22.04/24.04/26.04; no certifica Zorin, GPU ni proyectores reales.
- La versión 1.0.24 continúa conservada para reversión. Los apartados siguientes registran la preparación y las limitaciones aceptadas; la publicación no cambia sus resultados físicos.

## Propuesta

- Issue: [AC-47](https://github.com/gonhercaral-cpu/desarrollo-proyectos/issues/47).
- PR integrado: [#48](https://github.com/gonhercaral-cpu/desarrollo-proyectos/pull/48).
- Rama: `codex/claude/issue-47-20261123`.
- Base funcional: `active-classroom-v1.0.24`.
- Versión candidata sincronizada en npm, lockfiles, Cargo y configuración Tauri: `1.0.25`.

## Notas preparadas

El reloj del maestro aumenta su tamaño y se adapta a la resolución. Las unidades completas permanecen disponibles mientras otras se descargan; durante una clase se regula la concurrencia y el ritmo compartido de transferencia. El nuevo navegador permite introducir una dirección, navegar, recargar y mostrar la misma página en una pantalla externa, conservando la unidad y la diapositiva abiertas.

La sesión web es efímera y se separa de los permisos de la aplicación. Se mantienen las restricciones nativas de navegación, permisos sensibles, archivos, descargas y ventanas emergentes. Al abrir el navegador se pausan los medios de la clase y no se reanudan automáticamente al cerrarlo. Las páginas que requieren popups, determinados códecs o DRM pueden no ser compatibles.

## Procedencia y distribución

VALIDATION debe producir `.deb`, AppImage, `verify_updater` y `validation.json` para el mismo SHA. Antes de firmar, contrastar repositorio, run, versión, tamaños y SHA-256 con el certificado y la API de GitHub. No regenerar ni sustituir instaladores después de esa verificación. La firma y publicación estable corresponden al flujo RELEASE existente, que vuelve a comprobar el commit y los bytes.

La preparación no altera el manifiesto público de actualización ni instala nada en los salones. Se conservarán los instaladores y manifiesto firmados de 1.0.24 para reversión. No se cambia el formato de vinculación, caché o preferencias.

## Historial de comprobaciones y límites

El primer CI de la candidata detectó dos errores de compilación exclusivos de Linux en la política WebKitGTK; quedaron corregidos. En el run `45243386080`, intento 1, la prueba de reapertura de video registró un crecimiento de aproximadamente 191 MiB en un WebProcess y falló el límite existente. La misma prueba pasó en el intento 2, sin cambios de código ni límites, y también pasó el control sobre el tag 1.0.24 (`45245574578`, detenido tras esa comparación para evitar reconstruir la versión base). No se afirma que una fuga de memoria haya sido identificada o corregida por un reintento.

Los fixtures directos se alinearon después con `MALLOC_MMAP_THRESHOLD_=131072`, política ya aplicada por el lanzador instalado en `system-media.sh`. Se conserva una configuración explícita del administrador y todos los límites de RSS, descriptores y crecimiento; no se fuerza GC ni se cambia la implementación multimedia de producción. La aceptación física debe comprobar crecimiento sostenido con los equipos reales.

El harness del navegador también se corrigió para esperar la carga inicial: Wry puede descartar callbacks de evaluación antes de que exista el contexto JavaScript. Se mantienen las condiciones funcionales y de aislamiento. La ejecución final debe aprobar ambas suites y los paquetes; los runs fallidos o cancelados no sirven como certificado.

Entorno observado en CI: Ubuntu 22.04, WebKitGTK 2.50.4 y Rust 1.100.0. Las pantallas virtuales/software no certifican un proyector, GPU o instalación de Zorin. Consultar el estado actual del PR y el certificado descargado de VALIDATION para los resultados finales y el SHA exacto.

## Aceptación física que requiere equipos

Registrar cada resultado con versión de SO, sesión X11/Wayland, WebKitGTK, GPU/controlador, resolución, escala y tipo de conexión. Marcar **pendiente**, **aprobado** o **falló**, adjuntando evidencia; una ejecución virtual no autoriza marcar un equipo como probado.

| Prueba | Equipo/condiciones | Resultado y evidencia |
| --- | --- | --- |
| Instalación limpia y actualización | Ubuntu y Zorin utilizados por los salones; `.deb` y AppImage aplicables | Pendiente |
| Vinculación y funcionamiento offline | Reiniciar sin Internet; abrir varias unidades conservadas; verificar identidad y preferencias | Pendiente |
| Reloj y área de contenido | Resoluciones reales, zoom/escalas 100% y 200%; diapositivas y multimedia | Pendiente |
| Clase durante descargas | A completa y B incompleta; video, audio y música; comprobar avance, hashes y ausencia de duplicados | Pendiente |
| Recuperación de descarga | Interrumpir red y reiniciar; conservar blobs completos, reintentar el recurso incompleto | Pendiente |
| Sitios educativos y autenticación | URLs de uso docente; navegación e interacción; registrar incompatibilidades de PDF, OAuth, DRM y códecs | Pendiente |
| Proyección y retorno | HDMI/DisplayPort, monitor y proyector; 30 ciclos con formulario, scroll y video activos | Pendiente |
| Pantallas con escalas distintas | Panel 4K/200% y proyector 1080p/100%; comprobar imagen y posición del puntero | Pendiente |
| Desconexión y reconexión | Retirar cable durante navegación, video y cambio de pantalla; recuperación sin cerrar Active Classroom | Pendiente |
| Kiosco y permisos | Popups, enlaces externos, protocolos locales, selector de archivos, impresión, cámara/micrófono, notificaciones, fullscreen, atajos del SO y cierre mediante scripts | Pendiente |
| Rendimiento y limpieza | CPU, RSS, GPU, frames y descriptores con descargas; 30 aperturas/cierres; ausencia de crecimiento sostenido o audio residual | Pendiente |
| Actualizador en equipo de prueba | Detección, descarga, firma, instalación, reinicio y conservación de datos de la versión candidata final | Pendiente |

## Condición de salida

Un CI verde acredita únicamente los escenarios automatizados registrados. La publicación estable requiere resolver los fallos observados y aceptar expresamente las limitaciones físicas y de sitios. Preparar la ejecución RELEASE con el run y SHA certificados, sin usar una ejecución antigua de otro commit.

## Compatibilidad de comandos con varias vistas

La aceptación nativa detectó que Tauri deja de ofrecer `WebviewWindow` cuando una ventana contiene varias vistas. Los argumentos inyectados de comandos usan ahora `Webview` y conservan sus comprobaciones de etiqueta del solicitante; las operaciones de pantalla obtienen su `Window` por separado. No cambian credenciales, roles, formatos de vinculación, caché ni firmas del updater. La fixture comprueba por IPC real que el docente puede leer el inventario con el navegador abierto y que la página remota no puede hacerlo. Esta adaptación evita bloquear las descargas y el control al añadir la vista hija.
