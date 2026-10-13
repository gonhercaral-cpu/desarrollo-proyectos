import { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytesResumable } from "firebase/storage";
import { functions, storage } from "../../services/firebase";
import { canClassroom } from "../utils/permissions";
import { isMusicFile } from "../utils/backgroundMusic";
import DriveResourceImportDialog from "./DriveResourceImportDialog";
const call = async (name, data = {}) => (await httpsCallable(functions, name, { timeout: 540000 })(data)).data;
export default function AmbientMusicLibrary({ profile }) {
  const [catalog, setCatalog] = useState({ ambientCatalogVersion: 0, tracks: [] });
  const [busy, setBusy] = useState(""); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [importing, setImporting] = useState(false); const [replacement, setReplacement] = useState(""); const [preview, setPreview] = useState("");
  const audio = useRef(null); const uploadInput = useRef(null); const live = useRef(true);
  const allowed = key => canClassroom(profile, key); const canOrder = allowed("orderMaterial");
  async function run(label, operation) {
    if (busy) return; setBusy(label); setError("");
    try { const result = await operation(); if (live.current && result?.catalog) setCatalog(result.catalog); return result; }
    catch (failure) { if (live.current) setError(failure.message || "No se pudo actualizar la música."); throw failure; }
    finally { if (live.current) setBusy(""); }
  }
  useEffect(() => {
    live.current = true;
    call("getActiveClassroomAmbientCatalog").then(async result => {
      if (!live.current) return; setCatalog(result.catalog);
      if (!result.catalog.migrated && canOrder) {
        setBusy("Recuperando música existente…"); const migrated = await call("migrateActiveClassroomAmbient");
        if (live.current) { setCatalog(migrated.catalog); setMessage(migrated.failures?.length ? "Algunas referencias anteriores no están disponibles. Borradores y publicaciones se conservan." : "Música existente recuperada. No necesitas republicar Units."); }
      }
    }).catch(failure => { if (live.current) setError(failure.message || "No se pudo cargar la música."); }).finally(() => { if (live.current) setBusy(""); });
    return () => { live.current = false; };
  }, [canOrder]);
  useEffect(() => { const element = audio.current; if (!element || !preview) return; element.src = preview; void element.play().catch(() => {}); return () => { element.pause(); element.removeAttribute("src"); element.load(); }; }, [preview]);
  async function upload(file) {
    if (!file) return;
    await run("Subiendo audio…", async () => {
      const mime = file.type || ({ mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac" })[file.name.split(".").pop().toLowerCase()];
      const prepared = await call("uploadActiveClassroomAmbient", { action: "prepare", name: file.name, size: file.size, mime });
      await new Promise((resolve, reject) => { const task = uploadBytesResumable(ref(storage, prepared.storagePath), file, { contentType: mime, customMetadata: { uploadedByUid: profile.uid, folderId: "ambient", originalName: file.name } }); task.on("state_changed", snapshot => { if (live.current) setMessage(`Subiendo ${file.name}: ${Math.round(100 * snapshot.bytesTransferred / snapshot.totalBytes)}%`); }, reject, resolve); });
      if (live.current) setMessage("Verificando y guardando audio…");
      const result = await call("uploadActiveClassroomAmbient", { action: "finish", resourceId: prepared.resourceId, replaceId: replacement || undefined }); setReplacement(""); setMessage("Audio disponible globalmente. Desktop lo sincronizará sin republicar Units."); return result;
    });
  }
  async function edit(data) { await run("Guardando música…", () => call("editActiveClassroomAmbient", data)); }
  function move(index, delta) { const ids = catalog.tracks.map(track => track.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; void edit({ action: "order", ids }).catch(() => {}); }
  return <section className="ac-console-panel ac-ambient-library">
    <header className="ac-panel-title"><div><h2>Música ambiente</h2><p>Biblioteca de música para todas las Units y niveles. Disponible offline después de sincronizar Desktop.</p></div><span>Catálogo v{catalog.ambientCatalogVersion}</span></header>
    <div className="ac-unit-actions"><button className="ac-outline-button" disabled={Boolean(busy) || !allowed("importDrive")} onClick={() => { setReplacement(""); setImporting(true); }}>+ Importar desde Nube AES</button><button className="ac-primary-button" disabled={Boolean(busy) || !allowed("uploadMaterial")} onClick={() => { setReplacement(""); uploadInput.current.click(); }}>+ Agregar archivo</button><input hidden ref={uploadInput} type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.wav,.flac" onChange={event => { const file = event.target.files[0]; event.target.value = ""; void upload(file).catch(() => {}); }}/></div>
    {busy && <p role="status">{busy}</p>}{message && <p role="status">{message}</p>}{error && <p role="alert" className="ac-error-banner">{error}</p>}
    {preview && <audio ref={audio} controls aria-label="Preview de música ambiente"/>}
    <div className="ac-console-table-scroll"><table className="ac-console-table"><thead><tr><th>Título</th><th>Formato</th><th>Tamaño</th><th>Estado</th><th>Origen</th><th>Acciones</th></tr></thead><tbody>{catalog.tracks.map((track, index) => <tr key={track.id}><td><strong>{track.title}</strong>{track.duration && <small>{Math.round(track.duration)} s</small>}</td><td>{track.mime.replace("audio/", "").toUpperCase()}</td><td>{(track.size / 1024 / 1024).toFixed(1)} MiB</td><td><span className="ac-console-status is-positive">Disponible</span></td><td>{track.source === "drive" ? "Nube AES" : track.source === "migrated" ? "Unit existente" : "Archivo"}</td><td><div className="ac-unit-actions">
      <button disabled={Boolean(busy)} onClick={() => { void run("Abriendo preview…", async () => { const result = await call("previewActiveClassroomAmbient", { version: catalog.ambientCatalogVersion, trackId: track.id }); setPreview(result.url); }).catch(() => {}); }}>▶ Preview</button>
      <button disabled={Boolean(busy) || !canOrder} onClick={() => { const name = window.prompt("Título de canción", track.title); if (name?.trim()) void edit({ action: "rename", id: track.id, title: name.trim() }).catch(() => {}); }}>Renombrar</button><button disabled={!index || Boolean(busy) || !canOrder} onClick={() => move(index, -1)}>↑</button><button disabled={index === catalog.tracks.length - 1 || Boolean(busy) || !canOrder} onClick={() => move(index, 1)}>↓</button>
      <button disabled={Boolean(busy) || !canOrder || !allowed("importDrive")} onClick={() => { setReplacement(track.id); setImporting(true); }}>Reemplazar desde Nube AES</button><button disabled={Boolean(busy) || !canOrder || !allowed("uploadMaterial")} onClick={() => { setReplacement(track.id); uploadInput.current.click(); }}>Reemplazar archivo</button><button disabled={Boolean(busy) || !canOrder} onClick={() => { if (window.confirm("¿Quitar esta pista de la biblioteca global? Las publicaciones históricas conservan sus archivos.")) void edit({ action: "remove", id: track.id }).catch(() => {}); }}>Eliminar</button>
    </div></td></tr>)}</tbody></table></div>
    {!catalog.tracks.length && !busy && <p>Sin música configurada</p>}
    {importing && <DriveResourceImportDialog unit={{ id: "ambient", name: "Biblioteca de música" }} resources={[]} draft={{ generalResourceIds: [] }} globalMusic acceptFile={isMusicFile} selectionLimit={replacement ? 1 : undefined} destination="Biblioteca de música" onClose={() => { setImporting(false); setReplacement(""); }} onImport={async (files, _folder, progress) => {
      const imported = []; const failed = [];
      for (const [index, file] of files.entries()) { progress({ completed: index, total: files.length, name: file.name }); try { await run("Guardando audio desde Nube AES…", () => call("importActiveClassroomAmbient", { driveFileId: file.id, replaceId: replacement || undefined })); imported.push({ id: file.id }); } catch (failure) { failed.push({ file, message: failure.message }); } }
      return { imported, failed };
    }}/>}</section>;
}
