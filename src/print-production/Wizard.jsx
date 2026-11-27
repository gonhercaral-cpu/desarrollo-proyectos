import { useEffect, useRef, useState } from "react";
import { Icon, Modal } from "./UI.jsx";
import DrivePicker from "./DrivePicker.jsx";
import { preparePrintDocument, previewDocument, saveJob } from "./service.js";
import { count, errorText, humanSize, millis, sourceName, TYPES } from "./model.js";

const steps = ["Seleccionar archivo", "Configurar impresión", "Distribuir por impresora", "Revisar y confirmar"];
const modes = {single:"Una impresora", pages:"Rangos de páginas", copies:"Ejemplares completos", smart:"Distribución inteligente"};
const typeIcons = {book:"book",certificate:"award",credential:"card",flyer:"file",brochure:"book",worksheet:"file"};

export function PdfPreview({source, onClose}) {
  const [url,setUrl]=useState(""),[error,setError]=useState("");
  useEffect(()=>{
    let current=true, objectUrl="";
    previewDocument(source).then(blob=>{if(current){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}}).catch(ex=>{if(current)setError(errorText(ex));});
    return ()=>{current=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[source]);
  return <Modal title={sourceName(source)} onClose={onClose} wide>{error ? <p className="pp-error" role="alert">{error}</p> : url ? <><iframe className="pp-pdf" title="Vista previa del PDF definitivo" src={url}/><a href={url} download={sourceName(source)}>Descargar documento</a></> : <p role="status">Abriendo el PDF definitivo…</p>}</Modal>;
}

function printerReady(p) {
  return p.active!==false && p.online===true && Date.now()-millis(p.lastSeenAt)<=120000;
}

export default function Wizard({initial={}, settings={}, printers=[], products=[], onClose,onSaved,onNavigate,openCloud=false}) {
  const draft=initial.job || {};
  const [step,setStep]=useState(0), [source,setSource]=useState(initial.source || draft.source || null);
  const [type,setType]=useState(initial.type || draft.type || "book"), [title,setTitle]=useState(initial.title || draft.title || "");
  const [productId,setProductId]=useState(initial.productId || draft.productId || "");
  const {mode:defaultMode,...defaultConfig}=settings.defaults||{};
  const [config,setConfig]=useState({copies:1,paper:"A4",color:true,duplex:false,priority:"normal",...defaultConfig,...initial.defaults,...draft.config});
  const [mode,setMode]=useState(draft.mode || defaultMode || "single");
  const [printerIds,setPrinters]=useState([...new Set((draft.parts||[]).map(part=>part.printerId))]);
  const [manual,setManual]=useState(false),[ranges,setRanges]=useState({});
  const [busy,setBusy]=useState(false), [error,setError]=useState(""), [cloud,setCloud]=useState(openCloud),[preview,setPreview]=useState(false);
  const [drag,setDrag]=useState(false);
  const lock=useRef(false), operation=useRef(null), fileInput=useRef(null);
  const pages=source?.pages || 0, copies=Number(config.copies)||0;
  const selectedPrinters=printers.filter(p=>printerIds.includes(p.id));
  const personal=type==="certificate"||type==="credential";
  const ready=printers.filter(printerReady);
  const sheets=(config.duplex?Math.ceil(pages/2):pages)*copies;
  const set=(key,value)=>setConfig(old=>({...old,[key]:value}));
  const compatible=p=>printerReady(p)&&(!config.duplex||p.duplex===true)&&(!config.color||p.color===true)&&(!p.paperSizes?.length||p.paperSizes.includes(config.paper));
  const options=[...new Set(["A4","Letter","Legal","A3",...ready.flatMap(p=>p.paperSizes||[])])];
  function pickType(next) {
    if(next===type)return;
    if(personal||next==="certificate"||next==="credential"){setSource(null);setTitle("");setProductId("");}
    setType(next);setError("");
  }
  async function take(input) {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError("");
    try {
      const next=await preparePrintDocument(input);
      setSource(next);setTitle(t=>t || sourceName(next).replace(/\.pdf$/i,""));
    } catch(ex){setError(errorText(ex));throw ex;} finally {lock.current=false;setBusy(false);}
  }
  function acceptFile(file) {
    if(!file)return;
    if(!/\.pdf$/i.test(file.name)&&file.type!=="application/pdf"){setError("Selecciona un PDF de producción.");return;}
    void take({file}).catch(()=>{});
  }
  function go(next) {
    setError("");
    if(next>0&&(!source?.id||!title.trim())){setError("Selecciona un PDF y asigna un nombre al trabajo.");return;}
    if(next>1&&(!Number.isInteger(copies)||copies<1||copies>999)){setError("Introduce una cantidad entera de copias entre 1 y 999.");return;}
    if(next>2&&(!selectedPrinters.length||selectedPrinters.some(p=>!compatible(p)))){setError("Selecciona impresoras disponibles y compatibles con tu configuración.");return;}
    setStep(next);
  }
  function togglePrinter(id) {
    setPrinters(current=>mode==="single"?[id]:current.includes(id)?current.filter(value=>value!==id):[...current,id]);
  }
  async function save(isDraft) {
    if(lock.current)return;
    if(!source?.id||!title.trim()){setError("Selecciona un documento y escribe el nombre del trabajo.");return;}
    const payload={sourceId:source.id,title:title.trim(),type,config:{...config,copies,finishing:Array.isArray(config.finishing)?config.finishing:(config.finishing?.trim()?[config.finishing.trim()]:[])},mode,printerIds,draft:isDraft,...(!personal&&productId?{productId}:{})};
    if(draft.id)payload.jobId=draft.id;
    if(manual && ["pages","copies"].includes(mode)){
      payload.parts=printerIds.map(printerId=>({printerId,from:mode==="pages"?Number(ranges[printerId]?.from):1,to:mode==="pages"?Number(ranges[printerId]?.to):pages,copies:mode==="copies"?Number(ranges[printerId]?.copies):copies}));
    }
    const key=JSON.stringify(payload);
    if(operation.current?.key!==key)operation.current={key,id:crypto.randomUUID()};
    lock.current=true;setBusy(true);setError("");
    try {const result=await saveJob({...payload,requestId:operation.current.id});onSaved(result);} catch(ex){setError(errorText(ex));} finally {lock.current=false;setBusy(false);}
  }
  return <section className="pp-wizard">
    <header className="pp-header"><div><button className="pp-back" disabled={busy} onClick={onClose}>‹ Gestor de impresiones</button><h2>{draft.id?"Editar borrador":"Nueva impresión"}</h2><p>Prepara el documento y revisa el tiraje antes de enviarlo.</p></div><span className="pp-hero-icon"><Icon name="printer" size={40}/></span></header>
    <nav aria-label="Etapas de nueva impresión" className="pp-steps">{steps.map((name,i)=><button key={name} disabled={busy||i>step} aria-current={i===step?"step":undefined} onClick={()=>go(i)}><b>{i+1}</b><span>{name}</span></button>)}</nav>
    <div className="pp-compose">
      <div className="pp-card pp-compose-main">
        {step===0 && <><h3>Tipo de impresión</h3><div className="pp-types">{Object.entries(TYPES).map(([id,label])=><button type="button" key={id} aria-pressed={id===type} disabled={busy} onClick={()=>pickType(id)}><Icon name={typeIcons[id]||"file"}/>{label}</button>)}</div>
          <div className="pp-divider"><h3>Documento de producción</h3>{!personal&&<button className="pp-btn" disabled={busy} onClick={()=>setCloud(true)}><Icon name="cloud"/> Nube AS</button>}</div>
          {personal && !source ? <div className="pp-callout"><Icon name="file"/><div><strong>Selecciona un documento ya emitido</strong><p>Abre su registro para usar el PDF con su folio y QR originales.</p><button className="pp-btn" onClick={()=>onNavigate(type==="credential"?"credentials":"requests")}>{type==="credential"?"Abrir credenciales":"Abrir Solicitudes"}</button></div></div> :
            !personal&&<button type="button" className={"pp-drop"+(drag?" is-drag":"")} disabled={busy} onClick={()=>fileInput.current?.click()} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);acceptFile(e.dataTransfer.files?.[0]);}}><Icon name="cloud" size={32}/><strong>{source?"Cambiar archivo PDF":"Arrastra tu PDF o selecciona un archivo"}</strong><small>Se conserva una versión fija para este trabajo.</small></button>}
          <input hidden type="file" ref={fileInput} accept="application/pdf,.pdf" onChange={e=>{acceptFile(e.target.files?.[0]);e.target.value="";}}/>
          {source && <div className="pp-filechip"><Icon name="file"/><div><strong>{sourceName(source)}</strong><small>{count(pages)} páginas · {humanSize(source.size)}</small></div><button className="pp-btn" onClick={()=>setPreview(true)}>Ver documento</button></div>}
          <label className="pp-field">Nombre del trabajo<input value={title} maxLength={120} onChange={e=>setTitle(e.target.value)} placeholder="Nombre que verá el operador"/></label></>}
        {step===1 && <><h3>Configuración de impresión</h3><div className="pp-fields">
          <label>Copias<input type="number" min="1" max="999" step="1" value={config.copies} onChange={e=>set("copies",e.target.value)}/></label>
          <label>Tamaño de papel<select value={config.paper} onChange={e=>set("paper",e.target.value)}>{options.map(k=><option key={k} value={k}>{k==="Letter"?"Carta":k==="Legal"?"Oficio":k}</option>)}</select></label>
          <label>Color<select value={String(config.color)} onChange={e=>set("color",e.target.value==="true")}><option value="true">A color</option><option value="false">Blanco y negro</option></select></label>
          <label>Caras<select value={String(config.duplex)} onChange={e=>set("duplex",e.target.value==="true")}><option value="false">Una cara</option><option value="true">Doble cara (dúplex)</option></select></label>
          <label>Prioridad<select value={config.priority} onChange={e=>set("priority",e.target.value)}><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option></select></label>
          <label>Fecha de entrega<input type="date" value={config.dueDate||""} onChange={e=>set("dueDate",e.target.value)}/></label>
          <label>Acabado posterior<input placeholder="Ej. Encuadernado rústico" value={config.finishing||""} onChange={e=>set("finishing",e.target.value)} maxLength={80}/></label>
          {!personal&&<label>Producto de inventario<select value={productId} onChange={e=>setProductId(e.target.value)}><option value="">Entrega directa</option>{products.filter(p=>p.active!==false&&!p.deleted).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
          <label className="pp-full">Observaciones<textarea rows={3} value={config.notes||""} onChange={e=>set("notes",e.target.value)} maxLength={500}/></label></div></>}
        {step===2 && <><h3>Distribución por impresora</h3><div className="pp-types">{Object.entries(modes).map(([id,label])=><button key={id} aria-pressed={id===mode} onClick={()=>{setMode(id);setManual(false);if(id==="single")setPrinters(printerIds.slice(0,1));}}><Icon name="printer"/>{label}</button>)}</div>
          <div className="pp-divider"><h3>Equipos detectados</h3><b>{ready.length} en línea</b></div>
          {!printers.length && <div className="pp-callout"><Icon name="printer" size={32}/><div><strong>Vincula un agente para distribuir el tiraje</strong><p>Guarda este trabajo como borrador mientras se registran los equipos.</p></div></div>}
          {printers.map(p=><label key={p.id} className="pp-printer"><input type={mode==="single"?"radio":"checkbox"} disabled={!compatible(p)} checked={printerIds.includes(p.id)} onChange={()=>togglePrinter(p.id)}/><Icon name="printer"/><span><strong>{p.name||p.queue||p.id}</strong><small>{!printerReady(p)?"Sin conexión reciente":compatible(p)?"Disponible":"Configuración incompatible"}{p.paperSizes?.length?" · "+p.paperSizes.join(", "):""}</small></span></label>)}
          {["pages","copies"].includes(mode)&&selectedPrinters.length>0&&<><label className="pp-check"><input type="checkbox" checked={manual} onChange={e=>setManual(e.target.checked)}/>Asignar cantidades manualmente</label>{manual && selectedPrinters.map(p=><div key={p.id} className="pp-fields"><strong>{p.name}</strong>{(mode==="pages"?["from","to"]:["copies"]).map(field=><label key={field}>{({from:"Desde página",to:"Hasta página",copies:"Ejemplares"})[field]}<input type="number" min="1" max={mode==="pages"?pages:copies} value={ranges[p.id]?.[field]||""} onChange={e=>setRanges({...ranges,[p.id]:{...ranges[p.id],[field]:e.target.value}})}/></label>)}</div>)}</>}
        </>}
        {step===3 && <><h3>Revisar y confirmar</h3><div className="pp-callout"><Icon name="printer" size={32}/><div><strong>{title}</strong><p>Al confirmar, el trabajo entrará en la cola de los equipos seleccionados.</p></div></div>
          <dl className="pp-facts"><dt>Documento definitivo</dt><dd>{sourceName(source)}</dd><dt>Modalidad</dt><dd>{modes[mode]}</dd><dt>Equipos asignados</dt><dd>{selectedPrinters.map(p=>p.name||p.id).join(", ")}</dd><dt>Destino de producción</dt><dd>{products.find(p=>p.id===productId)?.name||"Entrega directa"}</dd>{config.finishing&&<><dt>Acabado posterior</dt><dd>{config.finishing}</dd></>}</dl></>}
      </div>
      <aside className="pp-card pp-product"><h3>Vista del producto</h3><div className="pp-document-art"><Icon name={typeIcons[type]||"file"} size={64}/><strong>{TYPES[type]}</strong></div><h4>{title||"Documento pendiente"}</h4>
        <dl className="pp-facts"><dt>Páginas del original</dt><dd>{count(pages)}</dd><dt>Copias solicitadas</dt><dd>{count(copies)}</dd><dt>Caras previstas</dt><dd>{count(pages*copies)}</dd><dt>Hojas previstas</dt><dd>{count(sheets)}</dd><dt>Impresoras</dt><dd>{printerIds.length}</dd></dl>{source&&<button className="pp-btn" onClick={()=>setPreview(true)}>Vista previa del PDF</button>}</aside>
    </div>
    {busy&&<p role="status" className="pp-loading">Procesando la operación…</p>}{error&&<p role="alert" className="pp-error">{error}</p>}
    <footer className="pp-dialog-actions"><button className="pp-btn" disabled={busy} onClick={onClose}>Cancelar</button><button className="pp-btn" disabled={busy||!source} onClick={()=>save(true)}>Guardar borrador</button><i/>{step>0&&<button className="pp-btn" disabled={busy} onClick={()=>go(step-1)}>Anterior</button>}<button className="pp-btn pp-primary" disabled={busy} onClick={()=>step===3?save(false):go(step+1)}>{step===3?"Confirmar y encolar":"Siguiente"}</button></footer>
    {cloud&&<DrivePicker onClose={()=>setCloud(false)} onChoose={driveFile=>take({driveFile})}/>}
    {preview&&source&&<PdfPreview source={source} onClose={()=>setPreview(false)}/>}
  </section>;
}
