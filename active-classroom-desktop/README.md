# Active Classroom

> Fuente de escritorio importada al repositorio Desarrollo de Proyectos. Se
> mantiene ejecutable como paquete independiente mientras sus capacidades se
> migran a `../src/active-classroom/`.

Base inicial de una aplicación de escritorio Tauri para macOS, Windows y Linux. Está pensada para trabajar con dos pantallas:

- **Panel del profesor:** selección de `Nivel → Unidad → Día`, materiales y control de lo que se proyecta.
- **Vista del alumnado:** ventana limpia, sincronizada y lista para mostrarse a pantalla completa en un segundo monitor.

La biblioteca incluye una jerarquía local de demostración para mostrar el flujo del aula; el contenido pedagógico definitivo todavía no se ha proporcionado.

## Abrir y ejecutar en Visual Studio Code

Requisitos: Node.js 20 o posterior, Rust estable y los [requisitos del sistema de Tauri](https://v2.tauri.app/start/prerequisites/) para la plataforma.

```sh
npm install
npm run tauri:dev
```

Para revisar solo la interfaz en el navegador:

```sh
npm run dev
```

Administración web mantiene biblioteca local compartida con aplicación docente durante desarrollo:

```sh
npm run admin:dev
```

Se abre en `http://127.0.0.1:1430/`. Su Vite expone API solo localhost: admin escribe `local-library/catalog.json` y `local-library/files/`; docente lee esos datos sin editar. Cambios aparecen al pulsar **Actualizar** o recargar docente. No es backend de producción, Google Drive, OAuth ni nube. Consulta `admin-web/README.md` y `local-library/README.md`.

En el navegador, el botón de pantalla secundaria abre una ventana de simulación. En Tauri, mueve la vista del alumnado al monitor secundario disponible y activa pantalla completa. Si solo hay un monitor, usa la pantalla actual.

## Estructura

```text
src/
  main.ts                         Entrada mínima y estilos
  app.ts                          Selección de vista docente/alumnado
  components/
    teacher-dashboard.ts          Composición y eventos del panel docente
    teacher-sidebar.ts            Biblioteca Nivel > Unidad > Día y acordeón
    presentation-stage.ts         Escenario, controles y vista siguiente
    slide-renderer.ts             Render del manifiesto PPTX interno
    audience-window.ts            Vista limpia y sincronizada del alumnado
    unit-files.ts                 Archivos read-only de Unit
  models/
    content.ts                    Modelo y biblioteca local
    presentation.ts               Contrato del manifiesto de presentación
    library-catalog.ts             Contrato de catálogo compartido
  state/classroom-store.ts        Estado compartido entre ventanas
  services/
    tauri-bridge.ts               Selector, comandos y rutas Tauri
    library-catalog.ts             Lectura del puente localhost
    session-resources.ts           Validación y lista de recursos de sesión
  styles/index.css                Entrada del sistema visual adaptable
  utils/dom.ts                    Acceso DOM y escape de texto
src-tauri/
  src/lib.rs                      Importador PPTX y arranque Tauri
  src/audience_window.rs          Colocación/fullscreen en segunda pantalla
  tauri.conf.json
```

```text
admin-web -> API Vite localhost -> local-library/catalog.json + files/
                                      |
                                      +-> escritorio docente (solo lectura)
```

Docente muestra exactamente cinco niveles base y Units del catálogo; sidebar nunca muestra archivos. Seleccionar Unit carga **Archivos de esta unidad** en área central. Tarjeta compacta **Segunda pantalla** consulta estado/resolución real vía Tauri, con `1920 × 1080` como respaldo si API nativa no está disponible.

Para localizar un cambio: la composición visual vive en `components`, los efectos de Tauri en `services/tauri-bridge.ts`, el estado sincronizado en `state`, los contratos en `models` y la conversión PPTX en `src-tauri/src/lib.rs`. La interfaz pública de los comandos Tauri no cambió.

## Contenido e importación

El selector de archivos acepta presentaciones, PDF, video, audio e imágenes. Valida formato, tamaño y archivo vacío, muestra cada recurso en la lista de la sesión y ofrece vista previa local para imagen, video, audio y PDF. Estos recursos permanecen en memoria durante la sesión; todavía falta copiarlos al directorio de datos de la aplicación y guardar el manifiesto para conservarlos después de reiniciar.

Para PowerPoint existe un motor interno independiente de Office: **Importar PPTX al formato interno** abre el selector del sistema, analiza el contenedor Open XML, extrae texto e imágenes, registra audio/video incrustado o vinculado, copia los recursos al directorio de datos de Active Classroom y guarda un `manifest.json`. La vista del presentador permite navegar, saltar a una diapositiva y ver la siguiente; la ventana del alumnado recibe únicamente la diapositiva actual.

Compatibilidad inicial real:

- Texto y cajas de texto con posición/tamaño aproximados.
- Imágenes estáticas extraídas del PPTX.
- Detección y almacenamiento de audio/video; reproducción cuando el códec sea compatible con el WebView de la plataforma.
- Advertencias por diapositiva y por presentación.

No se ejecutan macros/VBA, ActiveX, complementos, objetos incrustados, animaciones complejas, SmartArt, transiciones avanzadas ni interactividad programada. Tablas, gráficos, temas, fuentes y formas complejas pueden simplificarse. El archivo original no se modifica.

Al continuar, se recomienda:

1. Añadir un comando Rust para copiar los recursos de sesión al directorio de datos de la app.
2. Persistir una biblioteca JSON validada y ofrecer edición de niveles, unidades y días.
3. Ampliar el motor PPTX con temas, formas, tablas/gráficos y una línea de tiempo de animaciones segura.
4. Definir el comportamiento al desconectar el segundo monitor y restaurar la sesión.

## Compilar instaladores

```sh
npm run tauri:build
```

Los iconos definitivos y la firma/notarización de cada plataforma quedan pendientes de identidad visual y credenciales de distribución.
