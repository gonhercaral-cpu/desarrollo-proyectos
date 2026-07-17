import { useEffect, useMemo, useState } from "react";
import { subscribeEditorialComponents } from "../services/editorialComponentsService";
import { subscribeEditorialPageElements } from "../services/editorialElementsService";

export function useEditorialComponents(projectId) {
  const [components, setComponents] = useState([]);
  const [elementsById, setElementsById] = useState({});
  const [error, setError] = useState("");
  useEffect(() => subscribeEditorialComponents({ projectId, onChange: setComponents, onError: (nextError) => setError(nextError.message) }), [projectId]);
  const componentIds = components.map((component) => component.id).join("|");
  useEffect(() => {
    const ids = componentIds.split("|").filter(Boolean);
    const unsubscribes = ids.map((componentId) => subscribeEditorialPageElements(
      { kind: "component", projectId, componentId },
      (elements) => setElementsById((current) => ({ ...current, [componentId]: elements })),
      (nextError) => setError(nextError.message)
    ));
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [componentIds, projectId]);
  const enriched = useMemo(() => components.map((component) => ({ ...component, elements: elementsById[component.id] || [] })), [components, elementsById]);
  return { components: enriched, error };
}
