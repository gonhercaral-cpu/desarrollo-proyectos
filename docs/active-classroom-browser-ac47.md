# Active Classroom — AC-01, AC-02 y AC-03

Informe de implementación del 23 de noviembre de 2026, con base funcional sobre `active-classroom-v1.0.24`, commit base `1c3ba9c113f0cee5d0066b0696c1ed8585287358`. Issue: https://github.com/gonhercaral-cpu/desarrollo-proyectos/issues/47. Rama de integración `codex/claude/issue-47-20261123`. La candidata preparada es **1.0.25**, publicada como rama y [PR #48 en borrador](https://github.com/gonhercaral-cpu/desarrollo-proyectos/pull/48). **No es un release estable publicado ni una certificación de hardware.** La [preparación del release y aceptación física](active-classroom-1.0.25-release.md) distingue los controles automatizados de los pendientes. El resultado vinculante de CI corresponde al SHA y certificado de VALIDATION de la candidata final, no a una ejecución anterior.

## Comportamiento implementado

### AC-01 — reloj

Conserva `TeacherWorkspace`, el elemento `time`, formato local y temporizador alineado al minuto. El reloj usa `clamp(28px,min(3.4vw,6vh),48px)`; la cabecera permite distribuir controles en varias líneas. En Chromium se observaron 31.28 px a 920×640, 46.08 px a 1366×768 y 48 px a 1920×1080, sin superponer los botones. Se opta por tamaño adaptable sin añadir una preferencia: evita ampliar el panel de ajustes para este cambio.

### AC-02 — unidades completas durante descargas

La base 1.0.24 ya permite abrir unidades locales sin cancelar la cola. Se conserva la activación atómica con SHA-256, deduplicación por hash, recuperación de objetos completos y `protectedUnit`: las actualizaciones de la unidad abierta quedan preparadas hasta cerrarla. No se hace visible una unidad incompleta.

Durante una clase (también al utilizar el navegador), `DownloadQueue.setInteractive(true)` limita la toma de nuevas tareas a un trabajador. Si ya había dos descargas, ambas continúan hasta drenar a una. `BlobTransfers.pace` comparte entre unidades y música ambiente un presupuesto de 4 MiB/s, con burst de 64 KiB, antes de escribir cada chunk. Las esperas son cancelables y se liberan al cerrar o salir de clase. No se almacenan colas de chunks. Al cerrar la clase se recupera la concurrencia habitual. La barra lateral indica descargas en segundo plano.

Este ritmo aplica contrapresión al transporte JS; **no es una cuota del kernel ni una garantía de CPU, disco, red o fluidez**. Una interrupción conserva blobs completos y descarta el `.part` en curso; no se implementa reanudación persistente desde un byte intermedio. Se conservan los reintentos existentes.

### AC-03 — navegador

El botón **Navegador web** abre controles propios dentro de la clase: dirección con HTTPS predeterminado, atrás, adelante, recargar, selección de monitor, mostrar/ocultar pantalla y cerrar. La página ocupa una child webview nativa; no hay iframe, navegador externo ni duplicación del DOM remoto.

La clase permanece montada con la misma unidad, diapositiva, revelados, pestañas y renderers. Se pausan video, audio y música ambiente al abrir; también se detiene un `play` que termine tarde. No se reanudan automáticamente al volver. Los atajos de clase no actúan mientras la herramienta está abierta. Si falla la preparación de la clase, no se inicia contenido web.

**Mostrar en pantalla** mueve la misma vista web a una ventana nativa de salida limpia y la pone a pantalla completa en el monitor elegido. Reutiliza la identidad de monitores y `set_fullscreen_on_monitor` del proyector existente; oculta la presentación local. No usa posición absoluta como sustituto de fullscreen en Wayland. Se rechaza el monitor que utiliza el docente. **Ocultar pantalla** devuelve esa misma vista al área docente sin navegar ni recargar. Las acciones se serializan; se revalida el monitor antes de mostrar y durante el sondeo. Al desconectarlo se intenta retornar; si falla, se destruye la vista. Se conserva el estado de la clase; no se garantiza conservar la página web si falla la recuperación nativa.

Los controles de URL/historial siguen en el panel docente. La interacción directa con elementos del documento proyectado requiere el puntero en la pantalla externa; no se implementa control remoto espejo. No se añaden protocolos inalámbricos.

## Aislamiento y límites

