# Active Classroom: identidad del equipo

## Uso del salón

La app abre Biblioteca y clases locales sin pedir correo/contraseña. Una instalación nueva muestra nombre del equipo y un código de 10 caracteres, válido 15 minutos. Un administrador activo comprueba físicamente nombre/código y autoriza el equipo. Desktop consulta cada 30 segundos mientras espera; también ofrece **Reintentar activación**. El código desaparece al autorizar.

## Identidad y almacenamiento

### Nombre visible y hostname

`activeClassroomDevices/{deviceId}` conserva `deviceName` (hostname original, obtenido de la prueba autenticada del equipo) y `displayName` (alias administrado, vacío usa hostname). El campo histórico `name` se conserva por compatibilidad y nunca se sobrescribe al renombrar. Registros antiguos con `renamedAt` recuperan ese alias; hostname se recupera en la siguiente conexión autenticada, sin migración obligatoria.

**Equipos → Renombrar** cambia únicamente `displayName` y auditoría. Al autorizar una solicitud puede introducirse un alias opcional. Normalización Unicode NFC, máximo 100 caracteres, letras/números Unicode, espacios y puntuación habitual; controles, HTML y controles bidi se rechazan. Vacío elimina alias y restaura fallback. Credencial, generación, `deviceId`, UID, caché y publicaciones no cambian.

Desktop recibe `displayName` en `activeClassroomDeviceSession` y en la metadata `device` de `listActiveClassroomPublications`/`getActiveClassroomPublication`. Actualiza el indicador inferior en la siguiente conexión o consulta/sincronización de Biblioteca, sin nueva activación ni reinstalación por cada renombrado. No consulta backend durante Player.

Último alias se guarda como metadata pública del WebView en `localStorage`, clave `active-classroom:device-label:v1:<deviceId>`, únicamente `{deviceId, displayName}`. Nunca credenciales/tokens. Al reiniciar offline se restaura junto a identidad del llavero; vacío/corrupto usa hostname. Si el almacenamiento del alias falla, clases y autenticación siguen funcionando; el alias nuevo permanece en memoria y no se garantiza su persistencia hasta recuperar almacenamiento. Incorporar esta funcionalidad inicialmente requiere distribuir el build Desktop actualizado; cambios posteriores de nombre no requieren actualizarlo.

- `deviceId`: 128 bits aleatorios; credencial: 256 bits aleatorios, generados por `/dev/urandom` nativo. No se deriva del hostname/MAC ni se distribuye en el instalador.
- Identidad, credencial y marcadores de autorización/revocación se guardan exclusivamente en Secret Service del usuario Linux mediante `libsecret-tools`. Atributos: `application=com.activeclassroom.desktop`, `credential=device-v1`. La credencial viaja por stdin, no por argumentos/env/archivos/logs.
- Se comprueba que la colección predeterminada esté desbloqueada antes de usarla. La lectura usa `secret-tool search` sin `--unlock`. Sin llavero disponible la app pide asistencia; no guarda secretos en texto plano ni abre un diálogo de contraseña del salón.
- La instalación requiere `libsecret-tools`, `libglib2.0-bin`, GNOME Keyring y una sesión D-Bus. El administrador debe configurar el desbloqueo automático del llavero mediante PAM al iniciar sesión Linux. Un equipo con autologin que deja el llavero bloqueado **no está listo para uso del salón**: configure una sesión que desbloquee el llavero; no desactive su cifrado.
- Firebase ID/refresh tokens permanecen en memoria del WebView (`inMemoryPersistence`). En cada reinicio se restablece Auth con la credencial del llavero. No hay service account, clave privada, contraseña de usuario ni secreto Firebase en Desktop.
- Caché sigue `~/.local/share/com.activeclassroom.desktop/offline-v1/users/<SHA256(uid)>/`. UID del equipo: `ac-device-<deviceId>`. La primera apertura autorizada adopta manifests/bytes verificados de cachés anteriores mediante enlaces duros (copia si es necesario), sin borrar originales ni cambiar el formato/manifests. Caché no contiene la credencial.

