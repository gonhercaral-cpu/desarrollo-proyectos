"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  buildConfig,
  computeDispatchPrinterIds,
  deriveJobStatus,
  normalizePrinter,
  planDistribution,
  selectOnlinePrinters,
  validateConfigFields,
} = require("../functions/printDistribution");

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);

function printer(id, { caps = {}, ...rest } = {}) {
  return normalizePrinter(id, {
    agentId: `agent-${id}`,
    queue: `queue-${id}`,
    online: true,
    color: true,
    duplex: true,
    paperSizes: ["Letter"],
    lastSeenAt: new Date(NOW - 5000),
    capabilities: { pagesPerMinute: 40, pageRange: true, ...caps },
    ...rest,
  });
}

const cfg = (overrides = {}) => buildConfig({}, { paper: "Letter", ...overrides });
const fails = (code, pattern) => (error) => error.code === code && pattern.test(error.message);
const shape = (plan) => plan.parts.map((part) => [part.printerId, part.from, part.to, part.copies]);

describe("impresoras en línea", () => {
  it("solo toma impresoras con latido de hasta 120 s, agente y cola", () => {
    const base = { online: true, agentId: "ag", queue: "q" };
    const printers = [
      normalizePrinter("fresca", { ...base, lastSeenAt: NOW - 5000 }),
      normalizePrinter("limite", { ...base, lastSeenAt: NOW - 120000 }),
      normalizePrinter("vieja", { ...base, lastSeenAt: NOW - 120001 }),
      normalizePrinter("apagada", { ...base, online: false, lastSeenAt: NOW }),
      normalizePrinter("sin-cola", { ...base, queue: "", lastSeenAt: NOW }),
      normalizePrinter("sin-agente", { ...base, agentId: "", lastSeenAt: NOW }),
      normalizePrinter("sin-latido", base),
      normalizePrinter("eliminada", { ...base, deleted: true, lastSeenAt: NOW }),
    ];
    assert.deepEqual(selectOnlinePrinters(printers, NOW).map((item) => item.id), ["fresca", "limite"]);
  });

  it("acepta Timestamp de Firestore en el latido", () => {
    const stamp = { toMillis: () => NOW - 1000 };
    const item = normalizePrinter("p", { online: true, agentId: "a", queue: "q", lastSeenAt: stamp });
    assert.equal(selectOnlinePrinters([item], NOW).length, 1);
  });
});

describe("caso A: impresión individual", () => {
  it("elige la impresora que termina antes según velocidad y cola", () => {
    const slow = printer("a", { caps: { pagesPerMinute: 20 } });
    const fast = printer("b", { caps: { pagesPerMinute: 40 } });
    const plan = planDistribution({ mode: "single", config: cfg(), pages: 60, printers: [slow, fast] });
    assert.deepEqual(shape(plan), [["b", 1, 60, 1]]);
    assert.equal(plan.etaMinutes, 2);
    assert.equal(plan.resolvedMode, "single");

    const busy = printer("c", { caps: { pagesPerMinute: 40, queuedPages: 400 } });
    const idle = printer("d", { caps: { pagesPerMinute: 40 } });
    const second = planDistribution({ mode: "single", config: cfg(), pages: 60, printers: [busy, idle] });
    assert.equal(second.parts[0].printerId, "d");
  });

  it("rechaza una impresora elegida que no soporta el color", () => {
    const mono = printer("a", { color: false });
    assert.throws(
      () => planDistribution({ mode: "single", config: cfg({ color: true }), pages: 10, printers: [mono], explicit: true }),
      fails("failed-precondition", /no imprime a color/),
    );
  });

  it("si ninguna impresora automática es compatible, avisa", () => {
    const mono = printer("a", { color: false });
    assert.throws(
      () => planDistribution({ mode: "single", config: cfg({ color: true }), pages: 10, printers: [mono] }),
      fails("failed-precondition", /Ninguna impresora/),
    );
  });

  it("el modo individual no admite varias impresoras elegidas ni partes", () => {
    assert.throws(
      () => planDistribution({ mode: "single", config: cfg(), pages: 10, printers: [printer("a"), printer("b")], explicit: true }),
      fails("invalid-argument", /una sola impresora/),
    );
    assert.throws(
      () => planDistribution({
        mode: "single", config: cfg(), pages: 10, printers: [printer("a")], explicit: true,
        parts: [{ printerId: "a", from: 1, to: 10 }],
      }),
      fails("invalid-argument", /no admite partes/),
    );
  });
});

