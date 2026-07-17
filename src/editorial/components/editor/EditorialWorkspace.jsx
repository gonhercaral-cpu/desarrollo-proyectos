import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { getFitZoom } from "../../utils/editorialMeasurements";
import EditorialCanvas from "./EditorialCanvas";
import EditorialRulers from "./EditorialRulers";

const EditorialWorkspace = forwardRef(function EditorialWorkspace({
  metrics,
  zoom,
  viewMode,
  showRulers,
  guideSettings,
  spreadSlots,
  onZoomChange,
  onSelectPage,
  onSelectElement,
  onChangeElement,
  onAcademicDrop,
}, ref) {
  const workspaceRef = useRef(null);
  const [viewport, setViewport] = useState(() => ({
    width: Math.max(600, window.innerWidth - 590),
    height: Math.max(420, window.innerHeight - 290),
  }));
  const facing = viewMode === "facing" && spreadSlots.length > 1;

  const resizeObserver = useMemo(() => new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect;
    if (rect) setViewport({ width: rect.width, height: rect.height });
  }), []);

  function setWorkspaceNode(node) {
    if (workspaceRef.current) resizeObserver.unobserve(workspaceRef.current);
    workspaceRef.current = node;
    if (node) resizeObserver.observe(node);
  }

  useImperativeHandle(ref, () => ({
    fit(mode) {
      onZoomChange(getFitZoom({
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        metrics,
        facing,
        mode,
        spreadMetrics: spreadSlots.map((slot) => slot.metrics),
      }));
    },
  }), [facing, metrics, onZoomChange, spreadSlots, viewport.height, viewport.width]);

  function handleWheel(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    onZoomChange(zoom + (event.deltaY < 0 ? 0.1 : -0.1));
  }

  return (
    <main ref={setWorkspaceNode} className="editorial-canvas-workspace" onWheel={handleWheel} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-editorial-academic")) event.preventDefault(); }} onDrop={(event) => {
      const raw = event.dataTransfer.getData("application/x-editorial-academic");
      if (!raw) return;
      event.preventDefault();
      try { onAcademicDrop?.(JSON.parse(raw)); } catch { /* payload externo inválido */ }
    }}>
      <div className={`editorial-canvas-scroll-content ${facing ? "facing" : "single"} ${showRulers ? "with-rulers" : ""}`}>
        {showRulers && <EditorialRulers metrics={metrics} zoom={zoom} facing={facing} />}
        <div className="editorial-page-spread">
          {spreadSlots.map((slot, index) => (
            <div
              key={slot.page?.id || `blank-${index}`}
              className={`editorial-konva-page ${slot.active ? "active" : ""} ${slot.page ? "real" : "blank"}`}
              aria-label={slot.page ? `${slot.page.name}${slot.active ? ", página editable" : ", seleccionar página"}` : "Página vacía del pliego"}
              role={slot.page && !slot.active ? "button" : undefined}
              tabIndex={slot.page && !slot.active ? 0 : undefined}
              onClick={slot.page && !slot.active ? () => onSelectPage(slot.page.id) : undefined}
              onKeyDown={slot.page && !slot.active ? (event) => {
                if (event.key === "Enter" || event.key === " ") onSelectPage(slot.page.id);
              } : undefined}
            >
              <EditorialCanvas
                metrics={slot.metrics}
                zoom={zoom}
                elements={slot.elements}
                backgroundElements={slot.backgroundElements}
                selectedElement={slot.active ? slot.selectedElement : null}
                selectedIds={slot.active ? slot.selectedIds : []}
                guideSettings={guideSettings}
                background={slot.background || slot.page?.background}
                interactive={slot.active}
                onSelect={slot.active ? onSelectElement : () => {}}
                onChange={slot.active ? onChangeElement : () => {}}
              />
              {slot.page && <span className="editorial-canvas-page-state">{slot.numberLabel || "Sin número"} · {slot.page.name}</span>}
            </div>
          ))}
          {facing && guideSettings.gutter && <span className="editorial-spread-gutter" aria-hidden="true" />}
        </div>
      </div>
    </main>
  );
});

export default EditorialWorkspace;
