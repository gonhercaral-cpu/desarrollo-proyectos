# Active Classroom 1.0.0 — operación en salones

Aplicación Linux amd64, Tauri 2.12.1. El usuario confirmó piloto real en Zorin con activación, sincronización, clases offline, Player y proyector operativos. CI valida de nuevo el código de 1.0.0; una prueba virtual no sustituye comprobar monitor/audio en cada salón.

## Instalación y actualización del Desktop

Descargar el artefacto `active-classroom-1.0.0-linux-amd64-<commit>` de la ejecución exitosa **Active Classroom Desktop Linux**. Extraer `.deb` y `.sha256` en la misma carpeta. Ejecutar desde esa carpeta:

```sh
sha256sum --check 'Active Classroom_1.0.0_amd64.deb.sha256'
sudo apt install './Active Classroom_1.0.0_amd64.deb'
```

No instalar si la comprobación falla. Los paquetes de runtime necesarios se resuelven con apt. Secret Service/llavero debe desbloquearse al iniciar sesión Linux; si el sistema usa autologin y el llavero queda bloqueado, el administrador debe configurarlo. No borrar el llavero ni `~/.local/share/com.activeclassroom.desktop/`: ahí se conservan identidad y caché respectivamente. Instalar sobre la versión anterior conserva ambos; no requiere reactivación ni migración.

Abrir **Active Classroom** desde aplicaciones. En cada salón comprobar una Unit local, PDF, imagen, audio/video compatibles, shortcuts y fullscreen en el monitor seleccionado. Desconectar/reconectar HDMI y restaurar; repetir después de reiniciar sin Internet.

## Activación y nombre visible

1. Primera apertura muestra **Este equipo necesita activarse**, nombre técnico y código temporal.
2. Administrador abre sistema web **Active Classroom → Equipos**, localiza solicitud y código, define opcionalmente nombre como **Salón 4 - Inglés** y pulsa **Autorizar**.
3. En Desktop pulsar **Reintentar activación**. Abre Biblioteca automáticamente, sin correo/contraseña.
4. Para renombrar posteriormente, editar nombre visible desde **Equipos**. Desktop lo recibe en la siguiente conexión y conserva el último conocido offline. Hostname, deviceId, credencial y clases descargadas no cambian.

Identidad persistida en llavero Linux, ID token generado automáticamente mediante Firebase Auth. El dispositivo solo puede leer publicaciones/manifests y descargar archivos publicados. Revocación bloquea conexiones futuras; una aplicación sin Internet no puede conocer una revocación nueva hasta reconectar.

## Sincronización inicial y actualización

1. Con Internet y equipo autorizado, abrir Biblioteca o pulsar **Actualizar biblioteca**.
2. Seleccionar Nivel/Unit y descargar publicación. Esperar **Actualizada** y **Local: vN**; **Abrir clase** permanece deshabilitado sin una copia completa.
3. Comprobación de manifest, tamaños y SHA-256 precede activación local. Archivos incompletos nunca reemplazan la versión funcional.
4. Tras publicar contenido nuevo en web, **Actualizar biblioteca** muestra **Publicada: vN+1 / Local: vN** y **Actualización disponible**.
5. Descargar actualización. Mientras tanto puede abrirse la copia local anterior. Tras verificar y activar, muestra **Local: vN+1**.

Las versiones del contenido son independientes de la versión 1.0.0 de la aplicación. Este cierre no exige republicar Units ni desplegar Functions/reglas.

## Recuperación sin Internet o con descarga fallida

- Equipo previamente activado: abrir Biblioteca en **Modo offline** y usar clases ya sincronizadas, incluso después de cerrar/reiniciar.
- Recuperar conexión para renovar sesión y consultar publicaciones. Si fuera necesario, pulsar **Actualizar biblioteca** y reintentar la descarga.
- Error de integridad, timeout o falta de espacio: conservar copia local; liberar espacio si corresponde y reintentar. No borrar identidad ni caché como primer recurso.
- Clase sin copia local: no podrá abrirse hasta terminar descarga con Internet.
- Proyector desconectado: la clase continúa en el profesor. Reconectar, seleccionar monitor y pulsar **Restaurar proyección**.

## Validación y límites

CI ejecuta tests de Desktop, prototipo conservado, backend, reglas/emuladores, Office en contenedor, Rust, llavero real, WebKitGTK y proyección Wayland con dos salidas virtuales. Verifica assets PDF.js locales, ausencia de patrones conocidos de secretos, versiones, `.deb` amd64 y SHA-256. La comprobación automática de secretos es una defensa adicional, no una prueba matemática de ausencia.

Se conservan diagnósticos operativos con eventos/estados, versiones y datos de monitor; no incluyen tokens, credenciales ni respuestas completas. No se encontró debugging temporal obsoleto en la entrada de producción.

Conservar `.deb`, checksum y referencia al commit: artefactos CI caducan a los 14 días. No hay autoactualización ni firma de distribución. Códecs y configuración física de audio/monitor deben comprobarse por equipo. Consultar [changelog](../active-classroom-desktop/CHANGELOG.md) y [proyector](active-classroom-projection.md).
