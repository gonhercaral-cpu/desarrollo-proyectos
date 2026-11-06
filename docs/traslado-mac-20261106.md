# Traslado de Windows a Mac — 6 de noviembre de 2026

Este respaldo conserva el código que estaba en la carpeta principal de Windows y
el trabajo pendiente de las otras carpetas. Es un punto de recuperación, no una
integración aprobada ni una versión publicada del producto.

## Descargar el proyecto en la Mac

Instala las herramientas de línea de comandos de Xcode (`xcode-select --install`)
y Git. Después ejecuta en Terminal:

```sh
mkdir -p ~/Proyectos
cd ~/Proyectos
git clone --branch codex/transfer-mac-20261106/principal https://github.com/gonhercaral-cpu/desarrollo-proyectos.git
cd desarrollo-proyectos
```

La carpeta resultante reproduce el código de la carpeta principal de Windows,
incluidos los cambios que aún no tenían commit. Los saltos de línea se normalizan
según Git. Los archivos privados se recuperan por separado desde el USB.

## Recuperar todas las ramas y carpetas de trabajo

Con Python 3 instalado:

```sh
python3 scripts/restaurar-ramas-mac.py --dry-run
python3 scripts/restaurar-ramas-mac.py --worktrees
```

El inventario está en `docs/traslado-mac-20261106.json`. El script conserva las
28 puntas originales de Windows como ramas `respaldo-windows/<nombre-original>`
y los 10 estados pendientes como ramas `recuperado-mac/<id>`. No reemplaza ramas
existentes con otro contenido y mantiene la rama activa.

Las ocho carpetas secundarias con trabajo pendiente se crean junto al proyecto,
dentro de `desarrollo-proyectos-worktrees/`. Las carpetas que estaban limpias
se pueden recrear desde su SHA usando `git worktree add`.

El respaldo `14-active-classroom-release-1-0-18` contiene 830 eliminaciones en una
carpeta temporal antigua. Se conserva su referencia, pero el script no crea una
carpeta de trabajo para él. No usarlo como punto de partida ni fusionarlo.

Todos los commits anteriores al traslado ya estaban disponibles en GitHub. Cinco
ramas locales estaban adelantadas a su remota homónima, pero sus puntas ya eran
ancestros de `origin/main`. El manifiesto conserva sus nombres y SHAs exactos.
`main` local estaba atrasada 28 commits; para trabajar sobre la versión integrada
actual, parte de `origin/main`, no de `respaldo-windows/main`.

## Preparar las dependencias

Instala Node.js 24. En la carpeta del proyecto:

```sh
npm ci
npm --prefix functions ci
npm --prefix drive ci
npm --prefix active-classroom-desktop ci
npm run dev
```

Para Tauri, instala Rust y las herramientas de Xcode. Después usa
`npm run active-classroom:desktop`. Para el procesador instala Python 3.12 y sus
dependencias en un entorno virtual; su Dockerfile requiere además LibreOffice,
Poppler y fuentes. El contenedor es una alternativa para reproducir ese entorno.
Para los emuladores instala Firebase CLI y Java 21 según la documentación del repo.

No reutilizar `node_modules`, entornos virtuales ni compilaciones de Windows en la
Mac. Se regeneran para el sistema y la arquitectura de destino.

## Archivos privados y herramientas

El paquete privado para USB incluye un inventario de archivos y sumas SHA-256.
Extráelo a una carpeta de revisión fuera del repositorio. Combina los archivos del
proyecto y las configuraciones personales de forma selectiva; no reemplaces toda
la configuración de Codex que ya existe en la Mac.

Las rutas `C:\...`, los ejecutores `.ps1` y los metadatos `.git` de worktrees de
Windows requieren adaptación. Reconstruye las worktrees con el script anterior.
Conserva `.orquestacion/PROTOCOLO.md` y los contratos como referencia; el ejecutor
actual de Antigravity está escrito para Windows y requiere una versión para Mac
una vez que `agy` esté instalado y autenticado allí. No usar `gemini_worker.py`
como sustituto. Inicia sesión en GitHub, Firebase y las herramientas que necesites.

El paquete privado contiene datos que no deben publicarse. No subir su ZIP,
credenciales, `.env`, transcripciones, datos de emuladores ni configuraciones de
sesión a este repositorio público. Firebase remoto sigue en los mismos proyectos;
los cachés y datos locales requieren su propia recuperación.

## Verificación y alcance

Se comprueban la integridad de los snapshots y su disponibilidad en GitHub, y el
script de recuperación se prueba en un clon aislado. No se ejecutan despliegues,
firmas ni releases. Los commits de respaldo llevan `[skip ci]` para evitar que el
push dispare el workflow histórico de Linux.

Los cambios funcionales pendientes se conservan sin corregirlos ni aprobarlos:
requieren revisión y las pruebas de su área antes de integrarlos. La compilación y
el funcionamiento real en macOS quedan pendientes de ejecutar en la Mac.
