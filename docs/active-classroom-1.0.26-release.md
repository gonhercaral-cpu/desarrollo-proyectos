# Active Classroom 1.0.26 — corrección de navegador y proyección

Estado: **1.0.26 firmada y publicada como estable**, con autorización explícita del usuario. [Release público](https://github.com/gonhercaral-cpu/desarrollo-proyectos/releases/tag/active-classroom-v1.0.26). Las 12 pruebas físicas permanecen pendientes.

[Firma y publicación aprobadas](https://github.com/gonhercaral-cpu/desarrollo-proyectos/actions/runs/45341311772). El endpoint público del actualizador anuncia 1.0.26; la instalación sobre equipos físicos sigue pendiente.

- Código certificado: `3a3e9059b8136ca391c33efa8c1c1bc5b43618ee`.
- Merge: `95299bee9a6b56fc030e227394c8a58d2089a8df`, con el mismo árbol de archivos que el código certificado.
- [CI adicional del merge aprobado](https://github.com/gonhercaral-cpu/desarrollo-proyectos/actions/runs/45340698886): todos los controles obligatorios en verde, incluidos paquetes e instalación en Ubuntu 22.04/24.04/26.04. No hubo fallos adicionales que corregir.
- Instaladores candidatos `.deb` y AppImage: [artefactos del run aprobado](https://github.com/gonhercaral-cpu/desarrollo-proyectos/actions/runs/45329577199).
- Las 12 pruebas físicas permanecen pendientes.

## Problemas corregidos

El video aportado por el usuario muestra el navegador sin ocupar correctamente el área docente y una pantalla externa negra al activar la proyección. No se considera ese video una prueba de la corrección.

Tauri/Wry coloca en Linux sus vistas en un contenedor GTK vertical, que repartía el espacio e ignoraba las coordenadas solicitadas. El navegador ahora ocupa una capa superpuesta sobre el rectángulo reservado, conservando completo el viewport docente. La ventana externa creada oculta tenía también oculto su contenedor GTK; ahora se muestra y su tamaño se ajusta por GTK después de configurarse la pantalla. Se conserva la misma página y sesión al proyectar y volver.

La modificación mantiene los controles de navegación y las políticas nativas de permisos, archivos, descargas, popups y aislamiento IPC. No cambia vinculación, contenidos offline ni el formato del actualizador.

## Validación

- [PR #52](https://github.com/gonhercaral-cpu/desarrollo-proyectos/pull/52).
- [CI Linux](https://github.com/gonhercaral-cpu/desarrollo-proyectos/actions/runs/45329577199).
- Pruebas nativas: geometría y visibilidad reales de GTK, viewport docente intacto, monitor de destino y 30 ciclos de proyección/retorno en Wayland; sesiones X11 y Wayland con GDK_SCALE=1 y 2.
- Clics y teclado nativos en X11: barra docente accesible y página web interactiva.
- Se distinguen las comprobaciones automatizadas de la aceptación física pendiente en la matriz siguiente.

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

