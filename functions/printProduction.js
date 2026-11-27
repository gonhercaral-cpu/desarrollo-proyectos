"use strict";

const crypto = require("node:crypto");
const {
  IN_FLIGHT_PART_STATUSES,
  MAX_COPIES,
  MAX_DEVICES,
  MAX_PAGES,
  MODES,
  PrintRuleError,
  assertPrinterSupports,
  buildConfig,
  computeDispatchPrinterIds,
  deriveJobStatus,
  isPrinterOnline,
  normalizePrinter,
  planDistribution,
  validateConfigFields,
  CONFIG_KEYS,
} = require("./printDistribution");

const { validateRouting, resolveRouting } = require("./printRouting");

const JOB_TYPES = Object.freeze(["document", "book", "certificate", "credential", "personalized", "flyer", "brochure", "trifold", "worksheet", "teaching", "advertising", "form", "other"]);
const PERSONALIZED_TYPES = new Set(["certificate", "credential", "personalized"]);
const PRIORITIES = Object.freeze(["low", "normal", "high", "urgent"]);
const QUALITY_STATUSES = new Set(["confirmation", "quality", "partial"]);
const REPRINTABLE_STATUSES = new Set(["quality", "partial", "completed", "cancelled"]);
const RECONCILE_OUTCOMES = Object.freeze(["printed", "not_printed", "unknown", "reassign", "partial"]);

const PERMISSION_KEYS = Object.freeze(["create", "manage", "quality", "reprint", "reconcile", "inventory", "supplies"]);
// Operadores de Imprenta: producción diaria sí; inventario y consumo de insumos solo con permiso explícito.
const OPERATOR_DEFAULTS = Object.freeze({
  create: true, manage: true, quality: true, reprint: true, reconcile: true, inventory: false, supplies: false,
});
const ACTION_PERMISSIONS = Object.freeze({
  pause: "manage", resume: "manage", cancel: "manage", priority: "manage", note: "manage",
  reprint: "reprint", reconcile: "reconcile", quality: "quality", inventory: "inventory", consume: "supplies",
});

const SAVE_KEYS = ["requestId", "sourceId", "title", "type", "config", "mode", "printerIds", "parts", "draft", "productId", "jobId", "groupId", "preview", "planToken"];
const ACTION_ARGS = Object.freeze({
  pause: ["reason"],
  resume: ["reason"],
  cancel: ["reason"],
  priority: ["priority"],
  note: ["note"],
  reprint: ["reason", "copies"],
  reconcile: ["partId", "outcome", "confirm", "reassignPrinterId", "note", "printedCopies", "printedThrough"],
  quality: ["accepted", "rejected", "notes", "delivery"],
  inventory: ["quantity", "delivery"],
  consume: ["supplies", "notes"],
});
const SETTINGS_KEYS = ["requestId", "certificateEnabled", "credentialEnabled", "defaults", "permissions", "statusAlerts", "inventoryRules", "routing"];
// Por omisión todo es entrega directa; solo "inventory" con automatic=true ingresa solo.
const INVENTORY_CLASSES = Object.freeze(["inventory", "direct", "noninventory", "administrative", "internal"]);
const MAX_INVENTORY_RULES = 50;

const invalid = (message) => new PrintRuleError("invalid-argument", message);
const denied = (message) => new PrintRuleError("permission-denied", message);
const notFound = (message) => new PrintRuleError("not-found", message);
const precondition = (message) => new PrintRuleError("failed-precondition", message);
const conflict = (message) => new PrintRuleError("already-exists", message);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function num(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function safeId(value, max) {
  return clean(String(value)).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, max);
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function rejectUnknown(input, allowed) {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) throw invalid(`Datos no permitidos en la solicitud: ${unknown.join(", ")}.`);
}

function readRequestId(value) {
  const id = clean(value);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) throw invalid("Falta el identificador único de la operación.");
  return id;
}

function readId(value, label) {
  const id = clean(value);
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(id)) throw invalid(`${label} no es válido.`);
  return id;
}

function readText(value, label, min, max) {
  const text = clean(value);
  if (text.length < min || text.length > max) {
    throw invalid(min > 0
      ? `${label} debe tener entre ${min} y ${max} caracteres.`
      : `${label} no puede superar ${max} caracteres.`);
  }
  return text;
}

function readOptionalText(value, label, max) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw invalid(`${label} no es válido.`);
  return readText(value, label, 0, max);
}

function readInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw invalid(`${label} debe ser un entero entre ${min} y ${max}.`);
  }
  return value;
}

/* ---------- Configuración y permisos ---------- */

function readSettings(snapshot) {
  const raw = snapshot.exists ? snapshot.data() : {};
  return viewSettings(raw);
}

function viewSettings(raw = {}) {
  return {
    certificateEnabled: raw.certificateEnabled === true,
    credentialEnabled: raw.credentialEnabled === true,
    defaults: isObject(raw.defaults) ? raw.defaults : {},
    permissions: isObject(raw.permissions) ? raw.permissions : {},
    inventoryRules: Array.isArray(raw.inventoryRules) ? raw.inventoryRules.filter(isObject) : [],
    raw,
  };
}

// Regla del trabajo: la del producto manda sobre la del tipo. Los tipos personalizados
// (certificado, credencial) solo coinciden con una regla explícita de su producto.
function matchInventoryRule(settings, job) {
  const productId = clean(job.productId);
  const rules = settings.inventoryRules.filter((rule) => rule.type === job.type);
  const byProduct = productId ? rules.find((rule) => rule.productId === productId) : null;
  if (byProduct) return byProduct;
  return PERSONALIZED_TYPES.has(job.type) ? null : rules.find((rule) => !rule.productId) || null;
}

function parseInventoryRules(value) {
  if (!Array.isArray(value) || value.length > MAX_INVENTORY_RULES) {
    throw invalid(`Define hasta ${MAX_INVENTORY_RULES} reglas de inventario.`);
  }
  const ids = new Set();
  const scopes = new Set();
  return value.map((item) => {
    if (!isObject(item)) throw invalid("Una regla de inventario no es válida.");
    rejectUnknown(item, ["id", "productId", "type", "classification", "automatic", "warehouse", "sku"]);
    if (!JOB_TYPES.includes(item.type)) throw invalid("El tipo de la regla de inventario no es válido.");
    if (!INVENTORY_CLASSES.includes(item.classification)) throw invalid("La clasificación de la regla no es válida.");
    if (typeof item.automatic !== "boolean") throw invalid("Indica si la regla ingresa al inventario automáticamente.");
    const productId = item.productId ? readId(item.productId, "El producto de la regla") : "";
    const rule = {
      id: readId(item.id, "La regla"),
      productId,
      type: item.type,
      classification: item.classification,
      automatic: item.automatic,
      warehouse: readOptionalText(item.warehouse, "El destino operativo", 80),
      sku: readOptionalText(item.sku, "El SKU", 60),
    };
    if (rule.automatic && rule.classification !== "inventory") {
      throw invalid("Solo las reglas clasificadas como inventario pueden ser automáticas.");
    }
    if (PERSONALIZED_TYPES.has(rule.type) && rule.classification === "inventory" && !productId) {
      throw invalid("Los certificados y credenciales solo se ingresan con una regla explícita de producto.");
    }
    const scope = `${productId}|${rule.type}`;
    if (ids.has(rule.id) || scopes.has(scope)) throw invalid("Hay reglas de inventario repetidas.");
    ids.add(rule.id);
    scopes.add(scope);
    return rule;
  });
}

