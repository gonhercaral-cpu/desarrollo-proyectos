import { createPortal } from "react-dom";
import { buildEditorialRulerModel } from "../../utils/editorialRulerModel";

function RulerTicks({ model, axis }) {
  return model.ticks.map((tick) => (
    <span
      className={`editorial-ruler-tick ${tick.major ? "major" : "minor"}`}
      key={`${axis}-${tick.value}`}
      style={axis === "x" ? { left: tick.positionPx } : { top: tick.positionPx }}
    >
      {tick.label && <b>{tick.label}</b>}
    </span>
  ));
}

export default function EditorialRulers({ geometry, page, metrics, unit = "in" }) {
  if (!geometry || !page) return null;
  const horizontal = buildEditorialRulerModel({ lengthIn: Number(page.width || 8) + Number(metrics.bleed || 0) * 2 / 96, unit, scale: geometry.scale });
  const vertical = buildEditorialRulerModel({ lengthIn: Number(page.height || 10) + Number(metrics.bleed || 0) * 2 / 96, unit, scale: geometry.scale });
  return createPortal(
    <div
      className="editorial-ruler-viewport"
      style={{ left: geometry.viewportX, top: geometry.viewportY, width: geometry.viewportWidth, height: geometry.viewportHeight }}
      aria-hidden="true"
    >
      <div className="editorial-canvas-ruler horizontal" style={{ left: geometry.pageOffsetX, width: geometry.pageWidthPx }}><RulerTicks model={horizontal} axis="x" /></div>
      <div className="editorial-canvas-ruler vertical" style={{ top: geometry.pageOffsetY, height: geometry.pageHeightPx }}><RulerTicks model={vertical} axis="y" /></div>
      <span className="editorial-ruler-unit">{unit}</span>
    </div>,
    document.body
  );
}
