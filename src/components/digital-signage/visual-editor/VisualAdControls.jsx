import {
  PUBLISH_STATUS_OPTIONS,
  getPublishStatus,
} from "../../../utils/digitalSignage";

export default function VisualAdControls({
  controlTab,
  setControlTab,
  form,
  selectedElement,
  selectedElementId,
  PlantelSelect,
  onFieldChange,
  onCanvasChange,
  onBackgroundTypeChange,
  onBackgroundChange,
  onAddText,
  onAddImage,
  onApplyPreset,
  onSelectElement,
  onDuplicateElement,
  onLayerChange,
  onAlignElement,
  onElementChange,
  onElementDelete,
  onElementImageReplace,
  templatesPanel,
}) {
  return (
    <aside className="signage-visual-editor-sidepanel">
      <div className="signage-visual-editor-control-tabs">
        {[
          ["general", "General"],
          ["background", "Fondo"],
          ["texts", "Textos"],
          ["style", "Estilo"],
          ["templates", "Plantillas"],
        ].map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={controlTab === key ? "active" : ""}
            onClick={() => setControlTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="signage-visual-editor-scroll-panel">
        {controlTab === "general" && (
          <section className="signage-visual-editor-section">
            <h4>Datos generales</h4>
            <div className="digital-form-grid">
              <label>
                Título
                <input value={form.title} onChange={(event) => onFieldChange("title", event.target.value)} placeholder="Ej. Anuncio recepción" required />
              </label>
              <label>
                Plantel
                <PlantelSelect value={form.plantel} onChange={(value) => onFieldChange("plantel", value)} />
              </label>
              <label>
                Duración seg.
                <input type="number" min="1" max="3600" value={form.durationSeconds} onChange={(event) => onFieldChange("durationSeconds", event.target.value)} />
              </label>
              <label className="digital-checkbox-label">
                <input type="checkbox" checked={form.active} onChange={(event) => onFieldChange("active", event.target.checked)} />
                Activo
              </label>
              <label>
                Publicación
                <select value={getPublishStatus(form.publishStatus)} onChange={(event) => onFieldChange("publishStatus", event.target.value)}>
                  {PUBLISH_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        )}

        {controlTab === "background" && (
          <section className="signage-visual-editor-section">
            <h4>Fondo</h4>
            <div className="signage-visual-controls">
              <label>
                Tipo de fondo
                <select value={form.visualAdData.canvas.backgroundType} onChange={(event) => onBackgroundTypeChange(event.target.value)}>
                  <option value="solid">Color sólido</option>
                  <option value="image">Imagen</option>
                </select>
              </label>
              <label>
                Color de fondo
                <input type="color" value={form.visualAdData.canvas.backgroundColor} onChange={(event) => onCanvasChange({ backgroundColor: event.target.value })} />
              </label>
              {form.visualAdData.canvas.backgroundType === "image" && (
                <label className="digital-full-field">
                  Imagen de fondo
                  <input type="file" accept="image/*" onChange={(event) => onBackgroundChange(event.target.files?.[0] || null)} />
                </label>
              )}
              {form.visualAdData.canvas.backgroundType === "image" && (
                <button type="button" className="visual-outline-button digital-full-field" onClick={() => onBackgroundTypeChange("solid")}>
                  Quitar imagen de fondo
                </button>
              )}
            </div>
          </section>
        )}

        {controlTab === "texts" && (
          <section className="signage-visual-editor-section">
            <div className="signage-section-title-row">
              <h4>Elementos de texto</h4>
              <button type="button" className="visual-outline-button" onClick={onAddText}>
                Agregar texto
              </button>
            </div>
            <label className="visual-outline-button signage-visual-file-button">
              Agregar imagen
              <input type="file" accept="image/*" onChange={(event) => onAddImage(event.target.files?.[0] || null)} />
            </label>
            <div className="signage-visual-preset-grid">
              <button type="button" onClick={() => onApplyPreset("center-title")}>Título grande centrado</button>
              <button type="button" onClick={() => onApplyPreset("title-subtitle")}>Título + subtítulo</button>
              <button type="button" onClick={() => onApplyPreset("image-left")}>Imagen izquierda + texto derecha</button>
              <button type="button" onClick={() => onApplyPreset("urgent")}>Aviso urgente</button>
              <button type="button" onClick={() => onApplyPreset("coffee")}>Promoción Coffee Beans</button>
            </div>
            <div className="signage-visual-elements-list signage-visual-element-list">
              {form.visualAdData.elements.length === 0 && <p className="digital-empty">Sin elementos agregados.</p>}
              {form.visualAdData.elements.map((element, index) => (
                <div
                  key={element.id}
                  className={`signage-visual-element-list-row ${element.id === selectedElementId ? "active" : ""}`}
                >
                  <button type="button" onClick={() => onSelectElement(element.id)}>
                    <span>{index + 1}</span>
                    <strong>{getVisualAdElementLabel(element)}</strong>
                    {element.locked === true && <em className="signage-visual-locked-badge">Bloqueado</em>}
                  </button>
                  <button type="button" className="visual-outline-button" onClick={() => onDuplicateElement(element)}>
                    Duplicar
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {controlTab === "style" && (
          <section className="signage-visual-editor-section">
            <h4>Propiedades del texto</h4>
            {selectedElement ? (
              <>
                <div className="signage-visual-layer-actions">
                  <button type="button" className="visual-outline-button" onClick={() => onDuplicateElement(selectedElement)}>
                    Duplicar
                  </button>
                  <button type="button" className="visual-outline-button" onClick={() => onLayerChange(1)}>
                    Traer adelante
                  </button>
                  <button type="button" className="visual-outline-button" onClick={() => onLayerChange(-1)}>
                    Enviar atrás
                  </button>
                </div>
                <div className="signage-visual-align-actions">
                  <button type="button" className="visual-outline-button" onClick={() => onAlignElement("left")}>Izquierda</button>
                  <button type="button" className="visual-outline-button" onClick={() => onAlignElement("center-x")}>Centro H</button>
                  <button type="button" className="visual-outline-button" onClick={() => onAlignElement("right")}>Derecha</button>
                  <button type="button" className="visual-outline-button" onClick={() => onAlignElement("top")}>Arriba</button>
                  <button type="button" className="visual-outline-button" onClick={() => onAlignElement("center-y")}>Centro V</button>
                  <button type="button" className="visual-outline-button" onClick={() => onAlignElement("bottom")}>Abajo</button>
                </div>
                <VisualAdElementControls
                  element={selectedElement}
                  onChange={onElementChange}
                  onDelete={onElementDelete}
                  onImageReplace={onElementImageReplace}
                />
              </>
            ) : (
              <p className="digital-empty">Selecciona o agrega un texto.</p>
            )}
          </section>
        )}

        {controlTab === "templates" && templatesPanel}
      </div>
    </aside>
  );
}

function VisualAdElementControls({ element, onChange, onDelete, onImageReplace }) {
  if (element.type === "image") {
    return (
      <div className="signage-visual-controls signage-visual-element-panel">
        <label className="digital-checkbox-label digital-full-field">
          <input type="checkbox" checked={element.locked === true} onChange={(event) => onChange({ locked: event.target.checked })} />
          Bloquear elemento
        </label>
        <label>
          X
          <input type="range" min="0" max="100" value={element.x} onChange={(event) => onChange({ x: event.target.value })} />
          <span>{element.x}%</span>
        </label>
        <label>
          Y
          <input type="range" min="0" max="100" value={element.y} onChange={(event) => onChange({ y: event.target.value })} />
          <span>{element.y}%</span>
        </label>
        <label>
          Ancho
          <input type="range" min="5" max="100" value={element.width} onChange={(event) => onChange({ width: event.target.value })} />
          <span>{element.width}%</span>
        </label>
        <label>
          Opacidad
          <input type="range" min="0" max="1" step="0.05" value={element.opacity ?? 1} onChange={(event) => onChange({ opacity: event.target.value })} />
          <span>{Math.round((Number(element.opacity ?? 1)) * 100)}%</span>
        </label>
        <label>
          Radio borde
          <input type="range" min="0" max="100" value={element.borderRadius || 0} onChange={(event) => onChange({ borderRadius: event.target.value })} />
          <span>{element.borderRadius || 0}px</span>
        </label>
        <label className="digital-full-field">
          Reemplazar imagen
          <input type="file" accept="image/*" onChange={(event) => onImageReplace(event.target.files?.[0] || null)} />
        </label>
        <button type="button" className="danger-table-button" onClick={onDelete}>
          Eliminar imagen
        </button>
      </div>
    );
  }

  return (
    <div className="signage-visual-controls signage-visual-element-panel">
      <label className="digital-checkbox-label digital-full-field">
        <input type="checkbox" checked={element.locked === true} onChange={(event) => onChange({ locked: event.target.checked })} />
        Bloquear elemento
      </label>
      <label className="digital-full-field">
        Texto
        <textarea value={element.text} onChange={(event) => onChange({ text: event.target.value })} rows="2" />
      </label>
      <label>
        X
        <input type="range" min="0" max="100" value={element.x} onChange={(event) => onChange({ x: event.target.value })} />
        <span>{element.x}%</span>
      </label>
      <label>
        Y
        <input type="range" min="0" max="100" value={element.y} onChange={(event) => onChange({ y: event.target.value })} />
        <span>{element.y}%</span>
      </label>
      <label>
        Ancho
        <input type="range" min="5" max="100" value={element.width} onChange={(event) => onChange({ width: event.target.value })} />
        <span>{element.width}%</span>
      </label>
      <label>
        Tamaño
        <input type="number" min="12" max="160" value={element.fontSize} onChange={(event) => onChange({ fontSize: event.target.value })} />
      </label>
      <label>
        Color
        <input type="color" value={element.color} onChange={(event) => onChange({ color: event.target.value })} />
      </label>
      <label>
        Alineación
        <select value={element.align} onChange={(event) => onChange({ align: event.target.value })}>
          <option value="left">Izquierda</option>
          <option value="center">Centro</option>
          <option value="right">Derecha</option>
        </select>
      </label>
      <label className="digital-checkbox-label">
        <input type="checkbox" checked={element.fontWeight === "bold"} onChange={(event) => onChange({ fontWeight: event.target.checked ? "bold" : "normal" })} />
        Negrita
      </label>
      <button type="button" className="danger-table-button" onClick={onDelete}>
        Eliminar texto
      </button>
    </div>
  );
}

function getVisualAdElementLabel(element) {
  if (element?.type === "image") return "Imagen";
  const text = String(element?.text || "").trim();
  if (!text) return "Texto";
  return `Texto: ${text.slice(0, 28)}${text.length > 28 ? "..." : ""}`;
}
