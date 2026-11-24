// Modelo puro de la matriz "Acomodo por horarios": filas = asignaciones del acomodo,
// columnas = horarios, celdas dispersas (una celda vacía simplemente no existe), etiquetas
// reutilizables y vistas/páginas. Sin dependencias de Firebase/React.
//
// Contrato: validateRoomSchedule rechaza (nunca trunca) y siempre se ejecuta ANTES de normalizar;
// normalizeRoomSchedule es tolerante y solo descarta lo que no puede referenciarse.

export const SCHEDULE_MODEL_VERSION = 1;
export const SCHEDULE_MAX_ROWS = 200;
export const SCHEDULE_MAX_COLUMNS = 48;
export const SCHEDULE_MAX_CELLS = 9600;
export const SCHEDULE_MAX_VIEWS = 48;
export const SCHEDULE_MAX_TAGS = 100;
export const SCHEDULE_MAX_CELL_TAGS = 10;
export const SCHEDULE_MIN_ROWS_PER_PAGE = 1;
export const SCHEDULE_MAX_ROWS_PER_PAGE = 12;
export const SCHEDULE_MIN_COLUMNS_PER_PAGE = 1;
export const SCHEDULE_MAX_COLUMNS_PER_PAGE = 6;
export const SCHEDULE_MIN_PAGE_SECONDS = 3;
export const SCHEDULE_MAX_PAGE_SECONDS = 120;

const ID_MAX = 120;
const CELL_TEXT_MAX = 120;
const LABEL_MAX = 40;
const NAME_MAX = 60;
const SHIFT_MAX = 60;
const DEFAULT_ROWS_PER_PAGE = 8;
const DEFAULT_COLUMNS_PER_PAGE = 3;
const DEFAULT_PAGE_SECONDS = 10;
const DEFAULT_TAG_COLOR = "#ffffff";
const DEFAULT_TAG_BACKGROUND = "#bb4937";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGB_PATTERN = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/;
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/g;

// ---------- estilo de la matriz ----------

export const MATRIX_FONT_FAMILIES = Object.freeze([
  "sans-serif", "serif", "monospace", "Arial", "Verdana", "Georgia", "Trebuchet MS",
]);
export const MATRIX_ROOM_SHAPES = Object.freeze(["circle", "rounded", "square", "pill"]);

export const DEFAULT_MATRIX_STYLE = Object.freeze({
  fontFamily: "sans-serif",
  fontSize: 34,
  headerColor: "#ffffff",
  cellColor: "#11243a",
  cellBackground: "#edf4ff",
  roomColor: "#ffffff",
  roomBackground: "#bb4937",
  roomShape: "circle",
  rowGap: 10,
  columnGap: 16,
  borderRadius: 10,
  borderColor: "#c2d2ed",
  roomWidth: 120,
});

// ---------- utilidades ----------

let idCounter = 0;

