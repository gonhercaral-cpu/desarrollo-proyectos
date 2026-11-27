const test = require("node:test");
const assert = require("node:assert/strict");
const { createPrintAgentHandlers, printerId, eligiblePart, rollup, dispatchIds } = require("../functions/printAgent");

class HttpError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function memoryStore() {
  const records = new Map();
  let sequence = 0;
  const document = path => ({
    path, id: path.split("/").at(-1), collection: name => collection(path + "/" + name),
    get: async () => snapshot(path),
  });
  const snapshot = path => ({ exists: records.has(path), ref: document(path),
    id: path.split("/").at(-1), data: () => structuredClone(records.get(path)) });
  const collection = path => ({
    doc: (id = "auto" + (++sequence)) => document(path + "/" + id),
    where: (key, op, ids) => {
      assert.equal(op, "array-contains-any");
      const query = { orderBy: () => query, limit: () => query, startAfter: () => query, get: async () => {
        const docs = [...records.entries()].filter(([k, v]) => k.startsWith(path + "/") && v[key]?.some(id => ids.includes(id))).map(([k]) => snapshot(k));
        return { docs, size: docs.length };
      }};
      return query;
    },
  });
  const writes = () => {
    const pending = [];
    return {
      get: ref => ref.get(),
      create: (r, v) => pending.push(() => { assert.ok(!records.has(r.path)); records.set(r.path, v); }),
      set: (r, v, opts) => pending.push(() => records.set(r.path, opts?.merge ? { ...records.get(r.path), ...v } : v)),
      update: (r, v) => pending.push(() => records.set(r.path, { ...records.get(r.path), ...v })),
      delete: r => pending.push(() => records.delete(r.path)),
      commit: () => pending.forEach(write => write()),
    };
  };
  return { records, collection, batch: writes, runTransaction: async fn => { const tx = writes(); const result = await fn(tx); tx.commit(); return result; } };
}

function setup() {
  const db = memoryStore();
  let time = Date.now();
  const handlers = createPrintAgentHandlers({ db, HttpsError: HttpError, now: () => time,
    assertAdmin: async req => { if (!req.admin) throw new HttpError("permission-denied"); return { uid: "admin" }; } });
  async function gateway(id, key, body) {
    const res = { set: () => res, status: code => { res.code = code; return res; }, json: data => { res.data = data; } };
    await handlers.gateway({ method: "POST", headers: { "x-print-agent": id, authorization: "Bearer " + key }, body }, res);
    return { code: res.code, data: res.data };
  }
  return { db, handlers, gateway, advance: ms => { time += ms; } };
}

async function paired(fixture) {
  const { handlers, gateway } = fixture;
  const { agentId, code } = await handlers.admin({ admin: true, data: { action: "pair", name: "Pruebas" } });
  const secret = "a".repeat(64);
  const call = body => gateway(agentId, secret, body);
  assert.equal((await call({ op: "pair", code: code.split(".")[1] })).code, 200);
  assert.equal((await call({ op: "heartbeat", printers: [{ queue: "Test", paperSizes: ["A4"], online: true }] })).code, 200);
  return { call, agentId, secret };
}

function insertJob(db, id) {
  const p = printerId(id, "Test");
  db.records.set("printJobs/libro", { status: "queued", dispatchPrinterIds: [p],
    source: { path: "printDocuments/operator/file.pdf", sha256: "a".repeat(64), pages: 120 }, config: { paper: "A4" },
    parts: [{ id: "p1", printerId: p, status: "queued", from: 1, to: 40, copies: 100 }] });
}

