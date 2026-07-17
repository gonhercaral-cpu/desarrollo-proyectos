import { useState } from "react";

export default function EditorialSongDialog({ open, onClose, onSubmit }) {
  const [form, setForm] = useState({ title: "", artist: "", level: "", lyrics: "", blankWords: "", showWordBank: true, preActivity: "", postActivity: "", vocabulary: "", questions: "", audioReference: "" });
  if (!open) return null;
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="editorial-dialog-layer">
      <button type="button" className="editorial-dialog-backdrop" onClick={onClose} aria-label="Cerrar" />
      <form className="editorial-dialog editorial-academic-dialog song" onSubmit={(event) => { event.preventDefault(); onSubmit({ ...form, blankWords: form.blankWords.split(/[,\n]/).map((word) => word.trim()).filter(Boolean) }); }}>
        <header><div><span className="editorial-eyebrow">Asistente de canción</span><h2>Crear hoja de canción</h2></div></header>
        <div className="editorial-structure-form">
          <div className="editorial-academic-field-grid"><label>Título<input value={form.title} onChange={(event) => update("title", event.target.value)} required /></label><label>Artista<input value={form.artist} onChange={(event) => update("artist", event.target.value)} /></label><label>Nivel<input value={form.level} onChange={(event) => update("level", event.target.value)} /></label><label>Audio / referencia<input value={form.audioReference} onChange={(event) => update("audioReference", event.target.value)} /></label></div>
          <label>Letra y secciones<textarea rows="9" value={form.lyrics} onChange={(event) => update("lyrics", event.target.value)} placeholder={'[verse: Verse 1]\nPega la letra aquí\n\n[chorus]\nCoro'} required /><small>Usa [verse], [chorus], [bridge] o [custom: título] para dividir manualmente.</small></label>
          <label>Palabras faltantes · separadas por coma<input value={form.blankWords} onChange={(event) => update("blankWords", event.target.value)} /></label>
          <label className="editorial-inspector-checkbox"><input type="checkbox" checked={form.showWordBank} onChange={(event) => update("showWordBank", event.target.checked)} />Mostrar banco de palabras</label>
          <div className="editorial-academic-field-grid"><label>Actividad previa<textarea rows="3" value={form.preActivity} onChange={(event) => update("preActivity", event.target.value)} /></label><label>Actividad posterior<textarea rows="3" value={form.postActivity} onChange={(event) => update("postActivity", event.target.value)} /></label><label>Vocabulario<textarea rows="3" value={form.vocabulary} onChange={(event) => update("vocabulary", event.target.value)} /></label><label>Comprensión<textarea rows="3" value={form.questions} onChange={(event) => update("questions", event.target.value)} /></label></div>
          <p className="editorial-design-warning">La letra se aporta manualmente. No se consulta ni descarga contenido externo.</p>
        </div>
        <footer><button type="button" className="editorial-button secondary" onClick={onClose}>Cancelar</button><button type="submit" className="editorial-button primary">Generar hoja</button></footer>
      </form>
    </div>
  );
}
