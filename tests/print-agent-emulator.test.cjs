const assert = require("node:assert/strict");
const { randomBytes, createHash } = require("node:crypto");
const { Writable } = require("node:stream");
const test = require("node:test");
const { createRequire } = require("node:module");
const adminRequire = createRequire(require.resolve("../functions/package.json"));
const { initializeApp, deleteApp } = adminRequire("firebase-admin/app");
const { getFirestore } = adminRequire("firebase-admin/firestore");
const { getStorage } = adminRequire("firebase-admin/storage");
const { HttpsError } = adminRequire("firebase-functions/v2/https");
const { createPrintAgentHandlers, printerId } = require("../functions/printAgent");

const local = value => /^(localhost|127\.0\.0\.1):\d+$/.test(value || "");
test("Emuladores: reserva concurrente única, descarga acotada, revocación y rechazo de una credencial ajena", {
  skip: !(local(process.env.FIRESTORE_EMULATOR_HOST) && local(process.env.FIREBASE_STORAGE_EMULATOR_HOST)),
}, async () => {
  const projectId = process.env.GCLOUD_PROJECT || "demo-as-print-agent";
  const tag = randomBytes(12).toString("hex");
  const app = initializeApp({ projectId, storageBucket: projectId + ".appspot.com" }, "agent-" + tag);
  const db = getFirestore(app);
  const bucket = getStorage(app).bucket();
  const api = createPrintAgentHandlers({ db, bucket, HttpsError, assertAdmin: async () => ({ uid: "operator" }) });
  const { agentId, code } = await api.admin({ data: { action: "pair", name: "Virtual local" } });
  const credential = randomBytes(32).toString("hex");
  const job = db.collection("printJobs").doc(tag);
  const object = bucket.file("printDocuments/operator/" + tag + ".pdf");
  const printer = printerId(agentId, "Virtual");
  const secure = db.doc("printAgentSecrets/" + agentId);
  const source = Buffer.alloc(4 * 1024 * 1024 + 719, 42);
  const digest = createHash("sha256").update(source).digest("hex");
  async function call(body, key = credential) {
    const chunks = [];
    const res = new Writable({ write(chunk, encoding, cb) { chunks.push(Buffer.from(chunk)); cb(); } });
    res.code = 200;
    res.headers = {};
    res.status = n => { res.code = n; return res; };
    res.json = val => { res.data = val; return res; };
    res.set = (h, v) => { Object.assign(res.headers, typeof h === "string" ? { [h]: v } : h); return res; };
    await api.gateway({ method: "POST", headers: { "x-print-agent": agentId, authorization: "Bearer " + key }, body }, res);
    return { code: res.code, data: res.data, bytes: Buffer.concat(chunks), headers: res.headers };
  }
  try {
    assert.equal((await call({ op: "pair", code: code.split(".")[1] })).code, 200);
    assert.equal((await call({ op: "heartbeat", printers: [{ queue: "Virtual", online: true, paperSizes: ["A4"],
      capabilities: { pageRange: true, trays: ["tray1"], quality: ["draft", "normal"] } }] })).code, 200);
    assert.equal((await db.doc("printPrinters/" + printer).get()).data().capabilities.pageRange, true);
    await object.save(source, { resumable: false, contentType: "application/pdf" });
    await job.set({ status: "queued", dispatchPrinterIds: [printer], config: { paper: "A4" },
      source: { path: object.name, sha256: digest, pages: 1 }, parts: [{ id: "p1", printerId: printer, from: 1, to: 1, copies: 1, status: "queued" }] });
    const claim = { op: "claim", queues: ["Virtual"] };
    const pair = await Promise.all([call(claim), call(claim)]);
    for (const answer of pair) assert.equal(answer.code, 200, JSON.stringify(answer.data));
    const tasks = pair.map(x => x.data.task).filter(Boolean);
    assert.equal(tasks.length, 1);
    const t = tasks[0];
    assert.equal(t.jobId, tag);
    const part1 = await call({ ...t, op: "chunk", offset: 0 });
    assert.equal(part1.code, 200, JSON.stringify(part1.data));
    const part2 = await call({ ...t, op: "chunk", offset: part1.bytes.length, generation: part1.headers["X-Pdf-Generation"] });
    assert.equal(part2.code, 200, JSON.stringify(part2.data));
    assert.deepEqual(Buffer.concat([part1.bytes, part2.bytes]), source);
    assert.equal((await call({ ...t, op: "chunk", offset: 0 }, "c".repeat(64))).code, 401);
    assert.equal((await call({ ...t, op: "start" })).code, 200);
    assert.equal((await call({ ...t, op: "chunk", offset: 0 })).code, 409);
    assert.equal((await call({ ...t, op: "report", state: "submitted", spoolId: 1 })).code, 200);
    assert.equal((await call({ ...t, op: "report", state: "spoolCompleted" })).code, 200);
    assert.equal((await job.get()).data().status, "confirmation");
    assert.equal((await secure.get()).data().credentialHash.length, 64);
    await api.admin({ data: { action: "revoke", agentId } });
    assert.equal((await call(claim)).code, 401);
  } finally {
    await Promise.all([db.recursiveDelete(job), db.doc("printPrinters/" + printer).delete(),
      db.doc("printAgents/" + agentId).delete(), secure.delete(), object.delete({ ignoreNotFound: true })]);
    await deleteApp(app);
  }
});
