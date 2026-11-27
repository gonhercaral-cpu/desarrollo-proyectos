"use strict";

// Reportes de periodo del Gestor de Producción de Imprenta.
// - Cada reporte es un snapshot inmutable en `printReports` (solo escribe el servidor).
// - Las programaciones viven en `printReportSchedules` (solo administración, vía callable).
// - Nunca se envían correos: no hay proveedor autorizado. Solo notificaciones dentro de la app.
const { createHash } = require("node:crypto");

const TIME_ZONE = "America/Tijuana";
const KINDS = Object.freeze(["production", "books", "certificates", "credentials", "printer",
  "inventory", "costs", "operator", "waste", "reprints"]);
const FREQUENCIES = Object.freeze(["daily", "weekly", "monthly"]);
const MAX_RANGE_DAYS = 366;
const PAGE_SIZE = 400;
const MAX_DOCS = 20000;
const MAX_MS = 50000;
const MAX_ROWS = 200;
const MAX_SNAPSHOT_BYTES = 600 * 1024;
const MAX_ACTIVE_SCHEDULES = 25;
const MAX_SCHEDULES_PER_RUN = 500;
const RUN_BUDGET_MS = 240000;
const LEASE_MS = 10 * 60 * 1000;
const TRANSIENT = new Set([4, 10, 13, 14, "deadline-exceeded", "aborted", "internal", "unavailable"]);

const digest = (value) => createHash("sha256").update(value).digest("hex");
const text = (value, max = 200) => String(value ?? "").replace(/[\p{Cc}]/gu, " ").trim().slice(0, max);
const count = (value) => (Number.isFinite(value) && value >= 0 ? value : null);
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Fechas en America/Tijuana (días calendario inclusivos) ----------

const zoneParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function zoneOffsetMs(utcMs) {
  const p = Object.fromEntries(zoneParts.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000;
}

function parseDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(typeof value === "string" ? value : "");
  if (!match) return null;
  const [y, m, d] = [+match[1], +match[2], +match[3]];
  const utc = Date.UTC(y, m - 1, d);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d, utc };
}

const formatDay = (utc) => new Date(utc).toISOString().slice(0, 10);
const addDays = (day, n) => formatDay(parseDay(day).utc + n * 86400000);
const diffDays = (a, b) => Math.round((parseDay(b).utc - parseDay(a).utc) / 86400000);

// Instante UTC en que empieza el día calendario `day` en Tijuana.
function dayStartMs(day) {
  const { utc } = parseDay(day);
  let guess = utc - zoneOffsetMs(utc);
  guess = utc - zoneOffsetMs(guess);
  return guess;
}

