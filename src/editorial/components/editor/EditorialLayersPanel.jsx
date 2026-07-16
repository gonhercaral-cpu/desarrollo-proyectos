import EditorialIcon from "../EditorialIcon";

export default function EditorialLayersPanel({ elements, selectedId, actions, onSelect }) {
  const ordered = [...elements].sort((a, b) => b.zIndex - a.zIndex);

  if (ordered.length === 0) {
    return <div className="editorial-inspector-empty"><EditorialIcon name="layers" size={28} /><strong>Sin capas</strong><p>Agrega texto, imagen o figura.</p></div>;
  }

  return (
    <div className="editorial-layers-panel">
      <div className="editorial-layers-heading"><span>{ordered.length} elementos</span><small>Frente arriba</small></div>
      {ordered.map((element, index) => (
        <div className={`editorial-layer-row ${selectedId === element.id ? "active" : ""}`} key={element.id}>
          <button type="button" className="editorial-layer-select" onClick={() => onSelect(element.id)} aria-label={`Seleccionar ${element.name}`}>
            <EditorialIcon name={element.type === "shape" ? "rectangle" : element.type} size={16} />
          </button>
          <input value={element.name} onFocus={() => onSelect(element.id)} onChange={(event) => actions.updateElement(element.id, { name: event.target.value })} aria-label={`Nombre de capa ${element.name}`} />
          <button type="button" onClick={() => actions.updateElement(element.id, { visible: !element.visible })} title={element.visible ? "Ocultar" : "Mostrar"}><EditorialIcon name={element.visible ? "eye" : "eyeOff"} size={15} /></button>
          <button type="button" onClick={() => actions.updateElement(element.id, { locked: !element.locked })} title={element.locked ? "Desbloquear" : "Bloquear"}><EditorialIcon name={element.locked ? "lock" : "unlock"} size={15} /></button>
          <div className="editorial-layer-order">
            <button type="button" onClick={() => actions.reorderLayer(element.id, "up")} disabled={index === 0} title="Subir capa"><EditorialIcon name="arrowUp" size={13} /></button>
            <button type="button" onClick={() => actions.reorderLayer(element.id, "down")} disabled={index === ordered.length - 1} title="Bajar capa"><EditorialIcon name="arrowDown" size={13} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
