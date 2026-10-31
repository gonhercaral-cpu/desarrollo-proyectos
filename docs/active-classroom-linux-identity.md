# Identidad Linux: corrección de preservación y estado de aceptación

Issue: https://github.com/gonhercaral-cpu/desarrollo-proyectos/issues/17
Base revisada: `0a6d55c585e1375a434cea3feea0fff9976088f1`, Desktop 1.0.20.

## Estado

Trabajo parcial de preservación, pendiente de validación nativa. No constituye una
solución definitiva de instalación nueva/autologin sin llavero. No habilita un nuevo
almacén, no publica versiones y no modifica datos de producción.

El propietario confirmó un parque mixto, sin TPM ni cifrado de disco garantizados.
Se mantiene la prohibición de degradar la protección de credenciales.

## Diagnóstico revisado por ambos auxiliares

El código anterior consultaba `Locked` en el alias `default` antes de buscar la
identidad. La ausencia o bloqueo de ese alias impedía incluso buscar una identidad
en otra colección. La búsqueda seleccionaba la primera coincidencia, mientras que
la escritura usaba la colección predeterminada: un cambio de alias podía bifurcar
la identidad. Además, una respuesta vacía se trataba como primera instalación sin
una referencia pública persistente que detectara una identidad anterior ausente.
Estas son causas confirmadas en código; no se reprodujo el reinicio físico del
hardware afectado en esta sesión.

En la sesión TypeScript, el manejo de `DEVICE_*` no comprobaba si el error provenía
del intercambio con el servidor o del acceso nativo. El estado de error tampoco
participaba en el reintento periódico y ofrecía una nueva vinculación.

## Frontera de seguridad y desbloqueo automático

Se conserva el cifrado del Secret Service. No se introduce una clave fija, una
clave derivada del machine-id, una colección sin contraseña ni una copia de la
credencial en texto plano, localStorage o un archivo de usuario.

Guardar una clave aleatoria junto al archivo cifrado, incluso con permisos 0600,
no mantiene la protección de un llavero cifrado con contraseña frente al robo del
disco. Mover esa clave a un archivo de root tampoco resuelve el ataque offline.
La propuesta inicial de helper con identidad en texto plano fue rechazada.

En una sesión con autologin, sin secreto entregado por PAM, sin TPM y sin disco
cifrado, no se dispone de una fuente secreta de desbloqueo automático que preserve
esa protección offline. El código no puede fabricar esa fuente. Un vault con TPM
requiere instalación, recuperación y pruebas propias; no se incluyó una versión
incompleta ni se asumió que todo el parque dispone de ese hardware.

Referencias primarias:
- [GNOME Keyring y PAM](https://wiki.gnome.org/Projects/GnomeKeyring/Pam).
- [Protección y límites de GNOME Keyring](https://wiki.gnome.org/Projects/GnomeKeyring/SecurityFAQ).
- [Especificación de Secret Service](https://specifications.freedesktop.org/secret-service/latest/).
- [Clave host de systemd-creds](https://www.freedesktop.org/software/systemd/man/256/systemd-creds.html).

## Contratos que deben conservarse

`load`, `proof`, `activated`, `revoked`, `reset-binding`, `registered` y
`cacheDeviceId` mantienen su significado. Solo la desvinculación autorizada puede
rotar las credenciales. La migración no debe borrar elementos legacy ni cambiar el
namespace de las clases descargadas. Un error de acceso nunca prueba revocación.
Los mensajes de diagnóstico usan códigos fijos sin errores crudos ni credenciales.

## Aceptación pendiente de publicación

| Escenario solicitado | Evidencia / estado |
| --- | --- |
| 1. Instalación sin llavero | No resuelto de forma universal para parque mixto/autologin. |
| 2. Código inicial | Contrato probado con dependencias simuladas; pendiente instalación Linux. |
| 3. Aprobación Web | Contrato de sesión probado; no se autorizó un equipo real de producción como prueba. |
| 4-5. Reinicios y varios reinicios | Pendientes pruebas físicas Ubuntu y Zorin. Reiniciar objetos de prueba no equivale a reiniciar el SO. |
| 6. Login automático y manual | Pendiente hardware; no se promete desbloqueo del llavero sin fuente secreta. |
| 7. Almacén bloqueado | Pruebas JS de fallo seguro y recuperación sin reset; validación nativa pendiente. |
| 8. Varios Login | Requiere prueba nativa de todas las colecciones y conflictos. |
| 9-10. Actualización y migración | No publicar hasta verificar identidad/credencial/cacheDeviceId antes y después e interrupciones. |
| 11. Clases descargadas | Pruebas de namespace y regresión offline; no se modifica la caché. |
| 12. Revocación | Pruebas JS conservan revocación real y cierre de sesión aun si falla guardar el marcador. |
| 13. Desvincular y vincular | Pruebas existentes conservadas; no se cambia el contrato servidor. |
| 14. Offline | Pruebas locales existentes; pendiente aceptación nativa en el equipo destino. |
| 15. Regresiones | Lint, build y pruebas desktop pertinentes; completar informe con resultados finales. |

## Trabajo y revisión

- Antigravity: diagnóstico recibido correctamente. La invocación de implementación
  se detuvo tras superar 600 segundos sin respuesta, salida -1; no se recibió ni se
  atribuye un parche de implementación a este agente.
- Claude Code: auditoría independiente, errores de identidad/sesión, recuperación y
  pruebas JS/UI. La implementación nativa se reasignó a Claude tras ese fallo.
- Codex: aislamiento desde la versión publicada, contratos, rechazo de almacenamiento inseguro, revisión de diferencias, integración y validación. Conserva intacto el trabajo pendiente del checkout original.

No se cambian reproductores, teclado, proyección, diseño, niveles, contenidos,
implementación de caché, backend ni reglas Firebase. En `library.ts` el alcance se
limita a reintentar la lectura de identidad y no ofrecer otra vinculación ante un
error local.

## Validación local de la parte TypeScript

Sobre la worktree de integración: `npm run lint:player`, lint de los dos archivos
de pruebas modificados y `npm run build` terminan con código 0. Las suites
ejecutadas suman 243 pruebas: identidad/UI/publication-refresh 42, offline 44,
player 91, projection 25, startup 8, updater 11, release 20 y assets del bundle 2.
No se suman otra vez las ejecuciones de la base o las repeticiones de una suite.
Estos resultados no incluyen las pruebas nativas pendientes ni constituyen una
prueba de reinstalación o reinicio del sistema operativo.
