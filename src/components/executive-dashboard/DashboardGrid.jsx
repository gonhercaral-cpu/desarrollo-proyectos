import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardWidget } from "./DashboardWidgets";
import { WidgetEditBar } from "./DashboardCustomizer";
import { DashboardIcon } from "./DashboardVisuals";
import { getCatalogItem } from "./dashboardCatalog";
import {
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_GRID_GAP,
  DASHBOARD_GRID_ROW_HEIGHT,
  getDashboardGridRows,
  packDashboardLayout,
  sameGridLayout,
  updateGridItem,
} from "./dashboardGridEngine.js";

export function DashboardGrid({ layout, editing, dashboard, data, onOpenModule, onSettings }) {
  const canvasRef = useRef(null);
  const interactionRef = useRef(null);
  const previewRef = useRef(null);
  const [interaction, setInteraction] = useState(null);
  const [previewLayout, setPreviewLayout] = useState(null);
  const renderedLayout = useMemo(() => {
    const source = editing ? layout : layout.filter((item) => item.visible !== false);
    return packDashboardLayout(source);
  }, [editing, layout]);
  const activeLayout = previewLayout || renderedLayout;
  const orderedLayout = useMemo(() => [...activeLayout].sort((left, right) => left.y - right.y || left.x - right.x), [activeLayout]);

  function startInteraction(event, widget, mode) {
    if (!editing || !canvasRef.current || window.innerWidth <= 800) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = canvasRef.current.getBoundingClientRect();
    const columnWidth = (rect.width - DASHBOARD_GRID_GAP * (DASHBOARD_GRID_COLUMNS - 1)) / DASHBOARD_GRID_COLUMNS;
    interactionRef.current = {
      id: widget.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      columnStep: columnWidth + DASHBOARD_GRID_GAP,
      rowStep: DASHBOARD_GRID_ROW_HEIGHT + DASHBOARD_GRID_GAP,
      widget,
      baseLayout: activeLayout,
      constraints: getCatalogItem(widget.type),
    };
    previewRef.current = activeLayout;
    setPreviewLayout(activeLayout);
    setInteraction({ id: widget.id, mode });
  }

  useEffect(() => {
    if (!interaction) return undefined;

    function handlePointerMove(event) {
      const current = interactionRef.current;
      if (!current) return;
      event.preventDefault();
      const columnDelta = Math.round((event.clientX - current.startX) / current.columnStep);
      const rowDelta = Math.round((event.clientY - current.startY) / current.rowStep);
      const patch = current.mode === "move"
        ? { x: current.widget.x + columnDelta, y: current.widget.y + rowDelta }
        : {
            width: current.mode.includes("e") ? current.widget.width + columnDelta : current.widget.width,
            height: current.mode.includes("s") ? current.widget.height + rowDelta : current.widget.height,
          };
      const next = updateGridItem(current.baseLayout, current.id, patch, {
        minWidth: current.constraints.minW,
        minHeight: current.constraints.minH,
      });
      if (sameGridLayout(next, previewRef.current || [])) return;
      previewRef.current = next;
      setPreviewLayout(next);
    }

    function finishInteraction() {
      const next = previewRef.current;
      const original = interactionRef.current?.baseLayout || [];
      if (next && !sameGridLayout(next, original)) dashboard.commitLayout(next);
      interactionRef.current = null;
      previewRef.current = null;
      setPreviewLayout(null);
      setInteraction(null);
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", finishInteraction, { once: true });
    window.addEventListener("pointercancel", finishInteraction, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishInteraction);
      window.removeEventListener("pointercancel", finishInteraction);
    };
  }, [dashboard, interaction]);

  const activeWidget = interaction ? activeLayout.find((item) => item.id === interaction.id) : null;
  return (
    <section
      ref={canvasRef}
      className={`ed-widget-canvas ${editing ? "is-editable" : ""} ${interaction ? "is-interacting" : ""}`}
      style={{ "--ed-grid-rows": getDashboardGridRows(activeLayout) }}
      aria-label="Widgets del dashboard"
    >
      {activeWidget && <div className="ed-grid-placeholder" style={gridStyle(activeWidget)} aria-hidden="true" />}
      {orderedLayout.map((widget) => (
        <GridWidget
          key={widget.id}
          widget={widget}
          editing={editing}
          interacting={interaction?.id === widget.id}
          dashboard={dashboard}
          data={data}
          onOpenModule={onOpenModule}
          onSettings={onSettings}
          onStartInteraction={startInteraction}
        />
      ))}
      {interaction && <div className="ed-grid-status" role="status">Ajustando a cuadrícula · {activeWidget?.width} × {activeWidget?.height}</div>}
    </section>
  );
}

function GridWidget({ widget, editing, interacting, dashboard, data, onOpenModule, onSettings, onStartInteraction }) {
  const slotRef = useRef(null);
  const [sizeMode, setSizeMode] = useState("normal");

  useEffect(() => {
    const element = slotRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const next = width < 520 || height < 280 ? "compact" : width > 820 && height > 410 ? "expanded" : "normal";
      setSizeMode((current) => current === next ? current : next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <article
      ref={slotRef}
      className={`ed-widget-slot ${widget.visible === false ? "is-hidden" : ""} ${interacting ? "is-interacting" : ""}`}
      style={gridStyle(widget)}
      data-size={sizeMode}
      data-widget-type={widget.type}
    >
      {editing && (
        <WidgetEditBar
          widget={widget}
          onUpdate={dashboard.updateWidget}
          onRemove={dashboard.removeWidget}
          onConfigure={onSettings}
          onRestore={dashboard.restoreWidget}
          onMoveStart={(event) => onStartInteraction(event, widget, "move")}
        />
      )}
      <div className="ed-widget-content">
        {widget.visible === false ? (
          <button type="button" className="ed-hidden-widget" onClick={() => dashboard.updateWidget(widget.id, { visible: true })}>
            <DashboardIcon name="plus" />Mostrar {widget.title || widget.type}
          </button>
        ) : (
          <DashboardWidget widget={widget} data={data} onOpenModule={onOpenModule} onUpdateWidget={dashboard.updateWidget} />
        )}
      </div>
      {editing && widget.visible !== false && <>
        <button type="button" className="ed-resize-handle is-east" aria-label="Cambiar ancho" onPointerDown={(event) => onStartInteraction(event, widget, "resize-e")} />
        <button type="button" className="ed-resize-handle is-south" aria-label="Cambiar alto" onPointerDown={(event) => onStartInteraction(event, widget, "resize-s")} />
        <button type="button" className="ed-resize-handle is-corner" aria-label="Cambiar ancho y alto" onPointerDown={(event) => onStartInteraction(event, widget, "resize-es")} />
      </>}
    </article>
  );
}

function gridStyle(widget) {
  return {
    gridColumn: `${widget.x + 1} / span ${widget.width}`,
    gridRow: `${widget.y + 1} / span ${widget.height}`,
  };
}
