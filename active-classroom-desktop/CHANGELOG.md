# Changelog

## 1.0.5 — 2026-10-06

- Release firmada para validar actualización automática desde 1.0.4 habilitada.
- Misma clave pública, endpoint y contrato de datos; activación, caché, Units y preferencias se conservan.
- Estados distinguen versión actual, nueva versión, error de Internet y configuración ausente.

## 1.0.4 — 2026-10-06

- Actualización del programa mediante updater oficial Tauri 2, paquetes Debian firmados y versión vinculada criptográficamente.
- Aviso de nueva versión, notas, progreso, reintento y reinicio explícito; comprobación al arrancar sin bloquear Biblioteca.
- Ajustes / Acerca de con versión instalada y búsqueda manual. Identidad, activación, caché y Units mantienen sus rutas.
- CI verifica instalación real 1.0.0/1.0.1, firma inválida, replay de versión, fallo de Internet y datos conservados.

## 1.0.3 — 2026-10-06

- Panel derecho acotado al viewport; proyección fija y scroll por listas/secciones.
- Multimedia desde HTTP loopback privado con Range, MIME explícito y bloques de 64 KiB; solo caché verificado.
- Diagnóstico local de integridad, HTTP y MediaError, sin tokens; mensajes diferenciados.
- Pruebas Rust de Range, integridad, paths y 600 MiB; aceptación Tauri/WebKitGTK con MP4 H.264/AAC y Units largas.

## 1.0.2 — 2026-10-06

- Descarga y caché de publicaciones de hasta 10 GiB por archivo; límite centralizado con backend.
- Conserva descarga temporal por bloques, verificación de tamaño/SHA-256 y activación atómica.
- Backend publica por jobs: Drive por streaming, Storage por copia server-side y progreso web.
- Pruebas con 300 MiB, fallo durante transferencia, reintento y ausencia de versiones parciales.

## 1.0.1 — 2026-10-05

- Google Slides entregado como PNG privados por diapositiva; evita el límite de exportación de Drive.
- Player elige el archivo local de cada slide y conserva posición al volver de recursos asociados. PDF/Office procesado conservan su contrato anterior.
- Manifest schema 2 mantiene original, revisión del procesamiento y checksum/generación por imagen; sincronización, caché y autenticación no cambian.
- Nuevas pruebas de procesamiento, fallo/reintento, publicación inmutable y navegación de slides PNG offline.

## 1.0.0 — 2026-10-05

Primera versión estable para Linux tras piloto real en Zorin confirmado por el usuario.

- Activación por código y autorización administrativa del equipo; sin login humano en el salón.
- Nombre visible administrado desde Active Classroom → Equipos, persistido también offline.
- Biblioteca Nivel/Unit con versiones remotas y locales independientes; actualización sin destruir la última copia funcional.
- Descargas autenticadas, temporales, comprobación de tamaño/SHA-256 y activación solo al completar la versión.
- Caché y manifest persistentes; reapertura de clases descargadas después de reiniciar y sin Internet.
- Player local para PDF, imágenes, audio y video; Office entregado como PDF procesado por backend.
- Proyector independiente con sesión docente única, audio exclusivo del profesor y restauración tras reconectar.
- Selección de monitor compatible con Wayland mediante Tauri 2.12.1 `setFullscreenOnMonitor`.
- Versiones package/Tauri/Cargo unificadas. CI verifica versión del `.deb`, integridad del instalador, assets PDF.js y patrones de secretos en fuentes/build.
- Documentación de instalación, activación, renombrado, sincronización, actualización y recuperación offline.

Sin nuevas funciones, migraciones de caché, cambios backend ni cambios de UX en este cierre.

### Límites conocidos

- Códecs MP4/H.264/AAC y otros formatos multimedia dependen de WebKitGTK/GStreamer del equipo.
- El llavero Secret Service debe estar configurado y desbloquearse con la sesión Linux.
- Una clase requiere descarga completa previa para funcionar offline. Una instalación nueva requiere Internet y autorización.
- Office se reproduce mediante derivados PDF; sin PPTX directo, animaciones Office ni segunda salida de audio.
- Sin autoactualizador. Nuevas versiones de aplicación se instalan mediante `.deb`.
- SHA-256 verifica integridad; no sustituye firma digital del distribuidor. Descargar desde la ejecución CI verificada.
