# Refresh de publicaciones Desktop 0.1.4

Cada clic inicia una consulta POST nueva con `cache: no-store`, cursor `null`,
ID token vigente y paginación independiente. No se conserva Promise de catálogo.
Si una página repite Unit, se conserva la mayor versión numérica, no la última
entrada recibida. Versiones ambiguas como `"v2"` se rechazan por contrato.

`mergeLibraryPublications` conserva `remoteVersion` y `localVersion` por separado.
Refresh no escribe manifests, elimina archivos ni activa versiones. `Abrir clase`
usa la copia local; `SyncEngine` activa actualizaciones después de verificar todos
los archivos. Estados existentes: No descargada, Actualización disponible,
Actualizada, Descargando y Error.

Logs seguros: `REFRESH_START`, `REMOTE_PUBLICATION` (unitId/version),
`LOCAL_PUBLICATION` (unitId/version), `UPDATE_AVAILABLE` (version/localVersion),
`REFRESH_COMPLETE`. No tokens, credenciales, nombres de equipo ni cuerpos HTTP.

## Evidencia de producción

Consulta Firestore de solo lectura durante diagnóstico: proyecto
`sistema-desarrollo-proyectos`, Unit `level-1-unit-01`, `publishedVersion: 1`;
subcolección `publications` contiene únicamente documento `1`, manifest v1.
No se creó ni modificó publicación para forzar el caso v2. El endpoint autenticado
no pudo consultarse desde este host: no dispone de credencial Desktop, y la
identidad administrativa de diagnóstico carece de permiso para firmar Custom Token.
No se ampliaron permisos. Estos datos no demuestran un fallo de refresh contra v2
en producción; requieren contrastar con la Unit/proyecto donde se observa v2.

## Pruebas

`npm run test:offline` incluye prueba del botón real con DOM, transporte,
SyncEngine y caché en disco: local v1/remoto v2, apertura v1, descarga,
SHA-256/tamaño, activación v2, conservación de v1 y reinicio offline con v2.
Cubre v2/v10, versiones iguales, Unit sin copia, cursor nuevo y páginas duplicadas.
WebKitGTK real comprueba dos consultas HTTP y nueva versión en la segunda.
Emulador Firestore comprueba que dispositivo autorizado recibe última versión
v1/v2/v10, manteniendo acceso explícito a publicaciones anteriores.

Solo cambia Desktop y pruebas. No requiere Functions, reglas ni Hosting.
Instalar nuevo `.deb` 0.1.4 generado por CI Linux; mantiene identidad y caché.
