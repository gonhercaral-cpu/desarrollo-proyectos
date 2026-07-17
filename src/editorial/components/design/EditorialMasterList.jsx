export default function EditorialMasterList({ masters, activeId, onAction }) {
  return (
    <section className="editorial-master-list">
      <header><strong>Páginas maestras</strong><button type="button" onClick={() => onAction("create-master")}>+</button></header>
      {masters.map((master) => <div className={activeId === master.id ? "active" : ""} key={master.id}><button type="button" onClick={() => onAction("edit-master", master)}><span>{master.side === "left" ? "I" : master.side === "right" ? "D" : "A"}</span>{master.name}</button><button type="button" onClick={() => onAction("assign-master", master)} title="Asignar a la página activa">Aplicar</button><button type="button" onClick={() => onAction("duplicate-master", master)}>Duplicar</button><button type="button" onClick={() => onAction("rename-master", master)}>Renombrar</button><button type="button" onClick={() => onAction("delete-master", master)}>×</button></div>)}
      {!masters.length && <p>Sin maestras. Crea una para heredar fondo y elementos.</p>}
    </section>
  );
}
