import { useEffect, useState } from "react";
import {
  DEFAULT_EDITORIAL_CONFIG,
  EDITORIAL_PROJECT_TYPES,
  PAGE_SIZE_PRESETS,
  getEditorialProjectConfig,
} from "../models/editorialModels";
import EditorialIcon from "./EditorialIcon";

const MARGIN_FIELDS = [
  ["top", "Superior"],
  ["right", "Derecho"],
  ["bottom", "Inferior"],
  ["left", "Izquierdo"],
];

export default function EditorialProjectDialog({
  open,
  title,
  submitLabel,
  initialProject,
  nameOnly = false,
  busy = false,
  error = "",
  onClose,
  onSubmit,
}) {
  const [form, setForm] = useState(() =>
    initialProject ? getEditorialProjectConfig(initialProject) : DEFAULT_EDITORIAL_CONFIG
  );

  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape" && !busy) onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateMargin(field, value) {
    setForm((current) => ({
      ...current,
      margins: { ...current.margins, [field]: Number(value) },
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(form);
  }

  return (
    <div className="editorial-dialog-layer" role="presentation">
      <button
        type="button"
        className="editorial-dialog-backdrop"
        aria-label="Cerrar ventana"
        onClick={busy ? undefined : onClose}
      />
      <section className="editorial-dialog" role="dialog" aria-modal="true" aria-labelledby="editorial-dialog-title">
        <header>
          <div>
            <span className="editorial-eyebrow">Editor Editorial</span>
            <h2 id="editorial-dialog-title">{title}</h2>
          </div>
          <button type="button" className="editorial-icon-button" onClick={onClose} disabled={busy} aria-label="Cerrar">
            <EditorialIcon name="close" />
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <label className="editorial-field editorial-field-wide">
            <span>Nombre</span>
            <input
              autoFocus
              value={form.name}
              maxLength={120}
              onChange={(event) => updateField("name", event.target.value)}
              placeholder="Ej. Explore A2 · Libro del alumno"
              required
            />
          </label>

          {!nameOnly && (
            <>
              <div className="editorial-form-grid">
                <label className="editorial-field">
                  <span>Tipo de proyecto</span>
                  <select value={form.type} onChange={(event) => updateField("type", event.target.value)}>
                    {EDITORIAL_PROJECT_TYPES.map((type) => (
                      <option value={type.value} key={type.value}>{type.label}</option>
                    ))}
                  </select>
                </label>

                <label className="editorial-field">
                  <span>Tamaño</span>
                  <select value={form.size} onChange={(event) => updateField("size", event.target.value)}>
                    {PAGE_SIZE_PRESETS.map((size) => (
                      <option value={size.value} key={size.value}>{size.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <fieldset className="editorial-segment-field">
                <legend>Orientación</legend>
                <div>
                  <label>
                    <input type="radio" name="orientation" value="portrait" checked={form.orientation === "portrait"} onChange={(event) => updateField("orientation", event.target.value)} />
                    Vertical
                  </label>
                  <label>
                    <input type="radio" name="orientation" value="landscape" checked={form.orientation === "landscape"} onChange={(event) => updateField("orientation", event.target.value)} />
                    Horizontal
                  </label>
                </div>
              </fieldset>

              <fieldset className="editorial-margins-fieldset">
                <legend>Márgenes (pulgadas)</legend>
                <div className="editorial-margin-grid">
                  {MARGIN_FIELDS.map(([field, label]) => (
                    <label className="editorial-field" key={field}>
                      <span>{label}</span>
                      <input type="number" min="0" max="3" step="0.125" value={form.margins[field]} onChange={(event) => updateMargin(field, event.target.value)} required />
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="editorial-field editorial-bleed-field">
                <span>Sangrado (pulgadas)</span>
                <input type="number" min="0" max="1" step="0.025" value={form.bleedIn} onChange={(event) => updateField("bleedIn", Number(event.target.value))} required />
                <small>Preset editorial recomendado: 0.125 pulg.</small>
              </label>
            </>
          )}

          {error && <p className="editorial-form-error" role="alert">{error}</p>}

          <footer>
            <button type="button" className="editorial-button secondary" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="editorial-button primary" disabled={busy || !form.name.trim()}>
              {busy ? "Guardando…" : submitLabel}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
