import EditorialIcon from "../EditorialIcon";

function PageRow({ page, label, active, ordering, onSelect, onActions }) {
  return (
    <div
      className={`editorial-tree-page-wrap ${ordering.dragged?.id === page.id ? "dragging" : ""}`}
      draggable
      onDragStart={ordering.beginDrag("page", page.id)}
      onDragEnd={ordering.endDrag}
      onDragOver={ordering.allowDrop}
      onDrop={ordering.dropOnPage(page.id)}
    >
      <button type="button" className={`editorial-tree-row page ${active ? "active" : ""}`} onClick={() => onSelect(page.id)}>
        <EditorialIcon name="page" size={13} />
        <span>{page.name}</span>
        <small>{label || "—"}</small>
      </button>
      <button type="button" className="editorial-tree-actions" onClick={() => onActions(page)} aria-label={`Acciones de ${page.name}`}><EditorialIcon name="more" size={13} /></button>
    </div>
  );
}

export default function EditorialStructureTree({
  document,
  pages,
  sections,
  selectedPageId,
  numbering,
  ordering,
  onSelectPage,
  onPageActions,
  onCreateSection,
  onCreatePage,
  onEditSection,
  onDeleteSection,
  onToggleSection,
}) {
  const unsectioned = pages.filter((page) => !page.sectionId || !sections.some((section) => section.id === page.sectionId));
  return (
    <section className="editorial-tree-section">
      <header>
        <strong>Estructura del libro</strong>
        <span className="editorial-tree-header-actions">
          <button type="button" onClick={() => onCreatePage({})} title="Nueva página"><EditorialIcon name="page" size={14} /></button>
          <button type="button" onClick={() => onCreateSection("custom")} title="Nueva sección"><EditorialIcon name="plus" size={14} /></button>
          <button type="button" onClick={() => onCreateSection("unit")} title="Nueva unidad"><b>U</b></button>
          <button type="button" onClick={() => onCreateSection("chapter")} title="Nuevo capítulo"><b>C</b></button>
        </span>
      </header>
      <div className="editorial-tree-list">
        <div className="editorial-tree-row document"><EditorialIcon name="books" size={15} /><span>{document?.name || "Documento principal"}</span></div>
        {sections.map((section) => {
          const sectionPages = pages.filter((page) => page.sectionId === section.id);
          return (
            <div
              className={`editorial-tree-section-group ${section.collapsed ? "collapsed" : ""} ${ordering.dragged?.id === section.id ? "dragging" : ""}`}
              key={section.id}
              draggable
              onDragStart={ordering.beginDrag("section", section.id)}
              onDragEnd={ordering.endDrag}
              onDragOver={ordering.allowDrop}
              onDrop={ordering.dropOnSection(section.id)}
            >
              <div className="editorial-tree-row section">
                <button type="button" onClick={() => onToggleSection(section)} aria-label={section.collapsed ? `Expandir ${section.name}` : `Contraer ${section.name}`}><EditorialIcon name="chevron" size={12} /></button>
                <strong>{section.name}</strong><small>{sectionPages.length}</small>
                <button type="button" onClick={() => onCreatePage({ sectionId: section.id })} aria-label={`Agregar página a ${section.name}`}><EditorialIcon name="plus" size={12} /></button>
                <button type="button" onClick={() => onEditSection(section)} aria-label={`Editar ${section.name}`}><EditorialIcon name="edit" size={12} /></button>
                <button type="button" onClick={() => onDeleteSection(section)} aria-label={`Eliminar ${section.name}`}><EditorialIcon name="trash" size={12} /></button>
              </div>
              {!section.collapsed && sectionPages.map((page) => <PageRow key={page.id} page={page} label={numbering.get(page.id)?.label} active={selectedPageId === page.id} ordering={ordering} onSelect={onSelectPage} onActions={onPageActions} />)}
            </div>
          );
        })}
        {unsectioned.length > 0 && (
          <div className="editorial-tree-section-group unsectioned" onDragOver={ordering.allowDrop} onDrop={ordering.dropOnSection("")}>
            <div className="editorial-tree-row section"><EditorialIcon name="page" size={13} /><strong>Sin sección</strong><small>{unsectioned.length}</small></div>
            {unsectioned.map((page) => <PageRow key={page.id} page={page} label={numbering.get(page.id)?.label} active={selectedPageId === page.id} ordering={ordering} onSelect={onSelectPage} onActions={onPageActions} />)}
          </div>
        )}
      </div>
    </section>
  );
}
