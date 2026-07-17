import { useState } from "react";
import EditorialIcon from "../EditorialIcon";

export default function EditorialStructureDeleteDialog({ target, pages, sections, busy, error, onClose, onConfirm }) {
  const isSection = target?.kind === "section";
  const sectionPages = isSection ? pages.filter((page) => page.sectionId === target.item.id) : [];
  const [mode, setMode] = useState(sectionPages.length ? "move" : "delete");
  const [targetSectionId, setTargetSectionId] = useState("");
  if (!target) return null;

  return (
    <div className="editorial-dialog-layer">
      <button type="button" className="editorial-dialog-backdrop" onClick={busy ? undefined : onClose} aria-label="Cancelar eliminación" />
      <section className="editorial-dialog editorial-confirm-dialog editorial-structure-delete" role="alertdialog" aria-modal="true">
        <header><div><span className="editorial-danger-icon"><EditorialIcon name="trash" /></span><h2>Eliminar {isSection ? "sección" : "página"}</h2></div></header>
        <p><strong>{target.item.name}</strong>. {isSection && sectionPages.length ? `Contiene ${sectionPages.length} página(s).` : "Acción irreversible."}</p>
        {isSection && sectionPages.length > 0 && <div className="editorial-delete-options"><label><input type="radio" checked={mode === "move"} onChange={() => setMode("move")} /> Mover páginas</label>{mode === "move" && <select value={targetSectionId} onChange={(event) => setTargetSectionId(event.target.value)}><option value="">Sin sección</option>{sections.filter((section) => section.id !== target.item.id).map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select>}<label><input type="radio" checked={mode === "delete"} onChange={() => setMode("delete")} /> Eliminar páginas</label></div>}
        {!isSection && pages.length === 1 && <p className="editorial-form-error">No puede eliminarse la última página.</p>}
        {error && <p className="editorial-form-error" role="alert">{error}</p>}
        <footer><button type="button" className="editorial-button secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="editorial-button danger" onClick={() => onConfirm({ mode, targetSectionId })} disabled={busy || (!isSection && pages.length === 1)}>{busy ? "Eliminando…" : "Eliminar"}</button></footer>
      </section>
    </div>
  );
}
