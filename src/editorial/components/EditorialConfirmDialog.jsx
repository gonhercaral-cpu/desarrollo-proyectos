import EditorialIcon from "./EditorialIcon";

export default function EditorialConfirmDialog({ open, project, busy, error, onClose, onConfirm }) {
  if (!open || !project) return null;

  return (
    <div className="editorial-dialog-layer" role="presentation">
      <button type="button" className="editorial-dialog-backdrop" aria-label="Cancelar eliminación" onClick={busy ? undefined : onClose} />
      <section className="editorial-dialog editorial-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="editorial-delete-title">
        <header>
          <div>
            <span className="editorial-danger-icon"><EditorialIcon name="trash" /></span>
            <h2 id="editorial-delete-title">Eliminar proyecto</h2>
          </div>
        </header>
        <p>Se eliminarán <strong>{project.name}</strong>, sus documentos, páginas, elementos y archivos editoriales. Acción irreversible.</p>
        {error && <p className="editorial-form-error" role="alert">{error}</p>}
        <footer>
          <button type="button" className="editorial-button secondary" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="editorial-button danger" onClick={onConfirm} disabled={busy}>{busy ? "Eliminando…" : "Eliminar definitivamente"}</button>
        </footer>
      </section>
    </div>
  );
}
