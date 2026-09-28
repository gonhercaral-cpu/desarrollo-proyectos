import { useEffect, useRef, useState } from "react";
import { getDriveRootSettings, listDriveFolder } from "../../services/driveService";
import { getDriveResourceKind } from "../utils/driveResources";
import { formatResourceDate, getResourceKindLabel } from "../utils/resourceTypes";

export default function DriveResourceImportDialog({ unit, resources, onImport, onClose, acceptFile, selectionLimit }) {
  const dialogRef = useRef(null);
  const [path, setPath] = useState([]);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState(null);
  const [retry, setRetry] = useState(0);
  const [importedIds, setImportedIds] = useState([]);
  const folderId = path.at(-1)?.id || "";
  const existingIds = new Set([
    ...resources.filter((resource) => resource.folderId === unit.id).map((resource) => resource.driveFileId),
    ...importedIds,
  ]);

  useEffect(() => {
    dialogRef.current.showModal();
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (!folderId) {
          const settings = await getDriveRootSettings();
          if (!settings?.rootFolderId) throw new Error("Configura una carpeta raíz en Nube AES antes de importar.");
          if (active) setPath([{ id: settings.rootFolderId, name: "Nube AES" }]);
          return;
        }
        const result = await listDriveFolder(folderId);
        if (active) { setItems(result.files || []); setLoading(false); }
      } catch (loadError) {
        if (active) { setError(loadError.message || "No se pudo abrir la carpeta."); setLoading(false); }
      }
    }
    void load();
    return () => { active = false; };
  }, [folderId, retry]);

  function navigate(nextPath) {
    setPath(nextPath);
    setLoading(true);
    setItems([]);
    setError("");
    setSearch("");
  }

  function toggle(file) {
    setSelected((current) => current.some((item) => item.id === file.id)
      ? current.filter((item) => item.id !== file.id)
      : selectionLimit === 1 ? [file] : [...current, file]);
  }

  async function submit(event) {
    event.preventDefault();
    if (saving || selected.length === 0) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await onImport(selected, unit.id, setProgress);
      const failedIds = new Set(result.failed.map(({ file }) => file.id));
      setImportedIds((current) => [...current, ...selected.filter((file) => !failedIds.has(file.id)).map((file) => file.id)]);
      setSelected(result.failed.map(({ file }) => file));
      const repeated = result.imported.filter((resource) => resource.alreadyImported).length;
      setNotice(`${result.imported.length - repeated} recurso(s) importado(s) a ${unit.name}.${repeated ? ` ${repeated} ya estaban importados.` : ""}`);
      setError(result.failed.map(({ file, message }) => `${file.name}: ${message}`).join("\n"));
    } catch (importError) {
      setError(importError.message || "No se pudo importar la selección.");
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  const visible = items.filter((item) => String(item.name).toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es")));

  return (
    <dialog ref={dialogRef} className="ac-drive-dialog" aria-labelledby="ac-drive-import-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}>
      <form onSubmit={submit}>
        <header className="ac-section-heading">
          <div><h2 id="ac-drive-import-title">Importar desde Nube AES</h2><p>Destino: {unit.name}. Selecciona recursos de una o varias carpetas.</p></div>
          <button type="button" className="ac-outline-button" onClick={onClose} disabled={saving} aria-label="Cerrar importador">×</button>
        </header>
        <nav className="ac-breadcrumb" aria-label="Carpetas de Nube AES">
          {path.map((folder, index) => <button key={folder.id} type="button" disabled={loading || saving || index === path.length - 1} onClick={() => navigate(path.slice(0, index + 1))}>{folder.name}</button>)}
        </nav>
        <label className="ac-drive-search">Buscar en esta carpeta<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} disabled={saving || loading} /></label>
        <div className="ac-drive-choices" aria-busy={loading}>
          {loading ? <p role="status">Cargando Nube AES...</p> : visible.map((file) => {
            const folder = file.mimeType === "application/vnd.google-apps.folder";
            const kind = getDriveResourceKind(file);
            const compatible = kind && (!acceptFile || acceptFile(file));
            if (folder) return <button className="ac-outline-button" key={file.id} type="button" disabled={saving} onClick={() => navigate([...path, { id: file.id, name: file.name }])}>▰ {file.name}</button>;
            const duplicate = existingIds.has(file.id);
            return <label key={file.id} className={`ac-drive-choice ${!compatible || duplicate ? "is-unavailable" : ""}`}>
              <input type="checkbox" checked={selected.some((item) => item.id === file.id)} disabled={saving || !compatible || duplicate} onChange={() => toggle(file)} />
              <span><strong>{file.name}</strong><small>{duplicate ? "Ya importado en esta Unit" : compatible ? getResourceKindLabel(kind, file.name) : "Formato no compatible"} · {formatResourceDate(file.modifiedTime)}</small></span>
            </label>;
          })}
          {!loading && visible.length === 0 && <p>Sin elementos en esta carpeta.</p>}
        </div>
        {selected.length > 0 && <div className="ac-drive-selection"><strong>{selected.length} seleccionado(s)</strong>{selected.map((file) => <button key={file.id} type="button" disabled={saving} onClick={() => toggle(file)} aria-label={`Quitar ${file.name}`}>{file.name} ×</button>)}</div>}
        {error && <div className="ac-error-banner ac-drive-error" role="alert">{error}<button type="button" disabled={saving || loading} onClick={() => { setError(""); setLoading(true); setRetry((value) => value + 1); }}>Recargar carpeta</button></div>}
        {notice && <p role="status">{notice}</p>}
        {progress && <p role="status">Importando {progress.completed} de {progress.total}: {progress.file.name}</p>}
        <footer className="ac-dialog-actions">
          <button type="button" className="ac-outline-button" onClick={onClose} disabled={saving}>Cerrar</button>
          <button className="ac-primary-button" disabled={saving || selected.length === 0}>{saving ? "Importando..." : `Importar${selected.length ? ` (${selected.length})` : ""}`}</button>
        </footer>
      </form>
    </dialog>
  );
}
