# Digital Signage: rediseño y validación

Fecha: 13 de noviembre de 2026, America/Tijuana. Issue #29.
Base: origin/main en 157b7f8. Se conservaron los cambios posteriores al checkout inicial y los cambios locales ajenos del propietario.

## Resultado

- Biblioteca global de la organización, sin plantel al crear archivos, importar desde Nube AES o crear web, plantilla y anuncio visual. Recursos anteriores reutilizables conservando origen, rutas y referencias, sin copiar archivos.
- Editor con lista/buscador de playlists, panel central compacto, vista previa del contenido seleccionado y propiedades existentes. Identidad institucional, temas y navegación principal conservados.
- Selector visual múltiple con búsqueda, tipo, contador y prevención de incorporaciones repetidas accidentales. Duplicados anteriores conservados.
- Arrastre con indicador de inserción, botones alternativos y Alt + flechas. Identidades estables por elemento.
- Duraciones MM:SS/HH:MM:SS, 1 segundo a 24 horas. Confirmación Enter/blur y cancelación Escape. Sin escritura por carácter ni recarga del módulo.
- Cola por playlist que serializa y agrupa cambios; conserva la última edición ante errores y permite reintentar. Auditoría conservada.
- Videos nuevos con duración medida y fallback seguro. Imágenes: 10 segundos predeterminados. Duración personalizable por playlist. El reproductor corta o repite videos hasta el tiempo configurado; protege contra avances duplicados y errores atrasados.
- Campañas con planteles[] explícito/deduplicado y selección de todos los planteles de la organización. Se conservan horarios, prioridad y restricciones de dispositivos.

## Datos y seguridad

Sin migración destructiva ni borrado de documentos o archivos existentes. Assets nuevos: scope organization y plantel vacío. Items nuevos: UUID; anteriores: identidad determinista al normalizar y estable al guardar.

planteles[] es autoritativo, incluso vacío. El escalar plantel conserva el primer destino como compatibilidad básica. Las campañas anteriores sin array conservan su comportamiento hasta editarlas. Actualizaciones parciales conservan deviceIds y programación.

Firestore elimina la lectura anónima de documentos de biblioteca activos; catálogo y operaciones siguen reservados a administración. Storage restringe lectura por SDK a administradores e incluye rutas anidadas de anuncios. No se ampliaron permisos de escritura.

Se preservan URLs de descarga con token y el acceso de los reproductores vinculados mediante el mecanismo existente. No se revocan enlaces anteriores: restringir el catálogo no revoca un enlace de descarga ya compartido.

Sin cambios a módulos ajenos, dependencias, Functions, índices o infraestructura de Active Classroom.

## Participación real y procedencia

- Antigravity CLI/Gemini: consulta arquitectónica y generación de tres archivos de frontend (panel, editor y estilos). El modo de edición sin interfaz denegó comandos; Codex proporcionó contexto, recibió un artefacto textual y lo materializó en agents/gemini/issue-29-frontend. No ejecutó pruebas ni hizo commits. Parche revisado: 75127 bytes, SHA-256 ead0094497ab9deb1c288a22181a25ea37c33371f2a10847cc18fb23dc20454a.
- Claude Code: implementación real en agents/claude/issue-29-logic, ocho archivos de servicios, normalizadores, player y pruebas. Ejecutó 18 pruebas de modelos/Drive; build/lint quedaron pendientes por dependencias ausentes en su checkout. Parche revisado: 53680 bytes, SHA-256 043da4321417e12073cb4567e3a6a9fc1db3b8a11fae5b1a162e1cbef8728e09.
- Codex: contratos vinculados al Issue, revisión de parches antes de ejecutar, integración sobre main actualizado, cola, formularios y reglas. Corrigió durationSeconds, foco/Escape, estilos móvil/oscuro, sincronización de vista previa y callbacks atrasados del player. Validación y publicación a cargo de Codex.

Contratos, diagnósticos y artefactos privados permanecen en .orquestacion/, fuera de Git. Sin secretos ni transcripciones en el repositorio.

## Pruebas verificadas

