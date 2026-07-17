import { useEffect, useState } from "react";
import { subscribeEditorialTemplates } from "../services/editorialTemplatesService";

export function useEditorialTemplates(projectId) {
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => subscribeEditorialTemplates({ projectId, onChange: setTemplates, onError: (nextError) => setError(nextError.message) }), [projectId]);
  return { templates, error };
}
