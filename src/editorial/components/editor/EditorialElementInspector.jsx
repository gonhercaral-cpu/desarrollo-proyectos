import { useRef, useState } from "react";
import EditorialIcon from "../EditorialIcon";
import EditorialAcademicElementInspector from "../academic/EditorialAcademicElementInspector";
import { EDITORIAL_SHAPE_TYPES, EDITORIAL_BORDER_STYLES, getShapeKind } from "../../models/editorialShapes";
import { HORIZONTAL_ALIGNS, VERTICAL_ALIGNS, TEXT_TRANSFORMS, hasDecoration, isBold, isItalic, toggleDecoration } from "../../models/editorialTypography";
import { resolveFontVariant } from "../../models/editorialFonts";
import EditorialFontSelector from "./EditorialFontSelector";
import { documentFontSizeToPdfPoints, pdfPointsToDocumentCoordinate } from "../../utils/editorialPdfCoordinateAdapter";

const ALIGN_LABELS = { left: "Izq.", center: "Centro", right: "Der.", justify: "Just." };
const VALIGN_LABELS = { top: "Arriba", middle: "Medio", bottom: "Abajo" };
const TRANSFORM_LABELS = { none: "Aa", uppercase: "AA", lowercase: "aa", capitalize: "Ab" };

function NumberField({ label, value, min, max, step = 1, onChange }) {
  return (
    <label className="editorial-inspector-field">
      <span>{label}</span>
      <input type="number" value={Number(value ?? 0)} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function OpacityField({ value, onLive, onCommit }) {
  const percent = Math.round(Number(value ?? 1) * 100);
  return (
    <div className="editorial-inspector-field wide editorial-opacity-field">
      <span>Opacidad {percent}%</span>
      <div className="editorial-opacity-row">
        <input
          type="range"
          min={0}
          max={100}
          value={percent}
          onChange={(event) => onLive(Number(event.target.value) / 100)}
          onMouseUp={onCommit}
          onTouchEnd={onCommit}
          onBlur={onCommit}
        />
        <input
          key={percent}
          type="number"
          min={0}
          max={100}
          defaultValue={percent}
          onBlur={(event) => { onLive(Math.min(100, Math.max(0, Number(event.target.value))) / 100); onCommit(); }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        />
        <button type="button" title="Restablecer a 100%" onClick={() => { onLive(1); onCommit(); }}>100%</button>
      </div>
    </div>
  );
}

function ToggleButton({ active, title, onClick, children, disabled = false }) {
  return (
    <button type="button" className={`editorial-format-toggle ${active ? "active" : ""}`} aria-pressed={active} title={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function TextContentField({ element, onCommit }) {
  const initial = String(element.content || "");
  const [value, setValue] = useState(initial);
  const valueRef = useRef(value);
  function change(next) { valueRef.current = next; setValue(next); }
  function commit() { if (valueRef.current !== initial) onCommit(valueRef.current); }
  return (
    <label className="editorial-inspector-field wide">
      <span>Contenido</span>
      <textarea
        rows="4"
        value={value}
        readOnly={Boolean(element.automaticIndex)}
        onChange={(event) => change(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); change(initial); event.currentTarget.blur(); }
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); event.currentTarget.blur(); }
        }}
      />
    </label>
  );
}

export default function EditorialElementInspector({ element, actions, fontCatalog, onRegenerate, onUseAsBackground }) {
  if (!element) {
    return <div className="editorial-inspector-empty"><span className="editorial-panel-empty-icon"><EditorialIcon name="settings" size={27} /></span><strong>Propiedades</strong><p>Selecciona un elemento para editarlo.</p></div>;
  }

  const style = element.style || {};
  const update = (changes) => actions.updateElement(element.id, changes);
  const updateStyle = (nextStyle) => update({ style: nextStyle });
  const liveOpacity = (opacity) => actions.updateElementLive(element.id, { opacity });
  const commitOpacity = () => actions.commitLive();
  const shadow = element.shadow || {};
  const setShadow = (changes) => update({ shadow: { ...shadow, ...changes } });
  const supportsFontVariant = (fontWeight, fontStyle) => {
    const variant = resolveFontVariant({ weight: fontWeight, italic: fontStyle === "italic" });
    const option = fontCatalog?.buildOptions?.(variant)?.find((item) => item.family === (style.fontFamily || "Arial"));
    return option ? option.selectable : true;
  };
  const nextBoldWeight = isBold(style) ? "normal" : "bold";
  const nextItalicStyle = isItalic(style) ? "normal" : "italic";

  async function handleReplaceImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try { await actions.replaceImage(element.id, file); }
    catch (error) { console.error("Editorial: fallo al reemplazar imagen", error); }
  }

  return (
    <div className="editorial-element-inspector">
      <section>
        <header><strong>{element.name}</strong><span>{element.type}</span></header>
        <div className="editorial-inspector-grid four">
          <NumberField label="X" value={element.x} step={0.5} onChange={(x) => update({ x })} />
          <NumberField label="Y" value={element.y} step={0.5} onChange={(y) => update({ y })} />
          <NumberField label="Ancho" value={element.width} min={10} step={0.5} onChange={(width) => update({ width })} />
          <NumberField label="Alto" value={element.height} min={10} step={0.5} onChange={(height) => update({ height })} />
        </div>
        <div className="editorial-inspector-grid two">
          <NumberField label="Rotación" value={element.rotation} min={-360} max={360} onChange={(rotation) => update({ rotation })} />
        </div>
        <OpacityField value={element.opacity} onLive={liveOpacity} onCommit={commitOpacity} />
        <div className="editorial-inspector-checks">
          <label><input type="checkbox" checked={element.visible} onChange={(event) => update({ visible: event.target.checked })} />Visible</label>
          <label><input type="checkbox" checked={element.locked} onChange={(event) => update({ locked: event.target.checked })} />Bloqueado</label>
        </div>
        <label className="editorial-inspector-checkbox"><input type="checkbox" checked={Boolean(shadow.enabled)} onChange={(event) => setShadow({ enabled: event.target.checked })} />Sombra</label>
        {shadow.enabled && (
          <div className="editorial-inspector-grid two">
            <label className="editorial-inspector-field color"><span>Color sombra</span><input type="color" value={shadow.color || "#0f172a"} onChange={(event) => setShadow({ color: event.target.value })} /></label>
            <NumberField label="Desenfoque" value={shadow.blur ?? 8} min={0} max={80} onChange={(blur) => setShadow({ blur })} />
            <NumberField label="Offset X" value={shadow.offsetX ?? 3} min={-80} max={80} onChange={(offsetX) => setShadow({ offsetX })} />
            <NumberField label="Offset Y" value={shadow.offsetY ?? 4} min={-80} max={80} onChange={(offsetY) => setShadow({ offsetY })} />
            <NumberField label="Opacidad %" value={Math.round(Number(shadow.opacity ?? 0.35) * 100)} min={0} max={100} onChange={(opacity) => setShadow({ opacity: opacity / 100 })} />
          </div>
        )}
      </section>

      {element.type === "text" && (
        <section>
          <header><strong>Texto</strong></header>
          <TextContentField key={element.id} element={element} onCommit={(content) => update({ content })} />
          {element.automaticIndex && <div className="editorial-inline-notice"><span>Contenido vinculado a estructura.</span><button type="button" onClick={() => update({ automaticIndex: null, generatedKind: "", content: element.content })}>Convertir en texto fijo</button></div>}
          <EditorialFontSelector key={style.fontFamily || "Arial"} value={style.fontFamily || "Arial"} style={style} catalog={fontCatalog} onChange={(fontFamily) => updateStyle({ fontFamily })} />
          <div className="editorial-inspector-grid two">
            <NumberField label="Tamaño (pt)" value={Number(documentFontSizeToPdfPoints(style.fontSize || 24).toFixed(2))} min={4.5} max={180} step={0.5} onChange={(fontSize) => updateStyle({ fontSize: pdfPointsToDocumentCoordinate(fontSize) })} />
          </div>
          <div className="editorial-format-row" role="group" aria-label="Estilo tipográfico">
            <ToggleButton active={isBold(style)} title="Negrita" disabled={!supportsFontVariant(nextBoldWeight, style.fontStyle)} onClick={() => updateStyle({ fontWeight: nextBoldWeight })}><b>B</b></ToggleButton>
            <ToggleButton active={isItalic(style)} title="Cursiva" disabled={!supportsFontVariant(style.fontWeight, nextItalicStyle)} onClick={() => updateStyle({ fontStyle: nextItalicStyle })}><i>I</i></ToggleButton>
            <ToggleButton active={hasDecoration(style, "underline")} title="Subrayado" onClick={() => updateStyle({ textDecoration: toggleDecoration(style, "underline") })}><u>U</u></ToggleButton>
            <ToggleButton active={hasDecoration(style, "line-through")} title="Tachado" onClick={() => updateStyle({ textDecoration: toggleDecoration(style, "line-through") })}><s>S</s></ToggleButton>
          </div>
          <div className="editorial-format-row" role="group" aria-label="Alineación horizontal">
            {HORIZONTAL_ALIGNS.map((value) => <ToggleButton key={value} active={(style.align || "left") === value} title={`Alinear ${ALIGN_LABELS[value]}`} onClick={() => updateStyle({ align: value })}>{ALIGN_LABELS[value]}</ToggleButton>)}
          </div>
          <div className="editorial-format-row" role="group" aria-label="Alineación vertical">
            {VERTICAL_ALIGNS.map((value) => <ToggleButton key={value} active={(style.verticalAlign || "top") === value} title={`Vertical ${VALIGN_LABELS[value]}`} onClick={() => updateStyle({ verticalAlign: value })}>{VALIGN_LABELS[value]}</ToggleButton>)}
          </div>
          <div className="editorial-format-row" role="group" aria-label="Mayúsculas">
            {TEXT_TRANSFORMS.map((value) => <ToggleButton key={value} active={(style.textTransform || "none") === value} title={value} onClick={() => updateStyle({ textTransform: value })}>{TRANSFORM_LABELS[value]}</ToggleButton>)}
          </div>
          <div className="editorial-inspector-grid two">
            <NumberField label="Interlineado" value={style.lineHeight || 1.2} min={0.6} max={4} step={0.05} onChange={(lineHeight) => updateStyle({ lineHeight })} />
            <NumberField label="Espaciado letra" value={style.letterSpacing || 0} min={-5} max={40} step={0.5} onChange={(letterSpacing) => updateStyle({ letterSpacing })} />
          </div>
          <div className="editorial-inspector-grid four">
            <NumberField label="Padding sup." value={style.padding?.top || 0} min={0} max={200} onChange={(top) => updateStyle({ padding: { ...(style.padding || {}), top } })} />
            <NumberField label="Padding der." value={style.padding?.right || 0} min={0} max={200} onChange={(right) => updateStyle({ padding: { ...(style.padding || {}), right } })} />
            <NumberField label="Padding inf." value={style.padding?.bottom || 0} min={0} max={200} onChange={(bottom) => updateStyle({ padding: { ...(style.padding || {}), bottom } })} />
            <NumberField label="Padding izq." value={style.padding?.left || 0} min={0} max={200} onChange={(left) => updateStyle({ padding: { ...(style.padding || {}), left } })} />
          </div>
          <label className="editorial-inspector-field"><span>Cuadro</span><select value={style.boxMode || "auto_size"} onChange={(event) => updateStyle({ boxMode: event.target.value })}><option value="auto_size">Auto</option><option value="fixed_box">Fijo</option></select></label>
          <div className="editorial-inspector-grid two">
            <label className="editorial-inspector-field color"><span>Color</span><input type="color" value={style.fill || "#142033"} onChange={(event) => updateStyle({ fill: event.target.value })} /></label>
            <label className="editorial-inspector-checkbox"><input type="checkbox" checked={Boolean(style.textHighlight?.enabled)} onChange={(event) => updateStyle({ textHighlight: { ...(style.textHighlight || {}), enabled: event.target.checked, color: style.textHighlight?.color || "#fff2ac" } })} />Resaltado</label>
          </div>
          {style.textHighlight?.enabled && (
            <label className="editorial-inspector-field color"><span>Color resaltado</span><input type="color" value={style.textHighlight?.color || "#fff2ac"} onChange={(event) => updateStyle({ textHighlight: { ...(style.textHighlight || {}), color: event.target.value } })} /></label>
          )}
          <label className="editorial-inspector-checkbox"><input type="checkbox" checked={Boolean(style.textShadow?.enabled)} onChange={(event) => updateStyle({ textShadow: { ...(style.textShadow || {}), enabled: event.target.checked, color: style.textShadow?.color || "#0f172a" } })} />Sombra de texto</label>
          {style.textShadow?.enabled && (
            <div className="editorial-inspector-grid two">
              <label className="editorial-inspector-field color"><span>Color sombra</span><input type="color" value={style.textShadow.color || "#0f172a"} onChange={(event) => updateStyle({ textShadow: { ...style.textShadow, color: event.target.value } })} /></label>
              <NumberField label="Desenfoque" value={style.textShadow.blur ?? 8} min={0} max={80} onChange={(blur) => updateStyle({ textShadow: { ...style.textShadow, blur } })} />
              <NumberField label="Offset X" value={style.textShadow.offsetX ?? 3} min={-80} max={80} onChange={(offsetX) => updateStyle({ textShadow: { ...style.textShadow, offsetX } })} />
              <NumberField label="Offset Y" value={style.textShadow.offsetY ?? 4} min={-80} max={80} onChange={(offsetY) => updateStyle({ textShadow: { ...style.textShadow, offsetY } })} />
              <NumberField label="Opacidad %" value={Math.round(Number(style.textShadow.opacity ?? 0.35) * 100)} min={0} max={100} onChange={(opacity) => updateStyle({ textShadow: { ...style.textShadow, opacity: opacity / 100 } })} />
            </div>
          )}
          <label className="editorial-inspector-checkbox"><input type="checkbox" checked={Boolean(style.textStroke?.enabled)} onChange={(event) => updateStyle({ textStroke: { ...(style.textStroke || {}), enabled: event.target.checked, color: style.textStroke?.color || "#ffffff", width: style.textStroke?.width ?? 1 } })} />Contorno de texto</label>
          {style.textStroke?.enabled && (
            <div className="editorial-inspector-grid two">
              <label className="editorial-inspector-field color"><span>Color contorno</span><input type="color" value={style.textStroke.color || "#ffffff"} onChange={(event) => updateStyle({ textStroke: { ...style.textStroke, color: event.target.value } })} /></label>
              <NumberField label="Grosor" value={style.textStroke.width ?? 1} min={0} max={20} step={0.5} onChange={(width) => updateStyle({ textStroke: { ...style.textStroke, width } })} />
            </div>
          )}
        </section>
      )}

      {element.type === "shape" && (
        <section>
          <header><strong>Figura</strong></header>
          <label className="editorial-inspector-field wide"><span>Tipo</span><select value={element.shapeType || "rectangle"} onChange={(event) => update({ shapeType: event.target.value })}>{EDITORIAL_SHAPE_TYPES.map(([type, label]) => <option value={type} key={type}>{label}</option>)}</select></label>
          <div className="editorial-inspector-grid two">
            {getShapeKind(element.shapeType || "rectangle") !== "line" && getShapeKind(element.shapeType || "rectangle") !== "arrow" && (
              <label className="editorial-inspector-field color"><span>Relleno</span><input type="color" value={style.fill || "#dce9fb"} onChange={(event) => updateStyle({ fill: event.target.value })} /></label>
            )}
            <label className="editorial-inspector-field color"><span>Borde</span><input type="color" value={style.borderColor || "#1f6fd6"} onChange={(event) => updateStyle({ borderColor: event.target.value })} /></label>
            <NumberField label="Grosor" value={style.borderWidth || 0} min={0} max={40} onChange={(borderWidth) => updateStyle({ borderWidth })} />
            <label className="editorial-inspector-field"><span>Estilo borde</span><select value={style.borderStyle || "solid"} onChange={(event) => updateStyle({ borderStyle: event.target.value })}>{EDITORIAL_BORDER_STYLES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <NumberField label="Radio" value={style.cornerRadius || 0} min={0} max={200} onChange={(cornerRadius) => updateStyle({ cornerRadius })} />
          </div>
          {getShapeKind(element.shapeType || "rectangle") === "arrow" && (
            <div className="editorial-inspector-grid two">
              <label className="editorial-inspector-field"><span>Punta inicio</span><select value={style.pointerStart || "none"} onChange={(event) => updateStyle({ pointerStart: event.target.value })}><option value="none">Sin punta</option><option value="arrow">Flecha</option></select></label>
              <label className="editorial-inspector-field"><span>Punta final</span><select value={style.pointerEnd || "arrow"} onChange={(event) => updateStyle({ pointerEnd: event.target.value })}><option value="none">Sin punta</option><option value="arrow">Flecha</option></select></label>
            </div>
          )}
        </section>
      )}

      {element.type === "image" && (
        <section>
          <header><strong>Imagen</strong></header>
          <label className="editorial-inspector-file"><EditorialIcon name="image" size={17} /> Reemplazar imagen<input type="file" accept="image/*" onChange={handleReplaceImage} /></label>
          <label className="editorial-inspector-field wide"><span>Ajuste</span><select value={style.fit || "cover"} onChange={(event) => updateStyle({ fit: event.target.value })}><option value="cover">Cover</option><option value="contain">Contain</option></select></label>
          <label className="editorial-inspector-checkbox"><input type="checkbox" checked={Boolean(element.imageBorder?.enabled)} onChange={(event) => update({ imageBorder: { ...(element.imageBorder || {}), enabled: event.target.checked, color: element.imageBorder?.color || "#1f2937", width: element.imageBorder?.width ?? 1 } })} />Borde</label>
          {element.imageBorder?.enabled && (
            <div className="editorial-inspector-grid two">
              <label className="editorial-inspector-field color"><span>Color borde</span><input type="color" value={element.imageBorder?.color || "#1f2937"} onChange={(event) => update({ imageBorder: { ...(element.imageBorder || {}), color: event.target.value } })} /></label>
              <NumberField label="Grosor" value={element.imageBorder?.width ?? 1} min={0} max={40} onChange={(width) => update({ imageBorder: { ...(element.imageBorder || {}), width } })} />
            </div>
          )}
          <NumberField label="Radio" value={element.imageBorder?.radius ?? 0} min={0} max={200} onChange={(radius) => update({ imageBorder: { ...(element.imageBorder || {}), radius } })} />
          {onUseAsBackground && (
            <div className="editorial-inspector-actions compact">
              <button type="button" onClick={() => onUseAsBackground(element)}><EditorialIcon name="image" size={15} />Usar como fondo</button>
              <button type="button" onClick={() => actions.reorderLayer(element.id, "back")}><EditorialIcon name="arrowDown" size={15} />Enviar al fondo</button>
            </div>
          )}
        </section>
      )}

      <EditorialAcademicElementInspector key={element.id} element={element} actions={actions} onRegenerate={onRegenerate} />

      <section className="editorial-inspector-actions">
        <button type="button" onClick={() => actions.reorderLayer(element.id, "front")}><EditorialIcon name="arrowUp" size={15} />Al frente</button>
        <button type="button" onClick={() => actions.reorderLayer(element.id, "back")}><EditorialIcon name="arrowDown" size={15} />Atrás</button>
        <button type="button" onClick={actions.duplicate}><EditorialIcon name="copy" size={15} />Duplicar</button>
        <button type="button" className="danger" onClick={actions.remove}><EditorialIcon name="trash" size={15} />Eliminar</button>
      </section>
    </div>
  );
}
