import { useRef, useState } from "react";
import {
  clampDecimal,
  clampNumber,
  compareVisualAdElements,
} from "../../../utils/digitalSignage";

export default function VisualAdCanvas({
  visualAdData,
  selectedElementId = "",
  onSelectElement,
  onElementMove,
  onInteractionStart,
  className = "",
  emptyText = "",
}) {
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const [guide, setGuide] = useState({ vertical: false, horizontal: false });
  const canvas = visualAdData?.canvas || {};
  const elements = Array.isArray(visualAdData?.elements) ? visualAdData.elements : [];
  const style = {
    backgroundColor: canvas.backgroundColor || "#0f4fc4",
    backgroundImage:
      canvas.backgroundType === "image" && canvas.backgroundUrl
        ? `url("${canvas.backgroundUrl}")`
        : "none",
  };

  function handlePointerDown(event, element) {
    onSelectElement?.(element.id);

    if (element.locked === true) return;
    if (!onElementMove) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onInteractionStart?.();
    dragRef.current = {
      mode: "move",
      id: element.id,
      startX: event.clientX,
      startY: event.clientY,
      baseX: Number(element.x) || 0,
      baseY: Number(element.y) || 0,
      baseWidth: Number(element.width) || (element.type === "image" ? 30 : 50),
      rect,
    };
  }

  function handleResizePointerDown(event, element) {
    if (element.locked === true || !onElementMove) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSelectElement?.(element.id);
    onInteractionStart?.();
    dragRef.current = {
      mode: "resize",
      id: element.id,
      startX: event.clientX,
      startY: event.clientY,
      baseX: Number(element.x) || 0,
      baseY: Number(element.y) || 0,
      baseWidth: Number(element.width) || (element.type === "image" ? 30 : 50),
      rect,
    };
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag || !onElementMove) return;

    const deltaX = ((event.clientX - drag.startX) / drag.rect.width) * 100;
    const deltaY = ((event.clientY - drag.startY) / drag.rect.height) * 100;

    if (drag.mode === "resize") {
      const width = clampNumber(drag.baseWidth + deltaX, 5, 100, drag.baseWidth);
      const centerX = drag.baseX + width / 2;
      const nearVertical = Math.abs(centerX - 50) <= 2;
      setGuide({ vertical: nearVertical, horizontal: false });
      onElementMove(drag.id, { width });
      return;
    }

    let nextX = clampNumber(drag.baseX + deltaX, 0, 100, drag.baseX);
    let nextY = clampNumber(drag.baseY + deltaY, 0, 100, drag.baseY);
    const centerX = nextX + drag.baseWidth / 2;
    const nearVertical = Math.abs(centerX - 50) <= 2;
    const nearHorizontal = Math.abs(nextY - 50) <= 2;

    if (nearVertical) nextX = clampNumber(50 - drag.baseWidth / 2, 0, 100, nextX);
    if (nearHorizontal) nextY = 50;

    setGuide({ vertical: nearVertical, horizontal: nearHorizontal });
    onElementMove(drag.id, { x: nextX, y: nextY });
  }

  function stopDrag() {
    dragRef.current = null;
    setGuide({ vertical: false, horizontal: false });
  }

  return (
    <div
      ref={canvasRef}
      className={`signage-visual-canvas ${className}`}
      style={style}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onPointerLeave={stopDrag}
    >
      {!elements.length && emptyText && (
        <div className="signage-visual-empty-hint">{emptyText}</div>
      )}
      {guide.vertical && <span className="signage-visual-guide vertical" />}
      {guide.horizontal && <span className="signage-visual-guide horizontal" />}
      {[...elements].sort(compareVisualAdElements).map((element) => (
        <button
          type="button"
          key={element.id}
          className={[
            "signage-visual-element",
            "signage-visual-canvas-element",
            element.type === "image" ? "signage-visual-image-element" : "signage-visual-text-element",
            element.id === selectedElementId ? "selected" : "",
          ].join(" ")}
          style={getVisualElementStyle(element)}
          onPointerDown={(event) => handlePointerDown(event, element)}
          onClick={() => onSelectElement?.(element.id)}
        >
          {element.type === "image" ? (
            <img src={element.url} alt="Elemento visual" draggable="false" />
          ) : (
            element.text || "Texto"
          )}
          {element.id === selectedElementId && element.locked === true && (
            <span className="signage-visual-locked-badge canvas">Bloqueado</span>
          )}
          {element.id === selectedElementId && element.locked !== true && (
            <span
              className="signage-visual-resize-handle"
              onPointerDown={(event) => handleResizePointerDown(event, element)}
            />
          )}
        </button>
      ))}
    </div>
  );
}

function getVisualElementStyle(element) {
  if (element.type === "image") {
    return {
      left: `${clampNumber(element.x, 0, 100, 10)}%`,
      top: `${clampNumber(element.y, 0, 100, 10)}%`,
      width: `${clampNumber(element.width, 5, 100, 30)}%`,
      height: element.height ? `${clampNumber(element.height, 5, 100, 20)}%` : "auto",
      opacity: clampDecimal(element.opacity, 0, 1, 1),
      borderRadius: `${clampNumber(element.borderRadius, 0, 100, 0)}px`,
      transform: element.rotation ? `rotate(${clampNumber(element.rotation, -180, 180, 0)}deg)` : "none",
      zIndex: clampNumber(element.zIndex, 0, 999, 1),
    };
  }

  return {
    left: `${clampNumber(element.x, 0, 100, 10)}%`,
    top: `${clampNumber(element.y, 0, 100, 10)}%`,
    width: `${clampNumber(element.width, 5, 100, 50)}%`,
    height: element.height ? `${clampNumber(element.height, 5, 100, 20)}%` : "auto",
    color: element.color || "#ffffff",
    fontSize: `clamp(12px, ${clampNumber(element.fontSize, 12, 160, 48) / 18}vw, ${clampNumber(element.fontSize, 12, 160, 48)}px)`,
    fontWeight: element.fontWeight === "bold" ? 900 : 500,
    textAlign: ["left", "center", "right"].includes(element.align) ? element.align : "left",
    transform: element.rotation ? `rotate(${clampNumber(element.rotation, -180, 180, 0)}deg)` : "none",
    zIndex: clampNumber(element.zIndex, 0, 999, 1),
  };
}
