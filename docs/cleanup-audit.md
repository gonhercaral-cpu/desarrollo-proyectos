# Auditoría de depuración

Fecha de línea base: 2026-07-11  
Rama existente: `refactor/app-css-cleanup`  
Commit base: `61c74d0 Historial certificados correccion`

## Línea base

- Frontend Vite: `npm run build` correcto; 560 módulos transformados.
- Bundle inicial: CSS 1,308.32 kB; JS principal 3,909.61 kB.
- ESLint: 214 hallazgos preexistentes (180 errores y 34 avisos).
- Rules tests: no ejecutables en este equipo porque `java` no está en `PATH`.
- Sintaxis Node: `functions/index.js`, `drive/index.js` y `backend-protect/index.js` correctos.
- `src/styles/app.css`: 1,728,039 bytes, 77,054 líneas, 9,950 nodos raíz, 10,804 reglas incluyendo reglas anidadas.
- Cambio previo ajeno a esta auditoría: `.firebase/hosting.ZGlzdA.cache`; no modificar.

## Mapa de arquitectura

- Entrada web: `index.html` -> `src/main.jsx` -> `AuthProvider` + `src/App.jsx`.
- Rutas públicas: solicitud/seguimiento de certificados, validación de certificados y credenciales, reproductor de señalización.
- Ruta protegida: `Dashboard.jsx`, que conecta 18 módulos/páginas, administración de departamentos y señalización, mensajería y herramientas flotantes.
- Firebase cliente centralizado en `src/services/firebase.js`; servicios de proyectos, usuarios, notificaciones, Drive, Protect, señalización, ideas y soporte técnico dependen de este módulo.
- Backend: Functions principal (`functions/`), codebase Drive (`drive/`) y backend Docker independiente para UniFi Protect (`backend-protect/`).
- Seguridad/deploy: `firebase.json`, reglas Firestore/Storage, índices, CORS y variables de entorno.
- Grafo AST: 60 módulos JS/JSX, 133 dependencias locales, cero `import()` dinámicos y cero errores de parseo.

## Seguro de eliminar

- `src/data/catalogs.js`: huérfano del grafo; sus constantes no tienen consumidores y valores vigentes están definidos localmente donde se usan.
- `src/storageService.js`: huérfano del grafo y referencia un `./firebase` inexistente; servicio vigente es `src/services/storageService.js`.
- `src/assets/hero.png`, `src/assets/react.svg`, `src/assets/vite.svg`: recursos iniciales de Vite sin referencia estática, dinámica, CSS, HTML ni runtime.
- `public/icons.svg`: sprite inicial sin ninguna referencia `href`, `src`, CSS o runtime.
- `vite-*.log`, `vite-*.err.log`, `vite-*.out.log`: salidas locales ignoradas por Git; contienen sesiones y errores históricos de Vite, no entradas de aplicación.
- `firebase-functions-test` en `functions/` y `drive/`: dependencia de plantilla sin import, prueba ni script consumidor.

## Candidato a refactorizar

- `src/styles/app.css`: archivo monolítico con capas cronológicas y parches. Dividir por cortes de nodos raíz, preservando byte a byte el orden de cascada.
- 28 grupos de reglas textualmente duplicadas: no eliminar por coincidencia textual sola; varias viven en media queries o reafirman valores tras overrides.
- Componentes y helpers reportados por `no-unused-vars`: revisar por bloque, no borrar automáticamente porque algunos sostienen estado, suscripciones o contratos de props.
- `eslint.config.js`: no reconoce globals Node/CommonJS de los tres backends; ajustar solo configuración, sin cambiar runtime.
- Bundle JS principal: candidato futuro a lazy loading; fuera de limpieza segura porque cambia estrategia de carga.

## Dudoso o requiere revisión

- `.firebase/hosting.ZGlzdA.cache`: generado y rastreado, pero ya modificado antes de esta tarea.
- Selectores CSS sin coincidencia literal en JSX: pueden originarse en plantillas HTML, clases construidas, datos Firebase o estados runtime; conservar.
- Logs reportan errores históricos de permisos, credenciales y HMR. Su origen está identificado, pero no prueban fallos actuales.
- `backend-protect/`: no está en `firebase.json`, pero tiene Dockerfile, configuración y API consumida por `protectService.js`; conservar.
- Símbolos lint no usados dentro de archivos grandes: candidatos, no evidencia suficiente para borrado masivo.
- `dist/` y `node_modules/`: artefactos ignorados/regenerables; no forman parte del código versionado. `dist/` se regenera durante cada validación.

## Crítico y debe conservarse

- `.env`, `.env.example`, credencial local ignorada, `.firebaserc`, `firebase.json`, CORS, reglas, índices y tests de reglas.
- `public/active-logo.png` y `public/favicon.svg`: usados por HTML, CSS y múltiples flujos públicos/privados.
- Dependencias QR, PDF, ZIP, canvas y ZXing: usadas por Imprenta y Soporte Técnico. `@zxing/library` es peer requerido por `@zxing/browser`.
- Functions principal, Drive, Protect y sus lockfiles.
- Plantillas, PDFs, firmas, certificados y QR almacenados en Firebase: referencias runtime; no son archivos locales prescindibles.
- Modelo de roles y permisos (`admin`, colaborador y solicitante) en contexto, UI y reglas Firebase.

