import { useEffect, useState } from "react";
import { getBuildPreview } from "../services/unitEditorService";
import { manualInteraction, moveBuild, visibleBuildLayers } from "../utils/slideInteraction";

function PreviewAsset({ unitId, resourceId, pageObjectId, buildIndex = 0, pageNumber = 1, onRatio }) {
  const [asset, setAsset] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    getBuildPreview(unitId, resourceId, pageObjectId, buildIndex).then(value => { if (active) { setAsset(value); setError(""); } }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [unitId, resourceId, pageObjectId, buildIndex]);
  if (error) return <p role="alert">{error}</p>;
  if (!asset) return <p role="status">Preparando vista previa…</p>;
  return asset.mimeType === "application/pdf" ? <object data={`${asset.url}#page=${pageNumber}&toolbar=0&view=Fit`} type="application/pdf" aria-label="Diapositiva base" /> : <img src={asset.url} alt="Estado de la diapositiva" onLoad={event => onRatio?.(event.target.naturalWidth / event.target.naturalHeight)} />;
}

export default function SlideInteractionEditor({ unitId, slide, main, resources, onChange }) {
  const [state, setState] = useState(0);
  const [ratio, setRatio] = useState(16 / 9);
  const steps = slide.builds || [];
  const current = Math.min(state, steps.length);
  const automatic = slide.interaction?.source === "pptx";
  const mode = slide.interactionMode || slide.interaction?.mode || "static";
  const page = main?.processing?.pages?.find(page => page.pageObjectId === slide.metadata.pageObjectId);
  function update(builds) { onChange(manualInteraction(builds)); }
  function editLayer(index, change) { update(steps.map((step, position) => position === index ? { ...step, layers: [{ ...step.layers[0], ...change }] } : step)); }
  function add(type) {
    if (steps.length >= 50) return;
    const image = resources.find(resource => resource.kind === "image");
    if (type === "image" && !image) return;
    const layer = { type, x: 10, y: 20, width: 40, height: 15, ...(type === "image" ? { resourceId: image.id } : { text: "Respuesta", color: "#102954", fontSize: 3 }) };
    update([...steps, { order: steps.length + 1, layers: [layer] }]); setState(steps.length + 1);
  }
  return <section className="ac-interaction-editor" aria-label="Interactividad de la diapositiva">
    <h3>Interactividad de la diapositiva</h3>
    <label>Modo<select value={mode} onChange={event => {
      if (event.target.value === "static") { onChange(manualInteraction([], "static")); setState(0); }
      else if (!steps.length) add("answer");
    }}><option value="static">Sin interactividad</option><option value="builds">Revelado progresivo</option></select></label>
    <p>{steps.length} pasos{automatic ? " · Extraídos de PPTX" : ""}</p>
    {!!page?.warnings?.length && <p role="status">Animación no compatible. Diapositiva estática; puedes crear revelados manuales.</p>}
    <div className="ac-unit-actions"><button type="button" className="ac-outline-button" aria-pressed={current === 0} onClick={() => setState(0)}>Estado inicial</button>{steps.map((step, index) => <button type="button" className="ac-outline-button" key={step.order} aria-pressed={current === index + 1} onClick={() => setState(index + 1)}>Paso {index + 1}</button>)}</div>
    <div className="ac-build-preview" style={{ aspectRatio: ratio }}>
      {main && <PreviewAsset unitId={unitId} resourceId={main.id} pageObjectId={slide.metadata.pageObjectId} buildIndex={automatic ? current : mode === "static" ? page?.builds?.length || 0 : 0} pageNumber={slide.metadata.pageNumber || slide.index + 1} onRatio={setRatio} />}
      {!automatic && visibleBuildLayers(steps, current).map((layer, index) => <div key={index} className="ac-build-layer" style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%`, color: layer.color, fontSize: `${layer.fontSize || 3}cqw` }}>{layer.type === "image" ? <PreviewAsset unitId={unitId} resourceId={layer.resourceId} /> : layer.text}</div>)}
    </div>
    {automatic ? <p>Estados rasterizados: orden y diseño conservados. <button type="button" className="ac-clear-filters" onClick={() => { onChange(manualInteraction([], "static")); setState(0); }}>Crear pasos manuales</button></p> : <>
      <div className="ac-unit-actions"><button type="button" className="ac-outline-button" disabled={steps.length >= 50} onClick={() => add("text")}>Añadir texto</button><button type="button" className="ac-outline-button" disabled={steps.length >= 50} onClick={() => add("answer")}>Añadir respuesta</button><button type="button" className="ac-outline-button" disabled={steps.length >= 50 || !resources.some(resource => resource.kind === "image")} onClick={() => add("image")}>Añadir imagen</button></div>
      <p>Para añadir imágenes, importa o carga el archivo en los recursos de esta Unit.</p>
      {steps.map((step, index) => {
        const layer = step.layers[0];
        return <fieldset key={index} className="ac-build-fields"><legend>Paso {index + 1}</legend>
          {layer.type === "image" ? <label>Imagen<select value={layer.resourceId} onChange={event => editLayer(index, { resourceId: event.target.value })}>{resources.filter(resource => resource.kind === "image").map(resource => <option value={resource.id} key={resource.id}>{resource.name}</option>)}</select></label> : <><label>{layer.type === "answer" ? "Respuesta" : "Texto"}<textarea value={layer.text} maxLength={2000} onChange={event => editLayer(index, { text: event.target.value })} /></label><label>Color<input type="color" value={layer.color} onChange={event => editLayer(index, { color: event.target.value })} /></label><label>Tamaño (% del ancho)<input type="number" min="0.5" max="20" step="0.5" value={layer.fontSize} onChange={event => editLayer(index, { fontSize: Number(event.target.value) })} /></label></>}
          {["x", "y", "width", "height"].map((key, position) => <label key={key}>{["X (%)", "Y (%)", "Ancho (%)", "Alto (%)"][position]}<input type="number" min={position > 1 ? 1 : 0} max={key === "width" ? 100 - layer.x : key === "height" ? 100 - layer.y : key === "x" ? 100 - layer.width : 100 - layer.height} value={layer[key]} onChange={event => editLayer(index, { [key]: Number(event.target.value) })} /></label>)}
          <div className="ac-unit-actions"><button type="button" className="ac-outline-button" disabled={!index} onClick={() => update(moveBuild(steps, index, -1))}>Subir</button><button type="button" className="ac-outline-button" disabled={index === steps.length - 1} onClick={() => update(moveBuild(steps, index, 1))}>Bajar</button><button type="button" className="ac-clear-filters" onClick={() => update(steps.filter((_step, position) => position !== index))}>Eliminar paso</button></div>
        </fieldset>;
      })}
    </>}
  </section>;
}
