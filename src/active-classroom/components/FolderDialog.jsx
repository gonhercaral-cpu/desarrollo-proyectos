import { useEffect, useRef, useState } from "react";

export default function FolderDialog({ folder, saving, onClose, onSubmit, levels = [], initialLevel = "" }) {
  const [name, setName] = useState(folder?.name || "");
  const [level, setLevel] = useState(initialLevel || levels[0]?.id || "");
  const inputRef = useRef(null);

  useEffect(() => {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    await onSubmit(name, level);
  }

  return (
    <div className="ac-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="ac-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ac-folder-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ac-dialog-icon" aria-hidden="true">▰</div>
        <div>
          <h2 id="ac-folder-dialog-title">{folder ? "Renombrar Unit" : "Nueva Unit"}</h2>
          <p>Carpeta guardada en catálogo Firebase de Active Classroom.</p>
        </div>
        <form onSubmit={handleSubmit}>
          <label>
            Nombre de carpeta
            <input
              ref={inputRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={56}
              placeholder="Ej. Unit 17"
            />
          </label>
          {!folder && <label>Nivel<select required value={level} onChange={event => setLevel(event.target.value)}><option value="">Selecciona nivel</option>{levels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <div className="ac-dialog-actions">
            <button type="button" className="ac-outline-button" disabled={saving} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="ac-primary-button" disabled={saving || !name.trim()}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
