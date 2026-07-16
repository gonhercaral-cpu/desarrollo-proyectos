import { useEffect, useState } from "react";
import {
  getEditorialProjectStructure,
  subscribeEditorialProject,
} from "../services/editorialProjectsService";

export function useEditorialProject(projectId) {
  const [project, setProject] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = subscribeEditorialProject(
      projectId,
      (nextProject) => {
        setProject(nextProject);
        setError(nextProject ? "" : "El proyecto editorial no existe o fue eliminado.");
        if (!nextProject) {
          setDocuments([]);
        }
        setLoading(false);
      },
      (subscriptionError) => {
        setError(subscriptionError.message || "No fue posible abrir el proyecto.");
        setLoading(false);
      }
    );

    getEditorialProjectStructure(projectId)
      .then((nextDocuments) => {
        setDocuments(nextDocuments);
      })
      .catch((structureError) => {
        setError(structureError.message || "No fue posible cargar la estructura editorial.");
        setLoading(false);
      });

    return unsubscribe;
  }, [projectId]);

  return { project, documents, loading, error };
}
