import { useEffect, useState } from "react";
import { listAllowedDriveDepartmentFolders } from "../../../services/driveService";
import { EDITORIAL_PRINT_OPTIONS } from "../../utils/editorialPrintPayload";

// Fase 7 — Diálogo de integraciones operativas: guardar exportación en Nube AES
// (Drive vía Cloud Functions) o enviar PDF de imprenta a Imprenta. Reutiliza los
// backends existentes; no llama a Google Drive desde el navegador.
export default function EditorialIntegrationsDialog({ mode, exportItem, autofill, canManage, busy, error, onClose, onSaveDrive, onSendPrint, onCreateFolder }) {
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [printForm, setPrintForm] = useState({
    requestedQuantity: 1,
    campus: "",
    color: EDITORIAL_PRINT_OPTIONS.colors[0],
    sides: EDITORIAL_PRINT_OPTIONS.sides[0],
    paper: EDITORIAL_PRINT_OPTIONS.paperSizes[0],
    finish: EDITORIAL_PRINT_OPTIONS.finishes[0],
    priority: "Normal",
    dueDate: "",
    notes: "",
  });

  useEffect(() => {
    if (mode !== "drive") return;
    let active = true;
    listAllowedDriveDepartmentFolders()
      .then((result) => { if (active) setFolders(Array.isArray(result) ? result : result?.folders || []); })
      .catch(() => { if (active) setFolders([]); });
    return () => { active = false; };
  }, [mode]);

  if (!mode) return null;

  const selectedFolder = folders.find((folder) => folder.id === folderId) || null;

  function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name || !onCreateFolder) return;
    setCreatingFolder(true);
    Promise.resolve(onCreateFolder({ name, parentId: folderId }))
      .then((created) => {
        if (created?.id) {
          setFolders((prev) => [...prev, created]);
          setFolderId(created.id);
        }
        setNewFolderName("");
      })
      .catch(() => {})
      .finally(() => setCreatingFolder(false));
  }

  return (
    <div className="editorial-dialog-layer" role="presentation">
      <button type="button" className="editorial-dialog-backdrop" aria-label="Cerrar ventana" onClick={onClose} />
      <section className="editorial-dialog editorial-integrations-dialog" role="dialog" aria-modal="true" aria-label={mode === "drive" ? "Guardar en Nube AES" : "Enviar a Imprenta"}>
        <header>
          <div>
            <span>Integraciones</span>
            <h2>{mode === "drive" ? "Guardar en Nube AES" : "Enviar a Imprenta"}</h2>
          </div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </header>

        {error && <p className="editorial-notice warning">{error}</p>}

        {mode === "drive" ? (
          <div className="editorial-production-form">
            <p className="editorial-hint">Archivo: {exportItem?.type} · {exportItem?.variant}</p>
            <label>
              Carpeta destino
              <select value={folderId} onChange={(event) => { setFolderId(event.target.value); setConfirmReplace(false); }}>
                <option value="">Selecciona una carpeta</option>
                {folders.map((folder) => (
                  <option value={folder.id} key={folder.id}>{folder.name || folder.id}</option>
                ))}
              </select>
            </label>
            {canManage && (
              <div className="editorial-inline-form">
                <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="Nueva carpeta" />
                <button type="button" disabled={creatingFolder || !newFolderName.trim()} onClick={handleCreateFolder}>
                  {creatingFolder ? "Creando…" : "Crear carpeta"}
                </button>
              </div>
            )}
            <label className="check-row">
              <input type="checkbox" checked={confirmReplace} onChange={(event) => setConfirmReplace(event.target.checked)} />
              Reemplazar si ya existe en esa carpeta
            </label>
            <footer>
              <button type="button" onClick={onClose}>Cancelar</button>
              <button
                type="button"
                className="editorial-button primary"
                disabled={busy || !folderId}
                onClick={() => onSaveDrive({ folder: selectedFolder, confirmReplace })}
              >
                {busy ? "Guardando…" : "Guardar en Drive"}
              </button>
            </footer>
          </div>
        ) : (
          <div className="editorial-production-form two-columns">
            <p className="editorial-hint wide">Documento: {autofill?.productName} · {autofill?.pages} págs</p>
            <label>
              Cantidad
              <input type="number" min="1" value={printForm.requestedQuantity} onChange={(event) => setPrintForm({ ...printForm, requestedQuantity: Number(event.target.value) })} />
            </label>
            <label>
              Plantel
              <input value={printForm.campus} onChange={(event) => setPrintForm({ ...printForm, campus: event.target.value })} placeholder="Plantel" />
            </label>
            <label>
              Color
              <select value={printForm.color} onChange={(event) => setPrintForm({ ...printForm, color: event.target.value })}>
                {EDITORIAL_PRINT_OPTIONS.colors.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <label>
              Caras
              <select value={printForm.sides} onChange={(event) => setPrintForm({ ...printForm, sides: event.target.value })}>
                {EDITORIAL_PRINT_OPTIONS.sides.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <label>
              Papel
              <select value={printForm.paper} onChange={(event) => setPrintForm({ ...printForm, paper: event.target.value })}>
                {EDITORIAL_PRINT_OPTIONS.paperSizes.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <label>
              Acabado
              <select value={printForm.finish} onChange={(event) => setPrintForm({ ...printForm, finish: event.target.value })}>
                {EDITORIAL_PRINT_OPTIONS.finishes.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <label>
              Prioridad
              <select value={printForm.priority} onChange={(event) => setPrintForm({ ...printForm, priority: event.target.value })}>
                {EDITORIAL_PRINT_OPTIONS.priorities.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <label>
              Fecha requerida
              <input type="date" value={printForm.dueDate} onChange={(event) => setPrintForm({ ...printForm, dueDate: event.target.value })} />
            </label>
            <label className="wide">
              Notas
              <input value={printForm.notes} onChange={(event) => setPrintForm({ ...printForm, notes: event.target.value })} />
            </label>
            <footer className="wide">
              <button type="button" onClick={onClose}>Cancelar</button>
              <button
                type="button"
                className="editorial-button primary"
                disabled={busy || !printForm.campus.trim() || !(printForm.requestedQuantity > 0)}
                onClick={() => onSendPrint(printForm)}
              >
                {busy ? "Enviando…" : "Crear solicitud"}
              </button>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}
