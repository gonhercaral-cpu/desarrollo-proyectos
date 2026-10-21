# Validación nativa Linux — estado y comandos

## Resultado observado (2026-09-29)

**La validación nativa sigue bloqueada. No hay instalador Linux generado.**

- Host: Windows x64, build 26200 / 25H2. WSL indica que no está instalado; tampoco se encontró Docker/Podman. La sesión no es administradora, confirmado también fuera del sandbox. No se intentó elevar Windows mediante UAC ni reiniciar el equipo.
- `rustc`, `cargo`, `rustup`: ausentes. No se instaló toolchain Windows porque el objetivo es Linux.
- Node del host: `v26.2.0`; npm: `11.13.0`.
- CLI Tauri instalada: `2.11.4`; API JavaScript: `2.11.1`. Cargo.lock fija `tauri 2.11.5`, `tauri-build 2.6.3`, `wry 0.55.1`; **no fueron compilados**.
- `tauri.conf.json` pasa el esquema oficial de la CLI instalada. Capabilities pasa el esquema generado preexistente; este resultado no sustituye regenerarlo/validarlo con Cargo.
- `npm run tauri:build` falla en `cargo metadata --no-deps --format-version 1: program not found`. La CLI Windows además rechaza `--bundles deb` y solo ofrece MSI/NSIS; hace falta ejecutar la CLI Linux.
- Los cuatro tests de `offline_cache::tests` y `cargo check` **no ejecutados**.
- Frontend: 18 tests offline, 18 Player, build TypeScript/Vite y lint específico pasan.
- Se reprodujo y corrigió un fallo de empaquetado: vite-plugin-static-copy v4 conservaba `node_modules/pdfjs-dist/` en el destino. Ahora los 200 assets se copian a `/pdfjs/{cmaps,standard_fonts,wasm,iccs}/`, como espera el renderer. Dos tests de bundle verifican rutas, bytes completos, worker y referencia desde el runtime; forman parte de `npm run build`.
- No se modificaron backend, reglas Firebase, CSP ni capabilities. No se agregaron funciones de producto.

## 1. Habilitar Linux en este Windows

En **PowerShell como administrador**, ejecutar:

```powershell
wsl --install -d Ubuntu-24.04
```

Reiniciar Windows si el instalador lo solicita. Abrir Ubuntu y completar creación de usuario/contraseña. Después:

```powershell
wsl --list --verbose
wsl -d Ubuntu-24.04
```

Es una base de compilación Ubuntu 24.04 x64 propuesta, no una distribución objetivo detectada. Si los salones usan una distribución anterior, compilar en esa base compatible más antigua; un binario construido en 24.04 no certifica compatibilidad con 22.04. En Linux nativo, omitir WSL y usar la distribución del salón.

