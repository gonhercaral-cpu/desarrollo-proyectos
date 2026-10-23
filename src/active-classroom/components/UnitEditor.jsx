import { canClassroom } from "../utils/permissions";
import { useEffect, useId, useRef, useState } from "react";
import DriveResourceImportDialog from "./DriveResourceImportDialog";
import ResourceInspector from "./ResourceInspector";
import SlideInteractionEditor from "./SlideInteractionEditor";
import SlideThumbnail from "./SlideThumbnail";
import BackgroundMusicEditor from "./BackgroundMusicEditor";
import UnitMusicPanel from "./UnitMusicPanel";
import { addMusicTracks, isMusicFile } from "../utils/backgroundMusic";
import { ACTIVE_CLASSROOM_ACCEPTED_FILES } from "../constants";
import { canBeMainPresentation, createUnitDraft, reorderSlides, needsOfficeProcessing, documentProcessingLabel, documentProcessingReady } from "../utils/unitDraft";
import { replaceDraftResource, resourceUserState, unitOperationMessage, DRIVE_NEW_VERSION, DRIVE_UNAVAILABLE } from "../utils/draftResources";
import { getDriveResourceKind } from "../utils/driveResources";
import { checkUnitDriveChanges, validateUnitPublication, loadUnitResources, loadUnitEditor, loadUnitPublications, publishUnit, refreshUnitDriveResource, saveUnitDraft, processUnitDocument, subscribeUnitPublication } from "../services/unitEditorService";
import "../styles/unit-editor.css";

const SLIDE_PAGE_SIZE = 8;
const TAB_KEYS = ["summary", "presentation", "slides", "resources", "music", "publications"];

export default function UnitEditor(props) {
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([loadUnitEditor(props.unit.id), loadUnitPublications(props.unit.id)])
      .then(([editor, publications]) => { if (active) setLoaded({ editor, publications }); })
      .catch((loadError) => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [props.unit.id, attempt]);
  if (!loaded) return <section className="ac-section-panel"><p role={error ? "alert" : "status"}>{error || "Cargando editor de Unit..."}</p>{error && <button className="ac-outline-button" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Reintentar</button>}</section>;
  return <UnitEditorForm {...props} initial={loaded} />;
}

