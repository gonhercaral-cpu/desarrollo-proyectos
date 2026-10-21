import { isMusicFile, addMusicTracks } from "../utils/backgroundMusic";
export default function BackgroundMusicEditor({ draft, resources, disabled, canImport, canUpload, onChange, onImport, onUpload }) {
  const tracks = draft.backgroundMusic || [];
  const available = resources.filter(isMusicFile).filter(resource => !tracks.some(track => track.resourceId === resource.id));
  function update(next) { onChange({ ...draft, backgroundMusic: next.map((track, order) => ({ ...track, order })) }); }
  function move(index, direction) {
    const next = [...tracks]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; update(next);
  }
  return <section className="ac-unit-card">
    <h2>Música ambiente</h2><p>Archivos publicados para reproducir sin Internet. Audio exclusivo del profesor; volumen independiente.</p>
    <fieldset disabled={disabled}>
      <div className="ac-unit-actions">
        <button className="ac-outline-button" disabled={!canImport} onClick={onImport}>Importar audio desde Nube AES</button>
        <label className="ac-outline-button">Subir audio<input type="file" multiple accept="audio/*,.mp3,.m4a,.aac,.ogg,.wav,.flac" disabled={!canUpload} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) onUpload(files); }} /></label>
        <select aria-label="Añadir audio existente" value="" onChange={event => { const resource = available.find(item => item.id === event.target.value); if (resource) onChange(addMusicTracks(draft, [resource])); }}><option value="">Añadir audio de la Unit…</option>{available.map(resource => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select>
      </div>
      {!tracks.length && <p>Sin música configurada</p>}
      {tracks.map((track, index) => <div className="ac-unit-resource" key={track.resourceId}>
        <label>Título<input value={track.title} maxLength={160} onChange={event => update(tracks.map(item => item === track ? { ...item, title: event.target.value } : item))} /></label>
        <small>{resources.find(resource => resource.id === track.resourceId)?.name || "Archivo no disponible"} · {index + 1} / {tracks.length}</small>
        <div className="ac-unit-actions"><button disabled={!index} onClick={() => move(index, -1)}>Subir</button><button disabled={index === tracks.length - 1} onClick={() => move(index, 1)}>Bajar</button><button onClick={() => update(tracks.filter(item => item !== track))}>Quitar de música ambiente</button></div>
      </div>)}
    </fieldset>
  </section>;
}
