"use strict";

const { MAX_DEVICES, MAX_PAGES, MAX_COPIES, MODES, PrintRuleError } = require("./printDistribution");
const invalid = (message) => new PrintRuleError("invalid-argument", message);
const unavailable = (message) => new PrintRuleError("failed-precondition", message);

function id(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(value)) throw invalid("Identificador de distribución inválido.");
  return value;
}

function name(value, max = 80) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw invalid("Completa los nombres y condiciones de distribución.");
  return value.trim();
}

function bounded(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw invalid("Revisa los límites numéricos de las reglas.");
  return value;
}

function records(value, max) {
  if (!Array.isArray(value) || value.length > max) throw invalid(`Se admiten hasta ${max} registros.`);
  return value;
}

function bounds(raw, target, from, to, max) {
  for (const key of [from, to]) if (raw[key] != null) target[key] = bounded(raw[key], 1, max);
  if (target[from] > target[to]) throw invalid("El mínimo de un intervalo no puede superar el máximo.");
}

function validateRouting(input, jobTypes, priorities) {
  if (!input || typeof input !== "object") throw invalid("La configuración de distribución no es válida.");
  const revision = bounded(input.revision, 0, Number.MAX_SAFE_INTEGER - 1);
  const groups = records(input.groups, 30).map((group) => {
    const printerIds = [...new Set(records(group?.printerIds, MAX_DEVICES).map(id))];
    if (!printerIds.length) throw invalid("Cada grupo debe incluir al menos una impresora.");
    return { id: id(group.id), name: name(group.name), printerIds };
  });
  const groupIds = new Set(groups.map((group) => group.id));
  if (groupIds.size !== groups.length) throw invalid("Hay grupos repetidos.");
  const rules = records(input.rules, 60).map((raw) => {
    const groupId = id(raw?.groupId);
    if (!groupIds.has(groupId)) throw invalid("Cada regla debe apuntar a un grupo existente.");
    if (!MODES.includes(raw.mode) || typeof raw.enabled !== "boolean") throw invalid("Completa el modo y el estado de la regla.");
    const rule = { id: id(raw.id), name: name(raw.name), groupId, mode: raw.mode, enabled: raw.enabled };
    for (const [key, allowed] of [["type", jobTypes], ["priority", priorities], ["color", ["color", "mono"]]]) {
      if (!raw[key]) continue;
      if (!allowed.includes(raw[key])) throw invalid("Una condición de la regla no es válida.");
      rule[key] = raw[key];
    }
    for (const key of ["paper", "mediaType", "finishing"]) if (raw[key]) rule[key] = name(raw[key]);
    bounds(raw, rule, "minPages", "maxPages", MAX_PAGES);
    bounds(raw, rule, "minCopies", "maxCopies", MAX_COPIES);
    if (raw.minSpeed != null) rule.minSpeed = bounded(raw.minSpeed, 1, 2000);
    if (raw.maxQueue != null) rule.maxQueue = bounded(raw.maxQueue, 0, 10000);
    return rule;
  });
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length) throw invalid("Hay reglas repetidas.");
  return { revision, groups, rules };
}

const sameText = (left, right) => String(left ?? "").toLowerCase() === right.toLowerCase();

function matches(rule, { type, pages, config }) {
  return rule.enabled
    && (!rule.type || rule.type === type)
    && (!rule.priority || rule.priority === (config.priority || "normal"))
    && (!rule.color || (rule.color === "color") === config.color)
    && (!rule.paper || sameText(config.paper, rule.paper))
    && (!rule.mediaType || sameText(config.mediaType, rule.mediaType))
    && (!rule.finishing || config.finishing.some((value) => sameText(value, rule.finishing)))
    && pages >= (rule.minPages ?? 1) && pages <= (rule.maxPages ?? MAX_PAGES)
    && config.copies >= (rule.minCopies ?? 1) && config.copies <= (rule.maxCopies ?? MAX_COPIES);
}

function resolveRouting(routing, input, printers) {
  const rule = routing?.rules?.find((item) => matches(item, input));
  if (rule && input.groupId && input.groupId !== rule.groupId) {
    throw unavailable(`La regla «${rule.name}» asigna este trabajo a otro grupo. Usa la selección automática.`);
  }
  const groupId = rule?.groupId || input.groupId || "";
  const group = groupId ? routing?.groups?.find((item) => item.id === groupId) : null;
  if (groupId && !group) throw unavailable("El grupo de impresión ya no existe.");
  const candidates = printers.filter((printer) => (!group || group.printerIds.includes(printer.id))
    && (rule?.minSpeed == null || printer.capabilities.pagesPerMinute >= rule.minSpeed)
    && (rule?.maxQueue == null || (printer.queuedJobs != null && printer.queuedJobs <= rule.maxQueue)));
  return {
    candidates, mode: rule?.mode || input.mode,
    groupId, groupName: group?.name || "", groupPrinterIds: group?.printerIds || [],
    ruleId: rule?.id || "", ruleName: rule?.name || "",
  };
}

module.exports = { validateRouting, resolveRouting };
