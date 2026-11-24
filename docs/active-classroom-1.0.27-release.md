# Active Classroom 1.0.27 — duplicación en Ubuntu/Wayland

Estado: **candidata en validación; no firmada ni publicada como estable**. La versión estable continúa siendo 1.0.26.

[PR #53](https://github.com/gonhercaral-cpu/desarrollo-proyectos/pull/53). [Validación Linux de la candidata](https://github.com/gonhercaral-cpu/desarrollo-proyectos/actions/workflows/active-classroom-linux.yml?query=branch%3Acodex%2Fbrowser-mirror).

## Evidencia y corrección

El usuario confirma Ubuntu con Wayland y reporta que 1.0.26 ya conserva el tamaño completo, pero al duplicar desaparece la página del equipo docente y la salida externa queda negra. Se considera un fallo físico reportado de 1.0.26; no una validación de esta candidata. La versión de Ubuntu, GPU y controlador no están identificados.

La implementación anterior trasladaba la única vista WebKit entre ventanas. Ahora esa vista permanece en el equipo docente, con su formulario, navegación y sesión. La ventana externa pinta copias de la imagen visible de esa página mediante GTK; no abre un segundo navegador ni reproduce otro audio. No captura el escritorio ni los controles privados del profesor. Se mantienen las políticas existentes de permisos, archivos, descargas, popups e IPC.

Solo hay una captura en curso y un fotograma retenido, con un máximo de 20 actualizaciones por segundo. La primera imagen debe llegar al callback de dibujo antes de informar que la duplicación está activa. Si deja de llegar imagen durante cinco segundos, se oculta la salida y aparece un error recuperable; el navegador principal permanece disponible.

## Validación y límites

- Pruebas locales aprobadas: navegador Node, lint Desktop, build y Cargo check de todos los targets en macOS. Esto no certifica el código GTK específico de Linux.
- El lint general del repositorio se ejecutó y reportó 136 errores y 37 advertencias en archivos de `src/` y `drive/` sin cambios en esta rama. El lint específico de Desktop sí aprobó; esos problemas anteriores no forman parte de la corrección.
- CI Linux: compilación, pruebas nativas y paquetes; consultar el resultado del commit exacto en el enlace anterior. La aceptación nativa comprueba píxeles conocidos, esquina completa y avance de video, con 30 ciclos de duplicación/retorno a escalas 100% y 200% en Wayland. La captura adicional de la salida real del compositor virtual evita confundir una ventana visible con una imagen correcta.
- Las imágenes del renderizador y del compositor se conservan como artefactos de CI. Solo se utiliza contenido sintético local; la captura del escritorio virtual existe exclusivamente en la prueba.
- Las pruebas virtuales no certifican Mutter/GNOME, los controladores de los salones, conexiones HDMI/DisplayPort, fluidez ni consumo de CPU/GPU. El límite de 20 Hz no equivale a video de 60 fps. El contenido protegido/DRM puede no admitir captura.
- Antes de extender la candidata a los salones, comprobar en un equipo Ubuntu/Wayland que se ven las dos pantallas simultáneamente, que el docente puede navegar y escribir durante la duplicación y que el video avanza sin audio duplicado. Registrar la configuración y el resultado.

La numeración sigue mayor.menor.parche: esta corrección corresponde a 1.0.27; 1.1.0 puede agrupar funciones nuevas y 2.0.0 un cambio mayor o incompatible. No existe un número máximo de parches que obligue a pasar a 2.

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

