import { useEffect, useRef, useState } from "react";
import { Empty, Icon, Metric, Modal } from "./UI.jsx";
import { formatDate } from "./labels.js";
import PrinterRouting from "./PrinterRouting";
import PrinterTelemetry from "./PrinterTelemetry";
import { configurePrinter, pairAgent, revokeAgent, saveSettings } from "./service.js";
import InventoryRules from "./InventoryRules";
import { count, errorText, millis, TYPES } from "./model.js";

export function Settings({agents=[],printers=[],settings={},isAdmin,onNavigate}) {
  const [modal,setModal]=useState(null),[name,setName]=useState(""),[code,setCode]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [form,setForm]=useState({});
  const lock=useRef(false);
  function open(kind, fields={}) {setModal(kind);setForm(fields);setName("");setCode(null);setError("");}
  async function submit(e) {
    e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError("");
    try {
      if(modal==="pair")setCode(await pairAgent(name.trim()));
      else if (modal === "editPrinter") { await configurePrinter(form); setModal(null); }
      else if(modal==="revoke"){await revokeAgent(form.id);setModal(null);}
      else {await saveSettings(modal==="defaults"?{defaults:form}:form);setModal(null);}
    }catch(ex){setError(errorText(ex));}finally{lock.current=false;setBusy(false);}
  }
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  const online = (printer) => printer.settings?.enabled !== false && printer.online && clock - millis(printer.lastSeenAt) <= 120000;
  const defaults={copies:1,paper:"A4",color:true,duplex:false,...settings.defaults};
  return <div className="pp-settings"><div className="pp-metrics"><Metric icon="printer" label="Impresoras detectadas" value={printers.length}/><Metric icon="cloud" label="Con conexión reciente" value={printers.filter(online).length}/>{isAdmin&&<Metric icon="settings" label="Agentes vinculados" value={agents.filter(a=>a.status==="active").length}/>}</div>
  <div className="pp-config-grid"><section className="pp-card"><div className="pp-divider"><h3><Icon name="printer"/> Impresoras</h3></div>{printers.length?printers.map(p=><div className="pp-printer" key={p.id}><Icon name="printer"/><span><strong>{p.settings?.name||p.name||p.queue}</strong><small>{p.settings?.enabled === false ? "Desactivada" : online(p) ? "En línea" : "Fuera de línea"} · {p.color?"Color":"Monocromática"} · {p.duplex?"Dúplex":"Una cara"}</small></span><div className="pp-row-actions">
    <button className="pp-btn" onClick={()=>open("printer",p)}>Detalles</button>
    {isAdmin && <button className="pp-btn" onClick={() => open("editPrinter", {
      printerId: p.id, name: p.settings?.name || "", makeModel: p.settings?.makeModel || "",
      location: p.settings?.location || "", pagesPerMinute: p.settings?.pagesPerMinute ?? null,
      enabled: p.settings?.enabled !== false,
    })}>Editar impresora</button>}
  </div></div>):<Empty icon="printer" title="Aún no hay impresoras registradas">Vincula AS Print Agent en la computadora que administra las colas de impresión.</Empty>}</section>
  {isAdmin&&<section className="pp-card"><div className="pp-divider"><h3><Icon name="cloud"/> Agentes de impresión</h3><button className="pp-btn pp-primary" onClick={()=>open("pair")}>Vincular agente</button></div><p>Instala el agente en el equipo que comparte las impresoras e introduce el código temporal.</p>
  {agents.map(a=><div key={a.id} className="pp-printer"><Icon name="cloud"/><span><strong>{a.name||a.id}</strong><small>{{pending:"Pendiente de vinculación",active:"Vinculado",revoked:"Acceso revocado"}[a.status]||a.status} · {a.lastSeenAt?formatDate(a.lastSeenAt):"Sin conexión registrada"}{a.version && ` · v${a.version}`}</small></span>{a.status!=="revoked"&&<button className="pp-btn" onClick={()=>open("revoke",a)}>Revocar</button>}</div>)}
  <button className="pp-btn" onClick={()=>open("instructions")}>Instalación y diagnóstico</button>{" "}<a className="pp-btn" href="https://github.com/gonhercaral-cpu/desarrollo-proyectos/releases/tag/as-print-agent-v1.1.0" target="_blank" rel="noreferrer">Descargar agente</a></section>}
  <section className="pp-card"><div className="pp-divider"><h3><Icon name="settings"/> Valores predeterminados</h3>{isAdmin&&<button className="pp-btn" onClick={()=>open("defaults",defaults)}>Editar</button>}</div><dl className="pp-facts"><dt>Copias</dt><dd>{defaults.copies}</dd><dt>Papel</dt><dd>{defaults.paper}</dd><dt>Color</dt><dd>{defaults.color?"A color":"Blanco y negro"}</dd><dt>Impresión</dt><dd>{defaults.duplex?"Doble cara":"Una cara"}</dd></dl></section>
  <section className="pp-card"><div className="pp-divider"><h3><Icon name="file"/> Documentos personalizados</h3>{isAdmin&&<button className="pp-btn" onClick={()=>open("flags",{certificateEnabled:settings.certificateEnabled===true,credentialEnabled:settings.credentialEnabled===true})}>Configurar</button>}</div><p>La emisión y la asignación de folios se realizan en sus módulos de origen.</p><dl className="pp-facts"><dt>Certificados en el gestor</dt><dd>{settings.certificateEnabled?"Habilitados":"Pendientes de activación"}</dd><dt>Credenciales en el gestor</dt><dd>{settings.credentialEnabled?"Habilitadas":"Pendientes de activación"}</dd></dl></section>
  <section className="pp-card"><h3>Inventario e insumos</h3><p>Consulta los productos registrados y sus movimientos de existencias.</p><button className="pp-btn" onClick={()=>onNavigate("inventory")}>Inventario terminado</button> <button className="pp-btn" onClick={()=>onNavigate("supplies")}>Insumos</button></section></div>
  <PrinterRouting settings={settings} printers={printers} isAdmin={isAdmin} />
  {modal&&<Modal title={({pair:"Vincular agente",revoke:"Revocar acceso del agente",defaults:"Valores para nuevos trabajos",flags:"Activación progresiva",printer:"Diagnóstico de impresora",editPrinter:"Editar impresora",instructions:"Instalación del agente"})[modal]} onClose={busy?undefined:()=>setModal(null)}>
    {modal === "printer" ? <PrinterTelemetry printer={printers.find((printer) => printer.id === form.id) || form} clock={clock} />:
    modal === "editPrinter" ? <form onSubmit={submit}>
      <div className="pp-fields">
        {Object.entries({ name: "Nombre operativo", location: "Ubicación", makeModel: "Fabricante y modelo" }).map(([key, label]) => (
          <label key={key}>{label}<input value={form[key]} maxLength={100} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>
        ))}
        <label>Velocidad estimada (páginas/min)<input type="number" value={form.pagesPerMinute ?? ""} min="1" max="2000"
          onChange={(e) => setForm({ ...form, pagesPerMinute: e.target.value ? Number(e.target.value) : null })} /></label>
        <label className="pp-check"><input type="checkbox" checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />Aceptar nuevas asignaciones</label>
      </div>
      {error && <p className="pp-error" role="alert">{error}</p>}
      <footer className="pp-dialog-actions"><button type="button" className="pp-btn" disabled={busy} onClick={() => setModal(null)}>Cancelar</button>
        <button className="pp-btn pp-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar impresora"}</button></footer>
    </form>:modal==="instructions"?<div className="pp-stack"><p>Instala AS Print Agent en un equipo con CUPS. Primero confirma que la impresora aparece en el sistema operativo.</p><ol><li>Obtén el instalador del agente desde el release de Imprenta.</li><li>En este panel, elige Vincular agente y genera un código para esa computadora.</li><li>Introduce el código en el agente y consulta sus impresoras detectadas aquí.</li></ol></div>:code?<div className="pp-callout"><Icon name="cloud"/><div><strong>Código de un solo uso</strong><code className="pp-code">{code.code}</code><small>Es válido hasta {formatDate(code.expiresAt)}.</small></div></div>:
    <form onSubmit={submit}>{modal==="pair"?<label className="pp-field">Nombre de la computadora<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="Ej. Taller de producción"/></label>:modal==="revoke"?<p>El agente <strong>{form.name||form.id}</strong> perderá el acceso a nuevos trabajos y documentos.</p>:modal==="flags"?<div className="pp-stack"><p>Activa cada flujo después de verificar la comunicación con los equipos.</p>{Object.entries({certificateEnabled:"Permitir certificados emitidos",credentialEnabled:"Permitir credenciales emitidas"}).map(([key,label])=><label className="pp-check" key={key}><input type="checkbox" checked={form[key]} onChange={e=>setForm({...form,[key]:e.target.checked})}/>{label}</label>)}</div>:<div className="pp-fields"><label>Copias<input type="number" min="1" required value={form.copies} onChange={e=>setForm({...form,copies:Number(e.target.value)})}/></label><label>Tamaño de papel<select value={form.paper} onChange={e=>setForm({...form,paper:e.target.value})}>{["A4","Letter","Legal","A3"].map(k=><option key={k}>{k}</option>)}</select></label>{Object.entries({color:"A color",duplex:"Doble cara"}).map(([k,s])=><label className="pp-check" key={k}><input type="checkbox" checked={form[k]} onChange={e=>setForm({...form,[k]:e.target.checked})}/>{s}</label>)}</div>}
    {error&&<p role="alert" className="pp-error">{error}</p>}<footer className="pp-dialog-actions"><button className="pp-btn" type="button" disabled={busy} onClick={()=>setModal(null)}>Cancelar</button><button className="pp-btn pp-primary" disabled={busy}>{busy?"Guardando…":modal==="pair"?"Generar código":modal==="revoke"?"Revocar acceso":"Guardar configuración"}</button></footer></form>}
  </Modal>}</div>;
}

