import { useCallback, useEffect, useRef, useState } from "react";
import ActiveClassroomIcon from "./ActiveClassroomIcon";
import SlideThumbnail from "./SlideThumbnail";
import SlideInteractionEditor from "./SlideInteractionEditor";
import { getBuildPreview, getStudioDraft, inspectStudioSlide, loadStudioReviewers, reviewStudioDraft, saveStudioEdits } from "../services/unitEditorService";
import { deviceService } from "../services/deviceService";
import { planCanvasFit } from "../utils/studioBatch";
import { documentProcessingLabel, isStudioPresentation } from "../utils/unitDraft";
import "../styles/conversion-studio.css";

const sections = [
  ["summary", "Resumen", "grid"], ["reviews", "Revisiones", "list"], ["editor", "Editor", "edit"],
  ["alerts", "Alertas", "alert-circle"], ["publication", "Publicación", "upload"],
];
const reviewLabels = { pending: "Pendiente", "in-review": "En revisión", "changes-requested": "Requiere correcciones", approved: "Lista para publicar" };
const warningLabels = {
  "unsupported-timing": "Secuencia de animación no compatible",
  "unsupported-animation": "Animación de PowerPoint no compatible",
  "unsupported-trigger-or-delay": "Disparador o retraso no compatible",
  "object-trigger": "Disparador de objeto no compatible",
  "gif-static-fallback": "GIF conservado como imagen estática",
  "animation-export-unavailable-manual": "La exportación de Google Slides conservó una imagen estática",
  "states-limit-static": "La presentación excede el límite de pasos de revelado",
};
const geometryLabels = { x: "Posición X", y: "Posición Y", width: "Ancho", height: "Alto", fontSize: "Tamaño de fuente" };
const pixels = 9525;
const getPages = resource => resource?.processing?.pages || [];

function warnings(resource) {
  return getPages(resource).flatMap(page => (page.warnings || []).map(code => ({ page, code })));
}

function processingLabel(resource) {
  return resource.processing?.state ? documentProcessingLabel(resource) : "Pendiente de conversión";
}

function dateLabel(value) {
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value || NaN);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function estimateTextWidth(element) {
  if (!element.editable || !element.fontSize || element.fontAvailable === false || !element.text) return null;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  const family = element.fontFamily?.replace(/["\\]/g, "") || "sans-serif";
  context.font = `${element.fontSize / 100 * 4 / 3}px "${family}", sans-serif`;
  return Math.ceil(context.measureText(element.text).width * pixels) + (element.textInsetX ?? 182880);
}

function Thumbnail({ unitId, resource, page }) {
  if (!page) return <span className="ac-studio-placeholder"><ActiveClassroomIcon name="presentation" /></span>;
  return <SlideThumbnail unitId={unitId} main={resource} slide={{ metadata: { pageObjectId: page.pageObjectId }, interaction: { source: "pptx" } }} index={page.index} />;
}

function usePreview(unitId, resourceId, revision, pageId, step, baseline = false, original = false) {
  const key = pageId ? `${resourceId}:${revision}:${pageId}:${step}:${baseline}:${original}` : "";
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    if (!key) return;
    let active = true;
    getBuildPreview(unitId, resourceId, pageId, step, baseline, original).then(
      asset => { if (active) setLoaded({ key, asset }); },
      error => { if (active) setLoaded({ key, error: error.message }); },
    );
    return () => { active = false; };
  }, [key, unitId, resourceId, pageId, step, baseline, original]);
  return loaded?.key === key ? loaded : null;
}

function Preview({ result, page, animated = false, children }) {
  const aspectRatio = `${page?.width || 16} / ${page?.height || 9}`;
  const [broken, setBroken] = useState("");
  const asset = result?.asset;
  const layers = animated ? asset?.animation : null;
  const url = layers?.background?.url || asset?.url;
  return <div className="ac-studio-canvas" style={{ aspectRatio }}>
    {url && broken !== url
      ? <img alt="Diapositiva generada" draggable={false} src={url} onError={() => setBroken(url)} />
      : <p role={result?.error || broken === url ? "alert" : "status"}>{result?.error || (broken === url ? "No se pudo cargar la imagen." : "Cargando diapositiva…")}</p>}
    {layers?.images?.map(image => <img key={image.url} className="ac-studio-overlay" alt="" src={image.url} style={{
      left: `${image.x * 100}%`, top: `${image.y * 100}%`, width: `${image.width * 100}%`, height: `${image.height * 100}%`,
    }} />)}
    {asset && children}
  </div>;
}

