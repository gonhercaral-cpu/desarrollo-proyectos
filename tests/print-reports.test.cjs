"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPrintReportHandlers, _internals } = require("../functions/printReports");

const {
  periodRange, previousPeriod, latestCompletePeriod, scheduleDue, summarizeJobs, jobFaces, matchesFilters,
} = _internals;

class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Firestore mínimo en memoria: consultas por rango + cursor, documentos y transacciones.
function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed));
  const calls = { queries: [] };
  const snap = (path) => ({ id: path.split("/").pop(), exists: store.has(path), data: () => store.get(path) });
  const docRef = (path) => ({
    path,
    get: async () => snap(path),
    create: async (data) => { if (store.has(path)) throw new Error("exists"); store.set(path, data); },
    update: async (data) => { if (!store.has(path)) throw new Error("missing"); store.set(path, { ...store.get(path), ...data }); },
    set: async (data) => { store.set(path, data); },
  });
  const collection = (name) => ({
    doc: (id) => docRef(`${name}/${id}`),
    where(field, op, value) { return query(name, [[field, op, value]]); },
  });
  function query(name, wheres, order = null, max = Infinity, after = null) {
    return {
      where: (f, o, v) => query(name, [...wheres, [f, o, v]], order, max, after),
      orderBy: (f) => query(name, wheres, f, max, after),
      limit: (n) => query(name, wheres, order, n, after),
      select: () => query(name, wheres, order, max, after),
      startAfter: (doc) => query(name, wheres, order, max, doc),
      async get() {
        calls.queries.push({ name, max });
        let docs = [...store.entries()].filter(([path]) => path.startsWith(`${name}/`) && !path.slice(name.length + 1).includes("/"))
          .map(([path, data]) => ({ id: path.split("/").pop(), data: () => data, ref: docRef(path) }));
        for (const [field, op, value] of wheres) {
          docs = docs.filter((d) => {
            const v = d.data()[field];
            const cmp = v instanceof Date ? v.getTime() : v;
            const target = value instanceof Date ? value.getTime() : value;
            return op === ">=" ? cmp >= target : op === "<" ? cmp < target : cmp === target;
          });
        }
        if (order) docs.sort((a, b) => +a.data()[order] - +b.data()[order] || a.id.localeCompare(b.id));
        if (after) {
          const index = docs.findIndex((d) => d.id === after.id);
          docs = docs.slice(index + 1);
        }
        docs = docs.slice(0, max);
        return { docs, empty: docs.length === 0 };
      },
    };
  }
  return {
    store, calls,
    collection,
    doc: (path) => docRef(path),
    runTransaction: async (fn) => fn({
      get: (ref) => ref.get(),
      create: (ref, data) => { if (store.has(ref.path)) throw new Error("exists"); store.set(ref.path, data); },
      update: (ref, data) => store.set(ref.path, { ...store.get(ref.path), ...data }),
    }),
  };
}

const FieldValue = { serverTimestamp: () => "SERVER_TS" };
const NOW = Date.parse("2026-11-26T20:00:00Z"); // jueves 26 nov 2026, 12:00 en Tijuana
const adminActor = { uid: "admin1", name: "Admin", isAdmin: true };

function handlers(db, extra = {}) {
  return createPrintReportHandlers({
    db, FieldValue, HttpsError, now: () => NOW, sleep: async () => {},
    getActor: async () => adminActor, assertAdmin: async () => ({ uid: "admin1" }), ...extra,
  });
}

const day = (iso) => new Date(`${iso}T12:00:00-08:00`);
const job = (over = {}) => ({
  title: "Libro", type: "book", status: "completed", productId: "p1", createdByUid: "u1", createdAt: day("2026-11-10"),
  source: { id: "d1", origin: "local", pages: 10 }, config: { copies: 2, duplex: false },
  parts: [{ id: "a", from: 1, to: 10, copies: 2, printerId: "pr1", status: "completed" }], ...over,
});

