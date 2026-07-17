export default function EditorialPageActionsMenu({ page, sections, onClose, actions }) {
  if (!page) return null;
  return (
    <div className="editorial-page-actions-menu" role="menu" aria-label={`Acciones de ${page.name}`}>
      <button type="button" onClick={() => actions.insert("before")}>Insertar antes</button>
      <button type="button" onClick={() => actions.insert("after")}>Insertar después</button>
      <button type="button" onClick={actions.duplicate}>Duplicar con elementos</button>
      <button type="button" onClick={actions.rename}>Renombrar</button>
      <button type="button" onClick={actions.toggleBlank}>{page.isBlank ? "Quitar página en blanco" : "Marcar en blanco"}</button>
      <button type="button" onClick={actions.toggleNumbering}>{page.numberingEnabled ? "Ocultar numeración" : "Activar numeración"}</button>
      <label>
        <span>Mover a sección</span>
        <select value={page.sectionId || ""} onChange={(event) => actions.move(event.target.value)}>
          <option value="">Sin sección</option>
          {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
        </select>
      </label>
      <button type="button" className="danger" onClick={actions.remove}>Eliminar página</button>
      <button type="button" className="close" onClick={onClose}>Cerrar</button>
    </div>
  );
}
