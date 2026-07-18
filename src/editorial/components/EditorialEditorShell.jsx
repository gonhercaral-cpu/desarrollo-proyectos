import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorialDocumentNavigation } from "../hooks/useEditorialDocumentNavigation";
import { clearEditorialPageDraft } from "../hooks/useEditorialAutosave";
import { useEditorialDesignSystem } from "../hooks/useEditorialDesignSystem";
import { useEditorialEditorState } from "../hooks/useEditorialEditorState";
import { useEditorialOrdering } from "../hooks/useEditorialOrdering";
import { useEditorialProjects } from "../hooks/useEditorialProjects";
import { useEditorialVariant } from "../hooks/useEditorialVariant";
import { useEditorialProduction } from "../hooks/useEditorialProduction";
import { useEditorialPublications } from "../hooks/useEditorialPublications";
import { primeEditorialPagePreview, useEditorialPagePreviewElements } from "../hooks/useEditorialPagePreviewElements";
import { useEditorialProject } from "../hooks/useEditorialProject";
import { useEditorialShortcuts } from "../hooks/useEditorialShortcuts";
import { getProjectTypeLabel } from "../models/editorialModels";
import { levelCan, resolveEditorialLevel } from "../models/editorialPermissions";
import { getUserDepartmentIds } from "../../utils/departmentMembership";
import { buildPrintAutofill } from "../utils/editorialPrintPayload";
import { buildEditorialLinkRecord, deriveEditorialMetrics } from "../utils/editorialProjectLink";
import { createEditorialDriveFolder, createEditorialPrintRequest, saveEditorialExportToDrive } from "../services/editorialIntegrationsService";
import { addProjectEvidence, getProjectsLinkedToEditorialDocument, getVisibleProjects, linkEditorialDocument, unlinkEditorialDocument } from "../../services/projectsService";
import { createEditorialProject, updateEditorialPermissions, updateEditorialProjectConfig } from "../services/editorialProjectsService";
import { updateEditorialAcademicMetadata, getRelatedEditorialMaterials } from "../services/editorialAcademicService";
import { assignMasterPage, createEditorialMasterPage, deleteEditorialMasterPage, duplicateEditorialMasterPage, updateEditorialMasterPage } from "../services/editorialMasterPagesService";
import { createEditorialComponent, deleteEditorialComponent, duplicateEditorialComponent, updateEditorialComponent } from "../services/editorialComponentsService";
import { createEditorialStyle, deleteEditorialStyle, duplicateEditorialStyle, updateEditorialStyle } from "../services/editorialStylesService";
import { applyEditorialTemplate, createEditorialTemplate, deleteEditorialTemplate, replaceEditorialTemplateContent, updateEditorialTemplate } from "../services/editorialTemplatesService";
import { deleteEditorialVariable, saveEditorialVariable } from "../services/editorialVariablesService";
import { clampZoom, getPageMetrics } from "../utils/editorialMeasurements";
import { getEditorialSpread } from "../utils/editorialSpreads";
import { buildEditorialVariableValues } from "../utils/editorialVariables";
import { createMasterOverride, detachMasterElement, resolveLocalElements, resolveMasterElements } from "../utils/editorialInheritance";
import { createAcademicBlock, generateAcademicExercise } from "../utils/editorialAcademicGenerators";
import { createSongSheet } from "../utils/editorialSongGenerator";
import { resolveAcademicViewElements } from "../utils/editorialAcademicVisibility";
import { validateAcademicElements, validateAcademicLink } from "../utils/editorialAcademicValidation";
import { normalizeAcademicMetadata } from "../models/editorialAcademic";
import { createAutomaticIndexElement, isAutomaticIndexStale, refreshAutomaticIndexElement, resolveAutomaticIndexElement } from "../utils/editorialAutomaticIndex";
import { downloadEditorialBlob, resolveEditorialDownloadUrl } from "../services/editorialExportsService";
import { resolveDownloadTarget } from "../utils/editorialDownloads";
import EditorialIcon from "./EditorialIcon";
import EditorialAcademicMetadataDialog from "./academic/EditorialAcademicMetadataDialog";
import EditorialExerciseDialog from "./academic/EditorialExerciseDialog";
import EditorialSongDialog from "./academic/EditorialSongDialog";
import EditorialIndexDialog from "./production/EditorialIndexDialog";
import EditorialExportDialog from "./production/EditorialExportDialog";
import EditorialDesignDialog from "./design/EditorialDesignDialog";
import EditorialProjectDialog from "./EditorialProjectDialog";
import EditorialEditorToolbar from "./editor/EditorialEditorToolbar";
import EditorialMenuBar from "./editor/EditorialMenuBar";
import { buildEditorialCommands } from "../utils/editorialCommands";
import EditorialInspectorPanel from "./editor/EditorialInspectorPanel";
import EditorialWorkspace from "./editor/EditorialWorkspace";
import EditorialBottomPanel from "./structure/EditorialBottomPanel";
import EditorialPageDialog from "./structure/EditorialPageDialog";
import EditorialSectionDialog from "./structure/EditorialSectionDialog";
import EditorialStructureDeleteDialog from "./structure/EditorialStructureDeleteDialog";
import EditorialStructurePanel from "./structure/EditorialStructurePanel";
import EditorialIntegrationsDialog from "./production/EditorialIntegrationsDialog";
import EditorialReadView from "./EditorialReadView";
import EditorialPermissionsDialog from "./EditorialPermissionsDialog";

const RAIL_ITEMS = [
  ["projects", "Proyectos"], ["books", "Libros"], ["material", "Material"],
  ["templates", "Plantillas"], ["resources", "Recursos"], ["components", "Componentes"],
  ["styles", "Estilos"], ["reviews", "Revisiones"], ["approvals", "Aprobaciones"],
];
const ACTIVE_RAILS = new Set(["books", "material", "resources", "templates", "components", "styles", "reviews", "approvals"]);