test("La vinculación exige administrador, caduca, y permite repetir sólo con el mismo secreto", async () => {
  const f = setup();
  await assert.rejects(f.handlers.admin({ data: { action: "pair", name: "A" } }), { code: "permission-denied" });
  const { agentId, code } = await f.handlers.admin({ admin: true, data: { action: "pair", name: "A" } });
  const payload = { op: "pair", code: code.split(".")[1] };
  assert.equal((await f.gateway(agentId, "3".repeat(64), { ...payload, code: "b".repeat(48) })).code, 401);
  f.advance(601000);
  assert.equal((await f.gateway(agentId, "3".repeat(64), payload)).code, 401);
  const g = setup();
  const user = await paired(g);
  assert.equal((await g.gateway(user.agentId, "b".repeat(64), { op: "heartbeat", printers: [] })).code, 401);
  await g.handlers.admin({ admin: true, data: { action: "revoke", agentId: user.agentId } });
  assert.equal((await user.call({ op: "claim", queues: ["Test"] })).code, 401);
  assert.equal(g.db.records.get("printPrinters/" + printerId(user.agentId, "Test")).online, false);
});

test("Dos agentes no reciben el mismo segmento y una reserva previa al envío se puede recuperar", async () => {
  const f = setup(), a = await paired(f), b = await paired(f);
  insertJob(f.db, a.agentId);
  assert.equal((await b.call({ op: "claim", queues: ["Test"] })).data.task, null);
  const get = async () => (await a.call({ op: "claim", queues: ["Test"] })).data.task;
  const prior = await get();
  assert.equal(prior.pages, 120);
  assert.equal(await get(), null);
  f.advance(301000);
  const task = await get();
  assert.notEqual(task.lease, prior.lease);
  assert.equal((await a.call({ ...prior, op: "start" })).code, 409);
  assert.equal((await b.call({ ...task, op: "start" })).code, 409);
  assert.equal((await a.call({ ...task, op: "start" })).code, 200);
  f.advance(600000);
  assert.equal(await get(), null);
  assert.equal((await a.call({ ...task, op: "report", state: "submitted", spoolId: 18 })).code, 200);
  assert.equal((await a.call({ ...task, op: "report", state: "submitted", spoolId: 18 })).code, 200);
  assert.equal(f.db.records.get("printJobs/libro").status, "submitted");
  assert.equal((await a.call({ ...task, op: "report", state: "spoolCompleted" })).code, 200);
  const job = f.db.records.get("printJobs/libro");
  assert.equal(job.status, "confirmation");
  assert.equal(job.parts[0].dispatchState, "spoolCompleted");
  assert.equal(job.accepted, undefined);
  assert.equal(job.inventoried, undefined);
});

test("Un resultado incierto detiene reenvíos y la pausa impide iniciar una reserva", async () => {
  const f = setup(), a = await paired(f);
  insertJob(f.db, a.agentId);
  const task = (await a.call({ op: "claim", queues: ["Test"] })).data.task;
  const job = f.db.records.get("printJobs/libro");
  job.status = "paused";
  assert.equal((await a.call({ ...task, op: "start" })).code, 409);
  job.status = "queued";
  assert.equal((await a.call({ ...task, op: "start" })).code, 200);
  assert.equal((await a.call({ ...task, op: "report", state: "confirmation", reason: "uncertain" })).code, 200);
  f.advance(600000);
  assert.equal((await a.call({ op: "claim", queues: ["Test"] })).data.task, null);
  assert.equal(f.db.records.get("printJobs/libro").status, "confirmation");
});

test("Los documentos de otra ruta y los parámetros de cola inválidos no llegan a CUPS", async () => {
  const f = setup(), a = await paired(f);
  insertJob(f.db, a.agentId);
  f.db.records.get("printJobs/libro").source.path = "otro/privado.pdf";
  assert.equal((await a.call({ op: "claim", queues: ["Test"] })).data.task, null);
  assert.equal(f.db.records.get("printJobs/libro").parts[0].dispatchState, "error");
  assert.equal((await a.call({ op: "heartbeat", printers: [{ queue: "dos colas", paperSizes: [] }] })).code, 400);
});

test("El resumen de tres segmentos cuenta estados sin sumar ejemplares terminados", () => {
  const parts = ["submitted","queued","spoolCompleted"].map((status, i) => ({ status, printerId: "p" + i, id: "i" + i }));
  assert.deepEqual(dispatchIds(parts), ["p1"]);
  assert.equal(eligiblePart(parts, ["p1"], Date.now()).id, "i1");
  assert.equal(rollup(parts), "submitted");
});
