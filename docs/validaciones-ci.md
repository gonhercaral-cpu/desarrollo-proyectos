# Validaciones por módulo

Los workflows se ejecutan por `push` en todas las ramas y también admiten ejecución
manual. El filtrado se hace por archivos, no por nombre de rama ni por el título del PR.

| Cambio | Supervisión web/Firebase | Compatibilidad Firebase de Active Classroom | Linux completo de Active Classroom |
| --- | --- | --- | --- |
| `functions/projectSupervision*.js`, componente, servicio, estilos o tests de Supervisión | Sí | No | No |
| `functions/index.js`, reglas o configuración de emuladores compartidas | Sí | Sí | No |
| Código y pruebas propios de Active Classroom cubiertos por su workflow | Solo si además cambia una dependencia compartida de Supervisión | Se mantiene el job de permisos original en su workflow | Sí |
| Solo documentación de Supervisión | Sí | No | No |
| Cambios mixtos de Supervisión y Active Classroom | Sí | Según los archivos compartidos modificados | Sí |

## Supervisión inteligente

`.github/workflows/project-supervision.yml` valida el motor, el proveedor Gemini con
respuestas simuladas, la integración con Firestore, las reglas de seguridad y la
regresión de notificaciones. También ejecuta lint específico y build de la web.
No requiere Rust, Tauri, instaladores, WebKitGTK ni conversión Office. Las pruebas
usan emuladores y no consumen el piloto productivo de Gemini ni envían mensajes.

## Firebase compartido

`.github/workflows/firebase-shared.yml` conserva la validación original de backend,
permisos y reglas de Active Classroom para cambios en las entradas/reglas compartidas.
Incluye los tests de dispositivos y las transacciones en emuladores que ya existían.
No compila ni instala la aplicación de escritorio. La instalación de las dependencias
Node de escritorio permite ejecutar los tests existentes de autorización de dispositivos;
no ejecuta su suite Linux ni crea instaladores.

## Active Classroom

`.github/workflows/active-classroom-linux.yml` mantiene íntegros sus jobs de permisos,
Office, Linux, aceptación y publicación. Solo se retiran de sus disparadores los cuatro
archivos Firebase compartidos trasladados al workflow anterior. Los cambios propios
del módulo y de este workflow siguen ejecutando toda la validación original.
La ejecución manual y la exigencia de una VALIDATION completa del commit exacto para
publicar un instalador no cambian. Un resultado verde de Supervisión o de Firebase
compartido no certifica una release de escritorio.