test("el periodo en America/Tijuana cubre días calendario completos aun con cambio de horario", () => {
  const spring = periodRange("2026-03-08", "2026-03-08", NOW);
  assert.equal(spring.startMs, Date.parse("2026-03-08T08:00:00Z"));
  assert.equal((spring.endMs - spring.startMs) / 3600000, 23);
  const fall = periodRange("2026-11-01", "2026-11-01", NOW);
  assert.equal((fall.endMs - fall.startMs) / 3600000, 25);
  const multi = periodRange("2026-11-01", "2026-11-10", NOW);
  assert.equal(multi.days, 10);
  assert.equal(multi.endMs, periodRange("2026-11-10", "2026-11-10", NOW).endMs);
});

test("rechaza fechas inexistentes, invertidas, futuras o con rango excesivo", () => {
  assert.throws(() => periodRange("2026-02-30", "2026-03-01", NOW), /fecha/);
  assert.throws(() => periodRange("2026/01/01", "2026-01-02", NOW), /fecha/);
  assert.throws(() => periodRange("2026-05-02", "2026-05-01", NOW), /orden/);
  assert.throws(() => periodRange("2025-01-01", "2026-11-26", NOW), /rango/);
  assert.throws(() => periodRange("2026-11-20", "2026-11-27", NOW), /futuro/);
  assert.doesNotThrow(() => periodRange("2026-11-26", "2026-11-26", NOW));
});

test("el periodo anterior tiene la misma duración y termina el día previo", () => {
  const prior = previousPeriod(periodRange("2026-11-08", "2026-11-14", NOW));
  assert.deepEqual([prior.from, prior.to, prior.days], ["2026-11-01", "2026-11-07", 7]);
  assert.equal(prior.endMs, periodRange("2026-11-08", "2026-11-14", NOW).startMs);
});

