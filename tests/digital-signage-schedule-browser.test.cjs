// Chrome real + Firebase emulado. Nunca usa datos o endpoints de producción.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, writeFile, rm, symlink, mkdir } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const functionsRequire = createRequire(require.resolve("../functions/package.json"));
const playwrightPath = process.env.PLAYWRIGHT_MODULE_PATH;

test("Matriz: editor, publicación, vistas por ventana y regreso a playlist en Chrome", {
  skip: !playwrightPath || !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST,
  timeout: 180000,
}, async (t) => {
  const projectId = "security-rules-audit";
  const { initializeApp, deleteApp } = functionsRequire("firebase-admin/app");
  const { getFirestore } = functionsRequire("firebase-admin/firestore");
  const { getAuth } = functionsRequire("firebase-admin/auth");
  const { chromium } = require(playwrightPath);
  const root = path.resolve(__dirname, "..");
  const app = initializeApp({ projectId }, `matrix-browser-${Date.now()}`);
  const db = getFirestore(app);
  const work = await mkdtemp(path.join(tmpdir(), "signage-matrix-browser-"));
  let browser, server;
  let serverOffset=0;
  const errors = [];
  try {
    await symlink(path.join(root, "node_modules"), path.join(work, "node_modules"), "dir");
    assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^(127\.0\.0\.1|localhost):\d+$/);
    for (const name of ["digitalSignageRoomConfigs","digitalSignageRoomLayouts","digitalSignageRoomTemplates","digitalSignageRoomDisplays"]) {
      for (const document of (await db.collection(name).get()).docs) await document.ref.delete();
    }
    await getAuth(app).deleteUser("matrix-admin").catch(error => { if(error.code!=="auth/user-not-found")throw error; });
    await getAuth(app).createUser({ uid: "matrix-admin", email: "matrix@test.local", password: "MatrixLocal42!" });
    await db.doc("users/matrix-admin").set({ role: "admin", active: true });
    for (const [id,record] of Object.entries({
      maria:{name:"María José",type:"Teacher",active:true,campus:"Centro",signatureDataUrl:"firma-no-enviar-al-player"},
      ailyn:{name:"Ailyn",role:"Maestra",active:true,campus:"Sur"},
      inactive:{name:"Maestro inactivo",type:"Teacher",active:false},
      principal:{name:"Directora",type:"Principal",active:true},
    }))await db.doc(`certificateSigners/${id}`).set(record);
    const rooms = Array.from({ length: 8 }, (_, index) => ({ id: `room-${index + 1}`, name: String(index + 1), active: true }));
    await db.doc("digitalSignageRoomConfigs/Centro").set({ plantel: "Centro", timezone: "America/Tijuana", teacherNames: ["Ailyn", "Rocío", "Paloma"], rooms });
    await db.doc("digitalSignageRoomConfigs/Sur").set({ plantel: "Sur", timezone: "America/Tijuana", teacherNames: [], rooms });
    const device = { id: "matrix-screen", name: "Arriba", location: "Planta alta", deviceToken: "matrix-screen", plantel: "Centro", active: true, assignedPlaylistId: "matrix-playlist" };
    const downDevice={...device,id:"matrix-down",deviceToken:"matrix-down",name:"Abajo",location:"Planta baja"};
    const southDevice={...device,id:"matrix-south",deviceToken:"matrix-south",plantel:"Sur",name:"Recepción Sur"};
    const fixtureDevices=[device,downDevice,southDevice];
    for(const current of fixtureDevices)await db.doc(`digitalSignageDevices/${current.id}`).set(current);
    await db.doc("digitalSignagePlaylists/matrix-playlist").set({ name: "Playlist conservada", active: true, publishStatus: "published", items: [{ assetId: "matrix-photo", title: "Contenido normal", type: "image", url: "http://127.0.0.1:4183/fixture.svg", durationSeconds: 120, publishStatus: "published" }] });
    const firebaseFixture = path.join(work, "firebase.js");
    await writeFile(firebaseFixture, `
      import {initializeApp} from 'firebase/app';
      import {getAuth,connectAuthEmulator} from 'firebase/auth';
      import {getFirestore,connectFirestoreEmulator} from 'firebase/firestore';
      import {getStorage,connectStorageEmulator} from 'firebase/storage';
      import {getFunctions,connectFunctionsEmulator} from 'firebase/functions';
      const app=initializeApp({projectId:'security-rules-audit',apiKey:'emulator-only',authDomain:'localhost',storageBucket:'security-rules-audit.appspot.com'});
      export const auth=getAuth(app),db=getFirestore(app),storage=getStorage(app),functions=getFunctions(app,'us-central1');
      connectAuthEmulator(auth,'http://127.0.0.1:9190',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8180);connectStorageEmulator(storage,'127.0.0.1',9299);connectFunctionsEmulator(functions,'127.0.0.1',5101);export default app;
    `);
    const entry = path.join(work, "main.jsx");
    await writeFile(entry, `
      import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router-dom';
      import {signInWithEmailAndPassword} from 'firebase/auth';import {auth} from ${JSON.stringify(firebaseFixture)};
      import Panel from ${JSON.stringify(path.join(root, "src/components/digital-signage/SignageRoomLayoutsPanel.jsx"))};
      import Player from ${JSON.stringify(path.join(root, "src/components/SignagePlayer.jsx"))};
      import * as service from ${JSON.stringify(path.join(root, "src/services/digital-signage/roomLayoutsService.js"))};
      import * as model from ${JSON.stringify(path.join(root, "src/utils/digitalSignage/roomLayouts.js"))};
      import * as schedule from ${JSON.stringify(path.join(root, "src/utils/digitalSignage/roomSchedule.js"))};
      import ${JSON.stringify(path.join(root, "src/styles/app.css"))};import ${JSON.stringify(path.join(root, "src/index.css"))};
      if(location.pathname==='/admin')await signInWithEmailAndPassword(auth,'matrix@test.local','MatrixLocal42!');
      globalThis.fixture={service,model,schedule,profile:{uid:'matrix-admin',id:'matrix-admin',role:'admin',active:true}};
      createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path='/admin' element={<Panel profile={globalThis.fixture.profile} devices={${JSON.stringify(fixtureDevices)}} planteles={['Centro','Sur']}/>}/><Route path='/signage/player/:deviceToken' element={<Player/>}/></Routes></BrowserRouter>);
    `);
    const { createServer } = await import("vite");
    const react = (await import("@vitejs/plugin-react")).default;
    server = await createServer({ configFile: false, root, plugins: [{ name: "matrix-emulator-fixture", enforce: "pre", resolveId(source, importer) {
      if (importer && source.startsWith(".")) {
        const target = path.resolve(path.dirname(importer), source);
        if ([path.join(root, "src/services/firebase"), path.join(root, "src/services/firebase.js")].includes(target)) return firebaseFixture;
      }
      return null;
    }, configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if(req.method==="HEAD" && req.url==="/"){res.setHeader("Date",new Date(Date.now()+serverOffset).toUTCString());res.end();return;}
      if (req.url.startsWith("/fixture.svg")) { res.setHeader("Content-Type", "image/svg+xml");res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#193e71"/><text x="200" y="400" font-size="60" fill="white">Playlist conservada</text></svg>');return; }
      if (req.url.startsWith("/admin") || req.url.startsWith("/signage/player/")) { vite.transformIndexHtml(req.url, `<html><body style="margin:0"><div id="root"></div><script type="module" src="/@fs${entry}"></script></body></html>`).then(html => {res.setHeader("Content-Type","text/html");res.end(html);}).catch(next);return; }
      next();
    }); } }, react()], server: {host:"127.0.0.1",port:4183,strictPort:true,fs:{allow:[root,work]}} });
    await server.listen();
    browser = await chromium.launch({headless:true,executablePath:process.env.SIGNAGE_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
    t.signal.addEventListener("abort", () => { void browser.close(); }, { once: true });
    const adminContext = await browser.newContext({viewport:{width:1440,height:1000}});
    const playerContext = await browser.newContext({viewport:{width:1920,height:1080}});
    for (const context of [adminContext,playerContext]) {
      context.setDefaultTimeout(20000);
      context.on("page", page => { page.on("pageerror",error => errors.push(error.message));page.route("**/*", route => {
        const url=new URL(route.request().url());if (["localhost","127.0.0.1"].includes(url.hostname))return route.continue();
        if(url.hostname==="www.google.com" && url.pathname==="/images/cleardot.gif")return route.fulfill({status:204,body:""});
        errors.push(`Blocked non-local: ${url.hostname}`);return route.abort();
      }); });
    }
    const admin = await adminContext.newPage();
    let acceptDialogs=true;
    admin.on("dialog", dialog => acceptDialogs ? dialog.accept() : dialog.dismiss());
    await admin.goto("http://127.0.0.1:4183/admin");
    await admin.waitForFunction(() => Boolean(globalThis.fixture));
    await admin.getByRole("button",{name:"Activar Acomodo por Horarios",exact:true}).click();
    const table=admin.locator(".signage-rooms-matrix-table");
    await table.locator("tbody tr").nth(7).waitFor();
    assert.equal(await table.locator("tbody tr").count(),8);
    assert.equal(await table.locator("thead th").count(),4);
    await table.locator("tbody tr").first().locator("td").nth(1).click();
    const teacher=admin.getByLabel("Maestro Asignado",{exact:true});
    await teacher.selectOption("María José");
    assert.equal(await teacher.inputValue(),"María José","el selector usa los nombres registrados en Firmas");
    assert.equal(await teacher.getByRole("option",{name:/Maestro inactivo|Directora/}).count(),0);
    await db.doc("certificateSigners/maria").update({active:false});
    await teacher.getByRole("option",{name:"María José (nombre guardado)",exact:true}).waitFor({state:"attached"});
    assert.equal(await teacher.inputValue(),"María José","un cambio en Firmas no borra la asignación guardada");
    await admin.getByRole("button",{name:/^Etiquetas/}).click();
    await admin.getByRole("button",{name:"+ Agregar etiqueta",exact:true}).click();
    await admin.getByLabel("Nombre de etiqueta",{exact:true}).fill("KIDS");
    await admin.getByLabel("Color texto",{exact:true}).fill("#075f32");
    await admin.getByRole("button",{name:"Cuadrícula de Asignaciones",exact:true}).click();
    await admin.locator(".signage-rooms-cell-inspector-panel").getByRole("button",{name:"KIDS",exact:true}).click();
    await admin.getByRole("button",{name:"Copiar",exact:true}).click();
    await table.locator("tbody tr").nth(1).locator("td").nth(2).click();
    await admin.getByRole("button",{name:"Pegar",exact:true}).click();
    assert.equal(await teacher.inputValue(),"María José");
    await admin.getByRole("button",{name:/Deshacer/}).click();
    assert.equal(await teacher.inputValue(),"");
    await table.getByTitle("Duplicar columna",{exact:true}).first().click();
    assert.equal(await table.locator("thead th").count(),5);
    assert.match(await table.locator("tbody tr").first().locator("td").last().innerText(),/María José/);
    await admin.getByRole("button",{name:/Deshacer/}).click();
    await admin.getByRole("button",{name:"+ Agregar salón",exact:true}).click();
    assert.equal(await table.locator("tbody tr").count(),9);
    await admin.getByRole("button",{name:"Página siguiente",exact:true}).click();
    if(await admin.locator(".signage-rooms-preview-screen-box").getByText("Salón 9",{exact:true}).count()===0)await admin.getByRole("button",{name:"Página siguiente",exact:true}).click();
    await admin.locator(".signage-rooms-preview-screen-box").getByText("Salón 9",{exact:true}).waitFor();
    await admin.getByRole("button",{name:/Deshacer/}).click();
    await admin.getByRole("button",{name:/^Vistas y Paginación/}).click();
    await admin.getByRole("button",{name:"+ Crear nueva vista de horarios",exact:true}).click();
    await admin.getByLabel("Nombre descriptivo de la vista",{exact:true}).last().fill("Tarde 2");
    const viewSelector=admin.getByLabel(/^Vista de horarios a proyectar en esta ventana:/).first();
    await viewSelector.selectOption({label:"Tarde 2"});
    await admin.getByRole("button",{name:"Eliminar vista",exact:true}).last().click();
    assert.notEqual(await viewSelector.inputValue(),"");
    await admin.getByRole("button",{name:"Cuadrícula de Asignaciones",exact:true}).click();
    await admin.getByLabel("Nombre del acomodo",{exact:true}).fill("Prueba UI matriz");
    acceptDialogs=false;
    await admin.getByLabel(/^Catálogo de salones \(referencia\):/).selectOption("Sur");
    assert.equal(await admin.getByLabel(/^Catálogo de salones \(referencia\):/).inputValue(),"Sur");
    assert.equal(await admin.getByLabel("Nombre del acomodo",{exact:true}).inputValue(),"Prueba UI matriz","cambiar catálogo conserva el acomodo independiente");
    await admin.getByLabel(/^Catálogo de salones \(referencia\):/).selectOption("Centro");
    acceptDialogs=true;
    assert.ok(await admin.getByRole("button",{name:"Publicar en pantallas",exact:true}).isDisabled(),"sin destinos solo se guarda borrador");
    await admin.getByLabel(/^Agregar sucursal destino:/).selectOption("Centro");
    const centerDest=admin.locator(".signage-rooms-destinations-branch-card").filter({has:admin.getByRole("heading",{name:"Centro",exact:true})});
    await centerDest.getByLabel("Todas las pantallas activas y futuras de Centro",{exact:true}).uncheck();
    await centerDest.getByRole("checkbox",{name:/Abajo/}).uncheck();
    await admin.getByLabel(/^Agregar sucursal destino:/).selectOption("Sur");
    await admin.getByRole("button",{name:"Guardar borrador",exact:true}).click();
    await admin.getByText("Borrador guardado correctamente.",{exact:true}).waitFor();
    await admin.reload();await admin.locator(".signage-rooms-matrix-table").waitFor();
    assert.match(await admin.locator(".signage-rooms-matrix-table tbody tr").first().innerText(),/María José/);
    await admin.getByRole("button",{name:"Duplicar / Copiar",exact:true}).click();
    await admin.getByLabel(/^Sucursal de referencia \(catálogo y zona horaria\):/).selectOption("Sur");
    await admin.getByRole("group",{name:"Días copia",exact:true}).getByTitle("Domingo",{exact:true}).click();
    await admin.getByRole("button",{name:"Crear copia independiente",exact:true}).click();
    await admin.getByRole("button",{name:"Guardar borrador",exact:true}).click();
    await admin.getByText("Borrador guardado correctamente.",{exact:true}).waitFor();
    const copies=(await db.collection("digitalSignageRoomLayouts").get()).docs.map(doc=>({id:doc.id,...doc.data()}));
    const original=copies.find(layout=>layout.name==="Prueba UI matriz"),copy=copies.find(layout=>layout.name==="Prueba UI matriz (Copia)");
    assert.ok(original && copy);assert.equal(original.plantel,"");assert.deepEqual(original.destinations,[{plantel:"Centro",deviceIds:["matrix-screen"]},{plantel:"Sur",deviceIds:[]}]);assert.deepEqual(copy.destinations,[]);assert.notEqual(copy.assignments[0].id,original.assignments[0].id);
    assert.equal(copy.schedule.cells[0].rowId,copy.assignments[0].id);assert.equal(copy.schedule.cells[0].teacher,"María José");
    assert.ok(copy.classDays.includes(0));assert.ok(!original.classDays.includes(0));
    assert.equal(copy.schedule.cells[0].tagIds.length,1);
    await admin.getByLabel(/^Acomodo:/).selectOption(original.id);
    await admin.getByRole("button",{name:"Personalizar",exact:true}).click();
    const editor=admin.locator(".signage-rooms-template-editor");
    await editor.locator(".signage-rooms-layer-row").filter({hasText:"Matriz de Horarios"}).click();
    await editor.getByLabel(/^Forma salón/).selectOption("rounded");
    await editor.getByLabel("Tamaño base letra",{exact:true}).fill("30");
    await editor.getByRole("button",{name:"Lienzo y Fondo",exact:true}).click();
    await editor.getByLabel("Nombre de la plantilla",{exact:true}).fill("Plantilla matriz personalizada");
    await editor.locator('input[type="file"]').setInputFiles({name:"fondo.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=","base64")});
    await editor.getByText("Fondo asignado",{exact:true}).waitFor();
    await editor.getByRole("button",{name:"Guardar Plantilla",exact:true}).click();
    await admin.getByText("Plantilla guardada y asignada al acomodo.",{exact:true}).waitFor();
    const templates=(await db.collection("digitalSignageRoomTemplates").get()).docs.map(doc=>doc.data());
    assert.equal(templates[0].matrixStyle.roomShape,"rounded");assert.equal(templates[0].matrixStyle.fontSize,30);
    assert.match(templates[0].backgroundUrl,/127\.0\.0\.1:9299/);
    await admin.evaluate(url=>new Promise((resolve,reject)=>{const image=new globalThis.Image();image.onload=()=>resolve(true);image.onerror=()=>reject(new Error("El fondo no se decodifica"));image.src=url;}),templates[0].backgroundUrl);
    await admin.getByRole("button",{name:"Guardar borrador",exact:true}).click();
    await admin.getByText("Borrador guardado correctamente.",{exact:true}).waitFor();
    const player = await playerContext.newPage();
    await player.clock.install({time:Date.now()});
    await player.goto("http://127.0.0.1:4183/signage/player/matrix-screen");
    await player.locator(".signage-player-stage img").waitFor();
    const saved = await admin.evaluate(async () => {
      const {service,model,schedule,profile}=globalThis.fixture;
      const assignments=Array.from({length:8},(_,i)=>({id:`row-${i+1}`,roomName:String(i+1),teacher:"",group:"",active:true}));
      const matrix=schedule.createRoomSchedule(assignments);
      const [a,b,c]=matrix.columns;
      matrix.tags=[{id:"kids",name:"KIDS",color:"#075f32",backgroundColor:"#dcfce7"},{id:"club",name:"Conversation Club",color:"#5d148b",backgroundColor:"#f3e8ff"}];
      matrix.cells=[{rowId:"row-1",columnId:a.id,teacher:"Ailyn",activity:"",tagIds:["kids"]},{rowId:"row-2",columnId:b.id,teacher:"Rocío",activity:"",tagIds:[]},{rowId:"row-1",columnId:c.id,teacher:"Paloma",activity:"",tagIds:[]},{rowId:"row-7",columnId:b.id,teacher:"",activity:"Conv. Club",tagIds:["club"]}];
      matrix.views=[{id:"first",name:"Primera vista",columnIds:[a.id,b.id,c.id],rowsPerPage:8,columnsPerPage:3,pageSeconds:10,rotate:false},{id:"second",name:"Segunda vista",columnIds:[c.id],rowsPerPage:8,columnsPerPage:3,pageSeconds:10,rotate:false}];
      const utc=new Date();const boundary=(utc.getUTCHours()*60+utc.getUTCMinutes()+2)%1440;
      const time=value=>`${String(Math.floor((value%1440)/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`;
      const rule={id:"window",daysOfWeek:[0,1,2,3,4,5,6],dates:[],startTime:time(boundary+1),endTime:time(boundary),deviceIds:[],active:true,priority:2,viewId:"first"};
      const draft={...model.createRoomLayoutDraft({plantel:"Centro",rooms:[]}),id:"matrix-layout",name:"Matriz recepción",plantel:"",destinations:[{plantel:"Centro",deviceIds:["matrix-screen"]},{plantel:"Sur",deviceIds:[]}],timezone:"UTC",assignments,schedule:matrix,templateId:"__schedule_grid__",displayRules:[rule,{...rule,id:"next-window",startTime:time(boundary),endTime:time(boundary+1),viewId:"second"}]};
      return service.saveRoomLayout(draft,profile);
    });
    assert.equal(saved.schedule.cells.length,4);
    await admin.getByLabel(/^Acomodo:/).selectOption("matrix-layout");
    await admin.locator(".signage-rooms-matrix-table").waitFor();
    await admin.getByRole("button",{name:"Ampliar",exact:true}).click();
    await admin.getByRole("dialog").getByText("Ailyn",{exact:true}).waitFor();
    await admin.keyboard.press("Escape");
    await admin.getByRole("dialog").waitFor({state:"detached"});
    assert.equal(await player.locator(".signage-room-display-wrapper").count(),0,"guardar borrador no cambia pantalla");
    await admin.evaluate(() => globalThis.fixture.service.publishRoomLayout("matrix-layout",globalThis.fixture.profile));
    const overlay=player.locator(".signage-room-display-wrapper");
    await overlay.getByText("Ailyn",{exact:true}).waitFor();
    await overlay.getByText("KIDS",{exact:true}).waitFor();
    await overlay.getByText("Conv. Club",{exact:true}).waitFor();
    const geometry=await overlay.evaluate(node=>{const rect=node.querySelector(".signage-room-display-schedule-grid").getBoundingClientRect();return [...node.querySelectorAll(".data-row")].map(row=>{const r=row.getBoundingClientRect();return {top:r.top,bottom:r.bottom,inside:r.top>=rect.top-1 && r.bottom<=rect.bottom+1};});});
    assert.equal(geometry.length,8);assert.ok(geometry.every(row=>row.inside),JSON.stringify(geometry));
    if(process.env.SIGNAGE_MATRIX_SCREENSHOT_DIR){await mkdir(process.env.SIGNAGE_MATRIX_SCREENSHOT_DIR,{recursive:true});await player.screenshot({path:path.join(process.env.SIGNAGE_MATRIX_SCREENSHOT_DIR,"matrix-three-columns.png")});}
    assert.equal(await overlay.getByText("Paloma",{exact:true}).count(),1);
    const manifests=await Promise.all(["matrix-screen","matrix-down","matrix-south"].map(id=>db.doc(`digitalSignageRoomDisplays/${id}`).get()));
    assert.equal(manifests[0].data().layouts[0].plantel,"Centro");assert.equal(manifests[1].data().layouts.length,0);assert.equal(manifests[2].data().layouts[0].plantel,"Sur");
    assert.ok(manifests[0].data().layouts.every(layout=>!("destinations" in layout)),"player no recibe destinos ajenos");
    await admin.evaluate(async source=>{
      const draft={...source,id:"matrix-down-layout",name:"Clases abajo",destinations:[{plantel:"Centro",deviceIds:["matrix-down"]}],displayRules:[{...source.displayRules[0],startTime:"00:00",endTime:"23:59",viewId:"first"}],schedule:{...source.schedule,cells:[{...source.schedule.cells[0],teacher:"Maestra de abajo",tagIds:[]}]}};
      await globalThis.fixture.service.saveRoomLayout(draft,globalThis.fixture.profile);await globalThis.fixture.service.publishRoomLayout(draft.id,globalThis.fixture.profile);
    },saved);
    const downPlayer=await playerContext.newPage();await downPlayer.goto("http://127.0.0.1:4183/signage/player/matrix-down");
    await downPlayer.locator(".signage-room-display-wrapper").getByText("Maestra de abajo",{exact:true}).waitFor();
    await overlay.getByText("Ailyn",{exact:true}).waitFor();
    const frame=await overlay.boundingBox();assert.ok(Math.abs(frame.width/frame.height-16/9)<0.02,"lienzo horizontal 16:9");
    await admin.evaluate(async draft => {draft.schedule.cells[0].teacher="Maestra actualizada";await globalThis.fixture.service.saveRoomLayout(draft,globalThis.fixture.profile);},saved);
    assert.equal(await overlay.getByText("Maestra actualizada",{exact:true}).count(),0,"borrador conserva snapshot");
    await admin.evaluate(() => globalThis.fixture.service.publishRoomLayout("matrix-layout",globalThis.fixture.profile));
    await overlay.getByText("Maestra actualizada",{exact:true}).waitFor();
    const untilNextWindow=await player.evaluate(time=>{const now=Date.now();const target=new Date(now);const [h,m]=time.split(":").map(Number);target.setUTCHours(h,m,0,0);if(target.getTime()<=now)target.setUTCDate(target.getUTCDate()+1);return target.getTime()-now+2000;},saved.displayRules[0].endTime);
    serverOffset=untilNextWindow;
    await player.clock.fastForward(untilNextWindow);
    await overlay.getByText("Paloma",{exact:true}).waitFor();
    assert.equal(await overlay.getByText("Rocío",{exact:true}).count(),0,"vista de ventana usa solo columnas seleccionadas");
    await playerContext.setOffline(true);
    const published=(await db.doc("digitalSignageRoomLayouts/matrix-layout").get()).data();
    await admin.evaluate(async draft => {
      draft.schedule.cells.find(cell=>cell.teacher==="Paloma").teacher="Actualización sin recarga";
      await globalThis.fixture.service.saveRoomLayout(draft,globalThis.fixture.profile);
      await globalThis.fixture.service.publishRoomLayout(draft.id,globalThis.fixture.profile);
    },{...published,id:"matrix-layout"});
    await overlay.getByText("Paloma",{exact:true}).waitFor();
    await playerContext.setOffline(false);
    await overlay.getByText("Actualización sin recarga",{exact:true}).waitFor();
    for (const width of [320,390,768,1600]) {
      await admin.setViewportSize({width,height:1000});
      for (const theme of ["light","dark"]) {
        await admin.evaluate(value=>globalThis.document.documentElement.dataset.theme=value,theme);
        assert.ok(await admin.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth+1),`desbordamiento ${width} ${theme}`);
      }
    }
    await admin.setViewportSize({width:1440,height:1000});
    await admin.evaluate(()=>{globalThis.document.documentElement.dataset.theme="light";});
    const screenshotDir=process.env.SIGNAGE_MATRIX_SCREENSHOT_DIR;
    if(screenshotDir){await mkdir(screenshotDir,{recursive:true});await player.screenshot({path:path.join(screenshotDir,"matrix-player.png")});await admin.screenshot({path:path.join(screenshotDir,"matrix-admin.png"),fullPage:true});}
    await admin.evaluate(() => globalThis.fixture.service.unpublishRoomLayout("matrix-layout",globalThis.fixture.profile));
    await overlay.waitFor({state:"detached"});await player.locator(".signage-player-stage img").waitFor({state:"visible"});
    await downPlayer.locator(".signage-room-display-wrapper").getByText("Maestra de abajo",{exact:true}).waitFor();
    assert.equal((await db.doc("digitalSignageDevices/matrix-screen").get()).data().assignedPlaylistId,"matrix-playlist");
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();await server?.close();await deleteApp(app);await rm(work,{recursive:true,force:true});
  }
});
