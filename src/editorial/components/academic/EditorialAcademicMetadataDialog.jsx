import { useState } from "react";
import { ACADEMIC_TYPE_OPTIONS, normalizeAcademicMetadata } from "../../models/editorialAcademic";

const FIELDS = [
  ["seriesId", "ID de serie"], ["seriesName", "Nombre de serie"],
  ["levelId", "ID de nivel"], ["levelName", "Nombre de nivel"],
  ["bookId", "ID de libro"], ["bookName", "Nombre de libro"],
  ["unitNumber", "Número de unidad", "number"], ["unitTitle", "Título de unidad"],
  ["lessonNumber", "Número de lección", "number"], ["lessonTitle", "Título de lección"],
  ["activityNumber", "Número de actividad", "number"],
];

export default function EditorialAcademicMetadataDialog({ dialog, busy, error, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    ...normalizeAcademicMetadata(dialog?.values),
    academicType: dialog?.values?.academicType || "",
    target: dialog?.target || "page",
    name: dialog?.name || "",
  }));
  if (!dialog) return null;
  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }));

  return (
    <div className="editorial-dialog-layer">
      <button type="button" className="editorial-dialog-backdrop" onClick={onClose} aria-label="Cerrar" />
      <form className="editorial-dialog editorial-academic-dialog" onSubmit={(event) => { event.preventDefault(); onSubmit(values); }}>
        <header><div><span className="editorial-eyebrow">Estructura académica</span><h2>{dialog.title || "Vinculación académica"}</h2></div></header>
        <div className="editorial-structure-form">
          {dialog.kind === "related" && <label>Nombre del material<input autoFocus value={values.name} onChange={(event) => update("name", event.target.value)} required /></label>}
          {dialog.allowTarget && <label>Aplicar a<select value={values.target} onChange={(event) => update("target", event.target.value)}><option value="project">Proyecto</option><option value="document">Documento</option><option value="section">Sección actual</option><option value="page">Página actual</option></select></label>}
          <label>Tipo académico<select value={values.academicType} onChange={(event) => update("academicType", event.target.value)}>{ACADEMIC_TYPE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <div className="editorial-academic-field-grid">
            {FIELDS.map(([key, label, type = "text"]) => <label key={key}>{label}<input type={type} min={type === "number" ? 0 : undefined} value={values[key] ?? ""} onChange={(event) => update(key, type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)} /></label>)}
          </div>
          <p className="editorial-design-warning">Los campos son opcionales. Cambiar el vínculo no copia ni modifica contenido.</p>
          {error && <p className="editorial-dialog-error" role="alert">{error}</p>}
        </div>
        <footer><button type="button" className="editorial-button secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" className="editorial-button primary" disabled={busy || (dialog.kind === "related" && !values.name.trim())}>{busy ? "Guardando…" : dialog.kind === "related" ? "Crear y vincular" : "Guardar vínculo"}</button></footer>
      </form>
    </div>
  );
}
