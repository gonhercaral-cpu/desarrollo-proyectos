import EditorialIcon from "../EditorialIcon";

function NumberField({ label, value, min, max, step = 1, onChange }) {
  return (
    <label className="editorial-inspector-field">
      <span>{label}</span>
      <input type="number" value={Number(value ?? 0)} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export default function EditorialElementInspector({ element, actions }) {
  if (!element) {
    return <div className="editorial-inspector-empty"><span className="editorial-panel-empty-icon"><EditorialIcon name="settings" size={27} /></span><strong>Propiedades</strong><p>Selecciona un elemento para editarlo.</p></div>;
  }

  const update = (changes) => actions.updateElement(element.id, changes);
  const updateStyle = (style) => update({ style });

  async function handleReplaceImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await actions.replaceImage(element.id, file).catch(() => {});
  }

  return (
    <div className="editorial-element-inspector">
      <section>
        <header><strong>{element.name}</strong><span>{element.type}</span></header>
        <div className="editorial-inspector-grid four">
          <NumberField label="X" value={element.x} step={0.5} onChange={(x) => update({ x })} />
          <NumberField label="Y" value={element.y} step={0.5} onChange={(y) => update({ y })} />
          <NumberField label="Ancho" value={element.width} min={10} step={0.5} onChange={(width) => update({ width })} />
          <NumberField label="Alto" value={element.height} min={10} step={0.5} onChange={(height) => update({ height })} />
        </div>
        <div className="editorial-inspector-grid two">
          <NumberField label="Rotación" value={element.rotation} min={-360} max={360} onChange={(rotation) => update({ rotation })} />
          <NumberField label="Opacidad %" value={Math.round(element.opacity * 100)} min={0} max={100} onChange={(opacity) => update({ opacity: opacity / 100 })} />
        </div>
        <div className="editorial-inspector-checks">
          <label><input type="checkbox" checked={element.visible} onChange={(event) => update({ visible: event.target.checked })} />Visible</label>
          <label><input type="checkbox" checked={element.locked} onChange={(event) => update({ locked: event.target.checked })} />Bloqueado</label>
        </div>
      </section>

      {element.type === "text" && (
        <section>
          <header><strong>Texto</strong></header>
          <label className="editorial-inspector-field wide"><span>Contenido</span><textarea rows="4" value={element.content} onChange={(event) => update({ content: event.target.value })} /></label>
          <div className="editorial-inspector-grid two">
            <label className="editorial-inspector-field"><span>Fuente</span><select value={element.style?.fontFamily || "Arial"} onChange={(event) => updateStyle({ fontFamily: event.target.value })}><option>Arial</option><option>Georgia</option><option>Verdana</option><option>Times New Roman</option><option>Courier New</option></select></label>
            <NumberField label="Tamaño" value={element.style?.fontSize || 24} min={6} max={240} onChange={(fontSize) => updateStyle({ fontSize })} />
            <label className="editorial-inspector-field"><span>Peso</span><select value={element.style?.fontWeight || "normal"} onChange={(event) => updateStyle({ fontWeight: event.target.value })}><option value="normal">Regular</option><option value="bold">Negrita</option></select></label>
            <label className="editorial-inspector-field"><span>Alineación</span><select value={element.style?.align || "left"} onChange={(event) => updateStyle({ align: event.target.value })}><option value="left">Izquierda</option><option value="center">Centro</option><option value="right">Derecha</option><option value="justify">Justificar</option></select></label>
          </div>
          <label className="editorial-inspector-field color"><span>Color</span><input type="color" value={element.style?.fill || "#142033"} onChange={(event) => updateStyle({ fill: event.target.value })} /></label>
        </section>
      )}

      {element.type === "shape" && (
        <section>
          <header><strong>Figura</strong></header>
          <div className="editorial-inspector-grid two">
            <label className="editorial-inspector-field color"><span>Relleno</span><input type="color" value={element.style?.fill || "#e2f0ff"} onChange={(event) => updateStyle({ fill: event.target.value })} /></label>
            <label className="editorial-inspector-field color"><span>Borde</span><input type="color" value={element.style?.borderColor || "#1677eb"} onChange={(event) => updateStyle({ borderColor: event.target.value })} /></label>
            <NumberField label="Grosor" value={element.style?.borderWidth || 0} min={0} max={40} onChange={(borderWidth) => updateStyle({ borderWidth })} />
            <NumberField label="Radio" value={element.style?.cornerRadius || 0} min={0} max={200} onChange={(cornerRadius) => updateStyle({ cornerRadius })} />
          </div>
        </section>
      )}

      {element.type === "image" && (
        <section>
          <header><strong>Imagen</strong></header>
          <label className="editorial-inspector-file"><EditorialIcon name="image" size={17} /> Reemplazar imagen<input type="file" accept="image/*" onChange={handleReplaceImage} /></label>
          <label className="editorial-inspector-field wide"><span>Ajuste</span><select value={element.style?.fit || "cover"} onChange={(event) => updateStyle({ fit: event.target.value })}><option value="cover">Cover</option><option value="contain">Contain</option></select></label>
          <label className="editorial-inspector-checkbox"><input type="checkbox" checked={element.style?.maintainAspect !== false} onChange={(event) => updateStyle({ maintainAspect: event.target.checked })} />Mantener proporción</label>
        </section>
      )}

      <section className="editorial-inspector-actions">
        <button type="button" onClick={() => actions.reorderLayer(element.id, "front")}><EditorialIcon name="arrowUp" size={15} />Al frente</button>
        <button type="button" onClick={() => actions.reorderLayer(element.id, "back")}><EditorialIcon name="arrowDown" size={15} />Atrás</button>
        <button type="button" onClick={actions.duplicate}><EditorialIcon name="copy" size={15} />Duplicar</button>
        <button type="button" className="danger" onClick={actions.remove}><EditorialIcon name="trash" size={15} />Eliminar</button>
      </section>
    </div>
  );
}