- `node --test tests/digital-signage-{model,save-queue,drive-import}.test.mjs`: 21/21. Incluye datos anteriores, dispositivos, arrays vacíos, actualizaciones parciales, metadata/timeout/limpieza de video, límites y cola con fallos/reintento.
- `npm run test:rules`, exclusivamente emuladores security-rules-audit, base actual: 135/135. Accesos anónimos/no administradores bloqueados, recurso global reutilizado y rutas antiguas/anidadas de Storage.
- ESLint de todos los JS/JSX y pruebas afectados: correcto.
- `npm run lint`: ejecutado; bloqueado por typescript-eslint ausente en la configuración de Active Classroom. El checkout inicial también tenía errores previos fuera de Signage. No se alteraron esas áreas.
- `npm run build`: correcto, con advertencias existentes de tamaño de bundle e importación dinámica ineficaz.
- Chrome real y Auth/Firestore/Storage locales, proyecto ficticio demo-signage-29: imagen real sin plantel, web global, creación de playlist mediante UI, 20 assets de una vez, duración sin escrituras parciales conservando foco/scroll, Enter/valor inválido/Escape, drag 20 a posición 2, alternativa accesible y reapertura con orden/duración persistidos. Búsqueda, prevención de duplicados y contención de foco en modal verificadas.
- Ejecución final completa de UI: campaña con tres planteles editada a dos sin duplicarla. Sin excepciones JavaScript. Anchos 1680/1280/1024/768/390, sin desbordamiento horizontal. Tema oscuro verificado tras finalizar transiciones. Capturas locales con datos ficticios, fuera de Git.
- Tres players reales en Chrome sin sesión administrativa: A/B reciben campaña, C conserva fallback; orden y cambios en vivo de playlist/destinos. Video real grabado/importado repite hasta 4 segundos y respeta recorte a 1 segundo. Bucle de un único elemento y ausencia de excepciones JavaScript verificados.

Sin datos de prueba ni migraciones en producción. Nube AES se cubrió por sus pruebas existentes; no se afirma una copia remota nueva de Drive en producción.

## Publicación y límites operativos

Implementacion: commit `8255b01ed3a68b59b511b0aaff4da1723fba62d0`, PR [#30](https://github.com/gonhercaral-cpu/desarrollo-proyectos/pull/30), integrado en main como `21dcbe8134380b4b1ed00a2e7dbccf7e47e5daf0`.

El propietario confirmo directamente el despliegue a produccion despues de que la revision automatica exigiera resolver la contradiccion con AGENTS.md. Despliegue confirmado y terminado el 13 de noviembre de 2026 (America/Tijuana):

```text
firebase deploy --only firestore:rules,storage,hosting --project sistema-desarrollo-proyectos --non-interactive
```

Hosting y reglas Firestore/Storage publicados correctamente. URL: [sistema-desarrollo-proyectos.web.app](https://sistema-desarrollo-proyectos.web.app).

Verificacion posterior, exclusivamente lecturas: HTTP 200, CSP presente y SHA-256 de los archivos remotos identico a la compilacion local para `/assets/index-Bbc8fw76.js` y `/assets/index-B5p17UB7.css`. Chrome carga la aplicacion publicada y muestra el acceso de usuarios sin excepciones JavaScript. No se modificaron datos de produccion para estas pruebas.

CI del commit fuente: autorizacion de equipos/reglas Firebase y conversion Office correctas. La validacion nativa de escritorio del workflow existente seguia ejecutandose al registrar este informe; no se declara aprobada ni se publica una release de escritorio. La CI del merge vuelve a ejecutar las comprobaciones existentes. No se desplegaron Functions, indices ni otros servicios.

Las pantallas con un bundle anterior abierto deben recargar su URL de player para recibir el nuevo código, especialmente antes de usar campañas multiplantel. El escalar conserva compatibilidad básica con el primer destino; un cliente anterior no interpreta el array nuevo. No existe canal para forzar una recarga remota de esos navegadores. No se inspeccionaron dispositivos físicos instalados.

Recuperación: versión anterior de Hosting y reglas anteriores de main. Datos aditivos, referencias conservadas.