describe("caso B: reparto por páginas", () => {
  const two = [printer("a"), printer("b")];
  const manual = (parts, overrides = {}, printers = two) => planDistribution({
    mode: "pages", config: cfg(overrides), pages: 60, printers, explicit: true, parts,
  });

  it("acepta rangos exactos sin huecos ni traslapes", () => {
    const plan = manual([{ printerId: "b", from: 31, to: 60 }, { printerId: "a", from: 1, to: 30 }]);
    assert.deepEqual(shape(plan), [["a", 1, 30, 1], ["b", 31, 60, 1]]);
  });

  it("rechaza huecos, traslapes y páginas finales faltantes", () => {
    assert.throws(
      () => manual([{ printerId: "a", from: 1, to: 20 }, { printerId: "b", from: 31, to: 60 }]),
      fails("invalid-argument", /Faltan las páginas 21-30/),
    );
    assert.throws(
      () => manual([{ printerId: "a", from: 1, to: 30 }, { printerId: "b", from: 25, to: 60 }]),
      fails("invalid-argument", /se traslapa/),
    );
    assert.throws(
      () => manual([{ printerId: "a", from: 1, to: 50 }]),
      fails("invalid-argument", /Faltan las páginas 51-60/),
    );
    assert.throws(
      () => manual([{ printerId: "a", from: 5, to: 60 }]),
      fails("invalid-argument", /Faltan las páginas 1-4/),
    );
  });

  it("en doble cara no parte una hoja entre dos impresoras", () => {
    const plan = manual([{ printerId: "a", from: 1, to: 30 }, { printerId: "b", from: 31, to: 60 }], { duplex: true });
    assert.equal(plan.parts.length, 2);
    assert.throws(
      () => manual([{ printerId: "a", from: 1, to: 29 }, { printerId: "b", from: 30, to: 60 }], { duplex: true }),
      fails("invalid-argument", /parte una hoja/),
    );
  });

  it("en folleto los cortes caen en múltiplos de 4 y exige capacidad de folleto", () => {
    const booklets = [printer("a", { caps: { booklet: true } }), printer("b", { caps: { booklet: true } })];
    const options = { duplex: true, layout: "booklet" };
    const plan = manual([{ printerId: "a", from: 1, to: 28 }, { printerId: "b", from: 29, to: 60 }], options, booklets);
    assert.equal(plan.parts.length, 2);
    assert.throws(
      () => manual([{ printerId: "a", from: 1, to: 30 }, { printerId: "b", from: 31, to: 60 }], options, booklets),
      fails("invalid-argument", /parte una hoja de 4/),
    );
    assert.throws(
      () => manual([{ printerId: "a", from: 1, to: 28 }, { printerId: "b", from: 29, to: 60 }], options),
      fails("failed-precondition", /formato folleto/),
    );
  });

  it("reparte automáticamente con balance ponderado por velocidad y es determinista", () => {
    const input = {
      mode: "pages",
      config: cfg({ duplex: true }),
      pages: 60,
      printers: [printer("b", { caps: { pagesPerMinute: 20 } }), printer("a", { caps: { pagesPerMinute: 40 } })],
    };
    const plan = planDistribution(input);
    assert.deepEqual(shape(plan), [["a", 1, 40, 1], ["b", 41, 60, 1]]);
    assert.equal(plan.etaMinutes, 1);
    assert.deepEqual(planDistribution({ ...input, printers: [...input.printers].reverse() }), plan);
  });

  it("rechaza rangos si la impresora no declara soporte de rango de páginas", () => {
    const noRange = [printer("a", { caps: { pageRange: false } }), printer("b", { caps: { pageRange: false } })];
    assert.throws(
      () => manual([{ printerId: "a", from: 1, to: 30 }, { printerId: "b", from: 31, to: 60 }], {}, noRange),
      fails("failed-precondition", /rangos de páginas/),
    );
  });

  it("las opciones físicas no soportadas se rechazan y los acabados son solo instrucciones", () => {
    assert.throws(
      () => planDistribution({
        mode: "single", config: cfg({ quality: "high" }), pages: 10, printers: [printer("a")], explicit: true,
      }),
      fails("failed-precondition", /calidad high/),
    );
    const capable = printer("a", { caps: { quality: ["high"] } });
    const plan = planDistribution({
      mode: "single", config: cfg({ quality: "high", finishing: ["Engrapar"] }), pages: 10, printers: [capable], explicit: true,
    });
    assert.equal(plan.parts.length, 1);
    assert.deepEqual(validateConfigFields({ finishing: ["Engrapar", "Engrapar"] }).finishing, ["Engrapar"]);
  });
});

