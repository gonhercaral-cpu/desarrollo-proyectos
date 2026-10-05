# CI Linux — Active Classroom Desktop

Workflow único: `.github/workflows/active-classroom-linux.yml`.

## Ejecución

- Automática al subir cambios de Desktop, del manifest de ejemplo usado por tests o del workflow, en cualquier rama.
- Manual con `workflow_dispatch`: GitHub > Actions > Active Classroom Desktop Linux > Run workflow. Para que aparezca el botón, el workflow debe existir en la rama por defecto; el trigger `push` permite validar inicialmente una rama de trabajo sin modificar `main`.
- Runner GitHub `ubuntu-22.04` x64; Node 24 LTS compatible con las dependencias actuales; Rust estable instalado explícitamente mediante rustup. Las versiones exactas resueltas se imprimen en logs/resumen.
- Actions oficiales fijadas a SHA. `contents: read`, checkout sin credenciales persistidas, sin secrets Firebase, sin publicación de releases ni auto-update.

## Validaciones obligatorias

1. Dependencias nativas Tauri/WebKitGTK 4.1 desde APT, sin packs adicionales de códecs.
2. `npm ci`, todos los tests Desktop (offline, activación, actualización, Player, proyección y prototipo conservado), WebKitGTK real y lint específico. Jobs separados verifican backend/reglas en emuladores y conversión Office real.
3. `npm run build`: TypeScript/Vite y `test:bundle`, que verifica bytes/rutas de los 200 assets PDF.js y su worker. `test:release` comprueba versión única, identidad de instalación y patrones de secretos en fuentes/build.
4. Exigir exactamente cuatro tests `offline_cache::tests` y ejecutar todos los tests Rust con Cargo `--locked`, además del test de persistencia real en llavero Linux.
5. `cargo check --locked --all-targets`. El build script Tauri valida configuración/capabilities reales.
6. `npm run tauri:build -- --bundles deb -- --locked`. Mantiene el build frontend previo configurado por Tauri y empaqueta el `frontendDist` completo.
7. Comprobar `.deb` amd64 con la misma versión de package/Tauri/Cargo (1.0.0), imprimir metadata, calcular/verificar SHA-256 portable y exigir lockfiles intactos.
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
