# Active Classroom 1.0.27 — duplicación en Ubuntu/Wayland

Estado: **1.0.27 firmada y publicada como estable**, con autorización explícita del usuario. [Release público](https://github.com/gonhercaral-cpu/desarrollo-proyectos/releases/tag/active-classroom-v1.0.27). Las **12 pruebas físicas permanecen pendientes**.

- [PR #53 integrado](https://github.com/gonhercaral-cpu/desarrollo-proyectos/pull/53).
- Código certificado: `587dda4d9f550220066047feac97f7f3b22a349a`; [VALIDATION completa aprobada](https://github.com/gonhercaral-cpu/desarrollo-proyectos/actions/runs/45463113637), con instaladores exactos y certificado verificados localmente.
- Merge: `1122bdef38b7f6ec322fa062d8451f0b9b1dc56e`. Su árbol completo coincide con el código certificado; [CI adicional del merge aprobado](https://github.com/gonhercaral-cpu/desarrollo-proyectos/actions/runs/45490994170).
- [Firma y publicación aprobadas](https://github.com/gonhercaral-cpu/desarrollo-proyectos/actions/runs/45506712748). Se firmaron los bytes certificados, sin recompilar.
- El endpoint público del actualizador anuncia 1.0.27 y su plataforma `linux-x86_64-deb` apunta al paquete firmado de esta versión.
- Verificación pública: firmas y versión de ambos instaladores contrastadas con la clave pública oficial y los bytes completos de CI; tamaños/digests de GitHub coinciden con el certificado. Se descargaron prefijos HTTP de 1024 bytes de ambos archivos y coinciden con esos bytes. No se presenta esto como descarga pública completa ni instalación física.

| Instalador | SHA-256 |
| --- | --- |
| `Active.Classroom_1.0.27_amd64.deb` | `f0ee2a543d3a5bcc20ed2c44c54eeb7b3baf711eec288b4ab091077400f81fe0` |
| `Active-Classroom-1.0.27-x86_64.AppImage` | `9b8ba2f347d8e4b165b614d432056fbdc49e5fd2e1577d38a94900b053298d54` |

## Evidencia y corrección

El usuario confirma Ubuntu con Wayland y reporta que 1.0.26 ya conserva el tamaño completo, pero al duplicar desaparece la página del equipo docente y la salida externa queda negra. Se considera un fallo físico reportado de 1.0.26; no una validación de esta candidata. La versión de Ubuntu, GPU y controlador no están identificados.

La implementación anterior trasladaba la única vista WebKit entre ventanas. Ahora esa vista permanece en el equipo docente, con su formulario, navegación y sesión. La ventana externa pinta copias de la imagen visible de esa página mediante GTK; no abre un segundo navegador ni reproduce otro audio. No captura el escritorio ni los controles privados del profesor. Se mantienen las políticas existentes de permisos, archivos, descargas, popups e IPC.

Solo hay una captura en curso y un fotograma retenido, con un máximo de 20 actualizaciones por segundo. La primera imagen debe llegar al callback de dibujo antes de informar que la duplicación está activa. Si deja de llegar imagen durante cinco segundos, se oculta la salida y aparece un error recuperable; el navegador principal permanece disponible.

## Validación y límites

- Pruebas locales aprobadas: navegador Node, lint Desktop, build y Cargo check de todos los targets en macOS. Esto no certifica el código GTK específico de Linux.
- El lint general del repositorio se ejecutó y reportó 136 errores y 37 advertencias en archivos de `src/` y `drive/` sin cambios en esta rama. El lint específico de Desktop sí aprobó; esos problemas anteriores no forman parte de la corrección.
- CI Linux aprobado: compilación, pruebas nativas y paquetes. Instalación APT y Gdebi en Ubuntu 22.04/24.04/26.04 y 12 combinaciones de multimedia/ejecución: `.deb` y AppImage con X11 y Wayland en las tres versiones. La aceptación nativa comprueba píxeles conocidos, esquina completa y avance de video, con 30 ciclos de duplicación/retorno a escalas 100% y 200% en Wayland. La captura adicional de la salida real del compositor virtual evita confundir una ventana visible con una imagen correcta.
- Las imágenes del renderizador y del compositor se conservan como artefactos de CI. Solo se utiliza contenido sintético local; la captura del escritorio virtual existe exclusivamente en la prueba.
- Las pruebas virtuales no certifican Mutter/GNOME, los controladores de los salones, conexiones HDMI/DisplayPort, fluidez ni consumo de CPU/GPU. El límite de 20 Hz no equivale a video de 60 fps. El contenido protegido/DRM puede no admitir captura.
- La aceptación física pendiente debe comprobarse en los salones, comprobar en un equipo Ubuntu/Wayland que se ven las dos pantallas simultáneamente, que el docente puede navegar y escribir durante la duplicación y que el video avanza sin audio duplicado. Registrar la configuración y el resultado.

La numeración sigue mayor.menor.parche: esta corrección corresponde a 1.0.27; 1.1.0 puede agrupar funciones nuevas y 2.0.0 un cambio mayor o incompatible. No existe un número máximo de parches que obligue a pasar a 2.

## Antecedente de validación

El primer intento del run 45463113637 registró una detención al reanudar video después de varias reaperturas en el fixture AppImage/Ubuntu 24.04/X11 (reloj en 1.004 s, sin MediaError). Ese ejecutable no importa los módulos del navegador. El reintento del mismo commit aprobó toda la matriz sin modificar el código multimedia ni las pruebas o sus límites. El CI del merge también aprobó la matriz completa. Se conserva el antecedente; no se atribuye a una causa física demostrada ni se afirma haber corregido una causa no identificada. La prueba física de reanudación y reaperturas sigue pendiente.

## Aceptación física que requiere equipos

Registrar cada resultado con versión de SO, sesión X11/Wayland, WebKitGTK, GPU/controlador, resolución, escala y tipo de conexión. Marcar **pendiente**, **aprobado** o **falló**, adjuntando evidencia; una ejecución virtual no autoriza marcar un equipo como probado.

| Prueba | Equipo/condiciones | Resultado y evidencia |
| --- | --- | --- |
| Instalación limpia y actualización | Ubuntu con Wayland de los salones; Zorin si aplica; `.deb` y AppImage aplicables | Pendiente |
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
| Actualizador en equipo de prueba | Detección, descarga, firma, instalación, reinicio y conservación de datos de la versión 1.0.27 | Pendiente |

