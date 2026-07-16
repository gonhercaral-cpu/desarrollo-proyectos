import { useEffect } from "react";

function isTypingTarget(target) {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function useEditorialShortcuts(actions) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (isTypingTarget(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (modifier && key === "z") {
        event.preventDefault();
        event.shiftKey ? actions.redo() : actions.undo();
        return;
      }
      if (modifier && key === "y") {
        event.preventDefault();
        actions.redo();
        return;
      }
      if (modifier && key === "c") {
        event.preventDefault();
        actions.copy();
        return;
      }
      if (modifier && key === "v") {
        event.preventDefault();
        actions.paste();
        return;
      }
      if (modifier && key === "d") {
        event.preventDefault();
        actions.duplicate();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (actions.hasSelection) {
          event.preventDefault();
          actions.remove();
        }
        return;
      }
      if (event.key === "Escape") {
        actions.deselect();
        return;
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && actions.hasSelection) {
        event.preventDefault();
        const increment = event.shiftKey ? 10 : 1;
        actions.nudge(event.key, increment);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [actions]);
}