export function UnitEditorForm({ unit, folders, resources, initial, onBack, onImport, onUpload, onDirtyChange, onOpenSettings, profile, initialSection = "summary", initialImport = false }) {
  const [draft, setDraft] = useState(() => initial.editor?.draft || createUnitDraft(unit, resources));
  const [revision, setRevision] = useState(initial.editor?.draftRevision || 0);
  const [publications, setPublications] = useState(initial.publications);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [publicationJob, setPublicationJob] = useState(initial.editor?.publicationJob || null);
  const publishing = ["pending", "publishing"].includes(publicationJob?.state);
  const [requestedSlideId, setSelectedSlideId] = useState("");
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [count, setCount] = useState(1);
  const [importMode, setImportMode] = useState(initialImport ? "general" : "");
  const [driveChecks, setDriveChecks] = useState({});
  const [publishValidation, setPublishValidation] = useState(null);
  const [resourceOverrides, setResourceOverrides] = useState({});
  const [replacementId, setReplacementId] = useState("");
  const [operationProgress, setOperationProgress] = useState("");
  const [manifestVersion, setManifestVersion] = useState(0);
  const [tab, setTab] = useState(TAB_KEYS.includes(initialSection) ? initialSection : "summary");
  const [slidePage, setSlidePage] = useState(0);
  const tabRefs = useRef({});
  const idBase = useId();
  const unitResources = Object.values({ ...Object.fromEntries(resources.filter(resource => resource.folderId === unit.id).map(resource => [resource.id, resource])), ...resourceOverrides }).filter(resource => !resource.archived && !(draft.excludedResourceIds || []).includes(resource.id));
  const main = unitResources.find((resource) => resource.id === draft.mainPresentationId);
  const automaticSlides = needsOfficeProcessing(main);
  const nativeSlides = main?.mimeType === "application/vnd.google-apps.presentation";
  const selectedSlide = draft.slides.find((slide) => slide.slideId === requestedSlideId) || draft.slides[0];
  const selectedSlideId = selectedSlide?.slideId || "";
  const selectedResource = unitResources.find((resource) => resource.id === selectedResourceId);
  const version = publications.find((item) => item.version === manifestVersion);
  const canOrder = canClassroom(profile, "orderMaterial");
  const canImportMaterial = canClassroom(profile, "importDrive") && canOrder;
  const legacyTracks = draft.backgroundMusic || [];

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeUnitPublication(unit.id, (job) => {
      setPublicationJob(job);
      if (job?.state === "failed") setError(unitOperationMessage({ code: job.errorCode, message: job.error || "Publicación fallida. Reintenta desde el borrador." }));
      if (job?.state === "ready") {
        setNotice(job.unchanged ? `Sin cambios respecto a versión ${job.version}.` : `Versión ${job.version} publicada.`);
        loadUnitPublications(unit.id).then((items) => { if (active) setPublications(items); }).catch((loadError) => { if (active) setError(loadError.message); });
      }
    }, (loadError) => setError(loadError.message));
    return () => { active = false; unsubscribe(); };
  }, [unit.id]);

  useEffect(() => {
    onDirtyChange(dirty);
    const guard = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard);
    return () => { onDirtyChange(false); window.removeEventListener("beforeunload", guard); };
  }, [dirty, onDirtyChange]);

  function edit(update) {
    if (!canClassroom(profile, typeof update === "object" && Object.keys(update).every(key => ["name", "levelId", "status", "description", "metadata"].includes(key)) ? "editUnits" : "orderMaterial")) return;
    setDraft((current) => typeof update === "function" ? update(current) : { ...current, ...update });
    setDirty(true);
    setNotice(""); setPublishValidation(null);
  }
  async function run(operation) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await operation(); } catch (operationError) { console.error("Active Classroom: operación del borrador fallida", operationError.code); setError(unitOperationMessage(operationError)); }
    finally {
      try { const loaded = await loadUnitResources(unit.id); setResourceOverrides(Object.fromEntries(loaded.map(resource => [resource.id, resource]))); }
      catch { /* Keep the last known state; failed transfers remain retryable. */ }
      setBusy(false); setOperationProgress("");
    }
  }
  function updateSlide(update) {
    edit((current) => ({ ...current, slides: current.slides.map((slide) => slide.slideId === selectedSlideId ? { ...slide, ...update } : slide) }));
  }
  function chooseMain(resourceId) {
    if (resourceId === draft.mainPresentationId) return;
    if (draft.slides.length && !window.confirm("Cambiar presentación reemplaza las diapositivas del borrador. Los recursos asociados pasan a generales. Las publicaciones anteriores se conservan.")) return;
    edit(replaceDraftResource(draft, draft.mainPresentationId, resourceId || null, true));
    setSelectedSlideId("");
  }
  function acceptSaved(result) {
    setRevision(result.draftRevision); setDraft(result.draft); setDirty(false);
    return { draft: result.draft, revision: result.draftRevision };
  }
  async function persist(next = draft, expected = revision) {
    return acceptSaved(await saveUnitDraft(unit.id, next, expected));
  }
  async function checkChanges() {
    const result = await checkUnitDriveChanges(unit.id, unitResources.filter(resource => resource.source === "drive").map(resource => resource.id));
    setDriveChecks(Object.fromEntries(result.results.map(entry => [entry.resourceId, entry])));
    return result;
  }
  async function processInto(resource, context, applyReady = false) {
    if (!needsOfficeProcessing(resource) || (documentProcessingReady(resource) && !applyReady)) return context;
    setOperationProgress(`Procesando ${resource.name}…`);
    const result = await processUnitDocument(unit.id, resource.id, context.revision);
    if (result.state !== "ready") throw new Error("El archivo sigue procesándose. Espera y vuelve a comprobar antes de publicar.");
    const loaded = await loadUnitResources(unit.id);
    setResourceOverrides(Object.fromEntries(loaded.map(item => [item.id, item])));
    return acceptSaved(result);
  }
  async function updateResources(ids, continuePublishing = false) {
    let context = dirty || !revision ? await persist() : { draft, revision };
    for (let index = 0; index < ids.length; index++) {
      const resourceId = ids[index];
      setOperationProgress(`Actualizando archivo ${index + 1} de ${ids.length}…`);
      const result = await refreshUnitDriveResource(unit.id, resourceId, context.revision);
      context = { ...context, revision: result.draftRevision };
      setRevision(context.revision);
      setResourceOverrides(current => ({ ...current, [resourceId]: result.resource }));
      // Persist refreshed revision even when processing fails; retry remains possible.
      context = await processInto(result.resource, context);
      setDriveChecks(current => ({ ...current, [resourceId]: { status: "current" } }));
    }
    setNotice("Archivos actualizados en el borrador. Publicaciones anteriores conservadas.");
    if (continuePublishing) await beginPublish(context);
  }
  async function beginPublish(context) {
    context ||= dirty || !revision ? await persist() : { draft, revision };
    const validation = await validateUnitPublication(unit.id, context.revision);
    setDriveChecks(current => ({ ...current, ...Object.fromEntries(validation.results.map(entry => [entry.resourceId, entry])) }));
    setPublishValidation(validation);
    if (validation.ready) { await publishUnit(unit.id, context.revision); setPublishValidation(null); }
  }
  async function removeResource(resource) {
    if (!window.confirm(`¿Quitar ${resource.name} del borrador? Las publicaciones anteriores se conservan.`)) return;
    await persist(replaceDraftResource(draft, resource.id));
    setSelectedResourceId(""); setSelectedSlideId(""); setPublishValidation(null);
    setNotice("Archivo quitado del borrador. Publicaciones anteriores conservadas.");
  }
  function appendSlides() {
    const amount = Number(count);
    if (!Number.isInteger(amount) || amount < 1 || draft.slides.length + amount > 200) { setError("Puedes crear hasta 200 diapositivas por Unit."); return; }
    const added = Array.from({ length: amount }, (_, index) => ({
      slideId: crypto.randomUUID(), index: draft.slides.length + index, title: "",
      metadata: { pageNumber: draft.slides.length + index + 1, notes: "" }, resourceIds: [],
    }));
    edit((current) => ({ ...current, slides: [...current.slides, ...added] }));
    setSelectedSlideId(added[0].slideId);
    setSlidePage(Math.floor(draft.slides.length / SLIDE_PAGE_SIZE));
  }
  function deleteSelectedSlide() {
    if (!window.confirm("Eliminar diapositiva y sus asociaciones? Los recursos se conservan.")) return;
    const remaining = draft.slides.filter((slide) => slide.slideId !== selectedSlideId);
    const fallback = remaining[Math.min(selectedSlide.index, remaining.length - 1)];
    edit({ slides: remaining.map((slide, index) => ({ ...slide, index })) });
    setSelectedSlideId(fallback?.slideId || "");
  }
  async function save() {
    const result = await saveUnitDraft(unit.id, draft, revision);
    setRevision(result.draftRevision); setDraft(result.draft); setDirty(false);
    setNotice("Borrador guardado. Publicaciones anteriores conservadas.");
  }
  async function processResource(resource) {
    const context = dirty || !revision ? await persist() : { draft, revision };
    await processInto(resource, context, true);
    setNotice("Procesamiento terminado. Borrador actualizado.");
  }
  async function reload() {
    if (dirty && !window.confirm("Descartar cambios locales y cargar el borrador guardado?")) return;
    const editor = await loadUnitEditor(unit.id);
    setDraft(editor?.draft || createUnitDraft(unit, resources)); setRevision(editor?.draftRevision || 0);
    setPublications(await loadUnitPublications(unit.id)); setDirty(false); setDriveChecks({});
    setSelectedSlideId("");
    setNotice("Borrador recargado.");
  }
  function downloadManifest(publication) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(publication.manifest, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${unit.id}-v${publication.version}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function uploadMusicFiles(files) {
    run(async () => {
      const uploaded = await onUpload(files);
      setResourceOverrides(current => ({ ...current, ...Object.fromEntries(uploaded.map(resource => [resource.id, resource])) }));
      await persist(addMusicTracks(draft, uploaded));
      setNotice("Audio añadido a la música anterior de la Unit.");
    });
  }
  const acceptMainFile = (file) => getDriveResourceKind(file) === "presentation" || file.mimeType === "application/pdf" || /\.pdf$/i.test(file.name);

  const tabs = [
    { key: "summary", label: "Resumen" },
    { key: "presentation", label: "Presentación" },
    { key: "slides", label: `Diapositivas (${draft.slides.length})` },
    { key: "resources", label: `Recursos (${unitResources.length})` },
    { key: "music", label: "Música" },
    { key: "publications", label: "Publicaciones" },
  ];
  function onTabKeyDown(event, index) {
    const target = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    setTab(tabs[target].key);
    tabRefs.current[tabs[target].key]?.focus();
  }

  const dataSection = (
    <fieldset disabled={busy || !canClassroom(profile, "editUnits")} className="ac-unit-fields">
      <legend>Datos de la Unit</legend>
      <label>Nombre<input value={draft.name} maxLength={56} onChange={(event) => edit({ name: event.target.value })} /></label>
      <label>Nivel<select value={draft.levelId} onChange={(event) => edit({ levelId: event.target.value })}>{folders.filter((folder) => folder.kind === "level" && (folder.active !== false || folder.id === draft.levelId)).map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}</select></label>
      <label>Estado<select value={draft.status} onChange={(event) => edit({ status: event.target.value })}><option value="active">Activa</option><option value="inactive">Inactiva</option></select></label>
    </fieldset>
  );

  const presentationSection = (
    <section className="ac-unit-card ac-unit-presentation">
      <h2>Presentación principal</h2>
      <div className="ac-unit-actions"><select aria-label="Presentación principal" value={draft.mainPresentationId || ""} disabled={busy || !canOrder} onChange={(event) => chooseMain(event.target.value)}><option value="">Seleccionar presentación de la Unit</option>{unitResources.filter(canBeMainPresentation).map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select><button className="ac-outline-button" disabled={busy || !canImportMaterial} onClick={() => setImportMode("main")}>Importar presentación desde Nube AES</button>{main && <button className="ac-clear-filters" onClick={() => setSelectedResourceId(main.id)}>Inspeccionar original</button>}</div>
      <p>{main ? `${main.sourceName || main.name} · Nube AES` : "Admite PPT/PPTX, Google Slides o PDF de Nube AES."}</p>
      {main && <><div className="ac-unit-actions"><button className="ac-outline-button" disabled={busy} onClick={() => run(() => updateResources([main.id]))}>Actualizar desde Nube AES</button><button className="ac-outline-button" disabled={busy} onClick={() => { setReplacementId(main.id); setImportMode("main"); }}>Reemplazar presentación</button><button className="ac-clear-filters" disabled={busy} onClick={() => run(() => removeResource(main))}>Quitar presentación</button></div>{driveChecks[main.id]?.status === "changed" && <p>{DRIVE_NEW_VERSION}</p>}{driveChecks[main.id]?.status === "unavailable" && <p>{DRIVE_UNAVAILABLE}</p>}</>}
      {automaticSlides ? <><p role="status">{documentProcessingLabel(main)}</p><button className="ac-outline-button" disabled={busy || !canClassroom(profile, "processMaterial")} onClick={() => run(() => processResource(main))}>{main.processing?.state === "failed" ? "Reintentar procesamiento" : documentProcessingReady(main) ? nativeSlides ? "Aplicar imágenes y diapositivas" : "Aplicar diapositivas" : "Procesar presentación"}</button><p>{nativeSlides ? "Reprocesa y publica una versión nueva para recuperar revelados por clic desde Google Slides cuando su exportación los conserve." : "Diapositivas generadas automáticamente desde la presentación."} Publicación bloqueada hasta completar procesamiento.</p></> : <p>Define cantidad y orden de páginas para la presentación PDF original.</p>}
    </section>
  );

  const lastSlidePage = Math.max(0, Math.ceil(draft.slides.length / SLIDE_PAGE_SIZE) - 1);
  const currentSlidePage = Math.min(slidePage, lastSlidePage);
  const slideStart = currentSlidePage * SLIDE_PAGE_SIZE;
  const shownSlides = draft.slides.slice(slideStart, slideStart + SLIDE_PAGE_SIZE);
  const slideListSection = (
    <section className="ac-unit-card ac-unit-slides">
      <h2>Diapositivas ({draft.slides.length})</h2>
      {automaticSlides ? <p>{nativeSlides ? "Generadas desde Google Slides." : "Generadas desde la presentación procesada."}</p> : <div className="ac-unit-actions"><input aria-label="Cantidad de diapositivas a agregar" type="number" min="1" max="200" value={count} onChange={(event) => setCount(event.target.value)} /><button className="ac-outline-button" disabled={busy || !canOrder} onClick={appendSlides}>Agregar</button></div>}
      {!draft.slides.length && <p>Aún no hay diapositivas.</p>}
      <ol start={slideStart + 1}>{shownSlides.map(slide => <li key={slide.slideId}><button aria-pressed={slide.slideId === selectedSlideId} onClick={() => setSelectedSlideId(slide.slideId)}><SlideThumbnail unitId={unit.id} main={main} slide={slide} index={slide.index} /><span className="ac-slide-label">{slide.index + 1}. {slide.title || "Sin título"}<small>{slide.resourceIds.length} recurso(s)</small></span></button></li>)}</ol>
      {lastSlidePage > 0 && <nav className="ac-pagination" aria-label="Páginas de diapositivas"><button type="button" className="ac-outline-button" disabled={currentSlidePage === 0} onClick={() => setSlidePage(currentSlidePage - 1)}>Anterior</button><span>{currentSlidePage + 1} / {lastSlidePage + 1}</span><button type="button" className="ac-outline-button" disabled={currentSlidePage === lastSlidePage} onClick={() => setSlidePage(currentSlidePage + 1)}>Siguiente</button></nav>}
    </section>
  );

  const slideEditorSection = (
    <section className="ac-unit-card ac-unit-slide-editor">
      {selectedSlide ? <fieldset disabled={busy} className="ac-unit-slide-fields"><legend>Diapositiva {selectedSlide.index + 1}</legend>
        <SlideInteractionEditor key={selectedSlide.slideId} unitId={unit.id} slide={selectedSlide} main={main} resources={unitResources} onChange={updateSlide} />
        <details className="ac-slide-details"><summary>Datos y notas de la diapositiva</summary>
          <label>Título<input value={selectedSlide.title} maxLength={160} onChange={(event) => updateSlide({ title: event.target.value })} /></label>
          <label>{nativeSlides ? "Diapositiva de Google Slides" : "Página del PDF"}<input type="number" min="1" max="200" disabled={automaticSlides} value={nativeSlides ? selectedSlide.index + 1 : selectedSlide.metadata.pageNumber ?? ""} onChange={(event) => updateSlide({ metadata: { ...selectedSlide.metadata, pageNumber: event.target.value ? Number(event.target.value) : null } })} /></label>
          <label>Notas<textarea value={selectedSlide.metadata.notes} maxLength={1000} onChange={(event) => updateSlide({ metadata: { ...selectedSlide.metadata, notes: event.target.value } })} /></label>
        </details>
        {!automaticSlides && <div className="ac-unit-actions"><button className="ac-outline-button" disabled={selectedSlide.index === 0} onClick={() => edit({ slides: reorderSlides(draft.slides, selectedSlideId, -1) })}>Subir</button><button className="ac-outline-button" disabled={selectedSlide.index === draft.slides.length - 1} onClick={() => edit({ slides: reorderSlides(draft.slides, selectedSlideId, 1) })}>Bajar</button><button className="ac-clear-filters" onClick={deleteSelectedSlide}>Eliminar diapositiva</button></div>}
        <h3>Recursos asociados</h3>
        {!selectedSlide.resourceIds.length && <p>Selecciona recursos en el panel de recursos.</p>}
        {selectedSlide.resourceIds.map((resourceId) => <div className="ac-unit-actions" key={resourceId}><button className="ac-outline-button" onClick={() => setSelectedResourceId(resourceId)}>{unitResources.find((resource) => resource.id === resourceId)?.name || "Recurso no disponible"}</button><button className="ac-clear-filters" onClick={() => updateSlide({ resourceIds: selectedSlide.resourceIds.filter((id) => id !== resourceId) })}>Quitar asociación</button></div>)}
      </fieldset> : <p>Selecciona o agrega una diapositiva para editarla y asociar recursos.</p>}
    </section>
  );

  const publicationsSummary = (
    <section className="ac-unit-card ac-unit-publication-summary">
      <h2>Publicaciones</h2>
      <p>{publications.length ? `${publications.length} versión(es). Última publicada: ${publications[0].version}.` : "Aún no hay versiones publicadas."}</p>
      <button className="ac-clear-filters" onClick={() => setTab("publications")}>Ver publicaciones</button>
    </section>
  );

  const resourcesSection = (
    <section className="ac-unit-card ac-unit-resource-panel">
      <h2>Recursos de la Unit</h2><p>General: disponible en toda la Unit. Diapositiva: asociación independiente.</p>
      {draft.generalResourceIds.filter((id) => !unitResources.some((resource) => resource.id === id)).map((id) => <p key={id}>Recurso general no disponible <button className="ac-clear-filters" disabled={busy} onClick={() => edit({ generalResourceIds: draft.generalResourceIds.filter((resourceId) => resourceId !== id) })}>Quitar asociación</button></p>)}
      <div className="ac-unit-actions"><button className="ac-outline-button" disabled={busy || !canImportMaterial} data-editor-import onClick={() => setImportMode("general")}>Importar desde Nube AES</button><label className="ac-outline-button">Subir archivos<input type="file" className="ac-sr-only" multiple accept={ACTIVE_CLASSROOM_ACCEPTED_FILES} disabled={busy || !canClassroom(profile, "uploadMaterial") || !canOrder} onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) run(async () => { const uploaded = await onUpload(files); setResourceOverrides(current => ({ ...current, ...Object.fromEntries(uploaded.map(resource => [resource.id, resource])) })); let context = await persist({ ...draft, generalResourceIds: [...new Set([...draft.generalResourceIds, ...uploaded.map(resource => resource.id)])] }); for (const resource of uploaded) context = await processInto(resource, context); }); }} /></label></div>
      <button className="ac-clear-filters" disabled={busy} onClick={() => run(async () => { await checkChanges(); setNotice("Comprobación terminada. Revisa el estado de cada archivo."); })}>Comprobar cambios de Drive</button>
      {Object.values(driveChecks).some(entry => entry.status === "changed") && <button className="ac-primary-button" disabled={busy} onClick={() => run(() => updateResources(Object.entries(driveChecks).filter(([id, entry]) => entry.status === "changed" && unitResources.some(resource => resource.id === id)).map(([id]) => id)))}>Actualizar todos</button>}
      {unitResources.map((resource) => {
        const check = driveChecks[resource.id];
        const canUpdate = resource.source === "drive" && check?.status !== "unavailable";
        const updateButton = canUpdate && <button className="ac-outline-button" disabled={busy} onClick={() => run(() => updateResources([resource.id]))}>{check?.status === "changed" ? "Actualizar a la última versión" : "Actualizar"}</button>;
        return <article className="ac-unit-resource" key={resource.id}>
          <button className="ac-clear-filters" onClick={() => setSelectedResourceId(resource.id)}>{resource.name}</button>
          {needsOfficeProcessing(resource) && <><p role="status">{documentProcessingLabel(resource)}</p><button className="ac-outline-button" disabled={busy || !canClassroom(profile, "processMaterial")} onClick={() => run(() => processResource(resource))}>{resource.processing?.state === "failed" ? "Reintentar procesamiento" : documentProcessingReady(resource) ? resource.mimeType === "application/vnd.google-apps.presentation" ? "Aplicar imágenes" : "Aplicar PDF" : "Procesar documento"}</button></>}
          <div className="ac-unit-actions">
            {resource.id === draft.mainPresentationId ? <small>Presentación principal</small> : <label><input type="checkbox" disabled={busy} checked={draft.generalResourceIds.includes(resource.id)} onChange={() => edit({ generalResourceIds: draft.generalResourceIds.includes(resource.id) ? draft.generalResourceIds.filter((id) => id !== resource.id) : [...draft.generalResourceIds, resource.id] })} />General</label>}
            {selectedSlide && <label><input type="checkbox" disabled={busy} checked={selectedSlide.resourceIds.includes(resource.id)} onChange={() => updateSlide({ resourceIds: selectedSlide.resourceIds.includes(resource.id) ? selectedSlide.resourceIds.filter((id) => id !== resource.id) : [...selectedSlide.resourceIds, resource.id] })} />Diapositiva {selectedSlide.index + 1}</label>}
          </div>
          <p role="status">{resourceUserState(resource, check, needsOfficeProcessing(resource), documentProcessingReady(resource))}</p>
          {check?.status === "changed" && <><p className="ac-unit-change">{DRIVE_NEW_VERSION}</p>{updateButton}</>}
          {check?.status === "unavailable" && <p>{DRIVE_UNAVAILABLE}</p>}
          {check?.status === "error" && <p>{check.message}</p>}
          <details className="ac-unit-more">
            <summary>Más acciones</summary>
            <div className="ac-unit-actions">
              {check?.status !== "changed" && updateButton}
              <button className="ac-outline-button" disabled={busy} onClick={() => { setReplacementId(resource.id); setImportMode(resource.id === draft.mainPresentationId ? "main" : "replace"); }}>{check?.status === "unavailable" ? "Seleccionar reemplazo" : "Reemplazar"}</button>
              <button className="ac-clear-filters" disabled={busy} onClick={() => run(() => removeResource(resource))}>{check?.status === "unavailable" ? "Quitar del borrador" : "Quitar"}</button>
            </div>
          </details>
        </article>;
      })}
      {!unitResources.length && <p>Importa o sube recursos para comenzar.</p>}
    </section>
  );

  const musicSection = (
    <>
      <UnitMusicPanel value={draft.unitMusic || null} profile={profile} disabled={busy || !canOrder} onChange={(unitMusic) => edit({ unitMusic })} onOpenSettings={onOpenSettings} />
      <details className="ac-legacy-music">
        <summary>Música anterior de la Unit ({legacyTracks.length})</summary>
        <BackgroundMusicEditor draft={draft} resources={unitResources} disabled={busy} canImport={canImportMaterial} canUpload={canClassroom(profile, "uploadMaterial") && canOrder} onChange={(next) => edit((current) => ({ ...current, backgroundMusic: next.backgroundMusic, excludedResourceIds: next.excludedResourceIds }))} onImport={() => setImportMode("music")} onUpload={uploadMusicFiles} />
      </details>
    </>
  );

  const musicSummary = (
    <section className="ac-unit-card ac-unit-music-summary">
      <h2>Música</h2>
      <p>{!draft.unitMusic ? "Configuración anterior de la Unit." : draft.unitMusic.mode === "custom" ? "Pista propia de esta Unit." : draft.unitMusic.mode === "none" ? "Sin música ambiente." : "Usa la música predeterminada del módulo."}{legacyTracks.length ? ` ${legacyTracks.length} pista(s) anterior(es) conservada(s).` : ""}</p>
      <button type="button" className="ac-outline-button" onClick={() => setTab("music")}>Configurar música</button>
    </section>
  );

  const publicationsSection = (
    <section className="ac-unit-card">
      <h2>Publicaciones inmutables</h2>{!publications.length && <p>Aún no hay versiones publicadas.</p>}
      {publications.map((publication) => <div className="ac-unit-actions" key={publication.version}><strong>Versión {publication.version}</strong><span>{publication.manifest.publishedAt}</span><button className="ac-clear-filters" onClick={() => setManifestVersion(publication.version)}>Ver manifest</button><button className="ac-clear-filters" onClick={() => downloadManifest(publication)}>Descargar JSON</button></div>)}
      {version && <pre className="ac-unit-manifest">{JSON.stringify(version.manifest, null, 2)}</pre>}
    </section>
  );

  const panels = {
    summary: <>
      {dataSection}
      <div className="ac-unit-overview">{presentationSection}{musicSummary}</div>
      <div className="ac-unit-workspace">{slideListSection}{slideEditorSection}<div className="ac-unit-side">{resourcesSection}{publicationsSummary}</div></div>
    </>,
    presentation: presentationSection,
    slides: <div className="ac-unit-workspace is-slides">{slideListSection}{slideEditorSection}</div>,
    resources: resourcesSection,
    music: musicSection,
    publications: publicationsSection,
  };

  return (
    <section className="ac-unit-editor">
      <header className="ac-unit-heading">
        <div><button className="ac-clear-filters" onClick={() => { if (!dirty || window.confirm("Salir sin guardar cambios del borrador?")) onBack(); }}>‹ Volver al Nivel</button><h1>{draft.name}</h1><p>Editor de Unit · Borrador {revision}{dirty ? " · Cambios sin guardar" : ""} · Publicada: {publications[0]?.version || "Ninguna"}</p></div>
        <div className="ac-unit-actions">
          <button className="ac-outline-button" disabled={busy} onClick={() => run(reload)}>Recargar</button>
          <button className="ac-outline-button" disabled={busy || !(canClassroom(profile, "editUnits") || canOrder)} onClick={() => run(save)}>Guardar borrador</button>
          <button className="ac-primary-button" disabled={busy || publishing || !canClassroom(profile, "publishVersions")} onClick={() => run(() => beginPublish())}>{publishing ? "Publicando recursos…" : "Publicar versión"}</button>
        </div>
      </header>
      {error && <div className="ac-unit-feedback is-error" role="alert">{error}</div>}
      {operationProgress && <div className="ac-unit-feedback" role="status">{operationProgress}<progress /></div>}
      {publishValidation && !publishValidation.ready && <section className="ac-unit-feedback" role="alert">
        {publishValidation.results.some(entry => entry.status === "changed") && <><p>Hay {publishValidation.results.filter(entry => entry.status === "changed").length} archivos con una versión más reciente en Nube AES.</p><button className="ac-primary-button" disabled={busy} onClick={() => run(() => updateResources(publishValidation.results.filter(entry => entry.status === "changed").map(entry => entry.resourceId), true))}>Actualizar y continuar</button></>}
        {publishValidation.issues.map(issue => <p key={issue}>{issue}</p>)}
        {publishValidation.results.filter(entry => !["current", "changed"].includes(entry.status)).map(entry => <p key={entry.resourceId}>{unitResources.find(resource => resource.id === entry.resourceId)?.name}: {entry.message}</p>)}
      </section>}
      {notice && <div className="ac-unit-feedback" role="status">{notice}</div>}
      {publishing && <div className="ac-unit-feedback" role="status">Publicando recursos… {publicationJob.completedResources} / {publicationJob.totalResources}<progress value={publicationJob.completedResources} max={publicationJob.totalResources || 1} /></div>}
      <div className="ac-unit-tabs" role="tablist" aria-label="Secciones del editor de Unit">
        {tabs.map((item, index) => <button key={item.key} type="button" role="tab" id={`${idBase}-tab-${item.key}`} aria-selected={tab === item.key} aria-controls={`${idBase}-panel-${item.key}`} tabIndex={tab === item.key ? 0 : -1} ref={(node) => { tabRefs.current[item.key] = node; }} className={tab === item.key ? "is-active" : ""} onClick={() => setTab(item.key)} onKeyDown={(event) => onTabKeyDown(event, index)}>{item.label}</button>)}
      </div>
      <div className="ac-unit-panel" role="tabpanel" id={`${idBase}-panel-${tab}`} aria-labelledby={`${idBase}-tab-${tab}`} tabIndex={0}>{panels[tab]}</div>
      {selectedResource && <ResourceInspector key={`${selectedResource.id}-${selectedResource.version || 0}`} resource={selectedResource} readOnly />}
      {importMode && <DriveResourceImportDialog unit={unit} draft={draft} onDestinationChange={replacementId || importMode === "music" ? undefined : setImportMode} resources={resources.filter(resource => !(draft.excludedResourceIds || []).includes(resource.id))} selectionLimit={["general", "music"].includes(importMode) ? undefined : 1} acceptFile={importMode === "main" ? acceptMainFile : importMode === "music" || (draft.backgroundMusic || []).some(track => track.resourceId === replacementId) ? isMusicFile : undefined} destination={importMode === "main" ? "Presentación principal" : importMode === "music" ? "Música ambiente" : "Recurso general"} onClose={() => { setImportMode(""); setReplacementId(""); }} onImport={async (files, folderId, progress) => {
        setBusy(true); setError("");
        try {
          const result = await onImport(files, folderId, progress);
          if (result.imported.length) {
            const loaded = await loadUnitResources(unit.id);
            setResourceOverrides(Object.fromEntries(loaded.map(item => [item.id, item])));
            const ids = result.imported.map(resource => resource.id);
            const next = importMode === "music" ? addMusicTracks(draft, loaded.filter(resource => ids.includes(resource.id))) : replacementId ? replaceDraftResource(draft, replacementId, ids[0]) : importMode === "main" ? replaceDraftResource(draft, draft.mainPresentationId, ids[0], true) : { ...draft, generalResourceIds: [...new Set([...draft.generalResourceIds, ...ids])].filter(id => id !== draft.mainPresentationId), excludedResourceIds: (draft.excludedResourceIds || []).filter(id => !ids.includes(id)) };
            let context = await persist(next);
            for (const id of ids) {
              const imported = result.imported.find(resource => resource.id === id);
              let resource = loaded.find(resource => resource.id === id);
              if (imported.knownResource || imported.alreadyImported) {
                const refreshed = await refreshUnitDriveResource(unit.id, id, context.revision);
                context.revision = refreshed.draftRevision; setRevision(context.revision);
                resource = refreshed.resource;
                setResourceOverrides(current => ({ ...current, [id]: resource }));
              }
              context = await processInto(resource, context);
            }
            setNotice("Importación terminada. Archivos listos en el borrador.");
          }
          return result;
        } finally {
          try { const loaded = await loadUnitResources(unit.id); setResourceOverrides(Object.fromEntries(loaded.map(resource => [resource.id, resource]))); }
          catch { /* Keep the last known state; failed transfers remain retryable. */ }
          setBusy(false); setOperationProgress("");
        }
      }} />}
    </section>
  );
}
