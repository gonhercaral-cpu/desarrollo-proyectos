"use strict";

const { createHash } = require("node:crypto");
const { PDFDocument, PDFDict, PDFName, PDFRawStream } = require("pdf-lib");
const { canDo, readSettings } = require("./printProduction");
const jpeg = require("jpeg-js");
const jsQR = require("jsqr");
const { HttpsError } = require("firebase-functions/v2/https");

const MAX_BYTES = 32 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code, message) => { throw new HttpsError(code, message); };

function validId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 300
    && !/[\p{Cc}/]/u.test(value) && value !== "." && value !== "..";
}

function fileName(value) {
  return (String(value || "").split(/[\\/]/u).pop() || "Documento.pdf")
    .replace(/[\p{Cc}]/gu, "").trim().slice(0, 180) || "Documento.pdf";
}

function checkedSize(size) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_BYTES) {
    fail("invalid-argument", "El PDF debe contener entre 1 byte y 32 MB.");
  }
}

async function inspectPdf(bytes) {
  checkedSize(bytes.length);
  if (!bytes.subarray(0, 8).toString("ascii").startsWith("%PDF-")) {
    fail("invalid-argument", "El documento debe ser un PDF válido.");
  }
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
    const pages = pdf.getPages().length;
    if (pages < 1 || pages > 10000) throw new Error("pages");
    return { pdf, pages, sha256: digest(bytes) };
  } catch {
    fail("invalid-argument", "El PDF está dañado, protegido o fuera del límite de 10 000 páginas.");
  }
}

// The existing credential renderer embeds the entire reverse side as one JPEG.
// Only accept the issued card's own validation URL when binding its first PDF.
function verifyCredentialPdf(pdf, validationUrl) {
  if (pdf.getPageCount() !== 2 || !validationUrl) {
    fail("failed-precondition", "Se requiere el PDF original de frente y reverso con su QR.");
  }
  const images = pdf.getPages()[1].node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (images && images.keys().length <= 8) {
    for (const [, value] of images.entries()) {
      const image = pdf.context.lookup(value);
      if (!(image instanceof PDFRawStream) || image.dict.get(PDFName.of("Filter"))?.toString() !== "/DCTDecode") continue;
      try {
        const pixels = jpeg.decode(image.getContents(), {
          maxResolutionInMP: 8, maxMemoryUsageInMB: 160, useTArray: true,
        });
        if (jsQR(pixels.data, pixels.width, pixels.height)?.data === validationUrl) return;
      } catch {
        // Unreadable image; another image may contain the QR.
      }
    }
  }
  fail("failed-precondition", "El QR del reverso debe coincidir con el de la credencial emitida.");
}

function storedCertificatePath(record, bucketName) {
  let path = record.pdfStoragePath || record.certificateStoragePath || "";
  if (!path && record.pdfUrl) {
    try {
      const url = new URL(record.pdfUrl);
      const match = /^\/v0\/b\/([^/]+)\/o\/(.+)$/u.exec(url.pathname);
      if (url.protocol === "https:" && url.hostname === "firebasestorage.googleapis.com"
        && match?.[1] === bucketName) path = decodeURIComponent(match[2]);
    } catch { /* Fall through to operator recovery. */ }
  }
  const parts = String(path).split("/");
  const folder = parts.length === 5 ? parts[2] : "";
  const year = parts.at(-2);
  const name = parts.at(-1);
  const safeSegment = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-zA-Z0-9_-]+/gu, "-").replace(/-+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 120);
  const matchesRequest = record.requestId ? folder === safeSegment(record.requestId)
    : record.generationMode === "individual" && /^(individual-\d+|standalone)$/u.test(folder);
  if (parts[0] !== "printshop" || parts[1] !== "generated-certificates"
    || !(parts.length === 4 || (parts.length === 5 && matchesRequest))
    || !/^\d{4}$/u.test(year) || !/^[^/\\\p{Cc}]+\.pdf$/iu.test(name)) {
    fail("failed-precondition", "Recupera el PDF definitivo desde el historial de certificados antes de imprimir.");
  }
  return path;
}

async function storageBytes(bucket, path) {
  let metadata;
  try { [metadata] = await bucket.file(path).getMetadata(); }
  catch (error) {
    if (Number(error.code) === 404) fail("not-found", "El documento original ya no está disponible.");
    throw error;
  }
  checkedSize(Number(metadata.size));
  const [bytes] = await bucket.file(path, { generation: metadata.generation }).download({ decompress: false });
  checkedSize(bytes.length);
  return { bytes, sourceGeneration: String(metadata.generation) };
}

