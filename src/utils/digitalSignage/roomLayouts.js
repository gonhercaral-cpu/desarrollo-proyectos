// Modelo puro de "Acomodo de salones": normalización, validación, advertencias y
// resolución horaria. Sin dependencias de Firebase/React para poder probarse en Node.

import {
  getScheduleWarnings,
  normalizeMatrixStyle,
  normalizeRoomSchedule,
  validateRoomSchedule,
} from "./roomSchedule.js";

export const ROOM_MODEL_VERSION = 1;
export const ROOM_DEFAULT_TIMEZONE = "America/Tijuana";
export const ROOM_MAX_ASSIGNMENTS = 200;
export const ROOM_MAX_RULES = 100;
export const ROOM_MAX_ROOMS = 200;
export const ROOM_MAX_TEACHER_NAMES = 500;
export const ROOM_MAX_ELEMENTS = 200;
export const ROOM_MAX_DESTINATION_PLANTELES = 20;
export const ROOM_MAX_DESTINATION_DEVICES = 390;
export const ROOM_MAX_COLUMNS = 12;
export const ROOM_MAX_ROWS = 100;
export const ROOM_ELEMENT_TYPES = ["text", "field", "assignments", "rect", "image", "scheduleGrid"];
// Plantilla integrada (no se guarda en Firestore): la selección por ID se resuelve al publicar.
export const SCHEDULE_GRID_TEMPLATE_ID = "__schedule_grid__";
export const ROOM_FIELDS = ["plantel", "day", "classTime", "room", "teacher", "group"];
export const ROOM_ALIGNS = ["left", "center", "right"];

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const DAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const DEFAULT_ROOM_TEMPLATE = Object.freeze({
  name: "Acomodo institucional",
  version: 1,
  backgroundColor: "#0b3265",
  backgroundUrl: "",
  columns: 2,
  rows: 4,
  active: true,
  elements: Object.freeze([
    Object.freeze({
      id: "title", type: "text", x: 6, y: 5, width: 70, height: 10, fontSize: 46,
      color: "#ffffff", backgroundColor: "transparent", align: "left",
      text: "Acomodo de salones", field: "plantel", rowIndex: 0, url: "",
    }),
    Object.freeze({
      id: "logo", type: "image", x: 82, y: 4, width: 12, height: 12, fontSize: 40,
      color: "#ffffff", backgroundColor: "transparent", align: "center",
      text: "", field: "plantel", rowIndex: 0, url: "/active-logo.png",
    }),
    Object.freeze({
      id: "plantel", type: "field", x: 6, y: 16, width: 40, height: 6, fontSize: 28,
      color: "#cfe0ff", backgroundColor: "transparent", align: "left",
      text: "", field: "plantel", rowIndex: 0, url: "",
    }),
    Object.freeze({
      id: "day", type: "field", x: 46, y: 16, width: 24, height: 6, fontSize: 28,
      color: "#cfe0ff", backgroundColor: "transparent", align: "center",
      text: "", field: "day", rowIndex: 0, url: "",
    }),
    Object.freeze({
      id: "classTime", type: "field", x: 70, y: 16, width: 24, height: 6, fontSize: 28,
      color: "#cfe0ff", backgroundColor: "transparent", align: "right",
      text: "", field: "classTime", rowIndex: 0, url: "",
    }),
    Object.freeze({
      id: "assignments", type: "assignments", x: 6, y: 26, width: 88, height: 68, fontSize: 34,
      color: "#ffffff", backgroundColor: "rgba(255,255,255,0.12)", align: "left",
      text: "", field: "room", rowIndex: 0, url: "",
    }),
  ]),
});

// Misma cabecera institucional, con el cuadro dinámico de horarios en lugar de `assignments`.
// Conserva version/columns/rows (campos obligatorios del modelo antiguo).
export const DEFAULT_SCHEDULE_TEMPLATE = Object.freeze({
  name: "Acomodo por horarios — Cuadrícula",
  version: 1,
  backgroundColor: "#0b3265",
  backgroundUrl: "",
  columns: 2,
  rows: 4,
  active: true,
  matrixStyle: Object.freeze({ ...normalizeMatrixStyle({}) }),
  elements: Object.freeze([
    Object.freeze({
      id: "title", type: "text", x: 6, y: 5, width: 70, height: 10, fontSize: 46,
      color: "#ffffff", backgroundColor: "transparent", align: "left",
      text: "Acomodo por horarios", field: "plantel", rowIndex: 0, url: "",
    }),
    DEFAULT_ROOM_TEMPLATE.elements.find((element) => element.id === "logo"),
    DEFAULT_ROOM_TEMPLATE.elements.find((element) => element.id === "plantel"),
    DEFAULT_ROOM_TEMPLATE.elements.find((element) => element.id === "day"),
    Object.freeze({
      id: "scheduleGrid", type: "scheduleGrid", x: 6, y: 26, width: 88, height: 68, fontSize: 34,
      color: "#ffffff", backgroundColor: "transparent", align: "left",
      text: "", field: "room", rowIndex: 0, url: "",
    }),
  ]),
});

