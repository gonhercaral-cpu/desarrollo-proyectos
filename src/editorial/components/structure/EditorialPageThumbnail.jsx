import { useEffect, useRef, useState } from "react";
import { EDITORIAL_ELEMENT_TYPES } from "../../models/editorialElements";
import { useEditorialPagePreviewElements } from "../../hooks/useEditorialPagePreviewElements";
import EditorialIcon from "../EditorialIcon";

function ThumbnailElement({ element, page, displayWidth }) {
  if (!element.visible) return null;
  const pageWidth = Math.max(1, Number(page.width || 8) * 96);
  const style = {
    left: `${(element.x / pageWidth) * 100}%`,
    top: `${(element.y / (Number(page.height || 10) * 96)) * 100}%`,
    width: `${(element.width / pageWidth) * 100}%`,
    height: `${(element.height / (Number(page.height || 10) * 96)) * 100}%`,
    opacity: element.opacity,
    transform: `rotate(${element.rotation || 0}deg)`,
  };
  if (element.type === EDITORIAL_ELEMENT_TYPES.IMAGE) {
    return <img className="editorial-thumbnail-element" style={{ ...style, objectFit: element.style?.fit || "cover" }} src={element.assetUrl} alt="" loading="lazy" />;
  }
  if (element.type === EDITORIAL_ELEMENT_TYPES.SHAPE) {
    return <span className="editorial-thumbnail-element" style={{ ...style, background: element.style?.fill, border: `${Math.max(0.5, Number(element.style?.borderWidth || 0) * displayWidth / pageWidth)}px solid ${element.style?.borderColor || "transparent"}`, borderRadius: element.style?.cornerRadius ? 2 : 0 }} />;
  }
  return <span className="editorial-thumbnail-element text" style={{ ...style, color: element.style?.fill, textAlign: element.style?.align, fontWeight: element.style?.fontWeight, fontSize: `${Math.max(2, Number(element.style?.fontSize || 24) * displayWidth / pageWidth)}px` }}>{element.content}</span>;
}

export default function EditorialPageThumbnail({
  context,
  page,
  label,
  active,
  elementsOverride,
  compact = false,
  onSelect,
  onActions,
  dragProps,
}) {
  const rootRef = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "160px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const remoteElements = useEditorialPagePreviewElements(context, visible && !elementsOverride);
  const elements = elementsOverride || remoteElements;
  const displayWidth = compact ? 48 : 72;

  return (
    <article ref={rootRef} className={`editorial-page-thumbnail ${active ? "active" : ""} ${compact ? "compact" : ""}`} {...dragProps}>
      <button type="button" className="editorial-thumbnail-select" onClick={() => onSelect(page.id)} aria-label={`Abrir ${page.name}`}>
        <span className="editorial-thumbnail-paper" style={{ aspectRatio: `${page.width || 8} / ${page.height || 10}`, background: page.background || "#ffffff" }}>
          {!page.isBlank && elements.map((element) => <ThumbnailElement key={element.id} element={element} page={page} displayWidth={displayWidth} />)}
          {page.isBlank && <i className="editorial-blank-page-label">En blanco</i>}
        </span>
        <small>{label || "—"}</small>
      </button>
      {onActions && <button type="button" className="editorial-thumbnail-actions" onClick={() => onActions(page)} aria-label={`Acciones de ${page.name}`}><EditorialIcon name="more" size={14} /></button>}
    </article>
  );
}
