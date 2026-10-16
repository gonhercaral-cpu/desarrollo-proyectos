import { useState } from "react";
import { manageActiveClassroomLevel } from "../services/activeClassroomService";

export default function LevelsPanel({ folders, profile, onOpen }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const levels = folders.filter(folder => folder.kind === "level").sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.name.localeCompare(b.name, "es"));
  async function change(data) {
    setBusy(true); setError("");
    try { await manageActiveClassroomLevel(data, profile); return true; }
    catch (failure) { setError(failure.message || "No se pudo guardar el nivel."); return false; }
    finally { setBusy(false); }
  }
  async function move(index, direction) {
    // Normalize existing positions, including duplicates and sparse legacy values.
    const ordered = [...levels];
    [ordered[index], ordered[index + direction]] = [ordered[index + direction], ordered[index]];
    setBusy(true); setError("");
    try {
      await manageActiveClassroomLevel({ action: "reorder", levelIds: ordered.map(item => item.id) }, profile);
    } catch (failure) { setError(failure.message || "No se pudo ordenar niveles."); }
    finally { setBusy(false); }
  }
  return <section className="ac-section-panel">
    <h1>Niveles</h1><p>Crea y organiza niveles. Desactivar conserva sus Units y publicaciones.</p>
    {error && <div className="ac-error-banner" role="alert">{error}</div>}
    <form className="ac-unit-actions" onSubmit={async event => { event.preventDefault(); if (await change({ action: "create", name, position: levels.length ? Math.max(...levels.map(level => level.position || 0)) + 1 : 0 })) setName(""); }}>
      <label>Nombre del nivel<input required maxLength={160} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <button className="ac-primary-button" disabled={busy || !name.trim()}>Crear nivel</button>
    </form>
    {levels.map((level, index) => <article className="ac-unit-card" key={level.id}>
      <h2>{level.name} <small>{level.active === false ? "Inactivo" : "Activo"}</small></h2>
      <p>{folders.filter(folder => folder.parentId === level.id).length} Units. Para reasignar, abre cada Unit y cambia su Nivel.</p>
      <div className="ac-unit-actions">
        <button className="ac-outline-button" disabled={busy} onClick={() => onOpen(level.id)}>Ver Units</button>
        <button className="ac-outline-button" disabled={busy} onClick={() => { const next = window.prompt("Nombre del nivel", level.name); if (next !== null) void change({ action: "update", levelId: level.id, name: next }); }}>Renombrar</button>
        <button className="ac-outline-button" disabled={busy || index === 0} onClick={() => move(index, -1)}>Subir</button>
        <button className="ac-outline-button" disabled={busy || index === levels.length - 1} onClick={() => move(index, 1)}>Bajar</button>
        <button className="ac-outline-button" disabled={busy} onClick={() => change({ action: "update", levelId: level.id, active: level.active === false })}>{level.active === false ? "Activar" : "Desactivar"}</button>
        <button className="ac-clear-filters" disabled={busy} onClick={() => { if (window.confirm(`¿Eliminar ${level.name}? Solo se permite si no contiene Units.`)) void change({ action: "delete", levelId: level.id }); }}>Eliminar</button>
      </div>
    </article>)}
  </section>;
}