## Estrategia CSS segura

1. Tomar hash SHA-256 y métricas del archivo original.
2. Dividir únicamente entre nodos raíz completos de PostCSS; nunca dentro de selector, `@media`, keyframes o declaración.
3. Importar fragmentos en el mismo orden exacto desde `app.css`.
4. Comparar concatenación normalizada de fragmentos contra original y validar parseo.
5. Ejecutar build, lint comparativo y pruebas visuales escritorio/móvil, claro/oscuro.
6. Conservar reglas dudosas; documentar duplicados en vez de purgarlos sin cobertura visual de cada estado y rol.

## Resultado aplicado

### Archivos eliminados

- `src/data/catalogs.js`: catálogo huérfano y duplicado por constantes locales vigentes.
- `src/storageService.js`: servicio huérfano con import roto; se conserva `src/services/storageService.js`.
- `src/assets/hero.png`, `src/assets/react.svg`, `src/assets/vite.svg`: assets iniciales sin consumidores.
- `public/icons.svg`: sprite sin referencias.
- Trece archivos locales `vite-*.log`, `vite-*.err.log` y `vite-*.out.log`: logs ignorados, generados por servidores de desarrollo. Su origen y errores históricos se revisaron antes de borrarlos.

### Dependencias eliminadas

- `firebase-functions-test` de `functions/package.json` y `drive/package.json`.
- El árbol productivo no cambió: 255 paquetes en Functions y 302 en Drive, con las mismas versiones antes y después.
- Se conservaron `@zxing/library` y `@zxing/browser`: la primera satisface el peer obligatorio de la segunda.

### Código y configuración

- Tres claves duplicadas eliminadas: `assignedTo`, `checklistBase` y `marquez`. JavaScript ya ignoraba la primera aparición; el valor efectivo no cambió.
- `eslint.config.js` separa globals de navegador y Node/CommonJS. ESLint bajó de 214 a 194 hallazgos sin desactivar reglas.
- Helpers, hooks y props restantes marcados por ESLint se conservaron cuando su eliminación podía alterar orden de hooks, efectos, contratos o flujos no autenticados durante esta auditoría.

### Nueva estructura CSS

- `src/styles/app.css`: índice de 848 bytes con 16 imports ordenados.
- `src/styles/app/base/`: fundamentos y variables.
- `src/styles/app/layout/`: shell, mensajes y agenda.
- `src/styles/app/components/`: login y componentes compartidos.
- `src/styles/app/modules/`: proyectos, administración, soporte, imprenta, workflows, Drive, Protect, señalización y perfil.
- `src/styles/app/responsive/`: cierre responsive y utilidades.
- `src/styles/app/dark/`: capas de modo oscuro.
- Reducción del archivo monolítico: 1,728,039 a 848 bytes (99.95%).
- CSS funcional total conservado deliberadamente: 1,728,039 bytes en fragmentos; no se eliminó ninguna regla dudosa.
- SHA-256 del original y de fragmentos concatenados: `0a138e23fc985ccc8730db97e69ecde3ce0d8cee25b0b7fd73cac73f7eea302c`.
- Vite genera antes y después `index-C4pGaZwy.css`, 1,308.32 kB, gzip 184.01 kB.

### Validación visual y funcional

- Captura móvil 390x844 antes/después: idéntica byte a byte; sin overflow horizontal.
- Escritorio 1440x900: mismo DOM, assets y alto; cambió ancho útil de scrollbar del navegador entre capturas. CSS compilado es idéntico.
- Rutas probadas: login, solicitud y seguimiento públicos, validación de certificado, validación de credencial y reproductor de señalización.
- Ninguna imagen rota ni error de importación en esas rutas.
- Avisos observados: lectura de firmas públicas y consultas con IDs ficticios reciben `Missing or insufficient permissions`; comportamiento preexistente y coherente con reglas.
- Gates estáticos revisados en `Dashboard.jsx`: páginas administrativas, Drive, Imprenta, Soporte Técnico, Protect y señalización aplican rol/capacidad antes de renderizar.
- Rules revisadas para `admin`, `collaborator` y `requester`; suite contiene pruebas de acceso horizontal, vertical, proyectos, certificados, Drive, mensajería y Storage.

## Pendientes y riesgos conservados

- `npm run lint` sigue fallando por 194 hallazgos preexistentes (160 errores y 34 avisos), principalmente reglas React Hooks y símbolos no usados dentro de módulos grandes. Corregirlos requiere una fase funcional separada con cobertura autenticada.
- `npm run test:rules` no puede iniciar emuladores porque Java no está instalado ni disponible en `PATH`.
- Flujos autenticados reales por cada rol no pudieron operarse sin cuentas de prueba. Se validaron wiring, gates y cobertura de rules, no escrituras reales.
- Cada backend reporta 8 vulnerabilidades npm moderadas. No se ejecutó `npm audit fix` para evitar cambios automáticos de versiones.
- Bundle JS principal continúa en 3.91 MB. Lazy loading sería útil, pero cambia estrategia de carga y queda fuera de limpieza de cero regresiones.
- `.firebase/hosting.ZGlzdA.cache` conserva el cambio previo ajeno a esta auditoría.
