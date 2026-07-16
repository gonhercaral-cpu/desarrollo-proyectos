export default function VisualAdToolbar({
  mode,
  saving,
  dirty,
  draftStatus,
  canUndo,
  canRedo,
  onCancel,
  onUndo,
  onRedo,
  onSaveTemplate,
  onFullscreenPreview,
  statusLabel,
  getStatusLabel,
}) {
  const resolvedStatusLabel = statusLabel ?? getStatusLabel?.(saving, dirty, draftStatus) ?? "";

  return (
    <div className="signage-visual-editor-topbar">
      <button type="button" className="visual-outline-button" onClick={onCancel}>
        ← Volver a Biblioteca
      </button>
      <div>
        <h3>{mode === "edit" ? "Editar anuncio visual" : "Nuevo anuncio visual"}</h3>
        <span>{resolvedStatusLabel}</span>
      </div>
      <div className="signage-form-actions">
        <button type="button" className="visual-outline-button" onClick={onUndo} disabled={!canUndo || saving}>
          Deshacer
        </button>
        <button type="button" className="visual-outline-button" onClick={onRedo} disabled={!canRedo || saving}>
          Rehacer
        </button>
        <button type="button" className="visual-outline-button" onClick={onSaveTemplate} disabled={saving}>
          Guardar como plantilla
        </button>
        <button type="button" className="visual-outline-button" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="visual-outline-button" onClick={onFullscreenPreview}>
          Vista previa pantalla completa
        </button>
        <button type="submit" className="visual-primary-button" disabled={saving}>
          Guardar anuncio
        </button>
      </div>
    </div>
  );
}