export function getBuiltInRoomTemplate(templateId) {
  if (text(templateId, 120) !== SCHEDULE_GRID_TEMPLATE_ID) return null;
  return { ...normalizeRoomTemplate(DEFAULT_SCHEDULE_TEMPLATE), id: "" };
}

export const ROOM_BLOCK_PRESETS = Object.freeze([
  ...[["08:00", "09:00"], ["09:00", "10:00"], ["10:00", "11:00"]].map(([startTime, endTime]) => ({
    label: `Lun–Vie ${startTime}–${endTime}`, daysOfWeek: [1, 2, 3, 4, 5], startTime, endTime,
  })),
  ...[
    ["15:00", "16:00"], ["16:00", "17:00"], ["17:00", "18:00"],
    ["18:00", "19:00"], ["19:00", "20:00"], ["20:00", "21:00"],
  ].map(([startTime, endTime]) => ({
    label: `Lun–Vie ${startTime}–${endTime}`, daysOfWeek: [1, 2, 3, 4, 5], startTime, endTime,
  })),
  { label: "Sábado 08:00–13:00", daysOfWeek: [6], startTime: "08:00", endTime: "13:00" },
  { label: "Sábado 13:30–17:30", daysOfWeek: [6], startTime: "13:30", endTime: "17:30" },
  { label: "Domingo 09:00–13:00", daysOfWeek: [0], startTime: "09:00", endTime: "13:00" },
]);

// ---------- utilidades ----------

let idCounter = 0;

export function createRoomId(prefix = "room") {
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (cryptoApi?.randomUUID) return `${prefix}-${cryptoApi.randomUUID()}`;
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function text(value, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

export function cleanRoomTime(value, fallback = "") {
  const clean = text(value, 5);
  return TIME_PATTERN.test(clean) ? clean : fallback;
}

export function roomTimeToMinutes(value) {
  const clean = cleanRoomTime(value);
  if (!clean) return -1;
  const [hours, minutes] = clean.split(":").map(Number);
  return hours * 60 + minutes;
}

export function isValidTimeZone(timezone) {
  const clean = text(timezone, 80);
  if (!clean) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: clean });
    return true;
  } catch {
    return false;
  }
}

function isValidDateKey(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function cleanDays(value, fallback = []) {
  if (!Array.isArray(value)) return [...fallback];
  return Array.from(
    new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))
  ).sort((a, b) => a - b);
}

function cleanColor(value, fallback) {
  const clean = text(value, 60);
  if (clean === "transparent" || HEX_PATTERN.test(clean)) return clean;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/.test(clean)) return clean;
  return fallback;
}

// Solo https, rutas relativas del mismo sitio ("/x.png") y http hacia loopback (emulador de
// Storage en pruebas locales); nunca javascript:, data: ni http remoto.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function cleanRoomUrl(value) {
  const clean = text(value, 2048);
  if (!clean) return "";
  if (clean.startsWith("/") && !clean.startsWith("//")) return clean;
  try {
    const url = new URL(clean);
    if (url.protocol === "https:") return clean;
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) ? clean : "";
  } catch {
    return "";
  }
}

function uniqueIds(items, prefix) {
  const seen = new Set();
  return items.map((item) => {
    let id = text(item.id, 120);
    if (!id || seen.has(id)) id = createRoomId(prefix);
    seen.add(id);
    return { ...item, id };
  });
}

function normalizeMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// ---------- plantillas ----------

export function normalizeRoomElement(element = {}, index = 0) {
  const type = ROOM_ELEMENT_TYPES.includes(element?.type) ? element.type : "text";
  return {
    id: text(element?.id, 120) || `element-${index}`,
    type,
    x: clampNumber(element?.x, 0, 100, 6),
    y: clampNumber(element?.y, 0, 100, 5),
    width: clampNumber(element?.width, 1, 100, 88),
    height: clampNumber(element?.height, 1, 100, 10),
    fontSize: clampNumber(element?.fontSize, 8, 240, 40),
    color: cleanColor(element?.color, "#ffffff"),
    backgroundColor: cleanColor(element?.backgroundColor, "transparent"),
    align: ROOM_ALIGNS.includes(element?.align) ? element.align : "left",
    text: text(element?.text, 300),
    field: ROOM_FIELDS.includes(element?.field) ? element.field : "plantel",
    rowIndex: clampInt(element?.rowIndex, 0, ROOM_MAX_ASSIGNMENTS - 1, 0),
    url: cleanRoomUrl(element?.url),
  };
}

