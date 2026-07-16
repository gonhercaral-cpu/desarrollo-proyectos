import EditorialIcon from "../EditorialIcon";
import EditorialZoomControls from "./EditorialZoomControls";

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
  async function handleImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await actions.addImageFile(file).catch(() => {});
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
        <button type="button" onClick={actions.addShape} title="Agregar rectángulo"><EditorialIcon name="rectangle" /></button>
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
