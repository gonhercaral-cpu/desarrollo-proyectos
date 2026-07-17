import { useState } from "react";
import EditorialIcon from "../EditorialIcon";

export default function EditorialPageDialog({ open, mode, page, sections, defaults, busy, error, onClose, onSubmit }) {
  const [name, setName] = useState(page?.name || defaults?.name || "Nueva página");
  const [sectionId, setSectionId] = useState(page?.sectionId || defaults?.sectionId || "");
  const [isBlank, setIsBlank] = useState(page?.isBlank || false);
  const [numberingEnabled, setNumberingEnabled] = useState(page?.numberingEnabled !== false);
  if (!open) return null;

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({ name, sectionId, isBlank, numberingEnabled });
  }

  return (
    <div className="editorial-dialog-layer">
      <button type="button" className="editorial-dialog-backdrop" onClick={busy ? undefined : onClose} aria-label="Cerrar diálogo de página" />
      <form className="editorial-dialog editorial-structure-dialog" onSubmit={handleSubmit}>
        <header><div><span className="editorial-eyebrow">Estructura editorial</span><h2>{mode === "rename" ? "Renombrar página" : "Crear página"}</h2></div><button type="button" className="editorial-icon-button" onClick={onClose}><EditorialIcon name="close" /></button></header>
        <div className="editorial-structure-form">
          <label><span>Nombre</span><input value={name} onChange={(event) => setName(event.target.value)} required autoFocus /></label>
          {mode !== "rename" && <label><span>Sección</span><select value={sectionId} onChange={(event) => setSectionId(event.target.value)}><option value="">Sin sección</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>}
          {mode !== "rename" && <div className="editorial-structure-checks"><label><input type="checkbox" checked={isBlank} onChange={(event) => setIsBlank(event.target.checked)} /> Página en blanco</label><label><input type="checkbox" checked={numberingEnabled} onChange={(event) => setNumberingEnabled(event.target.checked)} /> Mostrar numeración</label></div>}
          {error && <p className="editorial-form-error" role="alert">{error}</p>}
        </div>
        <footer><button type="button" className="editorial-button secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" className="editorial-button primary" disabled={busy}>{busy ? "Guardando…" : mode === "rename" ? "Guardar nombre" : "Crear página"}</button></footer>
      </form>
    </div>
  );
}
