# CI Linux — Active Classroom Desktop

Workflow único: `.github/workflows/active-classroom-linux.yml`.

Distribución habilitada: build firmado en GitHub Actions con Secrets de firma.
Clave pública real se compila en Desktop; privada nunca se copia a Windows,
Cloud Build ni binarios. Builds sin Secrets no generan instalador distribuible.

## Ejecución

- Automática al subir cambios de Desktop, del manifest de ejemplo usado por tests o del workflow, en cualquier rama.
- Manual con `workflow_dispatch`: GitHub > Actions > Active Classroom Desktop Linux > Run workflow. Para que aparezca el botón, el workflow debe existir en la rama por defecto; el trigger `push` permite validar inicialmente una rama de trabajo sin modificar `main`.
- Runner GitHub `ubuntu-22.04` x64; Node 24 LTS compatible con las dependencias actuales; Rust estable instalado explícitamente mediante rustup. Las versiones exactas resueltas se imprimen en logs/resumen.
- Actions oficiales fijadas a SHA. Jobs de validación usan `contents: read`, checkout sin credenciales persistidas y sin secrets Firebase. Tags `active-classroom-v*` generan instalador firmado y metadata; job release separado recibe `contents: write` y publica únicamente después de todos los checks. Configuración inicial en `docs/active-classroom-updater.md`.

## Validaciones obligatorias

1. Dependencias nativas Tauri/WebKitGTK 4.1 desde APT. FFmpeg y GStreamer good/bad/ugly/libav preparan el fixture H.264/AAC del runner; no certifican los paquetes instalados en cada salón.
2. `npm ci`, todos los tests Desktop (offline, activación, actualización, Player, proyección y prototipo conservado), WebKitGTK real y lint específico. Jobs separados verifican backend/reglas en emuladores y conversión Office real.
3. `npm run build`: TypeScript/Vite y `test:bundle`, que verifica bytes/rutas de los 200 assets PDF.js y su worker. `test:release` comprueba versión única, identidad de instalación y patrones de secretos en fuentes/build.
4. Exigir cinco tests `offline_cache::tests` y ejecutar todos los tests Rust con Cargo `--locked`, además del test de persistencia real en llavero Linux. Multimedia comprueba integridad, paths, Range/206/416 y transferencia incremental de 600 MiB con medición de RAM.
5. `cargo check --locked --all-targets`. El build script Tauri valida configuración/capabilities reales.
   `npm run test:media:linux` ejecuta el Player real bajo Tauri/WebKitGTK: compara `asset://` con HTTP loopback, valida H.264/AAC, seek, reproducción, reapertura, volumen/mute, fullscreen, seguidor de proyección y scroll hasta el último elemento. Prueba una ventana normal y el tamaño mínimo, 80 slides, 60 recursos asociados y 60 generales; también un MP4 válido de 600 MiB con padding sparse.
6. `bash tests/updater-linux.sh` instala fixtures reales 1.0.4/1.0.5, verifica misma versión, firmas, replay, fallo de Internet, reinicio Tauri, llavero, caché y preferencias WebKit conservadas. Después build firmado empaqueta producción sin feature de aceptación. Clave pública compilada debe coincidir con variable de Actions. Genera `.deb.sig` vinculado a versión y verifica Minisign antes de publicar.
7. Comprobar `.deb` amd64 con la misma versión de package/Tauri/Cargo, imprimir metadata, calcular/verificar SHA-256 portable y exigir lockfiles intactos.
8. Subir artefacto únicamente tras éxito completo. Sin `continue-on-error` ni sustitutos de Cargo/Tauri.

## Descargar e instalar

Artefacto: `active-classroom-1.0.0-linux-amd64-<commit SHA>`, conservado 14 días. El workflow obtiene la versión del package verificado, sin otra versión hardcodeada.

Ruta original del instalador: `active-classroom-desktop/src-tauri/target/release/bundle/deb/*.deb`; se adjunta también su `.sha256`. El nombre exacto y versiones utilizadas aparecen en el resumen de la ejecución.

Tras descargar/descomprimir en Linux compatible:

```bash
sha256sum --check 'Active Classroom_1.0.0_amd64.deb.sha256'
sudo apt install './Active Classroom_1.0.0_amd64.deb'
active-classroom
```

No usar como evidencia de reproducción un build verde: CI no inicia sesión Firebase ni descarga material privado, ni verifica GPU/sonido/códecs del salón. PDF, imágenes, audio/video, protocolo asset, reinicio y clase offline deben pasar la aceptación de [LINUX_NATIVE_VALIDATION.md](LINUX_NATIVE_VALIDATION.md) en el binario instalado.

Piloto Zorin confirmado por el usuario. Operación de 1.0.0 y aceptación por salón en [guía de instalación](../../docs/active-classroom-1.0.0.md).

## Fuente a validar

GitHub ejecuta archivos **subidos al commit**, no los cambios locales sin commit. Deben acompañar al workflow la implementación actual de `active-classroom-desktop/` y `docs/active-classroom-manifest.example.json`. No subir credenciales, `node_modules`, `dist` ni `target`; tampoco hace falta publicar cambios backend para compilar Desktop.