## Backend y permiso mínimo

Base: `https://us-central1-sistema-desarrollo-proyectos.cloudfunctions.net`.

`activeClassroomDeviceSession` es un callable de bootstrap autenticado por prueba de posesión (`deviceId`, credencial aleatoria). Es accesible antes de Firebase Auth porque obtiene el custom token; **no entrega publicaciones ni archivos sin activación**. Guarda SHA-256 de credencial, nunca su original. Máximo 10 registros nuevos por IP/hora. Códigos aleatorios de 40 bits, caducidad 15 minutos, consumidos transaccionalmente. No se autentica con el código corto ni solo con `deviceId`.

Respuestas:

```json
{"status":"pending","code":"A12BCD34EF","expiresAt":1790964000000}
{"status":"authorized","customToken":"<token efímero>"}
{"status":"revoked"}
```

Claims del ID token: `activeClassroomDevice=true`, `deviceId`, `deviceGeneration`. No claim admin ni perfil en `users`.

Registro privado: `activeClassroomDevices/{deviceId}`: `credentialHash`, `name`, `status`, `generation`, `createdAt`, `approvedAt`, `approvedBy`, `revokedAt`, `revokedBy`; mientras está pendiente, `code` y `expiresAt`. Índice privado `activeClassroomDeviceCodes/{code}`; contador privado `activeClassroomDeviceRates/{SHA256(ip)}`. Timestamps del registro son epoch milisegundos. Reglas deniegan acceso cliente a estas colecciones.

Los únicos endpoints de contenido permitidos para un dispositivo son los existentes:

- `listActiveClassroomPublications`.
- `getActiveClassroomPublication`.
- `activeClassroomPublicationFile`: comprueba pertenencia a publicación y entrega bytes del snapshot privado, generación fija, tamaño y SHA-256 exactos. No evalúa ni concede acceso a Drive para dispositivos.

Cada petición consulta autorización/generación en Firestore; un ID token antiguo no evita revocación. Los callables de Nube AES y de otros módulos rechazan identidades de equipo; Firestore/Storage directo también se deniegan. Usuarios humanos/Digital Signage conservan comportamiento previo.

## Aprobar y revocar (administrador)

Interfaz disponible en **Active Classroom → Equipos**, solo para administrador activo. Listado se actualiza al entrar, cada 30 segundos y con **Actualizar equipos**. Pendientes muestran nombre, código, solicitud y vencimiento. **Autorizar** exige comparar el código con el equipo físico; usa `approveActiveClassroomDevice`, consume el código y autoriza la misma credencial del llavero. **Rechazar** usa `rejectActiveClassroomDevice`, consume código y bloquea esa credencial. Códigos vencidos deben renovarse desde Desktop.

Activos muestran última conexión observada por backend, última sincronización declarada por Desktop después de activar la copia verificada y versión instalada si el cliente la informa. Clientes anteriores muestran **Sin registro/No informada**. `reportActiveClassroomDeviceSync` solo permite al equipo autorizado registrar su propia telemetría para una publicación existente; no cambia publicaciones. El fallo del reporte nunca invalida la clase offline. Durante Player no se emiten nuevos reportes.

`listActiveClassroomDevices` pagina 100 registros por ID y entrega únicamente metadata; hashes de credencial permanecen privados. `renameActiveClassroomDevice` modifica solo nombre/auditoría. Listado, renombrado, rechazo, aprobación y revocación requieren administrador activo mediante callable. No se habilita lectura directa de `activeClassroomDevices` ni `activeClassroomDeviceCodes`, incluso para web admin.

Revocados/rechazados muestran instrucciones de reinscripción: no se reactiva la credencial anterior desde la web. Soporte renueva identidad local y aprueba otro código. Se conservan caché y mínimo privilegio.

Desde una sesión **web** existente de administrador activo, usar Firebase Functions SDK del proyecto (ningún login del profesor):

```js
import { getFunctions, httpsCallable } from "firebase/functions";
const functions = getFunctions(undefined, "us-central1");
await httpsCallable(functions, "approveActiveClassroomDevice")({ code: "A12BC-D34EF" });
await httpsCallable(functions, "revokeActiveClassroomDevice")({ deviceId: "<32 caracteres hex>" });
```

