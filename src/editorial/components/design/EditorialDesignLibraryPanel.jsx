import { useMemo, useState } from "react";
import EditorialIcon from "../EditorialIcon";

function LibraryItem({ item, meta, actions }) {
  return (
    <article className="editorial-design-card">
      <button type="button" className="editorial-design-card-main" onClick={actions.primary}><span className="editorial-design-thumbnail" style={{ background: item.thumbnail?.background || item.background || undefined }} /><span><strong>{item.name}</strong><small>{meta}</small></span></button>
      <div>{actions.insert && <button type="button" onClick={actions.insert}>Insertar</button>}{actions.apply && <button type="button" onClick={actions.apply}>Aplicar</button>}{actions.update && <button type="button" onClick={actions.update}>Actualizar</button>}{actions.edit && <button type="button" onClick={actions.edit}>Editar</button>}{actions.duplicate && <button type="button" onClick={actions.duplicate}>Duplicar</button>}{actions.remove && <button type="button" onClick={actions.remove}>Eliminar</button>}</div>
    </article>
  );
}

export default function EditorialDesignLibraryPanel({ activeRail, design, editor, canManageInstitutional, onAction }) {
  const [search, setSearch] = useState("");
  const source = activeRail === "templates" ? design.templates : activeRail === "components" ? design.components : design.styles;
  const items = useMemo(() => source.filter((item) => `${item.name} ${item.category || ""}`.toLowerCase().includes(search.toLowerCase())), [search, source]);
  const title = activeRail === "templates" ? "Plantillas" : activeRail === "components" ? "Componentes" : "Estilos";

  return (
    <aside className="editorial-structure-panel editorial-design-library">
      <header><strong>{title}</strong><span>{items.length}</span></header>
      <div className="editorial-design-tools">
        <label><EditorialIcon name="search" size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar" /></label>
        {activeRail === "templates" && <><button type="button" onClick={() => onAction("save-page")} disabled={editor.mode?.kind !== "page"}>Guardar página</button><button type="button" onClick={() => onAction("save-unit")} disabled={editor.mode?.kind !== "page" || !["unit", "chapter"].includes(editor.section?.type)}>Guardar unidad</button></>}
        {activeRail === "components" && <button type="button" onClick={() => onAction("create-component")} disabled={!editor.selectedElement}>Crear desde selección ({editor.selectedElements?.length || 0})</button>}
        {activeRail === "styles" && <button type="button" onClick={() => onAction("create-style")} disabled={!editor.selectedElement}>Crear desde selección</button>}
      </div>
      <div className="editorial-design-list">
        {items.map((item) => <LibraryItem key={item.id} item={item} meta={activeRail === "templates" ? `${item.type} · ${item.visibility}` : `${item.category || "General"}${activeRail === "components" ? ` · ${item.elements?.length || 0}` : ` · ${item.type}`}`} actions={{
          primary: () => onAction(activeRail === "templates" ? "apply-template" : activeRail === "components" ? "open-component" : "apply-style", item),
          insert: activeRail === "components" ? () => onAction("insert-component", item) : null,
          apply: activeRail !== "components" ? () => onAction(activeRail === "templates" ? "apply-template" : "apply-style", item) : null,
          update: activeRail === "templates" && item.visibility === "project" ? () => onAction("update-template-content", item) : null,
          edit: activeRail !== "templates" || item.visibility !== "institutional" || canManageInstitutional ? () => onAction(`edit-${activeRail.slice(0, -1)}`, item) : null,
          duplicate: activeRail !== "templates" ? () => onAction(`duplicate-${activeRail.slice(0, -1)}`, item) : null,
          remove: activeRail !== "templates" || item.visibility !== "institutional" || canManageInstitutional ? () => onAction(`delete-${activeRail.slice(0, -1)}`, item) : null,
        }} />)}
        {!items.length && <div className="editorial-panel-empty"><EditorialIcon name={activeRail} size={26} /><p>No hay resultados.</p></div>}
      </div>
      {activeRail === "styles" && <section className="editorial-variable-library"><header><strong>Variables</strong><button type="button" onClick={() => onAction("create-variable")}>+</button></header>{design.variables.map((variable) => <div key={variable.id}><code>{`{{${variable.key}}}`}</code><span>{variable.value}</span><button type="button" onClick={() => onAction("edit-variable", variable)}>Editar</button><button type="button" onClick={() => onAction("delete-variable", variable)}>×</button></div>)}<button type="button" onClick={() => onAction("show-variables")}>Ver variables disponibles</button></section>}
    </aside>
  );
}
