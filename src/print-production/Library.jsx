import { useRef, useState } from "react";
import { Empty, Icon, Modal } from "./UI.jsx";
import { preparePrintDocument, saveMaterial, saveTemplate } from "./service.js";
import { count, errorText, kindFor, TYPES } from "./model.js";
import DrivePicker from "./DrivePicker.jsx";

function picture(item) {
  return item?.imageUrl || item?.templateImageDataUrl || item?.templateImageUrl || item?.frontImageDataUrl || item?.frontImageUrl || "";
}

function Illustration({item}) {
  const url=picture(item);
  return url ? <img className="pp-cover" loading="lazy" alt="" src={url}/> : <div className={"pp-cover pp-cover-"+item.kind}><Icon name={item.kind==="book"?"book":item.kind==="credential"?"card":item.kind==="certificate"?"award":"file"} size={40}/></div>;
}

function LinkEditor({item,isLibrary,products,onClose}) {
  const [name,setName]=useState(item?.name||"");
  const [type,setType]=useState(item?.kind||"book");
  const [state,setState]=useState(item?.status||"draft");
  const [productId,setProduct]=useState(item?.productId||item?.linkedProductId||"");
  const [source,setSource]=useState(item?.source||null);
  const [cloud,setCloud]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const lock=useRef(false), operation=useRef(null);
  async function importFile(input) {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError("");
    try {const src=await preparePrintDocument(input);setSource(src);if(!name)setName(src.name.replace(/\.pdf$/i,""));}
    catch(ex){setError(errorText(ex));throw ex;}finally {lock.current=false;setBusy(false);}
  }
  async function save(e) {
    e.preventDefault();if(lock.current)return;
    if(!source?.id){setError("Selecciona el PDF de producción.");return;}
    lock.current=true;setBusy(true);setError("");
    try {
      const payload=isLibrary?{...(item?.id?{id:item.id,version:item.version}:{}),name:name.trim(),sourceId:source.id,type,status:state,productId}:{productId:item.productId,sourceId:source.id,type,defaults:item.defaults||{},...(item.version?{version:item.version}:{})};
      const signature=JSON.stringify(payload);
      if(operation.current?.signature!==signature) operation.current={signature,id:crypto.randomUUID()};
      await (isLibrary?saveTemplate:saveMaterial)({...payload,requestId:operation.current.id});
      onClose();
    } catch(ex){setError(errorText(ex));}finally {lock.current=false;setBusy(false);}
  }
  return <Modal title={isLibrary?(item?.id?"Editar plantilla":"Nueva plantilla"):"Vincular documento al material"} onClose={busy?undefined:onClose}>
    <form onSubmit={save}><div className="pp-callout"><Icon name="file"/><div><strong>{item?.name||"Archivo reutilizable"}</strong><p>El documento se conserva como una versión de producción.</p></div></div><div className="pp-fields">
      {isLibrary&&<label>Nombre de plantilla<input required value={name} maxLength={160} onChange={e=>setName(e.target.value)}/></label>}
      <label>Tipo<select value={type} onChange={e=>setType(e.target.value)}>{Object.entries(TYPES).filter(([id])=>!["certificate","credential"].includes(id)).map(([id,s])=><option key={id} value={id}>{s}</option>)}</select></label>
      {isLibrary&&<><label>Estado<select value={state} onChange={e=>setState(e.target.value)}>{Object.entries({draft:"Borrador",review:"En revisión",approved:"Aprobada",archived:"Archivada"}).map(([k,s])=><option key={k} value={k}>{s}</option>)}</select></label><label>Material asociado<select value={productId} onChange={e=>setProduct(e.target.value)}><option value="">Sin material</option>{products.filter(p=>!p.deleted&&p.active!==false).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></>}
      <label className="pp-full">Documento PDF<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={e=>{if(e.target.files?.[0])void importFile({file:e.target.files[0]}).catch(()=>{});}}/></label></div><button className="pp-btn" type="button" disabled={busy} onClick={()=>setCloud(true)}>Elegir desde Nube AS</button>
      {source&&<p className="pp-source-line">{source.name} · {source.pages} páginas</p>}{error&&<p role="alert" className="pp-error">{error}</p>}<footer className="pp-dialog-actions"><button className="pp-btn" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="pp-btn pp-primary" disabled={busy}>{busy?"Procesando…":"Guardar"}</button></footer></form>
    {cloud&&<DrivePicker onClose={()=>setCloud(false)} onChoose={driveFile=>importFile({driveFile})}/>}</Modal>;
}

export default function Library({view,products=[],templates=[],credentialTemplates=[],productionTemplates=[],materials=[],isAdmin,onNavigate,onStart,onPreview,user}) {
  const library=view==="templates";
  const [query,setQuery]=useState(""),[type,setType]=useState(""),[selection,setSelection]=useState(""),[edit,setEdit]=useState(null);
  const [onlyFav,setOnlyFav]=useState(false);
  const key="print-production-favorites-"+(user?.uid||"local");
  const [favorites,setFavorites]=useState(()=>{try{return JSON.parse(localStorage.getItem(key)||"[]");}catch{return [];}});
  function favorite(id) {
    const next=favorites.includes(id)?favorites.filter(f=>f!==id):[...favorites,id];setFavorites(next);
    try{localStorage.setItem(key,JSON.stringify(next));}catch{/* Session still shows the selection. */}
  }
  const items=library ? [
    ...productionTemplates.map(t=>({...t,key:"t-"+t.id,kind:kindFor(t)})),
    ...templates.map(t=>({...t,key:"c-"+t.id,legacy:true,kind:"certificate"})),
    ...credentialTemplates.map(t=>({...t,key:"i-"+t.id,legacy:true,kind:"credential"})),
  ] : products.filter(p=>!p.deleted).map(p=>{
    const link=materials.find(m=>m.productId===p.id||m.id===p.id);
    return {...p,...link,productId:p.id,key:p.id,kind:kindFor(link||p)};
  });
  const rows=items.filter(t=>(!query||[t.name,t.sku,t.level,t.category,...(Array.isArray(t.tags)?t.tags:[])].join(" ").toLowerCase().includes(query.toLowerCase()))&&(!type||type===t.kind)&&(!onlyFav||favorites.includes(t.key)));
  const item=rows.find(i=>i.key===selection)||rows[0];
  function openItem(record) {
    if(record.legacy)onNavigate(record.kind==="credential"?"credentials":"requests");
    else onStart({source:record.source||null,type:record.kind,title:record.name,productId:record.productId,defaults:record.defaults});
  }
  return <div className="pp-library">
    <div className="pp-toolbar"><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={library?"Buscar plantilla…":"Buscar material o producto…"} aria-label="Buscar en catálogo"/><select aria-label="Tipo de material" value={type} onChange={e=>setType(e.target.value)}><option value="">Todas las categorías</option>{Object.entries(TYPES).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select>
    {library&&<button className="pp-btn" aria-pressed={onlyFav} onClick={()=>setOnlyFav(!onlyFav)}>★ Favoritas</button>}
    {isAdmin&&<button className="pp-btn pp-primary" onClick={()=>library?setEdit({}):onNavigate("catalog")}>{library?"Nueva plantilla":"Administrar productos"}</button>}</div>
    {rows.length?<div className="pp-library-layout"><div className="pp-library-grid">{rows.map(row=><button key={row.key} className="pp-library-item" aria-pressed={row.key===item?.key} onClick={()=>setSelection(row.key)}><Illustration item={row}/><div><span className="pp-type-chip">{TYPES[row.kind]}</span><strong>{row.name}</strong><small>{row.legacy?"Plantilla de emisión":row.source?.name||row.level||row.category||"Documento por vincular"}</small></div></button>)}</div>
    <aside className="pp-card pp-material-detail"><Illustration item={item}/><span className="pp-type-chip">{TYPES[item.kind]}</span><h3>{item.name}</h3>{item.description&&<p>{item.description}</p>}<dl className="pp-facts"><dt>Origen</dt><dd>{item.legacy?"Plantillas de Imprenta":library?"Biblioteca de producción":"Catálogo de productos"}</dd>{item.source&&<><dt>Documento</dt><dd>{item.source.name}</dd><dt>Páginas</dt><dd>{count(item.source.pages)}</dd></>}{item.version&&<><dt>Versión</dt><dd>{item.version}</dd></>}{item.sku&&<><dt>SKU</dt><dd>{item.sku}</dd></>}</dl>
    <div className="pp-stack"><button className="pp-btn pp-primary" onClick={()=>openItem(item)}>{item.legacy?"Ir al flujo de emisión":"Nueva impresión"}</button>{item.source&&<button className="pp-btn" onClick={()=>onPreview(item.source)}>Ver documento</button>}
    {library&&<button className="pp-btn" onClick={()=>favorite(item.key)}>{favorites.includes(item.key)?"Quitar de favoritas":"Añadir a favoritas"}</button>}
    {isAdmin&&<button className="pp-btn" onClick={()=>item.legacy?onNavigate("templates"):setEdit(item)}>{item.legacy?"Abrir editor de Imprenta":library?"Editar plantilla":"Vincular documento"}</button>}{isAdmin&&library&&!item.legacy&&<button className="pp-btn" onClick={()=>setEdit({...item,id:"",name:item.name+" (copia)"})}>Duplicar plantilla</button>}</div></aside></div>:
    <Empty icon="book" title={library?"Sin plantillas coincidentes":"Sin materiales coincidentes"}>{query||type||onlyFav?"Ajusta los filtros de búsqueda.":library?"Las plantillas autorizadas aparecerán aquí.":"Los productos registrados en Imprenta aparecerán aquí."}</Empty>}
    {edit&&<LinkEditor item={edit} isLibrary={library} products={products} onClose={()=>setEdit(null)}/>}
  </div>;
}