export default function ConversionStudio(props) {
  const { resources, mainId, publications, unitId, initialResourceId, busy, canImport, canUpload, onImport, onUpload } = props;
  const presentations = resources.filter(isStudioPresentation);
  const [section, setSection] = useState(initialResourceId ? "editor" : "summary");
  const [selection, setSelection] = useState({ initial: initialResourceId, id: "" });
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("");
  const dirty = useRef(false);
  const upload = useRef(null);
  const selected = presentations.find(item => item.id === (selection.initial === initialResourceId ? selection.id : initialResourceId))
    || presentations.find(item => item.id === (selection.id || initialResourceId || mainId))
    || presentations[0];
  const filtered = presentations.filter(resource => (!status || (resource.processing?.state || "unprocessed") === status || (status === "processing" && resource.processing?.state === "pending"))
    && resource.name.toLocaleLowerCase("es").includes(term.trim().toLocaleLowerCase("es")));
  const allWarnings = presentations.reduce((count, resource) => count + warnings(resource).length, 0);

  function selectResource(resource, nextSection) {
    if (resource.id !== selected?.id && dirty.current && !window.confirm("¿Cambiar de presentación y descartar los cambios pendientes de guardado?")) return;
    if (resource.id !== selected?.id) dirty.current = false;
    setSelection({ initial: initialResourceId, id: resource.id });
    setSection(nextSection);
  }

  return <section className="ac-studio">
    <header className="ac-studio-header">
      <span className="ac-studio-mark"><ActiveClassroomIcon name="suggestions" size={26} /></span>
      <div><h2>Studio de Conversión</h2><p>Revisa y corrige las presentaciones de la unidad antes de publicar.</p></div>
      <div className="ac-unit-actions">
        {canImport && <button className="ac-outline-button" disabled={busy} onClick={onImport}><ActiveClassroomIcon name="cloud" />Importar desde Nube AES</button>}
        {canUpload && <><input hidden type="file" ref={upload} accept=".pptx" onChange={event => {
          const file = event.target.files[0];
          event.target.value = "";
          if (file && /\.pptx$/i.test(file.name)) onUpload(file);
        }} /><button className="ac-primary-button" disabled={busy} onClick={() => upload.current?.click()}><ActiveClassroomIcon name="upload" />Subir PPTX</button></>}
      </div>
    </header>
    <nav className="ac-studio-nav" aria-label="Secciones de Studio">{sections.map(([id, label, icon]) =>
      <button key={id} type="button" aria-current={id === section ? "page" : undefined} onClick={() => setSection(id)}><ActiveClassroomIcon name={icon} />{label}</button>
    )}</nav>
    {section === "summary" && <>
      <div className="ac-studio-metrics">
        <article><span>Presentaciones</span><strong>{presentations.length}</strong></article>
        <article><span>En conversión</span><strong>{presentations.filter(item => ["pending", "processing"].includes(item.processing?.state)).length}</strong></article>
        <article><span>Alertas del conversor</span><strong>{allWarnings}</strong></article>
        <article><span>Última publicación</span><strong>{publications[0] ? `v${publications[0].version}` : "—"}</strong></article>
      </div>
      <div className="ac-studio-summary">
        <div className="ac-unit-card">
          <div className="ac-studio-toolbar"><h3>Presentaciones de la unidad</h3>
            <input aria-label="Buscar presentación" placeholder="Buscar presentación" value={term} onChange={event => setTerm(event.target.value)} />
            <select aria-label="Estado de conversión" value={status} onChange={event => setStatus(event.target.value)}>
              <option value="">Todos los estados</option><option value="unprocessed">Sin convertir</option>
              <option value="processing">Convirtiendo</option><option value="ready">Convertida</option><option value="failed">Error</option>
            </select>
          </div>
          {filtered.length ? <div className="ac-studio-table"><table>
            <thead><tr><th>Presentación</th><th>Origen</th><th>Estado</th><th>Diapositivas</th><th>Alertas</th><th>Última modificación</th><th>Acciones</th></tr></thead>
            <tbody>{filtered.map(resource => <tr key={resource.id}>
              <td><span className="ac-studio-cell"><Thumbnail unitId={unitId} resource={resource} page={getPages(resource)[0]} /><strong>{resource.name}</strong></span></td>
              <td>{resource.mimeType === "application/vnd.google-apps.presentation" ? "Google Slides" : "PPTX"}</td>
              <td>{processingLabel(resource)}</td><td>{getPages(resource).length || "—"}</td><td>{warnings(resource).length}</td>
              <td>{dateLabel(resource.processing?.completedAt || resource.updatedAt)}{resource.updatedByName && <small>{resource.updatedByName}</small>}</td>
              <td><button className="ac-outline-button" onClick={() => selectResource(resource, "editor")}>Abrir editor</button></td>
            </tr>)}</tbody>
          </table></div> : <p>{presentations.length ? "Sin resultados para estos filtros." : "Importa desde Nube AES o sube un archivo PPTX para comenzar."}</p>}
        </div>
        <aside className="ac-unit-card"><h3>Flujo de trabajo</h3><ol className="ac-studio-workflow">
          {["Importar", "Convertir", "Revisar", "Corregir", "Validar", "Publicar"].map(label => <li key={label}>{label}</li>)}
        </ol></aside>
      </div>
    </>}
    {selected ? <>
      {section !== "summary" && <label className="ac-studio-select">Presentación
        <select value={selected.id} onChange={event => selectResource(presentations.find(item => item.id === event.target.value), section)}>
          {presentations.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </label>}
      <StudioPresentation key={selected.id} {...props} resource={selected} section={section} setSection={setSection} onDirtyChange={value => {
        dirty.current = value;
        props.onDirtyChange(value);
      }} />
    </> : section !== "summary" && <p className="ac-unit-card">La unidad todavía no tiene presentaciones compatibles.</p>}
  </section>;
}

function StudioPresentation({ unitId, resource, section, setSection, mainId, publications, busy, canProcess, canEdit, canAssignReviewers, canSeeDevices, canPublish, onConvert, onMakeMain, onValidate, onPublish, onSchedule, scheduled, onCancelSchedule, onOpenHistory, onRestore, onDirtyChange, testDeviceId, onRestrictTestUnit, unitSlides, resources, onEditInteraction, onSaveInteraction }) {
  const { id: resourceId } = resource;
  const pages = getPages(resource);
  const [pageId, setPageId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [step, setStep] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [mode, setMode] = useState("converted");
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  const [draft, setDraft] = useState(null);
  const [localEdits, setLocalEdits] = useState(null);
  const [undo, setUndo] = useState([]);
  const [redo, setRedo] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadedElements, setLoadedElements] = useState(null);
  const [notes, setNotes] = useState(null);
  const [priority, setPriority] = useState(null);
  const [assignee, setAssignee] = useState(null);
  const [reviewers, setReviewers] = useState(null);
  const [devicePage, setDevicePage] = useState(null);
  const [selectedTestDevice, setSelectedTestDevice] = useState("");
  const [batchSlides, setBatchSlides] = useState([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batch, setBatch] = useState(null);
  const [showGifs, setShowGifs] = useState(true);
  const [publishAt, setPublishAt] = useState("");
  const [historyVersion, setHistoryVersion] = useState(0);
  const [compare, setCompare] = useState("side");
  const [opacity, setOpacity] = useState(50);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);
  const dirtyCallback = useRef(onDirtyChange);
  const drag = useRef(null);
  const [position, setPosition] = useState(null);
  const page = pages.find(item => item.pageObjectId === pageId) || pages[0];
  const unitSlide = mainId === resourceId && unitSlides?.find(item => item.metadata?.pageObjectId === page?.pageObjectId);
  const key = page ? `${page.pageObjectId}:${resource.processing?.sourceFingerprint}:${attempt}` : "";
  const inspected = loadedElements?.key === key ? loadedElements : null;
  const edits = localEdits ?? draft?.edits;
  const dirty = Boolean(draft && edits && JSON.stringify(edits) !== JSON.stringify(draft.edits));
  const changed = Boolean(draft?.revision && draft.revision !== draft.appliedRevision);
  const isGoogle = resource.mimeType === "application/vnd.google-apps.presentation";
  const comparison = section === "alerts" || (section === "editor" && mode === "baseline");
  const preview = usePreview(unitId, resourceId, resource.processing?.revision, ["editor", "alerts"].includes(section) ? page?.pageObjectId : null, section === "editor" && mode === "play" ? step : 0);
  const original = usePreview(unitId, resourceId, resource.processing?.revision, isGoogle && (section === "alerts" || section === "editor" && mode === "original") ? page?.pageObjectId : null, 0, false, true);
  const baseline = usePreview(unitId, resourceId, resource.processing?.revision, comparison && draft?.appliedRevision ? page?.pageObjectId : null, 0, true);

  useEffect(() => { dirtyCallback.current = onDirtyChange; }, [onDirtyChange]);
  useEffect(() => { dirtyCallback.current(dirty); }, [dirty]);
  useEffect(() => () => dirtyCallback.current(false), []);
  useEffect(() => {
    let active = true;
    getStudioDraft(unitId, resourceId).then(data => { if (active) setDraft(data); }, failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [unitId, resourceId, resource.processing?.revision, resource.processing?.state, attempt]);
  useEffect(() => {
    if (!key || loadedElements?.key === key || !canEdit || !["editor", "alerts"].includes(section) || resource.processing?.state !== "ready") return;
    let active = true;
    inspectStudioSlide(unitId, resourceId, page.index).then(
      data => { if (active) setLoadedElements({ key, data }); },
      failure => { if (active) setLoadedElements({ key, error: failure.message }); },
    );
    return () => { active = false; };
  }, [key, loadedElements?.key, canEdit, section, unitId, resourceId, page?.index, resource.processing?.state]);

  async function fetchReviewers() {
    try { setReviewers(await loadStudioReviewers()); }
    catch (failure) { setError(failure.message); }
  }

  async function fetchDevices(cursor = null) {
    try { setDevicePage(await deviceService.list(cursor ? { cursor } : {})); }
    catch (failure) { setError(failure.message); }
  }

  const persist = useCallback(async () => {
    if (!draft || !edits || inFlight.current) return null;
    if (!dirty) return draft;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await saveStudioEdits(unitId, resourceId, draft.revision, edits);
      setDraft(result);
      return result;
    } catch (failure) { setError(failure.message); return null; }
    finally { setSaving(false); inFlight.current = false; }
  }, [unitId, resourceId, draft, edits, dirty]);
  useEffect(() => {
    if (!dirty || busy) return;
    const timer = window.setTimeout(persist, 1200);
    return () => window.clearTimeout(timer);
  }, [dirty, busy, persist]);

  const elements = inspected?.data?.elements || [];
  const slideEdits = (edits || []).filter(item => item.slideIndex === page?.index);
  const currentElements = elements.map(element => ({ ...element, ...slideEdits.find(item => item.id === element.id) }));
  const selected = currentElements.find(element => element.id === selectedId);
  const canvas = inspected?.data;
  const canModify = Boolean(canEdit && draft && !busy && !saving && !batchLoading);
  const geometryAlerts = canvas ? currentElements.filter(element => element.x < 0 || element.y < 0 || element.x + element.width > canvas.width || element.y + element.height > canvas.height) : [];
  const overflowAlerts = currentElements.map(element => ({ element, width: estimateTextWidth(element) })).filter(({ element, width }) => width > element.width);
  const fontAlerts = currentElements.filter(element => element.fontAvailable === false);
  const allWarnings = warnings(resource);
  const canActivate = !busy && !dirty && !changed && !scheduled && mainId === resourceId && draft?.status === "approved";
  const referenceAvailable = isGoogle || draft?.appliedRevision > 0;
  const reference = isGoogle ? original : baseline;
  const referenceLabel = isGoogle ? "Original de Google Slides" : "Conversión inicial";
  const comparedVersion = publications.find(item => item.version === historyVersion);
  const publishedById = new Map((publications[0]?.manifest?.resources || []).map(item => [item.resourceId, item.download?.checksums?.sha256]));
  const comparedById = new Map((comparedVersion?.manifest?.resources || []).map(item => [item.resourceId, item.download?.checksums?.sha256]));
  const currentChecksums = new Set(publishedById.values());
  const candidateFiles = new Map(pages
    .flatMap(item => [item.download, ...(item.builds || []).map(step => step.download), item.animation?.background?.download, ...(item.animation?.images || []).map(overlay => overlay.download)])
    .filter(file => file?.checksums?.sha256)
    .map(file => [file.checksums.sha256, file.sizeBytes]));
  const candidateBytes = [...candidateFiles].filter(([hash]) => !currentChecksums.has(hash)).reduce((total, [, size]) => total + size, 0);
  const changedFiles = [...new Set([...publishedById.keys(), ...comparedById.keys()])].filter(id => publishedById.get(id) !== comparedById.get(id));

  function openPage(next, elementId = "") {
    setPageId(next.pageObjectId);
    setSelectedId(elementId);
    setStep(0);
  }

  function changeEdits(next) {
    if (!canModify) return;
    setUndo([...undo, edits].slice(-50));
    setRedo([]);
    setLocalEdits(next);
  }

  function patch(id, changes) {
    if (Object.values(changes).some(value => typeof value === "number" && !Number.isFinite(value))) return;
    const original = elements.find(element => element.id === id);
    if (!original) return;
    const previous = slideEdits.find(item => item.id === id);
    const next = { ...Object.fromEntries(Object.entries(previous || {}).filter(([field]) => !["slideIndex", "id"].includes(field))), ...changes };
    for (const field of Object.keys(next)) if (next[field] === original[field]) delete next[field];
    const remaining = edits.filter(item => item.slideIndex !== page.index || item.id !== id);
    changeEdits(Object.keys(next).length ? [...remaining, { slideIndex: page.index, id, ...next }] : remaining);
  }

  function startDrag(event, element) {
    if (!canModify || event.button !== 0) return;
    setSelectedId(element.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    const area = event.currentTarget.parentElement.getBoundingClientRect();
    drag.current = { id: element.id, startX: event.clientX, startY: event.clientY, x: element.x, y: element.y, ratioX: canvas.width / area.width, ratioY: canvas.height / area.height };
  }

  function moveDrag(event) {
    const start = drag.current;
    if (!start) return;
    setPosition({ id: start.id, x: Math.round(start.x + (event.clientX - start.startX) * start.ratioX), y: Math.round(start.y + (event.clientY - start.startY) * start.ratioY) });
  }

  function endDrag() {
    if (position) patch(position.id, { x: position.x, y: position.y });
    drag.current = null;
    setPosition(null);
  }

  async function convert() {
    if (!dirty && !changed) { await onConvert(resource); return; }
    const saved = await persist();
    if (saved) {
      await onConvert(resource, saved.revision);
      setLocalEdits(null);
    }
  }

  async function review(status) {
    if (!draft || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      setDraft(await reviewStudioDraft(unitId, resourceId, draft.revision, draft.reviewRevision, status, notes ?? draft.notes, {
        ...(priority === null ? {} : { priority }),
        ...(assignee === null ? {} : { assigneeUid: assignee }),
      }));
      setNotes(null);
      setPriority(null);
      setAssignee(null);
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); inFlight.current = false; }
  }

  function exportReview() {
    const report = {
      unitId, resourceId, name: resource.name, review: draft?.status, priority: draft?.priority,
      assignee: draft?.assigneeName, notes: draft?.notes, updatedAt: draft?.updatedAt,
      warnings: allWarnings.map(({ page, code }) => ({ slide: page.index + 1, code })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const download = document.createElement("a");
    download.href = url;
    download.download = "revision-studio.json";
    download.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function fitElements() {
    if (!canvas || !geometryAlerts.length) return;
    setBatch({ ...planCanvasFit([{ ...canvas, slideIndex: page.index }], edits), fromEdits: edits });
  }

  async function previewBatch() {
    if (!canModify || batchSlides.length === 0 || batchSlides.length > 6) return;
    setBatchLoading(true);
    setError("");
    setBatch(null);
    try {
      const layouts = [];
      for (const slideIndex of batchSlides) {
        layouts.push({ ...await inspectStudioSlide(unitId, resourceId, slideIndex), slideIndex });
      }
      setBatch({ ...planCanvasFit(layouts, edits), fromEdits: edits });
    } catch (failure) { setError(failure.message); }
    finally { setBatchLoading(false); }
  }

  const status = draft ? reviewLabels[draft.status] : "Cargando revisión…";
  return <div className="ac-studio-detail">
    {error && <p role="alert" className="ac-unit-feedback is-error">{error} <button className="ac-clear-filters" onClick={() => {
      if (dirty && !window.confirm("¿Descartar tus cambios locales y cargar el borrador guardado?")) return;
      setError(""); setLocalEdits(null); setUndo([]); setRedo([]); setAttempt(attempt + 1);
    }}>Reintentar carga</button></p>}
    {section === "summary" && <article className="ac-unit-card"><div className="ac-studio-toolbar"><h3>Vista previa de {resource.name}</h3><button className="ac-outline-button" onClick={() => setSection("editor")}>Abrir editor</button></div>
      <div className="ac-studio-previews">{pages.slice(0, 4).map(item => <button key={item.pageObjectId} aria-label={`Abrir diapositiva ${item.index + 1}`} onClick={() => { openPage(item); setSection("editor"); }}><Thumbnail unitId={unitId} resource={resource} page={item} /></button>)}{!pages.length && <p>Convierte la presentación para ver sus diapositivas.</p>}</div>
    </article>}
    {section === "reviews" && <div className="ac-studio-summary">
      <section className="ac-unit-card"><h3>Revisión de conversión</h3><p><strong>{resource.name}</strong> · {status}</p>
        <dl className="ac-studio-facts"><dt>Diapositivas</dt><dd>{pages.length}</dd><dt>Alertas del conversor</dt><dd>{allWarnings.length}</dd><dt>Última revisión</dt><dd>{dateLabel(draft?.updatedAt)}</dd><dt>Revisor</dt><dd>{draft?.assigneeName || "Sin asignar"}</dd></dl>
        <div className="ac-unit-actions"><button className="ac-primary-button" onClick={() => setSection("editor")}>Abrir editor</button><button className="ac-outline-button" onClick={() => setSection("alerts")}>Ver alertas</button><button className="ac-outline-button" disabled={!draft} onClick={exportReview}>Exportar informe</button></div>
      </section>
      <section className="ac-unit-card"><h3>Comentarios de revisión</h3>
        {canEdit && <label>Prioridad <select disabled={!draft || saving || busy} value={priority ?? draft?.priority ?? "normal"} onChange={event => setPriority(event.target.value)}>
          <option value="low">Baja</option><option value="normal">Media</option><option value="high">Alta</option>
        </select></label>}
        {canEdit && canAssignReviewers && (reviewers ? <label>Revisor <select disabled={saving || busy} value={assignee ?? draft?.assigneeUid ?? ""} onChange={event => setAssignee(event.target.value)}>
          <option value="">Sin asignar</option>{reviewers.map(user => <option value={user.uid} key={user.uid}>{user.name}</option>)}
        </select></label> : <button className="ac-outline-button" onClick={fetchReviewers}>Buscar revisores autorizados</button>)}<textarea aria-label="Comentario de revisión" maxLength={280} value={notes ?? draft?.notes ?? ""} disabled={!canEdit || busy || saving || !draft} onChange={event => setNotes(event.target.value)} />
        {canEdit && <div className="ac-unit-actions"><button className="ac-outline-button" disabled={!draft || busy || saving || dirty} onClick={() => review("in-review")}>Guardar revisión</button><button className="ac-outline-button" disabled={!draft || busy || saving || dirty} onClick={() => review("changes-requested")}>Solicitar correcciones</button></div>}
      </section>
    </div>}
    {section === "editor" && <section className="ac-studio-editor">
      <div className="ac-studio-toolbar"><h3>Editor de diapositivas</h3>
        {canEdit && <>
          <button className="ac-outline-button" disabled={!canModify || !undo.length} onClick={() => { setRedo([edits, ...redo]); setLocalEdits(undo.at(-1)); setUndo(undo.slice(0, -1)); }}>Deshacer</button>
          <button className="ac-outline-button" disabled={!canModify || !redo.length} onClick={() => { setUndo([...undo, edits]); setLocalEdits(redo[0]); setRedo(redo.slice(1)); }}>Rehacer</button>
          <button className="ac-outline-button" disabled={!dirty || busy || saving} onClick={persist}>Guardar borrador</button>
        </>}
        {canProcess && <button className="ac-primary-button" disabled={busy || saving || (pages.length > 0 && !dirty && !changed)} onClick={convert}>{pages.length ? "Regenerar conversión" : "Convertir presentación"}</button>}
      </div>
      <p role="status">{saving ? "Guardando borrador…" : dirty ? "Cambios pendientes de guardado." : changed ? "Borrador guardado. Regenera para comprobar los cambios." : processingLabel(resource)}</p>
      {resource.processing?.error && <p role="alert">{resource.processing.error}</p>}
      {page && <div className="ac-studio-editor-grid">
        <aside className="ac-unit-card ac-studio-slide-list"><h4>Diapositivas ({pages.length})</h4>
          <label><input type="checkbox" checked={onlyWarnings} onChange={event => setOnlyWarnings(event.target.checked)} /> Solo con alertas</label>
          {pages.filter(item => !onlyWarnings || item.warnings?.length).map(item => <button key={item.pageObjectId} aria-pressed={page.pageObjectId === item.pageObjectId} onClick={() => openPage(item)}>
            <span>{item.index + 1}</span><Thumbnail unitId={unitId} resource={resource} page={item} />{item.warnings?.length > 0 && <ActiveClassroomIcon name="alert-circle" />}
          </button>)}
        </aside>
        <div className="ac-unit-card ac-studio-stage">
          <div className="ac-unit-actions">
            {isGoogle && <button className="ac-outline-button" aria-pressed={mode === "original"} onClick={() => setMode("original")}>Original</button>}
            <button className="ac-outline-button" aria-pressed={mode === "converted"} onClick={() => setMode("converted")}>Convertida</button>
            {draft?.appliedRevision > 0 && <button className="ac-outline-button" aria-pressed={mode === "baseline"} onClick={() => setMode("baseline")}>Conversión inicial</button>}
            <button className="ac-outline-button" aria-pressed={mode === "play"} onClick={() => { setStep(0); setMode("play"); }}>Reproducción</button>
            <label>Zoom <select value={zoom} onChange={event => setZoom(Number(event.target.value))}>
              <option value="100">Ajustar</option><option value="125">125%</option><option value="150">150%</option><option value="200">200%</option>
            </select></label>
            <button className="ac-outline-button" onClick={event => event.currentTarget.closest(".ac-studio-stage").requestFullscreen?.().catch(() => {})}>Pantalla completa</button>
          </div>
          <div className="ac-studio-zoom"><div style={{ width: `${zoom}%` }}>
          <Preview result={mode === "baseline" ? baseline : mode === "original" ? original : preview} page={page} animated={mode === "play" && showGifs}>
            {mode === "converted" && canvas && currentElements.map(element => {
              const box = position?.id === element.id ? { ...element, ...position } : element;
              return <button key={element.id} type="button" className="ac-studio-element" aria-pressed={selectedId === element.id} aria-label={element.text || `Elemento ${element.id}`} onClick={() => setSelectedId(element.id)}
                onPointerDown={event => startDrag(event, element)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => { drag.current = null; setPosition(null); }}
                onKeyDown={event => {
                  if (!canModify || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
                  event.preventDefault();
                  const delta = (event.shiftKey ? 10 : 1) * pixels;
                  if (["ArrowLeft", "ArrowRight"].includes(event.key)) patch(element.id, { x: element.x + (event.key === "ArrowLeft" ? -delta : delta) });
                  else patch(element.id, { y: element.y + (event.key === "ArrowUp" ? -delta : delta) });
                }}
                style={{ left: `${box.x / canvas.width * 100}%`, top: `${box.y / canvas.height * 100}%`, width: `${box.width / canvas.width * 100}%`, height: `${box.height / canvas.height * 100}%` }} />;
            })}
          </Preview></div></div>
          {mode === "play" && <div className="ac-unit-actions" onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
            event.preventDefault();
            setStep(Math.max(0, Math.min(page.builds?.length || 0, step + (event.key === "ArrowRight" ? 1 : -1))));
          }}>
            {Boolean(page.animation?.images?.length) && <button className="ac-outline-button" onClick={() => setShowGifs(!showGifs)}>{showGifs ? "Ver imagen estática" : "Reproducir GIF"}</button>}
            <button className="ac-outline-button" disabled={!step} onClick={() => setStep(0)}>Reiniciar</button>
            <button className="ac-outline-button" disabled={!step} onClick={() => setStep(step - 1)}>Anterior</button>
            <span role="status">Paso {step + 1} de {(page.builds?.length || 0) + 1}</span>
            <button className="ac-outline-button" disabled={step >= (page.builds?.length || 0)} onClick={() => setStep(step + 1)}>Siguiente</button>
            {page.animation?.images?.length > 0 && <span>{page.animation.images.length} GIF</span>}
            <label>Secuencia <input type="range" min="0" max={page.builds?.length || 0} value={step} disabled={!page.builds?.length} onChange={event => setStep(Number(event.target.value))} /></label>
          </div>}
          {mode === "play" && canEdit && unitSlide && <details className="ac-studio-distribution">
            <summary>Editar pasos de revelado compatibles</summary>
            <fieldset disabled={busy}>
              <SlideInteractionEditor key={unitSlide.slideId} unitId={unitId} slide={unitSlide} main={resource} resources={resources} onChange={interaction => onEditInteraction(unitSlide.slideId, interaction)} compact />
              <button className="ac-outline-button" onClick={onSaveInteraction}>Guardar pasos en el borrador de unidad</button>
            </fieldset>
          </details>}
        </div>
        <aside className="ac-unit-card ac-studio-inspector"><h4>Propiedades del elemento</h4>
          {inspected?.data?.truncated && <p>Se muestran los primeros 300 elementos compatibles.</p>}
          {inspected?.error ? <p role="alert">{inspected.error}</p> : canEdit && !inspected ? <p role="status">Cargando elementos…</p> : null}
          {elements.length > 0 && <select aria-label="Elemento de la diapositiva" value={selectedId} onChange={event => setSelectedId(event.target.value)}>
            <option value="">Seleccionar elemento</option>{elements.map(item => <option key={item.id} value={item.id}>{item.text.slice(0, 70) || `Imagen ${item.id}`}</option>)}
          </select>}
          {selected ? <>
            {Boolean(selected.text || selected.editable) && <label>Texto<textarea maxLength={3000} value={selected.text} disabled={!canModify || !selected.editable} onChange={event => patch(selected.id, { text: event.target.value.replace(/[\r\n]/g, " ") })} /></label>}
            {selected.fontFamily && <p>Fuente original: {selected.fontFamily}{selected.fontAvailable === false ? " (sin coincidencia exacta en el conversor)" : ""}</p>}
            {selected.editable && selected.fontFamily && <label>Sustituir fuente
              <input key={`${selected.id}:${selected.fontFamily}`} defaultValue={selected.fontFamily} maxLength={120} disabled={!canModify} onBlur={event => {
                const fontFamily = event.target.value.trim();
                if (fontFamily && fontFamily !== selected.fontFamily) patch(selected.id, { fontFamily });
              }} />
            </label>}
            {selected.color && <label>Color <input type="color" disabled={!canModify} value={selected.color} onChange={event => patch(selected.id, { color: event.target.value })} /></label>}
            {selected.alignment && <label>Alineación <select disabled={!canModify} value={selected.alignment} onChange={event => patch(selected.id, { alignment: event.target.value })}>
              <option value="left">Izquierda</option><option value="center">Centrada</option><option value="right">Derecha</option><option value="justify">Justificada</option>
            </select></label>}
            {selected.lineSpacing !== undefined && <label>Interlineado (%) <input type="number" min="50" max="300" disabled={!canModify} value={selected.lineSpacing} onChange={event => {
              const value = event.target.valueAsNumber;
              if (Number.isInteger(value) && value >= 50 && value <= 300) patch(selected.id, { lineSpacing: value });
            }} /></label>}
            <div className="ac-studio-properties">{Object.entries(geometryLabels).filter(([field]) => selected[field] !== undefined).map(([field, label]) => {
              const scale = field === "fontSize" ? 100 : pixels;
              return <label key={field}>{label} ({field === "fontSize" ? "pt" : "px"})
                <input key={selected.id} type="number" disabled={!canModify} step="0.1" value={Number((selected[field] / scale).toFixed(3))} onChange={event => {
                  if (event.target.value !== "") patch(selected.id, { [field]: Math.round(event.target.valueAsNumber * scale) });
                }} />
              </label>;
            })}</div>
            <div className="ac-unit-actions">
              <button className="ac-outline-button" disabled={!canModify} onClick={() => changeEdits(edits.filter(item => item.slideIndex !== page.index || item.id !== selected.id))}>Restablecer elemento</button>
              {selected.fontSize > 100 && <button className="ac-outline-button" disabled={!canModify} onClick={() => patch(selected.id, { fontSize: Math.max(100, Math.round(selected.fontSize * 0.9)) })}>Reducir fuente 10%</button>}
            </div>
          </> : inspected?.data && <p>{elements.length ? "Selecciona un elemento en el lienzo o en la lista." : "Esta diapositiva no tiene elementos compatibles con el editor."}</p>}
          {slideEdits.length > 0 && <button className="ac-clear-filters" disabled={!canModify} onClick={() => changeEdits(edits.filter(item => item.slideIndex !== page.index))}>Restablecer diapositiva</button>}
          {Boolean(page.warnings?.length || geometryAlerts.length || overflowAlerts.length || fontAlerts.length) && <button className="ac-outline-button" onClick={() => setSection("alerts")}>Ver alertas de la diapositiva</button>}
        </aside>
      </div>}
    </section>}
    {section === "alerts" && <div className="ac-studio-alerts">
      <section className="ac-unit-card">
        <h3>Alertas y comparación</h3>
        {page && <>
          <div className="ac-studio-toolbar">
            <select aria-label="Diapositiva a comparar" value={page.pageObjectId} onChange={event => openPage(pages.find(item => item.pageObjectId === event.target.value))}>{pages.map(item => <option key={item.pageObjectId} value={item.pageObjectId}>Diapositiva {item.index + 1}</option>)}</select>
            {referenceAvailable && <><button className="ac-outline-button" aria-pressed={compare === "side"} onClick={() => setCompare("side")}>Lado a lado</button><button className="ac-outline-button" aria-pressed={compare === "overlay"} onClick={() => setCompare("overlay")}>Superposición</button><button className="ac-outline-button" aria-pressed={compare === "difference"} onClick={() => setCompare("difference")}>Diferencias</button></>}
          </div>
          {referenceAvailable && compare !== "side" ? <>
            {compare === "overlay" && <label>Opacidad de la referencia <input type="range" min="0" max="100" value={opacity} onChange={event => setOpacity(Number(event.target.value))} /></label>}
            <Preview result={preview} page={page}>{reference?.asset && <img className="ac-studio-overlay" style={{ inset: 0, opacity: compare === "overlay" ? opacity / 100 : 1, mixBlendMode: compare === "difference" ? "difference" : "normal" }} alt={referenceLabel} src={reference.asset.url} />}</Preview>
          </> : <div className={referenceAvailable ? "ac-studio-comparison" : ""}>
            {referenceAvailable && <div><h4>{referenceLabel}</h4><Preview result={reference} page={page} /></div>}
            <div><h4>Conversión actual</h4><Preview result={preview} page={page} /></div>
          </div>}
          {!isGoogle && <p>La comparación de PPTX usa la primera conversión disponible como referencia.</p>}
        </>}
        {!page && <p>Convierte la presentación para ver resultados.</p>}
      </section>
      <aside className="ac-unit-card"><h3>Incidencias ({allWarnings.length + geometryAlerts.length + fontAlerts.length + overflowAlerts.length})</h3>
        {!allWarnings.length && !geometryAlerts.length && !fontAlerts.length && !overflowAlerts.length && <p>Sin incidencias reportadas por las comprobaciones disponibles.</p>}
        {allWarnings.map(({ page: item, code }, index) => <div className="ac-studio-warning" key={`${item.pageObjectId}-${code}-${index}`}>
          <strong>{warningLabels[code] || (code.startsWith("gif-static:") ? "GIF conservado como imagen estática" : code)}</strong>
          <button className="ac-clear-filters" onClick={() => openPage(item)}>Diapositiva {item.index + 1}</button>
        </div>)}
        {overflowAlerts.map(({ element, width }) => <div className="ac-studio-warning" key={element.id}>
          <strong>Posible salto de línea</strong><p>{element.text}</p>
          <button className="ac-outline-button" disabled={!canModify || width > canvas.width - element.x} onClick={() => {
            if (window.confirm(`¿Ampliar el cuadro de ${Math.round(element.width / pixels)} px a ${Math.round(width / pixels)} px?`)) patch(element.id, { width });
          }}>Ampliar cuadro</button>
          <button className="ac-clear-filters" onClick={() => { openPage(page, element.id); setSection("editor"); }}>Abrir elemento</button>
        </div>)}
        {fontAlerts.map(element => <div className="ac-studio-warning" key={element.id}><strong>Fuente sin coincidencia exacta</strong><p>{element.fontFamily} · Diapositiva {page.index + 1}</p></div>)}
        {geometryAlerts.length > 0 && <button className="ac-outline-button" disabled={!canModify} onClick={fitElements}>Ajustar elementos al lienzo</button>}
        {geometryAlerts.map(element => <div className="ac-studio-warning" key={element.id}><strong>Elemento fuera del lienzo</strong><p>{element.text || `Elemento ${element.id}`}</p><button className="ac-outline-button" onClick={() => { openPage(page, element.id); setSection("editor"); }}>Corregir</button></div>)}
        {canEdit && pages.length > 1 && <details className="ac-studio-distribution">
          <summary>Ajustar varias diapositivas</summary>
          <label>Diapositivas (hasta 6) <select multiple value={batchSlides.map(String)} disabled={!canModify} onChange={event => {
            setBatch(null);
            setBatchSlides(Array.from(event.target.selectedOptions, option => Number(option.value)));
          }}>
            {pages.map(item => <option value={item.index} key={item.pageObjectId}>Diapositiva {item.index + 1}</option>)}
          </select></label>
          <button className="ac-outline-button" disabled={!canModify || !batchSlides.length || batchSlides.length > 6} onClick={previewBatch}>Previsualizar ajustes</button>
          {batchLoading && <p role="status">Analizando diapositivas…</p>}
        </details>}
        {batch && <section className="ac-studio-distribution" aria-label="Ajustes propuestos">
          <p>{batch.changes.length} elementos de {new Set(batch.changes.map(item => item.slideIndex)).size} diapositivas.</p>
          {batch.edits.length > 100 && <p role="alert">El borrador admite hasta 100 correcciones.</p>}
          <ul>{batch.changes.map(item => <li key={`${item.slideIndex}:${item.id}`}>Diapositiva {item.slideIndex + 1}, elemento {item.id} · {item.before.map(value => Math.round(value / pixels)).join(", ")} → {item.after.map(value => Math.round(value / pixels)).join(", ")} px</li>)}</ul>
          <button className="ac-primary-button" disabled={!canModify || batch.fromEdits !== edits || !batch.changes.length || batch.edits.length > 100} onClick={() => { changeEdits(batch.edits); setBatch(null); }}>Aplicar al borrador</button>
          <button className="ac-clear-filters" onClick={() => setBatch(null)}>Descartar propuesta</button>
        </section>}
      </aside>
    </div>}
    {section === "publication" && <div className="ac-studio-summary">
      <section className="ac-unit-card"><h3>Publicación de la unidad</h3>
        {testDeviceId && <p role="status">Unidad de prueba. Entrega exclusiva a un equipo autorizado.</p>}
        {!testDeviceId && !publications.length && !scheduled && canPublish && canSeeDevices && <details className="ac-studio-distribution">
          <summary>Limitar esta unidad a un equipo de prueba</summary>
          <p>La unidad quedará asignada permanentemente al equipo elegido.</p>
          {!devicePage ? <button className="ac-outline-button" disabled={busy} onClick={() => fetchDevices()}>Cargar equipos autorizados</button> : <div className="ac-unit-actions">
            <label>Equipo de prueba <select value={selectedTestDevice} disabled={busy} onChange={event => setSelectedTestDevice(event.target.value)}>
              <option value="">Seleccionar equipo</option>
              {devicePage.devices.filter(device => device.status === "authorized").map(device => <option value={device.deviceId} key={device.deviceId}>{device.displayName || device.deviceName}</option>)}
            </select></label>
            <button className="ac-outline-button" disabled={busy || !selectedTestDevice} onClick={() => {
              if (window.confirm("¿Asignar esta unidad nueva solo al equipo seleccionado?")) onRestrictTestUnit(selectedTestDevice);
            }}>Asignar equipo de prueba</button>
          </div>}
        </details>}
        <p>Presentación principal: {mainId === resourceId ? resource.name : "Otra presentación o sin seleccionar"}</p>
        {canEdit && mainId !== resourceId && <button className="ac-outline-button" disabled={busy} onClick={() => onMakeMain(resource)}>Elegir como principal</button>}
        <dl className="ac-studio-facts"><dt>Versión actual</dt><dd>{publications[0] ? `v${publications[0].version}` : "Sin publicar"}</dd><dt>Estado de revisión</dt><dd>{status}</dd><dt>Diapositivas con correcciones</dt><dd>{new Set((edits || []).map(item => item.slideIndex)).size}</dd>{candidateFiles.size > 0 && <><dt>Descarga estimada de esta presentación</dt><dd>{new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2, style: "unit", unit: "megabyte" }).format(candidateBytes / 1e6)}</dd></>}</dl>
        <label>Notas de revisión<textarea maxLength={280} value={notes ?? draft?.notes ?? ""} disabled={!canPublish || busy || saving} onChange={event => setNotes(event.target.value)} /></label>
        {canPublish && <div className="ac-unit-actions">
          <button className="ac-outline-button" disabled={!draft || !pages.length || dirty || changed || saving || busy} onClick={() => review("approved")}>Aprobar conversión</button>
          <button className="ac-outline-button" disabled={busy} onClick={onValidate}>Validar unidad</button>
          <button className="ac-primary-button" disabled={!canActivate} onClick={() => {
            const destination = testDeviceId ? "solo al equipo de prueba asignado" : "a los equipos con acceso";
            if (window.confirm(`¿Entregar la versión actual de la unidad ${destination}?`)) onPublish();
          }}>Publicar ahora</button>
          {scheduled ? <button className="ac-outline-button" disabled={busy} onClick={onCancelSchedule}>Cancelar programación</button> : <>
            <label>Fecha y hora <input type="datetime-local" value={publishAt} disabled={!canActivate} onChange={event => setPublishAt(event.target.value)} /></label>
            <button className="ac-outline-button" disabled={!canActivate || !publishAt} onClick={() => {
              if (window.confirm("¿Programar la publicación de la unidad con el borrador actual?")) onSchedule(new Date(publishAt).toISOString());
            }}>Programar publicación</button>
          </>}
        </div>}
      </section>
      <section className="ac-unit-card"><h3>Historial de versiones</h3>
        {canSeeDevices && <div className="ac-studio-distribution">
          <button className="ac-outline-button" onClick={() => fetchDevices()}>{devicePage ? "Actualizar equipos" : "Consultar sincronización de equipos"}</button>
          {devicePage && <>
            <ul>{devicePage.devices.filter(device => device.status === "authorized" && (!testDeviceId || device.deviceId === testDeviceId)).map(device => <li key={device.deviceId}>
              {device.displayName || device.deviceName} · {device.lastSyncUnitId === unitId && device.lastSyncVersion === publications[0]?.version ? "Última sincronización con esta versión" : "Sin confirmación reciente de esta versión"}
            </li>)}</ul>
            {devicePage.nextCursor && <button className="ac-outline-button" onClick={() => fetchDevices(devicePage.nextCursor)}>Página siguiente</button>}
          </>}
        </div>}
        {publications.length ? <ul className="ac-studio-versions">{publications.map(item => <li key={item.version}>
          <strong>v{item.version}</strong> · {dateLabel(item.manifest?.publishedAt)}
          {item.restoredFromVersion && <small> Restaurada desde v{item.restoredFromVersion}</small>}
          {item.notes && <p>{item.notes}</p>}
          {item.version !== publications[0].version && <div className="ac-unit-actions">
            <button className="ac-clear-filters" onClick={() => setHistoryVersion(item.version)}>Ver cambios</button>
            {canPublish && <button className="ac-outline-button" disabled={busy || saving || dirty} onClick={() => {
              if (window.confirm(`¿Restaurar los recursos de la versión ${item.version} como una nueva publicación de la unidad?`)) onRestore(item.version);
            }}>Restaurar</button>}
          </div>}
        </li>)}</ul> : <p>La unidad aún no tiene versiones.</p>}
        {comparedVersion && <p role="status">v{comparedVersion.version} frente a la versión actual · {changedFiles.length} recursos con diferencias.</p>}
        {publications.length > 0 && <button className="ac-outline-button" onClick={onOpenHistory}>Ver manifiestos</button>}
      </section>
    </div>}
  </div>;
}