describe("caso C: reparto por copias", () => {
  const two = [printer("a"), printer("b")];
  const manual = (parts, copies = 10) => planDistribution({
    mode: "copies", config: cfg({ copies }), pages: 10, printers: two, explicit: true, parts,
  });

  it("exige cobertura completa de copias", () => {
    assert.deepEqual(shape(manual([{ printerId: "a", copies: 6 }, { printerId: "b", copies: 4 }])), [["a", 1, 10, 6], ["b", 1, 10, 4]]);
    assert.throws(
      () => manual([{ printerId: "a", copies: 6 }, { printerId: "b", copies: 3 }]),
      fails("invalid-argument", /Faltan 1 copias/),
    );
    assert.throws(
      () => manual([{ printerId: "a", copies: 6 }, { printerId: "b", copies: 5 }]),
      fails("invalid-argument", /superan las solicitadas/),
    );
    assert.throws(
      () => manual([{ printerId: "a", copies: 5 }, { printerId: "a", copies: 5 }]),
      fails("invalid-argument", /solo puede aparecer una vez/),
    );
    assert.throws(
      () => manual([{ printerId: "a", copies: 10, from: 1, to: 5 }]),
      fails("invalid-argument", /documento completo/),
    );
  });

  it("reparte copias de forma balanceada según capacidad", () => {
    const plan = planDistribution({
      mode: "copies",
      config: cfg({ copies: 9 }),
      pages: 10,
      printers: [printer("a", { caps: { pagesPerMinute: 30 } }), printer("b", { caps: { pagesPerMinute: 10 } })],
    });
    assert.deepEqual(shape(plan), [["a", 1, 10, 7], ["b", 1, 10, 2]]);
    assert.equal(plan.parts.reduce((sum, part) => sum + part.copies, 0), 9);
    assert.equal(plan.etaMinutes, 3);
  });

  it("evita una impresora con cola larga", () => {
    const plan = planDistribution({
      mode: "copies",
      config: cfg({ copies: 4 }),
      pages: 10,
      printers: [printer("a", { caps: { queuedPages: 4000 } }), printer("b")],
    });
    assert.deepEqual(shape(plan), [["b", 1, 10, 4]]);
  });
});

describe("modo inteligente y límites", () => {
  const pair = [printer("a"), printer("b")];

  it("elige copias, páginas o una sola impresora según el trabajo", () => {
    const smart = (config, pages, printers = pair) => planDistribution({ mode: "smart", config, pages, printers });
    assert.equal(smart(cfg({ copies: 6 }), 10).resolvedMode, "copies");
    assert.equal(smart(cfg({ copies: 1 }), 60).resolvedMode, "pages");
    assert.equal(smart(cfg({ copies: 1 }), 1).resolvedMode, "single");
    const mono = [printer("a"), printer("b", { color: false })];
    const plan = smart(cfg({ copies: 6, color: true }), 10, mono);
    assert.equal(plan.resolvedMode, "single");
    assert.equal(plan.parts[0].printerId, "a");
  });

  it("limita a 30 dispositivos", () => {
    const many = Array.from({ length: 31 }, (_, index) => printer(`p${String(index).padStart(2, "0")}`));
    assert.throws(
      () => planDistribution({ mode: "copies", config: cfg({ copies: 40 }), pages: 5, printers: many }),
      fails("invalid-argument", /máximo 30/),
    );
    const thirty = many.slice(0, 30);
    const plan = planDistribution({ mode: "copies", config: cfg({ copies: 60 }), pages: 5, printers: thirty });
    assert.equal(plan.parts.length, 30);
  });
});

describe("configuración", () => {
  it("rechaza opciones desconocidas y valores fuera de rango", () => {
    assert.throws(() => validateConfigFields({ staple: true }), fails("invalid-argument", /no permitidas: staple/));
    assert.throws(() => validateConfigFields({ copies: 0 }), fails("invalid-argument", /copias/));
    assert.throws(() => validateConfigFields({ copies: "2" }), fails("invalid-argument", /copias/));
    assert.throws(() => validateConfigFields({ quality: "ultra" }), fails("invalid-argument", /calidad/));
    assert.throws(() => validateConfigFields("x"), fails("invalid-argument", /no es válida/));
  });

  it("exige papel y coherencia del folleto", () => {
    assert.throws(() => buildConfig({}, {}), fails("invalid-argument", /papel/));
    assert.throws(() => cfg({ layout: "booklet" }), fails("invalid-argument", /doble cara/));
    assert.equal(cfg().quality, "normal");
  });
});

describe("estado y despacho", () => {
  const parts = [
    { id: "p1", printerId: "b", status: "queued" },
    { id: "p2", printerId: "a", status: "queued" },
    { id: "p3", printerId: "a", status: "queued" },
    { id: "p4", printerId: "c", status: "printing" },
  ];

  it("despacha solo partes en cola, sin duplicar impresoras", () => {
    assert.deepEqual(computeDispatchPrinterIds("queued", parts), ["a", "b"]);
    assert.deepEqual(computeDispatchPrinterIds("printing", parts), ["a", "b"]);
  });

  it("queda vacío en pausa, borrador, cancelado y completado", () => {
    for (const status of ["paused", "draft", "cancelled", "completed"]) {
      assert.deepEqual(computeDispatchPrinterIds(status, parts), []);
    }
  });

  it("deriva el estado sin asumir impresión física", () => {
    const part = (status) => ({ status });
    assert.equal(deriveJobStatus([]), null);
    assert.equal(deriveJobStatus([part("queued"), part("printing")]), "printing");
    assert.equal(deriveJobStatus([part("queued"), part("confirmation")]), "confirmation");
    assert.equal(deriveJobStatus([part("paused"), part("completed")]), "paused");
    assert.equal(deriveJobStatus([part("completed"), part("completed")]), "quality");
    assert.equal(deriveJobStatus([part("completed"), part("cancelled")]), "partial");
    assert.equal(deriveJobStatus([part("cancelled")]), "cancelled");
    assert.equal(deriveJobStatus([part("cancelled")], { accepted: 3 }), "partial");
  });
});
