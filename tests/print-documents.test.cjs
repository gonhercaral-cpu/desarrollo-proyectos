"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { randomUUID } = require("node:crypto");
const fromFunctions = createRequire(resolve(__dirname, "../functions/package.json"));
const { PDFDocument } = fromFunctions("pdf-lib");
const jpeg = fromFunctions("jpeg-js");
const QRCode = require("qrcode");
const { createFreezePrintDocument, storedCertificatePath, verifyCredentialPdf, inspectPdf, driveBytes } =
  require("../functions/printDocuments");

async function pdfBytes(pages) {
  const document = await PDFDocument.create();
  for (let i = 0; i < pages; i++) document.addPage();
  return Buffer.from(await document.save());
}

function fixture() {
  const data = new Map();
  const files = new Map();
  const snap = (path) => ({ exists: data.has(path), data: () => data.get(path) });
  const ref = (path) => ({ path, get: async () => snap(path) });
  const db = {
    doc: ref, collection: (name) => ({ doc: (id) => ref(name + "/" + id) }),
    runTransaction: async (callback) => callback({
      get: (reference) => reference.get(),
      getAll: (...refs) => Promise.all(refs.map((r) => r.get())),
      create: (reference, value) => {
        assert.equal(data.has(reference.path), false);
        data.set(reference.path, value);
      },
    }),
  };
  const bucket = {
    name: "example.test",
    file: (name, options = {}) => ({
      name, exists: async () => [files.has(name)],
      async getMetadata() {
        if (!files.has(name)) throw Object.assign(new Error(), { code: 404 });
        return [{ size: files.get(name).length, generation: "17" }];
      },
      async download() {
        assert.equal(options.generation, "17");
        return [files.get(name)];
      },
      async save(bytes, opts) {
        assert.equal(opts.preconditionOpts.ifGenerationMatch, 0);
        if (files.has(name)) throw Object.assign(new Error(), { code: 412 });
        assert.equal(opts.metadata.cacheControl, "private, no-store");
        files.set(name, bytes);
      },
      async delete() { files.delete(name); },
    }),
  };
  const getActor = async (input) => {
    assert.ok(input.auth?.uid);
    return { uid: input.auth.uid, canAccessPrintshop: true, isAdmin: input.auth.uid === "admin" };
  };
  const run = createFreezePrintDocument({ db, bucket, getActor });
  const call = (params, uid = "operator") => run({ auth: { uid }, data: { operationId: randomUUID(), ...params } });
  return { data, files, call, db, bucket, getActor };
}

test("congela páginas reales y registra una sola copia en reintentos", async () => {
  const { call, files, data } = fixture();
  const uploadId = randomUUID();
  const source = "printStaging/operator/" + uploadId + ".pdf";
  const original = await pdfBytes(120);
  files.set(source, original);
  const args = { origin: "local", operationId: randomUUID(), uploadId, name: "Libro.pdf", pages: 9 };
  const first = await call(args);
  assert.equal(first.pages, 120);
  assert.equal(first.size, original.length);
  assert.equal(first.ownerUid, "operator");
  assert.equal(files.has(source), false);
  assert.deepEqual(files.get(first.path), original);
  assert.deepEqual(await call(args), first);
  assert.equal([...data.keys()].filter((key) => key.startsWith("printDocuments/")).length, 1);
  await assert.rejects(call({ ...args, uploadId: randomUUID() }), { code: "already-exists" });
  await assert.rejects(call({ ...args }, "other"), { code: "not-found" });
});

test("certificado conserva solicitud, folio y bytes originales después de cambiar el origen", async () => {
  const { call, files, data } = fixture();
  const path = "printshop/generated-certificates/solicitud/2026/ABC.pdf";
  const certificate = { requestId: "solicitud", folio: "F-1", validationCode: "ABC", pdfStoragePath: path };
  data.set("generatedCertificates/ABC", certificate);
  const bytes = await pdfBytes(1);
  files.set(path, bytes);
  const params = { origin: "certificate", certificateId: "ABC", operationId: randomUUID() };
  await assert.rejects(call(params), { code: "failed-precondition" });
  data.set("printSettings/production", { certificateEnabled: true });
  const frozen = await call(params);
  files.set(path, await pdfBytes(3));
  assert.deepEqual(await call(params), frozen);
  assert.deepEqual(files.get(frozen.path), bytes);
  assert.deepEqual(data.get("generatedCertificates/ABC"), certificate);
  assert.equal(frozen.folio, certificate.folio);
  assert.equal(frozen.validationCode, certificate.validationCode);
  assert.equal(frozen.requestId, certificate.requestId);
  assert.equal(frozen.certificateId, "ABC");
  assert.deepEqual([...data.keys()].filter((k) => /Inventory|publicCertificate|printRequests/.test(k)), []);
});

test("rechaza rutas ajenas, referencias HTTP arbitrarias y bytes sin PDF", async () => {
  const invalid = [
    { requestId: "one", pdfStoragePath: "printshop/generated-certificates/two/2026/ABC.pdf" },
    { requestId: "one", pdfUrl: "https://external.test/certificate.pdf" },
    { requestId: "one", pdfUrl: "https://firebasestorage.googleapis.com/v0/b/other.test/o/file" },
  ];
  for (const record of invalid) {
    assert.throws(() => storedCertificatePath(record, "example.test"), { code: "failed-precondition" });
  }
  await assert.rejects(inspectPdf(Buffer.from("no es PDF")), { code: "invalid-argument" });
  await assert.rejects(inspectPdf(Buffer.from("%PDF-1.7 broken")), { code: "invalid-argument" });
});

