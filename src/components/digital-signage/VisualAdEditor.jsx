import {
  clampDecimal,
  clampNumber,
  compareVisualAdElements,
} from "../../utils/digitalSignage";
import VisualAdCanvas from "./visual-editor/VisualAdCanvas";
import VisualAdControls from "./visual-editor/VisualAdControls";
import VisualAdTemplatesPanel from "./visual-editor/VisualAdTemplatesPanel";
import VisualAdToolbar from "./visual-editor/VisualAdToolbar";
import useVisualAdEditor, {
  normalizeVisualAdDataForEditor,
} from "./visual-editor/useVisualAdEditor";

function DefaultPlantelSelect({ value, onChange }) {
  return <input value={value || ""} onChange={(event) => onChange?.(event.target.value)} />;
}

export default function VisualAdEditor({
  form: inputForm,
  saving,
  mode,
  dirty,
  draftStatus,
  backgroundPreview,
  selectedElementId,
  visualTemplates,
  canUndo,
  canRedo,
  zoom,
  onSubmit,
  onCancel,
  onSaveTemplate,
  onApplyTemplate,
  onEditTemplate,
  onToggleTemplate,
  onDeleteTemplate,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onFieldChange,
  onCanvasChange,
  onBackgroundTypeChange,
  onBackgroundChange,
  onSelectElement,
  onAddText,
  onAddImage,
  onApplyPreset,
  onAlignElement,
  onDuplicateElement,
  onLayerChange,
  onElementChange,
  onCanvasElementChange,
  onCanvasInteractionStart,
  onElementDelete,
  onElementImageReplace,
  PlantelSelect = DefaultPlantelSelect,
}) {
  const {
    previewRef,
    controlTab,
    setControlTab,
    form,
    visualTemplatesList,
    selectedElement,
    visualAdData,
    zoomPercent,
    canZoomOut,
    canZoomIn,
    statusLabel,
    openFullscreenPreview,
  } = useVisualAdEditor({
    form: inputForm,
    saving,
    dirty,
    draftStatus,
    backgroundPreview,
    selectedElementId,
    visualTemplates,
    zoom,
  });

  return (
    <form className="signage-visual-editor-focused" onSubmit={onSubmit}>
      <VisualAdToolbar
        mode={mode}
        saving={saving}
        dirty={dirty}
        draftStatus={draftStatus}
        canUndo={canUndo}
        canRedo={canRedo}
        onCancel={onCancel}
        onUndo={onUndo}
        onRedo={onRedo}
        onSaveTemplate={onSaveTemplate}
        onFullscreenPreview={openFullscreenPreview}
        statusLabel={statusLabel}
      />

      <div className="signage-visual-editor-workspace">
        <section className="signage-visual-editor-preview-area">
          <div className="signage-visual-editor-preview-header">
            <div>
              <strong>Preview 16:9</strong>
            <span>{form.title || "Anuncio sin título"}</span>
            </div>
            <div className="signage-visual-zoom-controls" aria-label="Zoom del canvas">
              <button type="button" onClick={onZoomOut} disabled={!canZoomOut}>
                Zoom -
              </button>
              <strong>{zoomPercent}%</strong>
              <button type="button" onClick={onZoomIn} disabled={!canZoomIn}>
                Zoom +
              </button>
              <button type="button" onClick={onZoomFit}>
                Ajustar
              </button>
            </div>
          </div>
          <div ref={previewRef} className="signage-visual-editor-canvas-frame">
            <div className="signage-visual-editor-viewport">
              <div className="signage-visual-editor-zoom-shell" style={{ width: `${zoomPercent}%` }}>
                <VisualAdCanvas
                  visualAdData={visualAdData}
                  selectedElementId={selectedElementId}
                  onSelectElement={onSelectElement}
                  onInteractionStart={onCanvasInteractionStart}
                  onElementMove={(elementId, updates) => {
                    onSelectElement(elementId);
                    onCanvasElementChange(elementId, updates, { history: false });
                  }}
                  className="signage-visual-editor-canvas-large"
                  emptyText="Agrega un texto para comenzar."
                />
              </div>
            </div>
          </div>
        </section>

        <VisualAdControls
          controlTab={controlTab}
          setControlTab={setControlTab}
          form={form}
          selectedElement={selectedElement}
          selectedElementId={selectedElementId}
          saving={saving}
          PlantelSelect={PlantelSelect}
          onFieldChange={onFieldChange}
          onCanvasChange={onCanvasChange}
          onBackgroundTypeChange={onBackgroundTypeChange}
          onBackgroundChange={onBackgroundChange}
          onAddText={onAddText}
          onAddImage={onAddImage}
          onApplyPreset={onApplyPreset}
          onSelectElement={onSelectElement}
          onDuplicateElement={onDuplicateElement}
          onLayerChange={onLayerChange}
          onAlignElement={onAlignElement}
          onElementChange={onElementChange}
          onElementDelete={onElementDelete}
          onElementImageReplace={onElementImageReplace}
          templatesPanel={
            <VisualAdTemplatesPanel
              visualTemplates={visualTemplatesList}
              saving={saving}
              onSaveTemplate={onSaveTemplate}
              onApplyTemplate={onApplyTemplate}
              onEditTemplate={onEditTemplate}
              onToggleTemplate={onToggleTemplate}
              onDeleteTemplate={onDeleteTemplate}
              VisualAdPreview={VisualAdPreview}
            />
          }
        />
      </div>
    </form>
  );
}

