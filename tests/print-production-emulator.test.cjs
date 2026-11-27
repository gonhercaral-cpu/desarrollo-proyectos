"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes, randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const fromFunctions = createRequire(require.resolve("../functions/package.json"));

test("producción virtual: PDF definitivo, tres colas, conciliación y entradas parciales idempotentes", {
  skip: !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST,
}, async (t) => {
  const projectId = "demo-imprenta-integracion";
  for (const host of [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_STORAGE_EMULATOR_HOST]) {
    assert.match(host, /^(?:127\.0\.0\.1|localhost):\d+$/);
  }
  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId, storageBucket: projectId + ".appspot.com" });
  const api = require("../functions/index.js");
  const db = fromFunctions("firebase-admin/firestore").getFirestore();
  t.after(() => fromFunctions("firebase-admin/app").deleteApp(fromFunctions("firebase-admin/app").getApp()));
  const bucket = fromFunctions("firebase-admin/storage").getStorage().bucket();
  const actor = { uid: "produccion-test", token: {} };
  const call = (name, data) => api[name].run({ auth: actor, data });
  const action = (jobId, name, args) => call("printProductionAction", { jobId, action: name, requestId: randomUUID(), ...args });
  await db.doc("users/" + actor.uid).set({ name: "Operación de prueba", role: "admin", active: true });
  const settings = await call("printProductionSettings", { defaults: { paper: "A4" } });
  assert.equal(settings.settings.certificateEnabled, false);

  const { PDFDocument } = fromFunctions("pdf-lib");
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 120; i++) pdf.addPage().drawText(String(i + 1));
  const bytes = Buffer.from(await pdf.save());
  const uploadId = randomUUID();
  await bucket.file("printStaging/" + actor.uid + "/" + uploadId + ".pdf").save(bytes);
  const source = await call("freezePrintDocument", { operationId: uploadId, uploadId, origin: "local", name: "Libro.pdf" });
  assert.equal(source.pages, 120);
  assert.deepEqual((await bucket.file(source.path).download())[0], bytes);
  const productId = randomUUID();
  await db.doc("printProducts/" + productId).set({ active: true, name: "Libro de prueba", unit: "Libro" });
  const material = await call("printProductionLibrary", { kind: "material", productId, requestId: randomUUID(), sourceId: source.id, type: "book" });
  assert.equal(material.version, 1);
  const { agentId, code } = await call("printAgentAdmin", { action: "pair", name: "CUPS virtual" });
  const token = randomBytes(32).toString("hex");
  const express = fromFunctions("express");
  const http = express();
  http.use(express.json());
  http.post("/", api.printAgentGateway);
  const server = await new Promise((resolve) => {
    const listener = http.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const gateway = async (body) => {
    const response = await fetch("http://127.0.0.1:" + server.address().port, {
      method: "POST", headers: { "Content-Type": "application/json", "x-print-agent": agentId, Authorization: "Bearer " + token },
      body: JSON.stringify(body),
    });
    const value = await response.json();
    assert.equal(response.status, 200, value.error);
    return value;
  };
  await gateway({ op: "pair", code: code.split(".")[1] });
  const queues = ["Virtual-A", "Virtual-B", "Virtual-C"];
  await gateway({ op: "heartbeat", printers: queues.map((queue) => ({ queue, online: true, color: true,
    duplex: true, paperSizes: ["A4"], capabilities: { pageRange: true } })) });
  const printerIds = queues.map((queue) => require("../functions/printAgent").printerId(agentId, queue));
  const payload = { requestId: randomUUID(), sourceId: source.id, title: "Libro de prueba", type: "book", config: {
    copies: 100, duplex: true, color: true, paper: "A4", priority: "high", notes: "Ensamblar por rango",
  }, mode: "pages", printerIds, productId, draft: false };
  const [job, replay] = await Promise.all([call("printProductionSave", payload), call("printProductionSave", payload)]);
  assert.equal(job.jobId, replay.jobId);
  assert.deepEqual(job.parts.map((p) => [p.from, p.to, p.copies]), [[1, 40, 100], [41, 80, 100], [81, 120, 100]]);
  for (const queue of queues) {
    const { task } = await gateway({ op: "claim", queues: [queue] });
    assert.equal(task.jobId, job.jobId);
    await gateway({ ...task, op: "start" });
    await gateway({ ...task, op: "report", state: "submitted", spoolId: 1 });
    await gateway({ ...task, op: "report", state: "spoolCompleted" });
    await action(job.jobId, "reconcile", { partId: task.partId, outcome: "printed", confirm: true });
  }
  assert.equal((await db.doc("printJobs/" + job.jobId).get()).data().accepted, 0);
  await action(job.jobId, "quality", { accepted: 97, rejected: 3, notes: "Piezas dañadas" });
  const movement = { jobId: job.jobId, action: "inventory", requestId: randomUUID() };
  const [first, duplicate] = await Promise.all([call("printProductionAction", movement), call("printProductionAction", movement)]);
  assert.equal(first.movementId, duplicate.movementId);
  await action(job.jobId, "quality", { accepted: 3, notes: "Reposición verificada" });
  assert.equal((await action(job.jobId, "inventory", {})).quantity, 3);
  assert.equal((await db.doc("printFinishedInventory/" + productId).get()).data().currentStock, 100);
  const moves = await db.collection("printInventoryMovements").where("jobId", "==", job.jobId).get();
  assert.deepEqual(moves.docs.map((d) => d.data().quantity).sort((a, b) => a-b), [3, 97]);
  const byCopies = await call("printProductionSave", { ...payload, mode: "copies", requestId: randomUUID() });
  assert.equal(byCopies.parts.reduce((n,p) => n+p.copies,0), 100);
  assert.ok(byCopies.parts.every((p) => p.from === 1 && p.to === 120));
  await action(byCopies.jobId, "cancel", { reason: "Fin de prueba virtual" });
  await call("printAgentAdmin", { action: "revoke", agentId });

});
