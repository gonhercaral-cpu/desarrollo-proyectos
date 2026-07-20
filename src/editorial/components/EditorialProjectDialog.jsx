import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_EDITORIAL_CONFIG,
  EDITORIAL_PROJECT_TYPES,
  PAGE_SIZE_PRESETS,
  getEditorialProjectConfig,
  getOrientedDimensions,
} from "../models/editorialModels";
import { EDITORIAL_UNITS, convertUnit } from "../utils/editorialUnitConversion";
import { physicalSizeChanged } from "../utils/editorialDocumentSizing";
import EditorialIcon from "./EditorialIcon";

const MARGIN_FIELDS = [["top", "Superior"], ["right", "Derecho"], ["bottom", "Inferior"], ["left", "Izquierdo"]];
const UNIT_STEPS = { in: 0.01, cm: 0.01, mm: 0.1, px: 1, pt: 0.5 };

function displayValue(inches, unit) {
  return Number(convertUnit(inches, "in", unit).toFixed(unit === "px" ? 2 : 4));
}

export default function EditorialProjectDialog({ open, title, submitLabel, initialProject, nameOnly = false, busy = false, error = "", onClose, onSubmit }) {
  const initialConfig = useMemo(() => initialProject ? getEditorialProjectConfig(initialProject) : DEFAULT_EDITORIAL_CONFIG, [initialProject]);
  const [form, setForm] = useState(() => ({ ...initialConfig, margins: { ...initialConfig.margins } }));

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event) { if (event.key === "Escape" && !busy) onClose(); }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;
  const sizeChanged = physicalSizeChanged(initialConfig, form);
  const step = UNIT_STEPS[form.unit] || 0.01;

  function updateField(field, value) { setForm((current) => ({ ...current, [field]: value })); }
  function updatePhysical(field, value) { setForm((current) => ({ ...current, [field]: Math.max(0, convertUnit(Number(value), current.unit, "in")) })); }
  function updateMargin(field, value) {
    setForm((current) => ({ ...current, margins: { ...current.margins, [field]: Math.max(0, convertUnit(Number(value), current.unit, "in")) } }));
  }
  function updateSize(size) {
    setForm((current) => {
      if (size === "custom") return { ...current, size };
      return { ...current, size, ...getOrientedDimensions({ ...current, size }) };
    });
  }
  function updateOrientation(orientation) {
    setForm((current) => ({ ...current, orientation, ...getOrientedDimensions({ ...current, orientation }) }));
  }
  function handleSubmit(event) { event.preventDefault(); onSubmit(form); }

  return (
    <div className="editorial-dialog-layer" role="presentation">
      <button type="button" className="editorial-dialog-backdrop" aria-label="Cerrar ventana" onClick={busy ? undefined : onClose} />
      <section className="editorial-dialog editorial-document-config-dialog" role="dialog" aria-modal="true" aria-labelledby="editorial-dialog-title">
        <header><div><span className="editorial-eyebrow">Editor Editorial</span><h2 id="editorial-dialog-title">{title}</h2></div><button type="button" className="editorial-icon-button" onClick={onClose} disabled={busy} aria-label="Cerrar"><EditorialIcon name="close" /></button></header>
        <form onSubmit={handleSubmit}>
          <label className="editorial-field editorial-field-wide"><span>Nombre</span><input autoFocus value={form.name} maxLength={120} onChange={(event) => updateField("name", event.target.value)} placeholder="Ej. Explore A2 · Libro del alumno" required /></label>
          {!nameOnly && (
            <>
              <div className="editorial-form-grid">
                <label className="editorial-field"><span>Tipo de proyecto</span><select value={form.type} onChange={(event) => updateField("type", event.target.value)}>{EDITORIAL_PROJECT_TYPES.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}</select></label>
                <label className="editorial-field"><span>Tamaño</span><select value={form.size} onChange={(event) => updateSize(event.target.value)}>{PAGE_SIZE_PRESETS.map((size) => <option value={size.value} key={size.value}>{size.label}</option>)}</select></label>
                <label className="editorial-field"><span>Unidad</span><select value={form.unit} onChange={(event) => updateField("unit", event.target.value)}>{EDITORIAL_UNITS.map((unit) => <option value={unit.value} key={unit.value}>{unit.label}</option>)}</select></label>
              </div>
              <div className="editorial-form-grid">
                <label className="editorial-field"><span>Ancho</span><input type="number" min={step} step={step} value={displayValue(form.widthIn, form.unit)} disabled={form.size !== "custom"} onChange={(event) => updatePhysical("widthIn", event.target.value)} required /></label>
                <label className="editorial-field"><span>Alto</span><input type="number" min={step} step={step} value={displayValue(form.heightIn, form.unit)} disabled={form.size !== "custom"} onChange={(event) => updatePhysical("heightIn", event.target.value)} required /></label>
              </div>
              <fieldset className="editorial-segment-field"><legend>Orientación</legend><div><label><input type="radio" name="orientation" value="portrait" checked={form.orientation === "portrait"} onChange={(event) => updateOrientation(event.target.value)} />Vertical</label><label><input type="radio" name="orientation" value="landscape" checked={form.orientation === "landscape"} onChange={(event) => updateOrientation(event.target.value)} />Horizontal</label></div></fieldset>
              <fieldset className="editorial-margins-fieldset"><legend>Márgenes ({form.unit})</legend><div className="editorial-margin-grid">{MARGIN_FIELDS.map(([field, label]) => <label className="editorial-field" key={field}><span>{label}</span><input type="number" min="0" step={step} value={displayValue(form.margins[field], form.unit)} onChange={(event) => updateMargin(field, event.target.value)} required /></label>)}</div></fieldset>
              <label className="editorial-field editorial-bleed-field"><span>Sangrado ({form.unit})</span><input type="number" min="0" step={step} value={displayValue(form.bleedIn, form.unit)} onChange={(event) => updatePhysical("bleedIn", event.target.value)} required /></label>
              {initialProject && sizeChanged && (
                <fieldset className="editorial-resize-strategy"><legend>El tamaño físico cambiará</legend><p>Elige tratamiento del contenido existente. No se escala automáticamente.</p><label><input type="radio" name="resizeMode" value="preserve" checked={form.resizeMode === "preserve"} onChange={(event) => updateField("resizeMode", event.target.value)} />Mantener posición absoluta</label><label><input type="radio" name="resizeMode" value="scale" checked={form.resizeMode === "scale"} onChange={(event) => updateField("resizeMode", event.target.value)} />Escalar contenido proporcionalmente</label><label><input type="radio" name="resizeMode" value="center" checked={form.resizeMode === "center"} onChange={(event) => updateField("resizeMode", event.target.value)} />Centrar contenido</label></fieldset>
              )}
            </>
          )}
          {error && <p className="editorial-form-error" role="alert">{error}</p>}
          <footer><button type="button" className="editorial-button secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" className="editorial-button primary" disabled={busy || !form.name.trim()}>{busy ? "Guardando…" : submitLabel}</button></footer>
        </form>
      </section>
    </div>
  );
}
