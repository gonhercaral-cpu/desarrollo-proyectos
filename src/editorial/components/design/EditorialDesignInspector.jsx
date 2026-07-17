import { BUILTIN_EDITORIAL_VARIABLES } from "../../utils/editorialVariables";

export default function EditorialDesignInspector({ editor, design, resolvedSelectedElement, page, master, onAction }) {
  const linkedStyle = resolvedSelectedElement?.styleId ? design.stylesById.get(resolvedSelectedElement.styleId) : null;
  const component = resolvedSelectedElement?.componentId ? design.componentsById.get(resolvedSelectedElement.componentId) : null;
  return (
    <div className="editorial-design-inspector">
      <section><header><strong>Estilo global</strong></header>
        {resolvedSelectedElement ? <>{linkedStyle ? <div className="editorial-linked-design"><span>Vinculado: {linkedStyle.name}</span><button type="button" onClick={() => editor.actions.restoreStyle(resolvedSelectedElement.id)}>Restaurar</button><button type="button" onClick={() => editor.actions.unlinkStyle(resolvedSelectedElement.id, resolvedSelectedElement.style)}>Desvincular</button></div> : <p>Selecciona Aplicar en la biblioteca de Estilos.</p>}</> : <p>Selecciona un elemento compatible.</p>}
      </section>
      {component && <section><header><strong>Componente</strong></header><div className="editorial-linked-design"><span>{component.name}</span><button type="button" onClick={() => onAction("edit-component", component)}>Editar maestro</button><button type="button" onClick={() => onAction("detach-component-instance", resolvedSelectedElement)}>Desvincular instancia</button></div></section>}
      {page?.masterPageId && master && <section><header><strong>Herencia maestra</strong></header>{master.elements?.map((element) => { const override = page.masterOverrides?.[element.id] || {}; return <div className="editorial-master-override" key={`${element.id}-${override.content || "inherited"}`}><strong>{element.name}</strong><label><input type="checkbox" checked={override.hidden === true} onChange={(event) => onAction("override-master", element, { hidden: event.target.checked })} /> Oculto</label>{element.type === "text" && <input defaultValue={override.content ?? ""} placeholder={element.content} onBlur={(event) => onAction("override-master", element, { content: event.target.value })} />}<label>Color local<input type="color" defaultValue={override.style?.fill || element.style?.fill || "#142033"} onBlur={(event) => onAction("override-master", element, { style: { fill: event.target.value } })} /></label><button type="button" onClick={() => onAction("restore-master", element)}>Restaurar</button><button type="button" onClick={() => onAction("detach-master", element)}>Convertir en local</button></div>; })}</section>}
      <section><header><strong>Variables disponibles</strong></header><div className="editorial-variable-chips">{BUILTIN_EDITORIAL_VARIABLES.map((key) => <code key={key}>{`{{${key}}}`}</code>)}{design.variables.map((variable) => <code key={variable.id}>{`{{${variable.key}}}`}</code>)}</div><p>Los placeholders permanecen editables y se resuelven al renderizar.</p></section>
    </div>
  );
}
