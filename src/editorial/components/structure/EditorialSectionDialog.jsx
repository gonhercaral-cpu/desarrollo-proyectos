import { useState } from "react";
import { EDITORIAL_SECTION_TYPES, NUMBERING_MODES, NUMBERING_STYLES } from "../../models/editorialStructure";
import EditorialIcon from "../EditorialIcon";

export default function EditorialSectionDialog({ open, section, initialType, busy, error, onClose, onSubmit }) {
  const [name, setName] = useState(section?.name || (initialType === "unit" ? "Nueva unidad" : initialType === "chapter" ? "Nuevo capítulo" : "Nueva sección"));
  const [type, setType] = useState(section?.type || initialType || "custom");
  const [numberingStyle, setNumberingStyle] = useState(section?.numberingStyle || "arabic");
  const [numberingMode, setNumberingMode] = useState(section?.numberingMode || "continue");
  const [numberingStart, setNumberingStart] = useState(section?.numberingStart || 1);
  const [startOnRight, setStartOnRight] = useState(section?.startOnRight || false);
  if (!open) return null;

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({ name, type, numberingStyle, numberingMode, numberingStart, startOnRight });
  }

  return (
    <div className="editorial-dialog-layer">
      <button type="button" className="editorial-dialog-backdrop" onClick={busy ? undefined : onClose} aria-label="Cerrar diálogo de sección" />
      <form className="editorial-dialog editorial-structure-dialog" onSubmit={handleSubmit}>
        <header><div><span className="editorial-eyebrow">Estructura editorial</span><h2>{section ? "Editar sección" : "Crear sección"}</h2></div><button type="button" className="editorial-icon-button" onClick={onClose}><EditorialIcon name="close" /></button></header>
        <div className="editorial-structure-form two-columns">
          <label className="full"><span>Nombre</span><input value={name} onChange={(event) => setName(event.target.value)} required autoFocus /></label>
          <label><span>Tipo</span><select value={type} onChange={(event) => setType(event.target.value)}>{EDITORIAL_SECTION_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span>Numeración</span><select value={numberingStyle} onChange={(event) => setNumberingStyle(event.target.value)}>{NUMBERING_STYLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          {numberingStyle !== "none" && <><label><span>Secuencia</span><select value={numberingMode} onChange={(event) => setNumberingMode(event.target.value)}>{NUMBERING_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label><span>Inicio</span><input type="number" min="1" value={numberingStart} onChange={(event) => setNumberingStart(event.target.value)} disabled={numberingMode !== "restart"} /></label></>}
          <label className="full checkbox"><input type="checkbox" checked={startOnRight} onChange={(event) => setStartOnRight(event.target.checked)} /> Iniciar sección en página derecha</label>
          {error && <p className="editorial-form-error full" role="alert">{error}</p>}
        </div>
        <footer><button type="button" className="editorial-button secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" className="editorial-button primary" disabled={busy}>{busy ? "Guardando…" : "Guardar sección"}</button></footer>
      </form>
    </div>
  );
}
