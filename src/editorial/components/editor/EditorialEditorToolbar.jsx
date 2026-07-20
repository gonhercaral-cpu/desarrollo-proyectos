import { useEffect, useRef, useState } from "react";
import EditorialIcon from "../EditorialIcon";
import EditorialZoomControls from "./EditorialZoomControls";
import { EDITORIAL_SHAPE_TYPES } from "../../models/editorialShapes";

export default function EditorialEditorToolbar({
  leftOpen,
  rightOpen,
  bottomOpen,
  selectedElement,
  canUndo,
  canRedo,
  zoomProps,
  actions,
  onToggleLeft,
  onToggleRight,
  onToggleBottom,
  onOpenConfig,
}) {
  const [shapesOpen, setShapesOpen] = useState(false);
  const shapesRef = useRef(null);

  useEffect(() => {
    if (!shapesOpen) return undefined;
    const onDown = (event) => { if (shapesRef.current && !shapesRef.current.contains(event.target)) setShapesOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [shapesOpen]);

  async function handleImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await actions.addImageFile(file);
    } catch (error) {
      // El estado de error ya es visible en la barra de guardado; se registra el
      // detalle técnico para diagnóstico (no se oculta el error).
      console.error("Editorial: fallo al agregar imagen", error);
    }
  }

  return (
    <div className="editorial-editor-toolbar">
      <div className="editorial-toolbar-group">
        <button type="button" className={leftOpen ? "active" : ""} onClick={onToggleLeft} title="Mostrar u ocultar panel izquierdo"><EditorialIcon name="panel" /></button>
        <button type="button" onClick={onOpenConfig} title="Configuración del proyecto"><EditorialIcon name="settings" /></button>
        <span className="editorial-toolbar-divider" />
        <button type="button" onClick={actions.undo} disabled={!canUndo} title="Deshacer"><EditorialIcon name="undo" /></button>
        <button type="button" onClick={actions.redo} disabled={!canRedo} title="Rehacer"><EditorialIcon name="redo" /></button>
        <span className="editorial-toolbar-divider" />
        <button type="button" onClick={actions.addText} title="Agregar texto"><EditorialIcon name="text" /></button>
        <div className="editorial-toolbar-shapes" ref={shapesRef}>
          <button type="button" className={shapesOpen ? "active" : ""} aria-haspopup="true" aria-expanded={shapesOpen} onClick={() => setShapesOpen((value) => !value)} title="Agregar figura"><EditorialIcon name="rectangle" /></button>
          {shapesOpen && (
            <div className="editorial-toolbar-shapes-menu" role="menu" aria-label="Figuras">
              {EDITORIAL_SHAPE_TYPES.map(([type, label]) => (
                <button type="button" role="menuitem" key={type} onClick={() => { setShapesOpen(false); actions.addShape(type); }}>{label}</button>
              ))}
            </div>
          )}
        </div>
        <label className="editorial-toolbar-file-button" title="Agregar imagen">
          <EditorialIcon name="image" />
          <input type="file" accept="image/*" onChange={handleImage} />
        </label>
        {selectedElement && (
          <>
            <span className="editorial-toolbar-divider" />
            <button type="button" onClick={actions.duplicate} title="Duplicar"><EditorialIcon name="copy" /></button>
            <button type="button" onClick={() => actions.reorderLayer(selectedElement.id, "front")} title="Traer al frente"><EditorialIcon name="arrowUp" /></button>
            <button type="button" onClick={() => actions.reorderLayer(selectedElement.id, "back")} title="Enviar atrás"><EditorialIcon name="arrowDown" /></button>
            <button type="button" onClick={() => actions.updateElement(selectedElement.id, { locked: !selectedElement.locked })} title={selectedElement.locked ? "Desbloquear" : "Bloquear"}><EditorialIcon name={selectedElement.locked ? "unlock" : "lock"} /></button>
            <button type="button" className="danger" onClick={actions.remove} title="Eliminar"><EditorialIcon name="trash" /></button>
          </>
        )}
      </div>
      <EditorialZoomControls {...zoomProps} />
      <div className="editorial-toolbar-group right">
        <button type="button" className={bottomOpen ? "active" : ""} onClick={onToggleBottom} title="Mostrar u ocultar barra inferior"><EditorialIcon name="page" /></button>
        <button type="button" className={rightOpen ? "active" : ""} onClick={onToggleRight} title="Mostrar u ocultar inspector"><EditorialIcon name="layers" /></button>
      </div>
    </div>
  );
}