export function normalizeRoomTemplate(data = {}) {
  const source = data && typeof data === "object" ? data : {};
  const hasElements = Array.isArray(source.elements);
  const rawElements = hasElements ? source.elements : DEFAULT_ROOM_TEMPLATE.elements;
  const elements = uniqueIds(
    rawElements.slice(0, ROOM_MAX_ELEMENTS).map((element, index) => normalizeRoomElement(element, index)),
    "element"
  );
  const template = {
    name: text(source.name, 120),
    version: ROOM_MODEL_VERSION,
    backgroundColor: cleanColor(source.backgroundColor, DEFAULT_ROOM_TEMPLATE.backgroundColor),
    backgroundUrl: cleanRoomUrl(source.backgroundUrl),
    columns: clampInt(source.columns, 1, ROOM_MAX_COLUMNS, DEFAULT_ROOM_TEMPLATE.columns),
    rows: clampInt(source.rows, 1, ROOM_MAX_ROWS, DEFAULT_ROOM_TEMPLATE.rows),
    elements,
    active: source.active !== false,
    // Solo plantillas con matriz lo llevan: las antiguas no ganan claves nuevas.
    ...(source.matrixStyle && typeof source.matrixStyle === "object" && !Array.isArray(source.matrixStyle)
      ? { matrixStyle: normalizeMatrixStyle(source.matrixStyle) }
      : {}),
  };
  const id = text(source.id, 120);
  return id ? { id, ...template } : template;
}

export function validateRoomTemplate(data) {
  const raw = data && typeof data === "object" ? data : {};
  if (Array.isArray(raw.elements) && raw.elements.length > ROOM_MAX_ELEMENTS) {
    throw new Error(`La plantilla admite máximo ${ROOM_MAX_ELEMENTS} elementos.`);
  }
  const template = normalizeRoomTemplate(raw);
  if (!template.name) throw new Error("Escribe un nombre para la plantilla.");
  return template;
}

// ---------- configuración de plantel ----------

export function normalizeRoomConfig(data = {}) {
  const source = data && typeof data === "object" ? data : {};
  const rooms = uniqueIds(
    (Array.isArray(source.rooms) ? source.rooms : [])
      .slice(0, ROOM_MAX_ROOMS)
      .map((room, index) => ({
        id: room?.id,
        name: text(room?.name, 80) || `Salón ${index + 1}`,
        active: room?.active !== false,
      })),
    "room"
  );
  const seen = new Set();
  const teacherNames = [];
  (Array.isArray(source.teacherNames) ? source.teacherNames : []).forEach((name) => {
    const clean = text(name, 120);
    const key = clean.toLocaleLowerCase("es");
    if (clean && !seen.has(key)) {
      seen.add(key);
      teacherNames.push(clean);
    }
  });
  const timezone = text(source.timezone, 80);
  return {
    plantel: text(source.plantel, 120),
    timezone: isValidTimeZone(timezone) ? timezone : ROOM_DEFAULT_TIMEZONE,
    rooms,
    teacherNames: teacherNames.slice(0, ROOM_MAX_TEACHER_NAMES),
  };
}

export function validateRoomConfig(data) {
  const config = normalizeRoomConfig(data);
  if (!config.plantel) throw new Error("Selecciona un plantel.");
  if (data?.timezone && !isValidTimeZone(data.timezone)) throw new Error("Zona horaria no válida.");
  return config;
}

// ---------- acomodos ----------

export function normalizeRoomAssignment(assignment = {}) {
  return {
    id: text(assignment?.id, 120),
    // Vínculo estable opcional catálogo -> fila; datos antiguos sin roomId no cambian.
    ...(text(assignment?.roomId, 120) ? { roomId: text(assignment.roomId, 120) } : {}),
    roomName: text(assignment?.roomName, 80),
    teacher: text(assignment?.teacher, 120),
    group: text(assignment?.group, 80),
    active: assignment?.active !== false,
  };
}

export function normalizeDisplayRule(rule = {}) {
  const dates = Array.from(
    new Set((Array.isArray(rule?.dates) ? rule.dates : []).map((date) => text(date, 10)).filter(isValidDateKey))
  ).sort();
  return {
    id: text(rule?.id, 120),
    daysOfWeek: cleanDays(rule?.daysOfWeek),
    dates,
    startTime: cleanRoomTime(rule?.startTime),
    endTime: cleanRoomTime(rule?.endTime),
    deviceIds: Array.from(
      new Set((Array.isArray(rule?.deviceIds) ? rule.deviceIds : []).map((id) => text(id, 120)).filter(Boolean))
    ),
    active: rule?.active !== false,
    priority: clampInt(rule?.priority, -1000, 1000, 0),
    // Vista de la matriz que muestra esta ventana; vacío = primera vista (sin clave en datos antiguos).
    ...(text(rule?.viewId, 120) ? { viewId: text(rule.viewId, 120) } : {}),
  };
}

// ---------- destinos (acomodos independientes del plantel) ----------
//
// `destinations` es opcional: su presencia (incluso []) vuelve independiente al acomodo; su
// ausencia conserva la semántica antigua ligada a `plantel`. deviceIds vacío = todas las
// pantallas (activas y futuras) de ESE plantel.

export function hasRoomLayoutDestinations(layout) {
  return Array.isArray(layout?.destinations);
}

