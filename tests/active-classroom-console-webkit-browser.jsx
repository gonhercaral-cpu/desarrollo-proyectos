import React from "react";
import { createRoot } from "react-dom/client";
import ActiveClassroomModule from "../src/active-classroom/ActiveClassroomModule";
import "../src/styles/app.css";
const root = createRoot(document.querySelector("#app"));
root.render(<ActiveClassroomModule profile={{ uid: "admin", role: "admin", active: true }} />);
const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error("La UI no quedó lista"); };
const observations = [];
async function run() {
  await wait(() => document.querySelector(".ac-console-unit"));
  for (const section of ["Biblioteca", "Niveles", "Publicaciones", "Equipos", "Ajustes"]) {
    const button = [...document.querySelectorAll(".ac-navigation button")].find(item => item.textContent === section); button.click();
    await new Promise(resolve => setTimeout(resolve, 150));
    if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error(`Overflow global: ${section}`);
    const header = document.querySelector(".printshop-topbar.digital-signage-header");
    if (!header || !header.querySelector('img[src="/active-classroom-icon.png"]')) throw new Error(`Header/icono institucional faltante: ${section}`);
    const heading = header.getBoundingClientRect();
    if (heading.right > innerWidth || heading.left < 248) throw new Error(`Header fuera de su área: ${section} ${JSON.stringify(heading.toJSON())}`);
    const inspector = document.querySelector(".ac-console-inspector");
    if (inspector) { inspector.scrollTop = inspector.scrollHeight; const last = inspector.querySelector(".ac-inspector-body")?.lastElementChild; if (last && last.getBoundingClientRect().bottom > inspector.getBoundingClientRect().bottom + 1) throw new Error(`Inspector inaccesible: ${section}`); }
    if (section === "Ajustes") { const table = document.querySelector(".ac-permissions-table"); if (!table || table.querySelectorAll("input[role=switch]").length !== 20) throw new Error("Permisos reales faltantes"); const scroll = table.parentElement; scroll.scrollLeft = scroll.scrollWidth; const last = table.querySelector("tr:last-child td:last-child"); if (last.getBoundingClientRect().right > scroll.getBoundingClientRect().right + 1) throw new Error("Último permiso inaccesible"); }
    observations.push({ section, viewport: [innerWidth, innerHeight], noGlobalOverflow: true, inspectorAccessible: true });
  }
  [...document.querySelectorAll(".ac-navigation button")].find(item => item.textContent === "Biblioteca").click();
  await wait(() => document.querySelector(".ac-console-unit"));
  const card = document.querySelector(".ac-console-unit");
  card.querySelector(".ac-card-menu summary").click();
  if (document.querySelector(".ac-unit-editor")) throw new Error("Menú abrió Unit por propagación");
  card.querySelector(".ac-card-select").click();
  await wait(() => document.querySelector(".ac-unit-editor"));
  if (!document.querySelector(".ac-unit-editor h1").textContent.includes("Unit")) throw new Error("Clic principal no abrió Unit");
  if (!document.querySelector(".ac-unit-editor").textContent.includes("Música ambiente")) throw new Error("Editor de música faltante");
  observations.push({ singleClickOpens: true, menuDoesNotOpen: true, musicEditor: true });
  return { ok: true, observations };
}
void run().catch(error => ({ ok: false, message: String(error), observations })).then(result => { if (window.webkit?.messageHandlers?.result) window.webkit.messageHandlers.result.postMessage(JSON.stringify(result)); else { window.consoleAcceptance = result; const report = document.createElement("pre"); report.textContent = JSON.stringify(result); document.body.append(report); } });