export function Inventory({jobs=[], products=[],onAction, onNavigate, isAdmin, settings = {}}) {
  const [filter,setFilter]=useState(""),[pending,setPending]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const rows=jobs.filter(j=>j.productId&&!["certificate","credential"].includes(j.type)&&!["draft","cancelled"].includes(j.status));
  const eligible=j=>Math.max(0,(j.accepted||0)-(j.inventoried||0)-(j.delivered||0));
  const confirmed=rows.reduce((a,j)=>a+(j.inventoried||0),0);
  async function sync() {
    if(busy)return;setBusy(true);setError("");
    try{await onAction(pending,"inventory",{delivery:"inventory"});setPending(null);}catch(ex){setError(errorText(ex));}finally{setBusy(false);}
  }
  return <><div className="pp-metrics"><Metric icon="box" label="Unidades aprobadas pendientes" value={count(rows.reduce((a,j)=>a+eligible(j),0))}/><Metric icon="layers" label="Unidades ingresadas" value={count(confirmed)}/><Metric icon="check" label="Trabajos vinculados recientes" value={count(rows.length)}/></div>
    <div className="pp-card pp-flow">{["Trabajo impreso","Calidad validada","Entrada a inventario"].map((s,i)=><div key={s}><Icon name={["printer","check","box"][i]} size={34}/><strong>{s}</strong></div>)}</div>
    <section className="pp-card"><div className="pp-divider"><h3>Productos listos para integración</h3><button className="pp-btn" onClick={()=>onNavigate("inventory")}>Abrir inventario</button></div><input type="search" className="pp-wide-input" aria-label="Buscar por producto o trabajo" placeholder="Buscar producto o trabajo…" value={filter} onChange={e=>setFilter(e.target.value)}/>
      {rows.filter(j=>(j.title+" "+(products.find(p=>p.id===j.productId)?.name||"")).toLowerCase().includes(filter.toLowerCase())).map(j=><div key={j.id} className="pp-printer"><Icon name="box"/><span><strong>{j.title}</strong><small>{products.find(p=>p.id===j.productId)?.name||TYPES[j.type]} · {count(j.accepted)} aprobadas · {count(j.inventoried)} ingresadas</small></span>{eligible(j)>0&&isAdmin&&<button className="pp-btn" onClick={()=>{setError("");setPending(j);}}>Registrar entrada</button>}</div>)}
      {!rows.length&&<Empty icon="box" title="Aún no hay producción vinculada">Los trabajos con un producto asignado aparecerán aquí al entrar en producción.</Empty>}</section>
    <InventoryRules settings={settings} products={products} isAdmin={isAdmin} />
    {pending&&<Modal title="Registrar producción aprobada" onClose={busy?undefined:()=>setPending(null)}><h3>{pending.title}</h3><p>Se registrarán las <strong>{count(eligible(pending))} unidades aprobadas pendientes</strong> en el inventario del producto vinculado.</p>{error&&<p className="pp-error" role="alert">{error}</p>}<footer className="pp-dialog-actions"><button className="pp-btn" disabled={busy} onClick={()=>setPending(null)}>Cancelar</button><button className="pp-btn pp-primary" disabled={busy} onClick={sync}>Registrar entrada</button></footer></Modal>}</>;
}
