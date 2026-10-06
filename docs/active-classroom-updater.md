# Updater habilitado: Active Classroom 1.0.4 / 1.0.5

El instalador anterior 1.0.4 se generó con `plugins.updater.pubkey: ""` y `bundle.createUpdaterArtifacts: false`. `configured()` comprobaba solamente clave no vacía. Por eso devolvía `false`, entraba en estado `unconfigured` y mostraba «Actualizaciones todavía no habilitadas en esta instalación», sin consultar Internet. Plugin sí estaba inicializado también en producción.

Configuración corregida: plugin oficial Rust `tauri-plugin-updater = 2.13.1`, clave pública real compilada, `createUpdaterArtifacts: true`, `requireSignedVersion: true` y endpoint:

`https://github.com/gonhercaral-cpu/desarrollo-proyectos/releases/latest/download/latest.json`

Clave generada únicamente dentro de GitHub Actions. Secrets existentes: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Variable pública: `ACTIVE_CLASSROOM_UPDATER_PUBLIC_KEY`. Secret temporal `UPDATER_BOOTSTRAP_TOKEN` eliminado después de bootstrap. No regenerar clave. SHA-256 de representación Tauri de pública: `fb0e3c2a07b7ef8afbabe2d916cfb09da5d97cb4b1a5af92a493bf7fc76ba8b2`.

No se necesita variable/token en Zorin. Privada no está en código, binario ni artifacts. Workflow compara pública compilada con variable y verifica firma/versión mediante Minisign antes de publicar release. Artifact Linux: `linux-x86_64-deb`; `.deb`, `.deb.sig`, `.deb.sha256`, `latest.json`, notas y reporte de aceptación. SHA-256 manual no sustituye firma updater. Release sale de draft solo cuando todos los jobs y assets están completos.

Frontend usa comando propio `classroom_app_update`. Rust conserva objeto Update, fija clave/endpoint y rechaza ventanas distintas de `teacher`. No necesita bindings/permisos JS del plugin updater ni plugin process; usa descarga/instalación Rust y `AppHandle::restart`. Capability `default.json` permite eventos Core de teacher; audience no accede a updater. Feature `updater-acceptance` se excluye del binario final. Plugin no depende de modo desarrollo.

Rust valida clave Minisign/Ed25519, endpoints HTTPS y exigencia de versión firmada. Estados distinguen «Estás usando la versión más reciente», «Nueva versión disponible: 1.0.5», «No se pudo buscar actualizaciones» y «Actualizaciones no configuradas en esta instalación». Red fallida nunca marca configuración ausente. Biblioteca abre sin esperar consulta; descarga muestra progreso, instala con updater oficial y ofrece reinicio. Linux puede pedir contraseña con pkexec; paquete declara policykit-1.

## Una reinstalación manual y prueba en Zorin

1. Cerrar app. Descargar nuevo `.deb` 1.0.4 y `.sha256` desde release `active-classroom-v1.0.4`; el anterior instalador local carecía de clave pública.
2. Ejecutar en carpeta descargada:

```bash
sha256sum --check 'Active Classroom_1.0.4_amd64.deb.sha256'
sudo apt install --reinstall './Active Classroom_1.0.4_amd64.deb'
```

3. Abrir Acerca de. Mientras latest sea 1.0.4 debe mostrar «Estás usando la versión más reciente». Si ya existe 1.0.5, debe ofrecerla directamente.
4. Release `active-classroom-v1.0.5` usa misma clave. Pulsar Buscar actualizaciones para detectar 1.0.5, leer notas y pulsar Actualizar ahora.
5. Comprobar descarga/progreso/verificación. Completar autorización Linux si aparece. Pulsar Reiniciar Active Classroom después de instalar.
6. Acerca de debe mostrar 1.0.5. Verificar mismo equipo activado/deviceId/displayName, Units, caché y monitor/proyector seleccionado. Abrir una Unit offline. No desinstalar, desactivar ni borrar datos para actualizar.

Identificador `com.activeclassroom.desktop`, rutas `offline-v1`, atributos Secret Service y claves localStorage se conservan. Updater no escribe esos datos. Corrección no cambia Player, sincronización, segunda pantalla ni backend; conserva código 1.0.4 instalado como base.

## Aceptación y firma

`tests/updater-linux.sh` instala paquetes reales de prueba 1.0.4/1.0.5 y ejecuta descarga/firma/instalación/reinicio. Prueba misma versión, Internet fallido, archivo alterado y replay firmado; comprueba llavero, Unit/caché nativo, nombre y preferencias reales WebKit. HTTPS local mantiene validación TLS. Firma efímera solo para fixtures; releases usan Secrets de producción. Caché de compilación se guarda antes de fixtures y antes de exponer Secrets de producción.

Aceptación Linux automatizada no sustituye comprobar autorización gráfica/datos del salón en Zorin físico. Reporte histórico 1.0.0/1.0.1 pertenece a prueba anterior; nueva aceptación usa explícitamente 1.0.4/1.0.5.

Referencia oficial: https://github.com/tauri-apps/plugins-workspace/tree/updater-v2.13.1/plugins/updater