function publicSettings(settings) {
  return {
    certificateEnabled: settings.certificateEnabled,
    credentialEnabled: settings.credentialEnabled,
    statusAlerts: settings.raw.statusAlerts || { enabled: false, statuses: [] },
    defaults: settings.defaults,
    permissions: settings.permissions,
    inventoryRules: settings.inventoryRules,
    routing: settings.raw.routing || { revision: 0, groups: [], rules: [] },
  };
}

function effectiveDefaults(settings) {
  const { mode, ...configDefaults } = settings.defaults;
  let config;
  try {
    config = validateConfigFields(configDefaults);
  } catch {
    config = {};
  }
  return { mode: MODES.includes(mode) ? mode : "single", config };
}

function canDo(actor, settings, permission) {
  if (actor.isAdmin === true) return true;
  if (!PERMISSION_KEYS.includes(permission)) return false;
  const rule = isObject(settings.permissions[permission]) ? settings.permissions[permission] : {};
  const uid = clean(actor.uid);
  if (Array.isArray(rule.denyUids) && rule.denyUids.includes(uid)) return false;
  if (Array.isArray(rule.allowUids) && rule.allowUids.includes(uid)) return true;
  if (actor.canAccessPrintshop !== true) return false;
  return typeof rule.operator === "boolean" ? rule.operator : OPERATOR_DEFAULTS[permission] === true;
}

function assertCan(actor, settings, permission) {
  if (canDo(actor, settings, permission)) return;
  if (actor.isAdmin !== true && actor.canAccessPrintshop !== true) throw denied("Tu perfil no tiene acceso a Imprenta.");
  throw denied("No tienes permiso para esta acción de Imprenta.");
}

/* ---------- Documento congelado ---------- */

function verifySource(snapshot, { sourceId, ownerUid, type, settings, linkage = null }) {
  if (!snapshot.exists) throw notFound("El documento congelado no existe.");
  const data = snapshot.data();
  if (clean(data.id) && clean(data.id) !== sourceId) throw invalid("El documento congelado no coincide con el solicitado.");
  if (clean(data.ownerUid) !== ownerUid && !(data.libraryPublished === true && ["local", "drive"].includes(data.origin))) throw denied("El documento no pertenece a tu cuenta.");
  const path = clean(data.path);
  if (!path || path.length > 500 || path.startsWith("/") || path.includes("..")) {
    throw invalid("El documento congelado no tiene una ruta válida.");
  }
  const sha256 = clean(data.sha256).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw invalid("El documento congelado no tiene una huella válida.");
  if (!Number.isInteger(data.pages) || data.pages < 1 || data.pages > MAX_PAGES) {
    throw invalid("El documento congelado no tiene un número de páginas válido.");
  }
  const size = Number(data.size);
  if (!Number.isFinite(size) || size < 0) throw invalid("El documento congelado no tiene un tamaño válido.");
  const origin = clean(data.origin);
  if (!origin) throw invalid("El documento congelado no indica su origen.");

  const certificateId = clean(data.certificateId);
  const credentialId = clean(data.credentialId);
  const originKey = origin.toLowerCase();
  const certificateRelated = Boolean(certificateId || credentialId)
    || originKey.includes("certificate") || originKey.includes("credential");
  if ((data.legacy === true || originKey.startsWith("legacy")) && (certificateRelated || type === "certificate" || type === "credential")) {
    throw precondition("Los certificados heredados no se pueden imprimir ni emitir desde este flujo.");
  }
  if (type === "certificate") {
    if (originKey !== "certificate" || !certificateId || credentialId) {
      throw conflict("El documento no corresponde a un certificado.");
    }
    if (!settings.certificateEnabled) throw precondition("La impresión de certificados no está habilitada.");
  } else if (type === "credential") {
    if (originKey !== "credential" || !credentialId || certificateId) {
      throw conflict("El documento no corresponde a una credencial.");
    }
    if (!settings.credentialEnabled) throw precondition("La impresión de credenciales no está habilitada.");
  } else if (certificateRelated) {
    throw conflict("El documento es un certificado o una credencial; elige el tipo de trabajo correspondiente.");
  }

  const source = compact({
    id: sourceId,
    ownerUid: data.ownerUid,
    path,
    sha256,
    pages: data.pages,
    name: clean(data.name) || sourceId,
    size,
    origin,
    certificateId: certificateId || undefined,
    credentialId: credentialId || undefined,
    requestId: clean(data.requestId) || undefined,
    folio: clean(data.folio) || undefined,
    validationCode: clean(data.validationCode) || undefined,
    driveFileId: clean(data.driveFileId) || undefined,
    generation: clean(data.generation) || undefined,
  });
  if (linkage) {
    const same = ["path", "sha256", "origin", "certificateId", "credentialId", "requestId"]
      .every((key) => (source[key] || "") === (linkage[key] || ""));
    if (!same) throw conflict("El documento congelado cambió desde el trabajo original; no se puede reimprimir.");
  }
  return source;
}

/* ---------- Entradas ---------- */

function parseSaveInput(data) {
  if (!isObject(data)) throw invalid("La solicitud no es válida.");
  rejectUnknown(data, SAVE_KEYS);
  if (!JOB_TYPES.includes(data.type)) throw invalid("El tipo de trabajo no es válido.");
  if (data.mode !== undefined && !MODES.includes(data.mode)) throw invalid("El modo de distribución no es válido.");
  if (typeof data.draft !== "boolean") throw invalid("Indica si el trabajo es un borrador.");
  const printerIds = data.printerIds === undefined ? [] : data.printerIds;
  if (!Array.isArray(printerIds) || printerIds.length > MAX_DEVICES) {
    throw invalid(`Selecciona hasta ${MAX_DEVICES} impresoras.`);
  }
  const ids = printerIds.map((id) => readId(id, "La impresora"));
  if (new Set(ids).size !== ids.length) throw invalid("Hay impresoras repetidas en la selección.");
  const rawParts = data.parts === undefined ? [] : data.parts;
  if (!Array.isArray(rawParts) || rawParts.length > MAX_DEVICES) {
    throw invalid(`Un trabajo admite como máximo ${MAX_DEVICES} partes.`);
  }
  const parts = rawParts.map((part) => {
    if (!isObject(part)) throw invalid("Una parte no es válida.");
    rejectUnknown(part, ["printerId", "from", "to", "copies"]);
    for (const key of ["from", "to", "copies"]) {
      if (part[key] !== undefined && !Number.isInteger(part[key])) throw invalid("Las páginas y copias de cada parte deben ser enteros.");
    }
    return compact({ printerId: readId(part.printerId, "La impresora de la parte"), from: part.from, to: part.to, copies: part.copies });
  });
  return {
    requestId: data.preview === true ? null : readRequestId(data.requestId),
    // Las solicitudes previas al editor conservan su huella de idempotencia.
    ...(data.preview === true ? { preview: true } : {}),
    ...(data.groupId ? { groupId: readId(data.groupId, "El grupo") } : {}),
    ...(data.planToken ? { planToken: readId(data.planToken, "La vista previa") } : {}),
    sourceId: readId(data.sourceId, "El documento"),
    title: readText(data.title, "El título", 1, 120),
    type: data.type,
    config: validateConfigFields(data.config),
    mode: data.mode || null,
    printerIds: ids,
    parts,
    draft: data.draft,
    productId: data.productId === undefined ? null : readId(data.productId, "El producto"),
    jobId: data.jobId === undefined ? null : readId(data.jobId, "El trabajo"),
  };
}

