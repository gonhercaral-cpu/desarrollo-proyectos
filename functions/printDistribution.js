"use strict";

const ONLINE_WINDOW_MS = 120 * 1000;
const MAX_DEVICES = 30;
const MAX_PAGES = 10000;
const MAX_COPIES = 999;
const MODES = Object.freeze(["single", "pages", "copies", "smart"]);

const QUALITY_VALUES = Object.freeze(["draft", "normal", "high"]);
const ORDER_VALUES = Object.freeze(["normal", "reverse"]);
const ORIENTATION_VALUES = Object.freeze(["auto", "portrait", "landscape"]);
const PAGES_PER_SHEET_VALUES = Object.freeze([1, 2, 4, 6, 9, 16]);
const LAYOUT_VALUES = Object.freeze(["standard", "booklet"]);
const CONFIG_KEYS = Object.freeze([
  "copies", "paper", "color", "duplex", "quality", "order", "orientation",
  "pagesPerSheet", "tray", "collate", "layout", "finishing", "priority", "dueDate", "notes",
]);
const CONFIG_BASE = Object.freeze({
  copies: 1,
  color: false,
  duplex: false,
  quality: "normal",
  order: "normal",
  orientation: "auto",
  pagesPerSheet: 1,
  tray: "",
  collate: true,
  layout: "standard",
});

const IN_FLIGHT_PART_STATUSES = Object.freeze(["printing", "submitted", "confirmation"]);
const NON_DISPATCHABLE_JOB_STATUSES = new Set(["draft", "paused", "cancelled", "completed"]);

class PrintRuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PrintRuleError";
    this.code = code;
  }
}

const invalid = (message) => new PrintRuleError("invalid-argument", message);
const precondition = (message) => new PrintRuleError("failed-precondition", message);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toMillis(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (isObject(value) && Number.isFinite(value.seconds)) {
    return value.seconds * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/* ---------- Configuración de impresión ---------- */

function integerIn(value, min, max, message) {
  if (!Number.isInteger(value) || value < min || value > max) throw invalid(message);
  return value;
}

function booleanOf(value, message) {
  if (typeof value !== "boolean") throw invalid(message);
  return value;
}

function oneOf(value, list, message) {
  if (!list.includes(value)) throw invalid(message);
  return value;
}

function boundedText(value, min, max, message) {
  const text = cleanText(value);
  if (text.length < min || text.length > max) throw invalid(message);
  return text;
}

const CONFIG_VALIDATORS = Object.freeze({
  copies: (value) => integerIn(value, 1, MAX_COPIES, `Las copias deben ser un entero entre 1 y ${MAX_COPIES}.`),
  paper: (value) => boundedText(value, 1, 40, "El tamaño de papel no es válido."),
  color: (value) => booleanOf(value, "El color debe ser verdadero o falso."),
  duplex: (value) => booleanOf(value, "La doble cara debe ser verdadera o falsa."),
  collate: (value) => booleanOf(value, "El intercalado debe ser verdadero o falso."),
  quality: (value) => oneOf(value, QUALITY_VALUES, "La calidad de impresión no es válida."),
  order: (value) => oneOf(value, ORDER_VALUES, "El orden de impresión no es válido."),
  orientation: (value) => oneOf(value, ORIENTATION_VALUES, "La orientación no es válida."),
  pagesPerSheet: (value) => oneOf(value, PAGES_PER_SHEET_VALUES, "Las páginas por hoja no son válidas."),
  layout: (value) => oneOf(value, LAYOUT_VALUES, "El formato de salida no es válido."),
  tray: (value) => {
    if (typeof value !== "string" || value.trim().length > 40) throw invalid("La bandeja no es válida.");
    return value.trim();
  },
  priority: (value) => oneOf(value, ["low", "normal", "high", "urgent"], "La prioridad es inválida."),
  notes: (value) => boundedText(value, 0, 500, "Las observaciones admiten hasta 500 caracteres."),
  dueDate: (value) => {
    if (!value) return "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString().slice(0, 10) !== value) throw invalid("La fecha de entrega es inválida.");
    return value;
  },
  finishing: (value) => {
    if (!Array.isArray(value) || value.length > 8) throw invalid("Los acabados no son válidos.");
    const items = value.map((item) => boundedText(item, 1, 80, "Cada acabado debe tener entre 1 y 80 caracteres."));
    return [...new Set(items)];
  },
});

// Valida solo los campos presentes; rechaza cualquier opción fuera de la lista permitida.
function validateConfigFields(input) {
  if (input === undefined || input === null) return {};
  if (!isObject(input)) throw invalid("La configuración de impresión no es válida.");
  const unknown = Object.keys(input).filter((key) => !CONFIG_KEYS.includes(key));
  if (unknown.length) throw invalid(`Opciones de impresión no permitidas: ${unknown.join(", ")}.`);
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    output[key] = CONFIG_VALIDATORS[key](value);
  }
  return output;
}

// Los acabados son instrucciones para el operador; nunca se envían como opción física.
function buildConfig(defaults = {}, input = {}) {
  const config = { ...CONFIG_BASE, finishing: [], ...defaults, ...input };
  if (!config.paper) throw invalid("Indica el tamaño de papel.");
  if (config.layout === "booklet") {
    if (!config.duplex) throw invalid("El folleto requiere impresión a doble cara.");
    if (config.pagesPerSheet !== 1) throw invalid("El folleto no admite varias páginas por hoja.");
  }
  return config;
}

/* ---------- Impresoras ---------- */

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function toList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item !== null && item !== undefined && item !== "")
    .map((item) => (typeof item === "string" ? item.trim() : item));
}

