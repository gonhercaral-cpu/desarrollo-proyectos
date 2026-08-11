# Active Classroom · Administración web

Prototipo local conectado a aplicación docente mediante puente de desarrollo en localhost. No usa Google Drive, OAuth, autenticación real, backend remoto ni servicios de nube.

La pantalla inicial de acceso es **solo una demostración visual**. La autenticación no está activa: cualquier correo y contraseña no vacíos permiten abrir la biblioteca local. La contraseña se limpia inmediatamente, no se persiste y no se envía. Los botones Google, Microsoft y recuperación son referencias visuales sin conexión externa.

Desde la raíz del proyecto:

```sh
npm run admin:dev
```

Abrir `http://127.0.0.1:1430/`.

Validar la compilación:

```sh
npm run admin:build
```

## Arquitectura frontend

- `src/main.ts`: entrada mínima.
- `src/app.ts`: composición e inicio de controladores.
- `src/models.ts`: contratos TypeScript compartidos.
- `src/state/store.ts`: estado UI; catálogo compartido es autoridad.
- `src/components/`: login, sidebar, biblioteca, Inspector y modal de Ajustes. Cada módulo conserva markup, eventos y render propio.
- `src/services/files.ts`: detección de tipos, tamaños y dimensiones.
- `src/services/storage.ts`: IndexedDB para carpetas, metadata y blobs.
- `src/services/local-catalog.ts`: adaptador del catálogo compartido.
- `local-library-plugin.mjs`: API Vite local para catálogo/binarios.
- `src/utils/dom.ts`: acceso DOM, escape HTML y avisos.
- `src/styles/`: tokens/globales, login, componentes y breakpoints; `index.css` solo compone hojas.

El Inspector mantiene encabezado, bloque de metadatos y acciones en filas estables. Solo su escenario central cambia para imagen, video, audio o PDF. Ajustes usa un `<dialog>` centrado; X, fondo, Escape y devolución de foco comparten un controlador aislado.

Cinco carpetas raíz `Nivel 1` a `Nivel 5` y sus `Unit 01` a `Unit 16` viven en `../local-library/catalog.json`. Admin permite abrir Nivel/Unit, crear o renombrar Units y subir archivos solo dentro de Unit. Cada upload mantiene preview en IndexedDB y también copia binario a `../local-library/files/`; aplicación docente lee misma fuente tras **Actualizar** o recargar.

```text
Admin UI -> adaptador local -> API Vite localhost -> catalog.json/files -> docente read-only
```

IndexedDB sigue siendo cache de preview. Si había uploads previos con blob disponible, se migran a `Nivel 1 / Unit 01`. Puente es desarrollo local: escucha solo `127.0.0.1:1430`, sin usuarios simultáneos, permisos, cifrado, versionado ni resolución de conflictos. Si admin dev está apagado, docente muestra estructura de respaldo sin archivos. Punto de reemplazo cloud: ambos módulos `services/*catalog.ts`.

Estados de publicación siguen siendo metadata local. Antes de despliegue real hacen falta backend, almacenamiento administrado, sesiones seguras, contraseñas cifradas con hash, recuperación verificada, OAuth configurado en servidor, autorización por roles, auditoría y protección CSRF/rate limiting.

La Biblioteca usa tabla/cuadrícula tipo Drive, filtros, selección e Inspector. Los archivos subidos se previsualizan con imágenes nativas, audio/video con controles y PDF con el visor embebido cuando el navegador lo permite. No hay reproducción automática. Códecs multimedia y PDF dependen de Zen/WebKit y del sistema; formatos no compatibles muestran un fallback honesto. Descargar funciona con archivos locales reales. Compartir, acciones avanzadas y Ajustes son demostración local: no envían archivos ni actualizan cuentas reales.
