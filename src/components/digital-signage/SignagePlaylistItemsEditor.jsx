import { useState, useRef, useEffect } from "react";

import { formatDuration as formatDurationText } from "../../utils/digitalSignage/signageFormatters";
import { parseDurationInput as parseDurationText } from "../../utils/digitalSignage/signageMedia";

export default function SignagePlaylistItemsEditor({
  items = [],
  saving = false,
  onChange,
  onSelectItem,
  selectedItemId,
}) {
  const [durationInputs, setDurationInputs] = useState({});
  const [batchIds, setSelectedBatchIds] = useState([]);
  const [draggedItemId, setDraggedItemId] = useState(null);
  const [dragOverItemId, setDragOverItemId] = useState(null);
  const [dropPosition, setDropPosition] = useState("below");
  const [announcement, setAnnouncement] = useState("");

  const committingItemIdRef = useRef(null);
  const masterCheckboxRef = useRef(null);

  const selectedBatchIds = batchIds.filter((id) => items.some((item) => item.itemId === id));

  useEffect(() => {
    if (masterCheckboxRef.current) {
      const count = selectedBatchIds.length;
      const total = items.length;
      masterCheckboxRef.current.indeterminate = count > 0 && count < total;
    }
  }, [selectedBatchIds, items]);

  const isEditingAnyDuration = Object.keys(durationInputs).length > 0;

  const handleDurationFocus = (item) => {
    committingItemIdRef.current = null;
    if (durationInputs[item.itemId] === undefined) {
      setDurationInputs((prev) => ({
        ...prev,
        [item.itemId]: {
          text: formatDurationText(item.durationSeconds),
          error: null,
        },
      }));
    }
  };

  const handleDurationChange = (itemId, val) => {
    setDurationInputs((prev) => ({
      ...prev,
      [itemId]: {
        text: val,
        error: null,
      },
    }));
  };

  const commitDuration = (item) => {
    const currentEdit = durationInputs[item.itemId];
    if (!currentEdit) return;

    const parsed = parseDurationText(currentEdit.text);
    if (parsed === null) {
      setDurationInputs((prev) => ({
        ...prev,
        [item.itemId]: {
          ...currentEdit,
          error: "Inválido. Rango: 1s a 24h (formato MM:SS o HH:MM:SS)",
        },
      }));
      return;
    }

    if (parsed !== item.durationSeconds) {
      const updated = items.map((it) =>
        it.itemId === item.itemId ? { ...it, durationSeconds: parsed } : it
      );
      if (onChange) {
        onChange(updated, "Duración actualizada");
      }
    }

    setDurationInputs((prev) => {
      const copy = { ...prev };
      delete copy[item.itemId];
      return copy;
    });
  };

  const cancelDuration = (item) => {
    setDurationInputs((prev) => {
      const copy = { ...prev };
      delete copy[item.itemId];
      return copy;
    });
  };

  const handleDurationKeyDown = (event, item) => {
    if (event.key === "Enter") {
      event.preventDefault();
      committingItemIdRef.current = item.itemId;
      commitDuration(item);
      event.currentTarget.blur();
      setTimeout(() => {
        if (committingItemIdRef.current === item.itemId) {
          committingItemIdRef.current = null;
        }
      }, 60);
    } else if (event.key === "Escape") {
      event.preventDefault();
      committingItemIdRef.current = item.itemId;
      cancelDuration(item);
      event.currentTarget.blur();
    }
  };

  const handleDurationBlur = (item) => {
    if (committingItemIdRef.current === item.itemId) {
      return;
    }
    commitDuration(item);
  };

  const handleDragStart = (event, item) => {
    if (isEditingAnyDuration) {
      event.preventDefault();
      return;
    }
    setDraggedItemId(item.itemId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.itemId);
  };

  const handleDragOver = (event, item) => {
    event.preventDefault();
    if (!draggedItemId || draggedItemId === item.itemId) return;
    event.dataTransfer.dropEffect = "move";
    setDragOverItemId(item.itemId);

    const rect = event.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropPosition(event.clientY < midY ? "above" : "below");
  };

  const handleDragLeave = (event, item) => {
    if (dragOverItemId === item.itemId) {
      setDragOverItemId(null);
    }
  };

  const handleDrop = (event, targetItem) => {
    event.preventDefault();
    if (!draggedItemId || draggedItemId === targetItem.itemId) {
      setDraggedItemId(null);
      setDragOverItemId(null);
      return;
    }

    const srcIndex = items.findIndex((it) => it.itemId === draggedItemId);
    const dstIndex = items.findIndex((it) => it.itemId === targetItem.itemId);

    if (srcIndex === -1 || dstIndex === -1) {
      setDraggedItemId(null);
      setDragOverItemId(null);
      return;
    }

    const newItems = [...items];
    const [moved] = newItems.splice(srcIndex, 1);

    let insertIndex;
    if (dropPosition === "below") {
      insertIndex = srcIndex < dstIndex ? dstIndex : dstIndex + 1;
    } else {
      insertIndex = srcIndex < dstIndex ? dstIndex - 1 : dstIndex;
    }
    insertIndex = Math.max(0, Math.min(newItems.length, insertIndex));

    newItems.splice(insertIndex, 0, moved);

    setDraggedItemId(null);
    setDragOverItemId(null);
    setAnnouncement(
      `Elemento ${moved.title || "Contenido"} movido a la posición ${
        insertIndex + 1
      } de ${newItems.length}`
    );
    if (onChange) {
      onChange(newItems, "Orden actualizado");
    }
  };

  const handleDragEnd = () => {
    setDraggedItemId(null);
    setDragOverItemId(null);
  };

  const handleMoveKeyboard = (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    const newItems = [...items];
    const temp = newItems[index];
    newItems[index] = newItems[targetIndex];
    newItems[targetIndex] = temp;

    setAnnouncement(
      `Elemento ${temp.title || "Contenido"} movido a la posición ${
        targetIndex + 1
      } de ${newItems.length}`
    );
    if (onChange) {
      onChange(newItems, "Orden actualizado");
    }
  };

  const handleDeleteItem = (itemId) => {
    const newItems = items.filter((it) => it.itemId !== itemId);
    if (onChange) {
      onChange(newItems, "Elemento eliminado");
    }
  };

  const handleDuplicateItem = (index) => {
    const item = items[index];
    const copy = { ...item, itemId: crypto.randomUUID() };
    onChange([...items.slice(0, index + 1), copy, ...items.slice(index + 1)], "Contenido duplicado");
    setAnnouncement(`${item.title || "Contenido"} duplicado en la posición ${index + 2}`);
  };

  const handleDeleteBatch = () => {
    if (selectedBatchIds.length === 0) return;
    const newItems = items.filter((it) => !selectedBatchIds.includes(it.itemId));
    setSelectedBatchIds([]);
    if (onChange) {
      onChange(newItems, "Elementos seleccionados eliminados");
    }
  };

  const toggleSelectBatchItem = (itemId) => {
    setSelectedBatchIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  const toggleSelectAllBatch = () => {
    if (selectedBatchIds.length === items.length) {
      setSelectedBatchIds([]);
    } else {
      setSelectedBatchIds(items.map((it) => it.itemId));
    }
  };

  const renderThumbnail = (item) => {
    if (item.type === "video") {
      return (
        <video
          src={item.url || item.thumbnailUrl}
          preload="metadata"
          muted
          playsInline
          className="signage-editor-thumb-media"
        />
      );
    }
    if (item.type === "image" && (item.thumbnailUrl || item.url)) {
      return (
        <img
          src={item.thumbnailUrl || item.url}
          alt={item.title || "Miniatura"}
          loading="lazy"
          className="signage-editor-thumb-media"
        />
      );
    }
    if (item.type === "web") {
      return (
        <div className="signage-editor-thumb-fallback web">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span>WEB</span>
        </div>
      );
    }
    if (item.type === "template" || item.type === "visual_ad") {
      return (
        <div className="signage-editor-thumb-fallback template">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
          <span>{item.type === "visual_ad" ? "AD" : "TPL"}</span>
        </div>
      );
    }
    return (
      <div className="signage-editor-thumb-fallback generic">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <span>MEDIA</span>
      </div>
    );
  };

  return (
    <div className="signage-items-editor-container">
      <div className="signage-screen-reader-live" aria-live="polite">
        {announcement}
      </div>

      {items.length > 0 && (
        <div className="signage-items-editor-toolbar">
          <label className="signage-select-all-label">
            <input
              ref={masterCheckboxRef}
              type="checkbox"
              checked={items.length > 0 && selectedBatchIds.length === items.length}
              onChange={toggleSelectAllBatch}
              aria-label="Seleccionar todos los contenidos"
            />
            <span>Seleccionar todos</span>
          </label>

          {selectedBatchIds.length > 0 && (
            <div className="signage-batch-actions">
              <span>{selectedBatchIds.length} seleccionados</span>
              <button
                type="button"
                className="visual-outline-button danger-table-button"
                onClick={handleDeleteBatch}
                disabled={saving}
              >
                Eliminar seleccionados
              </button>
            </div>
          )}
        </div>
      )}

      <div className="signage-items-scroll-area">
        {items.length === 0 ? (
          <p className="digital-empty">
            Esta playlist no contiene elementos. Usa el botón "+ Agregar contenido"
            para añadir imágenes, videos o plantillas.
          </p>
        ) : (
          items.map((item, index) => {
            const isSelected = selectedItemId === item.itemId;
            const isBatchChecked = selectedBatchIds.includes(item.itemId);
            const isDragging = draggedItemId === item.itemId;
            const isTarget = dragOverItemId === item.itemId;
            const durationVal =
              durationInputs[item.itemId] !== undefined
                ? durationInputs[item.itemId].text
                : formatDurationText(item.durationSeconds);
            const durationError = durationInputs[item.itemId]?.error;

            return (
              <article
                key={item.itemId}
                className={`signage-editor-item-row ${
                  isSelected ? "is-active" : ""
                } ${isDragging ? "is-dragging" : ""} ${
                  isTarget && dropPosition === "above" ? "drop-above" : ""
                } ${isTarget && dropPosition === "below" ? "drop-below" : ""}`}
                onClick={() => onSelectItem && onSelectItem(item.itemId)}
                onFocus={() => onSelectItem && onSelectItem(item.itemId)}
                onDragOver={(e) => handleDragOver(e, item)}
                onDragLeave={(e) => handleDragLeave(e, item)}
                onDrop={(e) => handleDrop(e, item)}
              >
                <button
                  type="button"
                  className="signage-drag-handle"
                  disabled={saving}
                  draggable={!saving && !isEditingAnyDuration}
                  onDragStart={(e) => handleDragStart(e, item)}
                  onDragEnd={handleDragEnd}
                  onKeyDown={(event) => {
                    if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
                      event.preventDefault();
                      handleMoveKeyboard(index, event.key === "ArrowUp" ? -1 : 1);
                    }
                  }}
                  aria-label={`Reordenar ${item.title}, posición ${index + 1}. Alt y flechas para mover` }
                  title="Arrastrar para reordenar"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <circle cx="9" cy="6" r="2" />
                    <circle cx="15" cy="6" r="2" />
                    <circle cx="9" cy="12" r="2" />
                    <circle cx="15" cy="12" r="2" />
                    <circle cx="9" cy="18" r="2" />
                    <circle cx="15" cy="18" r="2" />
                  </svg>
                </button>

                <input
                  type="checkbox"
                  checked={isBatchChecked}
                  onChange={() => toggleSelectBatchItem(item.itemId)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Seleccionar ${item.title || "contenido"}`}
                  className="signage-item-checkbox"
                />

                <div className="signage-editor-item-thumb">
                  <span className="signage-item-position">{index + 1}</span>
                  {renderThumbnail(item)}
                </div>

                <div className="signage-editor-item-title-col">
                  <strong title={item.title || "Sin título"}>
                    {item.title || "Sin título"}
                  </strong>
                  <span className="signage-soft-badge">
                    {{ image: "Imagen", video: "Video", web: "Página web", template: "Plantilla", visual_ad: "Anuncio visual" }[item.type] || "Contenido"}
                  </span>
                </div>

                <div
                  className="signage-duration-control"
                  onClick={(e) => e.stopPropagation()}
                >
                  <label
                    htmlFor={`duration-${item.itemId}`}
                    className="signage-visually-hidden"
                  >
                    Duración de {item.title || "elemento"}
                  </label>
                  <input
                    id={`duration-${item.itemId}`}
                    type="text"
                    disabled={saving}
                    className="signage-duration-input"
                    value={durationVal}
                    onChange={(e) =>
                      handleDurationChange(item.itemId, e.target.value)
                    }
                    onFocus={() => handleDurationFocus(item)}
                    onBlur={() => handleDurationBlur(item)}
                    onKeyDown={(e) => handleDurationKeyDown(e, item)}
                    aria-invalid={Boolean(durationError)}
                    title="Duración en formato MM:SS o HH:MM:SS. Presiona Enter para confirmar o Escape para restaurar."
                  />
                  {durationError && (
                    <span
                      role="alert"
                      className="signage-duration-error-tooltip"
                    >
                      {durationError}
                    </span>
                  )}
                </div>

                <div
                  className="signage-item-step-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="signage-step-btn"
                    onClick={() => handleMoveKeyboard(index, -1)}
                    disabled={saving || index === 0}
                    aria-label="Mover arriba"
                    title="Mover arriba"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="signage-step-btn"
                    onClick={() => handleMoveKeyboard(index, 1)}
                    disabled={saving || index === items.length - 1}
                    aria-label="Mover abajo"
                    title="Mover abajo"
                  >
                    ▼
                  </button>
                </div>

                <div className="signage-item-copy-actions" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className="signage-duplicate-item-btn"
                    onClick={() => handleDuplicateItem(index)}
                    disabled={saving}
                    aria-label={`Duplicar ${item.title || "elemento"}`}
                    title="Duplicar contenido en esta playlist"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <rect x="8" y="8" width="12" height="12" rx="2" />
                      <path d="M16 8V4H4v12h4" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="signage-delete-item-btn danger-table-button"
                    onClick={() => handleDeleteItem(item.itemId)}
                    disabled={saving}
                    aria-label={`Eliminar ${item.title || "elemento"}`}
                    title="Eliminar elemento de la playlist"
                  >
                    ✕
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
