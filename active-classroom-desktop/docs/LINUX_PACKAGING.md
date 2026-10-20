# Distribución Linux 1.0.17

## Regresión demostrada y corrección

Comparación física en Zorin 18.1/Wayland, mismo ELF `ec6a3e2a`, Player, servidor
y MP4: framework empaquetado bloqueado; framework del sistema fluido. El segundo
caso registra veinte seeks en cada pantalla, reproducción posterior continua,
medianas de 29,91/29,88 cuadros presentados por segundo y ningún MediaError.
El usuario confirma también otro MP4 de la Unit sin tirones ni desfase.

El runtime anterior rechaza los drivers VA del sistema con
`__vaDriverInit_1_0` y selecciona `avdec_h264`. El nativo usa `vah264dec` en ambos
procesos, sin forzar ranks ni GPU. OpenGL sí funcionaba en ambos casos: el plugin
que faltaba era un defecto real, pero incluirlo no resolvía esta regresión.
La comparación demuestra el problema del runtime privado frente al del sistema;
no atribuye todos sus efectos exclusivamente a una biblioteca individual.

Debian/AppImage usan GLib/GTK/WebKit/GStreamer principal de la distribución, como
el Debian 1.0.12. No incluyen otra copia del framework ni preloads de GLib.
Los launchers limpian overrides heredados y conservan Wayland, identidad,
formato de updater y ruta de autostart/relaunch. Si existen todos los plugins,
no cambian ninguna ruta de bibliotecas/plugins: la ruta probada físicamente.

## Codecs sin romper instalaciones existentes

El updater oficial usa `dpkg` sin descargar dependencias: sus Depends se conservan.
CI prepara codecs opcionales desde repositorios firmados de Ubuntu 22.04/24.04/
26.04. Cada conjunto corresponde a su core GStreamer e incluye solo plugins y
dependencias ausentes de esa distribución base; registra versiones, paquetes
fuente, licencias, tamaños y SHA-256. No distribuye otro core GTK/WebKit/GStreamer.

Cuando faltan plugins, se añaden exclusivamente los ausentes del conjunto de
ese Ubuntu, comprobando versión mayor/menor GStreamer. Las bibliotecas nativas
siempre tienen prioridad. No descarga/instala paquetes ni ejecuta comandos
privilegiados al iniciar. APT/Gdebi/updater no requieren preparar codecs a mano.

AppImage conserva su marcador, identidad y artefacto firmado. Requiere un sistema
compatible con GTK/WebKitGTK 4.1 y Secret Service; su AppRun usa la misma selección
nativa. CI reempaqueta con el plugin AppImage oficial de Tauri.

## Validación y publicación

Baseline Ubuntu 22.04 amd64. Se conservan instalación limpia APT/Gdebi/Dpkg en
22.04/24.04/26.04, ABI/iconos, H.264/AAC Debian/AppImage X11/Wayland, memoria,
threads/descriptores/streams, identidad y upgrade real 1.0.12 mediante dpkg.
No se relajan umbrales. VALIDATION no tiene claves privadas. RELEASE solo firma
los mismos bytes certificados del commit verde; firma y publicación requieren
aprobación separada según las instrucciones actuales del propietario.

# Distribución Linux 1.0.13 — historial

Baseline de compilación: Ubuntu 22.04 x86_64. Validación real en contenedores
Ubuntu 22.04, 24.04 y 26.04, antes de permitir firma/publicación.

## Diagnóstico

El paquete 1.0.12 exige `policykit-1`, paquete transitorio que no está disponible
en Ubuntu 26.04. El error aportado por el usuario corresponde a 1.0.4 y muestra
la misma dependencia. Los bytes publicados de 1.0.12 se instalan por APT en
Ubuntu 22.04/24.04 limpios, pero reproducen ese bloqueo en 26.04. El usuario
confirmó posteriormente que instalación gráfica en Zorin ya funciona.

El executable anterior necesita GLIBC 2.34 y no referencia GLIBCXX directamente.
La arquitectura, permisos 0755, icono y launcher ya eran correctos; no existen
scripts de mantenimiento. El Maintainer anterior no incluía correo; ahora usa
la identidad real de mantenimiento del repositorio.

## Dependencias

`Depends`: bibliotecas enlazadas de libc/GCC/LZMA/D-Bus, sesión D-Bus, herramientas
Secret Service/GLib, GNOME Keyring y `pkexec`, más GTK/WebKitGTK agregados por Tauri.
No se incluye tray ni libxdo: el executable no los enlaza.