test("último periodo completo: ayer, semana lunes-domingo y mes anterior", () => {
  assert.deepEqual(latestCompletePeriod("daily", NOW), { from: "2026-11-25", to: "2026-11-25" });
  assert.deepEqual(latestCompletePeriod("weekly", NOW), { from: "2026-11-16", to: "2026-11-22" });
  assert.deepEqual(latestCompletePeriod("monthly", NOW), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(latestCompletePeriod("monthly", Date.parse("2026-01-05T20:00:00Z")), { from: "2025-12-01", to: "2025-12-31" });
});

test("scheduleDue es determinista y respeta apagado, inicio, ya generado y reintento", () => {
  const base = { enabled: true, frequency: "weekly", notBefore: "2026-11-01", lastPeriodKey: "" };
  assert.equal(scheduleDue(base, NOW).key, "2026-11-16_2026-11-22");
  assert.equal(scheduleDue({ ...base, enabled: false }, NOW), null);
  assert.equal(scheduleDue({ ...base, notBefore: "2026-11-20" }, NOW), null);
  assert.equal(scheduleDue({ ...base, lastPeriodKey: "2026-11-16_2026-11-22" }, NOW), null);
  assert.equal(scheduleDue({ ...base, nextAttemptMs: NOW + 1 }, NOW), null);
  assert.equal(scheduleDue({ ...base, leaseUntilMs: NOW + 1 }, NOW), null);
  assert.equal(scheduleDue({ ...base, frequency: "yearly" }, NOW), null);
});

test("caras solicitadas, hojas dúplex y datos inválidos", () => {
  assert.equal(jobFaces(job()).faces, 20);
  assert.equal(jobFaces(job({ config: { copies: 2, duplex: true } })).sheets, 10);
  assert.equal(jobFaces(job({ parts: [], source: { pages: 5 }, config: { copies: 3 } })).faces, 15);
  assert.equal(jobFaces(job({ parts: [{ from: 4, to: 2, copies: 1 }] })), null);
  assert.equal(jobFaces(job({ parts: [{ from: 1, to: 99, copies: 1 }] })), null);
});

test("lo enviado no se toma como producido: sin confirmación las caras confirmadas son null", () => {
  const out = summarizeJobs([job({ status: "completed" })]);
  assert.equal(out.summary.requestedFaces, 20);
  assert.equal(out.summary.confirmedFaces, null);
  assert.equal(out.summary.accepted, null);
  assert.equal(out.summary.rejectionRate, null);
  assert.equal(out.summary.costTotal, null);
  assert.equal(out.summary.jobsWithoutCost, 1);
});

test("conteos de calidad: aceptadas, rechazadas, inventariadas y tasa de rechazo", () => {
  const out = summarizeJobs([
    job({ accepted: 16, rejected: 4, inventoried: 16, cost: { total: 50 } }),
    job({ accepted: 10, rejected: 0 }),
    job({}),
  ]);
  assert.equal(out.summary.accepted, 26);
  assert.equal(out.summary.rejected, 4);
  assert.equal(out.summary.confirmedFaces, null);
  assert.equal(out.summary.inventoried, 16);
  assert.equal(out.summary.rejectionRate, 0.1333);
  assert.equal(out.summary.costTotal, 50);
  assert.equal(out.summary.jobsWithoutCost, 2);
});

test("los filtros coinciden por tipo, estado, producto e impresora", () => {
  const jobs = [
    job(),
    job({ type: "flyer", productId: "p2", status: "failed", parts: [{ from: 1, to: 10, copies: 1, printerId: "pr2", status: "failed" }] }),
  ];
  assert.equal(matchesFilters(jobs[0], { type: "book", printerId: "pr1" }), true);
  assert.equal(matchesFilters(jobs[1], { type: "book" }), false);
  assert.equal(summarizeJobs(jobs, { status: "failed" }).matchedJobs, 1);
  assert.equal(summarizeJobs(jobs, { productId: "p1" }).matchedJobs, 1);
  const printer = summarizeJobs(jobs, { printerId: "pr2" });
  assert.deepEqual(printer.groups.printer.map((r) => r.key), ["pr2"]);
  assert.equal(printer.groups.printer[0].confirmedFaces, null);
  assert.equal(summarizeJobs(jobs, {}, "books").matchedJobs, 1);
});

test("generate pagina por cursor, compara periodos y es idempotente", async () => {
  const seed = {};
  for (let i = 0; i < 850; i += 1) seed[`printJobs/j${i}`] = job({ createdAt: new Date(day("2026-11-10").getTime() + i * 1000) });
  seed["printJobs/old"] = job({ createdAt: day("2026-11-02") });
  const db = fakeDb(seed);
  const { generate } = handlers(db);
  const input = { requestId: "req-00000001", kind: "production", from: "2026-11-08", to: "2026-11-14" };
  const first = await generate({ data: input });
  assert.equal(first.reused, false);
  assert.equal(first.report.data.summary.jobs, 850);
  assert.equal(first.report.data.previous.summary.jobs, 1);
  assert.equal(first.report.data.comparison.jobs.value, 849);
  assert.ok(db.calls.queries.filter((q) => q.name === "printJobs").length >= 4, "debe leer en varias páginas");
  assert.ok(db.calls.queries.every((q) => q.max <= 400));
  const again = await generate({ data: input });
  assert.equal(again.reused, true);
  assert.equal(again.id, first.id);
  assert.equal(db.store.get(`printReports/${first.id}`).contentSha256, first.report.contentSha256);
  await assert.rejects(generate({ data: { ...input, to: "2026-11-15" } }), { code: "already-exists" });
});

test("generate valida solicitud, tipo, fechas y filtros", async () => {
  const { generate } = handlers(fakeDb());
  const ok = { requestId: "req-00000002", kind: "production", from: "2026-11-01", to: "2026-11-02" };
  await assert.rejects(generate({ data: { ...ok, requestId: "x" } }), { code: "invalid-argument" });
  await assert.rejects(generate({ data: { ...ok, kind: "otro" } }), { code: "invalid-argument" });
  await assert.rejects(generate({ data: { ...ok, to: "2027-01-01" } }), { code: "invalid-argument" });
  await assert.rejects(generate({ data: { ...ok, status: { $ne: 1 } } }), { code: "invalid-argument" });
});

test("generate reintenta errores transitorios de lectura", async () => {
  const db = fakeDb();
  const original = db.collection;
  let failures = 1;
  db.collection = (name) => {
    const collection = original(name);
    if (name !== "printJobs") return collection;
    return { ...collection, where: (...args) => {
      const query = collection.where(...args);
      const wrap = (q) => ({ ...q, get: async () => { if (failures-- > 0) throw Object.assign(new Error("x"), { code: 14 }); return q.get(); },
        where: (...a) => wrap(q.where(...a)), orderBy: (...a) => wrap(q.orderBy(...a)), limit: (...a) => wrap(q.limit(...a)),
        select: (...a) => wrap(q.select(...a)), startAfter: (...a) => wrap(q.startAfter(...a)) });
      return wrap(query);
    } };
  };
  const result = await handlers(db).generate({ data: { requestId: "req-00000003", kind: "production", from: "2026-11-01", to: "2026-11-02" } });
  assert.equal(result.report.data.summary.jobs, 0);
});

test("certificados emitidos usan generatedCertificates, agregados y sin folio ni destinatario", async () => {
  const db = fakeDb({
    "generatedCertificates/c1": { generatedAt: day("2026-11-10"), folio: "FOLIO-SECRETO", recipientName: "Persona Privada", status: "emitido" },
    "generatedCertificates/c2": { generatedAt: day("2026-11-10"), folio: "F2", status: "emitido" },
    "generatedCertificates/c3": { generatedAt: day("2026-11-11"), folio: "F3", deleted: true },
    "generatedCertificates/c4": { generatedAt: day("2026-11-01"), folio: "F4", status: "emitido" },
    "printJobs/j1": job({ source: { origin: "certificate", certificateId: "c1", pages: 2 } }),
  });
  const { report } = await handlers(db).generate({ data: { requestId: "req-00000004", kind: "certificates", from: "2026-11-08", to: "2026-11-14" } });
  assert.equal(report.data.emitted.total, 2);
  assert.equal(report.data.emitted.previousTotal, 1);
  assert.deepEqual(report.data.emitted.byDay, [{ day: "2026-11-10", emitted: 2 }]);
  assert.equal(report.data.printedFromJobs.jobs, 1);
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes("FOLIO-SECRETO") && !serialized.includes("Persona Privada"));
  assert.ok(!/"(certificateId|folio|recipient\w*)"/u.test(serialized));
});