// Normalización tolerante (datos ya validados o leídos de Firestore). Nunca ensancha: una lista
// explícita que queda vacía tras filtrar descarta el destino en lugar de convertirlo en "todas".
export function normalizeRoomDestinations(value) {
  const seen = new Set();
  const result = [];
  (Array.isArray(value) ? value : []).forEach((entry) => {
    const plantel = text(entry?.plantel, 120);
    if (!plantel || seen.has(plantel)) return;
    if (entry?.deviceIds !== undefined && !Array.isArray(entry.deviceIds)) return;
    const raw = Array.isArray(entry?.deviceIds) ? entry.deviceIds : [];
    const deviceIds = Array.from(
      new Set(raw.map((id) => text(id, 120)).filter(Boolean))
    ).slice(0, ROOM_MAX_DESTINATION_DEVICES);
    if (raw.length > 0 && deviceIds.length === 0) return;
    seen.add(plantel);
    result.push({ plantel, deviceIds });
  });
  return result.slice(0, ROOM_MAX_DESTINATION_PLANTELES);
}

// Valida el dato CRUDO antes de normalizar: duplicados/inválidos/excesos fallan, no se corrigen.
export function validateRoomDestinations(raw) {
  if (!Array.isArray(raw)) throw new Error("Los destinos del acomodo no son válidos.");
  if (raw.length > ROOM_MAX_DESTINATION_PLANTELES) {
    throw new Error(`El acomodo admite máximo ${ROOM_MAX_DESTINATION_PLANTELES} planteles destino.`);
  }
  const planteles = new Set();
  let totalDevices = 0;
  raw.forEach((entry, index) => {
    const label = `Destino ${index + 1}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${label}: no es válido.`);
    const plantel = typeof entry.plantel === "string" ? entry.plantel.trim() : "";
    if (!plantel || plantel.length > 120) throw new Error(`${label}: elige un plantel válido.`);
    if (planteles.has(plantel)) throw new Error(`El plantel "${plantel}" está repetido en los destinos.`);
    planteles.add(plantel);
    const ids = entry.deviceIds === undefined ? [] : entry.deviceIds;
    if (!Array.isArray(ids)) throw new Error(`${label}: la lista de pantallas no es válida.`);
    if (ids.length > ROOM_MAX_DESTINATION_DEVICES) {
      throw new Error(`${label}: máximo ${ROOM_MAX_DESTINATION_DEVICES} pantallas por destino.`);
    }
    const seen = new Set();
    ids.forEach((id) => {
      const clean = typeof id === "string" ? id.trim() : "";
      if (!clean || clean.length > 120) throw new Error(`${label}: hay una pantalla no válida.`);
      if (seen.has(clean)) throw new Error(`${label}: hay pantallas repetidas.`);
      seen.add(clean);
    });
    totalDevices += ids.length;
  });
  if (totalDevices > ROOM_MAX_DESTINATION_DEVICES) {
    throw new Error(`Los destinos suman más de ${ROOM_MAX_DESTINATION_DEVICES} pantallas.`);
  }
}

// Antiguo: [{ plantel, deviceIds: [] }]; independiente: la lista propia (puede ser []).
export function getRoomLayoutDestinations(layout) {
  if (hasRoomLayoutDestinations(layout)) return normalizeRoomDestinations(layout.destinations);
  return [{ plantel: text(layout?.plantel, 120), deviceIds: [] }];
}

export function getRoomLayoutPlanteles(layout) {
  return Array.from(new Set(getRoomLayoutDestinations(layout).map((destination) => destination.plantel).filter(Boolean)));
}

// Solo la relación destino <-> pantalla; la intersección con rule.deviceIds es aparte.
export function roomLayoutTargetsDevice(layout, device) {
  const plantel = text(device?.plantel, 120);
  if (!hasRoomLayoutDestinations(layout)) return text(layout?.plantel, 120) === plantel;
  if (!plantel) return false;
  const destination = layout.destinations.find((entry) => text(entry?.plantel, 120) === plantel);
  if (!destination) return false;
  if (destination.deviceIds !== undefined && !Array.isArray(destination.deviceIds)) return false;
  const raw = Array.isArray(destination.deviceIds) ? destination.deviceIds : [];
  if (raw.length === 0) return true;
  const identifiers = [text(device?.id, 120), text(device?.deviceToken, 120)].filter(Boolean);
  return raw.some((id) => identifiers.includes(text(id, 120)));
}

// Cada ventana activa con pantallas explícitas debe caer dentro de algún destino. Con destinos
// "todas las pantallas del plantel" no se puede saber sin las pantallas reales (lo valida el servicio).
function validateRuleTargetsWithinDestinations(layout) {
  const destinations = layout.destinations || [];
  if (destinations.length === 0) return;
  if (destinations.some((destination) => destination.deviceIds.length === 0)) return;
  const allowed = new Set(destinations.flatMap((destination) => destination.deviceIds));
  layout.displayRules.forEach((rule, index) => {
    if (!rule.active) return;
    if (rule.deviceIds.some((id) => !allowed.has(id))) {
      throw new Error(`Ventana ${index + 1}: apunta a una pantalla fuera de los destinos del acomodo.`);
    }
  });
}

