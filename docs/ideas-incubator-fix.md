# Registro de ideas: diagnóstico y validación

## Hallazgos (28 de septiembre de 2026)

- `handleCreateIdea` y `createIdea` ya esperaban `addDoc`. La función devuelve el ID después de la escritura; no intervienen callables ni Cloud Functions.
- La colección de escritura y lectura es `ideas`, base `(default)`, proyecto `sistema-desarrollo-proyectos`. El autor y la consulta personal usan `firebaseUser.uid`.
- Se comparó también el JavaScript público desplegado: contiene los mismos `await`, validaciones y manejo de errores que la versión local anterior al cambio.
- Las reglas publicadas de ideas coinciden con las locales. Permiten crear a un perfil activo con `createdByUid` y `updatedByUid` iguales al UID autenticado y el esquema permitido. Los perfiles de Ernesto y Tony están activos y tienen rol `collaborator`.
- No se reprodujo el síntoma exacto de éxito sin escritura. No hay evidencia para atribuirlo a un `await` faltante o a permisos administrativos. Falta observar una ejecución fallida desde una sesión afectada para cerrar esa causa.
- Sí se comprobó un error de interfaz: los errores se mostraban detrás del modal y cerrar el modal borraba el borrador. El listener mostraba también creaciones locales pendientes, que desaparecen si Firestore las rechaza. Filtros activos podían ocultar una creación confirmada.
- Con adjuntos, un fallo posterior a `addDoc` podía dejar una idea creada y generar otra al reintentar.

## Correcciones

- Error accesible dentro del formulario, con foco automático; texto en español y log con operación, colección, UID, rol, código y excepción.
- Borrador y archivos se conservan ante errores y al cerrar. El formulario solo se reinicia al completar el guardado.
- Bloqueo síncrono de envíos mediante ref; botón, campos y cierre deshabilitados mientras se espera al backend.
- Validación previa de sesión, perfil activo, campos obligatorios, prioridad, impacto y límite de adjuntos de Storage (menos de 25 MB).
- Solo las creaciones confirmadas aparecen en la lista; las actualizaciones pendientes mantienen la versión confirmada anterior. Se limpian filtros tras el éxito.
- Reintentos de evidencia reutilizan el ID confirmado y los archivos ya subidos. Si la idea ya existe, sus campos permanecen bloqueados y se informa que falta completar evidencia.
- Sin cambios de reglas, índices, Functions ni esquema de documentos existentes.

## Pruebas reproducibles

Servicio, con Node que soporte module mocks:

```powershell
node --experimental-test-module-mocks --test tests/ideas-service.test.mjs
```

Reglas e integración real del SDK contra emuladores (equivalente Windows de `npm run test:rules`, cuyo script usa asignación de variables de shell POSIX):

```powershell
$env:XDG_CONFIG_HOME = Join-Path $PWD '.firebase/cli-config'
firebase emulators:exec --config firebase.rules-test.json --project security-rules-audit --only firestore,storage "node --test tests/firebase-rules.test.mjs"
```

Interfaz aislada, sin escrituras en producción:

```powershell
npx vite --config tests/ideas-preview.config.js
```

Abrir `http://127.0.0.1:5188/tests/fixtures/ideas-incubator.html`. El panel permite confirmar o rechazar el backend simulado y disparar dos submits síncronos. Los datos de esta fixture se almacenan solo en localStorage; la persistencia real de Firestore se valida en los emuladores por separado.

Casos verificados en navegador: doble envío (una llamada), carga y cierre bloqueado, permisos denegados y conexión fallida con todos los campos intactos, cerrar/abrir conserva borrador, éxito para colaborador y administrador, lista inmediata y recarga, limpieza de filtros que ocultaban la idea.

Resultado final: 120 pruebas de reglas/integración y 7 del servicio aprobadas. Incluye perfiles colaborador, administrador, Imprenta y Soporte Técnico.

`npm run build` pasa. `npm run lint` global reporta 137 errores y 37 advertencias preexistentes, incluidos dos `react-hooks/set-state-in-effect` en IdeasIncubator; se comparó esa página con HEAD y mantiene los mismos dos errores. Los demás archivos JavaScript nuevos/modificados para este cambio pasan ESLint. No se alteraron esos efectos ajenos al registro.

## Despliegue

Este cambio necesita solamente `npm run build` y `firebase deploy --only hosting`. No se ha desplegado. El workspace contiene otros cambios previos; revisar el contenido del build antes de publicar todo el checkout.

Los reintentos de adjuntos conservan progreso mientras este módulo siga montado. Recargar durante una carga parcial pierde ese progreso local; la idea ya confirmada seguirá en Firestore y permite agregar evidencia desde su detalle.
