## 1.0.22 — pendiente de publicación

- Muestra las clases descargadas al iniciar sin esperar la verificación completa de todos los archivos de la biblioteca.
- Espera a recuperar el inventario local antes de programar descargas, evitando nuevas colas para versiones que ya están disponibles.
- Conserva la comprobación SHA-256 al abrir, descargar y activar clases; los fallos de almacenamiento permiten reintentar sin borrar el contenido existente.
- Conserva la identidad persistente y el formato de las clases descargadas de versiones anteriores.

## 1.0.21 — 2026-10-30

- Identidad local cifrada y persistente del equipo, independiente del llavero Login para su uso diario y después de reiniciar o iniciar sesión automáticamente.
- Migra las identidades existentes sin cambiar el código del equipo, la credencial ni el acceso a las clases descargadas; conserva el original del llavero.
- Una identidad anterior bloqueada o no verificable detiene la migración sin generar otra vinculación; los fallos locales se distinguen de una revocación del servidor.
- Recupera escrituras interrumpidas sin volver a rotar la identidad y conserva el mecanismo de actualización firmado existente.

## 1.0.20 — 2026-10-27

- Audio: J/L adelantan y retroceden sin ocultar diapositivas ni interrumpir su navegación; teclas reasignables desde Ajustes > Atajos de teclado.
- Saltos hacia adelante y atrás del audio configurables por separado, conservando el intervalo de video.
- Google Slides grandes o con demasiados estados usan imágenes nativas completas para evitar límites de conversión; GIF y revelados no compatibles quedan estáticos con aviso.
- Conserva asignaciones de teclas, reproducción multimedia, sincronización con proyector, caché y actualizador existentes.

## 1.0.19 — 2026-10-26

- Audio de clase independiente: mantiene diapositivas visibles en maestro y proyector, también al avanzar o retroceder.
- Minirreproductor del maestro con pausa, detener, posición, duración, volumen y minimización sin interrumpir audio.
- Evita superposición con videos y respeta configuración de música ambiente; documentos conservan comportamiento visual.
- GIF compatibles se animan mediante fondo separado y archivos originales locales; composición compleja conserva imagen estática.
- Importación PPTX limita coste de GIF, procesa estados por lotes y conserva diapositivas cuando revelados superan el límite.
- Conserva caché, publicaciones anteriores, atajos, reproducción de video y actualizador firmado existentes.

## 1.0.18 — 2026-10-21

- Retira “Mis clases” del menú lateral; conserva Biblioteca y navegación por niveles.
- Íconos por nivel configurables desde Active Classroom web, disponibles offline y con ícono predeterminado.
- Intervalo de salto configurable desde Ajustes > Atajos de teclado; 5 segundos por defecto en ambas direcciones.
- Conserva asignaciones de teclas, reproducción multimedia, sincronización con proyector, identidad, caché y actualizador existentes.

## 1.0.17

- Corrige la regresión de video del runtime incluido: usa WebKit/GTK/GStreamer del sistema, como 1.0.12. Codecs opcionales corresponden a cada distribución; no sustituye sus bibliotecas principales.
- Comparación física en Zorin 18.1 con el mismo ejecutable: arranque simultáneo, 20 seeks por pantalla y reproducción posterior fluida; sin errores multimedia. Se conservaron identidad, contenido y preferencias.
- El proyector sigue las operaciones de seek del profesor mediante revisión compartida; no vacía el decoder para perseguir cada muestra del reloj.
- Conserva el último destino durante ráfagas J/L, sin cambiar src, recrear video ni duplicar audio.
- Reutiliza un único elemento de video vacío por ventana al reabrir recursos; callbacks antiguos no pueden pausar el recurso nuevo.
- Inicia los seeks del proyector en paralelo al profesor, sin sumar la espera del decoder ni otro debounce.
- Recuperación de equipos revocados: reautorizar, desvincular y volver a vincular sin reinstalar ni borrar contenido.
- Regresión de sincronización cubierta en tests; validación Linux exige al menos 20 cuadros presentados por segundo, comprueba desfase de imagen/audio y controla seeks sintéticos del proyector.

## 1.0.16

- Recuperación de equipos: reautorizar, desvincular y generar código nuevo sin reinstalar; conserva contenido y preferencias.
- Preparación multimedia y seeks interrumpidos ya no se convierten en errores fatales por timeout o AbortError.
- Diagnóstico multimedia voluntario exportable desde Ajustes, con eventos, frames y métricas de procesos/streams sin credenciales.
- Publicación de MP4 con índice al inicio mediante derivado sin recomprimir; publicaciones anteriores inmutables.
- VALIDATION completa antes de firmar, crear tag o publicar; release utiliza exactamente los instaladores verificados.

## 1.0.15

- Biblioteca global de música ambiente, sincronización incremental y caché SHA compartida entre Units.
- Recupera música anterior sin modificar publicaciones históricas; administración en Ajustes Web.
- Prepara multimedia local al abrir, agrupa seeks rápidos y evita buscar repetidamente en el proyector pausado.
- Mantiene estable el panel docente, Ajustes y progreso del updater durante reproducción/descarga.
- Streaming de disco con buffers de 64 KiB, backpressure y cancelación al desconectar/liberar el recurso.

## 1.0.14

