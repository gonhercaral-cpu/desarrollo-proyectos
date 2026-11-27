"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  actors,
  createHarness,
  nextRequestId,
  savePayload,
  seedSource,
} = require("./print-production-fakes.cjs");
const { matchInventoryRule } = require("../functions/printProduction");

const { admin, operator } = actors;
const jobPath = (id) => `printJobs/${id}`;
const movements = (h) => h.db.list("printInventoryMovements");
const stock = (h) => h.db.read("printFinishedInventory/inv-1").currentStock;
const rule = (overrides = {}) => ({
  id: "r1", productId: "prod-1", type: "book", classification: "inventory", automatic: true,
  warehouse: "Mostrador", sku: "LIB-001", ...overrides,
});
const rejects = (promise, code, pattern) => assert.rejects(promise, (error) => {
  assert.equal(error.code, code);
  assert.match(error.message, pattern);
  return true;
});

function setup(rules = [], { type = "book", copies = 100 } = {}) {
  const h = createHarness();
  h.db.seed("printProducts/prod-1", { name: "Manual", category: "Libro", active: true });
  h.db.seed("printFinishedInventory/inv-1", {
    productId: "prod-1", productName: "Manual", currentStock: 5, active: true, deleted: false,
  });
  h.db.seed("printSettings/production", { certificateEnabled: true, inventoryRules: rules });
  seedSource(h.db, "cert-doc", { origin: "certificate", certificateId: "cert-1", requestId: "CR-1" });
  return { h, type, copies };
}

async function readyJob({ h, type, copies }) {
  const overrides = { type, productId: "prod-1", config: { copies, paper: "Letter" } };
  if (type === "certificate") overrides.sourceId = "cert-doc";
  const { jobId } = await h.save(operator, savePayload(overrides));
  const job = h.db.read(jobPath(jobId));
  h.db.patch(jobPath(jobId), { status: "quality", parts: job.parts.map((part) => ({ ...part, status: "completed" })) });
  return jobId;
}

const quality = (h, jobId, extra = {}, actor = operator, requestId = nextRequestId("quality")) => h.action(actor, {
  jobId, action: "quality", requestId, accepted: 1, ...extra,
});

