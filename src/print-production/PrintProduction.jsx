import { lazy, Suspense, useRef, useState } from "react";
import { Icon, Metric } from "./UI.jsx";
import { jobAction } from "./service.js";
import Queue from "./Queue.jsx";
import { count, millis } from "./model.js";
import "./Workspace.css";

const Wizard=lazy(()=>import("./Wizard.jsx"));
const PdfPreview=lazy(()=>import("./Wizard.jsx").then(module=>({default:module.PdfPreview})));
const History=lazy(()=>import("./History.jsx"));
const Analytics=lazy(()=>import("./Analytics.jsx"));
const Archive=lazy(()=>import("./ProductionReportArchive"));
const Library=lazy(()=>import("./Library.jsx"));
const Settings=lazy(()=>import("./Operations.jsx").then(module=>({default:module.Settings})));
const Inventory=lazy(()=>import("./Operations.jsx").then(module=>({default:module.Inventory})));
const views={
  queue:["Gestor de impresiones","Trabajos","printer","Administra la cola y da seguimiento a la producción de materiales."],
  history:["Historial de impresiones","Historial","history","Consulta los trabajos anteriores y su producción registrada."],
  stats:["Estadísticas de producción","Estadísticas","chart","Consulta los indicadores de producción por periodo y equipo."],
  reports:["Centro de reportes","Reportes","file","Consulta, genera y exporta informes de Imprenta."],
  inventory:["Integración con inventario","Inventario","box","Registra las unidades aprobadas en el inventario de productos terminados."],
  catalog:["Catálogo de materiales","Materiales","layers","Administra los documentos y productos reutilizables de Imprenta."],
  templates:["Biblioteca de plantillas","Plantillas","book","Consulta y utiliza las plantillas institucionales de producción."],
  settings:["Configuración de Imprenta","Configuración","settings","Administra equipos, agentes y valores predeterminados de producción."],
};

export default function PrintProduction(props) {
  const {jobs=[],printers=[],products=[],settings={},initialSource,onNavigate,isAdmin,reportAllowed}=props;
  const [view,setView]=useState("queue"),[wizard,setWizard]=useState(initialSource?.source ? initialSource : null);
  const [selection,setSelection]=useState(""),[older,setOlder]=useState(null);
  const [preview,setPreview]=useState(null),[message,setMessage]=useState(""),[error,setError]=useState("");
  const ops=useRef(new Map());
  const details = views[view];
  const recent=jobs.filter(j=>millis(j.createdAt)>=new Date(new Date().getFullYear(),new Date().getMonth(),1).getTime());
  const accepted=recent.reduce((n,j)=>n+(Number(j.accepted)||0),0);
  function openJob(job) {
    if(!job?.id)return;
    setOlder(job);setSelection(job.id);setView("queue");
  }
  function start(initial={}) {setMessage("");setError("");setWizard(initial);}
  async function act(job,action,payload={}) {
    const signature=JSON.stringify([job.id,action,payload]);
    let op=ops.current.get(signature);
    if(!op){op={id:crypto.randomUUID()};ops.current.set(signature,op);}
    if(op.promise)return op.promise;
    const run=jobAction({...payload,action,jobId:job.id,requestId:op.id}).then(result=>{
      ops.current.delete(signature);setError("");
      if(action==="reprint") {
        const newId=result?.jobId||result?.id;
        if(newId){setOlder(null);setSelection(newId);setView("queue");}
        setMessage("Se creó un borrador de reimpresión vinculado al trabajo original.");
      }else setMessage("Operación registrada.");
      return result;
    }).catch(ex=>{op.promise=null;throw ex;});
    op.promise=run;return run;
  }
  function saved(result) {
    setWizard(null);setView("queue");setOlder(null);setSelection(result?.jobId||result?.id||"");setMessage("Trabajo guardado.");
  }
  const visibleJobs=older&&!jobs.some(j=>j.id===older.id)?[older,...jobs]:jobs;
  return <section className="pp-shell" aria-label="Gestor de producción de Imprenta">
    <Suspense fallback={<p className="pp-loading" role="status">Cargando la vista…</p>}>
      {wizard?<Wizard initial={wizard} openCloud={wizard.openCloud} settings={settings} printers={printers} products={products} onNavigate={onNavigate} onClose={()=>setWizard(null)} onSaved={saved}/>:
      <><header className="pp-header"><div><h2>{details[0]}</h2><p>{details[3]}</p></div><div className="pp-header-actions"><button className="pp-btn" onClick={()=>start({openCloud:true})}><Icon name="cloud"/>Importar desde Nube AS</button><button className="pp-btn pp-primary" onClick={()=>start()}><Icon name="plus"/>Nueva impresión</button></div></header>
      <nav className="pp-view-tabs" aria-label="Secciones de producción">{Object.entries(views).filter(([key])=>key!=="reports"||reportAllowed!==false).map(([id,[,label,icon]])=><button key={id} aria-current={id===view?"page":undefined} onClick={()=>{setView(id);setMessage("");setError("");}}><Icon name={icon} size={17}/>{label}</button>)}</nav>
      {message&&<p className="pp-notice" role="status">{message}<button type="button" aria-label="Cerrar aviso" onClick={()=>setMessage("")}>×</button></p>}
      {error&&<p className="pp-error" role="alert">{error}</p>}
      {view==="queue"&&<><div className="pp-metrics"><Metric label="Trabajos recientes del mes" value={count(recent.length)} icon="layers"/><Metric label="Unidades aprobadas" value={count(accepted)} icon="check" tone="emerald"/><Metric label="Libros terminados" value={count(recent.filter(j=>j.type==="book").reduce((n,j)=>n+(j.accepted||0),0))} icon="book"/><Metric label="Credenciales aceptadas" value={count(recent.filter(j=>j.type==="credential").reduce((n,j)=>n+(j.accepted||0),0))} icon="credential" tone="violet"/><Metric label="Certificados aceptados" value={count(recent.filter(j=>j.type==="certificate").reduce((n,j)=>n+(j.accepted||0),0))} icon="certificate" tone="amber"/></div>
        <Queue jobs={visibleJobs} printers={printers} isAdmin={isAdmin} selectedId={selection} onSelect={val=>setSelection(typeof val==="string"?val:val?.id)} onAction={act} onDocument={setPreview} settings={settings} user={props.user} supplyItems={props.supplyItems} onNavigate={(target,job)=>target==="new"?start():onNavigate(target,job?.source?.requestId||job?.requestId)} onEdit={job=>start({job})}/></>}
      {view==="history"&&<History printers={printers} onOpen={openJob} onReprint={(job,reason)=>act(job,"reprint",{reason})}/>}
      {(view==="stats"||view==="reports")&&<Analytics view={view} printers={printers} generatedCertificates={props.generatedCertificates||[]} canViewCosts={isAdmin}/>}
      {view==="reports"&&<Archive {...props}/>}
      {view==="inventory"&&<Inventory {...props} onAction={act}/>}
      {(view==="catalog"||view==="templates")&&<Library {...props} key={view} view={view} onStart={start} onPreview={setPreview}/>}
      {view==="settings"&&<Settings {...props}/>}</>}
      {preview&&<PdfPreview source={preview} onClose={()=>setPreview(null)}/>}
    </Suspense>
  </section>;
}
