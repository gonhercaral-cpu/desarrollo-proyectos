import { useEffect, useState } from "react";
import { listDriveFolder, listAllowedDriveDepartmentFolders, listMyDrive, searchDriveFiles } from "../services/driveService.js";
import { Empty, Icon, Modal } from "./UI.jsx";
import { errorText, humanSize } from "./model.js";

const FOLDER = "application/vnd.google-apps.folder";

export default function DrivePicker({ onChoose, onClose }) {
  const [path, setPath] = useState([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [grid, setGrid] = useState(false);
  const folder = path.at(-1)?.id;
  useEffect(() => {
    let current = true;
    async function fetchList() {
      if (!folder) {
        const [departments, mine] = await Promise.allSettled([listAllowedDriveDepartmentFolders(), listMyDrive()]);
        if (departments.status === "rejected" && mine.status === "rejected") throw departments.reason;
        const folders = departments.value?.folders || [];
        const result = folders.filter(f => f.folderId).map(f => ({id: f.folderId, name: f.departmentName || f.folderName, mimeType: FOLDER}));
        const own = mine.value?.folderId || mine.value?.rootFolderId;
        if (own) result.unshift({id: own, name:"Mi unidad", mimeType:FOLDER});
        return result;
      }
      return (search ? await searchDriveFiles({query:search,folderId:folder,type:"all"}) : await listDriveFolder(folder)).files || [];
    }
    fetchList().then(files => {if (current) setItems(files);}).catch(ex => {if (current) setError(errorText(ex));}).finally(() => {if (current) setLoading(false);});
    return () => {current=false;};
  }, [folder, search, attempt]);
  function reset() {setLoading(true);setError("");setItems([]);setSelected(null);}
  function go(next) {reset();setPath(next);setSearch("");setQuery("");}
  async function choose() {
    if (!selected || loading) return;
    setLoading(true);setError("");
    try {await onChoose(selected);onClose();} catch (ex) {setError(errorText(ex));} finally {setLoading(false);}
  }
  return <Modal title="Importar desde Nube AS" onClose={loading && selected ? undefined : onClose} wide>
    <nav className="pp-crumb" aria-label="Carpetas"><button type="button" onClick={() => go([])}>Nube AS</button>{path.map((p,i) => <button type="button" key={p.id} onClick={() => go(path.slice(0,i+1))}>› {p.name}</button>)}</nav>
    <form className="pp-toolbar" onSubmit={e=>{e.preventDefault();if(search!==query.trim()){reset();setSearch(query.trim());}}}>
      <input type="search" aria-label="Buscar documentos" placeholder={folder ? "Buscar documentos en esta carpeta…" : "Selecciona una carpeta para buscar"} disabled={!folder} value={query} onChange={e=>setQuery(e.target.value)}/>
      <button type="submit" className="pp-btn" disabled={!folder || loading}>Buscar</button><button type="button" className="pp-btn" onClick={()=>setGrid(!grid)}>{grid?"Lista":"Tarjetas"}</button>
    </form>
    {error && <p role="alert" className="pp-error">{error} <button onClick={()=>{reset();setAttempt(attempt+1);}}>Reintentar</button></p>}
    {loading ? <p role="status" className="pp-loading">Consultando Nube AS…</p> : !items.length ? <Empty icon="cloud" title="Carpeta sin documentos">Puedes elegir otra ubicación con acceso.</Empty> :
      <div className={grid ? "pp-tiles" : "pp-filelist"}>{items.map(file=>{
        const isFolder=file.mimeType===FOLDER, compatible=file.mimeType==="application/pdf" || /\.pdf$/i.test(file.name);
        return <button className="pp-tile" aria-pressed={!isFolder && selected?.id===file.id} disabled={!isFolder&&!compatible} key={file.id} onClick={()=>isFolder ? go([...path,file]) : setSelected(file)}><Icon name={isFolder?"folder":"file"}/><span><strong>{file.name}</strong><small>{isFolder?"Carpeta":compatible?"PDF · "+humanSize(file.size):"Formato sin conversión de producción"}</small></span></button>;
      })}</div>}
    <footer className="pp-dialog-actions"><span>{selected?.name}</span><button className="pp-btn" type="button" onClick={onClose} disabled={loading && !!selected}>Cancelar</button><button type="button" className="pp-btn pp-primary" disabled={!selected||loading} onClick={choose}>Usar documento</button></footer>
  </Modal>;
}