export function normalizeRoomLayout(data = {}) {
  const source = data && typeof data === "object" ? data : {};
  const timezone = text(source.timezone, 80);
  const assignments = uniqueIds(
    (Array.isArray(source.assignments) ? source.assignments : [])
      .slice(0, ROOM_MAX_ASSIGNMENTS)
      .map(normalizeRoomAssignment),
    "assignment"
  );
  const displayRules = uniqueIds(
    (Array.isArray(source.displayRules) ? source.displayRules : [])
      .slice(0, ROOM_MAX_RULES)
      .map(normalizeDisplayRule),
    "rule"
  );
  const layout = {
    name: text(source.name, 120),
    plantel: text(source.plantel, 120),
    timezone: isValidTimeZone(timezone) ? timezone : ROOM_DEFAULT_TIMEZONE,
    classDays: cleanDays(source.classDays, [1, 2, 3, 4, 5]),
    classStart: cleanRoomTime(source.classStart, "09:00"),
    classEnd: cleanRoomTime(source.classEnd, "10:00"),
    assignments,
    templateId: text(source.templateId, 120),
    displayRules,
    active: source.active !== false,
  };
  if (Array.isArray(source.destinations)) layout.destinations = normalizeRoomDestinations(source.destinations);
  // Las celdas solo pueden apuntar a filas de ESTE acomodo; sin schedule = acomodo antiguo.
  const schedule = normalizeRoomSchedule(source.schedule, assignments);
  if (schedule) layout.schedule = schedule;
  const id = text(source.id, 120);
  return id ? { id, ...layout } : layout;
}

export function validateRoomLayout(data) {
  const raw = data && typeof data === "object" ? data : {};
  if (Array.isArray(raw.assignments) && raw.assignments.length > ROOM_MAX_ASSIGNMENTS) {
    throw new Error(`El acomodo admite máximo ${ROOM_MAX_ASSIGNMENTS} filas.`);
  }
  if (Array.isArray(raw.displayRules) && raw.displayRules.length > ROOM_MAX_RULES) {
    throw new Error(`El acomodo admite máximo ${ROOM_MAX_RULES} ventanas de aparición.`);
  }
  if (raw.timezone && !isValidTimeZone(raw.timezone)) throw new Error("Zona horaria no válida.");
  // Topes, referencias y rangos de la matriz se validan sobre el dato crudo, antes de normalizar.
  if (raw.schedule !== undefined && raw.schedule !== null) {
    validateRoomSchedule(raw.schedule, Array.isArray(raw.assignments) ? raw.assignments : []);
  }
  if (raw.destinations !== undefined) validateRoomDestinations(raw.destinations);

  const layout = normalizeRoomLayout(raw);
  if (!layout.destinations && !layout.plantel) throw new Error("Selecciona un plantel.");
  if (!layout.name) throw new Error("Escribe un nombre para el acomodo.");
  if (layout.classDays.length === 0) throw new Error("Selecciona al menos un día de clase.");
  if (!TIME_PATTERN.test(text(raw.classStart || layout.classStart, 5)) ||
      !TIME_PATTERN.test(text(raw.classEnd || layout.classEnd, 5))) {
    throw new Error("Horario de clase no válido.");
  }
  if (layout.classStart === layout.classEnd) throw new Error("La clase necesita inicio y fin distintos.");

  const rawRules = Array.isArray(raw.displayRules) ? raw.displayRules : [];
  layout.displayRules.forEach((rule, index) => {
    const label = `Ventana ${index + 1}`;
    const source = rawRules[index] || {};
    if (!rule.startTime || !rule.endTime) throw new Error(`${label}: horario no válido.`);
    if (rule.startTime === rule.endTime) throw new Error(`${label}: inicio y fin no pueden ser iguales.`);
    if ((source.dates || []).length !== rule.dates.length && Array.isArray(source.dates)) {
      throw new Error(`${label}: hay fechas no válidas o repetidas (usa AAAA-MM-DD).`);
    }
    if (rule.dates.length === 0 && rule.daysOfWeek.length === 0) {
      throw new Error(`${label}: elige días de la semana o fechas.`);
    }
    if (rule.viewId) {
      if (!layout.schedule) throw new Error(`${label}: elige una vista, pero el acomodo no usa matriz de horarios.`);
      if (!layout.schedule.views.some((view) => view.id === rule.viewId)) {
        throw new Error(`${label}: la vista seleccionada no existe.`);
      }
    }
  });
  if (layout.destinations) validateRuleTargetsWithinDestinations(layout);
  return layout;
}