test("schedule queda apagada por omisión, rechaza correos y permite desactivar", async () => {
  const db = fakeDb();
  const { schedule } = handlers(db);
  const base = { action: "save", requestId: "req-00000005", name: "Semanal", kind: "production", frequency: "weekly" };
  const saved = await schedule({ auth: { uid: "admin1" }, data: base });
  assert.equal(saved.enabled, false);
  assert.equal(saved.emailEnabled, false);
  assert.equal(saved.timezone, "America/Tijuana");
  await assert.rejects(schedule({ auth: { uid: "admin1" }, data: { ...base, requestId: "req-00000006", emails: ["a@b.c"] } }), { code: "failed-precondition" });
  await assert.rejects(schedule({ auth: { uid: "admin1" }, data: { ...base, requestId: "req-00000007", timezone: "UTC" } }), { code: "invalid-argument" });
  const enabled = await schedule({ auth: { uid: "admin1" }, data: { ...base, requestId: "req-00000008", scheduleId: saved.id, enabled: true } });
  assert.equal(enabled.notBefore, "2026-11-26");
  const off = await schedule({ auth: { uid: "admin1" }, data: { action: "deactivate", requestId: "req-00000009", scheduleId: saved.id } });
  assert.equal(off.enabled, false);
  assert.equal(db.store.get(`printReportSchedules/${saved.id}`).enabled, false);
});

function seedSchedule(db, id, over = {}) {
  db.store.set(`printReportSchedules/${id}`, {
    enabled: true, name: id, kind: "production", frequency: "weekly", filters: {}, notBefore: "2026-11-01",
    createdByUid: "admin1", notifyCreator: false, lastPeriodKey: "", lastAttemptMs: 0, failureCount: 0, ...over,
  });
}

test("runDue no falla sin programaciones y no ejecuta programaciones apagadas", async () => {
  const db = fakeDb();
  const { runDue } = handlers(db);
  assert.deepEqual(await runDue(), { checked: 0, generated: 0, skipped: 0, failed: 0, deferred: 0, results: [] });
  seedSchedule(db, "off", { enabled: false });
  assert.equal((await runDue()).checked, 0);
});