function normalizePrinter(id, data = {}) {
  const caps = isObject(data.capabilities) ? data.capabilities : {};
  return {
    id: cleanText(id),
    agentId: cleanText(data.agentId),
    name: cleanText(data.name) || cleanText(id),
    queue: cleanText(data.queue),
    online: data.online === true,
    active: data.active !== false && data.deleted !== true,
    color: data.color === true || caps.color === true,
    duplex: data.duplex === true || caps.duplex === true,
    paperSizes: toList(Array.isArray(data.paperSizes) ? data.paperSizes : caps.paperSizes),
    lastSeenMs: toMillis(data.lastSeenAt),
    capabilities: {
      pagesPerMinute: positiveNumber(caps.pagesPerMinute),
      queuedPages: Math.max(0, Number(caps.queuedPages) || 0),
      maxCopies: positiveNumber(caps.maxCopies),
      pageRange: caps.pageRange === true,
      booklet: caps.booklet === true,
      quality: toList(caps.quality),
      order: toList(caps.order),
      orientation: toList(caps.orientation),
      pagesPerSheet: toList(caps.pagesPerSheet).map(Number),
      trays: toList(caps.trays),
    },
  };
}

// En línea = el agente lo marca así y su latido es reciente (≤120 s).
function isPrinterOnline(printer, nowMs) {
  if (!printer || !printer.online || !printer.active || !printer.agentId || !printer.queue) return false;
  if (!printer.lastSeenMs) return false;
  const age = nowMs - printer.lastSeenMs;
  return age <= ONLINE_WINDOW_MS && age >= -ONLINE_WINDOW_MS;
}

function selectOnlinePrinters(printers, nowMs) {
  return printers
    .filter((printer) => isPrinterOnline(printer, nowMs))
    .sort(byPrinterId);
}

function byPrinterId(first, second) {
  return first.id < second.id ? -1 : first.id > second.id ? 1 : 0;
}

function printerSupportProblems(printer, config, range) {
  const caps = printer.capabilities;
  const problems = [];
  if (config.color && !printer.color) problems.push("no imprime a color");
  if (config.duplex && !printer.duplex) problems.push("no imprime a doble cara");
  const paper = String(config.paper).toLowerCase();
  if (!printer.paperSizes.some((size) => String(size).toLowerCase() === paper)) {
    problems.push(`no tiene papel ${config.paper}`);
  }
  if (config.quality !== "normal" && !caps.quality.includes(config.quality)) {
    problems.push(`no admite la calidad ${config.quality}`);
  }
  if (config.order !== "normal" && !caps.order.includes(config.order)) {
    problems.push(`no admite el orden ${config.order}`);
  }
  if (config.orientation !== "auto" && !caps.orientation.includes(config.orientation)) {
    problems.push(`no admite la orientación ${config.orientation}`);
  }
  if (config.pagesPerSheet > 1 && !caps.pagesPerSheet.includes(config.pagesPerSheet)) {
    problems.push(`no admite ${config.pagesPerSheet} páginas por hoja`);
  }
  if (config.tray && !caps.trays.includes(config.tray)) problems.push(`no tiene la bandeja ${config.tray}`);
  if (config.layout === "booklet" && !caps.booklet) problems.push("no admite formato folleto");
  if (range) {
    if ((range.from > 1 || range.to < range.pages) && !caps.pageRange) {
      problems.push("no admite rangos de páginas");
    }
    if (caps.maxCopies && range.copies > caps.maxCopies) {
      problems.push(`admite como máximo ${caps.maxCopies} copias por parte`);
    }
  }
  return problems;
}