La aprobación retorna `deviceId`, nombre y estado; el código no vuelve a usarse. La revocación es terminal para esa credencial. Reautorizar requiere soporte técnico: quitar **solo** este elemento del llavero en el equipo, reiniciar y aprobar el nuevo código. Se mantienen clases locales; no borrar caché. No hay nueva UI administrativa en este hito.

## Offline y renovación

Un equipo previamente autorizado abre Biblioteca desde el llavero y caché antes de contactar Firebase. Un fallo de red/timeout/renovación no bloquea clases descargadas. La app renueva ID tokens automáticamente y vuelve a intercambiar credencial si Firebase invalida su sesión; se reintenta conexión cada 30 segundos y al evento `online`. Descargas interrumpidas por conectividad se reintentan con los hashes existentes y activación atómica de versión. No hay peticiones de Auth/Drive/Firebase nuevas durante Player activo.

Al conocer una revocación, la app cancela operaciones, cierra Player y persiste bloqueo en llavero; posteriores reinicios offline muestran activación. **Sin Internet no puede detectar una revocación nueva.** Los archivos descargados no se borran; revocación remota no garantiza retirar bytes de una máquina desconectada. Llavero bloqueado/dañado requiere soporte incluso offline; no existe fallback inseguro.

## Despliegue Firebase