Pruebas reales detectaron que Gdebi omite `Recommends`: declarar codecs ahí no
garantiza reproducción tras instalación gráfica. Agregarlos a `Depends` también
rompería actualizaciones desde una instalación anterior sin esos paquetes,
porque el updater oficial instala mediante `dpkg` y no descarga dependencias.

El Debian incluye por tanto el runtime GTK/GStreamer de la AppImage bajo
`/usr/lib/active-classroom`, mediante `bundle.linux.deb.files` en la configuración
de producción generada por CI. Un launcher 0755 conserva `/usr/bin/active-classroom`
y ejecuta ese runtime. El executable interior es el Debian original generado
por Tauri, conservando su tipo de paquete y updater Debian. No modifica código
de activación, Player ni updater. Solo PAM de GNOME Keyring sigue recomendado.
El launcher conserva `/usr/bin/active-classroom` como ruta estable usada por los
helpers oficiales de autostart/relaunch; el marcador Debian del ELF determina
por separado el formato del updater. CI comprueba ambos contratos.
El hook de integración usa GLib y libsecret del sistema: con GLib privada de
Ubuntu 22.04, `/usr/bin/gdbus` de Ubuntu 24.04 falló realmente con
`undefined symbol: g_string_free_and_steal`. El hook mantiene la ABI del llavero
sin cambiar autenticación, y conserva GTK/WebKit/GStreamer empaquetados.
También mantiene la cadena de dependencias del sistema de GLib/libsecret;
Ubuntu 26.04 requiere `MOUNT_2_40` en GIO. No mezcla esa GIO con libmount antigua.
Tauri copia solo el árbol `usr` de los archivos adicionales a AppDir. CI coloca
los hooks declarados en `files` en la raíz real de AppRun y vuelve a empaquetar
con el plugin AppImage oficial ya descargado por Tauri, antes de validar/firmar.
El Debian final usa XZ para reducir la descarga del runtime sin cambiar timeouts
del updater. Instalación/verificación/firma se ejecutan sobre esos mismos bytes.

CI exige plugins empaquetados, reproducción H.264/AAC con esos plugins, arranque
real Debian/AppImage en X11/Wayland e identidad compartida. Instala además los
bytes reales de 1.0.12 y actualiza usando `dpkg -i`, sin `apt --fix-broken`,
comprobando que configuración/caché permanezcan intactas.

El builder instala explícitamente `gstreamer1.0-gl`: `libgstreamer-gl1.0-0`
solo proporciona la biblioteca y no incluye `libgstopengl.so`. WebKit necesita
el plugin `opengl` (`glupload`/`glcolorconvert`) para su salida GL; sin él utiliza
la ruta de repintado por CPU. CI comprueba esas fábricas antes del build y exige
el plugin dentro de ambos instaladores. Esto habilita la ruta de renderizado;
no fuerza un decoder de hardware ni cambia la configuración gráfica del equipo.

## AppImage

AppImage adicional, con `bundleMediaFramework: true` y GStreamer incluido. Su hook
de empaquetado conserva explícitamente la sesión Wayland en el flujo de GTK.
No cambia código de Player, activación, sincronización, proyector ni autostart.

La imagen portátil usa el mismo identificador y datos de Active Classroom. No
registra otra aplicación, otro mecanismo de activación ni otro updater. La
distribución automática existente sigue siendo Debian: `latest.json` conserva
exclusivamente `linux-x86_64-deb`; AppImage se distribuye como alternativa manual.

AppImage requiere una sesión Linux compatible con Secret Service y herramientas
`/usr/bin/secret-tool` y `/usr/bin/gdbus`. Son infraestructura existente de
identidad segura y no se pueden reemplazar desde packaging sin cambiar activación.
El instalador Debian las resuelve automáticamente. No incluye llaveros/credenciales.

En Docker no hay dispositivo FUSE. Los smoke tests usan el fallback oficial
`--appimage-extract-and-run`, ejecutando la imagen real sin instalar Active
Classroom, con red deshabilitada y perfiles temporales. Comprueban ventana,
instancia única, identidad persistente y Wayland con dos salidas virtuales.
Los flags de sandbox/composición utilizados por CI no entran en el producto.

## Orden de publicación

Tests existentes y Rust; build Debian/AppImage sin secretos privados; inspección
de metadata, ABI, launcher/icono; instalación limpia APT/Gdebi; loader smoke;
instalación Dpkg/desinstalación; AppImage offline; upgrade real 1.0.12; firma con
CLI oficial Tauri `signer sign --app-version`; verificación criptográfica; metadata;
release estable. Las firmas cubren exactamente los bytes ya validados.