test("Nube AS usa dominio del proyecto, sesión del operador y solo el PDF entregado", async (t) => {
  const oldProject = process.env.GCLOUD_PROJECT;
  process.env.GCLOUD_PROJECT = "demo-print-tests";
  t.after(() => {
    if (oldProject === undefined) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = oldProject;
  });
  const bytes = await pdfBytes(2);
  const req = { rawRequest: { headers: { authorization: "Bearer emulator-test-value" } } };
  const readDrive = (request, id) => driveBytes(request, id, async (url, options) => {
    assert.match(url, /demo-print-tests/);
    assert.match(url, /driveFileContent\?fileId=drive-123$/);
    assert.equal(options.headers.Authorization, req.rawRequest.headers.authorization);
    assert.equal(options.redirect, "error");
    return new Response(bytes, { headers: { "Content-Type": "application/pdf", "X-Nube-File-Name": "Guia.pdf" } });
  });
  const { db, bucket, files, getActor } = fixture();
  const freeze = createFreezePrintDocument({ db, bucket, getActor, readDrive });
  const source = await freeze({ ...req, auth: { uid: "operator" },
    data: { origin: "drive", driveFileId: "drive-123", operationId: randomUUID() } });
  assert.deepEqual(files.get(source.path), bytes);
  assert.equal(source.driveFileId, "drive-123");
  assert.equal(source.pages, 2);
  assert.equal(source.name, "Guia.pdf");
  await assert.rejects(driveBytes(req, "drive-123", async () => new Response(null, { status: 403 })), { code: "permission-denied" });
});

async function cardWithQr(validationUrl) {
  const qr = QRCode.create(validationUrl).modules;
  const scale = 5;
  const width = (qr.size + 8) * scale;
  const rgba = Buffer.alloc(width * width * 4, 255);
  for (let y = 0; y < qr.size * scale; ++y) {
    for (let x = 0; x < qr.size * scale; ++x) {
      if (qr.get(Math.floor(y / scale), Math.floor(x / scale))) {
        const pos = ((y + scale * 4) * width + x + scale * 4) * 4;
        rgba.fill(0, pos, pos + 3);
      }
    }
  }
  const document = await PDFDocument.create();
  document.addPage();
  const reverse = document.addPage();
  const image = await document.embedJpg(Uint8Array.from(jpeg.encode({ data: rgba, width, height: width }, 92).data));
  reverse.drawImage(image);
  return Buffer.from(await document.save());
}

test("vincula credencial una vez, verifica QR del reverso y permite reutilizar copia exacta", async () => {
  const { call, files, data } = fixture();
  const url = "https://school.test/c/42";
  const bytes = await cardWithQr(url);
  const { pdf } = await inspectPdf(bytes);
  assert.throws(() => verifyCredentialPdf(pdf, url + "-otro"), { code: "failed-precondition" });
  const record = { folio: "42", validationCode: "42", generatedByUid: "operator", validationUrl: url };
  data.set("generatedCredentials/id", record);
  data.set("printSettings/production", { credentialEnabled: true });
  const uploadId = randomUUID();
  const params = { origin: "credential", credentialId: "id", uploadId };
  files.set("printStaging/operator/" + uploadId + ".pdf", bytes);
  await assert.rejects(call(params, "other"), { code: "permission-denied" });
  const first = await call(params);
  const again = await call({ origin: "credential", credentialId: "id" }, "other");
  assert.equal(first.sha256, again.sha256);
  assert.deepEqual(files.get(again.path), bytes);
  assert.deepEqual(data.get("generatedCredentials/id"), record);
});

test("purga únicamente cargas temporales vencidas y condiciona la eliminación a la generación", async () => {
  const { purgePrintStaging } = require("../functions/printDocuments");
  const deleted = [];
  let cursor;
  const now = Date.parse("2026-01-03T12:00:00Z");
  function candidate(name, timeCreated) {
    return { name, metadata: { timeCreated, generation: "12" },
      delete: async (options) => { assert.equal(options.ifGenerationMatch, "12"); deleted.push(name); } };
  }
  const fakeDb = { doc: () => ({ get: async () => ({ data: () => ({ pageToken: "cursor-one" }) }),
    set: (value) => { cursor = value.pageToken; } }) };
  const bucket = { getFiles: async (options) => {
    assert.equal(options.prefix, "printStaging/");
    assert.equal(options.pageToken, "cursor-one");
    return [[candidate("printStaging/a/old.pdf", "2026-01-01"),
      candidate("printStaging/b/current.pdf", "2026-01-03"),
      candidate("printDocuments/user/immutable.pdf", "2025-12-20")], { pageToken: "cursor-two" }];
  } };
  await purgePrintStaging({ bucket, db: fakeDb, now });
  assert.deepEqual(deleted, ["printStaging/a/old.pdf"]);
  assert.equal(cursor, "cursor-two");
});

test("permiso de creación se valida antes de acceder al PDF personal o a la carga", async () => {
  const { call, data } = fixture();
  data.set("printSettings/production", { certificateEnabled: true, permissions: { create: { denyUids: ["operator"] } } });
  await assert.rejects(call({ origin: "certificate", certificateId: "ejemplo" }), { code: "permission-denied" });
  await assert.rejects(call({ origin: "local", uploadId: randomUUID() }), { code: "permission-denied" });
});
