# Música global y estabilidad multimedia — Desktop 1.0.15

## Catálogo global

`activeClassroomAmbientMusic/catalog` contiene `schemaVersion: 1`,
`ambientCatalogVersion`, `tracks`, `playlists` e integridad SHA-256. Cada cambio
crea además `catalog/versions/{version}`, sin sobrescribir snapshots anteriores.
Cada pista conserva título, MIME, bytes, SHA-256, generación, ruta privada,
orden, origen y estado. `playlists` queda reservado; no hay controles decorativos
ni dependencia de listas de reproducción para usar las pistas.

Importación y carga reutilizan Nube AES, sus permisos y el congelado de archivos
existente. Los originales Drive se transfieren por stream; Storage usa copia
servidor a servidor y comprobación incremental. La música congelada queda en
Storage privado de publicaciones, sin tokens Firebase de descarga.

El migrador recupera pistas publicadas y de borradores, deduplica SHA-256 y no
escribe en Units ni publicaciones. Registra referencias no recuperables y deja
el marcador incompleto para reintentar; conserva los datos anteriores. La UI
administrativa principal es Ajustes Web. Los campos antiguos se mantienen por
compatibilidad, sin exigir republicar Units para cambiar música global.

## Sincronización y reproducción

Desktop consulta el catálogo al iniciar/refrescar Biblioteca, independientemente
de la consulta de publicaciones y de la preferencia de actualizar Units. Reutiliza
los mismos objetos SHA y coordinador de transferencias. Descarga solo archivos
no verificados, verifica bytes/hash y activa el JSON local mediante rename
atómico. Una descarga incompleta conserva el catálogo previo. La restauración
de catálogos inmutables no retiene la compuerta de escrituras de la caché.

Al abrir clase se conserva una versión coherente del catálogo durante esa
sesión. La música no depende del manifest de esa Unit; antes de la primera
sincronización existe fallback para manifests antiguos. Un único elemento audio
pertenece al profesor, con selección de pista y volumen propio. Diapositivas,
revelados y recursos visuales no lo recrean. La preferencia de pausa ante audio/
video conserva la intención manual y no reanuda inesperadamente. El proyector
no crea audio ambiente.

## Multimedia

El video usa `preload="auto"`, lectura de disco de 64 KiB y el servidor loopback
existente. Respuestas 200 y 206 transmiten incrementalmente; 416 conserva la
validación de rangos. Un socket con backpressure no provoca otra lectura de
disco. Desconexión o liberación del último grant cancelan la transferencia.

Los seeks de teclado acumulan el último destino, limitado a la duración, en
ventanas de 90 ms. Hay como máximo un seek del decoder en curso y un destino
pendiente. No cambian src ni llaman load(). El proyector conserva el transporte
en reproducción durante un seek del profesor y corrige al destino estabilizado.
No vuelve a buscar una posición pausada ya alineada. Avance real del reloj limpia
un waiting obsoleto cuando WebKitGTK no repite playing después de buscar.

Tiempo y progreso actualizan controles multimedia, no listas, notas ni sidebar.
Proyección solo modifica su card cuando cambia el estado de los monitores.
Ajustes/updater conservan identidad DOM, scroll y foco; progreso no recrea el
modal ni alterna fullscreen. Progreso de descarga se limita a 150 ms, conservando
el conteo exacto de bytes y las transiciones de verificación/instalación.

No hay workaround de GPU en producción. Los flags de compositor/sandbox de los
harnesses pertenecen exclusivamente a contenedores de CI sin hardware gráfico.

## Seguridad y despliegue

Funciones: `getActiveClassroomAmbientCatalog`, `importActiveClassroomAmbient`,
`uploadActiveClassroomAmbient`, `editActiveClassroomAmbient`,
`migrateActiveClassroomAmbient`, `previewActiveClassroomAmbient` y
`activeClassroomAmbientFile`, en el codebase Drive existente. Reutilizan permisos
de acceso/importación/subida/orden y autorización de dispositivos. Preview usa
URL v4 de cinco minutos, fijada a la generación. La colección global y sus
snapshots privados no permiten acceso directo de clientes mediante Rules.
No se amplían roles globales ni se añaden credenciales al cliente.

