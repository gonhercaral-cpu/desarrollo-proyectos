import { useEffect, useState } from "react";
import DriveResourceImportDialog from "./DriveResourceImportDialog";
import ResourceInspector from "./ResourceInspector";
import { ACTIVE_CLASSROOM_ACCEPTED_FILES } from "../constants";
import { canBeMainPresentation, createUnitDraft, reorderSlides, needsOfficeProcessing, documentProcessingLabel, documentProcessingReady } from "../utils/unitDraft";
import { getDriveResourceKind } from "../utils/driveResources";
import { checkUnitDriveChanges, loadUnitEditor, loadUnitPublications, publishUnit, refreshUnitDriveResource, saveUnitDraft, processUnitDocument } from "../services/unitEditorService";

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

function UnitEditorForm({ unit, folders, resources, initial, onBack, onImport, onUpload, onDirtyChange }) {
  const [draft, setDraft] = useState(() => initial.editor?.draft || createUnitDraft(unit, resources));
  const [revision, setRevision] = useState(initial.editor?.draftRevision || 0);
  const [publications, setPublications] = useState(initial.publications);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedSlideId, setSelectedSlideId] = useState("");
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [count, setCount] = useState(1);
  const [importMode, setImportMode] = useState("");
  const [driveChecks, setDriveChecks] = useState({});
  const [manifestVersion, setManifestVersion] = useState(0);
  const unitResources = resources.filter((resource) => resource.folderId === unit.id && !resource.archived);
  const main = unitResources.find((resource) => resource.id === draft.mainPresentationId);
  const automaticSlides = needsOfficeProcessing(main);
  const nativeSlides = main?.mimeType === "application/vnd.google-apps.presentation";
  const referencedIds = new Set([draft.mainPresentationId, ...draft.generalResourceIds, ...draft.slides.flatMap((slide) => slide.resourceIds)]);
  const processingBlocked = unitResources.some((resource) => referencedIds.has(resource.id) && needsOfficeProcessing(resource) && !documentProcessingReady(resource));
  const selectedSlide = draft.slides.find((slide) => slide.slideId === selectedSlideId);
  const selectedResource = unitResources.find((resource) => resource.id === selectedResourceId);
  const version = publications.find((item) => item.version === manifestVersion);

  useEffect(() => {
    onDirtyChange(dirty);
    const guard = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard);
    return () => { onDirtyChange(false); window.removeEventListener("beforeunload", guard); };
  }, [dirty, onDirtyChange]);

  function edit(update) {
    setDraft((current) => typeof update === "function" ? update(current) : { ...current, ...update });
    setDirty(true);
    setNotice("");
  }
  async function run(operation) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await operation(); } catch (operationError) { setError(operationError.message || "No se pudo completar la operación."); }
    finally { setBusy(false); }
  }
  function updateSlide(update) {
    edit((current) => ({ ...current, slides: current.slides.map((slide) => slide.slideId === selectedSlideId ? { ...slide, ...update } : slide) }));
  }
  function chooseMain(resourceId) {
    if (draft.slides.length && resourceId !== draft.mainPresentationId && !window.confirm("Cambiar presentación conserva diapositivas y asociaciones. Revisa su correspondencia antes de publicar.")) return;
    edit((current) => ({ ...current, mainPresentationId: resourceId || null, generalResourceIds: current.generalResourceIds.filter((id) => id !== resourceId) }));
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
  }
  async function save() {
    const result = await saveUnitDraft(unit.id, draft, revision);
    setRevision(result.draftRevision); setDraft(result.draft); setDirty(false);
    setNotice("Borrador guardado. Publicaciones anteriores conservadas.");
  }
  async function processResource(resource) {
    const result = await processUnitDocument(unit.id, resource.id, revision);
    if (result.state === "ready") {
      setRevision(result.draftRevision); setDraft(result.draft); setDirty(false);
      setNotice(`Documento procesado: ${result.processing.pageCount} ${resource.kind === "presentation" ? "diapositivas" : "páginas"}. Borrador actualizado; publicaciones anteriores conservadas.`);
    } else setNotice("Procesando documento. Espera a que termine y recarga el borrador.");
  }
  async function reload() {
    if (dirty && !window.confirm("Descartar cambios locales y cargar el borrador guardado?")) return;
    const editor = await loadUnitEditor(unit.id);
    setDraft(editor?.draft || createUnitDraft(unit, resources)); setRevision(editor?.draftRevision || 0);
    setPublications(await loadUnitPublications(unit.id)); setDirty(false); setDriveChecks({});
    setNotice("Borrador recargado.");
  }
  function downloadManifest(publication) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(publication.manifest, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${unit.id}-v${publication.version}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const acceptMainFile = (file) => getDriveResourceKind(file) === "presentation" || file.mimeType === "application/pdf" || /\.pdf$/i.test(file.name);

  return (
    <section className="ac-unit-editor">
      <header className="ac-unit-heading">
        <div><button className="ac-clear-filters" onClick={() => { if (!dirty || window.confirm("Salir sin guardar cambios del borrador?")) onBack(); }}>‹ Volver al Nivel</button><h1>{draft.name}</h1><p>Editor de Unit · Borrador {revision}{dirty ? " · Cambios sin guardar" : ""} · Publicada: {publications[0]?.version || "Ninguna"}</p></div>
        <div className="ac-unit-actions">
          <button className="ac-outline-button" disabled={busy} onClick={() => run(reload)}>Recargar</button>
          <button className="ac-outline-button" disabled={busy} onClick={() => run(save)}>Guardar borrador</button>
          <button className="ac-primary-button" disabled={busy || dirty || !revision || processingBlocked} title={processingBlocked ? "Procesa los documentos antes de publicar" : dirty ? "Guarda primero el borrador" : "Crear una versión inmutable"} onClick={() => run(async () => { const result = await publishUnit(unit.id, revision); setPublications(await loadUnitPublications(unit.id)); setNotice(result.unchanged ? `Sin cambios respecto a versión ${result.version}.` : `Versión ${result.version} publicada.`); })}>Publicar versión</button>
        </div>
      </header>
      {error && <div className="ac-unit-feedback is-error" role="alert">{error}</div>}
      {notice && <div className="ac-unit-feedback" role="status">{notice}</div>}
      <fieldset disabled={busy} className="ac-unit-fields">
        <legend>Datos de la Unit</legend>
        <label>Nombre<input value={draft.name} maxLength={56} onChange={(event) => edit({ name: event.target.value })} /></label>
        <label>Nivel<select value={draft.levelId} onChange={(event) => edit({ levelId: event.target.value })}>{folders.filter((folder) => folder.kind === "level").map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}</select></label>
        <label>Estado<select value={draft.status} onChange={(event) => edit({ status: event.target.value })}><option value="active">Activa</option><option value="inactive">Inactiva</option></select></label>
        <label>Código<input value={draft.metadata.code} maxLength={80} onChange={(event) => edit({ metadata: { ...draft.metadata, code: event.target.value } })} /></label>
        <label>Idioma<input value={draft.metadata.language} maxLength={40} onChange={(event) => edit({ metadata: { ...draft.metadata, language: event.target.value } })} /></label>
        <label>Duración estimada (min)<input type="number" min="0" max="10000" value={draft.metadata.estimatedMinutes} onChange={(event) => edit({ metadata: { ...draft.metadata, estimatedMinutes: Number(event.target.value) } })} /></label>
        <label className="ac-unit-wide">Descripción<textarea value={draft.description} maxLength={4000} onChange={(event) => edit({ description: event.target.value })} /></label>
        <label className="ac-unit-wide">Etiquetas (separadas por coma)<input value={draft.metadata.tags.join(",")} onChange={(event) => edit({ metadata: { ...draft.metadata, tags: event.target.value.split(",") } })} /></label>
      </fieldset>
      <section className="ac-unit-card">
        <h2>Presentación principal</h2>
        <div className="ac-unit-actions"><select aria-label="Presentación principal" value={draft.mainPresentationId || ""} disabled={busy} onChange={(event) => chooseMain(event.target.value)}><option value="">Seleccionar presentación de la Unit</option>{unitResources.filter(canBeMainPresentation).map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select><button className="ac-outline-button" disabled={busy} onClick={() => setImportMode("main")}>Importar presentación desde Nube AES</button>{main && <button className="ac-clear-filters" onClick={() => setSelectedResourceId(main.id)}>Inspeccionar original</button>}</div>
        <p>{main ? `${main.sourceName || main.name} · Presentación original · Drive v${main.driveVersion || "sin versión"}` : "Admite PPT/PPTX, Google Slides o PDF de Nube AES."}</p>
        {automaticSlides ? <><p role="status">{documentProcessingLabel(main)}</p><button className="ac-outline-button" disabled={busy || dirty || !revision} onClick={() => run(() => processResource(main))}>{main.processing?.state === "failed" ? "Reintentar procesamiento" : documentProcessingReady(main) ? nativeSlides ? "Aplicar imágenes y diapositivas" : "Aplicar PDF y diapositivas" : "Procesar presentación"}</button><p>{nativeSlides ? "Diapositivas PNG generadas desde Google Slides en su orden original." : "Diapositivas generadas automáticamente desde las páginas del PDF."} Publicación bloqueada hasta completar procesamiento.</p></> : <p>Define cantidad y orden de páginas para la presentación PDF original.</p>}
      </section>
      <div className="ac-unit-workspace">
        <section className="ac-unit-card ac-unit-slides">
          <h2>Diapositivas ({draft.slides.length})</h2>
          {automaticSlides ? <p>{nativeSlides ? "Generadas desde Google Slides." : "Generadas desde el PDF procesado."}</p> : <div className="ac-unit-actions"><input aria-label="Cantidad de diapositivas a agregar" type="number" min="1" max="200" value={count} onChange={(event) => setCount(event.target.value)} /><button className="ac-outline-button" disabled={busy} onClick={appendSlides}>Agregar</button></div>}
          <ol>{draft.slides.map((slide, index) => <li key={slide.slideId}><button aria-pressed={slide.slideId === selectedSlideId} onClick={() => setSelectedSlideId(slide.slideId)}>{index + 1}. {slide.title || "Sin título"}<small>{slide.resourceIds.length} recurso(s)</small></button></li>)}</ol>
        </section>
        <section className="ac-unit-card">
          {selectedSlide ? <fieldset disabled={busy} className="ac-unit-slide-fields"><legend>Diapositiva {selectedSlide.index + 1}</legend>
            <label>Título<input value={selectedSlide.title} maxLength={160} onChange={(event) => updateSlide({ title: event.target.value })} /></label>
            <label>{nativeSlides ? "Diapositiva de Google Slides" : "Página del PDF"}<input type="number" min="1" max="200" disabled={automaticSlides} value={nativeSlides ? selectedSlide.index + 1 : selectedSlide.metadata.pageNumber ?? ""} onChange={(event) => updateSlide({ metadata: { ...selectedSlide.metadata, pageNumber: event.target.value ? Number(event.target.value) : null } })} /></label>
            <label>Notas<textarea value={selectedSlide.metadata.notes} maxLength={1000} onChange={(event) => updateSlide({ metadata: { ...selectedSlide.metadata, notes: event.target.value } })} /></label>
            {!automaticSlides && <div className="ac-unit-actions"><button className="ac-outline-button" disabled={selectedSlide.index === 0} onClick={() => edit({ slides: reorderSlides(draft.slides, selectedSlideId, -1) })}>Subir</button><button className="ac-outline-button" disabled={selectedSlide.index === draft.slides.length - 1} onClick={() => edit({ slides: reorderSlides(draft.slides, selectedSlideId, 1) })}>Bajar</button><button className="ac-clear-filters" onClick={() => { if (window.confirm("Eliminar diapositiva y sus asociaciones? Los recursos se conservan.")) { edit({ slides: draft.slides.filter((slide) => slide.slideId !== selectedSlideId).map((slide, index) => ({ ...slide, index })) }); setSelectedSlideId(""); } }}>Eliminar diapositiva</button></div>}
            <h3>Recursos asociados</h3>
            {!selectedSlide.resourceIds.length && <p>Selecciona recursos en el panel derecho.</p>}
            {selectedSlide.resourceIds.map((resourceId) => <div className="ac-unit-actions" key={resourceId}><button className="ac-outline-button" onClick={() => setSelectedResourceId(resourceId)}>{unitResources.find((resource) => resource.id === resourceId)?.name || "Recurso no disponible"}</button><button className="ac-clear-filters" onClick={() => updateSlide({ resourceIds: selectedSlide.resourceIds.filter((id) => id !== resourceId) })}>Quitar asociación</button></div>)}
          </fieldset> : <p>Selecciona o agrega una diapositiva para editarla y asociar recursos.</p>}
        </section>
        <section className="ac-unit-card ac-unit-resource-panel">
          <h2>Recursos de la Unit</h2><p>General: disponible en toda la Unit. Diapositiva: asociación independiente.</p>
          {draft.generalResourceIds.filter((id) => !unitResources.some((resource) => resource.id === id)).map((id) => <p key={id}>Recurso general no disponible <button className="ac-clear-filters" disabled={busy} onClick={() => edit({ generalResourceIds: draft.generalResourceIds.filter((resourceId) => resourceId !== id) })}>Quitar asociación</button></p>)}
          <div className="ac-unit-actions"><button className="ac-outline-button" disabled={busy} onClick={() => setImportMode("general")}>Importar desde Nube AES</button><label className="ac-outline-button">Subir archivos<input type="file" multiple accept={ACTIVE_CLASSROOM_ACCEPTED_FILES} disabled={busy} onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) run(async () => { const uploaded = await onUpload(files); edit((current) => ({ ...current, generalResourceIds: [...new Set([...current.generalResourceIds, ...uploaded.map((resource) => resource.id)])] })); }); }} /></label></div>
          <button className="ac-clear-filters" disabled={busy} onClick={() => run(async () => { const result = await checkUnitDriveChanges(unit.id, unitResources.filter((resource) => resource.source === "drive").map((resource) => resource.id)); setDriveChecks(Object.fromEntries(result.results.map((entry) => [entry.resourceId, entry]))); setNotice("Comprobación de Nube AES terminada."); })}>Comprobar cambios de Drive</button>
          {unitResources.map((resource) => <article className="ac-unit-resource" key={resource.id}>
            <button className="ac-clear-filters" onClick={() => setSelectedResourceId(resource.id)}>{resource.name}</button>
            {needsOfficeProcessing(resource) && <><p role="status">{documentProcessingLabel(resource)}</p><button className="ac-outline-button" disabled={busy || dirty || !revision} onClick={() => run(() => processResource(resource))}>{resource.processing?.state === "failed" ? "Reintentar procesamiento" : documentProcessingReady(resource) ? resource.mimeType === "application/vnd.google-apps.presentation" ? "Aplicar imágenes" : "Aplicar PDF" : "Procesar documento"}</button></>}
            <div className="ac-unit-actions">
              {resource.id === draft.mainPresentationId ? <small>Presentación principal</small> : <label><input type="checkbox" disabled={busy} checked={draft.generalResourceIds.includes(resource.id)} onChange={() => edit({ generalResourceIds: draft.generalResourceIds.includes(resource.id) ? draft.generalResourceIds.filter((id) => id !== resource.id) : [...draft.generalResourceIds, resource.id] })} />General</label>}
              {selectedSlide && <label><input type="checkbox" disabled={busy} checked={selectedSlide.resourceIds.includes(resource.id)} onChange={() => updateSlide({ resourceIds: selectedSlide.resourceIds.includes(resource.id) ? selectedSlide.resourceIds.filter((id) => id !== resource.id) : [...selectedSlide.resourceIds, resource.id] })} />Diapositiva {selectedSlide.index + 1}</label>}
            </div>
            {driveChecks[resource.id] && <p className={driveChecks[resource.id].status === "changed" ? "ac-unit-change" : ""}>{driveChecks[resource.id].status === "changed" ? "Nueva versión disponible en Nube AES" : driveChecks[resource.id].status === "current" ? "Original sin cambios" : driveChecks[resource.id].message}</p>}
            {driveChecks[resource.id]?.status === "changed" && <button className="ac-outline-button" disabled={busy || dirty || !revision} title="Guarda antes de actualizar. Revisa páginas y asociaciones después." onClick={() => run(async () => { const result = await refreshUnitDriveResource(unit.id, resource.id, revision); setRevision(result.draftRevision); setDriveChecks((current) => ({ ...current, [resource.id]: { status: "current" } })); setNotice("Original actualizado en borrador. Revisa correspondencia de diapositivas antes de publicar."); })}>Actualizar borrador desde original</button>}
          </article>)}
          {!unitResources.length && <p>Importa o sube recursos para comenzar.</p>}
        </section>
      </div>
      {selectedResource && <ResourceInspector key={`${selectedResource.id}-${selectedResource.version || 0}`} resource={selectedResource} readOnly />}
      <section className="ac-unit-card">
        <h2>Publicaciones inmutables</h2>{!publications.length && <p>Aún no hay versiones publicadas.</p>}
        {publications.map((publication) => <div className="ac-unit-actions" key={publication.version}><strong>Versión {publication.version}</strong><span>{publication.manifest.publishedAt}</span><button className="ac-clear-filters" onClick={() => setManifestVersion(publication.version)}>Ver manifest</button><button className="ac-clear-filters" onClick={() => downloadManifest(publication)}>Descargar JSON</button></div>)}
        {version && <pre className="ac-unit-manifest">{JSON.stringify(version.manifest, null, 2)}</pre>}
      </section>
      {importMode && <DriveResourceImportDialog unit={unit} resources={resources} selectionLimit={importMode === "main" ? 1 : undefined} acceptFile={importMode === "main" ? acceptMainFile : undefined} onClose={() => setImportMode("")} onImport={async (files, folderId, progress) => {
        const result = await onImport(files, folderId, progress);
        if (result.imported.length) {
          if (importMode === "main") chooseMain(result.imported[0].id);
          else edit((current) => ({ ...current, generalResourceIds: [...new Set([...current.generalResourceIds, ...result.imported.map((resource) => resource.id)])].filter((id) => id !== current.mainPresentationId) }));
        }
        return result;
      }} />}
    </section>
  );
}