describe("inventario automático por calidad", () => {
  it("no ingresa nada sin regla: la entrega directa es el valor por omisión", async () => {
    const ctx = setup();
    const jobId = await readyJob(ctx);
    const result = await quality(ctx.h, jobId, { accepted: 10 });
    assert.equal(result.inventoryAuto.status, "off");
    assert.equal(movements(ctx.h).length, 0);
    assert.equal(stock(ctx.h), 5);
    assert.equal(result.inventoryPending, 10);
  });

  it("ignora reglas desactivadas o clasificadas como directas, internas o administrativas", async () => {
    for (const overrides of [{ automatic: false }, { classification: "internal", automatic: false },
      { classification: "administrative", automatic: false }, { classification: "noninventory", automatic: false }]) {
      const ctx = setup([rule(overrides)]);
      const jobId = await readyJob(ctx);
      await quality(ctx.h, jobId, { accepted: 10 });
      assert.equal(movements(ctx.h).length, 0);
    }
  });

  it("97 + 3 aprobaciones generan exactamente dos movimientos, una vez cada uno", async () => {
    const ctx = setup([rule()]);
    const { h } = ctx;
    const jobId = await readyJob(ctx);
    const first = await quality(h, jobId, { accepted: 97 }, operator, "quality-fixed-0001");
    await quality(h, jobId, { accepted: 3 }, operator, "quality-fixed-0002");
    const replay = await quality(h, jobId, { accepted: 97 }, operator, "quality-fixed-0001");

    assert.equal(first.inventoryAuto.status, "done");
    assert.equal(replay.alreadyApplied, true);
    const list = movements(h);
    assert.deepEqual(list.map((m) => m.quantity).sort((a, b) => a - b), [3, 97]);
    assert.ok(list.every((m) => m.automatic === true && m.type === "Entrada"));
    assert.equal(stock(h), 105);
    const job = h.db.read(jobPath(jobId));
    assert.equal(job.inventoried, 100);
    assert.equal(job.status, "completed");
    assert.equal(job.inventorySync.status, "done");
  });

  it("registra por separado destino operativo y SKU en el movimiento y en el trabajo, sin stock por almacén", async () => {
    const ctx = setup([rule()]);
    const jobId = await readyJob(ctx);
    await quality(ctx.h, jobId, { accepted: 4 });
    const [movement] = movements(ctx.h);
    assert.equal(movement.warehouse, "Mostrador");
    assert.equal(movement.sku, "LIB-001");
    assert.equal(movement.ruleId, "r1");
    const job = ctx.h.db.read(jobPath(jobId));
    assert.equal(job.inventoryWarehouse, "Mostrador");
    assert.equal(job.inventorySku, "LIB-001");
    assert.equal(ctx.h.db.list("printWarehouses").length, 0);
    assert.equal(ctx.h.db.list("printFinishedInventory").length, 1);
  });

  it("el operador con permiso de calidad no puede cambiar destino ni cantidades", async () => {
    const ctx = setup([rule()]);
    const jobId = await readyJob(ctx);
    await rejects(quality(ctx.h, jobId, { warehouse: "Otro" }), "invalid-argument", /no permitidos/);
    await rejects(quality(ctx.h, jobId, { sku: "X", quantity: 99 }), "invalid-argument", /no permitidos/);
    assert.equal(movements(ctx.h).length, 0);
  });

  it("la entrega directa elegida por el usuario omite el ingreso y deja las unidades pendientes", async () => {
    const ctx = setup([rule()]);
    const jobId = await readyJob(ctx);
    const result = await quality(ctx.h, jobId, { accepted: 10, delivery: "direct" });
    assert.equal(result.inventoryAuto.status, "skipped");
    assert.equal(movements(ctx.h).length, 0);
    const manual = await ctx.h.action(admin, {
      jobId, action: "inventory", requestId: nextRequestId("inv"), delivery: "direct",
    });
    assert.equal(manual.delivered, 10);
    await rejects(quality(ctx.h, jobId, { accepted: 1, delivery: "inventory" }), "invalid-argument", /destino/);
  });

  it("una discrepancia no bloquea la calidad: queda pendiente y se reintenta a mano sin duplicar", async () => {
    const ctx = setup([rule()]);
    const { h } = ctx;
    const jobId = await readyJob(ctx);
    h.db.patch("printProducts/prod-1", { active: false });
    const result = await quality(h, jobId, { accepted: 10 });
    assert.equal(result.inventoryAuto.status, "discrepancy");
    assert.equal(result.accepted, 10);
    assert.equal(movements(h).length, 0);
    const job = h.db.read(jobPath(jobId));
    assert.equal(job.inventorySync.status, "discrepancy");
    assert.match(job.inventorySync.reason, /producto/);

    h.db.patch("printProducts/prod-1", { active: true });
    // El operador no tiene permiso de inventario por omisión: el reintento lo hace quien lo tenga.
    await rejects(h.action(operator, { jobId, action: "inventory", requestId: nextRequestId("inv") }),
      "permission-denied", /permiso/);
    const retry = await h.action(admin, { jobId, action: "inventory", requestId: nextRequestId("inv") });
    assert.equal(retry.quantity, 10);
    assert.equal(movements(h).length, 1);
    assert.equal(h.db.read(jobPath(jobId)).inventorySync.status, "done");
    await rejects(h.action(admin, { jobId, action: "inventory", requestId: nextRequestId("inv") }),
      "failed-precondition", /No hay unidades/);
    assert.equal(stock(h), 15);
  });

  it("detecta stock inválido o registros duplicados como discrepancia", async () => {
    const bad = setup([rule()]);
    bad.h.db.patch("printFinishedInventory/inv-1", { currentStock: "mucho" });
    const badJob = await readyJob(bad);
    assert.equal((await quality(bad.h, badJob)).inventoryAuto.status, "discrepancy");

    const dup = setup([rule()]);
    dup.h.db.seed("printFinishedInventory/inv-2", { productId: "prod-1", currentStock: 1, active: true });
    const dupJob = await readyJob(dup);
    assert.equal((await quality(dup.h, dupJob)).inventoryAuto.status, "discrepancy");
    assert.equal(movements(dup.h).length, 0);
  });
});

