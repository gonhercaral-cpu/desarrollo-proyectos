# Música ambiente y corrección Linux 1.0.14

El borrador contiene `backgroundMusic: [{ id, resourceId, title, sourceType: "file", order }]`.
Solo admite recursos de audio de la misma Unit. Asociar/ordenar pistas requiere
`orderMaterial`; subir/importar/publicar conserva sus permisos independientes.
Los archivos se congelan mediante el pipeline existente, con generaciones
inmutables y SHA-256 incremental. El manifest añade MIME, tamaño, SHA-256,
Storage path y generación; sus recursos forman parte de la descarga atómica.
Sin pistas se conserva el formato anterior, sin migrar publicaciones históricas.

`sourceType` separa archivos publicados de una futura fuente `external` con
`url` HTTPS. Esta entrega habilita exclusivamente archivos verificables offline;
no reproduce, extrae ni descarga YouTube. Una fuente externa futura deberá usar
reproducción oficial y mostrar «Requiere Internet», fuera de la caché publicada.

El profesor posee un controlador de audio por sesión. No se monta otra copia en
el proyector; cambiar slide/build/recurso no desmonta la música. Volumen propio,
play/pause y orden de pistas. Al comenzar multimedia de clase, se pausa por
defecto; permanece pausada hasta decisión explícita del profesor. No existe
reanudación automática que pueda sobrescribir una pausa manual. Preferencia
persistente y tres comandos configurables sin teclas predeterminadas.

## Regresión de video

1.0.12 y 1.0.13 tienen el mismo Player y servidor Rust. 1.0.13 incorporó un
runtime privado de GStreamer. Su `libgstwebrtc.so` arrastra libsoup2 mediante
libnice/GUPnP. WebKitGTK 4.1 usa libsoup3: el escaneo dentro de WebKit termina
con `libsoup3 symbols detected. Using libsoup2 and libsoup3 in the same process
is not supported.` Se reprodujo usando las librerías del AppImage publicado.
El diálogo del sistema sobre memoria no demuestra una lectura completa de MP4.

El paquete excluye plugins que enlacen directa o indirectamente libsoup2.
WebRTC no interviene en nuestra segunda pantalla. Se conservan demuxers,
codecs y transporte loopback. Registry separado del sistema. Servidor transmite
200/206 con bloques de 64 KiB; 416 para rangos inválidos. Grants con leases y
cancelación al liberar el último propietario. Renderers eliminan src/listeners
y detienen reproducción; UI permite reintentar/volver manteniendo sesión.

La aceptación instalada también reprodujo `gst_sparse_file_set_fd: fd != 0`
tras reaperturas grandes: descriptor 0 puede ser un archivo temporal válido.
Se recompila únicamente `libgstcoreelements.so`, versión 1.20.3, cambiando
esa comprobación a `fd >= 0`. Codecs y versión del framework permanecen.
La prueba C fuerza descriptor 0, demuestra rechazo original y verifica
lectura/escritura después del cambio. No se desactivan verificaciones.
Fuente oficial fijada por SHA-256
`607daf64bbbd5fb18af9d17e21c0d22c4d702fffe83b23cb22d1b1af2ca23a2a`;
receta, prueba y licencia incluidas en el paquete y en el repositorio público.

## Validación

CI prueba el runtime del Debian/AppImage instalado, con el mismo servidor y
renderers, mediante un entrypoint de aceptación sin autenticación ni datos
productivos. Red desconectada; Ubuntu 22.04/24.04/26.04, X11/Wayland. Dos
WebViews de profesor/proyector. MP4 H.264/AAC pequeño y contenedores válidos
120/600/1024 MiB: MP4 codificado seguido de box `free` disperso; no son una
hora de video codificado. Valida Range, 200 streaming, seek, controles, repetición,
RSS, decoders y limpieza. GPU/sandbox flags solo del harness por restricciones
del runner; nunca del paquete. La validación física de GPU/Zorin requiere el
equipo del usuario. Fallo de aceptación impide firma/publicación.