// The Drive service owns the per-folder ACL. Forward the caller's verified ID
// token only to that same project's fixed endpoint. Never accept a URL from UI.
async function driveBytes(request, driveId, fetchContent = fetch) {
  const project = process.env.GCLOUD_PROJECT;
  if (!project || !/^[a-z0-9-]+$/u.test(project)) fail("internal", "No se pudo determinar el proyecto de Nube AS.");
  const base = process.env.FUNCTIONS_EMULATOR === "true"
    ? `http://127.0.0.1:5001/${project}/us-central1/driveFileContent`
    : `https://us-central1-${project}.cloudfunctions.net/driveFileContent`;
  const authorization = request.rawRequest?.headers?.authorization;
  if (!authorization) fail("unauthenticated", "Inicia sesión para importar desde Nube AS.");
  const response = await fetchContent(`${base}?fileId=${encodeURIComponent(driveId)}`, {
    headers: { Authorization: authorization }, redirect: "error", signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) {
    const code = ({ 401: "unauthenticated", 403: "permission-denied", 404: "not-found" })[response.status] || "unavailable";
    fail(code, "Nube AS no pudo entregar este documento con tu sesión.");
  }
  if (response.headers.get("content-type")?.split(";")[0] !== "application/pdf") {
    await response.body?.cancel();
    fail("invalid-argument", "Selecciona un archivo PDF en Nube AS.");
  }
  const expected = Number(response.headers.get("content-length"));
  if (expected > MAX_BYTES) {
    await response.body.cancel();
    checkedSize(expected);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    checkedSize(size);
    chunks.push(Buffer.from(chunk));
  }
  checkedSize(size);
  const name = decodeURIComponent(response.headers.get("x-nube-file-name") || "Documento.pdf");
  return { bytes: Buffer.concat(chunks, size), name: fileName(name), driveFileId: driveId };
}

async function saveOnce(file, bytes) {
  try {
    await file.save(bytes, { resumable: false, validation: "crc32c",
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: "application/pdf", cacheControl: "private, no-store" },
    });
    return true;
  } catch (error) {
    if (Number(error.code) === 412) return false;
    throw error;
  }
}

