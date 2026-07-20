import { useEffect, useRef, useState } from "react";
import { konvaFontStyle, normalizeHighlight, normalizeTextStyle } from "../../models/editorialTypography";
import { resolveInlineTextCommand, resolveInlineTextGeometry } from "../../models/editorialInlineText";

// Fase 8 — Editor de texto en línea (doble clic). textarea HTML superpuesto
// exactamente sobre el texto Konva, respetando zoom, fuente, tamaño, color,
// alineación e interlineado. Escape cancela, Ctrl/Cmd+Enter o clic fuera guarda.
// El texto Konva se oculta mientras se edita; el guardado es UNA acción de
// historial (onCommit) y no escribe en Firestore por cada tecla.
export default function EditorialInlineTextEditor({ element, zoom, getScreenRect, onCommit, onCancel }) {
  const [value, setValue] = useState(element.content || "");
  // El componente se monta con key={element.id}: el rect inicial se calcula una
  // vez (posición/zoom actuales), sin setState en efecto.
  const [rect, setRect] = useState(() => getScreenRect());
  const textareaRef = useRef(null);
  const committedRef = useRef(false);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.focus();
    node.select();
  }, []);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setRect(getScreenRect()));
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    update();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [getScreenRect, zoom]);

  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(element.id, value);
  }

  function cancel() {
    if (committedRef.current) return;
    committedRef.current = true;
    onCancel();
  }

  function handleKeyDown(event) {
    const command = resolveInlineTextCommand(event);
    if (command === "cancel") {
      event.preventDefault();
      cancel();
      return;
    }
    if (command === "commit") {
      event.preventDefault();
      commit();
    }
    // Enter y Shift+Enter: salto de línea normal del textarea.
  }

  if (!rect) return null;

  const style = normalizeTextStyle(element.style);
  const highlight = normalizeHighlight(style.textHighlight);
  const geometry = resolveInlineTextGeometry({ rect, element, zoom, value });
  const decorations = [];
  if (Array.isArray(style.textDecoration) && style.textDecoration.includes("underline")) decorations.push("underline");
  if (Array.isArray(style.textDecoration) && style.textDecoration.includes("line-through")) decorations.push("line-through");

  return (
    <textarea
      ref={textareaRef}
      className="editorial-inline-text-editor"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={commit}
      style={{
        position: "fixed",
        left: `${geometry.left}px`,
        top: `${geometry.top}px`,
        width: `${geometry.width}px`,
        height: `${geometry.height}px`,
        fontFamily: style.fontFamily,
        fontSize: `${style.fontSize * zoom}px`,
        fontWeight: konvaFontStyle(style).includes("bold") ? 700 : 400,
        fontStyle: konvaFontStyle(style).includes("italic") ? "italic" : "normal",
        textDecoration: decorations.join(" "),
        color: style.fill,
        background: highlight.enabled ? highlight.color : "transparent",
        opacity: Number(element.opacity ?? 1),
        textAlign: style.align === "justify" ? "justify" : style.align,
        textTransform: style.textTransform === "none" ? "none" : style.textTransform,
        lineHeight: String(style.lineHeight),
        letterSpacing: `${style.letterSpacing * zoom}px`,
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
        transformOrigin: "top left",
        boxSizing: "border-box",
        margin: 0,
        padding: `${style.padding.top * zoom}px ${style.padding.right * zoom}px ${style.padding.bottom * zoom}px ${style.padding.left * zoom}px`,
        resize: "none",
        overflow: style.boxMode === "fixed_box" ? "auto" : "hidden",
      }}
    />
  );
}
