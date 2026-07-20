import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { getFitZoom } from "../../utils/editorialMeasurements";
import { measureEditorialViewport } from "../../utils/editorialViewportGeometry";
import EditorialCanvas from "./EditorialCanvas";
import EditorialInlineTextEditor from "./EditorialInlineTextEditor";
import EditorialRulers from "./EditorialRulers";

const EditorialWorkspace = forwardRef(function EditorialWorkspace({
  metrics,
  zoom,
  unit = "in",
  viewMode,
  showRulers,
  guideSettings,
  spreadSlots,
  onZoomChange,
  onSelectPage,
  onSelectElement,
  onChangeElement,
  onAcademicDrop,
  readOnly = false,
}, ref) {
  const workspaceRef = useRef(null);
  const scrollContentRef = useRef(null);
  const spreadRef = useRef(null);
  const activeSlotRef = useRef(null);
  const frameRef = useRef(0);
  const [workspaceNode, setWorkspaceNode] = useState(null);
  const [editingId, setEditingId] = useState("");
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [geometry, setGeometry] = useState(null);
  const facing = viewMode === "facing" && spreadSlots.length > 1;
  const activeSlot = spreadSlots.find((slot) => slot.active) || null;
  const editingElement = editingId ? (activeSlot?.elements || []).find((element) => element.id === editingId) || null : null;

  const activeStageNode = useCallback(() => activeSlotRef.current?.querySelector(".konvajs-content") || activeSlotRef.current?.querySelector("canvas")?.parentElement || null, []);

  const updateGeometry = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const next = measureEditorialViewport({ workspace: workspaceRef.current, page: activeStageNode(), scale: zoom });
      setGeometry(next);
    });
  }, [activeStageNode, zoom]);

  useEffect(() => {
    if (!workspaceNode) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
      updateGeometry();
    });
    observer.observe(workspaceNode);
    window.addEventListener("resize", updateGeometry);
    updateGeometry();
    return () => {
      cancelAnimationFrame(frameRef.current);
      observer.disconnect();
      window.removeEventListener("resize", updateGeometry);
    };
  }, [workspaceNode, updateGeometry]);

  useEffect(() => { updateGeometry(); }, [activeSlot?.page?.id, facing, spreadSlots, updateGeometry, zoom]);

  const getEditingRect = useCallback(() => {
    const node = activeStageNode();
    const metricsForSlot = activeSlot?.metrics || metrics;
    if (!node || !editingElement) return null;
    const box = node.getBoundingClientRect();
    return {
      left: box.left + (metricsForSlot.bleed + editingElement.x) * zoom,
      top: box.top + (metricsForSlot.bleed + editingElement.y) * zoom,
      width: Math.max(40, editingElement.width * zoom),
      height: Math.max(24, editingElement.height * zoom),
    };
  }, [activeSlot?.metrics, activeStageNode, editingElement, metrics, zoom]);

  function commitEditing(id, content) {
    setEditingId("");
    if (typeof content === "string" && content !== editingElement?.content) onChangeElement(id, { content });
  }

  useImperativeHandle(ref, () => ({
    fit(mode) {
      const contentStyle = scrollContentRef.current ? getComputedStyle(scrollContentRef.current) : null;
      const spreadStyle = spreadRef.current ? getComputedStyle(spreadRef.current) : null;
      const insets = contentStyle ? {
        left: Number.parseFloat(contentStyle.paddingLeft) || 0,
        right: Number.parseFloat(contentStyle.paddingRight) || 0,
        top: Number.parseFloat(contentStyle.paddingTop) || 0,
        bottom: Number.parseFloat(contentStyle.paddingBottom) || 0,
      } : {};
      onZoomChange(getFitZoom({
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        metrics,
        facing,
        mode,
        insets,
        spreadGap: Number.parseFloat(spreadStyle?.columnGap || spreadStyle?.gap) || 0,
        spreadMetrics: spreadSlots.map((slot) => slot.metrics),
      }));
    },
  }), [facing, metrics, onZoomChange, spreadSlots, viewport.height, viewport.width]);

  function handleWheel(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    onZoomChange(zoom + (event.deltaY < 0 ? 0.1 : -0.1));
  }

  const setWorkspace = useCallback((node) => {
    workspaceRef.current = node;
    setWorkspaceNode(node);
  }, []);

  return (
    <main ref={setWorkspace} className="editorial-canvas-workspace" onScroll={updateGeometry} onWheel={handleWheel} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-editorial-academic")) event.preventDefault(); }} onDrop={(event) => {
      const raw = event.dataTransfer.getData("application/x-editorial-academic");
      if (!raw) return;
      event.preventDefault();
      try { onAcademicDrop?.(JSON.parse(raw)); } catch { /* payload externo inválido */ }
    }}>
      {showRulers && <EditorialRulers geometry={geometry} page={activeSlot?.page} metrics={activeSlot?.metrics || metrics} unit={unit} />}
      <div ref={scrollContentRef} className={`editorial-canvas-scroll-content ${facing ? "facing" : "single"}`}>
        <div ref={spreadRef} className="editorial-page-spread">
          {spreadSlots.map((slot, index) => (
            <div
              key={slot.page?.id || `blank-${index}`}
              ref={slot.active ? activeSlotRef : undefined}
              className={`editorial-konva-page ${slot.active ? "active" : ""} ${slot.page ? "real" : "blank"}`}
              aria-label={slot.page ? `${slot.page.name}${slot.active ? ", página editable" : ", seleccionar página"}` : "Página vacía del pliego"}
              role={slot.page && !slot.active ? "button" : undefined}
              tabIndex={slot.page && !slot.active ? 0 : undefined}
              onClick={slot.page && !slot.active ? () => onSelectPage(slot.page.id) : undefined}
              onKeyDown={slot.page && !slot.active ? (event) => { if (event.key === "Enter" || event.key === " ") onSelectPage(slot.page.id); } : undefined}
            >
              <EditorialCanvas
                metrics={slot.metrics}
                zoom={zoom}
                elements={slot.elements}
                backgroundElements={slot.backgroundElements}
                backgroundImage={slot.backgroundImage}
                selectedElement={slot.active ? slot.selectedElement : null}
                selectedIds={slot.active ? slot.selectedIds : []}
                guideSettings={guideSettings}
                background={slot.background || slot.page?.background}
                interactive={slot.active && !readOnly}
                editingId={slot.active ? editingId : ""}
                onSelect={slot.active ? onSelectElement : () => {}}
                onChange={slot.active ? onChangeElement : () => {}}
                onStartEdit={slot.active ? setEditingId : undefined}
              />
              {slot.page && <span className="editorial-canvas-page-state">{slot.numberLabel || "Sin número"} · {slot.page.name}</span>}
            </div>
          ))}
          {facing && guideSettings?.gutter && <span className="editorial-spread-gutter" aria-hidden="true" />}
        </div>
      </div>
      {editingElement && <EditorialInlineTextEditor key={editingElement.id} element={editingElement} zoom={zoom} getScreenRect={getEditingRect} onCommit={commitEditing} onCancel={() => setEditingId("")} />}
    </main>
  );
});

export default EditorialWorkspace;