const ACTION_PARSERS = {
  pause: (d) => ({ reason: readOptionalText(d.reason, "El motivo", 300) }),
  resume: (d) => ({ reason: readOptionalText(d.reason, "El motivo", 300) }),
  cancel: (d) => ({ reason: readOptionalText(d.reason, "El motivo", 300) }),
  priority: (d) => {
    if (!PRIORITIES.includes(d.priority)) throw invalid("La prioridad no es válida.");
    return { priority: d.priority };
  },
  note: (d) => ({ note: readText(d.note, "La nota", 1, 1000) }),
  reprint: (d) => ({
    reason: readText(d.reason, "El motivo de la reimpresión", 3, 300),
    copies: d.copies === undefined ? null : readInteger(d.copies, "Las copias", 1, MAX_COPIES),
  }),
  reconcile: (d) => {
    if (!RECONCILE_OUTCOMES.includes(d.outcome)) throw invalid("El resultado de la conciliación no es válido.");
    if (d.confirm !== true) throw invalid("Confirma explícitamente que revisaste físicamente la impresora.");
    const reassignPrinterId = d.reassignPrinterId === undefined ? null : readId(d.reassignPrinterId, "La impresora destino");
    if (d.outcome === "reassign" && !reassignPrinterId) throw invalid("Indica la impresora destino.");
    if ((d.outcome === "printed" || d.outcome === "unknown") && reassignPrinterId) {
      throw invalid("Solo puedes reasignar cuando la parte no salió o está pendiente.");
    }
    return {
      printedCopies: d.printedCopies == null ? null : readInteger(d.printedCopies, "Las copias confirmadas", 1, MAX_COPIES),
      printedThrough: d.printedThrough == null ? null : readInteger(d.printedThrough, "La última página confirmada", 1, MAX_PAGES),
      partId: readId(d.partId, "La parte"),
      outcome: d.outcome,
      confirm: true,
      reassignPrinterId,
      note: readOptionalText(d.note, "La nota", 500),
    };
  },
  quality: (d) => {
    const accepted = d.accepted === undefined ? 0 : readInteger(d.accepted, "Los aprobados", 0, MAX_COPIES);
    const rejected = d.rejected === undefined ? 0 : readInteger(d.rejected, "Los rechazados", 0, MAX_COPIES);
    if (accepted + rejected === 0) throw invalid("Registra al menos una pieza aprobada o rechazada.");
    const notes = readOptionalText(d.notes, "Las observaciones", 500);
    if (rejected > 0 && !notes) throw invalid("Indica el motivo del rechazo en las observaciones.");
    if (d.delivery !== undefined && d.delivery !== "direct") throw invalid("El destino de entrega no es válido.");
    return { accepted, rejected, notes, delivery: d.delivery || null };
  },
  inventory: (d) => {
    if (d.delivery !== undefined && !["inventory", "direct"].includes(d.delivery)) {
      throw invalid("El destino de entrega no es válido.");
    }
    return {
      quantity: d.quantity === undefined ? null : readInteger(d.quantity, "La cantidad", 1, 1000000),
      delivery: d.delivery || null,
    };
  },
  consume: (d) => {
    if (!Array.isArray(d.supplies) || d.supplies.length < 1 || d.supplies.length > 20) {
      throw invalid("Indica entre 1 y 20 insumos consumidos.");
    }
    const supplies = d.supplies.map((item) => {
      if (!isObject(item)) throw invalid("Un insumo no es válido.");
      rejectUnknown(item, ["supplyId", "quantity"]);
      const quantity = item.quantity;
      if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) {
        throw invalid("La cantidad consumida debe ser mayor que cero.");
      }
      return { supplyId: readId(item.supplyId, "El insumo"), quantity };
    });
    if (new Set(supplies.map((item) => item.supplyId)).size !== supplies.length) {
      throw invalid("Hay insumos repetidos en la solicitud.");
    }
    return { supplies, notes: readOptionalText(d.notes, "Las notas", 500) };
  },
};

function parseUidList(value, label) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) throw invalid(`${label} no es válida.`);
  const ids = value.map((id) => readId(id, label));
  return [...new Set(ids)];
}

function parseSettingsInput(data) {
  if (!isObject(data)) throw invalid("La solicitud no es válida.");
  rejectUnknown(data, SETTINGS_KEYS);
  const changes = {};
  if (data.routing !== undefined) changes.routing = validateRouting(data.routing, JOB_TYPES, PRIORITIES);
  for (const key of ["certificateEnabled", "credentialEnabled"]) {
    if (data[key] === undefined) continue;
    if (typeof data[key] !== "boolean") throw invalid("Los interruptores deben ser verdadero o falso.");
    changes[key] = data[key];
  }
  if (data.statusAlerts !== undefined) {
    const a = data.statusAlerts;
    const allowed = ["queued", "confirmation", "quality", "partial", "completed", "cancelled"];
    if (!isObject(a) || typeof a.enabled !== "boolean" || !Array.isArray(a.statuses)
      || a.statuses.some((state) => !allowed.includes(state))) throw invalid("Selecciona alertas válidas.");
    changes.statusAlerts = { enabled: a.enabled, statuses: [...new Set(a.statuses)] };
  }
  if (data.inventoryRules !== undefined) changes.inventoryRules = parseInventoryRules(data.inventoryRules);
  if (data.defaults !== undefined) {
    if (!isObject(data.defaults)) throw invalid("Los valores predeterminados no son válidos.");
    rejectUnknown(data.defaults, [...CONFIG_KEYS, "mode"]);
    const patch = {};
    for (const [key, value] of Object.entries(data.defaults)) {
      if (value === undefined) continue;
      if (value === null) patch[key] = null;
      else if (key === "mode") {
        if (!MODES.includes(value)) throw invalid("El modo predeterminado no es válido.");
        patch.mode = value;
      } else Object.assign(patch, validateConfigFields({ [key]: value }));
    }
    changes.defaults = patch;
  }
  if (data.permissions !== undefined) {
    if (!isObject(data.permissions)) throw invalid("Los permisos no son válidos.");
    rejectUnknown(data.permissions, PERMISSION_KEYS);
    const patch = {};
    for (const [key, value] of Object.entries(data.permissions)) {
      if (value === undefined) continue;
      if (value === null) {
        patch[key] = null;
        continue;
      }
      if (!isObject(value)) throw invalid("Cada permiso debe ser un objeto.");
      rejectUnknown(value, ["operator", "allowUids", "denyUids"]);
      if (value.operator !== undefined && typeof value.operator !== "boolean") {
        throw invalid("El permiso de operadores debe ser verdadero o falso.");
      }
      const allowUids = parseUidList(value.allowUids, "La lista de personas permitidas");
      const denyUids = parseUidList(value.denyUids, "La lista de personas bloqueadas");
      if (allowUids && denyUids && allowUids.some((uid) => denyUids.includes(uid))) {
        throw invalid("Una persona no puede estar permitida y bloqueada a la vez.");
      }
      patch[key] = compact({ operator: value.operator, allowUids, denyUids });
    }
    changes.permissions = patch;
  }
  if (!Object.keys(changes).length) throw invalid("No hay cambios que guardar.");
  return { requestId: data.requestId === undefined ? null : readRequestId(data.requestId), changes };
}

