import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizeEditorialPages, normalizeEditorialSections } from "../models/editorialStructure";
import {
  createEditorialPage,
  deleteEditorialPage,
  duplicateEditorialPage,
  reorderEditorialPages,
  subscribeEditorialPages,
  updateEditorialPage,
} from "../services/editorialPagesService";
import {
  createEditorialSection,
  deleteEditorialSection,
  reorderEditorialSections,
  subscribeEditorialSections,
  updateEditorialSection,
} from "../services/editorialSectionsService";
import { calculateEditorialNumbering } from "../utils/editorialNumbering";
import { clearEditorialPageDraft } from "./useEditorialAutosave";

export function useEditorialDocumentNavigation({ project, documents, user }) {
  const document = documents[0];
  const documentId = document?.id || "";
  const [pages, setPages] = useState(() => normalizeEditorialPages(document?.pages, project));
  const [sections, setSections] = useState(() => normalizeEditorialSections(document?.sections));
  const [selectedPageId, setSelectedPageId] = useState(() => pages[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!documentId) return undefined;
    const unsubscribePages = subscribeEditorialPages({
      projectId: project.id,
      documentId,
      project,
      onChange: setPages,
      onError: (nextError) => setError(nextError.message || "No fue posible cargar las páginas."),
    });
    const unsubscribeSections = subscribeEditorialSections({
      projectId: project.id,
      documentId,
      onChange: setSections,
      onError: (nextError) => setError(nextError.message || "No fue posible cargar las secciones."),
    });
    return () => {
      unsubscribePages();
      unsubscribeSections();
    };
  }, [documentId, project]);

  const activePage = pages.find((page) => page.id === selectedPageId) || pages[0] || null;
  const numbering = useMemo(
    () => calculateEditorialNumbering(pages, sections),
    [pages, sections]
  );

  const run = useCallback(async (operation) => {
    setBusy(true);
    setError("");
    try {
      return await operation();
    } catch (operationError) {
      setError(operationError.message || "No fue posible actualizar la estructura editorial.");
      throw operationError;
    } finally {
      setBusy(false);
    }
  }, []);

  const createPage = useCallback((values) => run(async () => {
    const pageId = await createEditorialPage({
      projectId: project.id,
      documentId,
      project,
      user,
      ...values,
    });
    setSelectedPageId(pageId);
    return pageId;
  }), [documentId, project, run, user]);

  const updatePage = useCallback((pageId, changes) => run(() => updateEditorialPage({
    projectId: project.id,
    documentId,
    pageId,
    changes,
    user,
  })), [documentId, project.id, run, user]);

  const duplicatePage = useCallback((pageId) => run(async () => {
    const duplicatedPageId = await duplicateEditorialPage({
      projectId: project.id,
      documentId,
      pageId,
      project,
      user,
    });
    setSelectedPageId(duplicatedPageId);
    return duplicatedPageId;
  }), [documentId, project, run, user]);

  const deletePage = useCallback((pageId) => run(async () => {
    const index = pages.findIndex((page) => page.id === pageId);
    const fallback = pages[index + 1] || pages[index - 1];
    await deleteEditorialPage({
      projectId: project.id,
      documentId,
      pageId,
      project,
      user,
    });
    clearEditorialPageDraft({ projectId: project.id, documentId, pageId });
    if (activePage?.id === pageId) setSelectedPageId(fallback?.id || "");
  }), [activePage?.id, documentId, pages, project, run, user]);

  const reorderPages = useCallback((sourceId, targetId, placement = "before") => run(async () => {
    const sourceIndex = pages.findIndex((page) => page.id === sourceId);
    if (sourceIndex < 0 || sourceId === targetId) return;
    const nextPages = [...pages];
    const [source] = nextPages.splice(sourceIndex, 1);
    const targetIndex = nextPages.findIndex((page) => page.id === targetId);
    const insertionIndex = Math.max(0, targetIndex + (placement === "after" ? 1 : 0));
    nextPages.splice(insertionIndex, 0, source);
    setPages(nextPages.map((page, order) => ({ ...page, order })));
    try {
      await reorderEditorialPages({
        projectId: project.id,
        documentId,
        pageIds: nextPages.map((page) => page.id),
        user,
      });
    } catch (nextError) {
      setPages(pages);
      throw nextError;
    }
  }), [documentId, pages, project.id, run, user]);

  const movePageToSection = useCallback((pageId, sectionId) => run(() => reorderEditorialPages({
    projectId: project.id,
    documentId,
    pageIds: pages.map((page) => page.id),
    sectionChanges: { [pageId]: sectionId },
    user,
  })), [documentId, pages, project.id, run, user]);

  const createSection = useCallback((values) => run(() => createEditorialSection({
    projectId: project.id,
    documentId,
    values,
    user,
  })), [documentId, project.id, run, user]);

  const updateSection = useCallback((sectionId, changes) => run(() => updateEditorialSection({
    projectId: project.id,
    documentId,
    sectionId,
    changes,
    user,
  })), [documentId, project.id, run, user]);

  const reorderSections = useCallback((sourceId, targetId) => run(async () => {
    if (sourceId === targetId) return;
    const sourceIndex = sections.findIndex((section) => section.id === sourceId);
    const nextSections = [...sections];
    const [source] = nextSections.splice(sourceIndex, 1);
    const targetIndex = nextSections.findIndex((section) => section.id === targetId);
    nextSections.splice(Math.max(0, targetIndex), 0, source);
    setSections(nextSections.map((section, order) => ({ ...section, order })));
    try {
      await reorderEditorialSections({
        projectId: project.id,
        documentId,
        sectionIds: nextSections.map((section) => section.id),
        user,
      });
    } catch (nextError) {
      setSections(sections);
      throw nextError;
    }
  }), [documentId, project.id, run, sections, user]);

  const deleteSection = useCallback((sectionId, options) => run(async () => {
    const removedPageIds = pages.filter((page) => page.sectionId === sectionId).map((page) => page.id);
    const fallback = pages.find((page) => !removedPageIds.includes(page.id));
    await deleteEditorialSection({
      projectId: project.id,
      documentId,
      sectionId,
      pages,
      project,
      user,
      ...options,
    });
    if (options.mode === "delete") {
      removedPageIds.forEach((pageId) => clearEditorialPageDraft({ projectId: project.id, documentId, pageId }));
      if (removedPageIds.includes(activePage?.id)) setSelectedPageId(fallback?.id || "");
    }
  }), [activePage?.id, documentId, pages, project, run, user]);

  return {
    document,
    documentId,
    pages,
    sections,
    activePage,
    selectedPageId: activePage?.id || "",
    numbering,
    busy,
    error,
    clearError: () => setError(""),
    selectPage: setSelectedPageId,
    createPage,
    updatePage,
    duplicatePage,
    deletePage,
    reorderPages,
    movePageToSection,
    createSection,
    updateSection,
    reorderSections,
    deleteSection,
  };
}