function assertPrinterSupports(printer, config, range) {
  const problems = printerSupportProblems(printer, config, range);
  if (problems.length) throw precondition(`La impresora «${printer.name}» ${problems.join(", ")}.`);
}

/* ---------- Distribución ---------- */

// Páginas indivisibles: una hoja física (doble cara, varias por hoja) o un pliego de folleto.
function unitSize(config) {
  if (config.layout === "booklet") return 4;
  return config.pagesPerSheet * (config.duplex ? 2 : 1);
}

function assertPageCoverage(ranges, pages, unit) {
  const sorted = [...ranges].sort((first, second) => first.from - second.from || first.to - second.to);
  let expected = 1;
  for (const range of sorted) {
    if (!Number.isInteger(range.from) || !Number.isInteger(range.to)) {
      throw invalid("Cada parte debe indicar página inicial y final.");
    }
    if (range.from < 1 || range.to > pages || range.from > range.to) {
      throw invalid(`El rango ${range.from}-${range.to} no es válido para un documento de ${pages} páginas.`);
    }
    if (range.from < expected) throw invalid(`El rango ${range.from}-${range.to} se traslapa con otro rango.`);
    if (range.from > expected) throw invalid(`Faltan las páginas ${expected}-${range.from - 1}.`);
    if ((range.from - 1) % unit !== 0 || (range.to % unit !== 0 && range.to !== pages)) {
      throw invalid(`El rango ${range.from}-${range.to} parte una hoja de ${unit} páginas; ajusta los límites.`);
    }
    expected = range.to + 1;
  }
  if (expected !== pages + 1) throw invalid(`Faltan las páginas ${expected}-${pages}.`);
}

function printerSpeed(printer) {
  return printer.capabilities.pagesPerMinute > 0 ? printer.capabilities.pagesPerMinute : 1;
}

// Reparto voraz determinista: cada unidad va a la impresora que terminaría antes.
// El empate lo gana el id menor; el orden de entrada ya viene ordenado por id.
function allocate(printers, count, costAt) {
  const state = printers.map((printer) => ({
    printer,
    speed: printerSpeed(printer),
    backlog: printer.capabilities.queuedPages,
    load: 0,
    count: 0,
  }));
  for (let index = 0; index < count; index += 1) {
    const cost = costAt(index);
    let best = null;
    let bestFinish = Infinity;
    for (const item of state) {
      const finish = (item.backlog + item.load + cost) / item.speed;
      if (finish < bestFinish - 1e-9) {
        best = item;
        bestFinish = finish;
      }
    }
    best.count += 1;
    best.load += cost;
  }
  return state;
}

function pickBestSingle(printers, config, range) {
  const compatible = printers.filter((printer) => printerSupportProblems(printer, config, range).length === 0);
  if (!compatible.length) {
    throw precondition("Ninguna impresora en línea admite la configuración solicitada.");
  }
  const cost = (range.to - range.from + 1) * range.copies;
  const [best] = allocate(compatible, 1, () => cost).filter((item) => item.count > 0);
  return best.printer;
}

function finishPlan(resolvedMode, assignments) {
  const loadByPrinter = new Map();
  for (const item of assignments) {
    const pages = (item.to - item.from + 1) * item.copies;
    loadByPrinter.set(item.printer.id, (loadByPrinter.get(item.printer.id) || 0) + pages);
  }
  const parts = assignments.map((item, index) => {
    const speedKnown = item.printer.capabilities.pagesPerMinute > 0;
    const etaMinutes = speedKnown
      ? Math.ceil((item.printer.capabilities.queuedPages + loadByPrinter.get(item.printer.id))
        / item.printer.capabilities.pagesPerMinute)
      : null;
    return {
      id: `p${index + 1}`,
      printerId: item.printer.id,
      agentId: item.printer.agentId,
      printerName: item.printer.name,
      queue: item.printer.queue,
      from: item.from,
      to: item.to,
      copies: item.copies,
      status: "queued",
      etaMinutes,
    };
  });
  const known = parts.map((part) => part.etaMinutes).filter((value) => value !== null);
  return {
    resolvedMode,
    parts,
    etaMinutes: known.length ? Math.max(...known) : null,
  };
}