function getInitials(profile) {
  return (profile?.name || profile?.email || "U").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function getPageProject(project, page) {
  return { ...project, widthIn: page?.width || project.widthIn, heightIn: page?.height || project.heightIn, orientation: page?.orientation || project.orientation };
}

function QuickPreview({ project, pages, onClose }) {
  return (
    <div className="editorial-dialog-layer">
      <button type="button" className="editorial-dialog-backdrop" onClick={onClose} aria-label="Cerrar vista rápida" />
      <section className="editorial-quick-preview-dialog" role="dialog" aria-modal="true" aria-label="Vista rápida">
        <header><div><span className="editorial-eyebrow">Vista rápida</span><h2>{project.name}</h2></div><button type="button" className="editorial-icon-button" onClick={onClose} aria-label="Cerrar"><EditorialIcon name="close" /></button></header>
        <div className={`editorial-preview-paper ${project.orientation}`}><span>{pages.length} páginas</span></div>
        <p>Vista estructural. Páginas y elementos permanecen editables en Firestore.</p>
      </section>
    </div>
  );
}

function EditorialEditorReady({ project, documents, profile, theme, onToggleTheme, onBack, onOpenProject }) {
  const navigation = useEditorialDocumentNavigation({ project, documents, user: profile });
  const activePage = navigation.activePage;
  const design = useEditorialDesignSystem({ project, documentId: navigation.documentId });
  const [editorMode, setEditorMode] = useState({ kind: "page", id: "" });
  const activeMaster = editorMode.kind === "master" ? design.mastersById.get(editorMode.id) : null;
  const activeComponent = editorMode.kind === "component" ? design.componentsById.get(editorMode.id) : null;
  const context = useMemo(() => editorMode.kind === "master"
    ? { kind: "master", projectId: project.id, documentId: navigation.documentId, masterPageId: editorMode.id }
    : editorMode.kind === "component"
      ? { kind: "component", projectId: project.id, componentId: editorMode.id }
      : { kind: "page", projectId: project.id, documentId: navigation.documentId, pageId: activePage?.id || "" }, [activePage?.id, editorMode.id, editorMode.kind, navigation.documentId, project.id]);
  const editor = useEditorialEditorState({ context, user: profile });
  useEditorialShortcuts(editor.actions);
  const variantState = useEditorialVariant("student");
  const projectLibrary = useEditorialProjects({ profile, isAdmin: String(profile?.role || "").toLowerCase() === "admin", filter: "all", search: "" });
  const isAdminUser = String(profile?.role || "").toLowerCase() === "admin";
  const editorialLevel = useMemo(
    () => resolveEditorialLevel({ project, user: profile, isAdmin: isAdminUser, userDepartmentIds: getUserDepartmentIds(profile) }),
    [isAdminUser, profile, project]
  );
  const caps = useMemo(() => ({
    level: editorialLevel,
    view: levelCan(editorialLevel, "view"),
    download: levelCan(editorialLevel, "download"),
    comment: levelCan(editorialLevel, "comment"),
    edit_content: levelCan(editorialLevel, "edit_content"),
    edit_design: levelCan(editorialLevel, "edit_design"),
    review: levelCan(editorialLevel, "review"),
    publish: levelCan(editorialLevel, "publish"),
    manage: levelCan(editorialLevel, "manage"),
    viewTeacher: levelCan(editorialLevel, "edit_content") || levelCan(editorialLevel, "review") || levelCan(editorialLevel, "manage"),
  }), [editorialLevel]);
  const publications = useEditorialPublications({ projectId: project.id, documentId: navigation.documentId, project, user: profile });
  const production = useEditorialProduction({ projectId: project.id, documentId: navigation.documentId, pages: navigation.pages, user: profile, project, versionGuard: publications.versionGuard, exportGuard: publications.exportGuard });
  const [integrationsDialog, setIntegrationsDialog] = useState(null);
  const [integrationsBusy, setIntegrationsBusy] = useState(false);
  const [integrationsError, setIntegrationsError] = useState("");
  const [readViewOpen, setReadViewOpen] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState(null);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [permissionsBusy, setPermissionsBusy] = useState(false);
  const [permissionsError, setPermissionsError] = useState("");
  const [visibleProjects, setVisibleProjects] = useState([]);
  const [linkedProjects, setLinkedProjects] = useState([]);
  const [projectLinkBusy, setProjectLinkBusy] = useState(false);
  const [projectLinkError, setProjectLinkError] = useState("");

  const editorialMetrics = useMemo(
    () => deriveEditorialMetrics({ document: { ...navigation.document, reviewState: production.reviewState, preflightSummary: production.preflightSummary, currentVersionNumber: production.versions[0]?.versionNumber || 0 }, pages: navigation.pages, publications: publications.publications }),
    [navigation.document, navigation.pages, production.preflightSummary, production.reviewState, production.versions, publications.publications]
  );

  const refreshLinkedProjects = useCallback(() => {
    if (!navigation.documentId) return;
    getProjectsLinkedToEditorialDocument(navigation.documentId).then(setLinkedProjects).catch(() => setLinkedProjects([]));
  }, [navigation.documentId]);

  useEffect(() => {
    if (!caps.edit_content) return;
    getVisibleProjects(profile).then(setVisibleProjects).catch(() => setVisibleProjects([]));
  }, [caps.edit_content, profile]);
  useEffect(() => { refreshLinkedProjects(); }, [refreshLinkedProjects]);

  function handleLinkProject(targetProjectId) {
    if (!targetProjectId) return;
    setProjectLinkBusy(true); setProjectLinkError("");
    const editorial = buildEditorialLinkRecord({ project, document: { id: navigation.documentId, title: project.name }, user: profile });
    linkEditorialDocument({ projectId: targetProjectId, editorial, metrics: editorialMetrics, currentUser: profile })
      .then(() => refreshLinkedProjects())
      .catch((error) => setProjectLinkError(error.message || "No fue posible vincular."))
      .finally(() => setProjectLinkBusy(false));
  }

  function handleUnlinkProject(targetProjectId) {
    setProjectLinkBusy(true); setProjectLinkError("");
    unlinkEditorialDocument({ projectId: targetProjectId, editorialDocumentId: navigation.documentId, currentUser: profile })
      .then(() => refreshLinkedProjects())
      .catch((error) => setProjectLinkError(error.message || "No fue posible desvincular."))
      .finally(() => setProjectLinkBusy(false));
  }

  function handleSavePermissions(permissions) {
    setPermissionsBusy(true); setPermissionsError("");
    updateEditorialPermissions({ projectId: project.id, project, permissions, user: profile })
      .then(() => setPermissionsOpen(false))
      .catch((error) => setPermissionsError(error.message || "No fue posible guardar permisos."))
      .finally(() => setPermissionsBusy(false));
  }

  function handleAttachEvidence(targetProjectId, exportItem) {
    setProjectLinkBusy(true); setProjectLinkError("");
    addProjectEvidence({
      projectId: targetProjectId,
      title: `Editorial · ${project.name} · ${exportItem.variant || exportItem.type}`,
      description: "Exportación editorial adjunta como entregable.",
      fileUrl: exportItem.downloadUrl || exportItem.downloadURL || "",
      storagePath: exportItem.storagePath || "",
      sourceModule: "editorial",
      editorialExportId: exportItem.id || "",
    }, profile)
      .catch((error) => setProjectLinkError(error.message || "No fue posible adjuntar la evidencia."))
      .finally(() => setProjectLinkBusy(false));
  }

  const workspaceRef = useRef(null);
  const menuFileInputRef = useRef(null);
  const [activeRail, setActiveRail] = useState("books");
  const [activeInspector, setActiveInspector] = useState("Propiedades");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [quickPreviewOpen, setQuickPreviewOpen] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [pageDialog, setPageDialog] = useState(null);
  const [sectionDialog, setSectionDialog] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [designDialog, setDesignDialog] = useState(null);
  const [designBusy, setDesignBusy] = useState(false);
  const [academicBusy, setAcademicBusy] = useState(false);
  const [academicDialog, setAcademicDialog] = useState(null);
  const [exerciseDialog, setExerciseDialog] = useState(null);
  const [songDialogOpen, setSongDialogOpen] = useState(false);
  const [indexDialogOpen, setIndexDialogOpen] = useState(false);
  const [exportDialog, setExportDialog] = useState(null);
  const pendingFocusRef = useRef(null);
  const [zoom, setZoomState] = useState(0.75);
  const [viewMode, setViewMode] = useState("single");
  const [showRulers, setShowRulers] = useState(true);
  const [guideSettings, setGuideSettings] = useState({ bleed: true, cut: true, safe: true, margins: true, gutter: true });
  const editableSurface = useMemo(() => activeMaster || (activeComponent ? { ...activePage, name: activeComponent.name } : activePage), [activeComponent, activeMaster, activePage]);
  const metrics = useMemo(() => getPageMetrics(getPageProject(project, editableSurface)), [editableSurface, project]);
  const setZoom = useCallback((value) => setZoomState(clampZoom(value)), []);
  const spread = useMemo(() => getEditorialSpread(navigation.pages, activePage?.id, viewMode, navigation.sections), [activePage?.id, navigation.pages, navigation.sections, viewMode]);
  const secondaryPage = spread.pages.find((page) => page.id !== activePage?.id) || null;
  const secondaryContext = useMemo(() => ({ kind: "page", projectId: project.id, documentId: navigation.documentId, pageId: secondaryPage?.id || "" }), [navigation.documentId, project.id, secondaryPage?.id]);
  const secondaryElements = useEditorialPagePreviewElements(secondaryContext, Boolean(secondaryPage));
  const activeSection = navigation.sections.find((section) => section.id === activePage?.sectionId) || null;
  const variableValues = useMemo(() => buildEditorialVariableValues({ project, document: navigation.document, page: activePage, section: activeSection, sections: navigation.sections, numbering: navigation.numbering, customVariables: design.variables, variant: variantState.variant }), [activePage, activeSection, design.variables, navigation.document, navigation.numbering, navigation.sections, project, variantState.variant]);
  const automaticIndexInput = useMemo(() => ({ pages: navigation.pages, sections: navigation.sections, numbering: navigation.numbering }), [navigation.numbering, navigation.pages, navigation.sections]);
  const resolvedElements = useMemo(() => resolveAcademicViewElements(resolveLocalElements(editor.elements, { stylesById: design.stylesById, componentsById: design.componentsById, variables: variableValues }), variantState.variant, false).map((element) => resolveAutomaticIndexElement(element, automaticIndexInput)), [automaticIndexInput, design.componentsById, design.stylesById, editor.elements, variableValues, variantState.variant]);
  const renderedElements = useMemo(() => resolveAcademicViewElements(resolvedElements, variantState.variant), [resolvedElements, variantState.variant]);
  const resolvedSelectedElement = resolvedElements.find((element) => element.id === editor.selectedId) || null;
  const resolvedSelectedElements = resolvedElements.filter((element) => editor.selectedIds.includes(element.id));
  const handleCanvasElementChange = useCallback((elementId, changes) => {
    const raw = editor.elements.find((element) => element.id === elementId);
    const resolved = resolvedElements.find((element) => element.id === elementId);
    if (!raw?.componentId || !resolved) { editor.actions.updateElement(elementId, changes); return; }
    const adjusted = { ...changes };
    if (Object.hasOwn(changes, "x")) adjusted.x = raw.x + (Number(changes.x) - resolved.x);
    if (Object.hasOwn(changes, "y")) adjusted.y = raw.y + (Number(changes.y) - resolved.y);
    if (Object.hasOwn(changes, "width")) adjusted.width = raw.width * (Number(changes.width) / Math.max(1, resolved.width));
    if (Object.hasOwn(changes, "height")) adjusted.height = raw.height * (Number(changes.height) / Math.max(1, resolved.height));
    if (Object.hasOwn(changes, "rotation")) adjusted.rotation = raw.rotation + (Number(changes.rotation) - resolved.rotation);
    editor.actions.updateElement(elementId, adjusted);
  }, [editor.actions, editor.elements, resolvedElements]);
  const activePageMaster = activePage?.masterPageId ? design.mastersById.get(activePage.masterPageId) : null;
  const activeMasterElements = useMemo(() => activePageMaster ? resolveAcademicViewElements(resolveMasterElements(activePageMaster.elements || [], activePage?.masterOverrides, { stylesById: design.stylesById, variables: variableValues }), variantState.variant) : [], [activePage?.masterOverrides, activePageMaster, design.stylesById, variableValues, variantState.variant]);
  const academicMetadata = useMemo(() => ({
    ...normalizeAcademicMetadata(project), ...normalizeAcademicMetadata(navigation.document),
    ...normalizeAcademicMetadata(activeSection), ...normalizeAcademicMetadata(activePage),
  }), [activePage, activeSection, navigation.document, project]);
  const relatedProjects = useMemo(() => getRelatedEditorialMaterials(projectLibrary.projects, project, academicMetadata), [academicMetadata, project, projectLibrary.projects]);
  const academicWarnings = useMemo(() => [...validateAcademicElements(editor.elements, variableValues), ...validateAcademicLink(academicMetadata)], [academicMetadata, editor.elements, variableValues]);
  const automaticIndexElement = editor.elements.find((element) => element.automaticIndex) || null;
  const indexState = useMemo(() => ({ exists: Boolean(automaticIndexElement), stale: automaticIndexElement ? isAutomaticIndexStale(automaticIndexElement, automaticIndexInput) : false }), [automaticIndexElement, automaticIndexInput]);

  useEffect(() => {
    if (editorMode.kind === "page" && activePage?.id) primeEditorialPagePreview(context, editor.elements);
  }, [activePage?.id, context, editor.elements, editorMode.kind]);

  const flushThen = useCallback(async (operation) => {
    setDialogError("");
    try {
      await editor.flush();
      editor.select("");
      return await operation();
    } catch (error) {
      setDialogError(error.message || "No fue posible actualizar la estructura.");
      throw error;
    }
  }, [editor]);

  const handleSelectPage = useCallback(async (pageId) => {
    if (pageId === activePage?.id && editorMode.kind === "page") return;
    try { await flushThen(async () => { setEditorMode({ kind: "page", id: "" }); navigation.selectPage(pageId); }); } catch { /* notice already visible */ }
  }, [activePage?.id, editorMode.kind, flushThen, navigation]);

  useEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    if (!pendingFocus || editorMode.kind !== "page" || activePage?.id !== pendingFocus.pageId) return;
    editor.select(pendingFocus.elementId || "");
    pendingFocusRef.current = null;
  }, [activePage?.id, editor, editorMode.kind]);

  const handleNavigateIssue = useCallback(async (item) => {
    if (!item.pageId) return;
    pendingFocusRef.current = { pageId: item.pageId, elementId: item.elementId || "" };
    await handleSelectPage(item.pageId);
  }, [handleSelectPage]);

  function handleIndexAction(action) {
    if (editorMode.kind !== "page") { setDialogError("Abre una página para insertar índice."); return; }
    if (action === "refresh" && automaticIndexElement) {
      editor.actions.updateElement(automaticIndexElement.id, { automaticIndex: refreshAutomaticIndexElement(automaticIndexElement, automaticIndexInput).automaticIndex });
      return;
    }
    setIndexDialogOpen(true);
  }

  function submitIndex(config) {
    if (automaticIndexElement) {
      const next = { ...automaticIndexElement, automaticIndex: { ...automaticIndexElement.automaticIndex, ...config } };
      editor.actions.updateElement(automaticIndexElement.id, { automaticIndex: refreshAutomaticIndexElement(next, automaticIndexInput).automaticIndex });
    }
    else {
      const [created] = editor.actions.addElements([createAutomaticIndexElement(automaticIndexInput, editor.elements.length, config)], { offsetX: 0, offsetY: 0 });
      editor.select(created.id);
    }
    setIndexDialogOpen(false);
  }

  async function submitExport(settings) {
    try {
      await editor.flush();
      const results = await production.actions.exportDocument(settings);
      results.forEach((item) => downloadEditorialBlob(item.blob, item.name));
      setExportDialog(null);
    } catch { /* error visible in production panel */ }
  }

  async function downloadStoredExport(item) {
    if (!caps.download) { setDownloadNotice({ type: "error", text: "No tienes permiso para descargar." }); return; }
    const target = resolveDownloadTarget(item, { projectName: project.name });
    if (!target) { setDownloadNotice({ type: "error", text: "Esta exportación no tiene archivo descargable." }); return; }
    setDownloadNotice({ type: "loading", text: "Preparando descarga…" });
    try {
      const url = await resolveEditorialDownloadUrl(item);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = target.name; anchor.target = "_blank"; anchor.rel = "noreferrer";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setDownloadNotice({ type: "success", text: "Descarga iniciada." });
      setTimeout(() => setDownloadNotice(null), 2500);
    } catch (error) {
      console.error("Editorial: fallo al descargar exportación", error);
      setDownloadNotice({ type: "error", text: error.message || "No fue posible descargar el archivo." });
    }
  }

  function handlePublish(payload) {
    publications.actions.publish(payload).catch(() => { /* error visible in publications panel */ });
  }

  function saveIntegrationsDrive({ folder, confirmReplace }) {
    if (!integrationsDialog?.exportItem || !folder) return;
    setIntegrationsBusy(true); setIntegrationsError("");
    saveEditorialExportToDrive({ projectId: project.id, documentId: navigation.documentId, exportItem: integrationsDialog.exportItem, folder, confirmReplace, user: profile })
      .then(() => setIntegrationsDialog(null))
      .catch((error) => setIntegrationsError(error.message || "No fue posible guardar en Nube AES."))
      .finally(() => setIntegrationsBusy(false));
  }

  function createIntegrationsFolder({ name, parentId }) {
    return createEditorialDriveFolder({ parentId, name });
  }

  function sendIntegrationsPrint(form) {
    if (!integrationsDialog?.exportItem) return;
    setIntegrationsBusy(true); setIntegrationsError("");
    createEditorialPrintRequest({ project, document: { id: navigation.documentId, title: project.name, pageCount: navigation.pages.length }, exportItem: integrationsDialog.exportItem, form, user: profile })
      .then(() => setIntegrationsDialog(null))
      .catch((error) => setIntegrationsError(error.message || "No fue posible crear la solicitud de imprenta."))
      .finally(() => setIntegrationsBusy(false));
  }

  const openEditorContext = useCallback(async (kind, id) => {
    try { await flushThen(() => setEditorMode({ kind, id })); } catch { /* notice already visible */ }
  }, [flushThen]);

  const ordering = useEditorialOrdering({
    onReorderPage: (sourceId, targetId, placement) => flushThen(() => navigation.reorderPages(sourceId, targetId, placement)),
    onMovePageToSection: (pageId, sectionId) => flushThen(() => navigation.movePageToSection(pageId, sectionId)),
    onReorderSection: (sourceId, targetId) => flushThen(() => navigation.reorderSections(sourceId, targetId)),
  });

  async function handleBack() {
    try { await editor.flush(); onBack(); } catch (error) { setDialogError(error.message); }
  }

  async function handleSaveConfig(form) {
    editor.reportStatus("saving");
    setSaveError("");
    try {
      await editor.flush();
      await updateEditorialProjectConfig(project.id, form, profile);
      editor.reportStatus("saved");
      setConfigOpen(false);
    } catch (error) {
      editor.reportStatus("error", error.message);
      setSaveError(error.message || "No fue posible guardar los cambios.");
    }
  }

  function openCreatePage(defaults = {}) {
    setDialogError("");
    setPageDialog({ mode: "create", defaults });
  }

  async function handlePageSubmit(values) {
    const dialog = pageDialog;
    try {
      if (dialog.mode === "rename") await flushThen(() => navigation.updatePage(dialog.page.id, { name: values.name }));
      else await flushThen(() => navigation.createPage({ ...dialog.defaults, ...values }));
      setPageDialog(null);
    } catch { /* error visible in dialog */ }
  }

  async function handleSectionSubmit(values) {
    try {
      if (sectionDialog.section) await flushThen(() => navigation.updateSection(sectionDialog.section.id, values));
      else await flushThen(() => navigation.createSection(values));
      setSectionDialog(null);
    } catch { /* error visible in dialog */ }
  }

  async function handlePageAction(action, page, value) {
    try {
      if (action === "insert") return openCreatePage({ referencePageId: page.id, placement: value, sectionId: page.sectionId });
      if (action === "rename") return setPageDialog({ mode: "rename", page });
      if (action === "delete") return setDeleteTarget({ kind: "page", item: page });
      if (action === "duplicate") await flushThen(() => navigation.duplicatePage(page.id));
      if (action === "blank") await flushThen(() => navigation.updatePage(page.id, { isBlank: !page.isBlank }));
      if (action === "numbering") await flushThen(() => navigation.updatePage(page.id, { numberingEnabled: !page.numberingEnabled }));
      if (action === "move") await flushThen(() => navigation.movePageToSection(page.id, value));
    } catch { /* error visible in structure notice */ }
  }

  async function handleDelete(options) {
    try {
      if (deleteTarget.kind === "page") await flushThen(() => navigation.deletePage(deleteTarget.item.id));
      else await flushThen(() => navigation.deleteSection(deleteTarget.item.id, options));
      setDeleteTarget(null);
    } catch { /* error visible in dialog */ }
  }

  async function handleDesignAction(action, item, extra) {
    setDialogError("");
    if (action === "edit-master") return openEditorContext("master", item.id);
    if (action === "open-component") return openEditorContext("component", item.id);
    if (action === "insert-component") {
      if (editorMode.kind !== "page") { setDialogError("Abre una página para insertar el componente."); return; }
      editor.actions.insertComponent(item);
      return;
    }
    if (action === "apply-style") {
      if (!editor.selectedElement) return;
      if (editor.selectedElement.type !== item.type) return setDialogError("El estilo no es compatible con el elemento seleccionado.");
      editor.actions.applyStyle(editor.selectedElement.id, item);
      return;
    }
    if (action === "detach-component-instance") {
      const resolvedById = new Map(resolvedElements.map((element) => [element.id, element]));
      editor.actions.detachComponentInstance(item.componentInstanceId, resolvedById);
      return;
    }
    if (["override-master", "restore-master", "detach-master"].includes(action)) {
      if (!activePage || !activePageMaster) return;
      const overrides = { ...(activePage.masterOverrides || {}) };
      if (action === "restore-master") {
        if (overrides[item.id]?.detachedElementId) editor.actions.removeElement(overrides[item.id].detachedElementId);
        delete overrides[item.id];
      }
      else if (action === "override-master") overrides[item.id] = createMasterOverride(overrides[item.id], extra);
      else {
        const detached = detachMasterElement(item, overrides[item.id], editor.elements.length);
        const [created] = editor.actions.addElements([detached], { offsetX: 0, offsetY: 0 });
        overrides[item.id] = createMasterOverride(overrides[item.id], { detachedElementId: created.id });
        await editor.flush();
      }
      await navigation.updatePage(activePage.id, { masterOverrides: overrides });
      return;
    }
    if (action === "show-variables") { setActiveInspector("Estilos"); return; }

    const base = { action, item };
    if (action === "create-master") setDesignDialog({ ...base, title: "Nueva página maestra", fields: ["name", "side"], values: { name: "Nueva maestra", side: "any" } });
    else if (action === "rename-master") setDesignDialog({ ...base, title: "Renombrar maestra", fields: ["name", "side"], values: item });
    else if (action === "assign-master") setDesignDialog({ ...base, title: `Asignar ${item.name}`, fields: ["pages"], options: navigation.pages, values: { pageIds: activePage ? [activePage.id] : [] }, submitLabel: "Asignar" });
    else if (action === "delete-master") setDesignDialog({ ...base, title: "Eliminar página maestra", fields: ["replacement", "confirm"], options: design.masters.filter((master) => master.id !== item.id), values: { replacement: "unlink" }, message: "Las páginas vinculadas deben reasignarse o desvincularse.", danger: true, submitLabel: "Eliminar" });
    else if (action === "save-page") setDesignDialog({ ...base, title: "Guardar página como plantilla", fields: ["name", "description", "category", "visibility"], allowInstitutional: String(profile?.role || "").toLowerCase() === "admin", values: { name: activePage?.name || "Nueva plantilla", category: "General", visibility: "project", type: "page" } });
    else if (action === "save-unit") setDesignDialog({ ...base, title: "Guardar unidad como plantilla", fields: ["name", "description", "category", "visibility"], allowInstitutional: String(profile?.role || "").toLowerCase() === "admin", values: { name: activeSection?.name || "Nueva unidad", category: "Unidades", visibility: "project", type: "unit" } });
    else if (action === "apply-template") setDesignDialog({ ...base, title: `Crear desde ${item.name}`, fields: ["confirm"], message: "Se crearán páginas nuevas; el contenido actual no se sobrescribirá.", submitLabel: "Crear" });
    else if (action === "edit-template") setDesignDialog({ ...base, title: "Editar plantilla", fields: ["name", "description", "category", "visibility"], allowInstitutional: String(profile?.role || "").toLowerCase() === "admin", values: item });
    else if (action === "update-template-content") setDesignDialog({ ...base, title: "Actualizar contenido de plantilla", fields: ["confirm"], message: "La plantilla tomará el contenido actual de la página o unidad. Las páginas ya creadas no cambiarán.", submitLabel: "Actualizar" });
    else if (action === "delete-template") setDesignDialog({ ...base, title: "Eliminar plantilla", fields: ["confirm"], message: "Se eliminarán su estructura y elementos. Las páginas creadas antes no cambiarán.", danger: true, submitLabel: "Eliminar" });
    else if (action === "create-component") setDesignDialog({ ...base, title: "Nuevo componente", fields: ["name", "description", "category"], values: { name: editor.selectedElement?.name || "Nuevo componente", category: "General" } });
    else if (action === "edit-component") setDesignDialog({ ...base, title: "Editar componente", fields: ["name", "description", "category"], values: item });
    else if (action === "delete-component") setDesignDialog({ ...base, title: "Eliminar componente", fields: ["confirm"], message: "Las instancias se convertirán en elementos locales antes de eliminar.", danger: true, submitLabel: "Desvincular y eliminar" });
    else if (action === "create-style") setDesignDialog({ ...base, title: "Nuevo estilo global", fields: ["name", "category", "styleProperties"], styleType: resolvedSelectedElement?.type, values: { name: resolvedSelectedElement?.name || "Nuevo estilo", category: "General", properties: resolvedSelectedElement?.style || {} } });
    else if (action === "edit-style") setDesignDialog({ ...base, title: "Editar estilo global", fields: ["name", "category", "styleProperties"], styleType: item.type, values: item });
    else if (action === "delete-style") setDesignDialog({ ...base, title: "Eliminar estilo", fields: ["confirm"], message: "Los elementos vinculados conservarán la apariencia actual y se desvincularán.", danger: true, submitLabel: "Desvincular y eliminar" });
    else if (action === "create-variable") setDesignDialog({ ...base, title: "Nueva variable", fields: ["key", "value"], values: { key: "custom.", value: "" } });
    else if (action === "edit-variable") setDesignDialog({ ...base, title: "Editar variable", fields: ["key", "value"], values: item });
    else if (action === "delete-variable") setDesignDialog({ ...base, title: "Eliminar variable", fields: ["confirm"], message: `Los placeholders {{${item.key}}} mostrarán el fallback.`, danger: true, submitLabel: "Eliminar" });
    else if (action === "duplicate-master" || action === "duplicate-component" || action === "duplicate-style") {
      try {
        await editor.flush();
        if (action === "duplicate-master") await duplicateEditorialMasterPage({ projectId: project.id, documentId: navigation.documentId, master: item, elements: item.elements, user: profile });
        if (action === "duplicate-component") await duplicateEditorialComponent({ projectId: project.id, component: item, elements: item.elements, user: profile });
        if (action === "duplicate-style") await duplicateEditorialStyle({ projectId: project.id, style: item, user: profile });
      } catch (error) { setDialogError(error.message); }
    }
  }

  async function submitDesignDialog(values) {
    const { action, item } = designDialog;
    setDesignBusy(true);
    setDialogError("");
    editor.reportStatus("saving");
    try {
      await editor.flush();
      if (action === "create-master") {
        const id = await createEditorialMasterPage({ projectId: project.id, documentId: navigation.documentId, project, values, user: profile });
        setEditorMode({ kind: "master", id });
      } else if (action === "rename-master") await updateEditorialMasterPage({ projectId: project.id, documentId: navigation.documentId, masterPageId: item.id, changes: values, user: profile });
      else if (action === "assign-master") await assignMasterPage({ projectId: project.id, documentId: navigation.documentId, pageIds: values.pageIds || [], masterPageId: item.id, user: profile });
      else if (action === "delete-master") {
        await deleteEditorialMasterPage({ projectId: project.id, documentId: navigation.documentId, masterPageId: item.id, replacementMasterPageId: values.replacement === "unlink" ? "" : values.replacement, unlink: values.replacement === "unlink", user: profile });
        clearEditorialPageDraft({ kind: "master", projectId: project.id, documentId: navigation.documentId, masterPageId: item.id });
        if (editorMode.kind === "master" && editorMode.id === item.id) setEditorMode({ kind: "page", id: "" });
      } else if (action === "save-page" || action === "save-unit") {
        const pages = action === "save-unit" ? navigation.pages.filter((page) => page.sectionId === activeSection?.id) : [activePage];
        await createEditorialTemplate({ projectId: project.id, documentId: navigation.documentId, pages, section: action === "save-unit" ? activeSection : null, values, user: profile });
      } else if (action === "apply-template") await applyEditorialTemplate({ projectId: project.id, documentId: navigation.documentId, template: item, project, user: profile });
      else if (action === "edit-template") await updateEditorialTemplate({ templateId: item.id, changes: values, user: profile });
      else if (action === "update-template-content") {
        const section = item.type === "unit" || item.type === "section" ? activeSection : null;
        const pages = section ? navigation.pages.filter((page) => page.sectionId === section.id) : [activePage];
        await replaceEditorialTemplateContent({ template: item, projectId: project.id, documentId: navigation.documentId, pages, section, user: profile });
      }
      else if (action === "delete-template") await deleteEditorialTemplate({ templateId: item.id });
      else if (action === "create-component") await createEditorialComponent({ projectId: project.id, values: { ...values, ...academicMetadata }, elements: resolvedSelectedElements, user: profile });
      else if (action === "edit-component") await updateEditorialComponent({ projectId: project.id, componentId: item.id, changes: values, user: profile });
      else if (action === "delete-component") {
        await deleteEditorialComponent({ projectId: project.id, componentId: item.id, detachInstances: true, user: profile });
        clearEditorialPageDraft({ kind: "component", projectId: project.id, componentId: item.id });
        if (editorMode.kind === "component" && editorMode.id === item.id) setEditorMode({ kind: "page", id: "" });
      } else if (action === "create-style") {
        const styleId = await createEditorialStyle({ projectId: project.id, values, element: { ...resolvedSelectedElement, style: values.properties }, user: profile });
        editor.actions.applyStyle(editor.selectedElement.id, { id: styleId });
        await editor.flush();
      } else if (action === "edit-style") await updateEditorialStyle({ projectId: project.id, styleId: item.id, changes: values, user: profile });
      else if (action === "delete-style") await deleteEditorialStyle({ projectId: project.id, style: item, unlinkElements: true, user: profile });
      else if (action === "create-variable" || action === "edit-variable") await saveEditorialVariable({ projectId: project.id, variable: { ...values, id: item?.id }, user: profile });
      else if (action === "delete-variable") await deleteEditorialVariable({ projectId: project.id, variableId: item.id });
      editor.reportStatus("saved");
      setDesignDialog(null);
    } catch (error) {
      editor.reportStatus("error", error.message);
      setDialogError(error.message || "No fue posible actualizar el sistema de diseño.");
    } finally { setDesignBusy(false); }
  }

  function insertAcademicElements(elements) {
    if (!elements?.length) return;
    editor.actions.addElements(elements, { offsetX: 0, offsetY: 0 });
  }

  function handleAcademicAction(action, value) {
    setDialogError("");
    if (action === "insert-block") return insertAcademicElements(createAcademicBlock(value));
    if (action === "exercise") return setExerciseDialog({ type: value, existing: null });
    if (action === "song") return setSongDialogOpen(true);
    if (action === "answers" || action === "validate") { setActiveInspector("Respuestas"); setRightOpen(true); return; }
    if (action === "insert-component") return handleDesignAction("insert-component", value);
    if (action === "open-related") { flushThen(() => onOpenProject(value.id)).catch(() => {}); return; }
    if (action === "new-related") return setAcademicDialog({ kind: "related", title: "Nuevo material vinculado", values: academicMetadata, name: `${project.name} · Material extra` });
    if (action === "metadata") return setAcademicDialog({ kind: "metadata", title: "Vinculación académica", values: academicMetadata, target: "page", allowTarget: true });
  }

  function handleRegenerate(element) {
    if (!element?.exerciseData?.type) return;
    if (element.componentId) {
      setDialogError("Edita el componente maestro para regenerar una instancia vinculada.");
      return;
    }
    setExerciseDialog({ type: element.exerciseData.type, existing: element });
  }

  function submitExercise(values) {
    const existing = exerciseDialog.existing;
    const generated = generateAcademicExercise(exerciseDialog.type, values);
    if (existing?.academicGroupId) editor.actions.replaceAcademicGroup(existing.academicGroupId, generated);
    else insertAcademicElements(generated);
    setExerciseDialog(null);
  }

  function submitSong(values) {
    insertAcademicElements(createSongSheet(values));
    setSongDialogOpen(false);
  }

  async function submitAcademicMetadata(values) {
    setAcademicBusy(true);
    setDialogError("");
    try {
      await editor.flush();
      if (academicDialog.kind === "related") {
        const projectId = await createEditorialProject({
          ...project,
          ...values,
          name: values.name,
          type: "extra_material",
          academicType: values.academicType || "extra_material",
        }, profile);
        setAcademicDialog(null);
        onOpenProject(projectId);
        return;
      }
      const target = values.target || "page";
      const targetId = target === "page" ? activePage?.id : target === "section" ? activeSection?.id : target === "document" ? navigation.documentId : project.id;
      if (!targetId) throw new Error("El contexto seleccionado no está disponible.");
      await updateEditorialAcademicMetadata({ target, projectId: project.id, documentId: navigation.documentId, targetId, values, user: profile });
      setAcademicDialog(null);
    } catch (error) {
      setDialogError(error.message || "No fue posible guardar la vinculación académica.");
    } finally {
      setAcademicBusy(false);
    }
  }

  const spreadSlots = useMemo(() => {
    if (editorMode.kind !== "page") {
      const resource = activeMaster || activeComponent;
      const surface = { id: resource?.id || editorMode.id, name: resource?.name || "Contexto de diseño", width: resource?.width || activePage?.width, height: resource?.height || activePage?.height, orientation: activePage?.orientation, background: resource?.background || "#ffffff" };
      return [{ page: surface, active: true, metrics: getPageMetrics(getPageProject(project, surface)), background: surface.background, elements: renderedElements, backgroundElements: [], selectedElement: resolvedSelectedElement, selectedIds: editor.selectedIds, numberLabel: editorMode.kind === "master" ? "Maestra" : "Componente" }];
    }
    const slotPages = viewMode === "facing" && !spread.standalone ? [spread.left, spread.right] : [activePage];
    return slotPages.map((page) => {
      const active = page?.id === activePage?.id;
      const section = navigation.sections.find((candidate) => candidate.id === page?.sectionId) || null;
      const variables = active ? variableValues : buildEditorialVariableValues({ project, document: navigation.document, page, section, sections: navigation.sections, numbering: navigation.numbering, customVariables: design.variables, variant: variantState.variant });
      const localElements = active ? renderedElements : resolveAcademicViewElements(resolveLocalElements(page?.id === secondaryPage?.id ? secondaryElements : [], { stylesById: design.stylesById, componentsById: design.componentsById, variables }), variantState.variant).map((element) => resolveAutomaticIndexElement(element, automaticIndexInput));
      const master = page?.masterPageId ? design.mastersById.get(page.masterPageId) : null;
      return {
        page,
        active,
        metrics: getPageMetrics(getPageProject(project, page || activePage)),
        background: master?.background || page?.background,
        elements: localElements,
        backgroundElements: active ? activeMasterElements : master ? resolveAcademicViewElements(resolveMasterElements(master.elements || [], page.masterOverrides, { stylesById: design.stylesById, variables }), variantState.variant) : [],
        selectedElement: active ? resolvedSelectedElement : null,
        selectedIds: active ? editor.selectedIds : [],
        numberLabel: page ? navigation.numbering.get(page.id)?.label : "",
      };
    });
  }, [activeComponent, activeMaster, activeMasterElements, activePage, automaticIndexInput, design.componentsById, design.mastersById, design.stylesById, design.variables, editor.selectedIds, editorMode.id, editorMode.kind, navigation.document, navigation.numbering, navigation.sections, project, renderedElements, resolvedSelectedElement, secondaryElements, secondaryPage?.id, spread.left, spread.right, spread.standalone, variableValues, variantState.variant, viewMode]);

  const statusLabels = { idle: "Sin cambios", saving: "Guardando…", saved: "Guardado", error: "Error al guardar" };
  const zoomProps = { zoom, viewMode, showRulers, guideSettings, onZoomChange: setZoom, onFit: (mode) => workspaceRef.current?.fit(mode), onViewModeChange: setViewMode, onShowRulersChange: setShowRulers, onGuideSettingsChange: setGuideSettings };
  const structureError = dialogError || navigation.error;
  const contextLabel = editorMode.kind === "master" ? `Maestra · ${activeMaster?.name || "Cargando"}` : editorMode.kind === "component" ? `Componente · ${activeComponent?.name || "Cargando"}` : `Página · ${activePage?.name || ""}`;
  const displayEditor = { ...editor, elements: resolvedElements, selectedElement: resolvedSelectedElement, selectedElements: resolvedSelectedElements, mode: editorMode, section: activeSection };

  async function handleMenuImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try { await editor.actions.addImageFile(file); }
    catch (error) { console.error("Editorial: fallo al agregar imagen", error); }
  }

  const pickMenuImage = useCallback(() => menuFileInputRef.current?.click(), []);
  const fitWorkspace = useCallback((mode) => workspaceRef.current?.fit(mode), []);

  // Capa única de comandos: menubar, toolbar y atajos comparten estas acciones.
  // Los handlers sólo leen refs (input de imagen, workspace) al invocarse por un
  // evento del usuario, nunca durante el render — seguro.
  // eslint-disable-next-line react-hooks/refs
  const editorialMenus = buildEditorialCommands({
    editor: { actions: editor.actions, canUndo: editor.canUndo, canRedo: editor.canRedo },
    caps,
    editorMode,
    hasSelection: Boolean(resolvedSelectedElement),
    viewMode,
    showRulers,
    handlers: {
      openConfig: () => setConfigOpen(true),
      openExport: () => setExportDialog({}),
      openReadView: () => setReadViewOpen(true),
      back: handleBack,
      pickImage: pickMenuImage,
      openIndex: () => setIndexDialogOpen(true),
      zoomBy: (delta) => setZoom(zoom + delta),
      fit: fitWorkspace,
      toggleSpread: () => setViewMode(viewMode === "facing" ? "single" : "facing"),
      toggleRulers: () => setShowRulers((value) => !value),
      reorderLayer: (direction) => resolvedSelectedElement && editor.actions.reorderLayer(resolvedSelectedElement.id, direction),
    },
  });

  return (
    <div className={`editorial-editor-shell ${leftOpen ? "left-open" : "left-closed"} ${rightOpen ? "right-open" : "right-closed"} ${bottomOpen ? "bottom-open" : "bottom-closed"} context-${editorMode.kind}`}>
      <header className="editorial-editor-topbar">
        <button type="button" className="editorial-editor-brand" onClick={handleBack} aria-label="Volver a proyectos editoriales"><img src="/active-logo.png" alt="AES" /><strong>AES</strong><span>Editor Editorial</span><EditorialIcon name="chevron" size={14} /></button>
        <div className="editorial-editor-breadcrumb"><span>{getProjectTypeLabel(project.type)}</span><EditorialIcon name="chevron" size={13} /><strong>{project.name}</strong><EditorialIcon name="chevron" size={13} /><span className={`editorial-context-badge ${editorMode.kind}`}>{contextLabel}</span><b>{editorMode.kind === "page" ? navigation.numbering.get(activePage?.id)?.label || "Sin número" : "Edición aislada"}</b></div>
        <div className="editorial-editor-top-actions"><div className="editorial-variant-toggle" aria-label="Vista académica"><button type="button" className={variantState.variant === "student" ? "active" : ""} onClick={() => variantState.changeVariant("student", editor.selectedElement, () => editor.select(""))}>Alumno</button><button type="button" className={variantState.variant === "teacher" ? "active" : ""} onClick={() => variantState.changeVariant("teacher", editor.selectedElement, () => editor.select(""))}>Maestro</button></div><span className={`editorial-save-status ${editor.saveStatus}`} title={editor.saveError || statusLabels[editor.saveStatus]}><i />{statusLabels[editor.saveStatus]}</span><button type="button" className="editorial-top-action-button" onClick={() => setQuickPreviewOpen(true)}><EditorialIcon name="eye" size={17} /> Vista rápida</button><button type="button" className="editorial-top-action-button" onClick={() => setReadViewOpen(true)}><EditorialIcon name="eye" size={17} /> Modo lectura</button>{caps.manage && <button type="button" className="editorial-top-action-button" onClick={() => { setPermissionsError(""); setPermissionsOpen(true); }}>Permisos</button>}<button type="button" className="editorial-top-action-button primary" onClick={() => setExportDialog({})}>Exportar</button><button type="button" className="editorial-top-icon-button" onClick={onToggleTheme} aria-label={theme === "dark" ? "Usar modo claro" : "Usar modo oscuro"}><EditorialIcon name={theme === "dark" ? "sun" : "moon"} /></button><span className="editorial-user-avatar">{getInitials(profile)}</span></div>
      </header>
      <EditorialMenuBar menus={editorialMenus} />
      <input ref={menuFileInputRef} type="file" accept="image/*" hidden onChange={handleMenuImage} />

      <EditorialEditorToolbar leftOpen={leftOpen} rightOpen={rightOpen} bottomOpen={bottomOpen} selectedElement={resolvedSelectedElement} canUndo={editor.canUndo} canRedo={editor.canRedo} zoomProps={{ ...zoomProps, viewMode: editorMode.kind === "page" ? viewMode : "single" }} actions={editor.actions} onToggleLeft={() => setLeftOpen((value) => !value)} onToggleRight={() => setRightOpen((value) => !value)} onToggleBottom={() => setBottomOpen((value) => !value)} onOpenConfig={() => setConfigOpen(true)} />
      <nav className="editorial-editor-rail" aria-label="Navegación editorial">{RAIL_ITEMS.map(([name, label]) => <button type="button" className={activeRail === name ? "active" : ""} onClick={() => setActiveRail(name)} disabled={!ACTIVE_RAILS.has(name)} title={!ACTIVE_RAILS.has(name) ? "Disponible en una fase posterior" : undefined} key={name}><EditorialIcon name={name} /><span>{label}</span></button>)}<button type="button" className="editorial-rail-back" onClick={handleBack}><EditorialIcon name="arrowLeft" /><span>Proyectos</span></button></nav>
      {leftOpen && <EditorialStructurePanel projectId={project.id} project={project} activeRail={activeRail} railItems={RAIL_ITEMS} navigation={navigation} ordering={ordering} activeElements={editorMode.kind === "page" ? renderedElements : []} onSelectPage={handleSelectPage} onCreatePage={openCreatePage} onCreateSection={(initialType) => setSectionDialog({ initialType })} onEditSection={(section) => setSectionDialog({ section })} onDeleteSection={(section) => setDeleteTarget({ kind: "section", item: section })} onPageAction={handlePageAction} design={design} editor={displayEditor} editorMode={editorMode} academicMetadata={academicMetadata} relatedProjects={relatedProjects} onAcademicAction={handleAcademicAction} onDesignAction={handleDesignAction} canManageInstitutional={String(profile?.role || "").toLowerCase() === "admin"} production={production} publications={publications.publications} pubBusy={publications.busy} pubError={publications.error} caps={caps} indexState={indexState} onIndexAction={handleIndexAction} onNavigateIssue={handleNavigateIssue} onExport={(settings) => setExportDialog(settings || {})} onDownloadExport={downloadStoredExport} onPublish={handlePublish} onUnpublish={(pub) => publications.actions.unpublish(pub).catch(() => {})} onRepublish={(pub) => publications.actions.republish(pub).catch(() => {})} onArchive={(pub) => publications.actions.archive(pub).catch(() => {})} onOpenSource={() => setReadViewOpen(true)} onSaveExportToDrive={(item) => { setIntegrationsError(""); setIntegrationsDialog({ mode: "drive", exportItem: item }); }} onSendExportToPrint={(item) => { setIntegrationsError(""); setIntegrationsDialog({ mode: "print", exportItem: item, autofill: buildPrintAutofill({ project, document: { id: navigation.documentId, title: project.name }, exportItem: item, user: profile }) }); }} onOpenReadView={() => setReadViewOpen(true)} projectLink={{ metrics: editorialMetrics, visibleProjects, linkedProjects, busy: projectLinkBusy, error: projectLinkError, onLink: handleLinkProject, onUnlink: handleUnlinkProject, onAttachEvidence: handleAttachEvidence }} />}
      <EditorialWorkspace ref={workspaceRef} metrics={metrics} zoom={zoom} viewMode={editorMode.kind === "page" ? viewMode : "single"} showRulers={showRulers} guideSettings={guideSettings} spreadSlots={spreadSlots} onZoomChange={setZoom} onSelectPage={handleSelectPage} onSelectElement={editor.select} onChangeElement={handleCanvasElementChange} onAcademicDrop={(payload) => payload.kind === "block" && handleAcademicAction("insert-block", payload.value)} />
      {rightOpen && <EditorialInspectorPanel activeTab={activeInspector} onChangeTab={setActiveInspector} editor={editor} displayEditor={displayEditor} design={design} page={editorMode.kind === "page" ? activePage : null} master={activePageMaster} variant={variantState.variant} academicWarnings={academicWarnings} onDesignAction={handleDesignAction} onRegenerate={handleRegenerate} />}
      {bottomOpen && <EditorialBottomPanel project={project} navigation={navigation} ordering={ordering} activeElements={editorMode.kind === "page" ? renderedElements : []} onSelectPage={handleSelectPage} />}
      {structureError && !pageDialog && !sectionDialog && !deleteTarget && !designDialog && <div className="editorial-structure-error" role="alert">{structureError}<button type="button" onClick={() => { setDialogError(""); navigation.clearError(); }}>Cerrar</button></div>}
      <EditorialProjectDialog key={configOpen ? `config-${project.updatedAt?.seconds || "open"}` : "config-closed"} open={configOpen} title="Configuración editorial" submitLabel="Guardar cambios" initialProject={project} busy={editor.saveStatus === "saving"} error={saveError} onClose={() => { setConfigOpen(false); setSaveError(""); }} onSubmit={handleSaveConfig} />
      <EditorialPageDialog key={pageDialog ? `page-${pageDialog.mode}-${pageDialog.page?.id || pageDialog.defaults?.referencePageId || "new"}` : "page-closed"} open={Boolean(pageDialog)} mode={pageDialog?.mode} page={pageDialog?.page} defaults={pageDialog?.defaults} sections={navigation.sections} busy={navigation.busy} error={structureError} onClose={() => setPageDialog(null)} onSubmit={handlePageSubmit} />
      <EditorialSectionDialog key={sectionDialog ? `section-${sectionDialog.section?.id || sectionDialog.initialType || "new"}` : "section-closed"} open={Boolean(sectionDialog)} section={sectionDialog?.section} initialType={sectionDialog?.initialType} busy={navigation.busy} error={structureError} onClose={() => setSectionDialog(null)} onSubmit={handleSectionSubmit} />
      <EditorialStructureDeleteDialog key={deleteTarget ? `delete-${deleteTarget.kind}-${deleteTarget.item.id}` : "delete-closed"} target={deleteTarget} pages={navigation.pages} sections={navigation.sections} busy={navigation.busy} error={structureError} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} />
      <EditorialDesignDialog key={designDialog ? `${designDialog.action}-${designDialog.item?.id || "new"}` : "design-closed"} dialog={designDialog} busy={designBusy} error={structureError} onClose={() => { setDesignDialog(null); setDialogError(""); }} onSubmit={submitDesignDialog} />
      <EditorialAcademicMetadataDialog key={academicDialog ? `${academicDialog.kind}-${academicDialog.target || "new"}` : "academic-closed"} dialog={academicDialog} busy={academicBusy} error={structureError} onClose={() => { setAcademicDialog(null); setDialogError(""); }} onSubmit={submitAcademicMetadata} />
      <EditorialExerciseDialog key={exerciseDialog ? `${exerciseDialog.type}-${exerciseDialog.existing?.id || "new"}` : "exercise-closed"} type={exerciseDialog?.type} existing={exerciseDialog?.existing} onClose={() => setExerciseDialog(null)} onSubmit={submitExercise} />
      <EditorialSongDialog key={songDialogOpen ? "song-open" : "song-closed"} open={songDialogOpen} onClose={() => setSongDialogOpen(false)} onSubmit={submitSong} />
      {indexDialogOpen && <EditorialIndexDialog open initialConfig={automaticIndexElement?.automaticIndex} sections={navigation.sections} onClose={() => setIndexDialogOpen(false)} onSubmit={submitIndex} />}
      {exportDialog && <EditorialExportDialog open project={project} navigation={navigation} initialSettings={exportDialog} busy={production.busy} onClose={() => setExportDialog(null)} onSubmit={submitExport} />}
      {quickPreviewOpen && <QuickPreview project={project} pages={navigation.pages} onClose={() => setQuickPreviewOpen(false)} />}
      {integrationsDialog && <EditorialIntegrationsDialog mode={integrationsDialog.mode} exportItem={integrationsDialog.exportItem} autofill={integrationsDialog.autofill} canManage={caps.manage} busy={integrationsBusy} error={integrationsError} onClose={() => setIntegrationsDialog(null)} onSaveDrive={saveIntegrationsDrive} onSendPrint={sendIntegrationsPrint} onCreateFolder={createIntegrationsFolder} />}
      {readViewOpen && <EditorialReadView project={project} navigation={navigation} metrics={metrics} spreadSlots={spreadSlots} zoom={zoom} viewMode={editorMode.kind === "page" ? viewMode : "single"} onZoomChange={setZoom} onViewModeChange={setViewMode} variant={variantState.variant} onVariantChange={(next) => variantState.changeVariant(next, editor.selectedElement, () => editor.select(""))} caps={caps} publications={publications.publications} relatedProjects={relatedProjects} onDownloadPublication={downloadStoredExport} onClose={() => setReadViewOpen(false)} />}
      {permissionsOpen && <EditorialPermissionsDialog open project={project} users={production.users} busy={permissionsBusy} error={permissionsError} onClose={() => setPermissionsOpen(false)} onSubmit={handleSavePermissions} />}
      {downloadNotice && <div className={`editorial-download-toast ${downloadNotice.type}`} role="status">{downloadNotice.text}{downloadNotice.type !== "loading" && <button type="button" aria-label="Cerrar aviso" onClick={() => setDownloadNotice(null)}>×</button>}</div>}
    </div>
  );
}

export default function EditorialEditorShell({ projectId, profile, theme, onToggleTheme, onBack, onOpenProject }) {
  const { project, documents, loading, error } = useEditorialProject(projectId);
  const pageCount = documents.reduce((total, document) => total + document.pages.length, 0);
  if (loading) return <div className="editorial-editor-state"><span className="editorial-spinner" /><strong>Abriendo editor…</strong></div>;
  if (error || !project) return <div className="editorial-editor-state error"><EditorialIcon name="info" size={32} /><strong>No fue posible abrir el proyecto</strong><p>{error}</p><button type="button" className="editorial-button primary" onClick={onBack}>Volver a proyectos</button></div>;
  if (pageCount === 0) return <div className="editorial-editor-state error"><EditorialIcon name="page" size={32} /><strong>Proyecto sin página inicial</strong><p>Crea nuevamente el proyecto para generar estructura válida.</p><button type="button" className="editorial-button primary" onClick={onBack}>Volver a proyectos</button></div>;
  return <EditorialEditorReady project={project} documents={documents} profile={profile} theme={theme} onToggleTheme={onToggleTheme} onBack={onBack} onOpenProject={onOpenProject} />;
}
