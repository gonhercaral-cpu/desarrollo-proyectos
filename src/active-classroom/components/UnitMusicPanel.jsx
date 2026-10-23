import { useEffect, useId, useState } from "react";
import { loadMusicCatalog, previewMusicTrack } from "../services/musicService";
import { canClassroom } from "../utils/permissions";

export default function UnitMusicPanel({ value, profile, disabled, onChange, onOpenSettings }) {
  const id = useId();
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true;
    loadMusicCatalog().then(result => { if (live) setCatalog(result); }).catch(failure => { if (live) setError(failure.message || "No se pudo consultar música."); });
    return () => { live = false; };
  }, []);
  const tracks = catalog?.tracks.filter(track => track.active) || [];
  const defaults = catalog?.playlists.find(playlist => playlist.id === "module-default");
  const trackId = value?.mode === "custom" ? value.trackId : value?.mode === "none" ? null : defaults ? defaults.trackIds[0] : tracks[0]?.id;
  const track = value ? tracks.find(item => item.id === trackId) : null;
  const locked = disabled || !canClassroom(profile, "orderMaterial");
  return <section className="ac-unit-card ac-unit-music"><h2>Música ambiente de esta Unit</h2><p>Elige música predeterminada del módulo o una pista específica. Catálogo compartido; archivos disponibles offline después de sincronizar.</p>
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={locked} className="ac-music-options"><legend className="ac-sr-only">Origen de música ambiente</legend>
      {!value && <label><input type="radio" name={id} checked readOnly /><span><strong>Conservar configuración anterior</strong><small>Se mantienen listas y publicaciones existentes.</small></span></label>}
      <label className={value?.mode === "inherit" ? "is-selected" : ""}><input type="radio" name={id} checked={value?.mode === "inherit"} onChange={() => { onChange({ mode: "inherit", trackId: null }); setPreview(null); }} /><span><strong>Usar música predeterminada del módulo</strong><small>Se actualiza con Ajustes al sincronizar Desktop.</small></span></label>
      <label className={value?.mode === "custom" ? "is-selected" : ""}><input type="radio" name={id} disabled={!tracks.length} checked={value?.mode === "custom"} onChange={() => { onChange({ mode: "custom", trackId: tracks[0].id }); setPreview(null); }} /><span><strong>Seleccionar música específica para esta Unit</strong><small>Selección individual del catálogo existente.</small></span></label>
      <label><input type="radio" name={id} checked={value?.mode === "none"} onChange={() => { onChange({ mode: "none", trackId: null }); setPreview(null); }} />Sin música ambiente</label>
    </fieldset>
    {value?.mode === "custom" && <label className="ac-music-select">Pista de esta Unit<select disabled={locked} value={value.trackId || ""} onChange={event => { onChange({ mode: "custom", trackId: event.target.value }); setPreview(null); }}>{!track && <option value={value.trackId}>Pista no disponible</option>}{tracks.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
    <div className="ac-music-active"><strong>{!value ? "Configuración anterior" : value?.mode === "custom" ? "Música individual" : value?.mode === "none" ? "Música desactivada" : "Música del módulo"}</strong>{track ? <><span>{track.title} · {(track.size / 1024 / 1024).toFixed(1)} MiB</span><button type="button" className="ac-outline-button" disabled={loading} onClick={async () => { setLoading(true); setError(""); try { const result = await previewMusicTrack(catalog.ambientCatalogVersion, track.id); setPreview({ trackId: track.id, url: result.url }); } catch (failure) { setError(failure.message || "No se pudo abrir audio."); } finally { setLoading(false); } }}>{loading ? "Cargando…" : "Cargar vista previa"}</button>{preview?.trackId === track.id && <audio src={preview.url} controls preload="metadata" aria-label={`Vista previa: ${track.title}`} />}</> : <p>{!value ? "Se conserva la reproducción anterior. Administra su lista de música debajo." : catalog ? value?.mode === "custom" ? "La pista ya no está disponible. Selecciona otra antes de guardar." : "Sin pista predeterminada." : "Cargando catálogo…"}</p>}
      {onOpenSettings && <button type="button" className="ac-outline-button" disabled={disabled} onClick={onOpenSettings}>Ir a Ajustes</button>}
    </div><p className="ac-music-note">Guarda y publica para sincronizar esta selección. Publicaciones anteriores conservan sus archivos. La selección individual solo afecta a esta Unit.</p>
  </section>;
}
