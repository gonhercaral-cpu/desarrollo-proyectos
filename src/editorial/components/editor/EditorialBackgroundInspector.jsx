import { useState } from "react";
import { BACKGROUND_FITS, normalizeEditorialBackground } from "../../models/editorialBackground";

function NumberField({ label, value, min, max, step, onCommit, disabled = false }) {
  return (
    <label className="editorial-inspector-field">
      <span>{label}</span>
      <input key={value} type="number" min={min} max={max} step={step} disabled={disabled} defaultValue={value} onBlur={(event) => onCommit(Number(event.target.value))} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
    </label>
  );
}

export default function EditorialBackgroundInspector({ kind, background: value, onChange, onReplace, onRemove, onUndo, onRedo, canUndo, canRedo }) {
  const [error, setError] = useState("");
  const background = normalizeEditorialBackground(value);
  const [opacityPreview, setOpacityPreview] = useState(Math.round(background.opacity * 100));
  if (kind === "component") return null;

  async function replace(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try { await onReplace(file); }
    catch (nextError) { setError(nextError.message || "No fue posible guardar el fondo."); }
  }

  const image = background.image;
  const imageChange = (changes) => onChange({ type: "image", image: changes });

  return (
    <div className="editorial-element-inspector editorial-background-inspector">
      <section>
        <header><strong>Fondo {kind === "master" ? "de maestra" : "de página"}</strong><span>{background.type}</span></header>
        <label className="editorial-inspector-field wide"><span>Tipo</span><select value={background.type} onChange={(event) => onChange({ type: event.target.value })}><option value="none">Sin fondo</option><option value="color">Color sólido</option><option value="image" disabled={!image}>Imagen</option></select></label>
        {background.type !== "none" && <>
          <label className="editorial-inspector-field color wide"><span>Color base</span><input type="color" value={background.color === "transparent" ? "#ffffff" : background.color} onChange={(event) => onChange({ color: event.target.value, type: background.type === "image" ? "image" : "color" })} /></label>
          <label className="editorial-inspector-field wide"><span>Opacidad · {opacityPreview}%</span><input type="range" min="0" max="100" value={opacityPreview} onChange={(event) => setOpacityPreview(Number(event.currentTarget.value))} onPointerUp={(event) => onChange({ opacity: Number(event.currentTarget.value) / 100 })} onKeyUp={(event) => onChange({ opacity: Number(event.currentTarget.value) / 100 })} onBlur={(event) => onChange({ opacity: Number(event.currentTarget.value) / 100 })} /></label>
        </>}
        <label className="editorial-inspector-file">{image ? "Reemplazar imagen" : "Agregar imagen"}<input type="file" accept="image/*" onChange={replace} /></label>
        {background.type === "image" && image && <>
          <label className="editorial-inspector-field wide"><span>Ajuste</span><select value={image.fit} disabled={image.locked} onChange={(event) => imageChange({ fit: event.target.value })}>{BACKGROUND_FITS.map((fit) => <option value={fit} key={fit}>{fit}</option>)}</select></label>
          <div className="editorial-inspector-grid two">
            <NumberField label="Posición X" value={image.positionX} disabled={image.locked} onCommit={(positionX) => imageChange({ positionX })} />
            <NumberField label="Posición Y" value={image.positionY} disabled={image.locked} onCommit={(positionY) => imageChange({ positionY })} />
            <NumberField label="Escala" value={image.scale} min={0.01} step={0.05} disabled={image.locked} onCommit={(scale) => imageChange({ scale })} />
            {image.fit !== "tile" && <NumberField label="Rotación" value={image.rotation} min={-360} max={360} disabled={image.locked} onCommit={(rotation) => imageChange({ rotation })} />}
            <NumberField label="Opacidad imagen %" value={Math.round(image.opacity * 100)} min={0} max={100} disabled={image.locked} onCommit={(opacity) => imageChange({ opacity: opacity / 100 })} />
            <label className="editorial-inspector-checkbox"><input type="checkbox" checked={image.locked} onChange={(event) => imageChange({ locked: event.target.checked })} />Bloqueado</label>
          </div>
        </>}
        <div className="editorial-inspector-actions"><button type="button" onClick={onUndo} disabled={!canUndo}>Deshacer fondo</button><button type="button" onClick={onRedo} disabled={!canRedo}>Rehacer fondo</button><button type="button" onClick={() => onChange({ type: "color", color: "#ffffff", opacity: 1 })}>Restablecer blanco</button><button type="button" className="danger" onClick={onRemove}>Eliminar fondo</button></div>
        {error && <p className="editorial-font-notice" role="alert">{error}</p>}
      </section>
    </div>
  );
}
