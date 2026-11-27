# AS Print Agent 1.1

Este servicio por usuario recibe desde Desarrollo de Proyectos los PDF definitivos asignados a sus colas CUPS. macOS y Linux con CUPS son compatibles. El navegador puede cerrarse tras la confirmación del trabajo. Se requiere que el equipo anfitrión permanezca encendido, conectado y con acceso al servidor de impresión local.

## Instalar y vincular

1. Instala Python 3.9 o superior, qpdf y las utilidades CUPS `lp`, `lpstat`, `lpoptions` e `ipptool`. En macOS, qpdf se instala con `brew install qpdf`. En Debian/Ubuntu los paquetes son `python3 qpdf cups-client cups-ipp-utils`. Configura las impresoras en el sistema.
2. En macOS, instala el paquete `as-print-agent-1.1.0-macos.pkg`, si tu política de instalación admite su firma. El paquete se construye sin firma Developer ID por defecto. Para instalación por usuario en macOS o Linux, extrae `as-print-agent-1.1.0.tar.gz` y ejecuta `sh install.sh` desde el directorio extraído. El ejecutable queda en `~/.local/bin/as-print-agent`. Al actualizar, detén el servicio y vuelve a ejecutar el instalador. Conserva el directorio de estado privado.
3. Ejecuta `as-print-agent diagnose` o `~/.local/bin/as-print-agent diagnose`. Revisa cada cola, su aceptación de trabajos, color, dúplex y papeles anunciados. Corrige controladores ausentes y colas detenidas antes de vincularlas. El diagnóstico solo consulta CUPS.
4. En Configuración de Imprenta, un administrador crea el código de un agente. Caduca en diez minutos. En el equipo de impresión ejecuta `as-print-agent pair --queue NOMBRE_CUPS` y pega el código cuando se solicite. Repite `--queue` para autorizar más colas. El código se introduce sin eco y queda fuera del historial de órdenes.
5. Ejecuta `as-print-agent run` en primer plano para probar la conexión. Para arrancar con la sesión del usuario, detenlo y ejecuta `python3 ~/.local/lib/as-print-agent/enable-service.py`. Con el paquete macOS la ruta es `/usr/local/lib/as-print-agent/enable-service.py`. Requiere sesión gráfica macOS o sesión systemd de usuario en Linux. La vinculación y el arranque se solicitan explícitamente.
6. Elige un PDF de prueba sin datos personales, una copia y una cola autorizada. Compara en papel con la vista previa. Activa el flujo de certificados en la configuración web sólo tras validar la conservación de dimensiones, folio y QR y la recuperación ante fallos.

## Estados y recuperación

Cada equipo se autentica por HTTPS saliente con credencial de 256 bits. El servicio remoto vuelve a validar la identidad y la revocación en cada operación. Las credenciales de dispositivos y las huellas de los códigos se conservan en `printAgentSecrets`, sin acceso por clientes Firestore. `printAgents` y `printPrinters` contienen metadatos consultables por los operadores autorizados. Un latido anuncia hasta treinta colas cada minuto. Una cola CUPS que acepta trabajos puede representar un dispositivo apagado. La disponibilidad física debe verificarse con el equipo.

Un agente reserva cada subtrabajo durante cinco minutos y verifica SHA-256, versión, número de páginas, rango y opciones antes de entregarlo a CUPS. qpdf conserva el contenido original de las páginas al extraer un segmento. Escala original, medios anunciados, modo de color, dúplex por borde largo e intercalado dependen del controlador. Acabados manuales requieren revisión posterior. La duración y los niveles de consumibles dependen de la telemetría disponible.

El registro SQLite en `~/.local/state/as-print-agent` persiste los intentos en disco antes del envío. Una reserva sin envío puede caducar. Un reinicio o una respuesta perdida durante la entrega exige conciliación del operador. `submitted` significa aceptado por CUPS. `spoolCompleted` significa completado según la cola CUPS. La revisión física, el conteo y el ingreso de productos terminados son operaciones del gestor. Reasigna solamente las páginas o copias pendientes confirmadas. Pausar el agente no retira trabajos que la cola ya aceptó.

Los PDF temporales residen en un directorio privado y se borran al terminar cada intento. Tras una interrupción abrupta, la siguiente ejecución limpia la caché. El sistema de impresión puede tener su propia política de retención. Los intentos locales terminados se purgan tras treinta días. El diagnóstico no lee documentos ni secretos.

Para cambiar de equipo, revoca primero el agente en la web. Los trabajos ya aceptados por CUPS conservan su estado en ese equipo. Detén el servicio antes de retirar la instalación. En Linux usa `systemctl --user disable --now as-print-agent`. En macOS descarga el LaunchAgent con `launchctl bootout gui/$(id -u)/org.desarrolloproyectos.as-print-agent` y retira su plist del directorio `~/Library/LaunchAgents`.

## Construcción y validación

`sh build-release.sh /ruta/de/salida` produce el instalador portable y, en macOS, el paquete nativo. Revisa las huellas impresas antes de publicar. Ejecuta `python3 -B as-print-agent/test_agent.py` y `node --test tests/print-agent.test.cjs` desde la raíz del proyecto. El ensayo de PDF usa el ejecutable qpdf real. El ensayo de reinicios sustituye el comando de envío por una cola controlada, sin tiraje físico.

El ensayo opcional `python3 -B as-print-agent/test_virtual_ipp.py` inicia una impresora IPP virtual local sin anuncios DNS-SD. Envía una copia de las páginas 41–80, verifica los bytes recibidos y lee el estado final con IPP. Requiere `ippeveprinter` y el archivo de prueba CUPS `/usr/share/cups/ipptool/print-job.test`. Para las pruebas de reserva simultánea y descarga por fragmentos en Firebase, ejecuta `tests/print-agent-emulator.test.cjs` con Firestore y Storage emulados.

## Telemetría CUPS

La versión 1.1 informa su versión y los atributos que devuelve su servidor CUPS local. La web muestra estado, incidencias, aceptación de trabajos, cantidad en cola, modelo, ubicación, velocidad nominal y niveles de consumibles y bandejas cuando la cola dispone de los atributos IPP. La ausencia de un atributo deja el campo sin datos y una lectura antigua conserva su hora. Si CUPS informa caras procesadas de un pedido, la web las muestra junto al tramo. La revisión física conserva su paso de conciliación independiente.

Para actualizar, detén el servicio y reinstala con el paquete de esta versión. Conserva el directorio privado del agente para mantener su identidad y los intentos registrados.