function createFreezePrintDocument({ db, bucket, getActor, readDrive = driveBytes }) {
  return async (request) => {
    const actor = await getActor(request);
    const { origin, certificateId, credentialId, driveFileId, uploadId, operationId } = request.data || {};
    if (!UUID.test(operationId) || !["local", "drive", "certificate", "credential"].includes(origin)) {
      fail("invalid-argument", "La fuente del archivo o la operación no son válidas.");
    }
    const uid = actor.uid;
    const personal = origin === "certificate" || origin === "credential";
    const recordId = origin === "certificate" ? certificateId : credentialId;
    if (personal && !validId(recordId)) fail("invalid-argument", "Selecciona un documento ya emitido.");
    if (origin === "drive" && !/^[a-zA-Z0-9_-]{1,255}$/u.test(driveFileId || "")) fail("invalid-argument", "Archivo de Nube AS inválido.");
    if ((origin === "local" || uploadId != null) && !UUID.test(uploadId)) fail("invalid-argument", "Carga temporal inválida.");
    const settings = readSettings(await db.doc("printSettings/production").get());
    if (!canDo(actor, settings, "create")) fail("permission-denied", "No tienes permiso para preparar documentos de impresión.");
    if (personal && settings[origin + "Enabled"] !== true) {
      fail("failed-precondition", "La impresión gestionada de este documento está desactivada.");
    }
    const key = digest(JSON.stringify([uid, operationId]));
    const operation = db.doc("printDocumentOperations/" + key);
    const fingerprint = JSON.stringify([origin, recordId || "", driveFileId || "", uploadId || ""]);
    const staging = uploadId ? `printStaging/${uid}/${uploadId}.pdf` : "";
    const discardStaging = () => staging && bucket.file(staging).delete({ ignoreNotFound: true });
    const previous = (await operation.get()).data();
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail("already-exists", "La operación corresponde a otro documento.");
      await Promise.resolve(discardStaging()).catch(() => {});
      return (await db.doc("printDocuments/" + previous.documentId).get()).data();
    }
    let content;
    let identity = {};
    if (personal) {
      const collection = origin === "certificate" ? "generatedCertificates" : "generatedCredentials";
      const record = (await db.collection(collection).doc(recordId).get()).data();
      if (!record || !record.folio || !record.validationCode || record.deleted || record.archived
        || ["cancelado", "cancelada", "anulado", "revocado"].includes(String(record.status).toLowerCase())) {
        fail("failed-precondition", "El documento emitido está incompleto o fue dado de baja.");
      }
      identity = { [origin + "Id"]: recordId, requestId: record.requestId || "",
        folio: record.folio, validationCode: record.validationCode };
      if (origin === "certificate") {
        const path = storedCertificatePath(record, bucket.name);
        content = await storageBytes(bucket, path);
      } else {
        const archive = bucket.file(`printCredentialArchives/${digest(recordId)}.pdf`);
        const [exists] = await archive.exists();
        if (!exists) {
          if (!staging) fail("not-found", "Hace falta el PDF original de la credencial para vincularla por primera vez.");
          if (record.generatedByUid !== uid && !actor.isAdmin) fail("permission-denied", "El emisor o un administrador debe vincular el PDF original.");
          const initial = await storageBytes(bucket, staging);
          const { pdf } = await inspectPdf(initial.bytes);
          verifyCredentialPdf(pdf, record.validationUrl);
          await saveOnce(archive, initial.bytes);
        }
        content = await storageBytes(bucket, archive.name);
      }
      content.name = fileName(record.pdfFileName || record.folio + ".pdf");
    } else if (origin === "drive") {
      content = await readDrive(request, driveFileId);
      identity = { driveFileId };
    } else {
      content = await storageBytes(bucket, staging);
      content.name = fileName(request.data.name);
    }
    const { pages, sha256 } = await inspectPdf(content.bytes);
    const id = digest(JSON.stringify([uid, origin, identity, content.name, sha256]));
    const path = `printDocuments/${uid}/${id}.pdf`;
    await saveOnce(bucket.file(path), content.bytes);
    const [frozen] = await bucket.file(path).getMetadata();
    const snapshot = { id, path, ownerUid: uid, sha256, pages, size: content.bytes.length,
      name: content.name, origin, ...identity, sourceGeneration: content.sourceGeneration || "",
      generation: String(frozen.generation), createdAt: new Date().toISOString() };
    const result = await db.runTransaction(async (tx) => {
      const docRef = db.doc("printDocuments/" + id);
      const [op, doc] = await tx.getAll(operation, docRef);
      if (op.exists) {
        if (op.data().fingerprint !== fingerprint) fail("already-exists", "La operación corresponde a otro documento.");
        return (await tx.get(db.doc("printDocuments/" + op.data().documentId))).data();
      }
      tx.create(operation, { documentId: id, fingerprint });
      if (!doc.exists) tx.create(docRef, snapshot);
      return doc.exists ? doc.data() : snapshot;
    });
    await Promise.resolve(discardStaging()).catch(() => {});
    return result;
  };
}

// Resume from the server's page token to keep each run bounded even when
// abandoned uploads accumulate. An in-flight upload or replacement is retained.
async function purgePrintStaging({ bucket, db, now = Date.now() }) {
  const cursor = db.doc("printMaintenance/stagingCleanup");
  const pageToken = (await cursor.get()).data()?.pageToken;
  const options = { prefix: "printStaging/", maxResults: 250, autoPaginate: false };
  if (pageToken) options.pageToken = pageToken;
  const [files, next] = await bucket.getFiles(options);
  for (let i = 0; i < files.length; i += 20) {
    await Promise.all(files.slice(i, i + 20).map(async (file) => {
      const created = Date.parse(file.metadata?.timeCreated);
      const generation = file.metadata?.generation;
      if (!file.name.startsWith("printStaging/") || !generation || !Number.isFinite(created)
        || now - created < 24 * 60 * 60 * 1000) return;
      try { await file.delete({ ifGenerationMatch: generation, ignoreNotFound: true }); }
      catch (error) { if (![404, 412].includes(Number(error.code))) throw error; }
    }));
  }
  await cursor.set({ pageToken: next?.pageToken || "", lastRun: new Date(now).toISOString() });
}

module.exports = { createFreezePrintDocument, inspectPdf, verifyCredentialPdf, storedCertificatePath, driveBytes, purgePrintStaging, MAX_BYTES };