function findPrinter(candidates, printerId) {
  const printer = candidates.find((item) => item.id === printerId);
  if (!printer) throw invalid("La parte usa una impresora que no está seleccionada.");
  return printer;
}

function planPagesWithParts(parts, { config, pages, candidates, unit }) {
  const ranges = parts.map((part) => ({ from: part.from, to: part.to }));
  assertPageCoverage(ranges, pages, unit);
  const assignments = parts.map((part) => {
    const printer = findPrinter(candidates, part.printerId);
    if (part.copies !== undefined && part.copies !== config.copies) {
      throw invalid("En el modo por páginas cada parte usa las copias del trabajo.");
    }
    assertPrinterSupports(printer, config, { from: part.from, to: part.to, pages, copies: config.copies });
    return { printer, from: part.from, to: part.to, copies: config.copies };
  });
  return assignments.sort((first, second) => first.from - second.from);
}

function planCopiesWithParts(parts, { config, pages, candidates }) {
  const seen = new Set();
  let total = 0;
  const assignments = parts.map((part) => {
    const printer = findPrinter(candidates, part.printerId);
    if (seen.has(printer.id)) throw invalid("Cada impresora solo puede aparecer una vez en el reparto de copias.");
    seen.add(printer.id);
    if (!Number.isInteger(part.copies) || part.copies < 1) {
      throw invalid("Cada parte debe indicar un número de copias mayor que cero.");
    }
    if ((part.from !== undefined && part.from !== 1) || (part.to !== undefined && part.to !== pages)) {
      throw invalid("En el reparto por copias cada parte imprime el documento completo.");
    }
    total += part.copies;
    assertPrinterSupports(printer, config, { from: 1, to: pages, pages, copies: part.copies });
    return { printer, from: 1, to: pages, copies: part.copies };
  });
  if (total < config.copies) throw invalid(`Faltan ${config.copies - total} copias por asignar.`);
  if (total > config.copies) {
    throw invalid(`Las copias asignadas (${total}) superan las solicitadas (${config.copies}).`);
  }
  return assignments.sort((first, second) => byPrinterId(first.printer, second.printer));
}

function autoPages(pool, { config, pages, unit }) {
  const chunks = Math.ceil(pages / unit);
  const state = allocate(pool, chunks, (index) => (Math.min(pages, (index + 1) * unit) - index * unit) * config.copies);
  const assignments = [];
  let cursor = 1;
  for (const item of state) {
    if (!item.count) continue;
    const to = Math.min(pages, cursor - 1 + item.count * unit);
    assignments.push({ printer: item.printer, from: cursor, to, copies: config.copies });
    cursor = to + 1;
  }
  return assignments;
}

function autoCopies(pool, { config, pages }) {
  const state = allocate(pool, config.copies, () => pages);
  return state
    .filter((item) => item.count > 0)
    .map((item) => ({ printer: item.printer, from: 1, to: pages, copies: item.count }));
}

/**
 * Calcula las partes de un trabajo.
 * - explicit: las impresoras vienen elegidas por la persona; si no soportan algo, se rechaza.
 * - parts: reparto manual a validar (cobertura exacta de páginas o copias).
 */
