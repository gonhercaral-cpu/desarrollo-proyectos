"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  NOW,
  actors,
  createHarness,
  nextRequestId,
  savePayload,
  seedPrinter,
  seedSource,
} = require("./print-production-fakes.cjs");

const { admin, operator, operator2, outsider } = actors;
const jobPath = (id) => `printJobs/${id}`;
const act = (h, actor, jobId, action, extra = {}) => h.action(actor, {
  jobId, action, requestId: nextRequestId(action), ...extra,
});
const rejects = (promise, code, pattern) => assert.rejects(promise, (error) => {
  assert.equal(error.code, code);
  assert.match(error.message, pattern);
  return true;
});
const eventTypes = (h, id) => h.db.list(`${jobPath(id)}/events`).map((event) => event.type).sort();
const writtenPaths = (h) => h.db.paths().filter((path) => /^(printJobs|printProductionOperations)\//.test(path));

async function createJob(h, overrides = {}, actor = operator) {
  return (await h.save(actor, savePayload(overrides))).jobId;
}

function seedCertificate(h, overrides = {}) {
  seedSource(h.db, "cert-doc", {
    origin: "certificate", certificateId: "cert-1", requestId: "CR-2026-1", folio: "F-100", ...overrides,
  });
}

function seedInventory(db) {
  db.seed("printProducts/prod-1", {
    name: "Manual", category: "Libro", level: "Básico", unit: "Libro", active: true, minStock: 2, idealStock: 20,
  });
  db.seed("printFinishedInventory/inv-1", {
    productId: "prod-1", productName: "Manual", currentStock: 5, minStock: 2, idealStock: 20, active: true, deleted: false,
  });
}

// Trabajo con piezas aprobadas por calidad (el estado físico lo fija el operador, no el sistema).
async function approvedJob(h, { type = "book", copies = 20, accepted = 12, productId = "prod-1" } = {}) {
  const overrides = { type, config: { copies, paper: "Letter" } };
  if (productId) overrides.productId = productId;
  const id = await createJob(h, overrides);
  h.db.patch(jobPath(id), { status: "quality", parts: h.db.read(jobPath(id)).parts.map((p) => ({ ...p, status: "completed" })) });
  await act(h, operator, id, "quality", { accepted });
  return id;
}

async function inFlightJob(h, status = "submitted") {
  const id = await createJob(h);
  const job = h.db.read(jobPath(id));
  h.db.patch(jobPath(id), { status, parts: [{ ...job.parts[0], status }], dispatchPrinterIds: [] });
  return id;
}

describe("save: creación y encolado (caso A)", () => {
  it("crea un trabajo en cola con documento congelado, evento y operación", async () => {
    const h = createHarness();
    seedSource(h.db, "doc-1", { requestId: "CR-77" });
    const payload = savePayload();
    const result = await h.save(operator, payload);
    assert.equal(result.status, "queued");
    assert.equal(result.alreadyApplied, false);
    assert.deepEqual(result.dispatchPrinterIds, ["p-a"]);
    assert.equal(result.parts.length, 1);

    const job = h.db.read(jobPath(result.jobId));
    assert.equal(job.id, result.jobId);
    assert.equal(job.status, "queued");
    assert.equal(job.createdByUid, "op1");
    assert.equal(job.source.pages, 60);
    assert.equal(job.source.sha256, "a".repeat(64));
    assert.deepEqual([job.accepted, job.rejected, job.inventoried], [0, 0, 0]);
    // requestId del trabajo es el del origen del certificado, no la clave de operación.
    assert.equal(job.requestId, "CR-77");
    assert.notEqual(job.requestId, payload.requestId);
    assert.deepEqual(job.parts.map((part) => [part.id, part.printerId, part.from, part.to, part.copies, part.status]),
      [["p1", "p-a", 1, 60, 1, "queued"]]);
    assert.deepEqual(eventTypes(h, result.jobId), ["enqueued"]);
    assert.equal(h.db.paths().filter((path) => path.startsWith("printProductionOperations/")).length, 1);
  });

  it("toma páginas y huella del documento congelado, nunca del cliente", async () => {
    const h = createHarness();
    await rejects(h.save(operator, { ...savePayload(), source: { pages: 1 } }), "invalid-argument", /no permitidos/);
    await rejects(h.save(operator, { ...savePayload(), pages: 1 }), "invalid-argument", /no permitidos/);
    assert.deepEqual(writtenPaths(h), []);
  });

  it("permite borrador sin dispositivos, lo edita y lo envía a cola", async () => {
    const h = createHarness();
    const draft = await h.save(operator, savePayload({ draft: true, printerIds: [] }));
    assert.equal(draft.status, "draft");
    assert.deepEqual(draft.parts, []);
    assert.deepEqual(draft.dispatchPrinterIds, []);

    const submitted = await h.save(operator, savePayload({ jobId: draft.jobId, title: "Título final" }));
    assert.equal(submitted.jobId, draft.jobId);
    assert.equal(submitted.status, "queued");
    assert.deepEqual(submitted.dispatchPrinterIds, ["p-a"]);
    const job = h.db.read(jobPath(draft.jobId));
    assert.equal(job.title, "Título final");
    assert.equal(job.createdByUid, "op1");
    assert.deepEqual(eventTypes(h, draft.jobId), ["draft_created", "draft_submitted"]);
    assert.equal(h.db.list("printJobs").length, 1);

    await rejects(h.save(operator, savePayload({ jobId: draft.jobId })), "failed-precondition", /borrador/);
  });

  it("un borrador con impresoras fuera de línea se guarda sin despacho", async () => {
    const h = createHarness();
    seedPrinter(h.db, "p-off", { lastSeenAt: new Date(NOW - 300000) });
    const draft = await h.save(operator, savePayload({ draft: true, printerIds: ["p-off"] }));
    assert.equal(draft.parts[0].status, "draft");
    assert.deepEqual(draft.dispatchPrinterIds, []);
    await rejects(h.save(operator, savePayload({ printerIds: ["p-off"] })), "failed-precondition", /no está en línea/);
  });

  it("solo quien creó el borrador (o un admin) lo edita", async () => {
    const h = createHarness();
    const draft = await h.save(operator, savePayload({ draft: true, printerIds: [] }));
    await rejects(h.save(operator2, savePayload({ jobId: draft.jobId })), "permission-denied", /creó el borrador/);
    const edited = await h.save(admin, savePayload({ jobId: draft.jobId, draft: true, printerIds: [] }));
    assert.equal(edited.status, "draft");
  });
});

describe("save: modos B y C", () => {
  it("modo páginas valida cobertura exacta y no persiste nada si falla", async () => {
    const h = createHarness();
    const base = { mode: "pages", printerIds: ["p-a", "p-b"] };
    await rejects(h.save(operator, savePayload({
      ...base, parts: [{ printerId: "p-a", from: 1, to: 20 }, { printerId: "p-b", from: 31, to: 60 }],
    })), "invalid-argument", /Faltan las páginas 21-30/);
    assert.deepEqual(writtenPaths(h), []);

    const ok = await h.save(operator, savePayload({
      ...base, parts: [{ printerId: "p-a", from: 1, to: 40 }, { printerId: "p-b", from: 41, to: 60 }],
    }));
    assert.deepEqual(ok.parts.map((part) => [part.printerId, part.from, part.to]), [["p-a", 1, 40], ["p-b", 41, 60]]);
    assert.deepEqual(ok.dispatchPrinterIds, ["p-a", "p-b"]);
  });

  it("modo copias reparte con balance ponderado y cubre todas las copias", async () => {
    const h = createHarness();
    const result = await h.save(operator, savePayload({
      mode: "copies", printerIds: ["p-a", "p-b"], config: { copies: 9, paper: "Letter" },
    }));
    assert.deepEqual(result.parts.map((part) => [part.printerId, part.copies]), [["p-a", 6], ["p-b", 3]]);
    assert.equal(result.parts.reduce((sum, part) => sum + part.copies, 0), 9);
    assert.equal(typeof result.etaMinutes, "number");
  });

  it("modo inteligente usa las impresoras en línea cuando no se eligen", async () => {
    const h = createHarness();
    seedPrinter(h.db, "p-off", { lastSeenAt: new Date(NOW - 300000) });
    const result = await h.save(operator, savePayload({ mode: "smart", printerIds: [] }));
    assert.equal(result.resolvedMode, "pages");
    assert.deepEqual(result.parts.map((part) => [part.printerId, part.from, part.to]), [["p-a", 1, 40], ["p-b", 41, 60]]);
    assert.equal(h.db.read(jobPath(result.jobId)).mode, "smart");
  });

  it("rechaza opciones físicas no soportadas por la impresora", async () => {
    const h = createHarness();
    await rejects(h.save(operator, savePayload({
      config: { copies: 1, paper: "Letter", quality: "high" },
    })), "failed-precondition", /calidad high/);
    assert.deepEqual(writtenPaths(h), []);
  });
});

describe("save: reintentos y fallos (caso E)", () => {
  it("el mismo requestId con el mismo contenido devuelve el resultado sin duplicar", async () => {
    const h = createHarness();
    const payload = savePayload();
    const first = await h.save(operator, payload);
    const second = await h.save(operator, payload);
    assert.equal(second.alreadyApplied, true);
    assert.equal(second.jobId, first.jobId);
    assert.equal(h.db.list("printJobs").length, 1);
    assert.deepEqual(eventTypes(h, first.jobId), ["enqueued"]);
    await rejects(h.save(operator, { ...payload, title: "Otro título" }), "already-exists", /otros datos/);
  });

  it("la operación se acota por usuario y por acción", async () => {
    const h = createHarness();
    seedSource(h.db, "doc-2", { ownerUid: operator2.uid });
    const payload = savePayload();
    const first = await h.save(operator, payload);
    const other = await h.save(operator2, { ...payload, sourceId: "doc-2" });
    assert.notEqual(other.jobId, first.jobId);
    const paused = await h.action(operator, { jobId: first.jobId, action: "pause", requestId: payload.requestId });
    assert.equal(paused.status, "paused");
  });

  it("un commit fallido no deja datos parciales y el reintento funciona", async () => {
    const h = createHarness();
    const payload = savePayload();
    h.db.failNextCommit = true;
    const original = console.error;
    console.error = () => {};
    try {
      await rejects(h.save(operator, payload), "internal", /No se pudo completar/);
    } finally {
      console.error = original;
    }
    assert.deepEqual(writtenPaths(h), []);
    const retry = await h.save(operator, payload);
    assert.equal(retry.alreadyApplied, false);
    assert.equal(h.db.list("printJobs").length, 1);
  });
});

describe("save: seguridad", () => {
  it("rechaza datos desconocidos, requestId ausente y sesión inexistente", async () => {
    const h = createHarness();
    await rejects(h.save(operator, { ...savePayload(), extra: 1 }), "invalid-argument", /no permitidos/);
    await rejects(h.save(operator, savePayload({ config: { copies: 1, paper: "Letter", staple: true } })), "invalid-argument", /no permitidas/);
    await rejects(h.save(operator, savePayload({ requestId: "" })), "invalid-argument", /identificador/);
    await rejects(h.save(operator, savePayload({ draft: "no" })), "invalid-argument", /borrador/);
    await rejects(h.save(null, savePayload()), "unauthenticated", /Inicia sesión/);
    assert.deepEqual(writtenPaths(h), []);
  });

  it("exige acceso a Imprenta y respeta los permisos configurados", async () => {
    const h = createHarness();
    await rejects(h.save(outsider, savePayload()), "permission-denied", /acceso a Imprenta/);
    await h.settings(admin, { permissions: { create: { denyUids: ["op1"] } } });
    await rejects(h.save(operator, savePayload()), "permission-denied", /permiso/);
    seedSource(h.db, "doc-2", { ownerUid: operator2.uid });
    const allowed = await h.save(operator2, savePayload({ sourceId: "doc-2" }));
    assert.equal(allowed.status, "queued");
  });

  it("verifica que el documento sea del usuario y exista", async () => {
    const h = createHarness();
    seedSource(h.db, "doc-ajeno", { ownerUid: "otra-persona" });
    await rejects(h.save(operator, savePayload({ sourceId: "doc-ajeno" })), "permission-denied", /no pertenece/);
    await rejects(h.save(operator, savePayload({ sourceId: "no-existe" })), "not-found", /congelado/);
  });

  it("certificados y credenciales: categoría, interruptores y herencia", async () => {
    const h = createHarness();
    seedCertificate(h);
    seedSource(h.db, "cred-doc", { origin: "credential", credentialId: "cred-1" });
    seedSource(h.db, "legacy-doc", { origin: "legacy-certificate", certificateId: "old-1", legacy: true });

    await rejects(h.save(operator, savePayload({ sourceId: "cert-doc", type: "document" })), "already-exists", /certificado o una credencial/);
    await rejects(h.save(operator, savePayload({ sourceId: "doc-1", type: "certificate" })), "already-exists", /no corresponde a un certificado/);
    await rejects(h.save(operator, savePayload({ sourceId: "cert-doc", type: "certificate" })), "failed-precondition", /no está habilitada/);
    await rejects(h.save(operator, savePayload({ sourceId: "cert-doc", type: "credential" })), "already-exists", /no corresponde a una credencial/);
    assert.deepEqual(writtenPaths(h), []);

    const flags = await h.settings(admin, { certificateEnabled: true });
    assert.equal(flags.settings.certificateEnabled, true);
    assert.equal(flags.settings.credentialEnabled, false);
    const certificate = await h.save(operator, savePayload({ sourceId: "cert-doc", type: "certificate" }));
    const job = h.db.read(jobPath(certificate.jobId));
    assert.equal(job.requestId, "CR-2026-1");
    assert.equal(job.source.certificateId, "cert-1");
    await rejects(h.save(operator, savePayload({ sourceId: "cred-doc", type: "credential" })), "failed-precondition", /credenciales no está habilitada/);
    await rejects(h.save(operator, savePayload({ sourceId: "legacy-doc", type: "certificate" })), "failed-precondition", /heredados/);
    assert.equal(h.db.list("printJobs").length, 1);
  });
});

describe("action: pausa, reanudación y cancelación", () => {
  it("mantiene dispatchPrinterIds al pausar, reanudar y cancelar", async () => {
    const h = createHarness();
    const id = await createJob(h, { mode: "pages", printerIds: ["p-a", "p-b"] });
    assert.deepEqual(h.db.read(jobPath(id)).dispatchPrinterIds, ["p-a", "p-b"]);

    const paused = await act(h, operator2, id, "pause", { reason: "Cambio de tóner" });
    assert.equal(paused.status, "paused");
    assert.deepEqual(h.db.read(jobPath(id)).dispatchPrinterIds, []);
    assert.ok(h.db.read(jobPath(id)).parts.every((part) => part.status === "paused"));

    const resumed = await act(h, operator, id, "resume");
    assert.equal(resumed.status, "queued");
    assert.deepEqual(resumed.dispatchPrinterIds, ["p-a", "p-b"]);

    const cancelled = await act(h, operator, id, "cancel", { reason: "Duplicado" });
    assert.equal(cancelled.status, "cancelled");
    const job = h.db.read(jobPath(id));
    assert.deepEqual(job.dispatchPrinterIds, []);
    assert.ok(job.parts.every((part) => part.status === "cancelled"));
    await rejects(act(h, operator, id, "pause"), "failed-precondition", /en cola/);
    assert.deepEqual(eventTypes(h, id), ["cancelled", "enqueued", "paused", "resumed"]);
  });

  it("cancela un borrador sin partes", async () => {
    const h = createHarness();
    const draft = await h.save(operator, savePayload({ draft: true, printerIds: [] }));
    const result = await act(h, operator, draft.jobId, "cancel");
    assert.equal(result.status, "cancelled");
    assert.deepEqual(result.dispatchPrinterIds, []);
  });

  it("rechaza pausar o cancelar cuando hay partes en vuelo", async () => {
    const h = createHarness();
    const id = await inFlightJob(h, "printing");
    await rejects(act(h, operator, id, "pause"), "failed-precondition", /en impresión/);
    await rejects(act(h, operator, id, "cancel"), "failed-precondition", /en impresión/);
    assert.equal(h.db.read(jobPath(id)).status, "printing");
    assert.equal(h.db.read(jobPath(id)).parts[0].status, "printing");
  });

  it("repetir la misma operación no duplica eventos", async () => {
    const h = createHarness();
    const id = await createJob(h);
    const data = { jobId: id, action: "pause", requestId: "pause-fixed-1" };
    const first = await h.action(operator, data);
    const second = await h.action(operator, data);
    assert.equal(second.alreadyApplied, true);
    assert.equal(second.status, first.status);
    assert.deepEqual(eventTypes(h, id), ["enqueued", "paused"]);
  });

  it("valida acciones y argumentos desconocidos", async () => {
    const h = createHarness();
    const id = await createJob(h);
    await rejects(act(h, operator, id, "explode"), "invalid-argument", /acción solicitada/);
    await rejects(act(h, operator, id, "pause", { foo: 1 }), "invalid-argument", /no permitidos/);
    await rejects(h.action(operator, { jobId: id, action: "pause" }), "invalid-argument", /identificador/);
    await rejects(act(h, operator, "no-existe", "pause"), "not-found", /trabajo/);
    await rejects(act(h, outsider, id, "pause"), "permission-denied", /acceso a Imprenta/);
  });

  it("registra prioridad y notas con auditoría", async () => {
    const h = createHarness();
    const id = await createJob(h);
    await act(h, operator, id, "priority", { priority: "urgent" });
    await act(h, operator, id, "note", { note: "Entregar antes de las 3." });
    const job = h.db.read(jobPath(id));
    assert.equal(job.priority, "urgent");
    assert.equal(job.lastNote, "Entregar antes de las 3.");
    assert.deepEqual(eventTypes(h, id), ["enqueued", "note", "priority_changed"]);
    await rejects(act(h, operator, id, "priority", { priority: "máxima" }), "invalid-argument", /prioridad/);
    await act(h, operator, id, "cancel");
    await rejects(act(h, operator, id, "priority", { priority: "low" }), "failed-precondition", /terminado o cancelado/);
  });
});

describe("action: reimpresión", () => {
  it("crea un borrador vinculado sin emitir de nuevo", async () => {
    const h = createHarness();
    const id = await createJob(h);
    await rejects(act(h, operator, id, "reprint", { reason: "Mancha" }), "failed-precondition", /terminado/);
    h.db.patch(jobPath(id), { status: "quality" });
    await rejects(act(h, operator, id, "reprint"), "invalid-argument", /motivo/);
    await rejects(act(h, operator, id, "reprint", { reason: "Mancha", copies: 5 }), "invalid-argument", /no puede superar/);

    const data = { jobId: id, action: "reprint", requestId: "reprint-fixed-1", reason: "Papel manchado" };
    const result = await h.action(operator2, data);
    assert.equal(result.status, "draft");
    assert.equal(result.reprintOfJobId, id);
    const copy = h.db.read(jobPath(result.jobId));
    assert.equal(copy.status, "draft");
    assert.equal(copy.reprintOfJobId, id);
    assert.equal(copy.reprintReason, "Papel manchado");
    assert.equal(copy.source.sha256, h.db.read(jobPath(id)).source.sha256);
    assert.deepEqual(copy.parts, []);
    assert.deepEqual(copy.dispatchPrinterIds, []);
    assert.equal(copy.createdByUid, "op2");
    assert.equal(h.db.read(jobPath(id)).reprintCount, 1);

    const replay = await h.action(operator2, data);
    assert.equal(replay.alreadyApplied, true);
    assert.equal(replay.jobId, result.jobId);
    assert.equal(h.db.list("printJobs").length, 2);
  });

  it("recarga el vínculo original de un certificado y respeta interruptor e integridad", async () => {
    const h = createHarness();
    seedCertificate(h);
    await h.settings(admin, { certificateEnabled: true });
    const id = await createJob(h, { sourceId: "cert-doc", type: "certificate" });
    h.db.patch(jobPath(id), { status: "completed" });

    const result = await act(h, operator, id, "reprint", { reason: "Tinta clara" });
    const copy = h.db.read(jobPath(result.jobId));
    assert.equal(copy.requestId, "CR-2026-1");
    assert.equal(copy.source.certificateId, "cert-1");
    assert.equal(copy.type, "certificate");
    assert.ok(h.db.paths().every((path) => /^(printJobs|printProductionOperations|printSettings|printPrinters|printDocuments)\//.test(path)));

    h.db.patch("printDocuments/cert-doc", { sha256: "b".repeat(64) });
    await rejects(act(h, operator, id, "reprint", { reason: "Otra vez" }), "already-exists", /cambió/);
    h.db.patch("printDocuments/cert-doc", { sha256: "a".repeat(64) });
    await h.settings(admin, { certificateEnabled: false });
    await rejects(act(h, operator, id, "reprint", { reason: "Otra vez" }), "failed-precondition", /no está habilitada/);
    assert.equal(h.db.list("printJobs").length, 2);
  });
});

describe("action: conciliación física (caso E)", () => {
  const reconcile = (h, actor, id, extra) => act(h, actor, id, "reconcile", { partId: "p1", confirm: true, ...extra });

  it("exige confirmación explícita del operador", async () => {
    const h = createHarness();
    const id = await inFlightJob(h);
    await rejects(act(h, operator, id, "reconcile", { partId: "p1", outcome: "printed" }), "invalid-argument", /Confirma explícitamente/);
    await rejects(reconcile(h, operator, id, { outcome: "printed", confirm: false }), "invalid-argument", /Confirma explícitamente/);
    await rejects(reconcile(h, outsider, id, { outcome: "printed" }), "permission-denied", /acceso a Imprenta/);
    assert.equal(h.db.read(jobPath(id)).parts[0].status, "submitted");
  });

  it("entrega desconocida queda en confirmación y nunca se reintenta sola", async () => {
    const h = createHarness();
    const id = await inFlightJob(h);
    const unknown = await reconcile(h, operator, id, { outcome: "unknown", note: "La cola no responde." });
    assert.equal(unknown.status, "confirmation");
    const job = h.db.read(jobPath(id));
    assert.equal(job.parts[0].status, "confirmation");
    assert.equal(job.parts[0].reconcile.autoRetry, false);
    assert.deepEqual(job.dispatchPrinterIds, []);

    const printed = await reconcile(h, operator, id, { outcome: "printed" });
    assert.equal(printed.status, "quality");
    assert.equal(h.db.read(jobPath(id)).parts[0].status, "completed");
    await rejects(reconcile(h, operator, id, { outcome: "printed" }), "failed-precondition", /Solo se concilian/);
  });

  it("si no salió, reasigna el remanente a una impresora en línea compatible", async () => {
    const h = createHarness();
    const id = await inFlightJob(h);
    const result = await reconcile(h, operator, id, { outcome: "not_printed", reassignPrinterId: "p-b" });
    assert.equal(result.status, "queued");
    assert.deepEqual(result.dispatchPrinterIds, ["p-b"]);
    const [old, replacement] = h.db.read(jobPath(id)).parts;
    assert.equal(old.status, "cancelled");
    assert.equal(old.reassignedTo, "p2");
    assert.deepEqual([replacement.id, replacement.printerId, replacement.status, replacement.replacesPartId, replacement.from, replacement.to],
      ["p2", "p-b", "queued", "p1", 1, 60]);
  });

  it("deja el remanente pendiente y luego permite reasignarlo explícitamente", async () => {
    const h = createHarness();
    const id = await inFlightJob(h);
    const pending = await reconcile(h, operator, id, { outcome: "not_printed" });
    assert.equal(pending.status, "cancelled");
    assert.equal(h.db.read(jobPath(id)).parts[0].pendingRemainder, true);
    assert.deepEqual(pending.dispatchPrinterIds, []);

    const reassigned = await reconcile(h, operator, id, { outcome: "reassign", reassignPrinterId: "p-b" });
    assert.equal(reassigned.status, "queued");
    assert.deepEqual(reassigned.dispatchPrinterIds, ["p-b"]);
    const job = h.db.read(jobPath(id));
    assert.equal(job.parts[0].pendingRemainder, false);
    assert.equal(job.parts.length, 2);
    await rejects(reconcile(h, operator, id, { outcome: "reassign", reassignPrinterId: "p-a" }), "failed-precondition", /remanente pendiente/);
  });

  it("reasigna una parte en cola y rechaza destinos fuera de línea o incompatibles", async () => {
    const h = createHarness();
    seedPrinter(h.db, "p-off", { lastSeenAt: new Date(NOW - 300000) });
    seedPrinter(h.db, "p-mono", { color: false });
    const id = await createJob(h, { config: { copies: 1, paper: "Letter", color: true } });
    await rejects(reconcile(h, operator, id, { outcome: "reassign", reassignPrinterId: "p-off" }), "failed-precondition", /no está en línea/);
    await rejects(reconcile(h, operator, id, { outcome: "reassign", reassignPrinterId: "p-mono" }), "failed-precondition", /no imprime a color/);
    await rejects(reconcile(h, operator, id, { outcome: "reassign", reassignPrinterId: "p-nueva" }), "not-found", /impresora destino/);
    assert.deepEqual(h.db.read(jobPath(id)).dispatchPrinterIds, ["p-a"]);

    const moved = await reconcile(h, operator, id, { outcome: "reassign", reassignPrinterId: "p-b" });
    assert.deepEqual(moved.dispatchPrinterIds, ["p-b"]);
    assert.equal(h.db.read(jobPath(id)).parts[0].reassignedFromPrinterId, "p-a");
  });
});

describe("action: calidad", () => {
  it("soporta 97 aprobadas + 3 rechazadas y la reposición posterior", async () => {
    const h = createHarness();
    const id = await createJob(h, { config: { copies: 100, paper: "Letter" } });
    await rejects(act(h, operator, id, "quality", { accepted: 1 }), "failed-precondition", /confirmación/);
    h.db.patch(jobPath(id), { status: "quality", parts: h.db.read(jobPath(id)).parts.map((p) => ({ ...p, status: "completed" })) });
    await rejects(act(h, operator, id, "quality", { rejected: 3 }), "invalid-argument", /motivo del rechazo/);
    await rejects(act(h, operator, id, "quality", {}), "invalid-argument", /al menos una pieza/);

    const first = await act(h, operator, id, "quality", { accepted: 97, rejected: 3, notes: "Manchas de tóner" });
    assert.equal(first.status, "partial");
    assert.deepEqual([first.accepted, first.rejected, first.pendingUnits], [97, 3, 3]);

    await rejects(act(h, operator, id, "quality", { accepted: 4 }), "invalid-argument", /superarían/);
    assert.equal(h.db.read(jobPath(id)).accepted, 97);

    const second = await act(h, operator, id, "quality", { accepted: 3 });
    assert.equal(second.status, "completed");
    assert.deepEqual([second.accepted, second.rejected, second.pendingUnits], [100, 3, 0]);
    await rejects(act(h, operator, id, "quality", { accepted: 1 }), "failed-precondition", /confirmación, calidad o parcial/);
    assert.deepEqual(eventTypes(h, id), ["enqueued", "quality_reviewed", "quality_reviewed"]);
  });

  it("acumula revisiones parciales y no duplica al repetir la operación", async () => {
    const h = createHarness();
    const id = await createJob(h, { config: { copies: 100, paper: "Letter" } });
    h.db.patch(jobPath(id), { status: "quality", parts: h.db.read(jobPath(id)).parts.map((p) => ({ ...p, status: "completed" })) });
    const data = { jobId: id, action: "quality", requestId: "quality-fixed-1", accepted: 50 };
    const first = await h.action(operator, data);
    assert.equal(first.status, "quality");
    const replay = await h.action(operator, data);
    assert.equal(replay.alreadyApplied, true);
    assert.equal(h.db.read(jobPath(id)).accepted, 50);
    const next = await act(h, operator, id, "quality", { accepted: 20 });
    assert.equal(next.accepted, 70);
  });
});

describe("action: inventario", () => {
  it("restringe el ingreso a administradores salvo permiso explícito", async () => {
    const h = createHarness();
    seedInventory(h.db);
    const id = await approvedJob(h);
    await rejects(act(h, operator, id, "inventory"), "permission-denied", /permiso/);
    await h.settings(admin, { permissions: { inventory: { operator: true } } });
    const result = await act(h, operator, id, "inventory", { quantity: 2 });
    assert.equal(result.quantity, 2);
    await h.settings(admin, { permissions: { inventory: null } });
    await rejects(act(h, operator, id, "inventory", { quantity: 1 }), "permission-denied", /permiso/);
  });

  it("transfiere solo unidades aprobadas pendientes, de forma idempotente", async () => {
    const h = createHarness();
    seedInventory(h.db);
    const id = await approvedJob(h, { copies: 20, accepted: 12 });
    const data = { jobId: id, action: "inventory", requestId: "inventory-fixed-1", quantity: 5 };
    const first = await h.action(admin, data);
    assert.equal(first.delivery, "inventory");
    assert.deepEqual([first.previousStock, first.newStock, first.pendingUnits], [5, 10, 7]);
    const movement = h.db.read(`printInventoryMovements/${first.movementId}`);
    assert.equal(movement.type, "Entrada");
    assert.equal(movement.quantity, 5);
    assert.equal(movement.jobId, id);
    assert.equal(movement.inventoryId, "inv-1");
    assert.equal(h.db.read("printFinishedInventory/inv-1").currentStock, 10);
    assert.equal(h.db.read(jobPath(id)).inventoried, 5);

    const replay = await h.action(admin, data);
    assert.equal(replay.alreadyApplied, true);
    assert.equal(h.db.read("printFinishedInventory/inv-1").currentStock, 10);
    assert.equal(h.db.list("printInventoryMovements").length, 1);
    await rejects(h.action(admin, { ...data, quantity: 6 }), "already-exists", /otros datos/);

    await rejects(act(h, admin, id, "inventory", { quantity: 8 }), "invalid-argument", /Solo hay 7/);
    const rest = await act(h, admin, id, "inventory");
    assert.equal(rest.quantity, 7);
    assert.equal(h.db.read("printFinishedInventory/inv-1").currentStock, 17);
    await rejects(act(h, admin, id, "inventory"), "failed-precondition", /No hay unidades aprobadas/);
  });

  it("no ingresa nada sin producto o con producto inactivo", async () => {
    const h = createHarness();
    seedInventory(h.db);
    const id = await approvedJob(h, { productId: null });
    await rejects(act(h, admin, id, "inventory", { delivery: "inventory" }), "failed-precondition", /producto de inventario/);
    const withProduct = await approvedJob(h);
    h.db.patch("printProducts/prod-1", { active: false });
    await rejects(act(h, admin, withProduct, "inventory"), "not-found", /producto activo/);
    assert.equal(h.db.list("printInventoryMovements").length, 0);
  });

  it("los trabajos personalizados se entregan directo por defecto", async () => {
    const h = createHarness();
    seedInventory(h.db);
    const id = await approvedJob(h, { type: "personalized", copies: 3, accepted: 3, productId: null });
    await rejects(act(h, admin, id, "inventory", { delivery: "inventory" }), "failed-precondition", /entrega directa/);
    const result = await act(h, admin, id, "inventory");
    assert.equal(result.delivery, "direct");
    assert.equal(result.delivered, 3);
    assert.equal(h.db.list("printInventoryMovements").length, 0);
    assert.equal(h.db.read("printFinishedInventory/inv-1").currentStock, 5);
    await rejects(act(h, admin, id, "inventory"), "failed-precondition", /No hay unidades aprobadas/);
  });
});

describe("action: consumo de insumos", () => {
  function seedSupplies(db) {
    db.seed("printSupplyItems/toner-1", { name: "Tóner negro", category: "Tóner", currentStock: 10, stockUnit: "Pieza", active: true });
    db.seed("printSupplyItems/paper-1", { name: "Papel Letter", category: "Papel", currentStock: 3, stockUnit: "Paquete", active: true });
  }

  it("descuenta insumos reales con movimiento ligado al trabajo, una sola vez", async () => {
    const h = createHarness();
    seedSupplies(h.db);
    const id = await createJob(h);
    await rejects(act(h, operator, id, "consume", { supplies: [{ supplyId: "toner-1", quantity: 1 }] }), "permission-denied", /permiso/);

    const data = {
      jobId: id,
      action: "consume",
      requestId: "consume-fixed-1",
      supplies: [{ supplyId: "toner-1", quantity: 2 }, { supplyId: "paper-1", quantity: 1 }],
    };
    const result = await h.action(admin, data);
    assert.equal(result.supplies.length, 2);
    assert.equal(h.db.read("printSupplyItems/toner-1").currentStock, 8);
    assert.equal(h.db.read("printSupplyItems/paper-1").currentStock, 2);
    const movement = h.db.read(`printSupplyMovements/${result.supplies[0].movementId}`);
    assert.deepEqual([movement.type, movement.relatedType, movement.relatedId, movement.previousStock, movement.newStock],
      ["Salida", "Trabajo de impresión", id, 10, 8]);

    const replay = await h.action(admin, data);
    assert.equal(replay.alreadyApplied, true);
    assert.equal(h.db.read("printSupplyItems/toner-1").currentStock, 8);
    assert.equal(h.db.list("printSupplyMovements").length, 2);
  });

  it("si falta stock de un insumo no se descuenta ninguno", async () => {
    const h = createHarness();
    seedSupplies(h.db);
    const id = await createJob(h);
    await rejects(act(h, admin, id, "consume", {
      supplies: [{ supplyId: "toner-1", quantity: 1 }, { supplyId: "paper-1", quantity: 5 }],
    }), "failed-precondition", /Stock insuficiente/);
    assert.equal(h.db.read("printSupplyItems/toner-1").currentStock, 10);
    assert.equal(h.db.list("printSupplyMovements").length, 0);
    await rejects(act(h, admin, id, "consume", {
      supplies: [{ supplyId: "toner-1", quantity: 1 }, { supplyId: "toner-1", quantity: 1 }],
    }), "invalid-argument", /repetidos/);
    await rejects(act(h, admin, id, "consume", { supplies: [{ supplyId: "nada", quantity: 1 }] }), "not-found", /insumo/);
  });

  it("un borrador no consume insumos", async () => {
    const h = createHarness();
    seedSupplies(h.db);
    const draft = await h.save(operator, savePayload({ draft: true, printerIds: [] }));
    await rejects(act(h, admin, draft.jobId, "consume", { supplies: [{ supplyId: "toner-1", quantity: 1 }] }), "failed-precondition", /borrador/);
  });
});

describe("settings", () => {
  it("solo un administrador puede cambiar la configuración", async () => {
    const h = createHarness();
    await rejects(h.settings(operator, { certificateEnabled: true }), "permission-denied", /administrador/);
    await rejects(h.settings(null, { certificateEnabled: true }), "unauthenticated", /Inicia sesión/);
    assert.equal(h.db.read("printSettings/production"), undefined);
  });

  it("rechaza claves y valores fuera de la lista permitida", async () => {
    const h = createHarness();
    await rejects(h.settings(admin, {}), "invalid-argument", /No hay cambios/);
    await rejects(h.settings(admin, { enabled: true }), "invalid-argument", /no permitidos/);
    await rejects(h.settings(admin, { certificateEnabled: "si" }), "invalid-argument", /verdadero o falso/);
    await rejects(h.settings(admin, { defaults: { foo: 1 } }), "invalid-argument", /no permitidos/);
    await rejects(h.settings(admin, { defaults: { copies: 0 } }), "invalid-argument", /copias/);
    await rejects(h.settings(admin, { defaults: { mode: "magia" } }), "invalid-argument", /modo/);
    await rejects(h.settings(admin, { permissions: { billing: { operator: true } } }), "invalid-argument", /no permitidos/);
    await rejects(h.settings(admin, { permissions: { inventory: { root: true } } }), "invalid-argument", /no permitidos/);
    await rejects(h.settings(admin, { permissions: { inventory: { allowUids: ["u1"], denyUids: ["u1"] } } }), "invalid-argument", /permitida y bloqueada/);
    assert.equal(h.db.read("printSettings/production"), undefined);
  });

  it("no escribe los interruptores gestionados de forma incidental y audita los cambios", async () => {
    const h = createHarness();
    const defaults = await h.settings(admin, { defaults: { paper: "Letter", copies: 2, mode: "smart" } });
    assert.equal(defaults.settings.certificateEnabled, false);
    const stored = h.db.read("printSettings/production");
    assert.equal("certificateEnabled" in stored, false);
    assert.equal("credentialEnabled" in stored, false);
    assert.deepEqual(stored.defaults, { paper: "Letter", copies: 2, mode: "smart" });

    await h.settings(admin, { certificateEnabled: true });
    await h.settings(admin, { defaults: { copies: null } });
    const after = h.db.read("printSettings/production");
    assert.equal(after.certificateEnabled, true);
    assert.equal("credentialEnabled" in after, false);
    assert.deepEqual(after.defaults, { paper: "Letter", mode: "smart" });

    const events = h.db.list("printSettings/production/events");
    assert.equal(events.length, 3);
    const toggle = events.find((event) => event.details.changed.includes("certificateEnabled"));
    assert.equal(toggle.byUid, "admin1");
    assert.equal(toggle.details.before.certificateEnabled, null);
    assert.equal(toggle.details.after.certificateEnabled, true);
  });

  it("los valores predeterminados completan la configuración de save", async () => {
    const h = createHarness();
    await h.settings(admin, { defaults: { paper: "Letter", copies: 2, mode: "smart" } });
    const result = await h.save(operator, { ...savePayload(), config: {}, mode: undefined, printerIds: [] });
    const job = h.db.read(jobPath(result.jobId));
    assert.equal(job.mode, "smart");
    assert.equal(job.config.copies, 2);
    assert.equal(job.config.paper, "Letter");
    assert.equal(result.resolvedMode, "copies");
  });

  it("es idempotente con requestId y detecta reutilización con otros datos", async () => {
    const h = createHarness();
    const data = { requestId: "settings-fixed-1", certificateEnabled: true };
    await h.settings(admin, data);
    const replay = await h.settings(admin, data);
    assert.equal(replay.alreadyApplied, true);
    assert.equal(h.db.list("printSettings/production/events").length, 1);
    await rejects(h.settings(admin, { ...data, certificateEnabled: false }), "already-exists", /otros datos/);
  });
});
