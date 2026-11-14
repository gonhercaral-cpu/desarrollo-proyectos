import { useState, useRef, useEffect } from "react";
import RoomLayoutDisplay from "./RoomLayoutDisplay";
import { createRoomId } from "../../utils/digitalSignage/roomLayouts";


const EMPTY_TEMPLATE = {
    name: "Nueva Plantilla",
    version: 1,
    backgroundColor: "#0b3265",
    backgroundUrl: "",
    columns: 2,
    rows: 4,
    elements: [],
    active: true,
  };

export default function RoomLayoutTemplateEditor({
  template,
  onChange,
  onSave,
  onUploadImage,
  saving = false,
  layout = null,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [activeTab, setActiveTab] = useState("elements");

  const canvasContainerRef = useRef(null);
  const dragRef = useRef(null);

  const activeTemplate = template || EMPTY_TEMPLATE;

  const templateRef = useRef(activeTemplate);
  useEffect(() => { templateRef.current = activeTemplate; }, [activeTemplate]);

  const elements = Array.isArray(activeTemplate.elements) ? activeTemplate.elements : [];
  const selectedElement = elements.find((el) => el.id === selectedId) || null;

  function updateTemplate(partial) {
    const next = { ...templateRef.current, ...partial };
    templateRef.current = next;
    onChange(next);
  }

  function updateElement(id, partial) {
    const next = (templateRef.current.elements || []).map((el) =>
      el.id === id ? { ...el, ...partial } : el
    );
    updateTemplate({ elements: next });
  }

  function addElement(type) {
    const newId = createRoomId("element");

    let defaultEl = {
      id: newId,
      type,
      x: 10,
      y: 10,
      width: 30,
      height: 10,
      fontSize: 36,
      color: "#ffffff",
      backgroundColor: "transparent",
      align: "left",
      text: "",
      field: "classTime",
      rowIndex: 0,
      url: "",
    };

    if (type === "rect") {
      defaultEl.backgroundColor = "rgba(255, 255, 255, 0.15)";
      defaultEl.width = 80;
      defaultEl.height = 12;
    } else if (type === "image") {
      defaultEl.url = "/active-logo.png";
      defaultEl.width = 15;
      defaultEl.height = 12;
      defaultEl.align = "center";
    } else if (type === "assignments") {
      defaultEl.x = 5;
      defaultEl.y = 22;
      defaultEl.width = 90;
      defaultEl.height = 72;
      defaultEl.fontSize = 32;
    } else if (type === "text") {
      defaultEl.text = "Texto informativo";
      defaultEl.width = 40;
      defaultEl.height = 8;
    } else if (type === "field") {
      defaultEl.field = "classTime";
      defaultEl.width = 35;
      defaultEl.height = 8;
    }

    const next = [...elements, defaultEl];
    updateTemplate({ elements: next });
    setSelectedId(newId);
  }

  function removeElement(id) {
    const next = elements.filter((el) => el.id !== id);
    updateTemplate({ elements: next });
    if (selectedId === id) setSelectedId(null);
  }

  function duplicateElement(id) {
    const el = elements.find((item) => item.id === id);
    if (!el) return;
    const newId = createRoomId("element");
    const duplicated = {
      ...el,
      id: newId,
      x: Math.min(90, (el.x || 0) + 3),
      y: Math.min(90, (el.y || 0) + 3),
    };
    const next = [...elements, duplicated];
    updateTemplate({ elements: next });
    setSelectedId(newId);
  }

  function moveLayer(id, direction) {
    const index = elements.findIndex((el) => el.id === id);
    if (index < 0) return;
    const targetIndex = direction === "up" ? index + 1 : index - 1;
    if (targetIndex < 0 || targetIndex >= elements.length) return;

    const copy = [...elements];
    const [item] = copy.splice(index, 1);
    copy.splice(targetIndex, 0, item);
    updateTemplate({ elements: copy });
  }

  function handlePointerDown(e, el) {
    if (e.button !== 0 || saving || uploading) return;
    e.stopPropagation();
    setSelectedId(el.id);

    const canvas = canvasContainerRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: el.x || 0,
      origY: el.y || 0,
      width: rect.width,
      height: rect.height,
      elId: el.id,
      elWidth: el.width || 10,
      elHeight: el.height || 10,
    };

    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e) {
    if (saving || uploading || !dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    const {
      startX,
      startY,
      origX,
      origY,
      width,
      height,
      elId,
      elWidth,
      elHeight,
    } = dragRef.current;

    if (width <= 0 || height <= 0) return;

    const deltaX = ((e.clientX - startX) / width) * 100;
    const deltaY = ((e.clientY - startY) / height) * 100;

    const nextX = Math.round(Math.max(0, Math.min(100 - elWidth, origX + deltaX)));
    const nextY = Math.round(Math.max(0, Math.min(100 - elHeight, origY + deltaY)));

    updateElement(elId, { x: nextX, y: nextY });
  }

  function handlePointerUp(e) {
    if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      dragRef.current = null;
    }
  }

  async function handleFileUpload(file, targetType) {
    if (!file) return;
    const valid = ["image/png", "image/jpeg", "image/webp"];
    if (!valid.includes(file.type)) {
      setUploadError("Formato no permitido. Utiliza PNG, JPG o WebP (no se admiten archivos SVG).");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("La imagen excede el límite máximo de 10MB.");
      return;
    }

    setUploadError(null);
    setUploading(true);
    try {
      const result = await onUploadImage(file);
      if (result?.url) {
        const latest = templateRef.current;
        if (targetType === "background") {
          updateTemplate({ backgroundUrl: result.url });
        } else if (targetType === "element" && selectedId) {
          const nextElements = (latest.elements || []).map((el) =>
            el.id === selectedId ? { ...el, url: result.url } : el
          );
          updateTemplate({ elements: nextElements });
        }
      }
    } catch (err) {
      setUploadError(err?.message || "Error al subir la imagen a Storage.");
    } finally {
      setUploading(false);
    }
  }

  function handleSaveClick() {
    if (saving || uploading) return;
    onSave(templateRef.current);
  }

  return (
    <div className="signage-rooms-template-editor">
      <div className="signage-rooms-editor-stage-col">
        <div className="signage-rooms-editor-canvas-outer">
          <div
            ref={canvasContainerRef}
            className="signage-rooms-editor-canvas-container"
            onClick={(e) => {
              if (
                e.target === canvasContainerRef.current ||
                e.target.classList.contains("signage-rooms-editor-drag-layer")
              ) {
                setSelectedId(null);
              }
            }}
          >
            <RoomLayoutDisplay
              template={activeTemplate}
              layout={layout}
              className="signage-rooms-display-preview"
            />

            <div className="signage-rooms-editor-drag-layer">
              {elements.map((el) => {
                const isSelected = selectedId === el.id;
                return (
                  <div
                    key={el.id}
                    className={`signage-rooms-editor-interactor ${
                      isSelected ? "is-selected" : ""
                    }`}
                    style={{
                      left: `${el.x ?? 0}%`,
                      top: `${el.y ?? 0}%`,
                      width: `${el.width ?? 10}%`,
                      height: `${el.height ?? 10}%`,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(el.id);
                    }}
                    onPointerDown={(e) => handlePointerDown(e, el)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  >
                    {isSelected && (
                      <span className="signage-rooms-editor-interactor-tag">
                        {el.type}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="signage-rooms-editor-add-bar">
          <span className="signage-rooms-bar-label">Agregar capa:</span>
          <button
            type="button"
            className="visual-outline-button"
            disabled={uploading || saving}
            onClick={() => addElement("text")}
          >
            + Texto
          </button>
          <button
            type="button"
            className="visual-outline-button"
            disabled={uploading || saving}
            onClick={() => addElement("field")}
          >
            + Campo dinámico
          </button>
          <button
            type="button"
            className="visual-outline-button"
            disabled={uploading || saving}
            onClick={() => addElement("assignments")}
          >
            + Tarjetas salones
          </button>
          <button
            type="button"
            className="visual-outline-button"
            disabled={uploading || saving}
            onClick={() => addElement("rect")}
          >
            + Rectángulo
          </button>
          <button
            type="button"
            className="visual-outline-button"
            disabled={uploading || saving}
            onClick={() => addElement("image")}
          >
            + Imagen / Logo
          </button>
        </div>

        <div className="signage-rooms-layer-manager-box">
          <h4>Capas del diseño ({elements.length})</h4>
          <div className="signage-rooms-layer-list">
            {elements.length === 0 ? (
              <p className="signage-rooms-small-text">No hay elementos agregados aún.</p>
            ) : (
              elements.map((el, idx) => {
                const isSelected = selectedId === el.id;
                let desc = el.type;
                if (el.type === "text") desc = `"${el.text || ""}"`;
                if (el.type === "field") desc = `Campo: ${el.field}`;
                if (el.type === "image") desc = el.url ? "Imagen personalizada" : "Logo AES";
                if (el.type === "assignments") desc = "Distribución de salones";
                return (
                  <div
                    key={el.id}
                    className={`signage-rooms-layer-row ${isSelected ? "active" : ""}`}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        setSelectedId(el.id);
                      }
                    }}
                    onClick={() => setSelectedId(el.id)}
                  >
                    <span className="signage-rooms-layer-index">{idx + 1}</span>
                    <span className="signage-rooms-layer-type">{el.type}</span>
                    <span className="signage-rooms-layer-desc">{desc}</span>
                    <div
                      className="signage-rooms-layer-row-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="visual-outline-button compact"
                        disabled={idx === elements.length - 1 || uploading || saving}
                        onClick={() => moveLayer(el.id, "up")}
                        title="Subir nivel"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="visual-outline-button compact"
                        disabled={idx === 0 || uploading || saving}
                        onClick={() => moveLayer(el.id, "down")}
                        title="Bajar nivel"
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        className="visual-outline-button compact"
                        disabled={uploading || saving}
                        onClick={() => duplicateElement(el.id)}
                        title="Duplicar capa"
                      >
                        ⧉
                      </button>
                      <button
                        type="button"
                        className="visual-outline-button compact danger"
                        disabled={uploading || saving}
                        onClick={() => removeElement(el.id)}
                        title="Eliminar capa"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="signage-rooms-editor-inspector-col">
        <div className="signage-rooms-editor-tabs">
          <button
            type="button"
            className={activeTab === "elements" ? "active" : ""}
            onClick={() => setActiveTab("elements")}
          >
            Elemento ({selectedElement ? selectedElement.type : "ninguno"})
          </button>
          <button
            type="button"
            className={activeTab === "template" ? "active" : ""}
            onClick={() => setActiveTab("template")}
          >
            Lienzo y Fondo
          </button>
        </div>

        {uploadError && (
          <div className="signage-rooms-warning-banner">{uploadError}</div>
        )}

        {activeTab === "elements" && (
          <div className="signage-rooms-inspector-content">
            {selectedElement ? (
              <div className="signage-rooms-form-stack">
                <div className="signage-rooms-field-row">
                  <span className="signage-rooms-label-badge">Tipo: {selectedElement.type}</span>
                  <div className="signage-rooms-layer-controls">
                    <button
                      type="button"
                      className="visual-outline-button compact"
                      disabled={uploading || saving}
                      onClick={() => duplicateElement(selectedElement.id)}
                      title="Duplicar capa"
                    >
                      Duplicar
                    </button>
                    <button
                      type="button"
                      className="visual-outline-button compact danger"
                      disabled={uploading || saving}
                      onClick={() => removeElement(selectedElement.id)}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>

                <fieldset className="signage-rooms-fieldset">
                  <legend>Posición y Tamaño (%)</legend>
                  <div className="signage-rooms-coords-grid">
                    <label className="signage-rooms-field">
                      X (%)
                      <input
                        type="number"
                        min="0"
                        max="100"
                        disabled={uploading || saving}
                        value={selectedElement.x ?? 0}
                        onChange={(e) =>
                          updateElement(selectedElement.id, {
                            x: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                    </label>
                    <label className="signage-rooms-field">
                      Y (%)
                      <input
                        type="number"
                        min="0"
                        max="100"
                        disabled={uploading || saving}
                        value={selectedElement.y ?? 0}
                        onChange={(e) =>
                          updateElement(selectedElement.id, {
                            y: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                    </label>
                    <label className="signage-rooms-field">
                      Ancho (%)
                      <input
                        type="number"
                        min="1"
                        max="100"
                        disabled={uploading || saving}
                        value={selectedElement.width ?? 10}
                        onChange={(e) =>
                          updateElement(selectedElement.id, {
                            width: parseFloat(e.target.value) || 1,
                          })
                        }
                      />
                    </label>
                    <label className="signage-rooms-field">
                      Alto (%)
                      <input
                        type="number"
                        min="1"
                        max="100"
                        disabled={uploading || saving}
                        value={selectedElement.height ?? 10}
                        onChange={(e) =>
                          updateElement(selectedElement.id, {
                            height: parseFloat(e.target.value) || 1,
                          })
                        }
                      />
                    </label>
                  </div>
                </fieldset>

                <fieldset className="signage-rooms-fieldset">
                  <legend>Estilo y Tipografía</legend>
                  <div className="signage-rooms-coords-grid">
                    <label className="signage-rooms-field">
                      Fuente (px @1600)
                      <input
                        type="number"
                        min="12"
                        max="120"
                        disabled={uploading || saving}
                        value={selectedElement.fontSize ?? 32}
                        onChange={(e) =>
                          updateElement(selectedElement.id, {
                            fontSize: parseInt(e.target.value, 10) || 32,
                          })
                        }
                      />
                    </label>
                    <label className="signage-rooms-field">
                      Alineación
                      <select
                        disabled={uploading || saving}
                        value={selectedElement.align || "left"}
                        onChange={(e) =>
                          updateElement(selectedElement.id, { align: e.target.value })
                        }
                      >
                        <option value="left">Izquierda</option>
                        <option value="center">Centro</option>
                        <option value="right">Derecha</option>
                      </select>
                    </label>
                    <label className="signage-rooms-field">
                      Color texto
                      <input
                        type="color"
                        disabled={uploading || saving}
                        value={selectedElement.color || "#ffffff"}
                        onChange={(e) =>
                          updateElement(selectedElement.id, { color: e.target.value })
                        }
                      />
                    </label>
                    <label className="signage-rooms-field">
                      Fondo
                      <input
                        type="text"
                        disabled={uploading || saving}
                        placeholder="#000000 o transparent"
                        value={selectedElement.backgroundColor || ""}
                        onChange={(e) =>
                          updateElement(selectedElement.id, {
                            backgroundColor: e.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                </fieldset>

                {selectedElement.type === "text" && (
                  <label className="signage-rooms-field">
                    Texto libre
                    <input
                      type="text"
                      disabled={uploading || saving}
                      value={selectedElement.text || ""}
                      onChange={(e) =>
                        updateElement(selectedElement.id, { text: e.target.value })
                      }
                      placeholder="Ej. DISTRIBUCIÓN DE SALONES"
                    />
                  </label>
                )}

                {selectedElement.type === "field" && (
                  <div className="signage-rooms-coords-grid">
                    <label className="signage-rooms-field">
                      Campo dinámico
                      <select
                        disabled={uploading || saving}
                        value={selectedElement.field || "classTime"}
                        onChange={(e) =>
                          updateElement(selectedElement.id, { field: e.target.value })
                        }
                      >
                        <option value="plantel">Sucursal / Plantel</option>
                        <option value="day">Día de clase</option>
                        <option value="classTime">Horario de clase</option>
                        <option value="room">Salón de fila</option>
                        <option value="teacher">Maestro de fila</option>
                        <option value="group">Grupo de fila</option>
                      </select>
                    </label>
                    {["room", "teacher", "group"].includes(selectedElement.field) && (
                      <label className="signage-rooms-field">
                        Índice de fila (0 = primer salón)
                        <input
                          type="number"
                          min="0"
                          max="99"
                          disabled={uploading || saving}
                          value={selectedElement.rowIndex ?? 0}
                          onChange={(e) =>
                            updateElement(selectedElement.id, {
                              rowIndex: parseInt(e.target.value, 10) || 0,
                            })
                          }
                        />
                      </label>
                    )}
                  </div>
                )}

                {selectedElement.type === "image" && (
                  <div className="signage-rooms-form-stack">
                    <label className="signage-rooms-field">
                      URL de la imagen
                      <input
                        type="text"
                        disabled={uploading || saving}
                        value={selectedElement.url || ""}
                        onChange={(e) =>
                          updateElement(selectedElement.id, { url: e.target.value })
                        }
                        placeholder="/active-logo.png o URL https"
                      />
                    </label>
                    <label className="signage-rooms-field">
                      Subir imagen PNG, JPG o WebP (&le;10MB)
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={uploading || saving}
                        onChange={(e) => handleFileUpload(e.target.files?.[0], "element")}
                      />
                    </label>
                  </div>
                )}
              </div>
            ) : (
              <div className="signage-rooms-empty-hint">
                <p>Haz clic en cualquier elemento del lienzo o selecciónalo en la lista de capas para editarlo.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "template" && (
          <div className="signage-rooms-inspector-content">
            <div className="signage-rooms-form-stack">
              <label className="signage-rooms-field">
                Nombre de la plantilla
                <input
                  type="text"
                  disabled={uploading || saving}
                  value={activeTemplate.name || ""}
                  onChange={(e) => updateTemplate({ name: e.target.value })}
                  placeholder="Ej. Institucional Azul 2026"
                />
              </label>

              <div className="signage-rooms-coords-grid">
                <label className="signage-rooms-field">
                  Columnas asignaciones
                  <input
                    type="number"
                    min="1"
                    max="4"
                    disabled={uploading || saving}
                    value={activeTemplate.columns || 2}
                    onChange={(e) =>
                      updateTemplate({ columns: parseInt(e.target.value, 10) || 2 })
                    }
                  />
                </label>
                <label className="signage-rooms-field">
                  Filas asignaciones
                  <input
                    type="number"
                    min="1"
                    max="10"
                    disabled={uploading || saving}
                    value={activeTemplate.rows || 4}
                    onChange={(e) =>
                      updateTemplate({ rows: parseInt(e.target.value, 10) || 4 })
                    }
                  />
                </label>
              </div>

              <label className="signage-rooms-field">
                Color de fondo sólido
                <input
                  type="color"
                  disabled={uploading || saving}
                  value={activeTemplate.backgroundColor || "#0b3265"}
                  onChange={(e) => updateTemplate({ backgroundColor: e.target.value })}
                />
              </label>

              <label className="signage-rooms-field">
                Subir diseño de fondo (PNG/JPG/WebP &le;10MB)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploading || saving}
                  onChange={(e) => handleFileUpload(e.target.files?.[0], "background")}
                />
              </label>

              {activeTemplate.backgroundUrl && (
                <div className="signage-rooms-field-row">
                  <span className="signage-rooms-small-text">Fondo asignado</span>
                  <button
                    type="button"
                    className="visual-outline-button compact danger"
                    disabled={uploading || saving}
                    onClick={() => updateTemplate({ backgroundUrl: "" })}
                  >
                    Quitar fondo
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="signage-rooms-editor-footer">
          <button
            type="button"
            className="visual-primary-button full-width"
            disabled={saving || uploading}
            onClick={handleSaveClick}
          >
            {saving ? "Guardando plantilla…" : "Guardar Plantilla"}
          </button>
        </div>
      </div>
    </div>
  );
}
