import { useCallback, useState } from "react";
import { isElementVisibleInVariant } from "../utils/editorialAcademicVisibility";

export function useEditorialVariant(initialMode = "student") {
  const [variant, setVariant] = useState(initialMode);
  const changeVariant = useCallback((nextVariant, selectedElement, onDeselect) => {
    const safe = nextVariant === "teacher" ? "teacher" : "student";
    setVariant(safe);
    if (selectedElement && !isElementVisibleInVariant(selectedElement, safe)) onDeselect?.();
  }, []);
  return { variant, changeVariant };
}
