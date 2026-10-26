import { useEffect, useState } from "react";
import { getBuildPreview } from "../services/unitEditorService";
import { manualInteraction, moveBuild, visibleBuildLayers } from "../utils/slideInteraction";
import { ANIMATION_FALLBACK_NOTICE, pageWarningNotices, usableAnimation } from "../utils/processingProgress";

const isGifWarning = warning => /gif/i.test(typeof warning === "string" ? warning : `${warning?.code || ""} ${warning?.message || ""}`);

// Resolves with the loaded image only when it decodes; callers fall back to the static PNG otherwise.
async function preloadImage(url) {
  const image = new Image();
  let timeout;
  const loaded = new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image-load"));
    image.src = url;
  }).then(image => typeof image.decode === "function" ? image.decode().then(() => image) : image);
  try { return await Promise.race([loaded, new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("image-timeout")), 10000); })]); }
  finally { clearTimeout(timeout); image.onload = null; image.onerror = null; }
}

function PreviewAsset({ unitId, resourceId, pageObjectId, buildIndex = 0, pageNumber = 1, onRatio, onNotice }) {
  return <PreviewAssetState key={`${unitId}:${resourceId}:${pageObjectId}:${buildIndex}`} {...{ unitId, resourceId, pageObjectId, buildIndex, pageNumber, onRatio, onNotice }} />;
}