- La vista remota usa un contexto efímero/incógnito. Permite cookies/autenticación durante la sesión y las descarta al destruirse; no hereda la sesión Firebase de la aplicación.
- Capabilities vinculadas a `webviews: [teacher]` / `[audience]`, en lugar de concederlas a toda la ventana. La vista remota no recibe permisos por ser hija de `teacher`. Un filtro global rechaza sus comandos de aplicación; se mantienen los controles por etiqueta de los comandos existentes.
- Solo se admiten URLs HTTP/HTTPS, sin credenciales incrustadas y sin loopback literal/localhost. Se bloquean esquemas locales o ejecutables y se usa `about:blank` únicamente como arranque inerte, antes de instalar las políticas nativas. El filtro no es una política de aislamiento de redes por DNS.
- Tauri rechaza ventanas emergentes, descargas y solicitudes de permisos. Antes de navegar, WebKitGTK recibe bloqueos nativos de selector de archivos, menú contextual, impresión y fullscreen del sitio, además de desactivar herramientas de desarrollo y acceso desde URLs de archivo. No se relaja la CSP local, la verificación TLS ni el sandbox del motor.
- El backend de navegación se habilita solo en Linux: las otras plataformas devuelven un error explícito hasta disponer de sus políticas nativas. No se modifican las restricciones del kiosco del sistema operativo; las combinaciones del escritorio Linux dependen de su configuración administrada.
- Se activa la feature `unstable` de Tauri 2.12.1, que ya está fijado, para `add_child` y `reparent`. Se añade WebKitGTK 2.0.2 como dependencia directa solo de Linux, la misma versión que ya existe transitivamente; no se cambian versiones de crates ni dependencias npm.
- Popups y URLs `blob:` como navegación se bloquean. OAuth que exige una ventana nueva, PDFs que el motor no visualice y páginas con permisos especiales pueden no funcionar. DRM, códecs, autoplay y aceleración dependen del motor/sistema. No hay mecanismos para eludirlos.

## Delegación real

Claude Code ejecutó dos contratos de implementación en ramas locales `agents/claude/issue-47-ui-20261123` y `agents/claude/issue-47-downloads-20261123`: reloj, interfaz y ciclo de vida de la herramienta, regulación de descargas y pruebas. Entregó parches revisados de 7 y 5 archivos, respectivamente. No dispuso de shell, no ejecutó pruebas ni realizó commits/push.

Antigravity ejecutó dos consultas con salida 0 y estado `success`: arquitectura inicial con los cinco archivos autorizados y revisión crítica del resumen de implementación posteriormente autorizado. No editó archivos ni ejecutó pruebas. Su afirmación inicial de ausencia de `reparent` se descartó tras inspeccionar las fuentes fijadas de Tauri/Wry. Sus advertencias sobre Wayland y escalas se conservan como riesgos pendientes de prueba, no como fallos observados.

Codex realizó auditoría, contratos asociados al Issue, backend Rust, controles nativos y ACL, revisión de procedencia/diffs, integración y correcciones de carreras/foco/alertas, pruebas y evidencia visual. Contratos, respuestas y parches se mantienen en `.orquestacion/ac-20261123/` del checkout de control, ignorado por Git. No se publican transcripciones, secretos ni accesos de producción.

## Validación realizada

- 350/350 pruebas Node de las 34 suites portables: navegador, conservación de clase, cola, caché offline, música, audio/video, proyección, inicio, identidad y updater. Las dos suites con requisitos externos se enumeran debajo.
- 97/97 pruebas unitarias Rust en macOS; `cargo check --locked` correcto. Incluyen lecturas/rangos y transferencia de un recurso de 600 MiB. Las comprobaciones de RSS que dependen de `/proc` no miden memoria en macOS. El backend específico de WebKitGTK ya compiló en Ubuntu 22.04; se corrigieron los imports de traits y el error tipado detectados en el primer CI. La aceptación específica del navegador X11/Wayland se ejecuta como parte de VALIDATION de la candidata final.
- TypeScript/Vite correctos, 2/2 verificaciones de assets del bundle; advertencia existente de tamaño del chunk PDF.js.
- `npm run lint:player` correcto, incluido el nuevo módulo. El lint general de la copia de control conserva 137 errores y 37 advertencias ajenos al cambio, también documentados en la base 1.0.24.
- Aceptación Chromium headless: seis escenarios, clase y herramienta a 920×640, 1366×768 y 1920×1080. Viewports exactos mediante DevTools; reloj visible, controles sin superposición, host dentro de ventana, un ajuste de layout y dos sondeos durante 2.2 s, sin bucle de redimensionado. Es una fixture con puente falso, **no navegación remota real ni validación del navegador nativo**.
- Reglas y transacciones Firebase aprobadas en emuladores de CI Ubuntu 22.04; no se conectó a producción. No se cambiaron reglas, identidad ni backend.
- `system-media.test.mjs`: tres casos fallan en Bash 3.2 de macOS al interpretar el script Linux sin modificaciones; requieren Bash moderno/Linux. No se altera empaquetado para ocultar ese límite.

