# Active Classroom web

Módulo administrativo integrado al Sistema de Desarrollo de Proyectos. Reutiliza autenticación, perfil y rol `admin` del sistema; no conserva login demostrativo ni almacenamiento local del prototipo original.

## Arquitectura

```text
Dashboard (admin)
  -> ActiveClassroomModule (carga diferida)
     -> componentes de Biblioteca / Publicaciones / Equipos / Ajustes
     -> useActiveClassroomLibrary
        -> activeClassroomService
           -> Firestore: activeClassroomFolders
           -> Firestore: activeClassroomResources
           -> Storage: active-classroom/resources/{resourceId}/{fileName}
```

- `src/active-classroom/components/`: vistas y controles aislados.
- `src/active-classroom/hooks/`: sincronización y estado de interfaz.
- `src/active-classroom/services/`: único punto de acceso Firebase.
- `src/active-classroom/utils/`: clasificación y formato de recursos.
- `src/active-classroom/styles/`: estilos responsive y dark mode del módulo.

Al primer acceso administrador se completan `Nivel 1` a `Nivel 5` y `Unit 01` a `Unit 16` dentro de cada Nivel. Nunca se sobrescribe una carpeta existente. La inicialización guarda primero los cinco Niveles y después lotes de 16 Units por Nivel; así respeta el límite de 20 lecturas de reglas por solicitud de varias escrituras.

## Permisos

- Administradores activos: leen y administran carpetas, recursos y binarios.
- Perfiles activos no administradores: leen estructura y recursos publicados.
- Borradores: solo administradores.
- Archivos permitidos: presentaciones, documentos, PDF, hojas de cálculo, imágenes, audio y video; máximo 250 MB.
- Frontend no abre listeners ni ejecuta inicialización hasta tener UID, perfil activo y rol `admin` normalizado.

Las reglas viven en `firestore.rules` y `storage.rules`. El URL de descarga no se persiste en Firestore; se obtiene desde Storage cuando un usuario autorizado abre el Inspector.

## Alcance actual

Biblioteca, niveles/Units, búsqueda, filtros, lista/cuadrícula, carga, drag-and-drop, preview, descarga, publicación, eliminación, Publicaciones, Equipos y Ajustes están integrados. Panel de anuncios, Observaciones y Sugerencias permanecen marcados como futuros porque prototipo original solo tenía navegación visual para esas secciones.

Aplicación docente Tauri original no fue modificada. Su adaptador local debe reemplazarse por lectura Firebase autenticada para consumir `activeClassroomFolders` y una consulta a `activeClassroomResources` con `published == true`.

## Validación

```sh
npm run test:active-classroom
npm run build
npm run lint
npm run test:rules
```

`npm run lint` revisa repositorio completo y puede reportar deuda previa fuera de este módulo. Para validar solo integración:

```sh
npx eslint src/active-classroom tests/active-classroom-utils.test.mjs
```

## Despliegue

Esta integración cambia Hosting, reglas de Firestore y reglas de Storage. No agrega Functions ni índices compuestos.

```sh
npm run build
firebase deploy --only firestore:rules,storage,hosting
```

Para desplegar reglas sin publicar frontend:

```sh
firebase deploy --only firestore:rules,storage
```
