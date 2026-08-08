import {
  PUBLISH_STATUS_OPTIONS,
  VISUAL_TEMPLATE_CATEGORIES,
} from "../../utils/digitalSignage";

export default function DriveImportModal({
  open,
  files,
  folders,
  folderId,
  breadcrumbs,
  search,
  type,
  loading,
  saving,
  selectedFiles,
  progress,
  form,
  error,
  assets,
  onClose,
  onSearchChange,
  onTypeChange,
  onSearch,
  onOpenFolder,
  onBackFolder,
  onBreadcrumbClick,
  onSelectFile,
  onFormChange,
  onSubmit,
  SignageIcon,
  PlantelSelect,
}) {
  if (!open) return null;

  const selected = Array.isArray(selectedFiles) ? selectedFiles : [];
  const selectedIds = new Set(selected.map((file) => file.id));

  return (
    <div className="signage-drive-import-backdrop" role="dialog" aria-modal="true" aria-label="Importar desde Nube AES">
      <div className="signage-drive-import-modal">
        <header className="signage-drive-import-header">
          <div>
            <span>Nube AES</span>
            <h3>Importar desde Nube AES</h3>
            <p>Selecciona uno o varios archivos. Digital Signage los copiará a Storage antes de registrarlos.</p>
          </div>
          <button type="button" className="drive-preview-close" onClick={onClose} disabled={saving} aria-label="Cerrar">
            <SignageIcon name="close" />
          </button>
        </header>

        <div className="signage-drive-import-layout">
          <section className="signage-drive-import-browser">
            <div className="signage-drive-folder-bar">
              <button
                type="button"
                className="visual-outline-button"
                onClick={onBackFolder}
                disabled={loading || saving || breadcrumbs.length <= 1}
              >
                Volver
              </button>
              <div className="signage-drive-breadcrumbs" aria-label="Ruta de carpeta Nube AES">
                {breadcrumbs.length === 0 ? (
                  <span>Sin carpeta seleccionada</span>
                ) : (
                  breadcrumbs.map((breadcrumb, index) => (
                    <button
                      type="button"
                      key={`${breadcrumb.id}-${index}`}
                      onClick={() => onBreadcrumbClick(index)}
                      disabled={loading || breadcrumb.id === folderId}
                    >
                      {breadcrumb.name || "Carpeta"}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="signage-drive-folder-list">
              {!loading && folders.length === 0 && folderId && (
                <span>Sin subcarpetas en esta ubicación.</span>
              )}
              {folders.map((folder) => (
                <button
                  type="button"
                  key={folder.id}
                  onClick={() => onOpenFolder(folder)}
                  disabled={loading || saving}
                >
                  <SignageIcon name="folder" />
                  <span>{folder.name || "Carpeta sin nombre"}</span>
                </button>
              ))}
            </div>

            <form className="signage-drive-import-search" onSubmit={onSearch}>
              <label>
                Buscar dentro de carpeta
                <input
                  type="search"
                  value={search}
                  onChange={(event) => onSearchChange(event.target.value)}
                  placeholder="Nombre del archivo..."
                  disabled={!folderId}
                />
              </label>
              <label>
                Tipo
                <select value={type} onChange={(event) => onTypeChange(event.target.value)} disabled={!folderId}>
                  <option value="imagenes">Imágenes</option>
                  <option value="videos">Videos</option>
                </select>
              </label>
              <button type="submit" className="visual-outline-button" disabled={loading || saving}>
                {loading ? "Cargando..." : "Buscar"}
              </button>
            </form>

            <div className="signage-drive-import-list">
              {loading && <p className="digital-empty">Cargando carpeta de Nube AES...</p>}
              {!loading && !folderId && (
                <p className="digital-empty">Selecciona una carpeta para buscar archivos.</p>
              )}
              {!loading && folderId && files.length === 0 && (
                <p className="digital-empty">No hay archivos compatibles en esta carpeta.</p>
              )}
              {!loading && folderId && files.map((file) => {
                const duplicate = getImportedDriveAsset(file.id, assets);
                const isSelected = selectedIds.has(file.id);

                return (
                  <button
                    type="button"
                    key={file.id}
                    className={`signage-drive-import-file ${isSelected ? "selected" : ""}`}
                    onClick={() => onSelectFile(file)}
                    disabled={saving || Boolean(duplicate)}
                    aria-pressed={isSelected}
                  >
                    <span className="signage-drive-import-file-icon">
                      <SignageIcon name={String(file.mimeType || "").startsWith("video/") ? "video" : "file"} />
                    </span>
                    <span className="signage-drive-import-file-main">
                      <strong>{file.name || "Archivo sin nombre"}</strong>
                      <small>
                        {getDriveImportTypeLabel(file)} · {formatFileSize(file.size)} · {formatDriveFileDate(file.modifiedTime)}
                      </small>
                    </span>
                    {duplicate && <span className="signage-soft-badge warning">Ya importado</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <form className="signage-drive-import-details" onSubmit={onSubmit}>
            <div className="signage-panel-heading compact">
              <div>
                <h3>Datos del asset</h3>
                <p>Se guardara como borrador para evitar publicación accidental.</p>
              </div>
            </div>

            {selected.length > 0 ? (
              <div className="signage-drive-selected-file">
                <strong>{selected.length === 1 ? selected[0].name || "Archivo seleccionado" : `${selected.length} archivos seleccionados`}</strong>
                <span>
                  {selected.length === 1
                    ? `${getDriveImportTypeLabel(selected[0])} · ${formatFileSize(selected[0].size)}`
                    : selected.map((file) => file.name || file.id).join(", ")}
                </span>
              </div>
            ) : (
              <p className="digital-empty">Selecciona uno o varios archivos para continuar.</p>
            )}

            {error && <div className="signage-drive-import-error">{error}</div>}
            {progress && (
              <div className="signage-drive-import-warning" role="status">
                Importando {Math.min(progress.completed + 1, progress.total)} de {progress.total}: {progress.file?.name || "archivo"}
              </div>
            )}

            <div className="digital-form-grid">
              {selected.length <= 1 && <label>
                Título
                <input
                  value={form.title}
                  onChange={(event) => onFormChange({ title: event.target.value })}
                  placeholder="Ej. Video institucional"
                  required={selected.length === 1}
                />
              </label>}
              <label>
                Plantel
                <PlantelSelect value={form.plantel} onChange={(value) => onFormChange({ plantel: value })} />
              </label>
              <label>
                Categoría
                <select value={form.category} onChange={(event) => onFormChange({ category: event.target.value })}>
                  {VISUAL_TEMPLATE_CATEGORIES.map((category) => (
                    <option key={category.value} value={category.value}>{category.label}</option>
                  ))}
                </select>
              </label>
              <label className="digital-full-field">
                Tags
                <input
                  value={form.tags}
                  onChange={(event) => onFormChange({ tags: event.target.value })}
                  placeholder="Separados por coma"
                />
              </label>
              <label>
                Publicación
                <select value={form.publishStatus} onChange={(event) => onFormChange({ publishStatus: event.target.value })}>
                  {PUBLISH_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="digital-checkbox-label">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) => onFormChange({ active: event.target.checked })}
                />
                Activo
              </label>
            </div>

            <div className="signage-form-actions">
              <button type="button" className="visual-outline-button" onClick={onClose} disabled={saving}>
                Cancelar
              </button>
              <button type="submit" className="visual-primary-button" disabled={saving || selected.length === 0}>
                {saving ? "Importando..." : `Importar contenido${selected.length > 1 ? ` (${selected.length})` : ""}`}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function getImportedDriveAsset(driveFileId, assets = []) {
  const cleanFileId = String(driveFileId || "").trim();
  if (!cleanFileId) return null;
  return assets.find((asset) => String(asset?.sourceFileId || "").trim() === cleanFileId) || null;
}

function getDriveImportTypeLabel(file) {
  const mimeType = String(file?.mimeType || "");
  if (mimeType.startsWith("video/")) return "Video";
  if (mimeType.startsWith("image/")) return "Imagen";
  return "Archivo";
}

function formatFileSize(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return "Sin tamaño";

  const units = ["B", "KB", "MB", "GB"];
  let nextSize = size;
  let unitIndex = 0;

  while (nextSize >= 1024 && unitIndex < units.length - 1) {
    nextSize /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 || nextSize >= 10 ? 0 : 1;
  return `${nextSize.toFixed(digits)} ${units[unitIndex]}`;
}

function formatDriveFileDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
