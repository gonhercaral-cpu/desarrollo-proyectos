"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createHarness, actors, savePayload, seedPrinter, seedSource, nextRequestId, NOW } = require("./print-production-fakes.cjs");

const group = { id: "libros", name: "Producción de libros", printerIds: ["p-a", "p-b"] };
const general = { id: "general", name: "General", groupId: "libros", mode: "copies", enabled: true };
const book = { ...general, id: "tiraje", name: "Tiraje de libros", type: "book", mode: "pages",
  minPages: 80, maxPages: 120, minCopies: 5, maxCopies: 110, priority: "high",
  paper: "Letter", mediaType: "Plain", color: "color", finishing: "Engrapado", minSpeed: 30, maxQueue: 2 };

function fixtures() {
  const h = createHarness();
  seedSource(h.db, "doc-1", { pages: 120 });
  for (const id of ["p-a", "p-b", "p-c"]) {
    seedPrinter(h.db, id);
    h.db.patch("printPrinters/" + id, { color: true, duplex: true, paperSizes: ["Letter"],
      telemetry: { queuedJobs: 1 }, lastSeenAt: new Date(NOW),
      capabilities: { pagesPerMinute: 40, pageRange: true, mediaTypes: ["Plain"], maxCopies: 999 } });
  }
  return h;
}

test("elige la primera regla, limita selección y ofrece vista previa sin crear trabajos", async () => {
  const h = fixtures();
  await h.settings(actors.admin, { routing: { revision: 0, groups: [group], rules: [book, general] } });
  const payload = savePayload({ type: "book", config: { copies: 10, paper: "Letter", mediaType: "Plain",
    priority: "high", finishing: ["Engrapado"], color: true, duplex: true }, mode: "single", printerIds: [] });
  const preview = await h.save(actors.operator, { ...payload, preview: true });
  assert.equal(preview.route.ruleId, "tiraje");
  assert.equal(preview.resolvedMode, "pages");
  assert.equal(h.db.list("printJobs").length, 0);
  assert.deepEqual(preview.parts.map((p) => [p.from, p.to, p.copies]), [[1, 60, 10], [61, 120, 10]]);
  await assert.rejects(h.save(actors.operator, { ...payload, printerIds: ["p-c"] }), /fuera de la regla/);
  const ready = await h.save(actors.operator, { ...payload, planToken: preview.planToken });
  assert.equal(h.db.read("printJobs/" + ready.jobId).route.ruleId, "tiraje");
});

test("excluye telemetría sin dato, espera nueva confirmación y protege cambios concurrentes", async () => {
  const h = fixtures();
  await h.settings(actors.admin, { routing: { revision: 0, groups: [group], rules: [{ ...general, maxQueue: 2 }] } });
  const payload = savePayload({ type: "book", mode: "smart", printerIds: [] });
  const preview = await h.save(actors.operator, { ...payload, preview: true });
  h.db.patch("printPrinters/p-a", { telemetry: { queuedJobs: null } });
  const next = await h.save(actors.operator, { ...payload, preview: true });
  assert.deepEqual(next.parts.map((part) => part.printerId), ["p-b"]);
  await assert.rejects(h.save(actors.operator, { ...payload, planToken: preview.planToken }), /distribución cambió/);
  await assert.rejects(h.settings(actors.admin, { routing: { revision: 0, groups: [group], rules: [] } }), { code: "aborted" });
  await assert.rejects(h.settings(actors.operator, { routing: { revision: 1, groups: [], rules: [] } }), { code: "permission-denied" });
  await assert.rejects(h.settings(actors.admin, { routing: { revision: 1, groups: [], rules: [general] } }), /grupo existente/);
  await assert.rejects(h.settings(actors.admin, { routing: { revision: 1, groups: [group], rules: [{ ...general, minPages: 30, maxPages: 20 }] } }), /mínimo/);
  assert.equal(h.db.read("printSettings/production").certificateEnabled, undefined);
  assert.equal(h.db.read("printSettings/production").credentialEnabled, undefined);
  const fallback = await h.save(actors.operator, { ...payload, requestId: nextRequestId("draft"), draft: true });
  assert.equal(fallback.status, "draft");
});

test("las operaciones creadas con la versión anterior conservan su huella de idempotencia", async () => {
  const h = fixtures();
  const payload = savePayload();
  const digest = (text) => createHash("sha256").update(text).digest("hex");
  const oldInput = {
    config: { color: false, copies: 1, duplex: false, paper: "Letter" },
    draft: false, jobId: null, mode: "single", parts: [], printerIds: ["p-a"], productId: null,
    requestId: payload.requestId, sourceId: "doc-1", title: "Manual de práctica", type: "document",
  };
  const operation = digest([actors.operator.uid, "save", payload.requestId].join("\n")).slice(0, 48);
  h.db.seed("printProductionOperations/op-" + operation, {
    fingerprint: digest(JSON.stringify(oldInput)), result: { jobId: "original-1" },
  });
  const result = await h.save(actors.operator, payload);
  assert.equal(result.jobId, "original-1");
  assert.equal(result.alreadyApplied, true);
  assert.equal(h.db.list("printJobs").length, 0);
});