function getPrintJobMovementId(jobId, actorUid, requestId) {
  const parts = [safeId(jobId, 60), safeId(actorUid, 40), safeId(requestId, 80)];
  if (parts.some((part) => !part)) throw invalid("Falta el identificador único de la operación.");
  return `print-job-${parts.join("-")}`;
}

function nextPartId(parts) {
  const max = parts.reduce((highest, part) => {
    const match = /^p(\d+)$/.exec(part.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `p${max + 1}`;
}

/* ---------- Fábrica ---------- */

function createPrintProductionHandlers({ db, FieldValue, HttpsError, getActor, now = () => Date.now() }) {
  const jobs = () => db.collection("printJobs");
  const settingsRef = () => db.collection("printSettings").doc("production");
  const operations = () => db.collection("printProductionOperations");

  function toHttps(error) {
    if (error instanceof PrintRuleError) return new HttpsError(error.code, error.message);
    if (error instanceof HttpsError) return error;
    console.error("printProduction", error);
    return new HttpsError("internal", "No se pudo completar la operación. Intenta de nuevo.");
  }

  const wrap = (handler) => async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      throw toHttps(error);
    }
  };

  async function resolveActor(request) {
    const actor = await getActor(request);
    if (!actor || !clean(actor.uid)) throw new PrintRuleError("unauthenticated", "Inicia sesión para continuar.");
    return actor;
  }

  // Transacción única: idempotencia por (uid, acción, requestId), permiso y efectos.
  async function execute({ actor, action, requestId, input, permission, run }) {
    const operationRef = requestId
      ? operations().doc(`op-${hash(`${actor.uid}\n${action}\n${requestId}`).slice(0, 48)}`)
      : null;
    const fingerprint = hash(stableStringify(input));
    return db.runTransaction(async (tx) => {
      if (operationRef) {
        const operation = await tx.get(operationRef);
        if (operation.exists) {
          const stored = operation.data();
          if (stored.fingerprint !== fingerprint) {
            throw conflict("El identificador de operación ya fue usado con otros datos.");
          }
          return { ...stored.result, alreadyApplied: true };
        }
      }
      const settings = readSettings(await tx.get(settingsRef()));
      assertCan(actor, settings, permission);
      const ctx = { tx, actor, settings, requestId, nowMs: now(), timestamp: FieldValue.serverTimestamp() };
      const result = await run(ctx);
      if (operationRef) {
        tx.create(operationRef, {
          uid: actor.uid,
          action,
          requestId,
          fingerprint,
          jobId: result.jobId || null,
          result,
          createdAt: ctx.timestamp,
        });
      }
      return { ...result, alreadyApplied: false };
    });
  }

  function audit(ctx) {
    return {
      updatedAt: ctx.timestamp,
      updatedByUid: ctx.actor.uid,
      updatedByName: clean(ctx.actor.name),
    };
  }

  function addEvent(ctx, parentRef, type, details = {}) {
    ctx.tx.create(parentRef.collection("events").doc(), {
      type,
      createdAt: ctx.timestamp,
      at: ctx.timestamp,
      byUid: ctx.actor.uid,
      byName: clean(ctx.actor.name),
      operationId: ctx.requestId || null,
      details,
    });
  }

  async function loadJob(ctx, jobRef) {
    const snapshot = await ctx.tx.get(jobRef);
    if (!snapshot.exists) throw notFound("No se encontró el trabajo de impresión.");
    return snapshot.data();
  }

  function commitParts(ctx, jobRef, job, parts, status, eventType, details = {}, extra = {}) {
    const dispatchPrinterIds = computeDispatchPrinterIds(status, parts);
    ctx.tx.update(jobRef, { ...extra, status, parts, dispatchPrinterIds, ...audit(ctx) });
    addEvent(ctx, jobRef, eventType, { ...details, from: job.status, to: status });
    return { jobId: jobRef.id, status, parts, dispatchPrinterIds };
  }

  function assertNoInFlight(job, verb) {
    const inFlight = (job.parts || []).some((part) => IN_FLIGHT_PART_STATUSES.includes(part.status))
      || IN_FLIGHT_PART_STATUSES.includes(job.status);
    if (inFlight) {
      throw precondition(`El trabajo ya está en impresión; no se puede ${verb} con seguridad. Usa la conciliación física.`);
    }
  }

  /* ----- save ----- */

  async function saveBody(ctx, input, jobRef) {
    const { tx, actor, settings } = ctx;
    const sourceRef = db.collection("printDocuments").doc(input.sourceId);
    const [jobSnapshot, sourceSnapshot, printersSnapshot, productSnapshot] = await Promise.all([
      input.jobId ? tx.get(jobRef) : null,
      tx.get(sourceRef),
      tx.get(db.collection("printPrinters")),
      input.productId ? tx.get(db.collection("printProducts").doc(input.productId)) : null,
    ]);

    let existing = null;
    if (input.jobId) {
      if (!jobSnapshot.exists) throw notFound("No se encontró el borrador.");
      existing = jobSnapshot.data();
      if (existing.status !== "draft") throw precondition("Solo se pueden editar trabajos en borrador.");
      if (existing.createdByUid !== actor.uid && actor.isAdmin !== true) {
        throw denied("Solo quien creó el borrador puede editarlo.");
      }
    }
    if (input.productId) {
      const product = productSnapshot.exists ? productSnapshot.data() : null;
      if (!product || product.active === false || product.deleted === true) {
        throw notFound("No se encontró el producto de inventario.");
      }
    }

    if (existing?.reprintOfJobId && (existing.source.id !== input.sourceId || existing.type !== input.type)) {
      throw conflict("Una reimpresión debe conservar el documento original.");
    }
    const source = verifySource(sourceSnapshot, {
      sourceId: input.sourceId,
      linkage: existing?.reprintOfJobId ? existing.source : null,
      ownerUid: existing?.source.id === input.sourceId ? existing.source.ownerUid : actor.uid,
      type: input.type,
      settings,
    });
    const defaults = effectiveDefaults(settings);
    const config = buildConfig(defaults.config, input.config);

    const printers = printersSnapshot.docs.map((doc) => normalizePrinter(doc.id, doc.data()));
    const routing = resolveRouting(settings.raw.routing, {
      type: input.type, pages: source.pages, config, groupId: input.groupId, mode: input.mode || defaults.mode,
    }, printers);
    const { mode, candidates, ...route } = routing;
    const byId = new Map(candidates.map((printer) => [printer.id, printer]));
    const partPrinterIds = input.parts.map((part) => part.printerId);
    if (input.printerIds.length && partPrinterIds.some((id) => !input.printerIds.includes(id))) {
      throw invalid("Las partes usan impresoras que no están en la selección.");
    }
    const explicitIds = [...new Set(input.printerIds.length ? input.printerIds : partPrinterIds)];
    const explicit = explicitIds.length > 0;
    let pool;
    if (explicit) {
      pool = explicitIds.map((id) => {
        const printer = byId.get(id);
        if (!printer || !printer.active) throw precondition("La selección contiene un equipo desactivado o fuera de la regla de distribución.");
        if (!input.draft && !isPrinterOnline(printer, ctx.nowMs)) {
          throw precondition(`La impresora «${printer.name}» no está en línea.`);
        }
        return printer;
      });
    } else {
      pool = input.draft ? [] : candidates.filter((printer) => isPrinterOnline(printer, ctx.nowMs));
    }

    let plan = { resolvedMode: mode, parts: [], etaMinutes: null };
    if (pool.length) {
      plan = planDistribution({ mode, config, pages: source.pages, printers: pool, explicit, parts: input.parts });
    } else if (!input.draft) {
      throw precondition(route.groupName ? `No hay impresoras disponibles que cumplan las condiciones en «${route.groupName}».` : "No hay impresoras en línea disponibles.");
    }

    const planToken = hash(stableStringify([route.groupId, route.ruleId, plan.resolvedMode,
      plan.parts.map(({ printerId, from, to, copies }) => ({ printerId, from, to, copies }))]));
    if (input.preview) return { ...plan, route, planToken };
    if (!input.draft && input.planToken && input.planToken !== planToken) {
      throw precondition("La distribución cambió. Vuelve a revisar las asignaciones antes de confirmar.");
    }
    const status = input.draft ? "draft" : "queued";
    const parts = plan.parts.map((part) => ({ ...part, status }));
    const dispatchPrinterIds = computeDispatchPrinterIds(status, parts);
    const fields = {
      title: input.title,
      type: input.type,
      priority: config.priority || existing?.priority || "normal",
      status,
      source,
      config,
      mode,
      resolvedMode: plan.resolvedMode,
      route,
      parts,
      dispatchPrinterIds,
      estimate: { etaMinutes: plan.etaMinutes },
      productId: input.productId || "",
      requestId: source.requestId || "",
      ...audit(ctx),
    };
    if (existing) {
      tx.update(jobRef, fields);
    } else {
      tx.create(jobRef, {
        id: jobRef.id,
        priority: "normal",
        accepted: 0,
        rejected: 0,
        inventoried: 0,
        delivered: 0,
        reprintCount: 0,
        createdAt: ctx.timestamp,
        createdByUid: actor.uid,
        createdByName: clean(actor.name),
        ...fields,
      });
    }
    const eventType = input.draft
      ? (existing ? "draft_updated" : "draft_created")
      : (existing ? "draft_submitted" : "enqueued");
    addEvent(ctx, jobRef, eventType, {
      mode,
      resolvedMode: plan.resolvedMode,
      parts: parts.length,
      printerIds: dispatchPrinterIds,
    });
    return {
      jobId: jobRef.id,
      status,
      draft: input.draft,
      mode,
      resolvedMode: plan.resolvedMode,
      route,
      parts,
      dispatchPrinterIds,
      etaMinutes: plan.etaMinutes,
    };
  }

  /* ----- inventario compartido (calidad automática y entrada manual) ----- */

  // Solo lecturas. El stock es global por producto; el destino operativo es una etiqueta, no un stock.
  async function readInventoryTarget(ctx, job) {
    const productId = clean(job.productId);
    if (!productId) return { problem: "El trabajo no tiene un producto de inventario asociado." };
    const [productSnapshot, inventorySnapshot] = await Promise.all([
      ctx.tx.get(db.collection("printProducts").doc(productId)),
      ctx.tx.get(db.collection("printFinishedInventory").where("productId", "==", productId)),
    ]);
    const product = productSnapshot.exists ? productSnapshot.data() : null;
    if (!product || product.active === false || product.deleted === true) {
      return { problem: "No se encontró el producto activo del inventario." };
    }
    const active = inventorySnapshot.docs.filter((item) => item.data().active !== false && item.data().deleted !== true);
    const inventoryDoc = active[0] || inventorySnapshot.docs[0];
    const inventory = inventoryDoc ? inventoryDoc.data() : {};
    const stock = inventory.currentStock;
    let discrepancy = "";
    if (active.length > 1) discrepancy = "Hay más de un registro de inventario activo para el producto.";
    else if (stock !== undefined && (typeof stock !== "number" || !Number.isFinite(stock) || stock < 0)) {
      discrepancy = "El stock registrado del producto no es válido.";
    }
    return {
      productId,
      product,
      inventory,
      inventoryRef: inventoryDoc ? inventoryDoc.ref : db.collection("printFinishedInventory").doc(productId),
      discrepancy,
    };
  }

  // Solo escrituras: stock + movimiento. Devuelve los campos del trabajo para que quien llama los fusione.
  function writeInventoryEntry(ctx, jobRef, job, target, { quantity, movementRef, reason, notes, rule, automatic }) {
    const { productId, product, inventory, inventoryRef } = target;
    const previousStock = num(inventory.currentStock);
    const newStock = previousStock + quantity;
    ctx.tx.set(inventoryRef, {
      productId,
      productName: clean(product.name),
      category: clean(product.category || "Libro"),
      level: clean(product.level || "No aplica"),
      unit: clean(product.unit || "Libro"),
      currentStock: newStock,
      minStock: num(inventory.minStock ?? product.minStock),
      idealStock: num(inventory.idealStock ?? product.idealStock),
      active: true,
      deleted: false,
      notes: clean(inventory.notes),
      lastPrintJobId: jobRef.id,
      ...audit(ctx),
    }, { merge: true });
    ctx.tx.create(movementRef, {
      inventoryId: inventoryRef.id,
      productId,
      productName: clean(product.name),
      type: "Entrada",
      quantity,
      reason,
      previousStock,
      newStock,
      notes,
      warehouse: rule?.warehouse || "",
      sku: rule?.sku || "",
      ruleId: rule?.id || "",
      automatic,
      jobId: jobRef.id,
      jobTitle: clean(job.title),
      createdAt: ctx.timestamp,
      createdByUid: ctx.actor.uid,
      createdByName: clean(ctx.actor.name),
      createdByEmail: clean(ctx.actor.email),
    });
    return {
      previousStock,
      newStock,
      inventoryId: inventoryRef.id,
      jobFields: {
        inventoried: num(job.inventoried) + quantity,
        lastInventoryMovementId: movementRef.id,
        inventoryWarehouse: rule?.warehouse || "",
        inventorySku: rule?.sku || "",
        inventorySync: { status: "done", movementId: movementRef.id, at: new Date(ctx.nowMs).toISOString() },
      },
    };
  }

  /* ----- acciones ----- */

  const handlers = {
    async pause(ctx, jobRef, args) {
      const job = await loadJob(ctx, jobRef);
      assertNoInFlight(job, "pausar");
      if (job.status !== "queued") throw precondition("Solo se puede pausar un trabajo que está en cola.");
      const parts = job.parts.map((part) => (part.status === "queued" ? { ...part, status: "paused" } : part));
      return commitParts(ctx, jobRef, job, parts, "paused", "paused", { reason: args.reason });
    },

    async resume(ctx, jobRef, args) {
      const job = await loadJob(ctx, jobRef);
      if (job.status !== "paused") throw precondition("Solo se puede reanudar un trabajo en pausa.");
      const parts = job.parts.map((part) => (part.status === "paused" ? { ...part, status: "queued" } : part));
      return commitParts(ctx, jobRef, job, parts, "queued", "resumed", { reason: args.reason });
    },

    async cancel(ctx, jobRef, args) {
      const job = await loadJob(ctx, jobRef);
      assertNoInFlight(job, "cancelar");
      if (!["draft", "queued", "paused"].includes(job.status)) {
        throw precondition("Solo se puede cancelar un borrador o un trabajo en cola o en pausa.");
      }
      const parts = job.parts.map((part) => (part.status === "completed" || part.status === "cancelled"
        ? part
        : { ...part, status: "cancelled", pendingRemainder: false }));
      const status = parts.length ? deriveJobStatus(parts, job) : "cancelled";
      return commitParts(ctx, jobRef, job, parts, status, "cancelled", { reason: args.reason }, {
        cancelReason: args.reason,
      });
    },

    async priority(ctx, jobRef, args) {
      const job = await loadJob(ctx, jobRef);
      if (["completed", "cancelled"].includes(job.status)) {
        throw precondition("No se puede cambiar la prioridad de un trabajo terminado o cancelado.");
      }
      ctx.tx.update(jobRef, { priority: args.priority, ...audit(ctx) });
      addEvent(ctx, jobRef, "priority_changed", { from: job.priority || "normal", to: args.priority });
      return { jobId: jobRef.id, status: job.status, priority: args.priority };
    },

    async note(ctx, jobRef, args) {
      const job = await loadJob(ctx, jobRef);
      ctx.tx.update(jobRef, { lastNote: args.note, ...audit(ctx) });
      addEvent(ctx, jobRef, "note", { note: args.note });
      return { jobId: jobRef.id, status: job.status };
    },

    async reprint(ctx, jobRef, args, newJobRef) {
      const original = await loadJob(ctx, jobRef);
      if (!REPRINTABLE_STATUSES.has(original.status)) {
        throw precondition("Solo se puede reimprimir un trabajo terminado, cancelado o en revisión.");
      }
      const linkage = original.source;
      const sourceSnapshot = await ctx.tx.get(db.collection("printDocuments").doc(linkage.id));
      // Se vuelve a validar el vínculo original; nunca se emite nada nuevo.
      const source = verifySource(sourceSnapshot, {
        sourceId: linkage.id,
        ownerUid: linkage.ownerUid,
        type: original.type,
        settings: ctx.settings,
        linkage,
      });
      const copies = args.copies === null ? original.config.copies : args.copies;
      if (copies > original.config.copies) {
        throw invalid(`La reimpresión no puede superar las copias del trabajo original (${original.config.copies}).`);
      }
      ctx.tx.create(newJobRef, {
        id: newJobRef.id,
        title: `${original.title} (reimpresión)`.slice(0, 120),
        type: original.type,
        status: "draft",
        priority: "normal",
        source,
        config: { ...original.config, copies },
        mode: original.mode,
        resolvedMode: original.resolvedMode || original.mode,
        parts: [],
        dispatchPrinterIds: [],
        estimate: { etaMinutes: null },
        productId: original.productId || "",
        requestId: source.requestId || "",
        accepted: 0,
        rejected: 0,
        inventoried: 0,
        delivered: 0,
        reprintCount: 0,
        reprintOfJobId: jobRef.id,
        reprintReason: args.reason,
        createdAt: ctx.timestamp,
        createdByUid: ctx.actor.uid,
        createdByName: clean(ctx.actor.name),
        ...audit(ctx),
      });
      ctx.tx.update(jobRef, {
        reprintCount: num(original.reprintCount) + 1,
        lastReprintJobId: newJobRef.id,
        ...audit(ctx),
      });
      addEvent(ctx, newJobRef, "reprint_created", { reprintOfJobId: jobRef.id, reason: args.reason, copies });
      addEvent(ctx, jobRef, "reprint_requested", { newJobId: newJobRef.id, reason: args.reason, copies });
      return { jobId: newJobRef.id, reprintOfJobId: jobRef.id, status: "draft", copies };
    },

    async reconcile(ctx, jobRef, args) {
      const job = await loadJob(ctx, jobRef);
      if (job.status === "completed") throw precondition("El trabajo ya está completo.");
      const index = job.parts.findIndex((part) => part.id === args.partId);
      if (index < 0) throw notFound("No se encontró la parte indicada.");
      const part = job.parts[index];
      const inFlight = IN_FLIGHT_PART_STATUSES.includes(part.status);

      let printer = null;
      if (args.reassignPrinterId) {
        const doc = await ctx.tx.get(db.collection("printPrinters").doc(args.reassignPrinterId));
        printer = doc.exists ? normalizePrinter(doc.id, doc.data()) : null;
        if (!printer || !printer.active) throw notFound("No se encontró la impresora destino.");
        if (job.route?.groupId) {
          const group = ctx.settings.raw.routing?.groups?.find((item) => item.id === job.route.groupId);
          if (!(group?.printerIds || job.route.groupPrinterIds || []).includes(printer.id)) throw precondition("La impresora destino debe pertenecer al grupo del trabajo.");
        }
        if (!isPrinterOnline(printer, ctx.nowMs)) throw precondition(`La impresora «${printer.name}» no está en línea.`);
        assertPrinterSupports(printer, job.config, {
          from: part.from, to: part.to, pages: job.source.pages, copies: part.copies,
        });
      }

      const record = compact({
        outcome: args.outcome,
        byUid: ctx.actor.uid,
        at: new Date(ctx.nowMs).toISOString(),
        note: args.note || undefined,
      });
      const parts = job.parts.map((item) => ({ ...item }));
      const replacement = (id) => ({
        id,
        printerId: printer.id,
        agentId: printer.agentId,
        printerName: printer.name,
        queue: printer.queue,
        from: part.from,
        to: part.to,
        copies: part.copies,
        status: job.status === "paused" ? "paused" : "queued",
        etaMinutes: null,
        replacesPartId: part.id,
      });

      if (part.dispatchState === "submitting" && ctx.nowMs - (part.startedAt?.toMillis?.() ?? new Date(part.startedAt).getTime()) < 120000) {
        throw precondition("El agente está enviando el trabajo. Espera su respuesta antes de conciliar.");
      }
      if (args.outcome === "partial") {
        if (!inFlight || (args.printedCopies === null) === (args.printedThrough === null)) {
          throw invalid("Indica las copias completas o la última página confirmada de todas las copias.");
        }
        const remainder = { from: part.from, to: part.to, copies: part.copies };
        const confirmed = { ...part, status: "completed", reconcile: record };
        if (args.printedCopies !== null) {
          if (args.printedCopies >= part.copies) throw invalid("Debe quedar al menos una copia pendiente.");
          confirmed.copies = args.printedCopies;
          remainder.copies -= args.printedCopies;
        } else {
          const end = args.printedThrough;
          const group = job.config.layout === "booklet" ? 4 : job.config.duplex ? 2 : 1;
          if (end < part.from || end >= part.to || (end - part.from + 1) % group) throw invalid("El corte deja una hoja o un cuadernillo incompleto.");
          confirmed.to = end;
          remainder.from = end + 1;
        }
        parts[index] = confirmed;
        const id = nextPartId(parts);
        if (printer) parts.push({ ...replacement(id), ...remainder });
        else parts.push({ id, printerId: part.printerId, ...remainder, replacesPartId: part.id,
          status: "cancelled", pendingRemainder: true });
      } else if (args.outcome === "printed" || args.outcome === "unknown" || args.outcome === "not_printed") {
        if (!inFlight) throw precondition("Solo se concilian partes enviadas a imprimir o en confirmación.");
        if (args.outcome === "printed") {
          parts[index] = { ...part, status: "completed", reconcile: record };
        } else if (args.outcome === "unknown") {
          // Entrega desconocida: queda en confirmación, sin reintento automático.
          parts[index] = { ...part, status: "confirmation", reconcile: { ...record, autoRetry: false } };
        } else {
          const newId = printer ? nextPartId(parts) : null;
          parts[index] = {
            ...part,
            status: "cancelled",
            pendingRemainder: !printer,
            ...(printer ? { reassignedTo: newId } : {}),
            reconcile: record,
          };
          if (printer) parts.push(replacement(newId));
        }
      } else if (["queued", "paused"].includes(part.status)) {
        parts[index] = {
          ...part,
          printerId: printer.id,
          agentId: printer.agentId,
          printerName: printer.name,
          queue: printer.queue,
          reassignedFromPrinterId: part.printerId,
          reconcile: record,
        };
      } else if (part.status === "cancelled" && part.pendingRemainder === true) {
        const newId = nextPartId(parts);
        parts[index] = { ...part, pendingRemainder: false, reassignedTo: newId, reconcile: record };
        parts.push(replacement(newId));
      } else {
        throw precondition("Esta parte no tiene un remanente pendiente que reasignar.");
      }

      const status = deriveJobStatus(parts, job);
      const result = commitParts(ctx, jobRef, job, parts, status, "reconciled", {
        partId: part.id,
        outcome: args.outcome,
        reassignPrinterId: args.reassignPrinterId,
        note: args.note,
      });
      return { ...result, partId: part.id, outcome: args.outcome };
    },

    async quality(ctx, jobRef, args) {
      const job = await loadJob(ctx, jobRef);
      if (!QUALITY_STATUSES.has(job.status)) {
        throw precondition("La calidad se registra cuando el trabajo está en confirmación, calidad o parcial.");
      }
      if (!job.parts?.length || job.parts.some((part) => part.pendingRemainder
        || !["completed", "cancelled"].includes(part.status))) {
        throw precondition("Concilia las partes y verifica el ensamblaje antes de aprobar unidades.");
      }
      const requested = num(job.config.copies);
      const accepted = num(job.accepted) + args.accepted;
      const rejected = num(job.rejected) + args.rejected;
      if (accepted > requested) {
        throw invalid(`Los aprobados acumulados (${accepted}) superarían las copias solicitadas (${requested}).`);
      }
      let status = "quality";
      if (accepted >= requested) status = "completed";
      else if (rejected > 0 && accepted + rejected >= requested) status = "partial";

      // Ingreso automático: solo con regla de admin, destino y cantidad salen de la regla y de este lote.
      const rule = args.delivery === "direct" ? null : matchInventoryRule(ctx.settings, job);
      const auto = rule?.automatic === true && rule.classification === "inventory" && args.accepted > 0;
      const target = auto ? await readInventoryTarget(ctx, job) : null;
      const problem = target ? (target.problem || target.discrepancy) : "";
      let jobFields = {};
      let inventoryAuto = { status: "off" };
      if (args.delivery === "direct" && args.accepted > 0) inventoryAuto = { status: "skipped" };
      if (auto && problem) {
        // La calidad se guarda igual; la entrada queda pendiente para reintento manual (acción inventory).
        inventoryAuto = { status: "discrepancy", reason: problem };
        jobFields = {
          inventorySync: {
            status: "discrepancy", reason: problem, ruleId: rule.id, quantity: args.accepted, at: new Date(ctx.nowMs).toISOString(),
          },
        };
      }
      if (auto && !problem) {
        const movementRef = db.collection("printInventoryMovements")
          .doc(getPrintJobMovementId(jobRef.id, ctx.actor.uid, ctx.requestId).replace("print-job-", "print-job-auto-"));
        const entry = writeInventoryEntry(ctx, jobRef, job, target, {
          quantity: args.accepted,
          movementRef,
          reason: "Aprobación de calidad (ingreso automático)",
          notes: `Ingreso automático desde el trabajo de impresión ${clean(job.title)}.`,
          rule,
          automatic: true,
        });
        jobFields = entry.jobFields;
        inventoryAuto = { status: "done", movementId: movementRef.id, quantity: args.accepted };
      }
      ctx.tx.update(jobRef, { accepted, rejected, status, ...jobFields, ...audit(ctx) });
      addEvent(ctx, jobRef, "quality_reviewed", {
        accepted: args.accepted,
        rejected: args.rejected,
        notes: args.notes,
        totalAccepted: accepted,
        totalRejected: rejected,
        from: job.status,
        to: status,
        inventoryAuto,
      });
      return {
        jobId: jobRef.id,
        status,
        accepted,
        rejected,
        requested,
        pendingUnits: requested - accepted,
        inventoryPending: accepted - num(jobFields.inventoried ?? job.inventoried) - num(job.delivered),
        inventoryAuto,
      };
    },

    async inventory(ctx, jobRef, args) {
      const job = await loadJob(ctx, jobRef);
      if (job.status === "cancelled") throw precondition("Un trabajo cancelado no admite movimientos.");
      const inventoried = num(job.inventoried);
      const delivered = num(job.delivered);
      const pending = num(job.accepted) - inventoried - delivered;
      if (pending <= 0) throw precondition("No hay unidades aprobadas pendientes de entrega o ingreso.");
      const quantity = args.quantity === null ? pending : args.quantity;
      if (quantity > pending) throw invalid(`Solo hay ${pending} unidades aprobadas pendientes.`);
      const rule = matchInventoryRule(ctx.settings, job);
      const personalizedBlocked = PERSONALIZED_TYPES.has(job.type) && rule?.classification !== "inventory";
      const defaultsToDirect = !job.productId || personalizedBlocked || (rule && rule.classification !== "inventory");
      const delivery = args.delivery || (defaultsToDirect ? "direct" : "inventory");

      if (delivery === "direct") {
        ctx.tx.update(jobRef, { delivered: delivered + quantity, ...audit(ctx) });
        addEvent(ctx, jobRef, "delivered_direct", { quantity });
        return {
          jobId: jobRef.id, delivery, quantity, delivered: delivered + quantity, inventoried, pendingUnits: pending - quantity,
        };
      }

      if (personalizedBlocked) throw precondition("Este documento personalizado está configurado para entrega directa.");
      if (!clean(job.productId)) throw precondition("El trabajo no tiene un producto de inventario asociado.");
      const target = await readInventoryTarget(ctx, job);
      if (target.problem) throw notFound(target.problem);
      const movementRef = db.collection("printInventoryMovements")
        .doc(getPrintJobMovementId(jobRef.id, ctx.actor.uid, ctx.requestId));
      const entry = writeInventoryEntry(ctx, jobRef, job, target, {
        quantity,
        movementRef,
        reason: "Trabajo de impresión aprobado",
        notes: `Ingreso desde el trabajo de impresión ${clean(job.title)}.`,
        rule,
        automatic: false,
      });
      ctx.tx.update(jobRef, { ...entry.jobFields, ...audit(ctx) });
      addEvent(ctx, jobRef, "inventoried", { quantity, movementId: movementRef.id, inventoryId: entry.inventoryId });
      const { previousStock, newStock, inventoryId } = entry;
      return {
        jobId: jobRef.id,
        delivery,
        movementId: movementRef.id,
        inventoryId,
        quantity,
        previousStock,
        newStock,
        inventoried: inventoried + quantity,
        pendingUnits: pending - quantity,
      };
    },

    async consume(ctx, jobRef, args) {
      const job = await loadJob(ctx, jobRef);
      if (job.status === "draft") throw precondition("Un borrador no puede consumir insumos.");
      if (job.status === "cancelled") throw precondition("Un trabajo cancelado no puede consumir insumos.");
      const refs = args.supplies.map((item) => db.collection("printSupplyItems").doc(item.supplyId));
      const snapshots = await Promise.all(refs.map((ref) => ctx.tx.get(ref)));
      const lines = snapshots.map((snapshot, index) => {
        const data = snapshot.exists ? snapshot.data() : null;
        if (!data || data.deleted === true || data.active === false) {
          throw notFound(`No se encontró el insumo ${args.supplies[index].supplyId}.`);
        }
        const quantity = args.supplies[index].quantity;
        const previousStock = num(data.currentStock);
        if (quantity > previousStock) {
          throw precondition(`Stock insuficiente de «${clean(data.name)}»: hay ${previousStock} y se consumen ${quantity}.`);
        }
        return { ref: refs[index], data, quantity, previousStock, newStock: previousStock - quantity };
      });

      const baseId = getPrintJobMovementId(jobRef.id, ctx.actor.uid, ctx.requestId).replace("print-job-", "print-job-supply-");
      const movements = lines.map((line, index) => {
        const movementRef = db.collection("printSupplyMovements").doc(`${baseId}-${index + 1}`);
        ctx.tx.update(line.ref, {
          currentStock: line.newStock,
          lastMovementAt: ctx.timestamp,
          lastMovementType: "Salida",
          lastMovementReason: "Consumo de trabajo de impresión",
          ...audit(ctx),
        });
        ctx.tx.create(movementRef, {
          supplyId: line.ref.id,
          supplyName: clean(line.data.name),
          category: clean(line.data.category),
          type: "Salida",
          quantity: line.quantity,
          stockUnit: clean(line.data.stockUnit) || "Pieza",
          contentQuantity: num(line.data.contentQuantity),
          contentUnit: clean(line.data.contentUnit),
          expectedYield: num(line.data.expectedYield),
          expectedYieldUnit: clean(line.data.expectedYieldUnit),
          previousStock: line.previousStock,
          newStock: line.newStock,
          reason: "Consumo de trabajo de impresión",
          relatedType: "Trabajo de impresión",
          relatedId: jobRef.id,
          relatedFolio: clean(job.title),
          wasteQuantity: 0,
          notes: args.notes,
          createdAt: ctx.timestamp,
          createdByUid: ctx.actor.uid,
          createdByName: clean(ctx.actor.name),
          createdByEmail: clean(ctx.actor.email),
        });
        return {
          supplyId: line.ref.id, quantity: line.quantity, movementId: movementRef.id, newStock: line.newStock,
        };
      });
      ctx.tx.update(jobRef, { lastSuppliesAt: ctx.timestamp, ...audit(ctx) });
      addEvent(ctx, jobRef, "supplies_consumed", { supplies: movements, notes: args.notes });
      return { jobId: jobRef.id, status: job.status, supplies: movements };
    },
  };

  /* ----- settings ----- */

  async function applySettings(ctx, changes) {
    const current = ctx.settings.raw;
    const next = { ...current };
    if (changes.routing) {
      if ((current.routing?.revision ?? 0) !== changes.routing.revision) {
        throw new HttpsError("aborted", "La configuración cambió. Vuelve a abrir el formulario.");
      }
      const ids = [...new Set(changes.routing.groups.flatMap((group) => group.printerIds))];
      const printers = await Promise.all(ids.map((id) => ctx.tx.get(db.collection("printPrinters").doc(id))));
      if (printers.some((printer) => !printer.exists)) throw invalid("Uno de los grupos contiene una impresora inexistente.");
      next.routing = { ...changes.routing, revision: changes.routing.revision + 1 };
    }
    // Los interruptores solo se escriben cuando la solicitud los trae de forma explícita.
    for (const key of ["certificateEnabled", "credentialEnabled", "statusAlerts", "inventoryRules"]) {
      if (key in changes) next[key] = changes[key];
    }
    for (const key of ["defaults", "permissions"]) {
      if (!(key in changes)) continue;
      const merged = { ...(isObject(current[key]) ? current[key] : {}) };
      for (const [name, value] of Object.entries(changes[key])) {
        if (value === null) delete merged[name];
        else merged[name] = value;
      }
      next[key] = merged;
    }
    Object.assign(next, audit(ctx));
    ctx.tx.set(settingsRef(), next);
    const pick = (data) => Object.fromEntries(Object.keys(changes).map((key) => [key, data[key] === undefined ? null : data[key]]));
    addEvent(ctx, settingsRef(), "settings_updated", { changed: Object.keys(changes), before: pick(current), after: pick(next) });
    return { settings: publicSettings(viewSettings(next)), changed: Object.keys(changes) };
  }

  /* ----- onCall ----- */

  const save = wrap(async (request) => {
    const actor = await resolveActor(request);
    const input = parseSaveInput(request?.data);
    const jobRef = input.jobId ? jobs().doc(input.jobId) : jobs().doc();
    return execute({
      actor,
      action: "save",
      requestId: input.requestId,
      input,
      permission: "create",
      run: (ctx) => saveBody(ctx, input, jobRef),
    });
  });

  const action = wrap(async (request) => {
    const actor = await resolveActor(request);
    const data = request?.data;
    if (!isObject(data)) throw invalid("La solicitud no es válida.");
    const name = data.action;
    if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(ACTION_ARGS, name)) {
      throw invalid("La acción solicitada no es válida.");
    }
    rejectUnknown(data, ["jobId", "action", "requestId", ...ACTION_ARGS[name]]);
    const requestId = readRequestId(data.requestId);
    const jobId = readId(data.jobId, "El trabajo");
    const args = ACTION_PARSERS[name](data);
    const jobRef = jobs().doc(jobId);
    const newJobRef = name === "reprint" ? jobs().doc() : null;
    return execute({
      actor,
      action: name,
      requestId,
      input: { jobId, ...args },
      permission: ACTION_PERMISSIONS[name],
      run: (ctx) => handlers[name](ctx, jobRef, args, newJobRef),
    });
  });

  const settings = wrap(async (request) => {
    const actor = await resolveActor(request);
    if (actor.isAdmin !== true) throw denied("Solo un administrador puede cambiar la configuración de Imprenta.");
    const { requestId, changes } = parseSettingsInput(request?.data);
    return execute({
      actor,
      action: "settings",
      requestId,
      input: changes,
      permission: "admin",
      run: (ctx) => applySettings(ctx, changes),
    });
  });

  return { save, action, settings };
}

module.exports = {
  ACTION_PERMISSIONS,
  JOB_TYPES,
  OPERATOR_DEFAULTS,
  PERMISSION_KEYS,
  canDo,
  createPrintProductionHandlers,
  getPrintJobMovementId,
  matchInventoryRule,
  readSettings,
  verifySource,
};