Cambian Functions y Hosting. Rules y servicio Office no requieren despliegue.
Distribución conserva Debian/AppImage, baseline Ubuntu 22.04, llaves de firma y
endpoint estable del updater. No se cambian activación, autostart, kiosco ni
configuración del proyector.

## Evidencia y límites de aceptación

La referencia inicial reprodujo el MP4 real autorizado de 311.105.093 bytes,
H.264/AAC, 1920×1080 a 60 fps, en Ubuntu 22.04/24.04, X11/Wayland. Observó
29 seeks por tres ráfagas, 4.045–4.061 mutaciones estructurales y 100 reemplazos
de Ajustes por 100 eventos de progreso. Play→playing fue 16–25 ms: la demora de
varios segundos del equipo físico no apareció y no se atribuye a codecs/GPU.

CI cubre cache/migración/permisos, reproducción y proyección nativas, apertura
repetida, Range abortado, memoria acotada, 20 segundos iniciales, L×10/J×10/L×10
y 60 segundos continuos. Verifica también avance del proyector y frames del
decoder; aprobar únicamente el reloj del profesor resulta insuficiente.
La prueba física de Zorin 18.1 requiere el equipo del usuario; un contenedor
Ubuntu/Wayland no se presenta como una prueba física de Zorin.

Aceptación privada final: build `4cca3007-97ed-4dd5-8c47-b9981491d17a`,
código `5e5c24cb54600329710ac36cbaec5d0fab48261c`. Los cuatro casos nativos
Ubuntu 22.04/24.04 y X11/Wayland aprobaron el MP4 real, 20 segundos iniciales,
tres ráfagas de diez teclas y 60 segundos posteriores con ambos reproductores
sin pausarse y desfase inferior a un segundo. Play→playing: 21–35 ms; cada
ráfaga: 263–358 ms y 2–3 seeks. Reproducción observada: 54–60 fps. Hubo 33
mutaciones estructurales, cero recreaciones de Ajustes y cero streams abiertos
después de cerrar. El máximo simultáneo fue dos, uno por ventana; tampoco se
observó crecimiento de streams abandonados en la referencia inicial.

Las primeras ejecuciones paralelas de los dos sistemas compartiendo el runner
no sirven como aceptación final: una falló por sincronía del proyector y otra
por estado de la ventana de prueba sin actualizar dentro del plazo. Se mantuvieron todas las
validaciones y se separó la ejecución por sistema para probar el código final.
No se adjudica la demora inicial física a una causa que no apareció en CI.

Comparación secuencial equivalente de referencia (`9e024093-6f08-45c6-90d3-0093dc1b8351`):
Play→playing 4–23 ms; 30 seeks totales, 476–547 ms por ráfaga,
4.015–4.063 mutaciones estructurales y 100 recreaciones de Ajustes.
El código final no demuestra una reducción del primer Play ni del coste de
decodificación: proceso nativo 14,8–47,5 % antes / 17,6–52,3 % después;
WebKit por ventana 62,3–136 % antes / 67,3–140,8 % después (100 % = un núcleo).
RSS nativo 152–208 MiB antes / 146–223 MiB después; WebKit por ventana
360–466 MiB antes / 352–462 MiB después. Las diez reaperturas y videos de
120 MiB, 600 MiB y 1 GiB aprueban las comprobaciones de memoria acotada.
Los resultados no se presentan como medición del hardware gráfico de Zorin.

CI completo de código final: `38490798896`, aprobado. Backend: 82 tests;
reglas y transacciones: 163; Desktop: 154, además de Rust, build y aceptación
nativa. Paquetes Debian/AppImage se instalan y prueban en Ubuntu 22.04,
24.04 y 26.04, X11 y Wayland, antes de firmar sus bytes. El tag de producción
`active-classroom-v1.0.15` vuelve a ejecutar el pipeline antes de publicar.
