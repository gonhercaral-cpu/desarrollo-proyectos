import { useState } from "react";

export default function EditorialDesignDialog({ dialog, busy, error, onClose, onSubmit }) {
  const [values, setValues] = useState(() => dialog?.values || {});

  if (!dialog) return null;

  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="editorial-dialog-layer">
      <button type="button" className="editorial-dialog-backdrop" onClick={onClose} aria-label="Cerrar" />
      <form className="editorial-dialog editorial-design-dialog" onSubmit={(event) => { event.preventDefault(); onSubmit(values); }}>
        <header><div><span className="editorial-eyebrow">Sistema de diseño</span><h2>{dialog.title}</h2></div></header>
        <div className="editorial-structure-form">
          {dialog.fields?.includes("name") && <label>Nombre<input autoFocus value={values.name || ""} onChange={(event) => update("name", event.target.value)} required /></label>}
          {dialog.fields?.includes("key") && <label>Clave<input autoFocus value={values.key || ""} onChange={(event) => update("key", event.target.value.replace(/\s+/g, "."))} required /></label>}
          {dialog.fields?.includes("description") && <label>Descripción<textarea value={values.description || ""} onChange={(event) => update("description", event.target.value)} rows="3" /></label>}
          {dialog.fields?.includes("category") && <label>Categoría<input value={values.category || "General"} onChange={(event) => update("category", event.target.value)} /></label>}
          {dialog.fields?.includes("side") && <label>Lado<select value={values.side || "any"} onChange={(event) => update("side", event.target.value)}><option value="any">Cualquiera</option><option value="left">Izquierda</option><option value="right">Derecha</option></select></label>}
          {dialog.fields?.includes("type") && <label>Tipo<select value={values.type || "page"} onChange={(event) => update("type", event.target.value)}><option value="page">Página</option><option value="unit">Unidad</option><option value="section">Sección</option><option value="document">Documento</option></select></label>}
          {dialog.fields?.includes("visibility") && <label>Alcance<select value={values.visibility || "project"} onChange={(event) => update("visibility", event.target.value)}><option value="project">Privada del proyecto</option>{dialog.allowInstitutional && <option value="institutional">Institucional</option>}</select></label>}
          {dialog.fields?.includes("value") && <label>Valor<input value={values.value || ""} onChange={(event) => update("value", event.target.value)} /></label>}
          {dialog.fields?.includes("replacement") && <label>Destino<select value={values.replacement || "unlink"} onChange={(event) => update("replacement", event.target.value)}><option value="unlink">Desvincular instancias</option>{dialog.options?.map((option) => <option value={option.id} key={option.id}>Reasignar a {option.name}</option>)}</select></label>}
          {dialog.fields?.includes("pages") && <fieldset className="editorial-design-page-picker"><legend>Páginas</legend>{dialog.options?.map((option) => <label key={option.id}><input type="checkbox" checked={(values.pageIds || []).includes(option.id)} onChange={(event) => update("pageIds", event.target.checked ? [...(values.pageIds || []), option.id] : (values.pageIds || []).filter((id) => id !== option.id))} /> {option.name}</label>)}</fieldset>}
          {dialog.fields?.includes("styleProperties") && <div className="editorial-design-style-fields">{dialog.styleType === "text" && <><label>Fuente<input value={values.properties?.fontFamily || "Arial"} onChange={(event) => update("properties", { ...(values.properties || {}), fontFamily: event.target.value })} /></label><label>Tamaño<input type="number" min="1" value={values.properties?.fontSize || 16} onChange={(event) => update("properties", { ...(values.properties || {}), fontSize: Number(event.target.value) })} /></label><label>Peso<select value={values.properties?.fontWeight || "normal"} onChange={(event) => update("properties", { ...(values.properties || {}), fontWeight: event.target.value })}><option value="normal">Normal</option><option value="bold">Negrita</option></select></label><label>Color<input type="color" value={values.properties?.fill || "#142033"} onChange={(event) => update("properties", { ...(values.properties || {}), fill: event.target.value })} /></label><label>Alineación<select value={values.properties?.align || "left"} onChange={(event) => update("properties", { ...(values.properties || {}), align: event.target.value })}><option value="left">Izquierda</option><option value="center">Centro</option><option value="right">Derecha</option><option value="justify">Justificar</option></select></label><label>Interlineado<input type="number" step="0.1" value={values.properties?.lineHeight || 1.2} onChange={(event) => update("properties", { ...(values.properties || {}), lineHeight: Number(event.target.value) })} /></label><label>Espaciado<input type="number" value={values.properties?.letterSpacing || 0} onChange={(event) => update("properties", { ...(values.properties || {}), letterSpacing: Number(event.target.value) })} /></label></>}{dialog.styleType === "shape" && <><label>Relleno<input type="color" value={values.properties?.fill || "#e2f0ff"} onChange={(event) => update("properties", { ...(values.properties || {}), fill: event.target.value })} /></label><label>Borde<input type="color" value={values.properties?.borderColor || "#1677eb"} onChange={(event) => update("properties", { ...(values.properties || {}), borderColor: event.target.value })} /></label><label>Grosor<input type="number" min="0" value={values.properties?.borderWidth || 0} onChange={(event) => update("properties", { ...(values.properties || {}), borderWidth: Number(event.target.value) })} /></label><label>Radio<input type="number" min="0" value={values.properties?.cornerRadius || 0} onChange={(event) => update("properties", { ...(values.properties || {}), cornerRadius: Number(event.target.value) })} /></label><label>Opacidad<input type="number" min="0" max="1" step="0.05" value={values.properties?.opacity ?? 1} onChange={(event) => update("properties", { ...(values.properties || {}), opacity: Number(event.target.value) })} /></label></>}</div>}
          {dialog.fields?.includes("confirm") && <p className="editorial-design-warning">{dialog.message}</p>}
          {error && <p className="editorial-dialog-error" role="alert">{error}</p>}
        </div>
        <footer><button type="button" className="editorial-button secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" className={`editorial-button ${dialog.danger ? "danger" : "primary"}`} disabled={busy}>{busy ? "Procesando…" : dialog.submitLabel || "Guardar"}</button></footer>
      </form>
    </div>
  );
}
