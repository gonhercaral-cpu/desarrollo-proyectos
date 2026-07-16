import { useState } from "react";
import { clampZoom } from "../../utils/editorialMeasurements";
import EditorialIcon from "../EditorialIcon";

const GUIDE_OPTIONS = [
  ["bleed", "Sangrado"],
  ["cut", "Línea de corte"],
  ["safe", "Área segura"],
  ["margins", "Márgenes"],
  ["gutter", "Medianil"],
];

export default function EditorialZoomControls({
  zoom,
  viewMode,
  showRulers,
  guideSettings,
  onZoomChange,
  onFit,
  onViewModeChange,
  onShowRulersChange,
  onGuideSettingsChange,
}) {
  const [guidesOpen, setGuidesOpen] = useState(false);
  const currentPercent = Math.round(zoom * 100);
  const zoomOptions = [...new Set([25, 50, 75, 100, 125, 150, 200, currentPercent])].sort((a, b) => a - b);

  return (
    <div className="editorial-zoom-controls">
      <select value={currentPercent} onChange={(event) => onZoomChange(Number(event.target.value) / 100)} aria-label="Zoom">
        {zoomOptions.map((value) => <option value={value} key={value}>{value}%</option>)}
      </select>
      <button type="button" onClick={() => onZoomChange(clampZoom(zoom - 0.1))} aria-label="Alejar">−</button>
      <button type="button" onClick={() => onZoomChange(clampZoom(zoom + 0.1))} aria-label="Acercar">+</button>
      <button type="button" className="text" onClick={() => onFit("page")}>Ajustar página</button>
      <button type="button" className="text" onClick={() => onFit("width")}>Ajustar ancho</button>
      <span className="editorial-toolbar-divider" />
      <button type="button" className={`text ${viewMode === "facing" ? "active" : ""}`} onClick={() => onViewModeChange(viewMode === "single" ? "facing" : "single")}>
        <EditorialIcon name="panel" size={16} /> {viewMode === "single" ? "Página individual" : "Páginas enfrentadas"}
      </button>
      <div className="editorial-guides-menu-wrap">
        <button type="button" className={`text ${guidesOpen ? "active" : ""}`} onClick={() => setGuidesOpen((value) => !value)}><EditorialIcon name="eye" size={16} /> Guías</button>
        {guidesOpen && (
          <div className="editorial-guides-menu">
            {GUIDE_OPTIONS.map(([key, label]) => (
              <label key={key}><input type="checkbox" checked={guideSettings[key]} onChange={(event) => onGuideSettingsChange({ ...guideSettings, [key]: event.target.checked })} />{label}</label>
            ))}
            <label><input type="checkbox" checked={showRulers} onChange={(event) => onShowRulersChange(event.target.checked)} />Reglas</label>
          </div>
        )}
      </div>
    </div>
  );
}
