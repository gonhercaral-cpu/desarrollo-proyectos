# Desktop Linux: núcleo y sincronización offline

## Proyecto y alcance

Se continúa la aplicación Tauri 2 existente (`com.activeclassroom.desktop`): Vite, TypeScript y Rust. No se crea otra app. `src/app.ts` abre Biblioteca. El prototipo anterior permanece en el repositorio, pero su reproductor/importador PPTX y segunda pantalla no forman parte del flujo de este MVP. La ventana de alumnado ya no se crea automáticamente.

Biblioteca conserva estilos, icono y componentes visuales base del proyecto. Muestra Nivel/Unit, publicación remota, versión local, progreso, errores, reintento, cancelar y Abrir clase. Abrir valida archivos locales y muestra una vista de clase preparada, sin reproductor.

Contrato remoto: `../../docs/active-classroom-desktop-api.md` y su ejemplo de manifest. Se consumen exclusivamente `listActiveClassroomPublications`, `getActiveClassroomPublication` y `activeClassroomPublicationFile`; no se incorpora integración Drive.

## Capas

- `src/offline/auth.ts`: Firebase Auth en memoria y renovación de ID token. `device-session.ts` controla activación/offline/revocación; `device-auth.ts` intercambia prueba del llavero por custom token. Sin login interactivo. Ver [identidad del equipo](../../docs/active-classroom-device-auth.md).
- `src/offline/remote.ts`: callables HTTP, paginación completa, descargas por streaming, Bearer, timeout y cancelación. Reintenta una sola vez el 401 con `getIdToken(true)`; 403 conserva caché y muestra permiso denegado.
- `src/offline/manifest.ts`: contrato tipado, validación de IDs, límites, asociaciones, orden y SHA-256 del manifest canónico. Rechaza versiones antiguas sin snapshot.
- `src/offline/sync.ts`: coordinación independiente de Firebase y Tauri mediante `RemoteStore`/`CacheStore`. Una descarga activa; doble clic comparte la promesa y archivos repetidos comparten SHA-256.
- `src/offline/native-cache.ts`: adaptador IPC mínimo. No acepta rutas de origen arbitrarias.
- `src-tauri/src/offline_cache.rs`: streaming a temporales, hash incremental, verificación de archivos, commit, lectura offline y aislamiento de rutas por UID. IO fuera del hilo de interfaz.
- `src/offline/library.ts`: sesión, catálogo remoto/local y estados; `library.css` extiende estilos existentes.

## Sesión y datos locales

Firebase Auth usa `inMemoryPersistence`; la credencial y autorización del equipo viven en Secret Service Linux. Un administrador autoriza el código inicial. Desktop restablece sesión automáticamente online y muestra caché inmediatamente si ya fue activado, incluso offline. No se solicita token para listar/abrir el caché.

Cada caché se identifica por SHA-256 del UID estable `ac-device-<deviceId>`. La primera apertura activada adopta publicaciones verificadas anteriores sin borrar originales. No hay selector de usuarios ni logout. Recursos no están cifrados: acceso físico a la cuenta Linux queda fuera del control de Firebase. Revocación conocida bloquea UI y se conserva en llavero; una revocación nueva no puede detectarse sin conexión.

Raíz Linux, respetando `XDG_DATA_HOME`:

```text
~/.local/share/com.activeclassroom.desktop/offline-v1/
  users/<sha256-del-uid>/
    objects/<sha256-del-archivo>
    temporary/<sha256>.part
    units/<unitId>/versions/<version>/manifest.json
```

La raíz real se obtiene con `app.path().app_data_dir()`. En Linux el directorio del usuario se restringe a modo `0700`. Los bytes se comparten entre versiones y Units del mismo usuario por SHA-256; cada versión conserva su manifest. No hay borrado automático ni política de limpieza en este MVP. Archivos completos de un intento cancelado pueden reutilizarse; temporales incompletos se descartan o sobrescriben al reintentar.

## Flujo de sincronización

1. Listar publicaciones por cursor. Una página vacía no termina la consulta si hay `nextCursor`.
2. Comparar publicación y versión local. Estados: No descargada, Descargando, Actualizada, Actualización disponible y Error. Sin Internet, “Actualizada” significa copia local completa; no certifica que no exista una publicación remota más reciente.
3. Consultar manifest de la versión exacta y comprobar identidad, versión, `contentHash`, estructura y referencias.
4. Para cada SHA-256 único, verificar si existe un objeto local válido con ese tamaño. Reutilizarlo si coincide.
5. Descargar faltantes con ID token, en bloques de hasta 64 KiB. Guardar en `.part`; validar tamaño durante la transferencia y SHA-256 nativo al finalizar. Nunca ejecutar ni convertir archivos.
6. Sincronizar buffers a disco y renombrar objeto verificado. Volver a validar todos los objetos antes de publicar el manifest local.
7. Escribir `manifest.pending` y renombrarlo a `manifest.json`: único límite de activación. No existe un estado de versión parcialmente activa. Cancelación se acepta antes de comenzar este commit; después puede finalizar la versión completa.
8. Al reiniciar, inspeccionar manifests comprometidos y archivos reales. Seleccionar la versión numérica más alta íntegra de cada Unit. Si está corrupta, conservar una versión anterior válida como respaldo. No se requiere red para reconstruir la biblioteca.

