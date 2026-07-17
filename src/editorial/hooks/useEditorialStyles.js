import { useEffect, useState } from "react";
import { subscribeEditorialStyles } from "../services/editorialStylesService";

export function useEditorialStyles(projectId) {
  const [styles, setStyles] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => subscribeEditorialStyles({ projectId, onChange: setStyles, onError: (nextError) => setError(nextError.message) }), [projectId]);
  return { styles, error };
}
