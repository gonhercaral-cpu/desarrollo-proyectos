# Validación de la arquitectura multiagente

Fecha: 19 de octubre de 2026. Rama local: `codex/multiagent-collaboration`.
Base de trabajo: `12d0ecf`. La validación inicial se realizó antes de publicar la rama.

La base coincide con `origin/codex/active-classroom-linux-ci`. Según las referencias
actualizadas, contiene 21 commits propios respecto de `origin/main`; main tiene dos
commits propios y apunta a `a3944bb`. El ancestro común es `2922a98`. El PR de esta
configuración debe apuntar inicialmente a `codex/active-classroom-linux-ci` para
mostrar solo la arquitectura, o esperar a que ese desarrollo se integre por su propio
proceso. No fusionar los 21 commits funcionales como parte de esta tarea. Los flujos y
tests de Active Classroom analizados pertenecen a esa base y deben llegar a la rama
predeterminada antes de activar el sistema allí. Las referencias remotas se
refrescaron mediante fetch después de la aprobación del propietario.

El propietario aprobó la arquitectura. La aprobación permite preparar su publicación
y configuración; no habilita modelos sin claves ni concede escritura a los auxiliares.

## Resultados locales

| Comprobación | Resultado |
| --- | --- |
| `node --test tests/multiagent-security.test.cjs` | 12/12 pasan; permisos, contratos, forks, SHA concurrente, rutas, modos, límites y parches reales en repositorios temporales |
| `actionlint 1.7.12` sobre los dos workflows nuevos | Pasa; ejecutable descargado del repositorio oficial y SHA-256 contrastado con el manifiesto de release |
| ESLint de `.github/agents/` y `tests/multiagent-security.test.cjs` | Pasa |
| `npm run build` | Pasa; avisos existentes sobre chunks grandes e importación dinámica/estática |
| Pruebas existentes seleccionadas | 81/81 pasan: producción, operaciones, reportes, correcciones de material y Active Classroom |
| Firestore y Storage en emuladores | 126/126 pasan, 22 suites, Firebase CLI 15.27.0 y Java 21 |
| `node --check functions/index.js` y `node --check drive/index.js` | Pasan |
| `git diff --check` | Pasa |
| `npm run lint` global | **No pasa**: 137 errores y 37 advertencias en código previo |

Node local: 26.2.0; los workflows usan Node 24, acorde a los codebases Functions.
No se ha ejecutado una VM GitHub Actions con Node 24 desde esta sesión.
Actionlint se ejecutó sin shellcheck ni pyflakes; no implica que esos analizadores hayan pasado.

El lint inicial ni siquiera completaba el análisis porque recogía una copia generada
en `.firebase/classroom-linux-source-1.0.2/`, con una dependencia ausente.
Se excluyó `.firebase/**` del análisis y se incluyeron los controladores nuevos.
Los errores restantes son de la base funcional, no se corrigieron para evitar ampliar
el alcance. La nueva CI conserva este fallo visible; build y pruebas se ejecutan también
si falla lint, siempre que la instalación haya terminado correctamente. No configurar
el check de aplicación como obligatorio hasta resolver la base de lint y comprobar CI.

## Comandos de las pruebas de compatibilidad ejecutadas

```bash
node --test \
  tests/production-batches.test.cjs \
  tests/operational-notifications-tools.test.cjs \
  tests/print-request-report.test.mjs \
  tests/material-corrections-backend.test.cjs \
  tests/material-corrections-ui.test.mjs \
  tests/active-classroom-utils.test.mjs \
  tests/active-classroom-drive.test.cjs \
  tests/active-classroom-unit.test.cjs \
  tests/active-classroom-admin.test.mjs \
  tests/active-classroom-admin-ui.test.mjs

firebase emulators:exec --config firebase.rules-test.json \
  --project security-rules-audit --only firestore,storage \
  "node --test tests/firebase-rules.test.mjs"
```

El comando de emuladores se ejecutó con `XDG_CONFIG_HOME` apuntando a un directorio
temporal vacío, sin `FIREBASE_TOKEN` ni `GOOGLE_APPLICATION_CREDENTIALS` en ese proceso.
No hubo autenticación Firebase ni uso del proyecto de `.firebaserc`.
Los emuladores finalizaron correctamente después de las pruebas.
En Windows se usó la invocación equivalente, porque el prefijo POSIX de
`npm run test:rules` no es válido en PowerShell. En CI Ubuntu se usa el script original.

## Pendientes reales de activación

- Crear y proteger `multiagent-readonly`; configurar Secrets, variables, cuotas y modelos
  según [el procedimiento](multiagent-collaboration.md).
- Verificar permisos reales de CODEOWNERS, protecciones de ramas/tags y alcance de Secrets existentes.
- Ejecutar CI remota y resolver el lint previo antes de exigir ese check.
- Una prueba piloto autenticada de Claude y otra de Gemini: delegación, artefacto,
  revisión de Codex, comprobación de parche y PR de prueba. No realizadas sin claves.
- Probar la autenticación y conectividad del entorno concreto de Codex Cloud; no se
  presupone que su terminal tenga GitHub CLI autenticado.

No se probaron ni ejecutaron firma, publicación de releases, bootstrap de claves,
despliegues de Hosting/Functions/reglas/Storage, tests nativos Linux/Tauri ni servicios
de producción. Los dos workflows históricos y los archivos Firebase permanecen intactos.