Comandos reproducibles desde `active-classroom-desktop/`:

```sh
npm run lint:player
npm run build
node --test tests/browser-tool.test.mjs tests/browser-class-session.test.mjs tests/download-priority.test.mjs
node tests/teacher-browser-layout.mjs
cd src-tauri
cargo check --locked
cargo test --locked --lib
```

La aceptación visual usa Chrome en macOS o `chromium` en Linux; `CHROMIUM_EXECUTABLE` permite indicar su ruta. `LAYOUT_EVIDENCE` permite elegir la carpeta de capturas.

## Aceptación Linux y hardware pendiente

**No publicar como estable antes de completar esta matriz y compilar/validar los instaladores Linux del commit exacto.**

| Escenario | Evidencia requerida |
| --- | --- |
| Ubuntu y Zorin, X11 y Wayland | Abrir/cerrar y presentar/retornar al menos 30 veces sin cierre de app, pantalla negra persistente o pérdida del documento. Registrar versiones de SO, WebKitGTK, GPU y sesión. |
| Pantallas/proyector HDMI/DisplayPort | Selección correcta, salida limpia, controles en docente; escalas 100%/200%, redimensionado y desconexión durante reproducción, navegación y retorno. |
| Páginas educativas | Historial, enlaces, autenticación en misma ventana, documentos y multimedia compatible. Registrar limitaciones reales de OAuth, PDF, DRM y códecs. |
| Seguridad | Intentos de IPC de aplicación/plugins, archivos locales, popups, descarga, selector de archivos, impresión, cámara/micrófono, geolocalización, notificaciones, fullscreen y cierre mediante scripts. Verificar también reglas de kiosco del SO. |
| Descargas durante clase | Abrir A completa mientras B descarga; reproducir video/audio y web; comprobar progreso, hashes, ausencia de duplicados, actualización staged de A y recuperación después de interrumpir la red o reiniciar. |
| Rendimiento | Medir CPU, RSS, descriptores y frames en equipos escolares; al cerrar, ausencia de medios/procesos retenidos o crecimiento acumulativo. No sustituir esto por las pruebas con mocks. |
| Instalación y updater | Build Linux y VALIDATION del SHA exacto; instalar paquetes, reiniciar, conservar vinculación/caché y comprobar detección, descarga e instalación de la nueva versión en un equipo de prueba. |

## Commits locales

- `d21432a`: reloj, navegador, aislamiento nativo e interfaz, pruebas y aceptación visual.
- `11e6932`: regulación de descargas durante clase y regresiones con caché real.
- El informe y la matriz de aceptación se registran en un commit documental posterior. Los parches auxiliares se integraron tras revisión; no hubo merges remotos.

## Publicación y reversión

No se modifican Digital Signage, Firebase, configuración de vinculación, workflows, claves ni endpoints del updater. La rama está publicada y existe el PR #48 en borrador. No hay merge a `main`, tag, firma estable, release publicado ni despliegue. El manifiesto público consultado sigue anunciando 1.0.24 con plataforma `linux-x86_64-deb`, firma presente y URL del `.deb` publicado. Esto comprueba el manifiesto existente, no que un equipo haya instalado una versión nueva.

El workflow existente se dispara al publicar cualquier rama con cambios del desktop y tiene pasos de empaquetado/firma, además del flujo manual RELEASE. El propietario autorizó el push y CI para preparar 1.0.25. Después de aceptar Linux/hardware, publicar exclusivamente los artefactos certificados del mismo SHA, conservando los artefactos y metadata de 1.0.24 para reversión. Las pruebas del updater preservan sus barreras de firma y procedencia; no se han ejecutado instalaciones remotas.

## Compatibilidad de comandos con varias vistas

La aceptación nativa detectó que Tauri deja de ofrecer `WebviewWindow` cuando una ventana contiene varias vistas. Los argumentos inyectados de comandos usan ahora `Webview` y conservan sus comprobaciones de etiqueta del solicitante; las operaciones de pantalla obtienen su `Window` por separado. No cambian credenciales, roles, formatos de vinculación, caché ni firmas del updater. La fixture comprueba por IPC real que el docente puede leer el inventario con el navegador abierto y que la página remota no puede hacerlo. Esta adaptación evita bloquear las descargas y el control al añadir la vista hija.
