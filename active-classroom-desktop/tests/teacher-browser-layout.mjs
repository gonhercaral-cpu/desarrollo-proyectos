// Portable layout acceptance; this is Chromium, not native WebKitGTK/hardware validation.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "vite";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const browser=process.env.CHROMIUM_EXECUTABLE || (process.platform==="darwin"?"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome":"chromium");
const output=await build({configFile:false,logLevel:"error",build:{write:false,lib:{entry:fileURLToPath(new URL("./teacher-browser-layout.browser.mjs",import.meta.url)),name:"LayoutTest",formats:["iife"]}}});
const assets=(Array.isArray(output)?output[0]:output).output;
const css=assets.filter(a=>a.type==="asset"&&a.fileName.endsWith(".css")).map(a=>a.source).join("\n"),js=assets.find(a=>a.type==="chunk").code;
const server=createServer((req,res)=>{const path=new URL(req.url,"http://localhost").pathname;const [mime,body]=path==="/test.js"?["text/javascript",js]:path==="/test.css"?["text/css",css]:["text/html",'<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="/test.css"><div id="app"></div><pre hidden id="layout-result"></pre><script src="/test.js"></script></html>'];res.setHeader("Content-Type",mime);res.end(body);});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const folder=process.env.LAYOUT_EVIDENCE || await mkdtemp(join(tmpdir(),"ac47-layout-")); await mkdir(folder,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),"ac47-chrome-"));
let child,ws;
try {
 const endpoint=await new Promise((resolve,reject)=>{let errors=""; child=spawn(browser,["--headless","--no-first-run","--no-default-browser-check",`--user-data-dir=${profile}`,"--remote-debugging-port=0","about:blank"]);child.stderr.on("data",b=>{errors+=b;const match=errors.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match)resolve(match[1]);});child.on("error",reject);child.on("exit",code=>reject(new Error(`Chromium ${code}: ${errors.slice(-1000)}`)));});
 ws=new WebSocket(endpoint); await new Promise((resolve,reject)=>{ws.addEventListener("open",resolve,{once:true});ws.addEventListener("error",reject,{once:true});});
 let next=0;const pending=new Map();
 ws.addEventListener("message",event=>{const message=JSON.parse(event.data);const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(JSON.stringify(message.error))):request.resolve(message.result);}});
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout ${method}`));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,sessionId}));});
 for(const [width,height] of [[920,640],[1366,768],[1920,1080]]) for(const mode of ["class","browser"]) {
  const {targetId}=await call("Target.createTarget",{url:"about:blank"});
  try {
   const {sessionId}=await call("Target.attachToTarget",{targetId,flatten:true});
   await call("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false},sessionId);
   await call("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/?mode=${mode}`},sessionId);
   let result;
   for(let i=0;i<100;i++) {
    await new Promise(resolve=>setTimeout(resolve,50));
    const evaluation=await call("Runtime.evaluate",{expression:'document.querySelector("#layout-result")?.textContent || ""',returnByValue:true},sessionId);
    if(evaluation.result?.value){result=JSON.parse(evaluation.result.value);break;}
   }
   assert.ok(result,"Falta resultado del navegador");assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(result.viewport,[width,height]);
   const screenshot=await call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false},sessionId);
   await writeFile(join(folder,`${width}x${height}-${mode}.png`),Buffer.from(screenshot.data,"base64"));
   console.log(JSON.stringify(result));
  } finally {await call("Target.closeTarget",{targetId});}
 }
 console.log(`Evidencia: ${folder}`);
} finally {
 ws?.close();
 if(child && child.exitCode===null){const stopped=new Promise(resolve=>child.once("exit",resolve));child.kill();await stopped;}
 await rm(profile,{recursive:true,force:true});
 await new Promise(resolve=>server.close(resolve));
}
