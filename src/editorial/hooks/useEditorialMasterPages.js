import { useEffect, useMemo, useState } from "react";
import { subscribeEditorialPageElements } from "../services/editorialElementsService";
import { subscribeEditorialMasterPages } from "../services/editorialMasterPagesService";

export function useEditorialMasterPages({ project, documentId }) {
  const [masters, setMasters] = useState([]);
  const [elementsById, setElementsById] = useState({});
  const [error, setError] = useState("");

  useEffect(() => subscribeEditorialMasterPages({ projectId: project.id, documentId, project, onChange: setMasters, onError: (nextError) => setError(nextError.message) }), [documentId, project]);
  const masterIds = masters.map((master) => master.id).join("|");
  useEffect(() => {
    const ids = masterIds.split("|").filter(Boolean);
    const unsubscribes = ids.map((masterPageId) => subscribeEditorialPageElements(
      { kind: "master", projectId: project.id, documentId, masterPageId },
      (elements) => setElementsById((current) => ({ ...current, [masterPageId]: elements })),
      (nextError) => setError(nextError.message)
    ));
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [documentId, masterIds, project.id]);

  const enriched = useMemo(() => masters.map((master) => ({ ...master, elements: elementsById[master.id] || [] })), [elementsById, masters]);
  return { masters: enriched, error };
}