test("runDue genera una vez por periodo y un fallo no impide las demás programaciones", async () => {
  const db = fakeDb({
    "users/admin1": { active: true, role: "admin" },
    "users/exadmin": { active: true, role: "collaborator" },
  });
  seedSchedule(db, "a-bad", { createdByUid: "exadmin", lastAttemptMs: 1 });
  seedSchedule(db, "b-good", { lastAttemptMs: 2 });
  const { runDue } = handlers(db);
  const first = await runDue();
  assert.equal(first.generated, 1);
  assert.equal(first.failed, 1);
  const bad = db.store.get("printReportSchedules/a-bad");
  assert.equal(bad.failureCount, 1);
  assert.ok(bad.nextAttemptMs > NOW);
  const good = db.store.get("printReportSchedules/b-good");
  assert.equal(good.lastPeriodKey, "2026-11-16_2026-11-22");
  const second = await runDue();
  assert.equal(second.generated, 0);
  assert.equal([...db.store.keys()].filter((k) => k.startsWith("printReports/")).length, 1);
});

test("runDue notifica en la app al creador solo si la programación lo pide y sin duplicar", async () => {
  const db = fakeDb({ "users/admin1": { active: true, role: "admin" } });
  seedSchedule(db, "n1", { notifyCreator: true });
  const calls = [];
  const notifications = { createDeduplicatedNotifications: async (...args) => { calls.push(args); return 1; } };
  await handlers(db, { notifications }).runDue();
  assert.equal(calls.length, 1);
  assert.deepEqual([...calls[0][3]], ["admin1"]);
  assert.match(calls[0][2].deduplicationKey, /^print_report_ready:/);
  await handlers(db, { notifications }).runDue();
  assert.equal(calls.length, 1);
});

function writeEvent(before, after, id = "evt1") {
  const wrap = (data) => ({ exists: Boolean(data), data: () => data });
  return { id, params: { jobId: "job1" }, data: { before: wrap(before), after: wrap(after) } };
}

test("notify solo alerta con estados configurados, al creador activo y sin repetir", async () => {
  const db = fakeDb({
    "users/u1": { active: true },
    "users/u2": { active: false },
    "printSettings/production": { statusAlerts: { enabled: true, statuses: ["failed"] } },
  });
  const { notify } = handlers(db, { notifications: require("../functions/operationalNotifications") });
  const base = job({ status: "queued", createdByUid: "u1", updatedByUid: "admin1" });
  assert.equal((await notify(writeEvent(base, { ...base, status: "completed" }))).sent, 0);
  assert.equal((await notify(writeEvent(base, { ...base }))).reason, "sin-cambio");
  assert.equal((await notify(writeEvent({ ...base, status: "failed" }, { ...base, status: "failed", title: "otro" }))).reason, "sin-cambio");
  assert.equal((await notify(writeEvent(base, { ...base, status: "failed", createdByUid: "u2" }))).reason, "destinatario-inactivo");
  const failed = { ...base, status: "failed" };
  assert.equal((await notify(writeEvent(base, failed))).sent, 1);
  assert.equal((await notify(writeEvent(base, failed))).sent, 0, "el mismo evento reintentado no duplica");
  assert.equal([...db.store.keys()].filter((k) => k.startsWith("notifications/")).length, 1);
  assert.equal((await notify(writeEvent(base, null))).sent, 0);
});

test("notify no envía nada si las alertas no están configuradas explícitamente", async () => {
  const db = fakeDb({ "users/u1": { active: true } });
  const { notify } = handlers(db, { notifications: require("../functions/operationalNotifications") });
  const base = job({ status: "queued" });
  assert.equal((await notify(writeEvent(base, { ...base, status: "failed" }))).reason, "sin-alerta-configurada");
  db.store.set("printSettings/production", { statusAlerts: { enabled: false, statuses: ["failed"] } });
  assert.equal((await notify(writeEvent(base, { ...base, status: "failed" }))).sent, 0);
});

test("cuenta las caras verificadas por tramo sin confundir libros aprobados con páginas", () => {
  const item = job({ accepted: 97, rejected: 3, parts: [
    { from: 1, to: 40, copies: 100, status: "completed", reconcile: { outcome: "printed" } },
    { from: 41, to: 80, copies: 100, status: "submitted" },
  ], source: { pages: 120 } });
  assert.equal(summarizeJobs([item]).summary.confirmedFaces, 4000);
});