function createScheduleId(prefix) {
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (cryptoApi?.randomUUID) return `${prefix}-${cryptoApi.randomUUID()}`;
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanId(value) {
  return String(value ?? "").trim().slice(0, ID_MAX);
}

function cleanPlain(value, max) {
  return String(value ?? "").replace(CONTROL_PATTERN, " ").trim().slice(0, max);
}

function cleanColor(value, fallback = "") {
  const clean = String(value ?? "").trim().slice(0, 60);
  if (clean === "transparent" || HEX_PATTERN.test(clean) || RGB_PATTERN.test(clean)) return clean;
  return fallback;
}

function toNumber(value) {
  if (value === undefined || value === null) return NaN;
  if (typeof value === "string" && value.trim() === "") return NaN;
  return Number(value);
}

function clampNumber(value, min, max, fallback) {
  const number = toNumber(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function clampInt(value, min, max, fallback) {
  const number = toNumber(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

function cleanTime(value) {
  const clean = String(value ?? "").trim();
  return TIME_PATTERN.test(clean) ? clean : "";
}

function timeToMinutes(value) {
  const clean = cleanTime(value);
  if (!clean) return -1;
  const [hours, minutes] = clean.split(":").map(Number);
  return hours * 60 + minutes;
}

function cellKey(rowId, columnId) {
  return `${rowId}\u0000${columnId}`;
}

// "15:00" -> "3:00 PM". Etiqueta por omisión de una columna.
export function formatScheduleTimeLabel(time) {
  const clean = cleanTime(time);
  if (!clean) return "";
  const [hours, minutes] = clean.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}

export function normalizeMatrixStyle(style) {
  const source = isObject(style) ? style : {};
  const fallback = DEFAULT_MATRIX_STYLE;
  return {
    fontFamily: MATRIX_FONT_FAMILIES.includes(source.fontFamily) ? source.fontFamily : fallback.fontFamily,
    fontSize: clampNumber(source.fontSize, 12, 120, fallback.fontSize),
    headerColor: cleanColor(source.headerColor, fallback.headerColor),
    cellColor: cleanColor(source.cellColor, fallback.cellColor),
    cellBackground: cleanColor(source.cellBackground, fallback.cellBackground),
    roomColor: cleanColor(source.roomColor, fallback.roomColor),
    roomBackground: cleanColor(source.roomBackground, fallback.roomBackground),
    roomShape: MATRIX_ROOM_SHAPES.includes(source.roomShape) ? source.roomShape : fallback.roomShape,
    rowGap: clampNumber(source.rowGap, 0, 60, fallback.rowGap),
    columnGap: clampNumber(source.columnGap, 0, 80, fallback.columnGap),
    borderRadius: clampNumber(source.borderRadius, 0, 60, fallback.borderRadius),
    borderColor: cleanColor(source.borderColor, fallback.borderColor),
    roomWidth: clampNumber(source.roomWidth, 40, 300, fallback.roomWidth),
  };
}

// ---------- creación ----------

// `assignments` se acepta por simetría con el contrato; las celdas nacen vacías (sin nombres reales).
export function createRoomSchedule(assignments = []) { // eslint-disable-line no-unused-vars
  const columns = [15, 16, 17].map((hour) => ({
    id: createScheduleId("column"),
    label: formatScheduleTimeLabel(`${String(hour).padStart(2, "0")}:00`),
    startTime: `${String(hour).padStart(2, "0")}:00`,
    endTime: `${String(hour + 1).padStart(2, "0")}:00`,
  }));
  return {
    version: SCHEDULE_MODEL_VERSION,
    shift: "",
    columns,
    cells: [],
    tags: [],
    views: [
      {
        id: createScheduleId("view"),
        name: "Vista 1",
        columnIds: columns.map((column) => column.id),
        rowsPerPage: DEFAULT_ROWS_PER_PAGE,
        columnsPerPage: DEFAULT_COLUMNS_PER_PAGE,
        pageSeconds: DEFAULT_PAGE_SECONDS,
        rotate: true,
      },
    ],
  };
}

// ---------- normalización (tolerante) ----------

function normalizeColumns(source) {
  const seen = new Set();
  const columns = [];
  (Array.isArray(source) ? source : []).slice(0, SCHEDULE_MAX_COLUMNS).forEach((column) => {
    const id = cleanId(column?.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const startTime = cleanTime(column?.startTime);
    columns.push({
      id,
      label: cleanPlain(column?.label, LABEL_MAX) || formatScheduleTimeLabel(startTime),
      startTime,
      endTime: cleanTime(column?.endTime),
    });
  });
  return columns;
}

function normalizeTags(source) {
  const seen = new Set();
  const tags = [];
  (Array.isArray(source) ? source : []).slice(0, SCHEDULE_MAX_TAGS).forEach((tag) => {
    const id = cleanId(tag?.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    tags.push({
      id,
      name: cleanPlain(tag?.name, LABEL_MAX) || "Etiqueta",
      color: cleanColor(tag?.color, DEFAULT_TAG_COLOR),
      backgroundColor: cleanColor(tag?.backgroundColor, DEFAULT_TAG_BACKGROUND),
    });
  });
  return tags;
}

function normalizeViews(source, columnIds) {
  const seen = new Set();
  const views = [];
  (Array.isArray(source) ? source : []).slice(0, SCHEDULE_MAX_VIEWS).forEach((view) => {
    const id = cleanId(view?.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const used = new Set();
    const viewColumnIds = (Array.isArray(view?.columnIds) ? view.columnIds : [])
      .map(cleanId)
      .filter((columnId) => {
        if (!columnIds.has(columnId) || used.has(columnId)) return false;
        used.add(columnId);
        return true;
      });
    views.push({
      id,
      name: cleanPlain(view?.name, NAME_MAX) || `Vista ${views.length + 1}`,
      columnIds: viewColumnIds,
      rowsPerPage: clampInt(view?.rowsPerPage, SCHEDULE_MIN_ROWS_PER_PAGE, SCHEDULE_MAX_ROWS_PER_PAGE, DEFAULT_ROWS_PER_PAGE),
      columnsPerPage: clampInt(view?.columnsPerPage, SCHEDULE_MIN_COLUMNS_PER_PAGE, SCHEDULE_MAX_COLUMNS_PER_PAGE, DEFAULT_COLUMNS_PER_PAGE),
      pageSeconds: clampInt(view?.pageSeconds, SCHEDULE_MIN_PAGE_SECONDS, SCHEDULE_MAX_PAGE_SECONDS, DEFAULT_PAGE_SECONDS),
      rotate: view?.rotate !== false,
    });
  });
  return views;
}

function normalizeCells(source, columnIds, rowIds, tagIds) {
  const seen = new Set();
  const cells = [];
  (Array.isArray(source) ? source : []).slice(0, SCHEDULE_MAX_CELLS).forEach((cell) => {
    const rowId = cleanId(cell?.rowId);
    const columnId = cleanId(cell?.columnId);
    if (!rowId || !columnIds.has(columnId) || (rowIds && !rowIds.has(rowId))) return;
    const key = cellKey(rowId, columnId);
    if (seen.has(key)) return;
    const used = new Set();
    const cellTagIds = (Array.isArray(cell?.tagIds) ? cell.tagIds : [])
      .map(cleanId)
      .filter((tagId) => {
        if (!tagIds.has(tagId) || used.has(tagId)) return false;
        used.add(tagId);
        return true;
      })
      .slice(0, SCHEDULE_MAX_CELL_TAGS);
    const normalized = {
      rowId,
      columnId,
      teacher: cleanPlain(cell?.teacher, CELL_TEXT_MAX),
      activity: cleanPlain(cell?.activity, CELL_TEXT_MAX),
      tagIds: cellTagIds,
      color: cleanColor(cell?.color),
      backgroundColor: cleanColor(cell?.backgroundColor),
    };
    // Una celda sin contenido ni estilo equivale a ausencia: no se persiste.
    if (!normalized.teacher && !normalized.activity && !normalized.tagIds.length &&
        !normalized.color && !normalized.backgroundColor) return;
    seen.add(key);
    cells.push(normalized);
  });
  return cells;
}

// `assignments` (opcional): si es un arreglo, descarta celdas cuya fila no exista (aislamiento).
export function normalizeRoomSchedule(source, assignments) {
  if (!isObject(source)) return null;
  const columns = normalizeColumns(source.columns);
  const columnIds = new Set(columns.map((column) => column.id));
  const tags = normalizeTags(source.tags);
  const tagIds = new Set(tags.map((tag) => tag.id));
  const rowIds = Array.isArray(assignments)
    ? new Set(assignments.map((row) => cleanId(row?.id)).filter(Boolean))
    : null;
  return {
    version: SCHEDULE_MODEL_VERSION,
    shift: cleanPlain(source.shift, SHIFT_MAX),
    columns,
    cells: normalizeCells(source.cells, columnIds, rowIds, tagIds),
    tags,
    views: normalizeViews(source.views, columnIds),
  };
}

// ---------- validación (estricta, antes de normalizar) ----------

function listOf(value, max, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`La matriz de horarios: ${label} no es una lista válida.`);
  if (value.length > max) throw new Error(`La matriz de horarios admite máximo ${max} ${label}.`);
  return value;
}

function requireId(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}: falta el identificador.`);
  const clean = value.trim();
  if (clean.length > ID_MAX) throw new Error(`${label}: el identificador supera ${ID_MAX} caracteres.`);
  return clean;
}

function checkText(value, max, label, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label}: es obligatorio.`);
    return "";
  }
  if (typeof value !== "string") throw new Error(`${label}: debe ser texto.`);
  const clean = value.replace(CONTROL_PATTERN, " ").trim();
  if (required && !clean) throw new Error(`${label}: es obligatorio.`);
  if (clean.length > max) throw new Error(`${label}: máximo ${max} caracteres.`);
  return clean;
}

function checkRange(value, min, max, label) {
  if (value === undefined || value === null) return;
  const number = toNumber(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label}: debe ser un entero entre ${min} y ${max}.`);
  }
}

function checkTime(value, label) {
  if (typeof value !== "string" || !TIME_PATTERN.test(value.trim())) {
    throw new Error(`${label}: hora no válida (usa HH:MM).`);
  }
  return value.trim();
}

function validateRowReferences(assignments) {
  if (!Array.isArray(assignments)) return null;
  if (assignments.length > SCHEDULE_MAX_ROWS) {
    throw new Error(`La matriz de horarios admite máximo ${SCHEDULE_MAX_ROWS} filas.`);
  }
  const ids = new Set();
  assignments.forEach((row, index) => {
    const id = cleanId(row?.id);
    if (!id) throw new Error(`Fila ${index + 1}: la matriz de horarios requiere un identificador estable.`);
    if (ids.has(id)) throw new Error(`Fila ${index + 1}: identificador de fila repetido; las celdas quedarían ambiguas.`);
    ids.add(id);
  });
  return ids;
}

// Devuelve la matriz normalizada o lanza un Error en español. `assignments` undefined omite las
// referencias a filas (validación parcial); un arreglo las exige.
export function validateRoomSchedule(source, assignments) {
  if (!isObject(source)) throw new Error("La matriz de horarios no es válida.");
  if (source.version !== undefined && source.version !== SCHEDULE_MODEL_VERSION) {
    throw new Error("Versión de la matriz de horarios no compatible.");
  }
  // Primero todos los topes exactos: nada se trunca.
  const columns = listOf(source.columns, SCHEDULE_MAX_COLUMNS, "columnas");
  const cells = listOf(source.cells, SCHEDULE_MAX_CELLS, "celdas");
  const tags = listOf(source.tags, SCHEDULE_MAX_TAGS, "etiquetas");
  const views = listOf(source.views, SCHEDULE_MAX_VIEWS, "vistas");
  const rowIds = validateRowReferences(assignments);
  checkText(source.shift, SHIFT_MAX, "Turno");

  if (columns.length === 0) throw new Error("La matriz de horarios necesita al menos una columna.");
  const columnIds = new Set();
  columns.forEach((column, index) => {
    const label = `Columna ${index + 1}`;
    if (!isObject(column)) throw new Error(`${label}: no es válida.`);
    const id = requireId(column.id, label);
    if (columnIds.has(id)) throw new Error(`${label}: identificador repetido.`);
    columnIds.add(id);
    checkText(column.label, LABEL_MAX, `${label} (nombre)`);
    const start = timeToMinutes(checkTime(column.startTime, `${label} (inicio)`));
    const end = timeToMinutes(checkTime(column.endTime, `${label} (fin)`));
    if (end <= start) throw new Error(`${label}: el fin debe ser posterior al inicio.`);
  });

  const tagIds = new Set();
  tags.forEach((tag, index) => {
    const label = `Etiqueta ${index + 1}`;
    if (!isObject(tag)) throw new Error(`${label}: no es válida.`);
    const id = requireId(tag.id, label);
    if (tagIds.has(id)) throw new Error(`${label}: identificador repetido.`);
    tagIds.add(id);
    checkText(tag.name, LABEL_MAX, `${label} (nombre)`, { required: true });
  });

  const viewIds = new Set();
  views.forEach((view, index) => {
    const label = `Vista ${index + 1}`;
    if (!isObject(view)) throw new Error(`${label}: no es válida.`);
    const id = requireId(view.id, label);
    if (viewIds.has(id)) throw new Error(`${label}: identificador repetido.`);
    viewIds.add(id);
    checkText(view.name, NAME_MAX, `${label} (nombre)`, { required: true });
    const used = listOf(view.columnIds, SCHEDULE_MAX_COLUMNS, `columnas de ${label}`);
    if (used.length === 0) throw new Error(`${label}: elige al menos una columna.`);
    const seen = new Set();
    used.forEach((columnId) => {
      const clean = typeof columnId === "string" ? columnId.trim() : "";
      if (!columnIds.has(clean)) throw new Error(`${label}: usa una columna que no existe.`);
      if (seen.has(clean)) throw new Error(`${label}: repite una columna.`);
      seen.add(clean);
    });
    checkRange(view.rowsPerPage, SCHEDULE_MIN_ROWS_PER_PAGE, SCHEDULE_MAX_ROWS_PER_PAGE, `${label} (filas por página)`);
    checkRange(view.columnsPerPage, SCHEDULE_MIN_COLUMNS_PER_PAGE, SCHEDULE_MAX_COLUMNS_PER_PAGE, `${label} (columnas por página)`);
    checkRange(view.pageSeconds, SCHEDULE_MIN_PAGE_SECONDS, SCHEDULE_MAX_PAGE_SECONDS, `${label} (segundos por página)`);
    if (view.rotate !== undefined && typeof view.rotate !== "boolean") {
      throw new Error(`${label}: la rotación debe ser verdadero o falso.`);
    }
  });

  const seenCells = new Set();
  cells.forEach((cell, index) => {
    const label = `Celda ${index + 1}`;
    if (!isObject(cell)) throw new Error(`${label}: no es válida.`);
    const rowId = requireId(cell.rowId, `${label} (fila)`);
    const columnId = requireId(cell.columnId, `${label} (columna)`);
    if (!columnIds.has(columnId)) throw new Error(`${label}: usa una columna que no existe.`);
    if (rowIds && !rowIds.has(rowId)) throw new Error(`${label}: usa una fila que no existe en este acomodo.`);
    const key = cellKey(rowId, columnId);
    if (seenCells.has(key)) throw new Error(`${label}: ya existe otra celda para ese salón y horario.`);
    seenCells.add(key);
    const teacher = checkText(cell.teacher, CELL_TEXT_MAX, `${label} (maestro)`);
    const activity = checkText(cell.activity, CELL_TEXT_MAX, `${label} (actividad)`);
    if (teacher && activity) throw new Error(`${label}: usa maestro o actividad, no ambos.`);
    const cellTags = listOf(cell.tagIds, SCHEDULE_MAX_CELL_TAGS, `etiquetas de ${label}`);
    const usedTags = new Set();
    cellTags.forEach((tagId) => {
      const clean = typeof tagId === "string" ? tagId.trim() : "";
      if (!tagIds.has(clean)) throw new Error(`${label}: usa una etiqueta que no existe.`);
      if (usedTags.has(clean)) throw new Error(`${label}: repite una etiqueta.`);
      usedTags.add(clean);
    });
    ["color", "backgroundColor"].forEach((field) => {
      if (cell[field] !== undefined && cell[field] !== null && typeof cell[field] !== "string") {
        throw new Error(`${label}: color no válido.`);
      }
    });
  });

  return normalizeRoomSchedule(source, assignments);
}

// ---------- lectura ----------

export function getScheduleCell(schedule, rowId, columnId) {
  const cells = Array.isArray(schedule?.cells) ? schedule.cells : [];
  const row = cleanId(rowId);
  const column = cleanId(columnId);
  return cells.find((cell) => cell?.rowId === row && cell?.columnId === column) || null;
}

// Sin viewId: primera vista. Con viewId desconocido: null (la regla se valida al publicar).
export function getScheduleView(schedule, viewId = "") {
  const views = Array.isArray(schedule?.views) ? schedule.views : [];
  if (views.length === 0) return null;
  const id = cleanId(viewId);
  if (!id) return views[0];
  return views.find((view) => view?.id === id) || null;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

// Páginas deterministas en orden fila-mayor: por cada bloque de filas, cada bloque de columnas.
// Respeta el orden de las asignaciones activas y de view.columnIds. Layout sin matriz => [].
export function getSchedulePages(layout, viewId = "") {
  const schedule = normalizeRoomSchedule(layout?.schedule);
  if (!schedule) return [];
  // Un viewId obsoleto cae en la primera vista antes que dejar la pantalla vacía.
  const view = getScheduleView(schedule, viewId) || getScheduleView(schedule, "");
  const byId = new Map(schedule.columns.map((column) => [column.id, column]));
  const columns = view
    ? view.columnIds.map((id) => byId.get(id)).filter(Boolean)
    : schedule.columns;
  if (columns.length === 0) return [];

  const rows = (Array.isArray(layout?.assignments) ? layout.assignments : []).filter(
    (row) => row && row.active !== false
  );
  const rowsPerPage = view?.rowsPerPage || DEFAULT_ROWS_PER_PAGE;
  const columnsPerPage = view?.columnsPerPage || DEFAULT_COLUMNS_PER_PAGE;
  const rowChunks = rows.length > 0 ? chunk(rows, rowsPerPage) : [[]];
  const columnChunks = chunk(columns, columnsPerPage);
  return rowChunks.flatMap((pageRows) => columnChunks.map((pageColumns) => ({ rows: pageRows, columns: pageColumns })));
}

// Página visible: índice explícito (vista previa) o rotación por reloj solo si la vista rota.
export function getScheduleActivePageIndex(view, pageCount, nowMillis = Date.now(), explicitIndex = null) {
  const count = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (count <= 1) return 0;
  const explicit = toNumber(explicitIndex);
  if (Number.isFinite(explicit)) return Math.min(Math.max(Math.floor(explicit), 0), count - 1);
  if (!view || view.rotate === false) return 0;
  const seconds = clampInt(view.pageSeconds, SCHEDULE_MIN_PAGE_SECONDS, SCHEDULE_MAX_PAGE_SECONDS, DEFAULT_PAGE_SECONDS);
  const now = Number(nowMillis);
  if (!Number.isFinite(now)) return 0;
  return Math.floor(Math.max(now, 0) / (seconds * 1000)) % count;
}

// Reasigna rowId al duplicar filas con ID nuevos. `mapping`: Map u objeto id viejo -> id nuevo;
// las celdas de filas sin correspondencia se descartan (nunca apuntan a filas ajenas).
export function remapScheduleRowIds(schedule, mapping) {
  const normalized = normalizeRoomSchedule(schedule);
  if (!normalized) return null;
  const lookup = mapping instanceof Map ? mapping : new Map(Object.entries(mapping || {}));
  const cells = normalized.cells
    .filter((cell) => lookup.has(cell.rowId))
    .map((cell) => ({ ...cell, rowId: cleanId(lookup.get(cell.rowId)) }));
  return normalizeRoomSchedule({ ...normalized, cells });
}

function teacherKey(name) {
  return String(name ?? "").trim().toLocaleLowerCase("es").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function getScheduleWarnings(schedule, assignments = []) {
  const normalized = normalizeRoomSchedule(schedule, assignments);
  if (!normalized) return [];
  const warnings = [];
  const rows = new Map((Array.isArray(assignments) ? assignments : [])
    .filter((row) => row && row.active !== false)
    .map((row) => [cleanId(row.id), row]));

  normalized.columns.forEach((column) => {
    const byTeacher = new Map();
    normalized.cells.forEach((cell) => {
      if (cell.columnId !== column.id || !cell.teacher || !rows.has(cell.rowId)) return;
      const key = teacherKey(cell.teacher);
      byTeacher.set(key, [...(byTeacher.get(key) || []), cell]);
    });
    byTeacher.forEach((list) => {
      if (list.length > 1) {
        const names = list.map((cell) => rows.get(cell.rowId)?.roomName || "sin salón").join(", ");
        warnings.push(`${list[0].teacher} está en ${list.length} salones a las ${column.label} (${names}).`);
      }
    });
  });

  const inViews = new Set(normalized.views.flatMap((view) => view.columnIds));
  if (normalized.views.length > 0) {
    const unused = normalized.columns.filter((column) => !inViews.has(column.id));
    if (unused.length > 0) {
      warnings.push(`${unused.length} horario(s) no aparecen en ninguna vista: ${unused.map((column) => column.label).join(", ")}.`);
    }
  }
  return warnings;
}