function planDistribution({ mode, config, pages, printers, explicit = false, parts = null }) {
  if (!MODES.includes(mode)) throw invalid("El modo de distribución no es válido.");
  if (!Number.isInteger(pages) || pages < 1 || pages > MAX_PAGES) throw invalid("El documento no tiene un número de páginas válido.");
  const candidates = [...printers].sort(byPrinterId);
  if (!candidates.length) throw precondition("No hay impresoras en línea disponibles.");
  if (candidates.length > MAX_DEVICES) throw invalid(`Un trabajo admite como máximo ${MAX_DEVICES} impresoras.`);
  const requestedParts = Array.isArray(parts) && parts.length ? parts : null;
  if (requestedParts && requestedParts.length > MAX_DEVICES) {
    throw invalid(`Un trabajo admite como máximo ${MAX_DEVICES} partes.`);
  }
  if (requestedParts && (mode === "single" || mode === "smart")) {
    throw invalid("Este modo calcula el reparto automáticamente y no admite partes manuales.");
  }
  const unit = unitSize(config);
  const context = { config, pages, candidates, unit };
  const fullRange = { from: 1, to: pages, pages, copies: config.copies };
  const partialProbe = { from: 1, to: 1, pages: 2, copies: config.copies };
  const copyProbe = { from: 1, to: pages, pages, copies: 1 };
  const supports = (printer, probe) => printerSupportProblems(printer, config, probe).length === 0;
  const poolFor = (probe) => {
    if (explicit) return candidates;
    const pool = candidates.filter((printer) => supports(printer, probe));
    if (!pool.length) throw precondition("Ninguna impresora en línea admite la configuración solicitada.");
    return pool;
  };
  const verify = (assignments) => {
    if (explicit) {
      assignments.forEach((item) => assertPrinterSupports(item.printer, config, {
        from: item.from, to: item.to, pages, copies: item.copies,
      }));
    }
    return assignments;
  };

  if (mode === "single") {
    if (explicit) {
      if (candidates.length !== 1) throw invalid("El modo individual usa una sola impresora.");
      assertPrinterSupports(candidates[0], config, fullRange);
      return finishPlan("single", [{ printer: candidates[0], ...fullRange }]);
    }
    return finishPlan("single", [{ printer: pickBestSingle(candidates, config, fullRange), ...fullRange }]);
  }

  if (mode === "pages") {
    if (requestedParts) return finishPlan("pages", planPagesWithParts(requestedParts, context));
    return finishPlan("pages", verify(autoPages(poolFor(partialProbe), context)));
  }

  if (mode === "copies") {
    if (requestedParts) return finishPlan("copies", planCopiesWithParts(requestedParts, context));
    return finishPlan("copies", verify(autoCopies(poolFor(copyProbe), context)));
  }

  // smart: descarta las impresoras incompatibles (también entre las elegidas) y elige el reparto.
  const pool = candidates.filter((printer) => supports(printer, copyProbe));
  if (!pool.length) throw precondition("Ninguna impresora en línea admite la configuración solicitada.");
  if (pool.length > 1 && config.copies > 1) {
    return finishPlan("copies", autoCopies(pool, context));
  }
  if (pool.length > 1 && pages >= unit * 2) {
    const pagePool = pool.filter((printer) => supports(printer, partialProbe));
    if (pagePool.length > 1) return finishPlan("pages", autoPages(pagePool, context));
  }
  return finishPlan("single", [{ printer: pickBestSingle(pool, config, fullRange), ...fullRange }]);
}

/* ---------- Estado de trabajo ---------- */

// Solo las partes en cola se despachan; pausa, cancelación y borrador siempre dejan la lista vacía.
function computeDispatchPrinterIds(status, parts) {
  if (NON_DISPATCHABLE_JOB_STATUSES.has(status)) return [];
  return [...new Set((parts || []).filter((part) => part.status === "queued").map((part) => part.printerId))].sort();
}

// Estado del trabajo a partir de sus partes; nunca asume que algo salió físicamente.
function deriveJobStatus(parts, { accepted = 0 } = {}) {
  if (!parts.length) return null;
  if (parts.every((part) => part.status === "cancelled")) return accepted > 0 ? "partial" : "cancelled";
  for (const status of ["printing", "submitted", "confirmation", "queued", "paused", "draft"]) {
    if (parts.some((part) => part.status === status)) return status;
  }
  return parts.some((part) => part.status === "cancelled") ? "partial" : "quality";
}

module.exports = {
  CONFIG_KEYS,
  IN_FLIGHT_PART_STATUSES,
  MAX_COPIES,
  MAX_DEVICES,
  MAX_PAGES,
  MODES,
  ONLINE_WINDOW_MS,
  PrintRuleError,
  assertPageCoverage,
  assertPrinterSupports,
  buildConfig,
  computeDispatchPrinterIds,
  deriveJobStatus,
  isPrinterOnline,
  normalizePrinter,
  planDistribution,
  printerSupportProblems,
  selectOnlinePrinters,
  unitSize,
  validateConfigFields,
};