1. Desplegar codebase `drive` con `activeClassroomDeviceSession`, `approveActiveClassroomDevice`, `revokeActiveClassroomDevice`, `listActiveClassroomDevices`, `rejectActiveClassroomDevice`, `renameActiveClassroomDevice`, `reportActiveClassroomDeviceSync` y autorización adaptada de los tres endpoints existentes. Desplegar codebase `default` para el bloqueo de equipos en callables ajenos. Publicar Hosting para la interfaz Equipos.
2. Desplegar reglas Firestore y Storage. No hay cambios de índices obligatorios ni migración de Units/publicaciones.
3. Habilitar IAM Service Account Credentials API. La cuenta de ejecución de `activeClassroomDeviceSession` necesita únicamente `iam.serviceAccounts.signBlob` sobre su cuenta firmante (rol `roles/iam.serviceAccountTokenCreator`, limitado a esa cuenta); el Admin SDK firma mediante IAM, nunca con JSON privado en el repositorio. Ver [custom tokens oficiales](https://firebase.google.com/docs/auth/admin/create-custom-tokens).
4. Configurar TTL opcional para limpieza de registros pendientes/contadores; actualmente `expiresAt` numérico **no es campo TTL Firestore**. La expiración se valida en servidor, no depende de TTL. Para limpieza automática se requiere convertir un campo adicional a Timestamp en otro hito.
5. Instalar `.deb`, verificar sesión/llavero, autorizar primer código y realizar aceptación contra Firebase desplegado. CI valida emuladores y llavero Linux real aislado, sin credenciales de producción.

```sh
firebase deploy --only functions:drive,functions:default,firestore:rules,storage
```

Actualización de Equipos sobre backend ya desplegado: `npm run build` y `firebase deploy --only functions:drive,hosting`. Sin cambios de reglas ni índices en esta interfaz. Distribuir nuevo `.deb` para informar versión/última sincronización; activar equipos funciona también con Desktop anterior. IAM puede limitarse al rol personalizado `projects/sistema-desarrollo-proyectos/roles/activeClassroomDeviceSigner` (`iam.serviceAccounts.signBlob`), asignado a la cuenta de ejecución únicamente sobre sí misma.

No hacer públicos listado/manifests/descargas. El callable de bootstrap requiere posesión de credencial aunque todavía no exista Firebase ID token.

## Corrección de arranque Desktop 0.1.1

Al reiniciar, el marcador `activated` permite cargar las clases locales; no representa una sesión Firebase. Desktop restaura `deviceId`/credencial desde Secret Service, solicita un Custom Token al bootstrap y ejecuta `signInWithCustomToken`. Antes de anunciar conexión verifica un Firebase ID token con UID y claims del equipo. ID/refresh tokens permanecen en memoria; la credencial del llavero permite autenticarse otra vez sin intervención al reiniciar. `getIdTokenResult` renueva automáticamente al vencer; HTTP 401 fuerza renovación una vez. Si Firebase invalida la sesión, se vuelve a intercambiar la credencial. HTTP 403 o 401 persistente consultan el registro para detectar revocación, incluso si Firebase rechaza el ID token antes de ejecutar el callable.

Biblioteca consulta automáticamente cuando terminan tanto la carga de caché como la autenticación, independientemente del orden. Las respuestas de listado/manifest actualizan `displayName`; una consulta correcta elimina el estado de error anterior. Una Biblioteca vacía informa que no existen publicaciones. Fallos de autenticación, permisos o servidor conservan las clases locales y muestran estados diferentes de modo offline.

Diagnóstico en consola: `[Active Classroom] { stage, event, code? }`. Etapas `identity`, `activation`, `sign-in`, `token`, `publications`; códigos `credential`, `not-activated`, `expired`, `auth`, `401`, `403`, `offline`, `backend`, `timeout`, `server`. `navigator.onLine == false` identifica ausencia de red; una solicitud fallida con red declarada activa indica servidor inaccesible (también puede ser DNS, TLS o red sin salida). No se registran tokens, credenciales, IDs, URL con parámetros ni errores crudos del SDK.

Validación añadida: arranque de Biblioteca en ambos órdenes con WebView simulado y test con Firebase Auth/Firestore reales en emuladores, SDK Custom Token, verificación de `request.auth`, listado/manifest/descarga, cambio de nombre, expiración, 401, permisos administrativos bloqueados, reinicio offline y revocación. CI Ubuntu ejecuta estos tests y produce `.deb` 0.1.1 con lockfiles bloqueados. Esta corrección no modifica Functions, reglas, IAM ni Hosting: instalar el nuevo paquete sobre la instalación actual; conservar llavero y caché. La aceptación contra Firebase de producción debe realizarse en el equipo Linux autorizado.

## Transporte de publicaciones Desktop 0.1.2

`PublicationApi` conservaba `fetch` sin enlazarlo a `Window` y lo llamaba como método de la instancia. En navegador/WebView, esto lanza `TypeError: Illegal invocation` antes de enviar la solicitud. Node y los mocks no exigen ese receptor: la prueba anterior no detectaba el defecto. El bootstrap llama a `fetch` directamente y sí podía recibir `displayName`, mientras el catálogo mostraba servidor no disponible. Se enlaza el transporte a `globalThis` una sola vez; listado, manifest y descarga usan el mismo transporte corregido.

Ninguna validación de rol humano impedía estas operaciones. Los tres endpoints aceptan ID token Firebase con `activeClassroomDevice: true`, `deviceId` correspondiente al UID `ac-device-…`, y `deviceGeneration` vigente en un registro autorizado. Permisos administrativos, edición, publicación y navegación de Drive siguen denegados; la descarga del equipo utiliza el archivo congelado.

Logs Desktop incluyen únicamente etapa, evento, código clasificado, nombre conocido de endpoint y estado HTTP. Se distinguen 401, 403, 404, 5xx, timeout/red, respuesta inválida y error de cliente; nunca se imprimen tokens, claims completos, query strings, URLs ni cuerpo recibido. La interfaz muestra mensajes simples; catálogo vacío informa «No hay clases publicadas».

CI añade prueba con WebKitGTK 4.1 real y la CSP de Tauri: listado, manifest, descarga, hash, nombre visible y estados HTTP. Requiere `python3-gi`, `gir1.2-webkit2-4.1`, `xvfb` y `xauth` únicamente en el runner; no añade dependencias del instalador. La prueba de autenticación completa usa Auth, Firestore y Storage emulados, incluyendo un archivo congelado real y bloqueo de los tres endpoints tras revocación. No requiere despliegues Firebase; distribuir `.deb` 0.1.2.
