import "../src/design-system.css";
import "../src/styles.css";
import "../src/player/player.css";
import "../src/browser/browser.css";
import { playerMarkup } from "../src/ui/player-view.ts";
import { sidebarMarkup } from "../src/ui/shell.ts";
import { TeacherWorkspace } from "../src/ui/TeacherWorkspace.ts";
import { BrowserTool } from "../src/browser/BrowserTool.ts";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
async function run() {
 const root = document.querySelector("#app");
 root.innerHTML = `<div class="desktop-shell is-classroom">${sidebarMarkup({levels:["level-1"], selectedLevel:"level-1", inClass:true, deviceName:"Equipo de prueba", state:"Sincronizado"})}<div class="classroom-workspace">${playerMarkup()}</div></div>`;
 root.querySelector("[data-unit]").textContent="Unidad 1 · Clase de prueba";
 root.querySelector("[data-version]").textContent="Contenido local verificado";
 const workspace = new TeacherWorkspace(root);
 const trigger = root.querySelector("[data-browser-open]");
 const clock = root.querySelector("[data-teacher-clock]");
 const font = parseFloat(getComputedStyle(clock).fontSize), rect = clock.getBoundingClientRect();
 assert(font >= 28, `Reloj demasiado pequeño: ${font}`);
 const actions = [...root.querySelectorAll(".player-header-actions > *")].map(e=>e.getBoundingClientRect());
 for(let i=0;i<actions.length;i++) for(let j=i+1;j<actions.length;j++) {
  const a=actions[i], b=actions[j]; assert(a.right<=b.left+.5 || b.right<=a.left+.5 || a.bottom<=b.top+.5 || b.bottom<=a.top+.5,"Cabecera superpuesta");
 }
 assert(rect.right<=innerWidth && rect.left>=0,"Reloj fuera de pantalla");
 assert(document.documentElement.scrollWidth<=innerWidth+1,"Desbordamiento horizontal");
 const result={viewport:[innerWidth,innerHeight],clockPx:font,mode:new URLSearchParams(location.search).get("mode")||"class"};
 if(result.mode==="browser") {
  const state={open:false,url:"",title:"",loading:false,presenting:false}, calls={layout:0,status:0};
  const bridge={};
  for(const name of ["open","navigate","back","forward","reload","layout","present","returnToHost","status","close"]) bridge[name]=async(...args)=> {
   if(name==="open") Object.assign(state,{open:true,url:args[0],title:"Página de prueba"});
   if(name==="status") calls.status++;
   if(name==="layout") calls.layout++;
   if(name==="close") state.open=false;
   return {...state};
  };
  const tool=new BrowserTool({root,trigger,available:true,bridge,monitors:async()=>[{id:"main",name:"Profesor",primary:true,width:innerWidth,height:innerHeight,x:0,y:0,scaleFactor:1},{id:"screen",name:"Salón",primary:false,width:1920,height:1080,x:innerWidth,y:0,scaleFactor:1}]});
  await tool.open(); root.querySelector("[data-browser-url]").value="https://example.org";
  root.querySelector("[data-browser-form]").dispatchEvent(new Event("submit",{cancelable:true}));
  await delay(2200);
  const host=root.querySelector("[data-browser-host]").getBoundingClientRect(), toolbar=root.querySelector(".browser-toolbar").getBoundingClientRect();
  assert(host.top>=toolbar.bottom,"Vista web cubre controles");
  assert(host.width>100 && host.height>100 && host.bottom<=innerHeight+1 && host.right<=innerWidth+1,"Área web fuera de ventana");
  assert(calls.layout<=6,`Bucle de redimensionado: ${calls.layout}`);
  assert(calls.status>=1 && calls.status<=4,`Sondeo inesperado: ${calls.status}`);
  result.calls=calls; result.bounds={x:host.x,y:host.y,width:host.width,height:host.height};
  // Keep the overlay visible for the screenshot, then the process exits.
 } else workspace.destroy();
 return result;
}
run().then(result=>{document.querySelector("#layout-result").textContent=JSON.stringify({ok:true,...result});}).catch(error=>{document.querySelector("#layout-result").textContent=JSON.stringify({ok:false,message:String(error)});});