Manifest/versiones locales son inmutables. Un intento con contenido distinto para el mismo número se rechaza; tampoco se permite downgrade desde la sincronización. En caso de fallo se conserva la versión anterior, y reintentar verifica/reutiliza los objetos completos ya descargados.

## Interfaz para Player

```ts
const classroom = await openLocalClass(cache, unitId, version);
const file = classroom.resolveResource(resourceId);
// file: { path, mimeType, kind, name }
// classroom.manifest: presentación, slides ordenadas y asociaciones
```

Player recibe una sesión local fijada a esa versión y no importa servicios Firebase/Drive. Al abrir clase se cancelan consultas/descargas de Biblioteca; las consultas automáticas se suspenden hasta salir. Reconocimiento por MIME descargado para PDF, imágenes, audio y video. No se invoca LibreOffice ni el importador PPTX previo. Detalles en [LOCAL_PLAYER.md](LOCAL_PLAYER.md).

## Errores

- Red interrumpida/timeout: temporal descartado, caché anterior disponible, reintento manual.
- 401: renovar token automáticamente; si falla conservar acceso local. 403: comprobar autorización del dispositivo; si fue revocado cancelar operaciones y volver a activación, sin borrar contenido local.
- Tamaño/SHA-256 incorrectos: archivo no se incorpora; manifest no se activa.
- Disco lleno: error de escritura reconocido y mostrado; versión anterior conservada.
- Cancelación: abortar Fetch, rechazar writes posteriores y descartar temporal. No revierte un commit completo.
- Cierre abrupto: temporales/manifests pendientes se ignoran. No se activa material incompleto.
- Caché corrupto: se verifica al listar/abrir y antes de reutilizar; una nueva sincronización puede reparar archivos faltantes o corruptos.

No hay descargas HTTP Range/reanudación parcial, sincronización periódica oculta, limpieza automática ni cifrado. La descarga reintentada empieza desde cero para el archivo incompleto, reutilizando los completos.

## Ejecutar y validar

Desde `active-classroom-desktop`:

```sh
npm ci
npm run test:offline
npm run lint:offline
npm run build
cargo test --manifest-path src-tauri/Cargo.toml offline_cache
npm run tauri:dev
npm run tauri:build -- --bundles deb,appimage
```

Tests Node requieren Node 22.18+ (o Node 24+) por ejecución de TypeScript sin transpilar; build usa TypeScript instalado. El paquete conserva sus scripts históricos de smoke/admin e integración local.

Para Linux se requieren Rust estable y dependencias de compilación Tauri 2/WebKitGTK de la distribución. El frontend en navegador sirve para revisar UI; el caché de producción requiere IPC nativo de Tauri.

### Evidencia de esta implementación

- 18 tests Node: contrato, SHA-256, descarga diferencial, reinicio de adaptador con archivos reales, apertura offline, fallback, inmutabilidad, doble clic, red, corrupción, disco lleno, cancelación/reintento, renovación 401, 403, paginación y timeout.
- Build TypeScript/Vite y lint específico: pasan. Smoke admin e integración local anteriores: pasan. Formulario de acceso revisado visualmente en navegador.
- Tests de filesystem Node usan un adaptador de prueba sobre disco real; no sustituyen tests Rust ni una ejecución instalada Linux.
- Cuatro tests Rust añadidos (IDs/rutas, hash/tamaño, contrato real, commit/reapertura/fallo). No ejecutados: el equipo de trabajo es Windows sin Rust/Cargo ni WSL. `tauri:build` se intentó y falló con `cargo metadata ... program not found`.
- No se ingresaron credenciales reales ni se certificó la prueba integral Firebase/Linux. Esta aceptación sigue pendiente; no se declara el binario listo para salones.

### Aceptación pendiente en Linux

1. Compilar/instalar, configurar llavero Linux y activar equipo mediante administrador. El equipo obtiene únicamente snapshots publicados, sin permisos para originales Drive.
2. Consultar publicaciones, descargar Unit y abrirla (archivos SHA-256 verificados).
3. Cerrar completamente la app, desconectar red, reiniciar y abrir esa Unit.
4. Reconectar y publicar v2 desde web. Comprobar “Actualización disponible”.
5. Interrumpir/cancelar v2: v1 debe seguir abriendo. Reintentar; solo al completar debe activarse v2.
6. Repetir con falta de espacio, archivo corrupto y 401/403 controlados. No borrar el caché de una clase real para estas pruebas.

Player PDF/imágenes/audio/video y controles implementados sobre `openLocalClass`; ver [LOCAL_PLAYER.md](LOCAL_PLAYER.md). Segunda pantalla sigue pendiente. PPTX requiere una decisión posterior de procesamiento; este MVP únicamente lo almacena y reconoce.
