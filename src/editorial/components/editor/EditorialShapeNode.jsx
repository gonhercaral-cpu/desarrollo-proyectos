import { Arrow, Ellipse, Line, Rect } from "react-konva";
import { borderDash, buildLinePoints, buildShapePoints, getShapeKind, resolveShapeType, shapeSupportsRadius } from "../../models/editorialShapes";
import { konvaShadowProps } from "../../models/editorialEffects";

// Fase 8 — Render de figuras del registro. Modelo común `shapeType`; compatible
// con rectángulos legacy (shapeType ausente = "rectangle").
export default function EditorialShapeNode({ element }) {
  const shapeType = resolveShapeType(element);
  const kind = getShapeKind(shapeType);
  const style = element.style || {};
  const width = Number(element.width) || 1;
  const height = Number(element.height) || 1;
  const stroke = style.borderColor || style.stroke || "#1f6fd6";
  const strokeWidth = Number(style.borderWidth ?? style.strokeWidth ?? 0);
  const dash = borderDash(style.borderStyle, strokeWidth || 1);
  const fill = style.fill ?? "#dce9fb";
  const shadow = konvaShadowProps(element.shadow || style.shadow);

  const common = {
    stroke,
    strokeWidth,
    ...(dash.length ? { dash } : {}),
    ...shadow,
  };

  if (kind === "rect") {
    return (
      <Rect
        width={width}
        height={height}
        fill={fill}
        cornerRadius={shapeSupportsRadius(shapeType) ? Number(style.cornerRadius || 0) : 0}
        {...common}
      />
    );
  }

  if (kind === "ellipse") {
    return (
      <Ellipse
        x={width / 2}
        y={height / 2}
        radiusX={width / 2}
        radiusY={shapeType === "circle" ? width / 2 : height / 2}
        fill={fill}
        {...common}
      />
    );
  }

  if (kind === "arrow" || kind === "line") {
    const points = buildLinePoints(width, height, element);
    const pointerEnd = (style.pointerEnd || (kind === "arrow" ? "arrow" : "none")) === "arrow";
    const pointerStart = (style.pointerStart || (shapeType === "double_arrow" ? "arrow" : "none")) === "arrow";
    return (
      <Arrow
        points={points}
        pointerLength={pointerEnd || pointerStart ? Math.max(8, strokeWidth * 3) : 0}
        pointerWidth={pointerEnd || pointerStart ? Math.max(8, strokeWidth * 3) : 0}
        pointerAtBeginning={pointerStart}
        pointerAtEnding={pointerEnd}
        fill={stroke}
        stroke={stroke}
        strokeWidth={strokeWidth || 3}
        {...(dash.length ? { dash } : {})}
        {...shadow}
      />
    );
  }

  // polygon (triangle/diamond/pentagon/hexagon/star/speech_bubble/custom_polygon)
  return (
    <Line
      points={buildShapePoints(shapeType, width, height, element)}
      closed
      fill={fill}
      tension={0}
      {...common}
    />
  );
}
