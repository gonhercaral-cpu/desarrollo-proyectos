// Run inside Auth/Firestore/Functions emulators, with PLAYWRIGHT_MODULE_PATH pointing
// to a locally installed Playwright package. No production endpoints are permitted.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, writeFile, rm, symlink, mkdir } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { existsSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const functionsRequire = createRequire(require.resolve("../functions/package.json"));
const playwrightPath = process.env.PLAYWRIGHT_MODULE_PATH || (process.env.PATH || "").split(path.delimiter)
  .filter((entry) => entry.endsWith("node_modules/.bin"))
  .map((entry) => path.join(path.dirname(entry), "playwright"))
  .find((entry) => existsSync(path.join(entry, "package.json")));

test("Digital Signage: flujo panel–Functions–player en Chrome y emuladores", {
  skip: !playwrightPath || !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST,
  timeout: 240000,
}, async (t) => {
  const projectId = "security-rules-audit";
  assert.equal(JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId || projectId, projectId);
  const { initializeApp, deleteApp } = functionsRequire("firebase-admin/app");
  const { getFirestore, FieldValue } = functionsRequire("firebase-admin/firestore");
  const { getAuth } = functionsRequire("firebase-admin/auth");
  const { chromium } = require(playwrightPath);
  const root = path.resolve(__dirname, "..");
  const app = initializeApp({ projectId }, `ds-browser-${Date.now()}`);
  const db = getFirestore(app);
  const work = await mkdtemp(path.join(tmpdir(), "ds-browser-"));
  await symlink(path.join(root, "node_modules"), path.join(work, "node_modules"), "dir");
  let server, browser;
  const errors = [];
  try {
    const auth = getAuth(app);
    await auth.createUser({ uid: "ds-ui-admin", email: "ds-ui-admin@test.local", password: "LocalTest40!" });
    await db.collection("users").doc("ds-ui-admin").set({ role: "admin", active: true });
    await db.collection("digitalSignageDevices").doc("ds-ui-device").set({
      name: "Recepción de prueba", plantel: "Centro", location: "Lobby", deviceToken: "ds-ui-device",
      assignedPlaylistId: "ds-ui-playlist", active: true, createdAt: FieldValue.serverTimestamp(),
    });
    const imageItem = (title, version) => ({
      assetId: "ui-image", title, type: "image", url: `http://127.0.0.1:4178/ds-test-image.svg?v=${version}`,
      durationSeconds: 3, publishStatus: "published",
    });
    await db.collection("digitalSignagePlaylists").doc("ds-ui-playlist").set({
      name: "Playlist de prueba", active: true, publishStatus: "published", createdAt: FieldValue.serverTimestamp(),
      items: [imageItem("Imagen inicial", 1)],
    });
    const fixtureFirebase = path.join(work, "firebase.js");
    await writeFile(fixtureFirebase, `
      import { initializeApp } from 'firebase/app';
      import { getAuth, connectAuthEmulator } from 'firebase/auth';
      import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
      import { getStorage, connectStorageEmulator } from 'firebase/storage';
      import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
      const app=initializeApp({projectId:'security-rules-audit',apiKey:'emulator-only',authDomain:'localhost',storageBucket:'security-rules-audit.appspot.com'});
      export const auth=getAuth(app), db=getFirestore(app), storage=getStorage(app), functions=getFunctions(app,'us-central1');
      connectAuthEmulator(auth,'http://127.0.0.1:9190',{disableWarnings:true});
      connectFirestoreEmulator(db,'127.0.0.1',8180);
      connectStorageEmulator(storage,'127.0.0.1',9299);
      connectFunctionsEmulator(functions,'127.0.0.1',5101);
      export default app;
    `);
    const entry = path.join(work, "main.jsx");
    await writeFile(entry, `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {BrowserRouter,Routes,Route} from 'react-router-dom';
      import {signInWithEmailAndPassword} from 'firebase/auth';
      import {auth} from ${JSON.stringify(fixtureFirebase)};
      import Setup from ${JSON.stringify(path.join(root, "src/components/SignageSetup.jsx"))};
      import Player from ${JSON.stringify(path.join(root, "src/components/SignagePlayer.jsx"))};
      import Control from ${JSON.stringify(path.join(root, "src/components/digital-signage/SignageDeviceControl.jsx"))};
      import {adminSignageControl} from ${JSON.stringify(path.join(root, "src/services/digital-signage/controlService.js"))};
      import ${JSON.stringify(path.join(root, "src/styles/app/modules/digital-signage/digital-signage-player.css"))};
      ${process.env.SIGNAGE_SCREENSHOT_DIR ? `import ${JSON.stringify(path.join(root, "src/styles/app.css"))};` : ""}
      if(location.pathname==='/admin') await signInWithEmailAndPassword(auth,'ds-ui-admin@test.local','LocalTest40!');
      window.dsTest={admin:adminSignageControl};
      createRoot(document.getElementById('root')).render(<BrowserRouter><Routes>
        <Route path='/setup' element={<Setup/>}/><Route path='/signage/player/:deviceToken' element={<Player/>}/>
        <Route path='/admin' element={<Control device={{id:'ds-ui-device',name:'Recepción de prueba'}}/>}/>
      </Routes></BrowserRouter>);
    `);
    const { createServer } = await import("vite");
    const react = (await import("@vitejs/plugin-react")).default;
    server = await createServer({
      configFile: false, root, plugins: [
        {
          name: "digital-signage-emulator-fixture",
          enforce: "pre",
          resolveId(source, importer) {
            if (importer && source.startsWith(".")) {
              const resolved = path.resolve(path.dirname(importer), source);
              if ([path.join(root, "src/services/firebase"), path.join(root, "src/services/firebase.js")].includes(resolved)) return fixtureFirebase;
            }
            return null;
          },
          configureServer(vite) {
            vite.middlewares.use((req, res, next) => {
              if (req.url.startsWith("/ds-test-image.svg")) {
                res.setHeader("Content-Type", "image/svg+xml"); res.setHeader("ETag", '"ds-test-v1"');
                res.end('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#1848b8"/><text x="80" y="180" fill="white" font-size="50">Digital Signage</text></svg>'); return;
              }
              if (req.url.startsWith("/web-demo")) {
                res.setHeader("Content-Type", "text/html");
                res.end('<!doctype html><title>Web compatible</title><body style="height:3000px;background:#eef"><h1>Web de prueba</h1><p>Control limitado al iframe.</p></body>'); return;
              }
              if (/^\/(admin|setup|signage\/player\/)/.test(req.url)) {
                vite.transformIndexHtml(req.url, `<html><body style="margin:0"><div id="root"></div><script type="module" src="/@fs${entry}"></script></body></html>`)
                  .then((html) => { res.setHeader("Content-Type", "text/html"); res.end(html); }).catch(next);
                return;
              }
              next();
            });
          },
        }, react(),
      ],
      server: { host: "127.0.0.1", port: 4178, strictPort: true, fs: { allow: [root, work] } },
    });
    await server.listen();
    browser = await chromium.launch({ headless: true, executablePath: process.env.SIGNAGE_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
    t.signal.addEventListener("abort", () => { void browser.close(); }, { once: true });
    const deviceContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const adminContext = await browser.newContext({ viewport: { width: 1200, height: 1400 } });
    for (const context of [deviceContext, adminContext]) {
      context.setDefaultTimeout(30000);
      context.on("page", (page) => {
        page.on("pageerror", (error) => errors.push(error.message));
        page.route("**/*", (route) => {
          const requestUrl = new URL(route.request().url());
          const host = requestUrl.hostname;
          if (["127.0.0.1", "localhost"].includes(host)) return route.continue();
          // Firebase's offline reconnect probe is answered locally; never contact Google.
          if (host === "www.google.com" && requestUrl.pathname === "/images/cleardot.gif") {
            return route.fulfill({ status: 204, body: "" });
          }
          errors.push(`Blocked non-local request: ${host}`); return route.abort();
        });
      });
    }
    const screen = await deviceContext.newPage();
    const panel = await adminContext.newPage();
    panel.on("dialog", (dialog) => dialog.accept());
    await screen.goto("http://127.0.0.1:4178/setup");
    await screen.waitForFunction(() => /AES-\d{6}/.test(globalThis.document.querySelector(".signage-setup-code")?.textContent || ""));
    const code = (await screen.locator(".signage-setup-code").textContent()).trim();
    await panel.goto("http://127.0.0.1:4178/admin");
    await panel.getByLabel("Codigo de revinculacion").fill(code);
    await panel.getByRole("button", { name: "Revincular dispositivo", exact: true }).click();
    await screen.waitForURL("**/signage/player/ds2_*", { timeout: 30000 });
    await screen.locator(".signage-player-stage img").waitFor();
    const state = () => panel.evaluate(() => globalThis.dsTest.admin({ action: "status", deviceId: "ds-ui-device" }));
    async function until(predicate, label, timeout = 40000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const value = await state();
        if (predicate(value)) return value;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(`Timeout: ${label}; ${JSON.stringify(await state())}`);
    }
    await until((s) => s.telemetry?.state === "playing", "telemetría real de imagen");
    await until((s) => s.telemetry?.origin === "cache", "reproducción desde blob persistido");
    await deviceContext.setOffline(true);
    await new Promise((resolve) => setTimeout(resolve, 3500));
    assert.equal(await screen.locator(".signage-player-stage img").evaluate((image) => image.complete && image.naturalWidth > 0), true);
    await deviceContext.setOffline(false);
    console.log("DS-05 y DS-06: revinculación conserva ID/playlist; imagen real en caché confirmada.");

    await panel.getByRole("button", { name: "Ver pantalla", exact: true }).click();
    await panel.getByAltText("Captura real de la pantalla").waitFor({ timeout: 40000 });
    const frame = await state();
    assert.ok(frame.monitor.frame.dataUrl.startsWith("data:image/jpeg;base64,"));
    console.log("DS-02: captura real del elemento img recibida en el panel.");
    if (process.env.SIGNAGE_SCREENSHOT_DIR) {
      const evidence = path.resolve(process.env.SIGNAGE_SCREENSHOT_DIR);
      await mkdir(evidence, { recursive: true });
      await panel.locator("#root").evaluate((element) => { element.style.maxWidth = "500px"; element.style.margin = "20px auto"; });
      await panel.screenshot({ path: path.join(evidence, "panel-signage.png"), fullPage: true });
      await screen.screenshot({ path: path.join(evidence, "player-signage.png") });
      if (process.env.SIGNAGE_CAPTURE_ONLY === "1") return;
    }

    await db.collection("digitalSignagePlaylists").doc("ds-ui-playlist").update({ items: [imageItem("Contenido actualizado", 2)] });
    await panel.getByRole("button", { name: "Recargar pantalla", exact: true }).click();
    await until((s) => s.command?.type === "refresh" && s.command.status === "executed", "ACK real de recarga");
    assert.equal(await screen.locator(".signage-player-stage img").getAttribute("alt"), "Contenido actualizado");
    console.log("DS-01: playlist actualizada y ACK ejecutado tras consulta al servidor.");

    await panel.locator("select").selectOption("stream");
    await until((s) => s.mode === "stream" && s.telemetry?.appliedMode === "stream", "modo stream aplicado");
    assert.ok(!(await screen.locator(".signage-player-stage img").getAttribute("src")).startsWith("blob:"));
    const persistentCaches = await screen.evaluate(() => globalThis.caches.keys());
    assert.ok(persistentCaches.some((name) => name.startsWith("digital-signage-assets-v2-")));
    console.log("DS-04: modo stream aplicado sin utilizar blob local.");

    await panel.locator("select").selectOption("cache");
    await until((s) => s.mode === "cache" && s.telemetry?.appliedMode === "cache" && s.telemetry.origin === "cache", "regreso a caché sin perder archivos");

    await db.collection("digitalSignagePlaylists").doc("ds-ui-playlist").update({ items: [{
      assetId: "ui-web", title: "Web compatible", type: "web", url: "http://127.0.0.1:4178/web-demo", durationSeconds: 180,
      publishStatus: "published", webSettings: { allowInteraction: true, mode: "iframe" },
    }] });
    await until((s) => s.telemetry?.type === "web" && s.telemetry.state === "playing", "página web real");
    await panel.getByRole("button", { name: "Bajar", exact: true }).waitFor({ timeout: 20000 });
    await panel.getByRole("button", { name: "Bajar", exact: true }).click();
    await until((s) => s.command?.type === "web_scroll" && s.command.status === "executed", "scroll web confirmado");
    assert.ok(await screen.locator("iframe").evaluate((iframe) => iframe.contentWindow.scrollY > 0));
    await new Promise((resolve) => setTimeout(resolve, 10000));
    await panel.getByLabel("Ruta relativa").fill("/web-demo?changed=1");
    await panel.getByRole("button", { name: "Ir a ruta", exact: true }).click();
    await until((s) => s.command?.type === "web_navigate" && s.command.status === "executed", "navegación confirmada");
    assert.match(await screen.locator("iframe").getAttribute("src"), /changed=1/);
    await new Promise((resolve) => setTimeout(resolve, 10000));
    await panel.getByRole("button", { name: "Recargar web", exact: true }).click();
    await until((s) => s.command?.type === "web_reload" && s.command.status === "executed", "recarga web confirmada por carga real");
    console.log("DS-03: scroll y navegación del mismo origen ejecutados, sin control del escritorio.");
    await until((s) => Boolean(s.monitor?.captureError), "limitación explícita de captura iframe");

    const { createRoomLayoutDraft, DEFAULT_ROOM_TEMPLATE } = await import(pathToFileURL(path.join(root, "src/utils/digitalSignage/roomLayouts.js")));
    const { buildPublishedRoomSnapshot, buildRoomDisplayManifest } = await import(pathToFileURL(path.join(root, "src/utils/digitalSignage/roomPublication.js")));
    const draft = createRoomLayoutDraft({ plantel: "Centro", rooms: ["Aula 1"], classDays: [0, 1, 2, 3, 4, 5, 6] });
    const published = buildPublishedRoomSnapshot({
      ...draft, id: "ui-room", name: "Acomodo real de prueba",
      assignments: [{ id: "row-1", roomName: "Aula 1", teacher: "Docente de prueba", group: "Grupo A", active: true }],
      displayRules: [{ ...draft.displayRules[0], startTime: "00:00", endTime: "23:59" }],
    }, { ...DEFAULT_ROOM_TEMPLATE, elements: DEFAULT_ROOM_TEMPLATE.elements.filter((element) => element.type !== "image") }, Date.now());
    const roomManifest = buildRoomDisplayManifest({ id: "ds-ui-device", deviceToken: "ds-ui-device", plantel: "Centro", active: true }, [published]);
    const roomChangedAt = Date.now();
    await db.collection("digitalSignageRoomDisplays").doc("ds-ui-device").set({ ...roomManifest, updatedAt: FieldValue.serverTimestamp() });
    await until((s) => s.telemetry?.type === "room_layout" && s.telemetry.title === "Acomodo real de prueba", "telemetría del overlay visible");
    await screen.locator(".signage-player-room-overlay").waitFor();
    assert.equal(await screen.locator(".signage-player-stage").evaluate((stage) => globalThis.getComputedStyle(stage).visibility), "hidden");
    await until((s) => s.monitor?.frame?.capturedAt > roomChangedAt && !s.monitor.captureError, "captura real del acomodo, no de la playlist oculta");
    console.log("Compatibilidad main: acomodo visible, telemetría y captura del overlay correctos.");
    await db.collection("digitalSignageRoomDisplays").doc("ds-ui-device").delete();
    await until((s) => s.telemetry?.type === "web", "retirada del acomodo y reanudación de playlist");
    await panel.getByRole("button", { name: "Cerrar monitor", exact: true }).click();
    await until((s) => s.monitor === null, "cierre efectivo de sesión visual");
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server?.close();
    await deleteApp(app);
    await rm(work, { recursive: true, force: true });
  }
});