export function createRoomLayoutDraft({
  destinations,
  plantel = "",
  timezone = ROOM_DEFAULT_TIMEZONE,
  rooms = [],
  classDays = [1, 2, 3, 4, 5],
  classStart = "09:00",
  classEnd = "10:00",
} = {}) {
  const safeTimezone = isValidTimeZone(timezone) ? timezone : ROOM_DEFAULT_TIMEZONE;
  const days = cleanDays(classDays, [1, 2, 3, 4, 5]);
  const start = cleanRoomTime(classStart, "09:00");
  const end = cleanRoomTime(classEnd, "10:00");
  const sourceRooms = (Array.isArray(rooms) ? rooms : []).filter((room) => room?.active !== false);
  const assignments = sourceRooms.slice(0, ROOM_MAX_ASSIGNMENTS).map((room) => ({
    id: createRoomId("assignment"),
    ...(typeof room !== "string" && text(room?.id, 120) ? { roomId: text(room.id, 120) } : {}),
    roomName: text(typeof room === "string" ? room : room?.name, 80),
    teacher: "",
    group: "",
    active: true,
  }));
  const startMinutes = roomTimeToMinutes(start);
  const windowStart = startMinutes >= 10 ? startMinutes - 10 : 0;
  const toTime = (minutes) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const windowEnd = Math.min(startMinutes + 15, 24 * 60 - 1);

  const independent = Array.isArray(destinations);
  return {
    name: `${text(plantel, 60) || (independent ? "Acomodo" : "Plantel")} · ${getRoomDayLabel(days)} ${start}–${end}`,
    plantel: text(plantel, 120),
    ...(independent ? { destinations: normalizeRoomDestinations(destinations) } : {}),
    timezone: safeTimezone,
    classDays: days.length ? days : [1, 2, 3, 4, 5],
    classStart: start,
    classEnd: end,
    assignments,
    templateId: "",
    displayRules: [
      {
        id: createRoomId("rule"),
        daysOfWeek: days.length ? days : [1, 2, 3, 4, 5],
        dates: [],
        startTime: toTime(windowStart),
        endTime: toTime(windowEnd),
        deviceIds: [],
        active: true,
        priority: 0,
      },
    ],
    active: true,
  };
}

// ---------- etiquetas ----------

export function getRoomDayLabel(classDays = []) {
  const days = cleanDays(classDays);
  if (days.length === 0) return "Sin días";
  if (days.length === 7) return "Todos los días";
  const key = days.join(",");
  if (key === "1,2,3,4,5") return "Lunes a viernes";
  if (key === "0,6") return "Fines de semana";
  if (days.length === 1) return DAY_NAMES[days[0]];
  return days.map((day) => DAY_SHORT[day]).join(", ");
}

export function formatRoomClassTime(layout) {
  return `${layout?.classStart || "--:--"} – ${layout?.classEnd || "--:--"}`;
}

// ---------- tiempo ----------

const formatterCache = new Map();