function dayOf(ms) {
  const p = Object.fromEntries(zoneParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// Rango [inicio, fin) con `to` inclusivo. Lanza Error con `.userMessage` si es inválido.
function periodRange(from, to, nowMs = Date.now()) {
  const a = parseDay(from);
  const b = parseDay(to);
  if (!a || !b) throw Object.assign(new Error("fecha"), { userMessage: "Las fechas deben tener formato AAAA-MM-DD y existir en el calendario." });
  if (b.utc < a.utc) throw Object.assign(new Error("orden"), { userMessage: "La fecha final no puede ser anterior a la inicial." });
  const days = diffDays(from, to) + 1;
  if (days > MAX_RANGE_DAYS) throw Object.assign(new Error("rango"), { userMessage: `El periodo no puede superar ${MAX_RANGE_DAYS} días.` });
  if (to > dayOf(nowMs)) throw Object.assign(new Error("futuro"), { userMessage: "El periodo no puede incluir días futuros." });
  return { from, to, days, startMs: dayStartMs(from), endMs: dayStartMs(addDays(to, 1)) };
}

// Periodo inmediato anterior de la misma duración.
function previousPeriod(range) {
  const to = addDays(range.from, -1);
  const from = addDays(to, -(range.days - 1));
  return { from, to, days: range.days, startMs: dayStartMs(from), endMs: range.startMs };
}

// Último periodo completo según la frecuencia (diario: ayer; semanal: lunes–domingo; mensual: mes previo).
function latestCompletePeriod(frequency, nowMs) {
  const today = dayOf(nowMs);
  if (frequency === "daily") {
    const day = addDays(today, -1);
    return { from: day, to: day };
  }
  if (frequency === "weekly") {
    const weekday = new Date(parseDay(today).utc).getUTCDay();
    const monday = addDays(today, -((weekday + 6) % 7));
    return { from: addDays(monday, -7), to: addDays(monday, -1) };
  }
  const { y, m } = parseDay(today);
  const first = formatDay(Date.UTC(y, m - 1, 1));
  const prevLast = addDays(first, -1);
  return { from: `${prevLast.slice(0, 8)}01`, to: prevLast };
}

function retryDelay(failures) {
  return Math.min(6 * 3600000, 15 * 60000 * 2 ** Math.max(0, failures - 1));
}

// Decide de forma determinista si una programación debe ejecutarse ahora.
function scheduleDue(schedule, nowMs) {
  if (!schedule || schedule.enabled !== true || !FREQUENCIES.includes(schedule.frequency)) return null;
  const period = latestCompletePeriod(schedule.frequency, nowMs);
  const key = `${period.from}_${period.to}`;
  if (schedule.notBefore && period.from < schedule.notBefore) return null;
  if (schedule.lastPeriodKey === key) return null;
  if ((schedule.nextAttemptMs || 0) > nowMs || (schedule.leaseUntilMs || 0) > nowMs) return null;
  return { ...period, key };
}

// ---------- Métricas ----------

const toMs = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number.isFinite(value) ? value : null;
};

function jobFaces(job) {
  const pages = count(job.source?.pages);
  const defaultCopies = count(job.config?.copies);
  const duplex = job.config?.duplex === true;
  const parts = (Array.isArray(job.parts) ? job.parts : []).filter((part) => !part.reassignedTo);
  if (parts.length === 0) {
    if (!Number.isInteger(pages) || !Number.isInteger(defaultCopies) || pages < 1 || defaultCopies < 1) return null;
    return { faces: pages * defaultCopies, sheets: duplex ? Math.ceil(pages / 2) * defaultCopies : pages * defaultCopies, byPrinter: [] };
  }
  let faces = 0;
  let sheets = 0;
  const byPrinter = [];
  for (const part of parts) {
    const copies = part?.copies === undefined ? defaultCopies : count(part.copies);
    const ok = Number.isInteger(part?.from) && Number.isInteger(part?.to) && part.from >= 1 && part.to >= part.from
      && (pages === null || part.to <= pages) && Number.isInteger(copies) && copies >= 1;
    if (!ok) return null;
    const length = part.to - part.from + 1;
    const partFaces = length * copies;
    faces += partFaces;
    sheets += duplex ? Math.ceil(length / 2) * copies : partFaces;
    byPrinter.push({ printerId: text(part.printerId, 150) || "sin-impresora", faces: partFaces, status: text(part.status, 40) || "sin-estado" });
  }
  return { faces, sheets, byPrinter };
}

function jobCost(job) {
  return count(job.cost?.total) ?? count(job.cost) ?? count(job.costs?.total);
}

const isReprint = (job) => Boolean(job.reprintOf || job.reprintOfJobId || job.config?.reprintOf || job.source?.reprintOf);

const sumMaybe = (a, b) => (b === null ? a : (a === null ? b : a + b));

function emptyBucket() {
  return { jobs: 0, confirmedFaces: null, requestedFaces: 0, requestedSheets: 0, accepted: null, rejected: null, inventoried: null,
    costTotal: null, jobsWithoutCost: 0, reprints: 0, invalidJobs: 0 };
}

function addToBucket(bucket, row) {
  bucket.jobs += 1;
  if (row.faces === null) bucket.invalidJobs += 1;
  else {
    bucket.requestedFaces += row.faces;
    bucket.requestedSheets += row.sheets;
  }
  bucket.confirmedFaces = sumMaybe(bucket.confirmedFaces, row.confirmedFaces);
  bucket.accepted = sumMaybe(bucket.accepted, row.accepted);
  bucket.rejected = sumMaybe(bucket.rejected, row.rejected);
  bucket.inventoried = sumMaybe(bucket.inventoried, row.inventoried);
  if (row.cost === null) bucket.jobsWithoutCost += 1;
  else bucket.costTotal = sumMaybe(bucket.costTotal, row.cost);
  if (row.reprint) bucket.reprints += 1;
}

function finishBucket(bucket) {
  const confirmed = bucket.accepted === null && bucket.rejected === null ? null : (bucket.accepted || 0) + (bucket.rejected || 0);
  return { ...bucket,
    rejectionRate: confirmed ? Math.round(((bucket.rejected || 0) / confirmed) * 10000) / 10000 : null };
}

function topRows(map, kind) {
  const rows = [...map.entries()].map(([key, bucket]) => ({ key, ...finishBucket(bucket) }))
    .sort((a, b) => b.requestedFaces - a.requestedFaces || a.key.localeCompare(b.key));
  if (rows.length <= MAX_ROWS) return { rows, truncated: false };
  const rest = emptyBucket();
  for (const row of rows.slice(MAX_ROWS)) {
    rest.jobs += row.jobs;
    rest.requestedFaces += row.requestedFaces;
    rest.requestedSheets += row.requestedSheets;
    rest.confirmedFaces = sumMaybe(rest.confirmedFaces, row.confirmedFaces);
    rest.inventoried = sumMaybe(rest.inventoried, row.inventoried);
    rest.costTotal = sumMaybe(rest.costTotal, row.costTotal);
    for (const field of ["jobsWithoutCost", "invalidJobs", "reprints"]) rest[field] += row[field];
    rest.rejected = sumMaybe(rest.rejected, row.rejected);
    rest.accepted = sumMaybe(rest.accepted, row.accepted);
  }
  return { rows: [...rows.slice(0, MAX_ROWS), { key: `otros (${kind})`, ...finishBucket(rest) }], truncated: true };
}

const bump = (map, key) => {
  if (!map.has(key)) map.set(key, emptyBucket());
  return map.get(key);
};

// Un trabajo coincide con todos los filtros presentes.
function matchesFilters(job, filters) {
  if (filters.type && job.type !== filters.type) return false;
  if (filters.status && job.status !== filters.status) return false;
  if (filters.productId && job.productId !== filters.productId) return false;
  if (filters.printerId && !(Array.isArray(job.parts) && job.parts.some((p) => p?.printerId === filters.printerId))) return false;
  return true;
}

function summarizeJobs(jobs, filters = {}, kind = "production") {
  const total = emptyBucket();
  const groups = { type: new Map(), status: new Map(), source: new Map(), product: new Map(),
    operator: new Map(), printer: new Map() };
  const partStatus = new Map();
  let matched = 0;
  for (const job of jobs) {
    if (!matchesFilters(job, filters)) continue;
    if (kind === "books" && job.type !== "book") continue;
    if (kind === "certificates" && job.type !== "certificate") continue;
    if (kind === "credentials" && job.type !== "credential") continue;
    if (kind === "reprints" && !isReprint(job)) continue;
    matched += 1;
    const sized = jobFaces(job);
    const confirmedParts = (job.parts || []).filter((part) =>
      part.status === "completed" && ["printed", "partial"].includes(part.reconcile?.outcome));
    const confirmedFaces = confirmedParts.length
      ? confirmedParts.reduce((sum, part) => sum + (part.to - part.from + 1) * part.copies, 0) : null;
    const row = {
      confirmedFaces,
      faces: sized ? sized.faces : null, sheets: sized ? sized.sheets : 0,
      accepted: count(job.accepted), rejected: count(job.rejected), inventoried: count(job.inventoried),
      cost: jobCost(job), reprint: isReprint(job),
    };
    addToBucket(total, row);
    addToBucket(bump(groups.type, text(job.type, 40) || "sin-tipo"), row);
    addToBucket(bump(groups.status, text(job.status, 40) || "sin-estado"), row);
    addToBucket(bump(groups.source, text(job.source?.origin, 40) || "sin-origen"), row);
    addToBucket(bump(groups.product, text(job.productId, 150) || "sin-producto"), row);
    addToBucket(bump(groups.operator, text(job.createdByUid, 150) || "sin-operador"), row);
    if (sized) {
      for (const part of sized.byPrinter) {
        if (filters.printerId && part.printerId !== filters.printerId) continue;
        const bucket = bump(groups.printer, part.printerId);
        bucket.jobs += 1;
        bucket.requestedFaces += part.faces;
        const states = partStatus.get(part.printerId) || {};
        states[part.status] = (states[part.status] || 0) + 1;
        partStatus.set(part.printerId, states);
      }
    }
  }
  const out = { matchedJobs: matched, summary: finishBucket(total), groups: {}, truncated: false };
  for (const [name, map] of Object.entries(groups)) {
    const { rows, truncated } = topRows(map, name);
    out.groups[name] = name === "printer" ? rows.map((r) => ({ ...r, partsByStatus: partStatus.get(r.key) || {},
      // Las caras confirmadas se registran por trabajo, no por impresora: no se reparten.
      accepted: null, rejected: null, inventoried: null, confirmedFaces: null, rejectionRate: null })) : rows;
    out.truncated = out.truncated || truncated;
  }
  return out;
}

const SECTIONS = {
  production: ["type", "status", "source"],
  books: ["product", "status"],
  certificates: [],
  credentials: [],
  printer: ["printer"],
  inventory: ["product"],
  costs: ["product", "type"],
  operator: ["operator"],
  waste: ["product", "operator", "type"],
  reprints: ["product", "operator"],
};

const pct = (now, before) => (before ? Math.round(((now - before) / before) * 10000) / 100 : null);
const delta = (now, before) => (now === null || before === null ? { value: null, percent: null }
  : { value: now - before, percent: pct(now, before) });

function compareSummaries(current, previous) {
  const keys = ["jobs", "requestedFaces", "requestedSheets", "confirmedFaces", "accepted", "rejected", "inventoried", "costTotal", "reprints"];
  return Object.fromEntries(keys.map((key) => [key, delta(current[key], previous[key])]));
}

// ---------- Fábrica ----------

function createPrintReportHandlers({ db, FieldValue, HttpsError, getActor, assertAdmin,
  notifications = require("./operationalNotifications"), sleep = sleepMs, now = () => Date.now() }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };

  async function withRetry(fn, attempts = 3) {
    for (let attempt = 1; ; attempt += 1) {
      try { return await fn(); }
      catch (error) {
        if (attempt >= attempts || !TRANSIENT.has(error?.code)) throw error;
        await sleep(200 * 2 ** attempt);
      }
    }
  }

  // Lee un rango por cursor con presupuesto compartido de documentos y de tiempo.
  async function readRange(collection, field, range, budget, select) {
    const rows = [];
    let cursor = null;
    for (;;) {
      if (now() - budget.startedMs > MAX_MS) fail("resource-exhausted", "El reporte excede el tiempo permitido. Reduce el periodo o agrega filtros.");
      let query = db.collection(collection).where(field, ">=", new Date(range.startMs))
        .where(field, "<", new Date(range.endMs)).orderBy(field).limit(PAGE_SIZE);
      if (select.length) query = query.select(...select);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await withRetry(() => query.get());
      budget.docs += snapshot.docs.length;
      if (budget.docs > MAX_DOCS) fail("resource-exhausted", `El periodo supera ${MAX_DOCS} registros. Reduce el rango o agrega filtros.`);
      for (const doc of snapshot.docs) rows.push({ id: doc.id, ...doc.data() });
      if (snapshot.docs.length < PAGE_SIZE) return rows;
      cursor = snapshot.docs[snapshot.docs.length - 1];
    }
  }

  const JOB_FIELDS = ["title", "type", "status", "source", "config", "parts", "productId", "createdAt",
    "createdByUid", "accepted", "rejected", "inventoried", "cost", "costs", "reprintOf", "reprintOfJobId"];

  async function emitted(collection, range, budget) {
    const rows = await readRange(collection, "generatedAt", range, budget, ["generatedAt", "status", "deleted", "archived"]);
    const byDay = new Map();
    let total = 0;
    for (const row of rows) {
      if (row.deleted || row.archived || ["cancelado", "cancelada", "anulado", "revocado"].includes(String(row.status || "").toLowerCase())) continue;
      const ms = toMs(row.generatedAt);
      if (ms === null) continue;
      total += 1;
      const day = dayOf(ms);
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }
    return { total, byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, n]) => ({ day, emitted: n })) };
  }

  async function computeReport(params, nowMs) {
    const range = periodRange(params.from, params.to, nowMs);
    const budget = { docs: 0, startedMs: now() };
    const prior = previousPeriod(range);
    const filters = params.filters;
    const currentJobs = await readRange("printJobs", "createdAt", range, budget, JOB_FIELDS);
    const current = summarizeJobs(currentJobs, filters, params.kind);
    const previous = summarizeJobs(await readRange("printJobs", "createdAt", prior, budget, JOB_FIELDS), filters, params.kind);
    const data = {
      labels: {
        period: `Trabajos creados del ${range.from} al ${range.to} (días completos, ${TIME_ZONE}).`,
        requestedFaces: "Caras solicitadas según los trabajos enviados; no demuestran que se imprimieron.",
        confirmedFaces: "Caras verificadas por el operador en los tramos conciliados, calculadas como páginas del tramo por copias confirmadas.",
        printer: "Por impresora solo se muestran caras solicitadas; la confirmación se registra por trabajo.",
        costs: "El costo solo se suma cuando el trabajo lo trae registrado; los faltantes se cuentan aparte.",
      },
      matchedJobs: current.matchedJobs,
      summary: current.summary,
      previous: { from: prior.from, to: prior.to, matchedJobs: previous.matchedJobs, summary: previous.summary },
      comparison: compareSummaries(current.summary, previous.summary),
      sections: Object.fromEntries(SECTIONS[params.kind].map((name) => [name, current.groups[name]])),
      truncated: current.truncated,
    };
    if (params.kind === "certificates" || params.kind === "credentials") {
      const certificates = params.kind === "certificates";
      const collection = certificates ? "generatedCertificates" : "generatedCredentials";
      const [now_, before] = [await emitted(collection, range, budget), await emitted(collection, prior, budget)];
      const origin = certificates ? "certificate" : "credential";
      const personalJobs = currentJobs.filter((j) => j.source?.origin === origin && matchesFilters(j, filters));
      const printed = personalJobs.length;
      const verifiedJobs = personalJobs.filter((j) => (j.accepted || 0) + (j.rejected || 0) > 0);
      data.uniquePrinted = new Set(verifiedJobs.map((j) => j.source[origin + "Id"]).filter(Boolean)).size;
      data.physicalCopies = verifiedJobs.reduce((n, j) => n + (j.accepted || 0) + (j.rejected || 0), 0);
      data.emitted = { total: now_.total, previousTotal: before.total, change: delta(now_.total, before.total), byDay: now_.byDay,
        label: `Documentos emitidos según su fecha de generación; no equivalen a impresiones.` };
      data.printedFromJobs = { jobs: printed, label: "Trabajos de impresión creados que usan documentos emitidos; sin destinatario ni folio." };
    }
    return { range, data, docs: budget.docs };
  }

  function validateFilters(input) {
    const filters = {};
    const pick = (key, max = 150) => {
      if (input[key] === undefined || input[key] === null || input[key] === "") return;
      if (typeof input[key] !== "string" || !/^[\p{L}\p{N}_.:-]{1,150}$/u.test(input[key]) || input[key].length > max) {
        fail("invalid-argument", `El filtro ${key} no es válido.`);
      }
      filters[key] = input[key];
    };
    ["type", "printerId", "status", "productId"].forEach((key) => pick(key));
    return filters;
  }

  // Crea el snapshot de forma idempotente: mismo id => mismo contenido original.
  async function storeReport({ ownerKey, requestId, params, source, scheduleId = "", actor, nowMs }) {
    const id = digest(JSON.stringify(["printReport.v1", ownerKey, requestId]));
    const fingerprint = digest(JSON.stringify([params.kind, params.from, params.to, params.filters]));
    const ref = db.collection("printReports").doc(id);
    const existing = await withRetry(() => ref.get());
    const reuse = (doc) => {
      if (doc.fingerprint !== fingerprint) fail("already-exists", "Este identificador de solicitud ya generó otro reporte.");
      return { id, reused: true, report: doc };
    };
    if (existing.exists) return reuse(existing.data());
    const { range, data } = await computeReport(params, nowMs);
    const bytes = Buffer.byteLength(JSON.stringify(data));
    if (bytes > MAX_SNAPSHOT_BYTES) fail("resource-exhausted", "El reporte es demasiado grande. Agrega filtros o reduce el periodo.");
    const record = {
      id, schemaVersion: 1, immutable: true, kind: params.kind, from: range.from, to: range.to, days: range.days,
      timezone: TIME_ZONE, filters: params.filters, fingerprint, source, scheduleId,
      createdByUid: actor.uid, createdByName: text(actor.name, 120), requestId,
      contentSha256: digest(JSON.stringify(data)), generatedAtIso: new Date(nowMs).toISOString(), data,
    };
    return db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (current.exists) return reuse(current.data());
      tx.create(ref, { ...record, createdAt: FieldValue.serverTimestamp() });
      return { id, reused: false, report: record };
    });
  }

  const validRequestId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{8,120}$/u.test(value);

  async function generate(request) {
    const actor = await getActor(request);
    const input = request.data || {};
    if (!validRequestId(input.requestId)) fail("invalid-argument", "Falta un identificador de solicitud válido.");
    if (!KINDS.includes(input.kind)) fail("invalid-argument", "Elige un tipo de reporte válido.");
    const params = { kind: input.kind, from: input.from, to: input.to, filters: validateFilters(input) };
    try { periodRange(params.from, params.to, now()); }
    catch (error) { if (error.userMessage) fail("invalid-argument", error.userMessage); throw error; }
    return storeReport({ ownerKey: actor.uid, requestId: input.requestId, params, source: "manual", actor, nowMs: now() });
  }

  const publicSchedule = (id, doc) => ({ id, name: doc.name, kind: doc.kind, frequency: doc.frequency, filters: doc.filters || {},
    enabled: doc.enabled === true, notifyCreator: doc.notifyCreator === true, emailEnabled: false, timezone: TIME_ZONE,
    notBefore: doc.notBefore || "" });

  async function schedule(request) {
    const admin = await assertAdmin(request);
    const uid = request.auth?.uid || admin?.uid;
    const input = request.data || {};
    if (!validRequestId(input.requestId)) fail("invalid-argument", "Falta un identificador de solicitud válido.");
    if (input.email || input.emails || input.recipients) fail("failed-precondition", "El envío por correo no está disponible: no hay proveedor autorizado.");
    if (input.timezone && input.timezone !== TIME_ZONE) fail("invalid-argument", `La zona horaria debe ser ${TIME_ZONE}.`);
    const collection = db.collection("printReportSchedules");
    if (input.action === "deactivate") {
      const id = text(input.scheduleId, 80);
      if (!/^[a-f0-9]{40}$/u.test(id)) fail("invalid-argument", "Programación no válida.");
      return db.runTransaction(async (tx) => {
        const ref = collection.doc(id);
        const current = await tx.get(ref);
        if (!current.exists) fail("not-found", "No se encontró la programación.");
        if (current.data().enabled !== false) tx.update(ref, { enabled: false, leaseUntilMs: 0, updatedAt: FieldValue.serverTimestamp(), updatedByUid: uid });
        return publicSchedule(id, { ...current.data(), enabled: false });
      });
    }
    if (input.action !== "save") fail("invalid-argument", "Acción no válida.");
    if (!KINDS.includes(input.kind) || !FREQUENCIES.includes(input.frequency)) fail("invalid-argument", "Elige un reporte y una frecuencia válidos.");
    const name = text(input.name, 120);
    if (!name) fail("invalid-argument", "Escribe un nombre para la programación.");
    const filters = validateFilters(input.filters || {});
    const enabled = input.enabled === true; // Apagada por omisión.
    if (enabled) {
      const active = await collection.where("enabled", "==", true).limit(MAX_ACTIVE_SCHEDULES + 1).get();
      const others = active.docs.filter((d) => d.id !== input.scheduleId).length;
      if (others >= MAX_ACTIVE_SCHEDULES) fail("resource-exhausted", `Solo puede haber ${MAX_ACTIVE_SCHEDULES} programaciones activas.`);
    }
    const fields = { name, kind: input.kind, frequency: input.frequency, filters, enabled,
      notifyCreator: input.notifyCreator === true, emailEnabled: false, timezone: TIME_ZONE };
    const id = input.scheduleId ? text(input.scheduleId, 80) : digest(JSON.stringify(["printReportSchedule", uid, input.requestId])).slice(0, 40);
    if (!/^[a-f0-9]{40}$/u.test(id)) fail("invalid-argument", "Programación no válida.");
    return db.runTransaction(async (tx) => {
      const ref = collection.doc(id);
      const current = await tx.get(ref);
      if (input.scheduleId && !current.exists) fail("not-found", "No se encontró la programación.");
      const wasEnabled = current.exists && current.data().enabled === true;
      const notBefore = enabled && !wasEnabled ? dayOf(now()) : (current.data()?.notBefore || "");
      const stamp = { updatedAt: FieldValue.serverTimestamp(), updatedByUid: uid };
      if (current.exists) tx.update(ref, { ...fields, notBefore, ...stamp });
      else tx.create(ref, { ...fields, notBefore, createdByUid: uid, createdAt: FieldValue.serverTimestamp(), ...stamp,
        lastPeriodKey: "", lastReportId: "", lastAttemptMs: 0, nextAttemptMs: 0, leaseUntilMs: 0, failureCount: 0, lastError: "" });
      return publicSchedule(id, { ...(current.data() || {}), ...fields, notBefore });
    });
  }

  async function activeProfile(uid) {
    if (!uid) return null;
    const profile = (await db.collection("users").doc(uid).get()).data();
    if (!profile || profile.active !== true || profile.deleted === true || profile.archived === true) return null;
    return profile;
  }

  async function claim(ref, nowMs) {
    return db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      const data = current.data();
      const due = scheduleDue(data, nowMs);
      if (!due) return null;
      tx.update(ref, { leaseUntilMs: nowMs + LEASE_MS, lastAttemptMs: nowMs });
      return { due, data };
    });
  }

  async function runOne(doc, nowMs) {
    const ref = db.collection("printReportSchedules").doc(doc.id);
    const claimed = await claim(ref, nowMs);
    if (!claimed) return { scheduleId: doc.id, status: "skipped" };
    const { due, data } = claimed;
    try {
      const owner = await activeProfile(data.createdByUid);
      if (!owner || String(owner.role || "").toLowerCase() !== "admin") fail("permission-denied", "Quien creó la programación ya no es administrador activo.");
      const result = await storeReport({
        ownerKey: `schedule:${doc.id}`, requestId: `${due.from}_${due.to}`, source: "schedule", scheduleId: doc.id,
        params: { kind: data.kind, from: due.from, to: due.to, filters: data.filters || {} },
        actor: { uid: `schedule:${doc.id}`, name: data.name }, nowMs,
      });
      await ref.update({ lastPeriodKey: due.key, lastReportId: result.id, failureCount: 0, lastError: "", nextAttemptMs: 0, leaseUntilMs: 0 });
      if (data.notifyCreator === true) {
        await notifications.createDeduplicatedNotifications(db, FieldValue, {
          type: "print_report_ready", module: "printing", title: "Reporte de Imprenta listo",
          message: `El reporte “${text(data.name, 100)}” del ${due.from} al ${due.to} ya está en el archivo.`,
          entityType: "printReport", entityId: result.id, entityName: text(data.name, 120),
          route: `/?page=print-shop&printTab=reports&reportId=${encodeURIComponent(result.id)}`,
          actor: { uid: "", name: "Sistema" }, priority: "normal",
          deduplicationKey: `print_report_ready:${result.id}`, metadata: { kind: data.kind, from: due.from, to: due.to },
        }, new Set([data.createdByUid]));
      }
      return { scheduleId: doc.id, status: "generated", reportId: result.id };
    } catch (error) {
      const failures = (data.failureCount || 0) + 1;
      await ref.update({ failureCount: failures, lastError: text(error?.message, 200),
        nextAttemptMs: nowMs + retryDelay(failures), leaseUntilMs: 0 }).catch(() => {});
      return { scheduleId: doc.id, status: "failed" };
    }
  }

  // Pensado para ejecutarse cada hora. Un fallo no detiene a las demás programaciones;
  // se procesan primero las que llevan más tiempo sin intento, así ninguna queda sin turno.
  async function runDue(options = {}) {
    const startedMs = now();
    const snapshot = await withRetry(() => db.collection("printReportSchedules").where("enabled", "==", true).limit(MAX_SCHEDULES_PER_RUN).get());
    const result = { checked: snapshot.docs.length, generated: 0, skipped: 0, failed: 0, deferred: 0, results: [] };
    if (snapshot.empty || snapshot.docs.length === 0) return result;
    const ordered = [...snapshot.docs].sort((a, b) => (a.data().lastAttemptMs || 0) - (b.data().lastAttemptMs || 0));
    for (let index = 0; index < ordered.length; index += 1) {
      if (now() - startedMs > (options.budgetMs || RUN_BUDGET_MS)) { result.deferred = ordered.length - index; break; }
      const nowMs = now();
      if (!scheduleDue(ordered[index].data(), nowMs)) { result.skipped += 1; continue; }
      let outcome;
      try { outcome = await runOne(ordered[index], nowMs); }
      catch { outcome = { scheduleId: ordered[index].id, status: "failed" }; }
      result.results.push(outcome);
      if (outcome.status === "generated") result.generated += 1;
      else if (outcome.status === "failed") result.failed += 1;
      else result.skipped += 1;
    }
    return result;
  }

  // Disparador onDocumentWritten de printJobs/{jobId}. Solo lee; nunca escribe en printJobs.
  async function notify(event) {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    if (!after || after.deleted === true) return { sent: 0, reason: "sin-trabajo" };
    const status = text(after.status, 40);
    if (!status || before?.status === after.status) return { sent: 0, reason: "sin-cambio" };
    const settings = (await db.doc("printSettings/production").get()).data() || {};
    const alerts = settings.statusAlerts;
    const statuses = Array.isArray(alerts?.statuses) ? alerts.statuses.map((s) => text(s, 40)).filter(Boolean).slice(0, 20) : [];
    if (alerts?.enabled !== true || !statuses.includes(status)) return { sent: 0, reason: "sin-alerta-configurada" };
    const creator = text(after.createdByUid, 150);
    if (!(await activeProfile(creator))) return { sent: 0, reason: "destinatario-inactivo" };
    const jobId = event.params.jobId;
    const title = text(after.title, 120) || "Trabajo de impresión";
    const sent = await notifications.createDeduplicatedNotifications(db, FieldValue, {
      type: "print_job_status", module: "printing", title: "Estado de trabajo de impresión",
      message: `“${title}” cambió a ${status}.`, entityType: "printJob", entityId: jobId, entityName: title,
      route: `/?page=print-shop&printTab=production&jobId=${encodeURIComponent(jobId)}`,
      actor: { uid: text(after.updatedByUid, 150), name: text(after.updatedByName, 120) || "Sistema" },
      priority: ["failed", "error", "cancelled"].includes(status) ? "urgent" : "important",
      deduplicationKey: `print_job_status:${jobId}:${status}:${event.id}`, metadata: { status },
    }, new Set([creator]));
    return { sent, reason: sent ? "enviada" : "duplicada-o-propia" };
  }

  return { generate, schedule, runDue, notify };
}

module.exports = {
  createPrintReportHandlers,
  _internals: { periodRange, previousPeriod, latestCompletePeriod, scheduleDue, summarizeJobs, jobFaces,
    matchesFilters, dayStartMs, dayOf, retryDelay, compareSummaries },
  KINDS, FREQUENCIES, TIME_ZONE,
};
