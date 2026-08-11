# Active Classroom: escritorio y web integrada

## Estructura importada

- `active-classroom-desktop/src/`: panel docente, vista del alumnado, controles
  de presentación, modelos, estado, estilos y puente Tauri.
- `active-classroom-desktop/src-tauri/`: ventana secundaria, pantalla completa,
  importador PPTX, permisos, iconos, fixtures y configuración Rust/Tauri.
- `active-classroom-desktop/admin-web/`: biblioteca administrativa original,
  inspector, login de demostración, ajustes y almacenamiento local.
- `active-classroom-desktop/local-library/`: catálogo y archivos locales de
  desarrollo.
- `src/active-classroom/`: módulo React integrado al sistema principal con
  sesión, Firestore y Storage compartidos.

No se copiaron artefactos regenerables: `node_modules`, `dist`,
`admin-web/dist`, `src-tauri/target`, logs ni reportes locales de editores.

## Mapa de migración

| Capacidad escritorio | Destino web | Estado |
| --- | --- | --- |
| Biblioteca Nivel / Unit | `activeClassroomFolders` | Integrada |
| Archivos de Unit | `activeClassroomResources` + Storage | Integrada |
| Administración local | Biblioteca React | Integrada parcialmente |
| Panel docente | `src/active-classroom/teacher/` | Pendiente |
| Ventana de alumnado | Ruta web/proyector | Pendiente |
| Estado sincronizado entre ventanas | Firestore o `BroadcastChannel` | Pendiente |
| Importador PPTX Rust | Function/servicio seguro o Tauri | Conservado |
| Render de diapositivas | Componente React | Pendiente |
| Pantalla secundaria nativa | Aplicación Tauri | Conservado |

## Comandos

```bash
npm run active-classroom:install
npm run active-classroom:web
npm run active-classroom:admin
npm run active-classroom:desktop
npm run active-classroom:test
npm run active-classroom:build
npm run active-classroom:admin:build
npm run active-classroom:tauri:build
```

No importar directamente `tauri-bridge.ts` dentro del frontend React: usa APIs
nativas inexistentes en navegador. Migrar primero modelos y renderizadores
puros; mantener filesystem, selector, ventanas y monitores detrás de adaptadores.
