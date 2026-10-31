# Identidad Linux de Active Classroom Desktop 1.0.21

Issue: https://github.com/gonhercaral-cpu/desarrollo-proyectos/issues/17
PR: https://github.com/gonhercaral-cpu/desarrollo-proyectos/pull/18

## Comportamiento

La identidad se conserva en un almacén nativo cifrado, independiente de GNOME
Keyring/Secret Service después de la instalación o migración. No se necesita crear
Login en Seahorse. Los reinicios, el login automático y los cambios de llavero
predeterminado no seleccionan otra identidad.

El contrato de `load`, `proof`, `activated`, `revoked`, `reset-binding`,
`registered` y `cacheDeviceId` se mantiene. Solo una desvinculación autorizada
rota identificador y credencial. El namespace de las clases descargadas se conserva.

## Protección de credenciales y desbloqueo

El propietario confirmó que el aislamiento requerido es frente a otros usuarios
del SO. La copia física del disco apagado, root y procesos con el mismo UID quedan
fuera de ese modelo. No se presenta este almacén como protección de hardware.

- Cifrado: AES-256-GCM de `ring` 0.17.14, ya incluido transitivamente y fijado ahora
  como dependencia directa. Nonce aleatorio de 12 bytes por escritura y AAD que
  identifica el formato de Active Classroom.
- Clave: 32 bytes generados por el CSPRNG del SO una sola vez por instalación. Se
  guarda como material binario en `$XDG_CONFIG_HOME/active-classroom-identity/vault-v1.key`
  (alternativa `$HOME/.config`), propietario del UID actual y modo 0600, en un
  directorio 0700. No se deriva del machine-id ni existe una clave fija en código.
- Identidad: JSON únicamente en memoria; en disco se guarda cifrado en
  `$XDG_STATE_HOME/active-classroom-identity/vault-v1.enc` (alternativa
  `$HOME/.local/state`), con modo 0600 y directorio 0700.
- Desbloqueo: la aplicación abre la clave mediante los permisos de la sesión del
  mismo UID. Funciona con inicio manual o automático, sin pedir crear un llavero.
  La clave no está cifrada otra vez con una contraseña: la frontera de protección
  es el control de acceso del SO confirmado por el propietario.
- Los directorios se verifican por propietario, permisos, archivo regular y
  ausencia de enlaces. Se rechaza ubicarlos dentro del alcance `$APPDATA` del
  protocolo de assets del WebView, incluso mediante rutas relativas o enlaces.
- No se persisten credenciales en localStorage, WebView, caché, logs ni archivos de
  texto. El marcador público contiene solo versión, identificadores y journal.

## Persistencia y recuperación

Los archivos se escriben mediante un temporal exclusivo, fsync, rename y fsync del
directorio. La primera clave empieza pendiente y se marca lista solo después de
que la identidad cifrada esté guardada y verificada. Si se interrumpe ese paso,
la próxima carga completa la misma identidad.

Una clave lista sin cifrado, un cifrado sin clave, un tag inválido, un marcador
incompatible o permisos inseguros fallan de forma explícita. Nunca se borra la
clave ni se genera otra para ocultar el error. Hay mutex y flock para serializar
la creación, la migración y los cambios de autorización entre procesos.

`reset-binding` conserva un journal público anterior/siguiente antes de guardar la
rotación. La carga siguiente finaliza o aborta ese journal contra la identidad que
realmente está guardada. Si la operación nativa terminó parcialmente, la sesión
JS descarta el owner antiguo y el reintento relee el estado real sin otra rotación.

## Migración no destructiva

Sin almacén nativo se sondea Secret Service en todas las colecciones, incluyendo
coincidencias bloqueadas. Una identidad accesible y única se copia cifrada,
se relee comparando todos los campos y después se registra el marcador nativo v2.
El elemento original del llavero no se elimina ni se modifica.

Bloqueo, conflicto, corrupción, rastros de keyrings no verificables o un marcador
anterior sin identidad impiden crear otra. Un equipo realmente nuevo puede crear
su identidad nativa sin Login ni servicio de llavero. Si la migración ya guardó un
cifrado válido pero se interrumpió antes del marcador, se recupera esa misma copia
sin volver a depender del llavero. Después de migrar no se consulta Secret Service.

Una identidad antigua cifrada que siga bloqueada no se puede recuperar sin que su
proveedor permita leerla. La aplicación mantiene ese error de almacenamiento y no
lo convierte en revocación ni sustituye la vinculación. Tampoco es posible probar
la ausencia de una identidad en un backend completamente oculto y no detectable.

## Validación

Las pruebas distinguen unitarias, procesos Linux y hardware físico:

- AES/integridad, pérdida de clave, escritura interrumpida, permisos, enlaces y
  ausencia de credenciales en claro.
- Migración exacta de campos y caché, estados revocado/activado, conflictos,
  concurrencia y ausencia de consultas al llavero después de migrar.
- Linux aislado: instalación sin Login, reapertura en otro proceso sin D-Bus,
  migración desde Secret Service real y rechazo de lectura por otro UID.
- Sesión/interfaz: red y almacenamiento distintos de revocación, recuperación sin
  nuevas rotaciones y contratos de autorización/desvinculación conservados.
- Lint y build de escritorio y regresiones del flujo Linux existente.

No hay Ubuntu/Zorin físico ni WSL en el host Windows de coordinación. Abrir otro
proceso o reiniciar una sesión D-Bus no equivale a reiniciar el sistema operativo.
Los reinicios físicos, apagados repetidos y pruebas manuales de login en los
salones deben registrarse aparte. No se afirmarán realizados a partir de mocks.

El lint global de la base contiene 137 errores y 37 advertencias en 19 archivos
fuera de este cambio; se verificó por Git que son idénticos a la base publicada.
No se corrigen dentro de esta intervención. El resultado final de CI, instaladores,
firma y publicación se registra en el PR y el informe de entrega.

## Alcance

Antigravity entregó diagnóstico, corrección de locale y módulo inicial de cifrado.
Claude implementó migración/sesión y auditó y complementó el módulo, con pruebas.
Codex coordinó, revisó e integró los parches, dependencias indispensables, fixtures,
versionado y validaciones. Las invocaciones fallidas no se cuentan como entregas.

No cambian reproductores, teclado, saltos, proyección, diseño, biblioteca de
contenidos, niveles/unidades, implementación de caché, backend ni reglas Firebase.
En `library.ts` solo se ajusta el reintento de identidad y se retira la acción de
revincular ante un error local de almacenamiento. No se incluyen cambios pendientes
del checkout original.
