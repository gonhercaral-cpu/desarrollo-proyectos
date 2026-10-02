# Active Classroom: identidad del equipo

## Uso del salón

La app abre Biblioteca y clases locales sin pedir correo/contraseña. Una instalación nueva muestra nombre del equipo y un código de 10 caracteres, válido 15 minutos. Un administrador activo comprueba físicamente nombre/código y autoriza el equipo. Desktop consulta cada 30 segundos mientras espera; también ofrece **Reintentar activación**. El código desaparece al autorizar.

## Identidad y almacenamiento

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

1. Desplegar codebase `drive` con `activeClassroomDeviceSession`, `approveActiveClassroomDevice`, `revokeActiveClassroomDevice` y autorización adaptada de los tres endpoints existentes. Desplegar codebase `default` para el bloqueo de equipos en callables ajenos.
2. Desplegar reglas Firestore y Storage. No hay cambios de índices obligatorios ni migración de Units/publicaciones.
3. Habilitar IAM Service Account Credentials API. La cuenta de ejecución de `activeClassroomDeviceSession` necesita únicamente `iam.serviceAccounts.signBlob` sobre su cuenta firmante (rol `roles/iam.serviceAccountTokenCreator`, limitado a esa cuenta); el Admin SDK firma mediante IAM, nunca con JSON privado en el repositorio. Ver [custom tokens oficiales](https://firebase.google.com/docs/auth/admin/create-custom-tokens).
4. Configurar TTL opcional para limpieza de registros pendientes/contadores; actualmente `expiresAt` numérico **no es campo TTL Firestore**. La expiración se valida en servidor, no depende de TTL. Para limpieza automática se requiere convertir un campo adicional a Timestamp en otro hito.
5. Instalar `.deb`, verificar sesión/llavero, autorizar primer código y realizar aceptación contra Firebase desplegado. CI valida emuladores y llavero Linux real aislado, sin credenciales de producción.

```sh
firebase deploy --only functions:drive,functions:default,firestore:rules,storage
```

No hacer públicos listado/manifests/descargas. El callable de bootstrap requiere posesión de credencial aunque todavía no exista Firebase ID token.