- Corrige aborto WebKit al abrir videos: excluye plugins WebRTC con libsoup2 incompatibles con WebKitGTK/libsoup3.
- Música ambiente offline por Unit, volumen independiente y pausa ante multimedia de clase.
- Atajos configurables para música y recuperación de errores multimedia sin cerrar clase.
- Grants locales con liberación y streams cancelables; lecturas siempre de 64 KiB.
- CI valida reproducción real y memoria con paquetes Debian/AppImage instalados, X11/Wayland y archivos hasta 1 GiB.

# Changelog

## 1.0.13 — 2026-10-12

- Instalador Debian usa pkexec y declara dependencias de D-Bus y llavero; incluye runtime multimedia para no depender de codecs instalados manualmente.
- Metadatos Debian completos y validación de instalación limpia en Ubuntu 22.04, 24.04 y 26.04 antes de publicar.
- AppImage adicional con GStreamer incluido y soporte de sesión Wayland.
- Conserva identidad, contenido offline, proyección y actualización firmada de instalaciones Debian.

## 1.0.12 — 2026-10-12

- Ajustes con navegación interna: General, Contenido, Proyector, Apariencia, Inicio, Atajos y Acerca de.
- Atajos personalizables, combinaciones Ctrl/Alt/Shift, conflictos explícitos y restauración de valores predeterminados.
- Preferencias persistentes fuera de caché; activación, contenido offline y pantalla recordada se conservan.
- Descarga de nivel y mantenimiento offline en el sidebar del nivel seleccionado; Biblioteca sin tarjetas superiores permanentes.
- Mismo updater firmado, autostart, kiosco, single instance, streaming local y revelados compartidos con proyector.

## 1.0.11 — 2026-10-12

- Reintentar una Unit puede reparar la misma versión si un archivo local se dañó, conservando versiones anteriores verificadas.
- Actualización automática, descarga de nivel completo y niveles seguidos mantienen progreso y clases locales disponibles.
- Miniatura usa el estado inicial manual y se cambia después de decodificar, sin desmontar Biblioteca.
- Conserva activación, multimedia offline, proyector, updater, autostart y kiosco.

## 1.0.10 — 2026-10-12

- Biblioteca estable durante descargas; progreso por Unit y cola de dos trabajadores con blobs compartidos.
- Actualización automática del contenido descargado y descarga completa de niveles seleccionados.
- Mantener niveles offline incorpora nuevas Units y actualizaciones sin reemplazar una clase abierta.
- Versiones pendientes se verifican y activan al cerrar clase o reiniciar; fallos conservan contenido anterior.
- Fallback manual con imagen inicial sin respuestas y pasos de texto, respuestas o imágenes, congelados y disponibles offline.
- Google Slides recupera revelados desde exportación PPTX verificable; publicaciones anteriores permanecen intactas.
- Conserva activación, streaming multimedia, proyector, updater, autostart y kiosco.

## 1.0.9 — 2026-10-09

- Biblioteca recibe nombres, orden y estado de niveles desde el catálogo de Active Classroom, sin listas fijas.
- Crear, renombrar u ordenar niveles después de esta actualización solo requiere sincronizar Biblioteca.
- Nombres de niveles conservados al reiniciar sin Internet; Units descargadas mantienen sus manifests y archivos.
- Conserva activación, Player, revelados, multimedia, segunda pantalla, updater, autostart y preferencias existentes.

## 1.0.8 — 2026-10-09

- Revelados progresivos por clic, Espacio, flechas y botones; Anterior retrocede un paso antes de cambiar de diapositiva.
- PPTX con aparición o fade por clic conserva estados PNG acumulativos; animaciones no compatibles mantienen la diapositiva estática.
- El profesor controla cada paso y el proyector sigue la misma sesión offline, sin mostrar el indicador privado de pasos.
- Editor web con texto, respuestas, imágenes, posición, orden y vista previa de cada estado.
- Publicaciones congelan estados y assets con integridad y orden, sin modificar versiones existentes.
- Conserva autenticación, caché, multimedia, segunda pantalla, updater e inicio automático existentes.

## 1.0.7 — 2026-10-09

- Actualización firmada del programa al iniciar: descarga, instalación y relanzamiento automáticos, con progreso y protección frente a ciclos de reinicio.
- Sin Internet o ante errores, continúa la Biblioteca local. La búsqueda manual permanece disponible en Acerca de.
- Inicio de sesión Linux mediante el plugin oficial de autostart, habilitado después de activar el equipo; instancia única mediante D-Bus.
- Ajustes de Inicio: autostart, kiosco y salida temporal. Arranque automático en pantalla principal sin abrir el proyector.
- Identidad, activación, Units, caché y preferencias de proyección conservan sus rutas y contenido.
- La versión 1.0.6 publicada requiere actualizar manualmente una vez para incorporar el arranque automático; las siguientes versiones se instalan al iniciar.

## 1.0.6 — 2026-10-06

- Biblioteca y panel docente reproducen el diseño aprobado: sidebar azul, acciones coral, cards claras e iconografía consistente.
- Filtros, búsqueda, grid/list, miniaturas de archivos locales y estados reales de sincronización.
- Proyector fijo; scroll independiente para diapositivas y ambos grupos de recursos; footer sin superposiciones.
- Comprobación responsive en 1366×768, 1440×900, 1920×1080 y 920×640, con 80 diapositivas y 60 recursos por grupo.
- Conserva autenticación, caché offline, reproducción, segunda pantalla y updater firmado.

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
