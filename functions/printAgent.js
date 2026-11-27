const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const { pipeline } = require("node:stream/promises");

const { computeDispatchPrinterIds, deriveJobStatus } = require("./printDistribution");

const digest = value => createHash("sha256").update(value).digest("hex");
const agentPattern = /^[a-f0-9]{32}$/;
const credentialPattern = /^[a-f0-9]{64}$/;
const queuePattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,126}$/;
const docPattern = /^[A-Za-z0-9_-]{1,150}$/;
const pdfPathPattern = /^printDocuments\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,150}\.pdf$/;
const leaseMs = 5 * 60 * 1000;
const chunkSize = 4 * 1024 * 1024;
const maxPdfSize = 500 * 1024 * 1024;
const runnable = new Set(["queued", "printing", "submitted", "confirmation", "quality", "partial"]);


function sameHash(left, right) {
  return credentialPattern.test(left || "") && credentialPattern.test(right || "")
    && timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function printerId(agentId, queue) {
  return agentId + "_" + digest(queue).slice(0, 24);
}

function eligiblePart(parts, printers, now) {
  return parts.find(part => printers.includes(part.printerId)
    && part.status === "queued" && (part.dispatchState !== "claimed" || part.leaseUntil <= now || part.leasePrinterId !== part.printerId));
}

function rollup(parts) {
  return deriveJobStatus(parts);
}

function dispatchIds(parts) {
  return computeDispatchPrinterIds(rollup(parts), parts);
}

function createPrintAgentHandlers({ db, bucket, assertAdmin, HttpsError, now = Date.now }) {
  const agents = db.collection("printAgents");
  const printers = db.collection("printPrinters");
  const secrets = db.collection("printAgentSecrets");
  const jobs = db.collection("printJobs");
  function reject(code, message) { throw new HttpsError(code, message); }
  function check(test, message) { if (!test) reject("invalid-argument", message); }

  async function admin(req) {
    const actor = await assertAdmin(req);
    if (actor.deleted === true || actor.archived === true) reject("permission-denied", "La cuenta administrativa no está activa.");
    const data = req.data || {};
    if (data.action === "pair") {
      const name = String(data.name || "").trim();
      check(name.length > 0 && name.length <= 100, "Indica un nombre para el agente.");
      const id = randomBytes(16).toString("hex");
      const token = randomBytes(24).toString("hex");
      const expiresAt = now() + 600000;
      const batch = db.batch();
      batch.create(agents.doc(id), { id, name, status: "pending", printerIds: [], createdAt: new Date(now()), createdBy: actor.uid });
      batch.create(secrets.doc(id), { pairingHash: digest(token), expiresAt });
      await batch.commit();
      return { agentId: id, code: id + "." + token, expiresAt };
    }
    check(data.action === "revoke" && agentPattern.test(data.agentId || ""), "Agente o acción inválidos.");
    await db.runTransaction(async tx => {
      const agent = await tx.get(agents.doc(data.agentId));
      if (!agent.exists) reject("not-found", "Agente inexistente.");
      tx.update(agent.ref, { status: "revoked", revokedBy: actor.uid, revokedAt: new Date(now()) });
      tx.delete(secrets.doc(data.agentId));
      for (const id of agent.data().printerIds || []) tx.set(printers.doc(id), { online: false }, { merge: true });
    });
    return { revoked: true };
  }

  function permitted(secret, agent, credential) {
    if (agent?.status !== "active" || !sameHash(secret?.credentialHash, digest(credential))) {
      reject("unauthenticated", "El agente no está vinculado o fue revocado.");
    }
  }

  async function authenticate(get, id, credential) {
    const [agent, secret] = await Promise.all([get(agents.doc(id)), get(secrets.doc(id))]);
    permitted(secret.data(), agent.data(), credential);
    return agent.data();
  }

  async function pair(id, credential, token) {
    check(/^[a-f0-9]{48}$/.test(token || ""), "Código de vinculación inválido.");
    await db.runTransaction(async tx => {
      const [secret, agent] = await Promise.all([tx.get(secrets.doc(id)), tx.get(agents.doc(id))]);
      if (agent.data()?.status === "active") {
        permitted(secret.data(), agent.data(), credential);
        return;
      }
      if (agent.data()?.status !== "pending" || secret.data()?.expiresAt < now() || !sameHash(secret.data()?.pairingHash, digest(token))) {
        reject("unauthenticated", "Código de vinculación caducado o inválido.");
      }
      tx.set(secret.ref, { credentialHash: digest(credential) });
      tx.update(agent.ref, { status: "active", lastSeenAt: new Date(now()), pairedAt: new Date(now()) });
    });
    return { paired: true };
  }

  async function heartbeat(id, credential, list) {
    check(Array.isArray(list) && list.length <= 30, "Máximo 30 colas por agente.");
    const records = list.map(p => {
      check(queuePattern.test(p?.queue || ""), "Nombre de cola no compatible.");
      check(Array.isArray(p.paperSizes) && p.paperSizes.length <= 128
        && p.paperSizes.every(x => typeof x === "string" && /^[a-zA-Z0-9_.-]{1,64}$/.test(x)), "Tamaños de papel inválidos.");
      const optionList = (values, allowed) => {
        check(Array.isArray(values) && values.length <= 64 && values.every(x => allowed(x)), "Opciones CUPS inválidas.");
        return [...new Set(values)];
      };
      const caps = p.capabilities || {};
      const capabilities = { pageRange: caps.pageRange === true, maxCopies: 999,
        booklet: false, quality: optionList(caps.quality || [], x => ["draft", "normal", "high"].includes(x)),
        order: ["normal", "reverse"], orientation: ["auto", "portrait", "landscape"], pagesPerSheet: [1],
        trays: optionList(caps.trays || [], x => typeof x === "string" && /^[a-zA-Z0-9_.-]{1,40}$/.test(x)), color: p.color === true, duplex: p.duplex === true, paperSizes: [...new Set(p.paperSizes)] };
      const reasons = optionList(p.statusReasons || [], x => typeof x === "string" && /^[a-z0-9-]{1,90}$/.test(x));
      return { statusReasons: reasons, id: printerId(id, p.queue), agentId: id, name: p.queue, queue: p.queue,
        online: p.online === true, ...capabilities, capabilities, lastSeenAt: new Date(now()) };
    });
    const ids = records.map(p => p.id);
    check(new Set(ids).size === ids.length, "Una misma cola está repetida.");
    await db.runTransaction(async tx => {
      const agent = await authenticate(ref => tx.get(ref), id, credential);
      for (const p of records) tx.set(printers.doc(p.id), p, { merge: true });
      for (const old of agent.printerIds || []) if (!ids.includes(old)) tx.set(printers.doc(old), { online: false }, { merge: true });
      tx.update(agents.doc(id), { printerIds: ids, lastSeenAt: new Date(now()) });
    });
    return { printers: ids.length };
  }

  function audit(tx, ref, part, kind) {
    tx.create(ref.collection("events").doc(), { type: kind, status: part.status,
      partId: part.id, printerId: part.printerId, agentId: part.agentId, at: new Date(now()),
      createdAt: new Date(now()), byUid: part.agentId, byName: "AS Print Agent", details: { partId: part.id, printerId: part.printerId } });
  }

  async function claim(id, credential, data) {
    const agent = await authenticate(ref => ref.get(), id, credential);
    const wanted = data.queues;
    check(Array.isArray(wanted) && wanted.length <= 30 && wanted.every(q => queuePattern.test(q)), "Lista de colas inválida.");
    const ids = wanted.map(q => printerId(id, q)).filter(p => agent.printerIds.includes(p));
    if (!ids.length) return { task: null };
    let search = jobs.where("dispatchPrinterIds", "array-contains-any", [...new Set(ids)]).orderBy("__name__").limit(12);
    if (data.cursor) {
      check(docPattern.test(data.cursor), "Cursor inválido.");
      search = search.startAfter(data.cursor);
    }
    const candidates = await search.get();
    for (const doc of candidates.docs) {
      if (!runnable.has(doc.data().status) || !eligiblePart(doc.data().parts || [], ids, now())) continue;
      const reservation = await db.runTransaction(async tx => {
        const active = await authenticate(ref => tx.get(ref), id, credential);
        const fresh = await tx.get(doc.ref);
        const job = fresh.data();
        if (!job || !runnable.has(job.status)) return null;
        const p = eligiblePart(job.parts || [], ids.filter(v => active.printerIds.includes(v)), now());
        if (!p) return null;
        const source = job.source || {};
        const invalid = !Number.isSafeInteger(source.pages) || source.pages < 1 || p.to > source.pages || !pdfPathPattern.test(source.path || "") || !credentialPattern.test(source.sha256 || "")
          || !docPattern.test(p.id || "") || !Number.isSafeInteger(p.from) || !Number.isSafeInteger(p.to)
          || p.from < 1 || p.to < p.from || !Number.isSafeInteger(p.copies) || p.copies < 1 || p.copies > 999;
        const part = { ...p, agentId: id };
        if (invalid) {
          part.status = "confirmation";
          part.dispatchState = "error";
          part.incident = "Documento sin huella verificable o distribución inválida.";
        } else {
          part.status = "queued";
          part.dispatchState = "claimed";
          part.leasePrinterId = p.printerId;
          part.lease = randomBytes(24).toString("hex");
          part.leaseUntil = now() + leaseMs;
        }
        const parts = job.parts.map(item => item.id === p.id ? part : item);
        tx.update(doc.ref, { parts, dispatchPrinterIds: dispatchIds(parts), status: rollup(parts), updatedAt: new Date(now()) });
        audit(tx, doc.ref, part, invalid ? "preparationFailed" : "claimed");
        if (invalid) return null;
        return { jobId: doc.id, partId: p.id, lease: part.lease, queue: wanted.find(q => printerId(id, q) === p.printerId),
          from: p.from, to: p.to, pages: source.pages, copies: p.copies, config: job.config || {}, sha256: source.sha256 };
      });
      if (reservation) return { task: reservation };
    }
    return { task: null, cursor: candidates.size === 12 ? candidates.docs.at(-1).id : null };
  }

  function validateClaim(job, data, id) {
    const part = job?.parts?.find(p => p.id === data.partId);
    if (!part || part.agentId !== id || part.leasePrinterId !== part.printerId || part.lease !== data.lease) reject("failed-precondition", "Asignación obsoleta. Revisa el trabajo.");
    return part;
  }

  async function change(id, credential, data) {
    const ref = jobs.doc(data.jobId);
    return db.runTransaction(async tx => {
      await authenticate(r => tx.get(r), id, credential);
      const job = (await tx.get(ref)).data();
      const p = validateClaim(job, data, id);
      const next = { ...p };
      if (data.op === "renew" || data.op === "start") {
        if (data.op === "start" && p.status === "confirmation" && p.dispatchState === "submitting") return { ok: true };
        if (!runnable.has(job.status) || (p.status !== "queued" || p.dispatchState !== "claimed") || p.leaseUntil < now()) reject("failed-precondition", "Reserva vencida o trabajo detenido.");
        if (data.op === "start") {
          next.status = "confirmation";
          next.dispatchState = "submitting";
          next.startedAt = new Date(now());
        } else next.leaseUntil = now() + leaseMs;
      } else {
        const state = data.state;
        const transitions = { claimed: ["error", "confirmation"], submitting: ["submitted", "confirmation"], submitted: ["spoolCompleted", "confirmation"] };
        if (state === p.dispatchState) return { ok: true };
        const expected = { claimed: "queued", submitting: "confirmation", submitted: "submitted" };
        if (p.status !== expected[p.dispatchState] || !transitions[p.dispatchState]?.includes(state)) reject("failed-precondition", "El estado de la parte cambió. Revisa el resultado.");
        next.dispatchState = state;
        next.status = state === "submitted" ? "submitted" : "confirmation";
        if (state === "submitted") {
          check(Number.isSafeInteger(data.spoolId) && data.spoolId > 0, "Falta el identificador de CUPS.");
          next.spoolId = data.spoolId;
        }
        if (state === "confirmation" || state === "error") {
          const reasons = { input: "Preparación o capacidades incompatibles.", uncertain: "No existe confirmación concluyente de CUPS.",
            stopped: "CUPS informó una detención o cancelación.", integrity: "La integridad del documento no coincide." };
          next.incident = reasons[data.reason] || reasons.uncertain;
        }
      }
      const parts = job.parts.map(item => item.id === p.id ? next : item);
      const update = { parts, updatedAt: new Date(now()) };
      // An in-flight receipt may arrive after an operator pauses the parent. Preserve that decision.
      if (runnable.has(job.status)) Object.assign(update, { status: rollup(parts), dispatchPrinterIds: dispatchIds(parts) });
      tx.update(ref, update);
      if (data.op !== "renew") audit(tx, ref, next, next.dispatchState);
      return { ok: true };
    });
  }

  async function bytes(id, credential, data, res) {
    await authenticate(r => r.get(), id, credential);
    const job = (await jobs.doc(data.jobId).get()).data();
    const part = validateClaim(job, data, id);
    if (!runnable.has(job.status) || (part.status !== "queued" || part.dispatchState !== "claimed") || part.leaseUntil < now()) reject("failed-precondition", "La parte ya no admite descargas.");
    const path = job.source?.path;
    check(pdfPathPattern.test(path || ""), "Ruta de documento inválida.");
    const file = bucket.file(path);
    const [meta] = await file.getMetadata();
    const size = Number(meta.size);
    check(size > 0 && size <= maxPdfSize && Number.isSafeInteger(data.offset) && data.offset >= 0 && data.offset < size, "Rango o tamaño inválido.");
    if (data.generation && data.generation !== meta.generation) reject("failed-precondition", "La versión del archivo cambió.");
    const end = Math.min(data.offset + chunkSize, size) - 1;
    res.set({ "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "Content-Length": String(end - data.offset + 1),
      "X-Pdf-Size": String(size), "X-Pdf-Generation": String(meta.generation) });
    await pipeline(bucket.file(path, { generation: meta.generation }).createReadStream({ start: data.offset, end, validation: false }), res);
  }

  async function gateway(req, res) {
    const status = { "invalid-argument": 400, unauthenticated: 401, "permission-denied": 403, "not-found": 404, "failed-precondition": 409 };
    res.set("Cache-Control", "no-store");
    try {
      if (req.method !== "POST") { res.status(405).end(); return; }
      const id = req.headers["x-print-agent"];
      const header = String(req.headers.authorization || "");
      const credential = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!agentPattern.test(id || "") || !credentialPattern.test(credential)) reject("unauthenticated", "Credencial inválida.");
      const data = req.body || {};
      let result;
      if (data.op === "pair") result = await pair(id, credential, data.code);
      else if (data.op === "heartbeat") result = await heartbeat(id, credential, data.printers);
      else if (data.op === "claim") result = await claim(id, credential, data);
      else {
        check(docPattern.test(data.jobId || "") && docPattern.test(data.partId || "")
          && /^[a-f0-9]{48}$/.test(data.lease || ""), "Identidad de subtrabajo inválida.");
        if (data.op === "chunk") { await bytes(id, credential, data, res); return; }
        check(["renew", "start", "report"].includes(data.op), "Operación inválida.");
        result = await change(id, credential, data);
      }
      res.status(200).json(result);
    } catch (err) {
      if (res.headersSent) { res.destroy(); return; }
      const http = status[err.code] || (err.code === 404 ? 404 : 500);
      res.status(http).json({ error: http === 500 ? "Fallo del servicio. Reintenta más tarde." : err.message });
    }
  }
  return { admin, gateway };
}
module.exports = { createPrintAgentHandlers, printerId, eligiblePart, rollup, dispatchIds };
