import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clampZoom } from "../../utils/editorialMeasurements";
import EditorialIcon from "../EditorialIcon";

const GUIDE_OPTIONS = [
  ["bleed", "Sangrado"],
  ["cut", "Línea de corte"],
  ["safe", "Área segura"],
  ["margins", "Márgenes"],
  ["gutter", "Medianil"],
  ["smartGuides", "Guías inteligentes"],
  ["snapping", "Ajuste magnético"],
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
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const guidesButtonRef = useRef(null);
  const guidesMenuRef = useRef(null);
  const currentPercent = Math.round(zoom * 100);
  const zoomOptions = [...new Set([25, 50, 75, 100, 125, 150, 200, currentPercent])].sort((a, b) => a - b);
  const settings = guideSettings || {};
  const canConfigureGuides = typeof onGuideSettingsChange === "function" && typeof onShowRulersChange === "function";

  const positionMenu = useCallback(() => {
    const rect = guidesButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 190;
    const estimatedHeight = guidesMenuRef.current?.getBoundingClientRect().height || 252;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
    const top = rect.bottom + estimatedHeight <= window.innerHeight - 8
      ? rect.bottom + 6
      : Math.max(8, rect.top - estimatedHeight - 6);
    setMenuPosition({ left, top });
  }, []);

  useEffect(() => {
    if (!guidesOpen) return undefined;
    positionMenu();
    function closeOnOutside(event) {
      if (guidesButtonRef.current?.contains(event.target) || guidesMenuRef.current?.contains(event.target)) return;
      setGuidesOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === "Escape") setGuidesOpen(false);
    }
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [guidesOpen, positionMenu]);

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
      {canConfigureGuides && <div className="editorial-guides-menu-wrap">
        <button ref={guidesButtonRef} type="button" className={`text ${guidesOpen ? "active" : ""}`} aria-expanded={guidesOpen} aria-haspopup="menu" onClick={() => setGuidesOpen((value) => !value)}><EditorialIcon name="eye" size={16} /> Guías</button>
        {guidesOpen && createPortal(
          <div ref={guidesMenuRef} className="editorial-guides-menu" role="menu" style={menuPosition}>
            {GUIDE_OPTIONS.map(([key, label]) => (
              <label key={key}><input type="checkbox" checked={settings[key] !== false} onChange={(event) => onGuideSettingsChange({ ...settings, [key]: event.target.checked })} />{label}</label>
            ))}
            <label><input type="checkbox" checked={Boolean(showRulers)} onChange={(event) => onShowRulersChange(event.target.checked)} />Reglas</label>
          </div>,
          document.body
        )}
      </div>}
    </div>
  );
}
