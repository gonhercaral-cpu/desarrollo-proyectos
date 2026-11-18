# Desarrollo local en macOS y referencia del traslado

Para trabajar usa `main`. El respaldo del 6 de noviembre de 2026 conserva estados
de Windows anteriores a la integración actual; su rama principal no es la base
de desarrollo. Esta guía recupera las instrucciones útiles del traslado y el
ejecutor nativo, sin importar credenciales, binarios ni configuraciones de sesión.

## Checkout y dependencias

Con Git y las herramientas de línea de comandos de Xcode disponibles:

```sh
mkdir -p ~/Proyectos
cd ~/Proyectos
git clone --branch main https://github.com/gonhercaral-cpu/desarrollo-proyectos.git
cd desarrollo-proyectos
```

El entorno del proyecto utiliza Node.js 24, Python 3.12 y Java 21. Tauri requiere
además Rust y el SDK de Xcode. El procesador necesita LibreOffice (`soffice`),
Poppler (`pdftoppm`, `pdftotext`) y fuentes; su referencia reproducible de Linux
es el [Dockerfile](../active-classroom-processor/Dockerfile). La instalación nativa
de macOS no garantiza la misma sustitución de fuentes ni los mismos resultados
visuales que Linux.

Instala esas herramientas nativas antes de usar el ejecutor. No copies
`node_modules`, entornos virtuales ni compilaciones de Windows. Desde la raíz:

```sh
bash scripts/con-entorno-macos.sh node --version
bash scripts/con-entorno-macos.sh python3 --version
bash scripts/con-entorno-macos.sh java -version
bash scripts/con-entorno-macos.sh npm ci
bash scripts/con-entorno-macos.sh npm --prefix functions ci
bash scripts/con-entorno-macos.sh npm --prefix drive ci
bash scripts/con-entorno-macos.sh npm --prefix active-classroom-desktop ci
```

Para Python, crea un entorno propio del checkout; `.venv/` está ignorado:

```sh
bash scripts/con-entorno-macos.sh python3.12 -m venv active-classroom-processor/.venv
active-classroom-processor/.venv/bin/python -m pip install -r active-classroom-processor/requirements.txt
```

## Qué hace el ejecutor

[con-entorno-macos.sh](../scripts/con-entorno-macos.sh) prepara el entorno de un
único comando. Conserva el directorio desde el que lo invocas, los argumentos y
el código de salida. No instala herramientas, modifica perfiles del shell ni
escribe preferencias globales.

- En macOS elige un solo prefijo Homebrew: `HOMEBREW_PREFIX` si está definido y
  es un directorio, o los
  prefijos habituales en orden de arquitectura (`/opt/homebrew` para ARM,
  `/usr/local` para Intel). Solo añade rutas del prefijo elegido y conserva las
  rutas previas del usuario.
- Antecede al `PATH` existente los directorios disponibles de Homebrew,
  Python 3.12, Node 24, Java y LibreOffice. También considera `~/.local/bin` si
  `HOME` está definido.
  Un `JAVA_HOME` con valor se conserva; si está vacío, busca OpenJDK 21 en el
  prefijo seleccionado. Cada directorio se añade solo si existe.
- Busca Firebase CLI primero en
  `.orquestacion/tools/firebase/node_modules/.bin` del checkout actual. Si no lo
  encuentra, una worktree consulta el directorio común de Git para buscarlo en
  el checkout principal. No usa rutas personales codificadas. Sin instalación
  local, queda disponible el CLI que ya esté en el `PATH` del usuario.
- Solo al invocar `firebase` por nombre puede adoptar el perfil existente
  `.firebase/cli-config` asociado a la instalación local elegida. Si
  `XDG_CONFIG_HOME` está definido, incluso vacío, lo respeta. No cambia esa
  variable para `npm`, Claude, Antigravity ni otros comandos. Si no existe ese
  perfil local, conserva el comportamiento predeterminado del CLI.

En otros sistemas omite la selección de Homebrew, Java y LibreOffice; mantiene
`~/.local/bin`, la resolución de Firebase local y la ejecución del comando. Si falta una herramienta,
el ejecutor no la descarga ni sustituye silenciosamente por una instalación nueva.

## Firebase CLI y sesiones

Comprueba primero la instalación disponible:

```sh
bash scripts/con-entorno-macos.sh firebase --version
```

Si falta, puedes instalar la versión fijada por el CI del repositorio en el
directorio ignorado de este checkout, sin cambiar los paquetes de la aplicación:

```sh
bash scripts/con-entorno-macos.sh npm install --prefix .orquestacion/tools/firebase --no-audit --no-fund firebase-tools@15.27.0
```

Conserva las sesiones que ya funcionan en esta Mac. Si necesitas iniciar una
sesión nueva de Firebase en un perfil local explícito, desde la raíz:

```sh
XDG_CONFIG_HOME="$PWD/.firebase/cli-config" bash scripts/con-entorno-macos.sh firebase login
```

El perfil pertenece a la instalación local que contiene el CLI; no se copia ni
se versiona. Una worktree que utiliza el CLI del checkout principal reutiliza,
sin copiarlo, su `.firebase/cli-config` y por tanto su sesión, solo al invocar
`firebase` por nombre. Para seleccionar otro perfil, pasa `XDG_CONFIG_HOME`
explícitamente.

GitHub CLI, Claude Code y Antigravity mantienen sus propios accesos. Puedes
comprobarlos con `gh auth status`, `claude auth status` y `agy --version`; la
versión de Antigravity no certifica por sí sola una sesión autenticada. Este
ejecutor no configura ni activa delegación remota o workflows multiagente.

## Desarrollo y validación local

Desde la raíz, estos comandos comprueban el entorno sin desplegar:

```sh
bash -n scripts/con-entorno-macos.sh
bash scripts/con-entorno-macos.sh node --test tests/macos-environment.test.cjs
bash scripts/con-entorno-macos.sh npm run build
bash scripts/con-entorno-macos.sh npm run lint
bash scripts/con-entorno-macos.sh npm run test:rules
bash scripts/con-entorno-macos.sh cargo check --locked --manifest-path active-classroom-desktop/src-tauri/Cargo.toml
```

`test:rules` usa Firestore/Storage emulados y el proyecto de pruebas
`security-rules-audit`, según [firebase.rules-test.json](../firebase.rules-test.json).
El propio script npm selecciona `.firebase/cli-config` relativo al directorio de
trabajo. Sus puertos 8180/9299 son distintos de los que espera la web.
`cargo` debe estar disponible en el `PATH` del usuario o en Homebrew; el ejecutor
no instala Rust ni modifica su configuración.
La comprobación de Tauri puede regenerar archivos en `src-tauri/gen/schemas`.
Revisa el diff antes de incluir cambios generados en un commit.

Para la web puedes ejecutar
`bash scripts/con-entorno-macos.sh npm run dev:emulators`. Esto inicia solo Vite:
los emuladores deben estar ejecutándose aparte en Auth 9099, Firestore 8080,
Storage 9199 y Functions 5001, como indica [firebase.js](../src/services/firebase.js).
Las pruebas de reglas anteriores no mantienen esos servicios para la web.

Para comprobar el procesador con el entorno creado en este checkout:

```sh
cd active-classroom-processor
bash ../scripts/con-entorno-macos.sh .venv/bin/python -m unittest discover -s tests -v
```

Los resultados de cada ejecución pertenecen al PR que la documenta. Esta guía no
certifica pruebas históricas, disponibilidad de servicios remotos, empaquetado
macOS firmado ni proyección en una pantalla física. El lint global puede incluir
deuda anterior; compara el diagnóstico antes de atribuirla a un cambio de entorno.

## Referencia del respaldo de Windows

La guía original, su inventario y el restaurador siguen conservados en el
[commit de traslado `1100fdc`](https://github.com/gonhercaral-cpu/desarrollo-proyectos/tree/1100fdc0e741a5b2e94710c6a44fd8aba5746140).
Allí están `docs/traslado-mac-20261106.json` y `scripts/restaurar-ramas-mac.py`;
no forman parte de este cambio de portabilidad. Se preservaron 28 puntas de
ramas y 10 snapshots. El snapshot `14-active-classroom-release-1-0-18`, con
830 eliminaciones, es un respaldo de limpieza y no debe fusionarse.

Los archivos privados se revisan fuera del repositorio y se combinan
selectivamente. Conserva las preferencias actuales de la Mac; no reemplaces su
configuración personal completa ni traslades tokens, sesiones, llaveros o cachés
de Windows. `.orquestacion/`, `.firebase/cli-config`, `.env` y artefactos locales
permanecen ignorados. No publiques el respaldo privado, transcripciones ni datos
de emuladores. `gemini_worker.py` es un auxiliar histórico y no sustituye al CLI
Antigravity usado actualmente.
