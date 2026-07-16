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
  elements,
  selectedElement,
  onZoomChange,
  onSelect,
  onChange,
}, ref) {
  const workspaceRef = useRef(null);
  const [viewport, setViewport] = useState(() => ({
    width: Math.max(600, window.innerWidth - 590),
    height: Math.max(420, window.innerHeight - 290),
  }));
  const facing = viewMode === "facing";

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
      }));
    },
  }), [facing, metrics, onZoomChange, viewport.height, viewport.width]);

  function handleWheel(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    onZoomChange(zoom + (event.deltaY < 0 ? 0.1 : -0.1));
  }

  return (
    <main ref={setWorkspaceNode} className="editorial-canvas-workspace" onWheel={handleWheel}>
      <div className={`editorial-canvas-scroll-content ${facing ? "facing" : "single"} ${showRulers ? "with-rulers" : ""}`}>
        {showRulers && <EditorialRulers metrics={metrics} zoom={zoom} facing={facing} />}
        <div className="editorial-page-spread">
          {facing && (
            <div className="editorial-konva-page blank" aria-label="Página enfrentada de referencia">
              <EditorialCanvas
                metrics={metrics}
                zoom={zoom}
                elements={[]}
                selectedElement={null}
                guideSettings={guideSettings}
                interactive={false}
                onSelect={() => {}}
                onChange={() => {}}
              />
            </div>
          )}
          <div className="editorial-konva-page active" aria-label="Página editable">
            <EditorialCanvas
              metrics={metrics}
              zoom={zoom}
              elements={elements}
              selectedElement={selectedElement}
              guideSettings={guideSettings}
              onSelect={onSelect}
              onChange={onChange}
            />
          </div>
          {facing && guideSettings.gutter && <span className="editorial-spread-gutter" aria-hidden="true" />}
        </div>
      </div>
    </main>
  );
});

export default EditorialWorkspace;
