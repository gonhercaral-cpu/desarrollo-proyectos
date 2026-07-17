import EditorialPageThumbnail from "./EditorialPageThumbnail";

export default function EditorialThumbnailList({
  pages,
  numbering,
  selectedPageId,
  projectId,
  documentId,
  activeElements,
  compact = false,
  ordering,
  onSelect,
  onActions,
}) {
  return (
    <div className={compact ? "editorial-bottom-thumbnail-list" : "editorial-side-thumbnails"}>
      {pages.map((page) => (
        <EditorialPageThumbnail
          key={`${compact ? "bottom" : "side"}-${page.id}`}
          context={{ projectId, documentId, pageId: page.id }}
          page={page}
          label={numbering.get(page.id)?.label}
          active={selectedPageId === page.id}
          elementsOverride={selectedPageId === page.id ? activeElements : null}
          compact={compact}
          onSelect={onSelect}
          onActions={compact ? null : onActions}
          dragProps={{
            draggable: true,
            onDragStart: ordering.beginDrag("page", page.id),
            onDragEnd: ordering.endDrag,
            onDragOver: ordering.allowDrop,
            onDrop: ordering.dropOnPage(page.id),
          }}
        />
      ))}
    </div>
  );
}
