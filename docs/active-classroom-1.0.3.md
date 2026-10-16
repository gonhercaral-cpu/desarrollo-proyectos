# Active Classroom Desktop 1.0.3 — scroll y multimedia local

Paquete amd64 construido en Ubuntu 22.04 para mantener compatibilidad con la base
Linux existente. Actualiza la misma aplicación; conserva identidad, caché y clases.
Estos cambios no necesitan desplegar backend.

## Instalar en Zorin

Cerrar Active Classroom antes de instalar. Desde la carpeta del instalador:

```bash
sha256sum --check 'Active Classroom_1.0.3_amd64.deb.sha256'
sudo apt install './Active Classroom_1.0.3_amd64.deb'
active-classroom 2>&1 | tee active-classroom-media.log
```

No instalar más plugins por suposición. El diagnóstico de esta versión permite
distinguir integridad/ruta, transporte HTTP, formato y soporte multimedia.

## Comprobación con el MP4 que fallaba

1. Abrir la Unit ya sincronizada, sin volver a descargar el archivo.
2. Abrir MP4; probar play, pause, seek adelante/atrás, volumen, mute y fullscreen.
3. Proyectar, volver a presentación y reabrir el MP4.
4. Desconectar Internet y repetir; HTTP multimedia usa solamente `127.0.0.1`.
5. En una Unit larga, alcanzar última slide, último recurso asociado y último general
   con rueda/touchpad. Proyector/selector permanecen visibles.

El log registra `[Active Classroom Media]`: ruta de caché anonimizada, existencia,
tamaño esperado/real, SHA-256 válido, MIME, códecs reales del MP4, URL local sin grant,
canPlayType, Range/HTTP y eventos loadstart/loadedmetadata/canplay/error/stalled/suspend.
Incluye MediaError.code/message y networkState/readyState; no registra tokens ni
credenciales. Una reproducción correcta tiene MediaError.code 0.

## Transporte

PDF e imágenes conservan asset/convertFileSrc. Video/audio usan un servidor Rust
en un puerto aleatorio de loopback con grants opacos, limitado a objetos verificados
del caché. Comprueba tamaño y SHA-256 incremental antes de exponer el archivo;
lee bloques de 64 KiB tanto con Range como sin Range. Soporta 206, 416, MIME explícito,
Content-Range/Length y seek. La audiencia acepta solo grants del servidor de esta app.

## Alcance de la evidencia

CI Linux Desktop completada el 2026-10-06 en Cloud Build:
`41c608ae-e975-48b0-b064-df845e276003` (SUCCESS).
Ubuntu 22.04, WebKitGTK 2.50.4, Tauri 2.12.1; paquete amd64 de 7 565 334 bytes.

- Mismo fixture H.264/AAC: asset entrega MediaError.code 4, networkState 3,
  readyState 0; HTTP loopback reproduce con código 0 y códecs reales
  `avc1.42C01E, mp4a.40.2`. La comparación identifica el transporte asset como
  responsable; no aísla el mecanismo interno exacto de Range del proveedor.
- Play/pause, seek adelante/atrás, volumen/mute, fullscreen, seguidor de proyección,
  reapertura y recursos totalmente locales pasan. También MP4 válido de 600 MiB
  con una caja `free` sparse. Transferencia completa de 600 MiB con SHA correcto:
  crecimiento RSS medido 0 bytes en el test Rust.
- Slide 80, último asociado y último general accesibles con estilos reales en
  1240×820 y 920×640; proyección permanece fija.
- Player 23/23, offline 29/29, proyección 18/18, Rust 25/25 contando el llavero
  aislado. TypeScript/Vite, lint, Cargo check, Wayland con dos monitores virtuales
  y build Tauri/Debian correctos.
- SHA-256 del instalador, verificado después de descargar:
  `072ceea5e6512ad907eaca99fa53ed604e434c51ab12c8d2b3e11c4f170077bf`.

El fixture automático H.264/AAC y su variante de 600 MiB prueban el transporte y el
Player en WebKitGTK Linux. No sustituyen probar el archivo original en el Zorin del
salón: no hay acceso remoto a ese equipo ni al MP4 original en esta sesión.