function PreviewAssetState({ unitId, resourceId, pageObjectId, buildIndex, pageNumber, onRatio, onNotice }) {
  const [asset, setAsset] = useState(null);
  const [error, setError] = useState("");
  const [animation, setAnimation] = useState(null);
  useEffect(() => {
    let active = true;
    getBuildPreview(unitId, resourceId, pageObjectId, buildIndex).then(async value => {
      if (!active) return;
      setAsset(value); setError(""); onNotice?.("");
      if (!value.animation) return;
      const candidate = usableAnimation(value.animation);
      if (!candidate) { onNotice?.(ANIMATION_FALLBACK_NOTICE); return; }
      try {
        // The complete PNG stays visible until the background and every GIF are decoded.
        const [background] = await Promise.all([candidate.background.url, ...candidate.images.map(image => image.url)].map(preloadImage));
        if (!active) return;
        const ratio = background.naturalWidth / background.naturalHeight;
        if (Number.isFinite(ratio) && ratio > 0) onRatio?.(ratio);
        setAnimation(candidate);
      } catch { if (active) onNotice?.(ANIMATION_FALLBACK_NOTICE); }
    }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [unitId, resourceId, pageObjectId, buildIndex, onNotice, onRatio]);
  if (error) return <p role="alert">{error}</p>;
  if (!asset) return <p role="status">Preparando vista previa…</p>;
  if (asset.mimeType === "application/pdf") return <iframe src={`${asset.url}#page=${pageNumber}&toolbar=0&view=Fit`} title="Diapositiva base" referrerPolicy="no-referrer" />;
  if (animation) return <div className="ac-build-animation" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
    <img src={animation.background.url} alt="Estado de la diapositiva" style={{ width: "100%", height: "100%", display: "block", objectFit: "fill" }} />
    {animation.images.map((image, index) => <img key={index} src={image.url} alt="" style={{ position: "absolute", left: `${image.x}%`, top: `${image.y}%`, width: `${image.width}%`, height: `${image.height}%`, objectFit: "fill" }} />)}
  </div>;
  return <img src={asset.url} alt="Estado de la diapositiva" onLoad={event => onRatio?.(event.target.naturalWidth / event.target.naturalHeight)} />;
}

export default function SlideInteractionEditor({ unitId, slide, main, resources, onChange, compact = false }) {
  const [state, setState] = useState(0);
  const [ratio, setRatio] = useState(16 / 9);
  const [notice, setNotice] = useState("");
  const steps = slide.builds || [];
  const current = Math.min(state, steps.length);
  const automatic = slide.interaction?.source === "pptx";
  const initialResourceId = slide.interaction?.initialResourceId || "";
  const mode = slide.interactionMode || slide.interaction?.mode || "static";
  const page = main?.processing?.pages?.find(page => page.pageObjectId === slide.metadata.pageObjectId);
  const gifNotices = pageWarningNotices((page?.warnings || []).filter(isGifWarning));
  const buildWarning = (page?.warnings || []).some(warning => !isGifWarning(warning));
  function update(builds) { onChange(manualInteraction(builds, builds.length ? "builds" : "static", initialResourceId)); }
  function editLayer(index, change) { update(steps.map((step, position) => position === index ? { ...step, layers: [{ ...step.layers[0], ...change }] } : step)); }
  function add(type) {
    if (steps.length >= 50) return;
    const image = resources.find(resource => resource.kind === "image");
    if (type === "image" && !image) return;
    const layer = { type, x: 10, y: 20, width: 40, height: 15, ...(type === "image" ? { resourceId: image.id } : { text: "Respuesta", color: "#102954", fontSize: 3 }) };
    update([...steps, { order: steps.length + 1, layers: [layer] }]); setState(steps.length + 1);
  }
  const modeControl = <label>Modo<select value={mode} onChange={event => {
      if (event.target.value === "static") { onChange(manualInteraction([], "static", initialResourceId)); setState(0); }
      else if (!steps.length) add("answer");
    }}><option value="static">Sin interactividad</option><option value="builds">Revelado progresivo</option></select></label>;
  const countText = <p>{steps.length} pasos{automatic ? " · Detectados en la presentación" : ""}</p>;
  const warning = <>
    {buildWarning && <p role="status">No se pudieron recuperar los revelados de esta diapositiva. Puedes crear pasos manuales.</p>}
    {gifNotices.map(message => <p role="status" key={message}>{message}</p>)}
    {notice && <p role="status">{notice}</p>}
  </>;
  const navigation = <div className="ac-unit-actions"><button type="button" className="ac-outline-button" aria-pressed={current === 0} onClick={() => setState(0)}>Estado inicial</button>{steps.map((step, index) => <button type="button" className="ac-outline-button" key={step.order} aria-pressed={current === index + 1} onClick={() => setState(index + 1)}>Paso {index + 1}</button>)}</div>;
  const preview = <div className="ac-build-preview" style={{ aspectRatio: ratio }}>
      {initialResourceId ? <PreviewAsset unitId={unitId} resourceId={initialResourceId} onRatio={setRatio} /> : main && <PreviewAsset unitId={unitId} resourceId={main.id} pageObjectId={slide.metadata.pageObjectId} buildIndex={automatic ? current : mode === "static" ? page?.builds?.length || 0 : 0} pageNumber={slide.metadata.pageNumber || slide.index + 1} onRatio={setRatio} onNotice={setNotice} />}
      {!automatic && visibleBuildLayers(steps, current).map((layer, index) => <div key={index} className="ac-build-layer" style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%`, color: layer.color, fontSize: `${layer.fontSize || 3}cqw` }}>{layer.type === "image" ? <PreviewAsset unitId={unitId} resourceId={layer.resourceId} /> : layer.text}</div>)}
    </div>;
  const initialImage = !automatic && <><label>Imagen del estado inicial<select value={initialResourceId} onChange={event => onChange(manualInteraction(steps, mode, event.target.value))}><option value="">Usar diapositiva procesada</option>{resources.filter(resource => resource.kind === "image").map(resource => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label><p>Si la imagen original ya muestra respuestas, importa una imagen sin respuestas y selecciónala como estado inicial.</p></>;
  const editing = automatic ? <p>Estados rasterizados: orden y diseño conservados. <button type="button" className="ac-clear-filters" onClick={() => { onChange(manualInteraction([], "static", initialResourceId)); setState(0); }}>Crear pasos manuales</button></p> : <>
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
    </>;
  if (compact) return <section className="ac-interaction-editor ac-interaction-editor-compact" aria-label="Interactividad de la diapositiva">
    <h3>Vista previa</h3>
    {countText}
    {!!steps.length && navigation}
    {preview}
    {warning}
    <details className="ac-interaction-settings">
      <summary>Editar interactividad</summary>
      {modeControl}
      {initialImage}
      {editing}
    </details>
  </section>;
  return <section className="ac-interaction-editor" aria-label="Interactividad de la diapositiva">
    <h3>Interactividad de la diapositiva</h3>
    {modeControl}
    {countText}
    {warning}
    {navigation}
    {preview}
    {initialImage}
    {editing}
  </section>;
}