export function VisualAdPreview({
  visualAdData,
  className = "",
  mini = false,
  placeholder = "Vista no disponible",
}) {
  const data = normalizeVisualAdDataForEditor(visualAdData || {});
  const canvas = data.canvas || {};
  const elements = Array.isArray(data.elements) ? data.elements : [];
  const hasBackgroundImage = canvas.backgroundType === "image" && canvas.backgroundUrl;
  const hasContent = hasBackgroundImage || canvas.backgroundColor || elements.length > 0;
  const previewStyle = {
    backgroundColor: canvas.backgroundColor || "#0f4fc4",
  };

  if (!hasContent) {
    return (
      <div className={`signage-visual-ad-preview signage-visual-ad-preview-placeholder ${mini ? "signage-visual-ad-preview-mini" : ""} ${className}`}>
        {placeholder}
      </div>
    );
  }

  return (
    <div
      className={`signage-visual-ad-preview ${mini ? "signage-visual-ad-preview-mini" : ""} ${className}`}
      style={previewStyle}
      aria-label="Miniatura de anuncio visual"
    >
      {hasBackgroundImage && (
        <div
          className="signage-visual-ad-preview-bg"
          style={{ backgroundImage: `url("${canvas.backgroundUrl}")` }}
        />
      )}
      {[...elements].sort(compareVisualAdElements).map((element) => (
        <div
          key={element.id}
          className={[
            "signage-visual-ad-preview-element",
            element.type === "image" ? "image" : "text",
          ].join(" ")}
          style={getVisualPreviewElementStyle(element)}
        >
          {element.type === "image" ? (
            element.url ? (
              <img
                src={element.url}
                alt=""
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            ) : null
          ) : (
            element.text || ""
          )}
        </div>
      ))}
    </div>
  );
}

function getVisualPreviewElementStyle(element) {
  const baseStyle = {
    left: `${clampNumber(element.x, 0, 100, 10)}%`,
    top: `${clampNumber(element.y, 0, 100, 10)}%`,
    width: `${clampNumber(element.width, 5, 100, element.type === "image" ? 30 : 50)}%`,
    height: element.height ? `${clampNumber(element.height, 5, 100, 20)}%` : "auto",
    transform: element.rotation ? `rotate(${clampNumber(element.rotation, -180, 180, 0)}deg)` : "none",
    zIndex: clampNumber(element.zIndex, 0, 999, 1),
  };

  if (element.type === "image") {
    return {
      ...baseStyle,
      opacity: clampDecimal(element.opacity, 0, 1, 1),
      borderRadius: `${clampNumber(element.borderRadius, 0, 100, 0)}px`,
    };
  }

  const fontSize = clampNumber(element.fontSize, 12, 160, 48);

  return {
    ...baseStyle,
    color: element.color || "#ffffff",
    fontSize: `clamp(7px, ${fontSize / 18}cqw, ${fontSize}px)`,
    fontWeight: element.fontWeight === "bold" ? 900 : 500,
    textAlign: ["left", "center", "right"].includes(element.align) ? element.align : "left",
  };
}