Fuente: [instalación oficial WSL](https://learn.microsoft.com/en-us/windows/wsl/install).

## 2. Dependencias dentro de Ubuntu

Ejecutar en **Bash Linux**, no PowerShell ni Git Bash:

```bash
sudo apt update
sudo apt install --no-install-recommends \
  build-essential pkg-config curl wget file ca-certificates xz-utils \
  libwebkit2gtk-4.1-dev libssl-dev libxdo-dev \
  libayatana-appindicator3-dev librsvg2-dev

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/active-classroom-rustup.sh
sh /tmp/active-classroom-rustup.sh -y --profile minimal --default-toolchain stable
. "$HOME/.cargo/env"
rustup show active-toolchain
rustc --version
cargo --version
pkg-config --modversion gtk+-3.0 webkit2gtk-4.1
```

Los paquetes corresponden a los [requisitos oficiales Tauri 2](https://v2.tauri.app/start/prerequisites/), con herramientas para diagnóstico y descarga. No se agregan plugins de códecs ni LibreOffice. Conservar las versiones impresas en el registro de aceptación; no se declara una versión de Rust aún no instalada.

### Node Linux

Usar Node Linux 24 LTS (el Node Windows no sirve para instalar módulos nativos Linux). Si ya existe Node Linux compatible, conservarlo. Para una instalación por usuario desde el binario oficial x64:

```bash
(
  set -eu
  test "$(uname -m)" = x86_64
  ac_node_work="$(mktemp -d)"
  cd "$ac_node_work"
  ac_node_version=24.21.0
  ac_node_archive="node-v${ac_node_version}-linux-x64.tar.xz"
  curl -fSLO "https://nodejs.org/dist/v${ac_node_version}/${ac_node_archive}"
  curl -fSLO "https://nodejs.org/dist/v${ac_node_version}/SHASUMS256.txt"
  awk -v archive="$ac_node_archive" '$2 == archive' SHASUMS256.txt > node-checksum.txt
  test -s node-checksum.txt
  sha256sum --check node-checksum.txt
  mkdir -p "$HOME/.local/lib"
  tar -xJf "$ac_node_archive" -C "$HOME/.local/lib"
)
export PATH="$HOME/.local/lib/node-v24.21.0-linux-x64/bin:$PATH"
node --version
npm --version
node -p process.platform
```

El último comando debe imprimir `linux`. Repetir el `export PATH` en cada terminal nueva si se usa esta instalación. Binario/version consultados en [Node.js oficial](https://nodejs.org/en/download); la versión LTS indicada no fue instalada en esta sesión.

## 3. Preparar los mismos fuentes en filesystem Linux

Para este checkout Windows con trabajo sin commit, copiar el estado actual sin reutilizar `node_modules` Windows. Se trata de una carpeta de compilación de la misma aplicación; no de otra implementación:

```bash
set -euo pipefail
ac_linux_source="$(mktemp -d "$HOME/active-classroom-native.XXXXXX")"
mkdir -p "$ac_linux_source/active-classroom-desktop" "$ac_linux_source/docs"
tar --exclude='./node_modules' --exclude='./dist' --exclude='./src-tauri/target' \
  --exclude='./.git' --exclude='./.env' --exclude='./.env.*' \
  -C /mnt/c/Proyectos/desarrollo-proyectos/active-classroom-desktop -cf - . \
  | tar -C "$ac_linux_source/active-classroom-desktop" -xf -
cp /mnt/c/Proyectos/desarrollo-proyectos/docs/active-classroom-manifest.example.json "$ac_linux_source/docs/"
cp /mnt/c/Proyectos/desarrollo-proyectos/docs/active-classroom-desktop-api.md "$ac_linux_source/docs/"
cd "$ac_linux_source/active-classroom-desktop"
npm ci
```

No ejecutar `npm ci` Linux en la carpeta que utiliza Windows: reemplazaría sus módulos nativos. Si se trabaja directamente con un checkout Linux actualizado, basta entrar en `active-classroom-desktop` y ejecutar `npm ci`.

## 4. Tests Rust, check y paquete .deb real

Desde `active-classroom-desktop`, en Linux, detenerse ante cualquier error:

```bash
set -euo pipefail
npm run test:offline
npm run test:player
npm run lint:player
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib offline_cache::tests:: -- --nocapture
cargo check --locked --manifest-path src-tauri/Cargo.toml --all-targets
npm run tauri:build -- --bundles deb -- --locked
file src-tauri/target/release/active-classroom
find src-tauri/target/release/bundle/deb -maxdepth 1 -type f -name '*.deb' -print
sha256sum src-tauri/target/release/bundle/deb/*.deb
```

El filtro Rust debe ejecutar estos cuatro tests, no cero:

1. `rejects_path_traversal_and_bad_hash`
2. `verifies_file_bytes_and_size`
3. `accepts_published_contract`
4. `committed_cache_survives_reopen_and_failed_update`

`cargo check --all-targets` también compila los targets de pruebas anteriores, sin introducir funciones nuevas. No usar `--ignore-version-mismatches`, saltar Rust ni regenerar lockfiles indiscriminadamente para esconder fallos.

El proyecto ya permite paquetes Linux mediante `bundle.targets = "all"`; `--bundles deb` limita esta validación a Debian/Ubuntu. El artefacto esperado estará en `src-tauri/target/release/bundle/deb/`, pero **todavía no existe un paquete generado en esta validación**.

Para instalar y abrir, únicamente después de que todos los pasos anteriores pasen:

```bash
sudo apt install ./src-tauri/target/release/bundle/deb/*.deb
active-classroom
```

Fuente: [empaquetado Debian de Tauri](https://v2.tauri.app/distribute/debian/). AppImage multimedia requeriría revisar `bundleMediaFramework` y plugins efectivamente necesarios; no se habilitó ni se incluyeron códecs sin una prueba que los requiera. Véase [AppImage y GStreamer](https://v2.tauri.app/distribute/appimage/#multimedia-support-via-gstreamer).

## 5. Protocolo asset, CSP y paths

Revisión estática realizada:

- Cargo habilita `tauri/protocol-asset`; config habilita assetProtocol y scope `$APPDATA/**`.
- `app.path().app_data_dir()` y el identificador `com.activeclassroom.desktop` gobiernan la raíz. En Linux sin override XDG se espera `~/.local/share/com.activeclassroom.desktop/offline-v1/users/<sha256-uid>/`.
- `openLocalClass` usa `classroom_cache` y manifiestos persistidos; `resolveResource` devuelve paths de objetos SHA-256. Nombres originales con espacios/tildes se conservan como metadata, no se usan para construir rutas.
- `convertFileSrc` pertenece a la API oficial Tauri; el Player admite `asset://localhost/…` y la variante asset.localhost. La codificación efectiva y el servidor de assets aún requieren el binario.
- CSP permite asset local para lectura/imágenes/medios, worker local/blob y WASM. No se desactiva CSP, aislamiento ni sandbox WebKit. Capabilities solo declara ventana `teacher`, `core:default`, `dialog:allow-open`; no hay permisos remotos nuevos.

Prueba adicional con un directorio nuevo que tenga caracteres especiales (sin tocar el caché normal):

```bash
ac_special_data="$(mktemp -d "$HOME/AC datos ñ &.XXXXXX")"
XDG_DATA_HOME="$ac_special_data" ./src-tauri/target/release/active-classroom
```

Iniciar sesión y descargar una Unit en esa sesión; cerrar y reabrir con exactamente el mismo `XDG_DATA_HOME`, también sin red. No renombrar objetos SHA-256 ni editar manifests para preparar el caso. Este paso no se ha ejecutado.

## 6. Códecs y formatos: no confundir soporte anunciado con reproducción

**Ningún formato está certificado aún en WebKitGTK/Linux.** PDF se ha dibujado con PDF.js en Node/navegador; tests multimedia DOM simulan los elementos, no prueban decodificadores Linux.

WebKitGTK utiliza [GStreamer](https://docs.webkit.org/Ports/WebKitGTK%20and%20WPE%20WebKit/Multimedia.html). WAV/PCM, MP3, WebM/VP8-VP9/Opus-Vorbis, MP4/H.264 y M4A/AAC deben comprobarse con muestras reales y sus codecs conocidos. MP4/M4A son contenedores; la extensión por sí sola no determina reproducción.

Para inventariar lo instalado, añadir solo la herramienta de diagnóstico si falta:

```bash
sudo apt install --no-install-recommends gstreamer1.0-tools
gst-inspect-1.0 --version
for ac_element in wavparse mpg123audiodec matroskademux vp8dec vp9dec opusdec vorbisdec qtdemux h264parse avdec_h264 avdec_aac; do
  if gst-inspect-1.0 "$ac_element" >/dev/null 2>&1; then
    printf '%s: disponible\n' "$ac_element"
  else
    printf '%s: ausente (puede existir otro decoder)\n' "$ac_element"
  fi
done
```

`avdec_h264` y `avdec_aac` pertenecen al [plugin libav de GStreamer](https://gstreamer.freedesktop.org/documentation/libav/index.html), distribuido en Ubuntu como [gstreamer1.0-libav](https://packages.ubuntu.com/noble/gstreamer1.0-libav). Son una posible ruta de decodificación; hardware u otros plugins pueden cubrir el formato. **No instalarlo ni agregar `ugly`, paquetes restricted/extras o licencias adicionales automáticamente.** Primero probar el archivo y confirmar qué decoder falta. Un elemento presente o `canPlayType()` favorable tampoco sustituye reproducir, escuchar/ver y hacer seek dentro de Tauri.

Registrar por muestra: nombre, SHA-256, contenedor, codec, versión WebKit/GStreamer, reproducción, seek, audio audible y resultado tras reinicio sin red. WSLg permite probar una ventana Linux, pero no certifica GPU/sonido/códecs de la computadora del salón.

## 7. Aceptación pendiente en el binario instalado

Todos estos pasos permanecen **sin verificar en Tauri Linux**:

1. Abrir aplicación instalada en una sesión gráfica como usuario normal.
2. Iniciar sesión Firebase con una cuenta autorizada.
3. Listar publicaciones del backend real y descargar una Unit publicada con PDF, JPG/PNG/WebP, WAV/MP3/M4A y MP4/WebM de prueba.
4. Confirmar descarga completa y versión local; abrir PDF, imagen, audio y video. Cambiar página, recurso y regresar; probar seek, volumen, mute y fullscreen.
5. Cerrar completamente la aplicación. Desconectar la red del equipo de prueba y reiniciar la aplicación instalada.
6. Abrir la misma Unit sin conexión: manifest, PDF/worker/fuentes, imágenes y medios deben permanecer disponibles. No abrir servidor Vite ni depender de Firebase/Drive para reproducir.
7. Repetir con nombres originales como `Lección 01 ñ & práctica.pdf` y raíz XDG especial de la sección anterior.

Si no hay cuenta, publicación de muestras o Functions desplegadas, registrar ese bloqueo por separado. **El estado del backend desplegado no se ha determinado en esta sesión**; la ausencia de Linux ya impide la aceptación nativa. Los 18 tests offline usan disco real con adaptador de prueba y prueban reinicio lógico, hashes, caché y fallback; no sustituyen esta prueba instalada.
