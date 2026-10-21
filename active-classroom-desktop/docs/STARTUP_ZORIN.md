# Inicio de equipos de salón (1.0.7)

La versión 1.0.6 publicada no contiene estas funciones. Actualizar una vez desde
Ajustes / Acerca de o instalar el `.deb` 1.0.7. No reactivar ni borrar datos.

Al iniciar, Desktop carga la identidad y preferencias locales y consulta el
updater firmado existente. La consulta tiene un presupuesto de cuatro segundos;
una respuesta tardía nunca inicia una instalación durante una clase. La descarga
automática tiene un timeout de 60 segundos. Ante errores continúa la Biblioteca.
Linux conserva la autorización administrativa exigida para instalar paquetes.

Los plugins oficiales `tauri-plugin-autostart` y `tauri-plugin-single-instance`
crean la entrada de inicio de sesión y mantienen una instancia mediante D-Bus.
La entrada pasa `--from-autostart`. Después de la primera activación queda
habilitada; desactivarla en Ajustes guarda una decisión persistente.

`startup-v1.json` pertenece al directorio de configuración de la aplicación.
Guarda únicamente preferencias de inicio y la versión instalada antes del
relanzamiento. No escribe identidad, caché ni preferencias del proyector.
Si el ejecutable antiguo reaparece después de instalar, la marca impide repetir
indefinidamente instalación y reinicio. La búsqueda manual sigue disponible.

Kiosco se aplica cuando la Biblioteca está lista y el inicio fue automático.
Usa fullscreen en el monitor principal; no crea la ventana de audiencia. En
Ajustes / Inicio, «Salir de modo kiosco» restaura temporalmente una ventana
maximizada. La preferencia se conserva para el próximo inicio de sesión.

## Aceptación física en Zorin 18.1

1. Actualizar manualmente 1.0.6 a 1.0.7. Confirmar versión, activación, nombre,
   Units descargadas y configuración del proyector.
2. Comprobar ambas preferencias de Inicio habilitadas. Cerrar sesión e iniciarla;
   verificar una sola ventana, Biblioteca fullscreen en monitor principal y
   proyector cerrado.
3. Reiniciar el PC y repetir. Abrir nuevamente desde el menú; debe enfocarse la
   ventana existente. Salir temporalmente del kiosco para mantenimiento.
4. Sin Internet, repetir inicio de sesión y reinicio. Abrir una Unit local y
   reproducir recursos. Conectar la segunda pantalla y proyectar una clase.
5. Deshabilitar autostart; cerrar/iniciar sesión y comprobar que no arranca.
   Abrir manualmente, rehabilitarlo y repetir.
6. Publicar la siguiente versión firmada. Iniciar sesión y comprobar descarga,
   firma, instalación (autorización Linux si corresponde), relanzamiento,
   Biblioteca en kiosco y datos conservados. Reabrir: no reinstala ni reinicia.

CI prueba paquetes de aceptación 1.0.6 y 1.0.7 **compilados con el nuevo código**,
instalación real, firma corrupta, replay, Internet fallido, entrada `.desktop`,
instancia única, kiosco Wayland y conservación de datos. Esa fixture no convierte
la 1.0.6 ya publicada en una versión con actualización automática al iniciar.
El cierre de sesión y reinicio físicos de Zorin requieren el equipo del salón.
