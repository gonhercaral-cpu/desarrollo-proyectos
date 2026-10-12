# Distribución Linux 1.0.13

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

`Recommends`: PAM de GNOME Keyring y plugins GStreamer base/good/bad/libav para los
formatos multimedia. APT y Gdebi en la instalación gráfica normal los
instalan automáticamente. CI exige que estén presentes después de ambos flujos;
no se permite publicar si faltan. No se recomienda una instalación con
`--no-install-recommends` para un equipo de salón completo.

La clasificación importa: el updater oficial instala Debian mediante `dpkg`,
que no descarga dependencias adicionales. Las dependencias obligatorias siguen
siendo resolubles desde una instalación existente. CI instala los bytes reales
de 1.0.12 y actualiza usando `dpkg -i`, sin `apt --fix-broken`, comprobando que
configuración/caché permanezcan intactas. Los plugins existentes se conservan.

## AppImage

AppImage adicional, con `bundleMediaFramework: true` y GStreamer incluido. Su hook
de empaquetado conserva sesión Wayland frente al hook GTK que impone X11.
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
