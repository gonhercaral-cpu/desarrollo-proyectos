import { useCallback, useState } from "react";

export function useEditorialOrdering({ onReorderPage, onMovePageToSection, onReorderSection }) {
  const [dragged, setDragged] = useState(null);

  const beginDrag = useCallback((type, id) => (event) => {
    setDragged({ type, id });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${type}:${id}`);
  }, []);

  const endDrag = useCallback(() => setDragged(null), []);
  const allowDrop = useCallback((event) => event.preventDefault(), []);

  const dropOnPage = useCallback((targetPageId) => async (event) => {
    event.preventDefault();
    try {
      if (dragged?.type === "page") await onReorderPage(dragged.id, targetPageId, "before");
    } catch { /* caller exposes structural error */ }
    finally { setDragged(null); }
  }, [dragged, onReorderPage]);

  const dropOnSection = useCallback((sectionId) => async (event) => {
    event.preventDefault();
    try {
      if (dragged?.type === "page") await onMovePageToSection(dragged.id, sectionId);
      if (dragged?.type === "section") await onReorderSection(dragged.id, sectionId);
    } catch { /* caller exposes structural error */ }
    finally { setDragged(null); }
  }, [dragged, onMovePageToSection, onReorderSection]);

  return { dragged, beginDrag, endDrag, allowDrop, dropOnPage, dropOnSection };
}