function getFormatter(timezone) {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Fecha/hora local en la zona IANA, con DST resuelto por Intl.
export function getRoomLocalParts(nowMillis, timezone = ROOM_DEFAULT_TIMEZONE) {
  const zone = isValidTimeZone(timezone) ? timezone : ROOM_DEFAULT_TIMEZONE;
  const parts = {};
  getFormatter(zone).formatToParts(new Date(nowMillis)).forEach((part) => {
    parts[part.type] = part.value;
  });
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: WEEKDAY_INDEX[parts.weekday] ?? 0,
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

function previousDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function ruleStartsOn(rule, dateKey, dayOfWeek) {
  const dates = Array.isArray(rule.dates) ? rule.dates : [];
  if (dates.length > 0) return dates.includes(dateKey);
  return (Array.isArray(rule.daysOfWeek) ? rule.daysOfWeek : []).includes(dayOfWeek);
}

// Inicio inclusivo, fin exclusivo; si fin <= inicio la ventana cruza medianoche.
export function isRoomRuleActiveAt(rule, nowMillis, timezone = ROOM_DEFAULT_TIMEZONE) {
  if (!rule || rule.active === false) return false;
  const start = roomTimeToMinutes(rule.startTime);
  const end = roomTimeToMinutes(rule.endTime);
  if (start < 0 || end < 0 || start === end) return false;

  const local = getRoomLocalParts(nowMillis, timezone);
  if (end > start) {
    return local.minutes >= start && local.minutes < end && ruleStartsOn(rule, local.dateKey, local.dayOfWeek);
  }
  if (local.minutes >= start) return ruleStartsOn(rule, local.dateKey, local.dayOfWeek);
  if (local.minutes < end) {
    return ruleStartsOn(rule, previousDateKey(local.dateKey), (local.dayOfWeek + 6) % 7);
  }
  return false;
}

function ruleTargetsDevice(rule, device) {
  const ids = Array.isArray(rule.deviceIds) ? rule.deviceIds : [];
  if (ids.length === 0) return true;
  return ids.includes(text(device?.id)) || ids.includes(text(device?.deviceToken));
}

export function resolveRoomLayout(manifest, device, nowMillis = Date.now()) {
  if (!manifest || manifest.version !== ROOM_MODEL_VERSION || manifest.active === false) return null;
  if (!device || device.active === false || !Array.isArray(manifest.layouts)) return null;

  const token = text(manifest.deviceToken);
  if (token && token !== text(device.deviceToken) && token !== text(device.id)) return null;
  const plantel = text(device.plantel);
  if (!plantel || text(manifest.plantel) !== plantel) return null;

  let best = null;
  for (const layout of manifest.layouts) {
    if (!layout || layout.active === false || text(layout.plantel) !== plantel) continue;
    const timezone = layout.timezone || manifest.timezone || ROOM_DEFAULT_TIMEZONE;
    for (const rule of Array.isArray(layout.displayRules) ? layout.displayRules : []) {
      if (!ruleTargetsDevice(rule, device) || !isRoomRuleActiveAt(rule, nowMillis, timezone)) continue;
      const candidate = { layout, rule };
      if (!best || compareCandidates(candidate, best) < 0) best = candidate;
    }
  }
  return best;
}

function compareCandidates(a, b) {
  const priorityDiff = (Number(b.rule.priority) || 0) - (Number(a.rule.priority) || 0);
  if (priorityDiff !== 0) return priorityDiff;
  const layoutDiff = compareIds(a.layout.id, b.layout.id);
  if (layoutDiff !== 0) return layoutDiff;
  return compareIds(a.rule.id, b.rule.id);
}

function compareIds(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}

// ---------- advertencias ----------

const EPOCH_DAY_MS = 86400000;

function dateKeyToDayIndex(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / EPOCH_DAY_MS);
}

function dayIndexToDateKey(dayIndex) {
  const date = new Date(dayIndex * EPOCH_DAY_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

// Intervalos absolutos [inicio, fin) en minutos para un conjunto de días candidatos.
function ruleIntervals(rule, dayIndexes) {
  const start = roomTimeToMinutes(rule.startTime);
  const end = roomTimeToMinutes(rule.endTime);
  if (start < 0 || end < 0 || start === end) return [];
  const spans = [];
  dayIndexes.forEach((dayIndex) => {
    const dayOfWeek = (((dayIndex + 4) % 7) + 7) % 7; // 1970-01-01 fue jueves
    if (!ruleStartsOn(rule, dayIndexToDateKey(dayIndex), dayOfWeek)) return;
    spans.push([dayIndex * 1440 + start, dayIndex * 1440 + (end > start ? end : end + 1440)]);
  });
  return spans;
}

function candidateDays(...rules) {
  const dated = rules.flatMap((rule) => (rule.dates || []).map(dateKeyToDayIndex));
  if (dated.length > 0) {
    return Array.from(new Set(dated.flatMap((day) => [day - 1, day, day + 1])));
  }
  return Array.from({ length: 14 }, (_, index) => 20000 + index);
}

function rulesOverlap(a, b) {
  const days = candidateDays(a, b);
  const first = ruleIntervals(a, days);
  const second = ruleIntervals(b, days);
  return first.some(([s1, e1]) => second.some(([s2, e2]) => s1 < e2 && s2 < e1));
}

function destinationsCompatible(a, b) {
  const first = a.deviceIds || [];
  const second = b.deviceIds || [];
  if (first.length === 0 || second.length === 0) return true;
  return first.some((id) => second.includes(id));
}

// Intervalos semanales [inicio, fin) en minutos; un bloque que cruza medianoche continúa al día
// siguiente (domingo -> lunes se resuelve comparando también con la semana vecina).
function classBlockSpans(block) {
  const start = roomTimeToMinutes(block.classStart);
  const end = roomTimeToMinutes(block.classEnd);
  if (start < 0 || end < 0 || start === end) return [];
  return cleanDays(block.classDays).map((day) => [day * 1440 + start, day * 1440 + (end > start ? end : end + 1440)]);
}

function classBlocksOverlap(a, b) {
  const week = 7 * 1440;
  const second = classBlockSpans(b);
  return classBlockSpans(a).some(([s1, e1]) =>
    second.some(([s2, e2]) => [-week, 0, week].some((shift) => s1 < e2 + shift && s2 + shift < e1))
  );
}

function teacherKey(name) {
  return text(name).toLocaleLowerCase("es").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function describeRule(rule) {
  return `${rule.startTime}–${rule.endTime}`;
}

// Dos acomodos compiten solo si pueden coincidir en algún plantel (antiguos: mismo plantel, como siempre).
function sharesDestination(a, b) {
  if (!a.destinations && !b.destinations) return a.plantel === b.plantel;
  const mine = new Set(getRoomLayoutPlanteles(a));
  return getRoomLayoutPlanteles(b).some((plantel) => mine.has(plantel));
}

export function getRoomLayoutWarnings(layout, allLayouts = [], devices = []) {
  const warnings = [];
  const current = normalizeRoomLayout(layout || {});
  const currentId = current.id || "";
  const activeAssignments = current.assignments.filter((row) => row.active);

  // Con matriz, el maestro vive en las celdas: los avisos por fila no aplican.
  const withoutTeacher = current.schedule ? 0 : activeAssignments.filter((row) => !row.teacher).length;
  if (current.schedule) warnings.push(...getScheduleWarnings(current.schedule, current.assignments));
  if (withoutTeacher > 0) {
    warnings.push(`${withoutTeacher} fila(s) activa(s) sin maestro; se mostrarán sin nombre al publicar.`);
  }

  // Maestro duplicado dentro del mismo bloque.
  const byTeacher = new Map();
  activeAssignments.forEach((row) => {
    const key = teacherKey(row.teacher);
    if (!key) return;
    byTeacher.set(key, [...(byTeacher.get(key) || []), row]);
  });
  byTeacher.forEach((rows) => {
    if (rows.length > 1) {
      warnings.push(`${rows[0].teacher} está asignado a ${rows.length} salones en el mismo bloque (${rows.map((row) => row.roomName || "sin salón").join(", ")}).`);
    }
  });

  // Salón repetido con maestros distintos.
  const byRoom = new Map();
  activeAssignments.forEach((row) => {
    const key = teacherKey(row.roomName);
    if (key) byRoom.set(key, [...(byRoom.get(key) || []), row]);
  });
  byRoom.forEach((rows) => {
    const teachers = new Set(rows.map((row) => teacherKey(row.teacher)));
    if (rows.length > 1 && teachers.size > 1) {
      warnings.push(`El salón ${rows[0].roomName} aparece ${rows.length} veces con maestros distintos.`);
    }
  });

  const others = (Array.isArray(allLayouts) ? allLayouts : [])
    .map((other) => normalizeRoomLayout(other || {}))
    .filter((other) => other.active && sharesDestination(current, other) && (!currentId || other.id !== currentId));

  // Maestro simultáneo en otros acomodos del mismo plantel con bloque de clase solapado.
  others.forEach((other) => {
    if (!classBlocksOverlap(current, other)) return;
    const otherTeachers = new Set(other.assignments.filter((row) => row.active).map((row) => teacherKey(row.teacher)).filter(Boolean));
    const shared = Array.from(byTeacher.keys()).filter((key) => otherTeachers.has(key));
    shared.forEach((key) => {
      warnings.push(`${byTeacher.get(key)[0].teacher} también está en "${other.name || other.id}" (${formatRoomClassTime(other)}), que coincide en horario.`);
    });
  });

  // Ventanas de aparición superpuestas con destinos compatibles.
  const currentRules = current.displayRules.filter((rule) => rule.active);
  others.forEach((other) => {
    const overlapsScreens = getRoomLayoutDestinations(current).some(mine =>
      getRoomLayoutDestinations(other).some(theirs => mine.plantel === theirs.plantel &&
        (!mine.deviceIds.length || !theirs.deviceIds.length || mine.deviceIds.some(id => theirs.deviceIds.includes(id)))));
    if (!overlapsScreens) return;
    const hit = currentRules.find((rule) =>
      other.displayRules.some((otherRule) =>
        otherRule.active && destinationsCompatible(rule, otherRule) && rulesOverlap(rule, otherRule)
      )
    );
    if (hit) {
      warnings.push(`La ventana ${describeRule(hit)} se superpone con "${other.name || other.id}"; se mostrará el de mayor prioridad y, a igualdad, el de ID menor.`);
    }
  });

  // Destinos explícitos que no pertenecen al plantel.
  const deviceList = Array.isArray(devices) ? devices : [];
  if (deviceList.length > 0) {
    const known = new Map(deviceList.map((device) => [text(device.id || device.deviceToken), device]));
    const independent = Boolean(current.destinations);
    currentRules.forEach((rule) => {
      rule.deviceIds.forEach((id) => {
        const device = known.get(id);
        if (!device) warnings.push(`La ventana ${describeRule(rule)} apunta a una pantalla que ya no existe (${id}).`);
        else if (independent ? !roomLayoutTargetsDevice(current, device) : text(device.plantel) !== current.plantel) {
          warnings.push(independent
            ? `La pantalla "${device.name || id}" está fuera de los destinos y no mostrará este acomodo.`
            : `La pantalla "${device.name || id}" pertenece a otro plantel y no mostrará este acomodo.`);
        }
      });
    });
    const plantelDevices = deviceList.filter((device) =>
      (independent ? roomLayoutTargetsDevice(current, device) : text(device.plantel) === current.plantel) && device.active !== false);
    if (currentRules.length > 0 && plantelDevices.length === 0) {
      warnings.push(independent ? "Los destinos no tienen pantallas activas." : "El plantel no tiene pantallas activas.");
    }
  }

  return Array.from(new Set(warnings));
}

// Estado para la insignia publicada/pendiente (sin tocar el borrador).
export function getRoomLayoutPublicationState(layout, template) {
  const snapshot = layout?.publishedSnapshot;
  if (!snapshot) return "unpublished";
  const { template: snapshotTemplate, publishedAtMillis: _ignored, ...snapshotLayout } = snapshot; // eslint-disable-line no-unused-vars
  const draft = JSON.stringify(normalizeRoomLayout({ ...layout, id: layout.id }));
  const published = JSON.stringify(normalizeRoomLayout(snapshotLayout));
  if (draft !== published) return "pending";
  if (template && JSON.stringify(normalizeRoomTemplate({ ...template, id: undefined })) !==
      JSON.stringify(normalizeRoomTemplate({ ...snapshotTemplate, id: undefined }))) {
    return "pending";
  }
  return "published";
}

export function normalizePublishedRoomLayout(data = {}) {
  const layout = normalizeRoomLayout(data);
  return {
    ...layout,
    template: normalizeRoomTemplate(data?.template || {}),
    publishedAtMillis: normalizeMillis(data?.publishedAtMillis),
  };
}
