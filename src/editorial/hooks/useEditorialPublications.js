import { useCallback, useEffect, useMemo, useState } from "react";
import {
  archiveEditorialPublication,
  createEditorialPublication,
  republishEditorialPublication,
  subscribeEditorialPublications,
  unpublishEditorialPublication,
  updateEditorialPublicationNotes,
} from "../services/editorialPublicationsService";
import { canDeleteExport, canDeleteVersion } from "../utils/editorialDependencies";

export function useEditorialPublications({ projectId, documentId, project, user }) {
  const [publications, setPublications] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projectId || !documentId) return undefined;
    return subscribeEditorialPublications({
      projectId,
      documentId,
      onChange: setPublications,
      onError: (nextError) => setError(nextError.message || "No fue posible cargar publicaciones."),
    });
  }, [documentId, projectId]);

  const run = useCallback(async (operation) => {
    setBusy(true);
    setError("");
    try {
      return await operation();
    } catch (nextError) {
      setError(nextError.message || "Operación de publicación fallida.");
      throw nextError;
    } finally {
      setBusy(false);
    }
  }, []);

  const publish = useCallback(
    ({ version, exports, variant, reviewStatus, notes }) =>
      run(() =>
        createEditorialPublication({
          projectId,
          documentId,
          project,
          version,
          exports,
          variant,
          reviewStatus,
          notes,
          publications,
          user,
        })
      ),
    [documentId, project, projectId, publications, run, user]
  );

  const unpublish = useCallback(
    (publication) => run(() => unpublishEditorialPublication({ projectId, documentId, project, publication, user })),
    [documentId, project, projectId, run, user]
  );
  const republish = useCallback(
    (publication) => run(() => republishEditorialPublication({ projectId, documentId, publication, user })),
    [documentId, projectId, run, user]
  );
  const archive = useCallback(
    (publication) => run(() => archiveEditorialPublication({ projectId, documentId, publication, user })),
    [documentId, projectId, run, user]
  );
  const updateNotes = useCallback(
    (publication, notes) => run(() => updateEditorialPublicationNotes({ projectId, documentId, publication, notes, user })),
    [documentId, projectId, run, user]
  );

  // Guardas de dependencia para versiones/exportaciones usadas por publicaciones.
  const versionGuard = useCallback((versionId) => canDeleteVersion(publications, versionId), [publications]);
  const exportGuard = useCallback((exportId) => canDeleteExport(publications, exportId), [publications]);

  const publishedCount = useMemo(
    () => publications.filter((item) => item.status === "published").length,
    [publications]
  );

  return {
    publications,
    publishedCount,
    busy,
    error,
    clearError: () => setError(""),
    versionGuard,
    exportGuard,
    actions: { publish, unpublish, republish, archive, updateNotes },
  };
}
