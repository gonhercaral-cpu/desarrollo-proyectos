import { useEffect, useState } from "react";
import { subscribeEditorialVariables } from "../services/editorialVariablesService";

export function useEditorialVariables(projectId) {
  const [variables, setVariables] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => subscribeEditorialVariables({ projectId, onChange: setVariables, onError: (nextError) => setError(nextError.message) }), [projectId]);
  return { variables, error };
}
