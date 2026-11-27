import { useRef, useState } from "react";
import { Button, Modal, Status } from "./UI.jsx";
import { count, errorText, mayOperate } from "./model.js";

const LABELS = {
  pause: "Pausar", resume: "Reanudar", cancel: "Cancelar trabajo", priority: "Cambiar prioridad", note: "Añadir nota",
  reprint: "Reimprimir", reconcile: "Conciliar tramo", quality: "Validar producción", inventory: "Registrar entrada", consume: "Registrar consumo",
};
const inFlight = ["printing","submitted","confirmation","claimed","sending"];
const roleFor = {pause:"manage",resume:"manage",cancel:"manage",priority:"manage",note:"manage",reprint:"reprint",reconcile:"reconcile",quality:"quality",inventory:"inventory",consume:"supplies"};


export default function JobActions({job,onAction,printers,supplyItems=[],isAdmin,settings,user,onRecorded}) {
  const [action,setAction]=useState(""),[form,setForm]=useState({}),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const lock=useRef(false);
  const parts=job.parts||[];
  const outstanding=Math.max(0,(job.accepted||0)-(job.inventoried||0));
  const available={
    pause:job.status==="queued", resume:job.status==="paused", cancel:["draft","queued","paused"].includes(job.status),
    priority:!["cancelled","completed"].includes(job.status), note:true,
    reprint:["confirmation","quality","partial","completed","cancelled"].includes(job.status),
    quality:["confirmation","quality","partial"].includes(job.status)&&parts.length>0&&parts.every(p=>!p.pendingRemainder&&["completed","cancelled"].includes(p.status)),
    inventory:job.productId&&outstanding>0&&!["credential","certificate"].includes(job.type),
    consume:!["draft","cancelled"].includes(job.status)&&supplyItems.length>0,
    reconcile:parts.some(p=>inFlight.includes(p.status)||["queued","paused"].includes(p.status)||p.pendingRemainder),
  };
  const candidates=parts.filter(p=>inFlight.includes(p.status)||["queued","paused"].includes(p.status)||p.pendingRemainder);
  const part=candidates.find(p=>p.id===form.partId);
  const outcomes=part&&inFlight.includes(part.status)?{printed:"Impresión físicamente confirmada",not_printed:"Tramo completo sin imprimir",partial:"Salida parcial comprobada",unknown:"Resultado desconocido"}:{reassign:"Reasignar tramo pendiente"};
  const outcome=form.outcome||Object.keys(outcomes)[0];
  const set=(key,value)=>setForm(old=>({...old,[key]:value}));
  function start(id) {setAction(id);setError("");setForm({priority:job.priority||"normal",copies:job.config?.copies||1,accepted:0,rejected:0,quantity:id==="inventory"?outstanding:1,partId:candidates[0]?.id||"",notes:"",confirm:false});}
  async function submit(e) {
    e.preventDefault();if(lock.current)return;
    let data={};
    if(action==="note")data={note:form.notes.trim()};
    if(["pause","resume","cancel"].includes(action))data={reason:form.notes.trim()};
    if(action==="priority")data={priority:form.priority};
    if(action==="quality")data={accepted:Number(form.accepted),rejected:Number(form.rejected),notes:form.notes.trim()};
    if(action==="inventory")data={quantity:Number(form.quantity),delivery:"inventory"};
    if(action==="consume")data={supplies:[{supplyId:form.supplyId,quantity:Number(form.quantity)}],notes:form.notes.trim()};
    if(action==="reprint")data={reason:form.notes.trim(),copies:Number(form.copies)};
    if(action==="reconcile")data={partId:form.partId,outcome,confirm:form.confirm,note:form.notes.trim(),...(outcome==="partial"?{[form.measure||"printedCopies"]:Number(form.confirmedAmount)}:{}),...(form.printerId&&["not_printed","reassign","partial"].includes(outcome)?{reassignPrinterId:form.printerId}:{})};
    lock.current=true;setBusy(true);setError("");
    try{await onAction(job,action,data);setAction("");onRecorded();}catch(ex){setError(errorText(ex));}finally{lock.current=false;setBusy(false);}
  }
  return <div className="pp-actions-toolbar">{Object.entries(LABELS).filter(([id])=>available[id]&&mayOperate(isAdmin,settings,user,roleFor[id])).map(([id,label])=><Button key={id} size="sm" variant={id==="cancel"?"danger":"secondary"} onClick={()=>start(id)}>{label}</Button>)}
    {action&&<Modal title={LABELS[action]} onClose={busy?undefined:()=>setAction("")}><form onSubmit={submit}>
      <div className="pp-callout"><span><strong>{job.title}</strong><small> · {count(job.config?.copies)} copias</small></span><Status value={job.status}/></div><div className="pp-fields">
        {action==="priority"&&<label>Prioridad<select value={form.priority} onChange={e=>set("priority",e.target.value)}>{Object.entries({low:"Baja",normal:"Normal",high:"Alta",urgent:"Urgente"}).map(([id,s])=><option key={id} value={id}>{s}</option>)}</select></label>}
        {action==="quality"&&<><label>Nuevas unidades aprobadas<input type="number" min="0" max={(job.config?.copies||0)-(job.accepted||0)} required value={form.accepted} onChange={e=>set("accepted",e.target.value)}/></label><label>Nuevas unidades rechazadas<input type="number" min="0" required value={form.rejected} onChange={e=>set("rejected",e.target.value)}/></label></>}
        {action==="reprint"&&<label>Copias de reimpresión<input type="number" min="1" max="999" required value={form.copies} onChange={e=>set("copies",e.target.value)}/></label>}
        {action==="consume"&&<label>Insumo<select required value={form.supplyId||""} onChange={e=>set("supplyId",e.target.value)}><option value="">Seleccionar…</option>{supplyItems.filter(i=>i.active!==false&&!i.deleted).map(i=><option key={i.id} value={i.id}>{i.name} · {i.unit||i.baseUnit||"unidades"}</option>)}</select></label>}
        {["inventory","consume"].includes(action)&&<label>Cantidad {action==="inventory"?"aprobada":"consumida"}<input type="number" required min={action==="inventory"?1:"0.001"} max={action==="inventory"?outstanding:undefined} step={action==="consume"?"any":"1"} value={form.quantity} onChange={e=>set("quantity",e.target.value)}/></label>}
        {action==="reconcile"&&<><label>Tramo<select required value={form.partId} onChange={e=>setForm({...form,partId:e.target.value,outcome:"",printerId:"",confirm:false})}>{candidates.map(p=><option key={p.id} value={p.id}>{p.printerName||p.printerId} · {p.from}–{p.to} · {p.copies} copias</option>)}</select></label><label>Resultado comprobado<select required value={outcome} onChange={e=>set("outcome",e.target.value)}>{Object.entries(outcomes).map(([id,s])=><option key={id} value={id}>{s}</option>)}</select></label>
        {outcome==="partial"&&<><label>Conteo observado<select value={form.measure||"printedCopies"} onChange={e=>set("measure",e.target.value)}><option value="printedCopies">Copias completas del tramo</option><option value="printedThrough">Hasta página en todas las copias</option></select></label><label>Cantidad o última página<input type="number" required min={form.measure==="printedThrough"?part.from:1} max={form.measure==="printedThrough"?part.to-1:part.copies-1} value={form.confirmedAmount||""} onChange={e=>set("confirmedAmount",e.target.value)}/></label></>}
        {["reassign","not_printed","partial"].includes(outcome)&&<label>Impresora destino<select value={form.printerId||""} required={outcome==="reassign"} onChange={e=>set("printerId",e.target.value)}><option value="">{outcome==="reassign"?"Seleccionar…":"Conservar pendiente"}</option>{printers.filter(p=>p.online).map(p=><option key={p.id} value={p.id}>{p.name||p.queue}</option>)}</select></label>}</>}
        {!["priority","inventory"].includes(action)&&<label className="pp-full">{action==="note"?"Nota del operador":"Motivo u observaciones"}<textarea required={["note","reprint","cancel"].includes(action)||Number(form.rejected)>0} minLength={action==="reprint"?3:undefined} maxLength={action==="note"?1000:300} value={form.notes} onChange={e=>set("notes",e.target.value)} rows={3}/></label>}
      </div>{["cancel","inventory","quality","consume","reconcile"].includes(action)&&<label className="pp-check"><input required type="checkbox" checked={form.confirm} onChange={e=>set("confirm",e.target.checked)}/>{action==="reconcile"?"He comprobado el resultado físico del tramo.":"Confirmo la operación y las cantidades indicadas."}</label>}
      {error&&<p role="alert" className="pp-error">{error}</p>}<footer className="pp-dialog-actions"><Button disabled={busy} onClick={()=>setAction("")}>Volver</Button><Button type="submit" variant="primary" disabled={busy}>{busy?"Registrando…":"Confirmar"}</Button></footer></form></Modal>}
  </div>;
}