describe("certificados y credenciales", () => {
  it("una regla por tipo nunca ingresa documentos personalizados", async () => {
    const ctx = setup([], { type: "certificate", copies: 5 });
    // Se siembra directamente una regla de tipo sin producto, que la validación nunca permitiría.
    ctx.h.db.patch("printSettings/production", {
      inventoryRules: [rule({ id: "r2", productId: "", type: "certificate" })],
    });
    const jobId = await readyJob(ctx);
    await quality(ctx.h, jobId, { accepted: 5 });
    assert.equal(movements(ctx.h).length, 0);
    await rejects(ctx.h.action(admin, {
      jobId, action: "inventory", requestId: nextRequestId("inv"), delivery: "inventory",
    }), "failed-precondition", /entrega directa/);
  });

  it("solo una regla explícita del producto autoriza el ingreso del tipo personalizado", async () => {
    const ctx = setup([rule({ type: "certificate" })], { type: "certificate", copies: 5 });
    const jobId = await readyJob(ctx);
    const result = await quality(ctx.h, jobId, { accepted: 5 });
    assert.equal(result.inventoryAuto.status, "done");
    assert.equal(movements(ctx.h).length, 1);
  });

  it("la validación rechaza reglas de certificado sin producto", async () => {
    const { h } = setup();
    await rejects(h.settings(admin, {
      requestId: nextRequestId("set"), inventoryRules: [rule({ type: "credential", productId: "" })],
    }), "invalid-argument", /explícita de producto/);
  });
});

describe("configuración de reglas", () => {
  it("solo un administrador las actualiza y queda auditado", async () => {
    const { h } = setup();
    await rejects(h.settings(operator, { requestId: nextRequestId("set"), inventoryRules: [rule()] }),
      "permission-denied", /administrador/);
    const result = await h.settings(admin, { requestId: nextRequestId("set"), inventoryRules: [rule()] });
    assert.deepEqual(result.settings.inventoryRules, [rule()]);
    assert.deepEqual(h.db.read("printSettings/production").inventoryRules, [rule()]);
    const events = h.db.list("printSettings/production/events");
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].details.changed, ["inventoryRules"]);
    assert.equal(events[0].byUid, admin.uid);
  });

  it("valida integridad: tipos, claves, duplicados y automatismo sin clasificación de inventario", async () => {
    const { h } = setup([]);
    const send = (inventoryRules) => h.settings(admin, { requestId: nextRequestId("set"), inventoryRules });
    await rejects(send([rule({ type: "otro" })]), "invalid-argument", /tipo/);
    await rejects(send([rule({ classification: "magia" })]), "invalid-argument", /clasificación/);
    await rejects(send([rule({ classification: "direct" })]), "invalid-argument", /automáticas/);
    await rejects(send([rule({ automatic: "si" })]), "invalid-argument", /automáticamente/);
    await rejects(send([{ ...rule(), stock: 10 }]), "invalid-argument", /no permitidos/);
    await rejects(send([rule(), rule({ id: "r2" })]), "invalid-argument", /repetidas/);
    await rejects(send([rule(), rule({ productId: "otro" })]), "invalid-argument", /repetidas/);
    await rejects(send("todo"), "invalid-argument", /reglas/);
    assert.deepEqual(h.db.read("printSettings/production").inventoryRules, []);
  });

  it("la regla del producto tiene prioridad sobre la regla del tipo", () => {
    const settings = { inventoryRules: [rule({ id: "tipo", productId: "" }), rule({ id: "prod" })] };
    assert.equal(matchInventoryRule(settings, { type: "book", productId: "prod-1" }).id, "prod");
    assert.equal(matchInventoryRule(settings, { type: "book", productId: "otro" }).id, "tipo");
    assert.equal(matchInventoryRule(settings, { type: "flyer", productId: "prod-1" }), null);
  });
});
