// Estabilización — capa única de comandos del editor. La barra de menús, la
// toolbar y los atajos deben ejecutar la MISMA acción para evitar handlers
// divergentes. Cada comando expone { id, label, execute, enabled, visible,
// permission, active }. Puro (sin React) para poder testearlo.

// Construye los comandos a partir del estado y los handlers reales del shell.
// `editor` = estado del editor (actions, canUndo, canRedo). `caps` = capacidades
// del usuario. `handlers` = setters/acciones del shell (no se duplican aquí).
export function buildEditorialCommands({
  editor,
  caps = {},
  editorMode = { kind: "page" },
  hasSelection = false,
  viewMode = "single",
  showRulers = true,
  handlers = {},
} = {}) {
  const actions = editor?.actions || {};
  const canEdit = Boolean(caps.edit_content);
  const isPage = editorMode?.kind === "page";
  const noEditHint = "Sin permiso de edición";
  const noSelHint = "Selecciona un elemento";

  const command = (def) => ({
    permission: null,
    enabled: true,
    visible: true,
    active: false,
    ...def,
  });

  return [
    {
      label: "Archivo",
      items: [
        command({ id: "config", label: "Configuración del proyecto", execute: handlers.openConfig }),
        command({ id: "export", label: "Exportar…", execute: handlers.openExport }),
        { separator: true },
        command({ id: "read-mode", label: "Modo lectura", permission: "view", enabled: Boolean(caps.view), execute: handlers.openReadView }),
        command({ id: "back", label: "Volver a proyectos", execute: handlers.back }),
      ],
    },
    {
      label: "Editar",
      items: [
        command({ id: "undo", label: "Deshacer", shortcut: "Ctrl+Z", enabled: Boolean(editor?.canUndo), execute: actions.undo }),
        command({ id: "redo", label: "Rehacer", shortcut: "Ctrl+Y", enabled: Boolean(editor?.canRedo), execute: actions.redo }),
        { separator: true },
        command({ id: "duplicate", label: "Duplicar", shortcut: "Ctrl+D", permission: "edit_content", enabled: hasSelection && canEdit, hint: canEdit ? noSelHint : noEditHint, execute: actions.duplicate }),
        command({ id: "delete", label: "Eliminar", shortcut: "Supr", permission: "edit_content", enabled: hasSelection && canEdit, hint: canEdit ? noSelHint : noEditHint, execute: actions.remove }),
        command({ id: "bring-front", label: "Traer al frente", permission: "edit_content", enabled: hasSelection && canEdit, hint: canEdit ? noSelHint : noEditHint, execute: () => handlers.reorderLayer?.("front") }),
        command({ id: "send-back", label: "Enviar atrás", permission: "edit_content", enabled: hasSelection && canEdit, hint: canEdit ? noSelHint : noEditHint, execute: () => handlers.reorderLayer?.("back") }),
      ],
    },
    {
      label: "Insertar",
      items: [
        command({ id: "insert-text", label: "Texto", permission: "edit_content", enabled: canEdit, hint: noEditHint, execute: actions.addText }),
        command({ id: "insert-shape", label: "Figura", permission: "edit_content", enabled: canEdit, hint: noEditHint, execute: actions.addShape }),
        command({ id: "insert-image", label: "Imagen…", permission: "edit_content", enabled: canEdit, hint: noEditHint, execute: handlers.pickImage }),
        { separator: true },
        command({ id: "insert-index", label: "Índice automático", permission: "edit_content", enabled: canEdit, hint: noEditHint, execute: handlers.openIndex }),
      ],
    },
    {
      label: "Ver",
      items: [
        command({ id: "zoom-in", label: "Acercar", execute: () => handlers.zoomBy?.(0.1) }),
        command({ id: "zoom-out", label: "Alejar", execute: () => handlers.zoomBy?.(-0.1) }),
        command({ id: "fit-page", label: "Ajustar a ventana", execute: () => handlers.fit?.("page") }),
        { separator: true },
        command({ id: "toggle-spread", label: viewMode === "facing" ? "Vista individual" : "Vista de pliego", enabled: isPage, active: viewMode === "facing", hint: "Sólo en contexto de página", execute: handlers.toggleSpread }),
        command({ id: "toggle-rulers", label: showRulers ? "Ocultar reglas" : "Mostrar reglas", active: showRulers, execute: handlers.toggleRulers }),
      ],
    },
  ];
}

// Aplana los comandos (ignora separadores) para inspección/tests.
export function flattenCommands(groups) {
  return (Array.isArray(groups) ? groups : [])
    .flatMap((group) => group.items || [])
    .filter((item) => !item.separator);
}

// Invariante de seguridad: ningún comando visible+habilitado sin `execute`.
export function findExecutableViolations(groups) {
  return flattenCommands(groups).filter((cmd) => cmd.visible && cmd.enabled && typeof cmd.execute !== "function");
}
