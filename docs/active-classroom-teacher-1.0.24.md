# Active Classroom 1.0.24 — pantalla del maestro

Issue: https://github.com/gonhercaral-cpu/desarrollo-proyectos/issues/37

## Implementación y alcance

- Miniaturas reales anterior/siguiente, posición y galería accesible con selección directa. Conserva teclado configurable y proyección independiente.
- Reloj local del maestro con formato de la región del equipo, refresco alineado al minuto y limpieza al cerrar.
- Pestañas para diapositivas, recursos asociados, recursos de unidad y música; un scroll por lista. Los nodos de audio/música permanecen montados al cambiar de pestaña.
- Conserva identidad, credenciales del equipo, contenido descargado, backend y actualizador. Sin cambios en Firebase ni despliegues web.

## Delegación real y revisión

- Claude Code implementó SlideNavigator, SlideThumbnails, estilos de galería, integración inicial y pruebas. Una segunda ejecución corrigió rasterizado, límites de lectura, cancelación, timeout y fallback sin IntersectionObserver.
- Antigravity realizó la consulta de arquitectura y generó TeacherWorkspace, markup por pestañas, estilos y pruebas como parche textual. Sus intentos de edición directa se detuvieron por permisos del CLI; no se habilitaron comandos arbitrarios. El propietario autorizó expresamente compartir los tres archivos de interfaz usados como contexto.
- Codex definió contratos ligados al Issue, revisó e integró propuestas, corrigió selectores globales y detalles de layout, adaptó pruebas offline/nativas, verificó la interfaz y preparó versión/entrega.
- Contratos, diagnósticos y propuestas están en el directorio local ignorado `.orquestacion/teacher-20261117/`; no se publican transcripciones ni secretos.

## Componentes principales

Desktop: `src/player/ClassroomPlayer.ts`, `SlideNavigator.ts`, `slide-thumbnails.ts`, `slide-navigator.css`, `player.css`, `src/ui/TeacherWorkspace.ts` y `player-view.ts`. Pruebas: navegación, miniaturas, reloj/pestañas y adaptación de los casos existentes de audio, offline y layout WebKit. Versiones package/npm/Tauri/Cargo sincronizadas en 1.0.24.

## Validación local de Codex

- Base offline, sincronización/publicaciones, dispositivos, configuración y updater: 125/125.
- Player (audio, vídeo, música, GIF, atajos, miniaturas/galería): 127/127.
- Proyección: 25/25. Revelados: 9/9. Interfaz: 11/11.
- TypeScript/Vite y assets PDF.js: compilación correcta, 2/2 comprobaciones de bundle.
- Lint específico de Desktop: correcto. El lint general del repositorio falla antes de integrar por 137 errores y 37 advertencias en otros módulos; no se modifican esos módulos.
- Test de release local: tres casos de `system-media.test.mjs` fallan por el Bash 3.2 de macOS al interpretar el script de empaquetado Linux. La verificación definitiva de paquetes depende de VALIDATION en Ubuntu.
- Navegador integrado de macOS con el reproductor y PDF.js reales: PDF sintético local de 200 páginas, miniaturas 320×180, galería, Inicio/Fin/Escape, salto a página 200, recursos extensos (60 filas), reloj y pestañas. Tamaños observados: 1280×720, 1024×768, 920×640 y 1366×768; sin desbordamiento horizontal y con una sola región de scroll en la lista activa.
- Esta prueba visual no certifica GPU, sonido ni instalación física en Ubuntu/Zorin de los salones.

## Rendimiento

Renders seriales; miniaturas de hasta 320×200; un PDF auxiliar abierto; carga al entrar en pantalla, sin montar reproductores completos en cada tarjeta. La galería construye botones una vez y actualiza solo posición/selección. Caché LRU de 48 imágenes fuera de las visibles; conserva las visibles para evitar ciclos de expulsión. Revoca URLs y destruye PDF, observadores, tareas y reloj al cerrar. Límite de fuente de miniatura: 32 MiB y 40 millones de píxeles de imagen; si se supera o el archivo falla, muestra vista previa no disponible y la clase sigue funcionando. PDFs protegidos o apertura de más de 20 segundos fallan sin bloquear la cola.

## Integración, publicación y equipos

Rama de integración: `codex/teacher/issue-37`, basada en `main` actual (1.0.23). Los cambios locales ajenos de la copia original se conservaron. La validación Linux y la publicación quedan registradas a continuación cuando finalicen. No se considera un equipo actualizado sin evidencia de detección o instalación.
