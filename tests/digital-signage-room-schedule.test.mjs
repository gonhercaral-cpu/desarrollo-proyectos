import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MATRIX_STYLE,
  SCHEDULE_MAX_CELLS,
  createRoomSchedule,
  getScheduleActivePageIndex,
  getScheduleCell,
  getSchedulePages,
  getScheduleView,
  getScheduleWarnings,
  normalizeMatrixStyle,
  normalizeRoomSchedule,
  remapScheduleRowIds,
  validateRoomSchedule,
} from "../src/utils/digitalSignage/roomSchedule.js";
import {
  DEFAULT_ROOM_TEMPLATE,
  DEFAULT_SCHEDULE_TEMPLATE,
  SCHEDULE_GRID_TEMPLATE_ID,
  createRoomLayoutDraft,
  getBuiltInRoomTemplate,
  getRoomLayoutPublicationState,
  getRoomLayoutWarnings,
  normalizeDisplayRule,
  resolveRoomLayout,
  normalizeRoomLayout,
  normalizeRoomTemplate,
  validateRoomLayout,
  validateRoomTemplate,
} from "../src/utils/digitalSignage/roomLayouts.js";
import {
  buildPublishedRoomSnapshot,
  buildRoomDisplayManifest,
  normalizeRoomManifest,
} from "../src/utils/digitalSignage/roomPublication.js";

const rowsOf = (count) => Array.from({ length: count }, (_, index) => ({
  id: `row-${index + 1}`, roomName: String(index + 1), teacher: "", group: "", active: true,
}));

const columnsOf = (count) => Array.from({ length: count }, (_, index) => {
  const start = (index % 23) * 60;
  const format = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return { id: `col-${index + 1}`, label: `H${index + 1}`, startTime: format(start), endTime: format(start + 30) };
});

function scheduleOf({ columns = 3, cells = [], tags = [], views } = {}) {
  const cols = columnsOf(columns);
  return {
    version: 1,
    shift: "Vespertino",
    columns: cols,
    cells,
    tags,
    views: views || [{ id: "v1", name: "Vista A", columnIds: cols.map((column) => column.id) }],
  };
}

function layoutWith(schedule, overrides = {}) {
  return {
    ...createRoomLayoutDraft({ plantel: "Norte", rooms: [] }),
    id: "layout-1",
    name: "Matriz",
    assignments: rowsOf(8),
    schedule,
    ...overrides,
  };
}

test("createRoomSchedule: 15, 16 y 17 h, una vista y sin nombres reales", () => {
  const schedule = createRoomSchedule(rowsOf(3));
  assert.deepEqual(schedule.columns.map((column) => column.startTime), ["15:00", "16:00", "17:00"]);
  assert.deepEqual(schedule.columns.map((column) => column.label), ["3:00 PM", "4:00 PM", "5:00 PM"]);
  assert.equal(schedule.views.length, 1);
  assert.deepEqual(schedule.views[0].columnIds, schedule.columns.map((column) => column.id));
  assert.deepEqual(schedule.cells, []);
  assert.doesNotThrow(() => validateRoomSchedule(schedule, rowsOf(3)));
  assert.deepEqual(normalizeRoomSchedule(schedule), schedule, "normalizar es idempotente");
});

test("matriz 8x3 con celdas dispersas, etiquetas y orden arbitrario", () => {
  const assignments = rowsOf(8);
  const base = scheduleOf({
    tags: [{ id: "kids", name: "KIDS", color: "#ffffff", backgroundColor: "#d97706" }],
    cells: [
      { rowId: "row-5", columnId: "col-1", teacher: "Johanna", tagIds: ["kids"] },
      { rowId: "row-5", columnId: "col-3", teacher: "Paloma" },
      { rowId: "row-7", columnId: "col-2", activity: "Conv. Club" },
      { rowId: "row-8", columnId: "col-2" }, // vacía: no se persiste
    ],
  });
  // Orden de columnas distinto al original en la vista.
  base.views[0].columnIds = ["col-3", "col-1", "col-2"];
  const schedule = validateRoomSchedule(base, assignments);
  assert.equal(schedule.cells.length, 3, "la celda vacía desaparece");
  assert.equal(getScheduleCell(schedule, "row-5", "col-1").teacher, "Johanna");
  assert.deepEqual(getScheduleCell(schedule, "row-5", "col-1").tagIds, ["kids"]);
  assert.equal(getScheduleCell(schedule, "row-5", "col-2"), null, "hueco = ausente");
  assert.equal(getScheduleCell(schedule, "row-7", "col-2").activity, "Conv. Club");

  const pages = getSchedulePages({ assignments, schedule });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].rows.length, 8);
  assert.deepEqual(pages[0].columns.map((column) => column.id), ["col-3", "col-1", "col-2"]);
});

test("más de 8 filas y más de 3 columnas se paginan en orden fila-mayor sin perder nada", () => {
  const assignments = rowsOf(10);
  assignments[2].active = false; // las inactivas no se muestran
  const schedule = scheduleOf({ columns: 7 });
  schedule.views[0].rowsPerPage = 4;
  schedule.views[0].columnsPerPage = 3;
  const pages = getSchedulePages({ assignments, schedule });
  // 9 filas activas -> 3 bloques (4,4,1); 7 columnas -> 3 bloques (3,3,1)
  assert.equal(pages.length, 9);
  assert.deepEqual(pages.slice(0, 3).map((page) => page.columns.map((column) => column.id)), [
    ["col-1", "col-2", "col-3"], ["col-4", "col-5", "col-6"], ["col-7"],
  ]);
  assert.deepEqual(pages[0].rows.map((row) => row.id), ["row-1", "row-2", "row-4", "row-5"]);
  assert.deepEqual(pages[3].rows.map((row) => row.id), ["row-6", "row-7", "row-8", "row-9"]);
  assert.deepEqual(pages[8].rows.map((row) => row.id), ["row-10"]);
  assert.deepEqual(Object.keys(pages[0]).sort(), ["columns", "rows"]);
  assert.deepEqual(getSchedulePages({ assignments, schedule }), pages, "determinista");
});

test("páginas por vista: cada vista usa sus columnas y las mismas celdas", () => {
  const assignments = rowsOf(2);
  const schedule = scheduleOf({
    columns: 6,
    cells: [{ rowId: "row-1", columnId: "col-5", teacher: "Anahy" }],
    views: [
      { id: "a", name: "A", columnIds: ["col-1", "col-2", "col-3"] },
      { id: "b", name: "B", columnIds: ["col-4", "col-5", "col-6"] },
    ],
  });
  const layout = { assignments, schedule: validateRoomSchedule(schedule, assignments) };
  assert.deepEqual(getSchedulePages(layout, "a")[0].columns.map((column) => column.id), ["col-1", "col-2", "col-3"]);
  assert.deepEqual(getSchedulePages(layout, "b")[0].columns.map((column) => column.id), ["col-4", "col-5", "col-6"]);
  assert.deepEqual(getSchedulePages(layout)[0].columns[0].id, "col-1", "por omisión, primera vista");
  assert.deepEqual(getSchedulePages(layout, "obsoleta")[0].columns[0].id, "col-1", "vista obsoleta no deja la pantalla vacía");
  assert.equal(getScheduleView(layout.schedule, "b").name, "B");
  assert.equal(getScheduleView(layout.schedule, "zzz"), null);
  assert.deepEqual(getSchedulePages({ assignments }), [], "sin matriz no hay páginas");
});

test("rotación de página: reloj solo si rota; índice explícito para vista previa", () => {
  const view = { rotate: true, pageSeconds: 10 };
  assert.equal(getScheduleActivePageIndex(view, 3, 0), 0);
  assert.equal(getScheduleActivePageIndex(view, 3, 10_000), 1);
  assert.equal(getScheduleActivePageIndex(view, 3, 25_000), 2);
  assert.equal(getScheduleActivePageIndex(view, 3, 30_000), 0);
  assert.equal(getScheduleActivePageIndex({ ...view, rotate: false }, 3, 25_000), 0);
  assert.equal(getScheduleActivePageIndex({ ...view, rotate: false }, 3, 25_000, 2), 2);
  assert.equal(getScheduleActivePageIndex(view, 3, 25_000, 99), 2, "índice explícito acotado");
  assert.equal(getScheduleActivePageIndex(view, 1, 25_000), 0);
});

test("topes exactos: 200 filas, 48 columnas y 9600 celdas son válidos; uno más se rechaza sin truncar", () => {
  const assignments = rowsOf(200);
  const full = scheduleOf({ columns: 48 });
  full.cells = assignments.flatMap((row) => full.columns.map((column) => ({ rowId: row.id, columnId: column.id, teacher: "X" })));
  assert.equal(full.cells.length, SCHEDULE_MAX_CELLS);
  assert.equal(validateRoomSchedule(full, assignments).cells.length, 9600);

  assert.throws(() => validateRoomSchedule({ ...full, cells: [...full.cells, full.cells[0]] }, assignments), /9600/);
  assert.throws(() => validateRoomSchedule(scheduleOf({ columns: 49 }), assignments), /48 columnas/);
  assert.throws(() => validateRoomSchedule(scheduleOf(), rowsOf(201)), /200 filas/);
  assert.throws(() => validateRoomSchedule(scheduleOf({
    tags: Array.from({ length: 101 }, (_, index) => ({ id: `t${index}`, name: `T${index}` })),
  }), assignments), /100 etiquetas/);
  assert.throws(() => validateRoomSchedule(scheduleOf({
    views: Array.from({ length: 49 }, (_, index) => ({ id: `v${index}`, name: `V${index}`, columnIds: ["col-1"] })),
  }), assignments), /48 vistas/);
  assert.equal(validateRoomSchedule(scheduleOf({
    views: Array.from({ length: 48 }, (_, index) => ({ id: `v${index}`, name: `V${index}`, columnIds: ["col-1"] })),
  }), assignments).views.length, 48);
  // normalizar sin validar no debe usarse para saltarse los topes: la validación va primero.
  assert.throws(() => validateRoomLayout({ ...layoutWith(scheduleOf({ columns: 49 })) }), /48 columnas/);
});

test("rechaza duplicados y referencias ajenas de fila, columna, etiqueta y vista", () => {
  const assignments = rowsOf(3);
  const base = () => scheduleOf({ tags: [{ id: "t", name: "KIDS" }], cells: [{ rowId: "row-1", columnId: "col-1", teacher: "A" }] });
  const bad = (mutate, pattern) => {
    const schedule = base();
    mutate(schedule);
    assert.throws(() => validateRoomSchedule(schedule, assignments), pattern);
  };
  bad((s) => s.cells.push({ rowId: "row-1", columnId: "col-1", teacher: "B" }), /ya existe otra celda/);
  bad((s) => s.cells.push({ rowId: "row-9", columnId: "col-1", teacher: "B" }), /fila que no existe/);
  bad((s) => s.cells.push({ rowId: "row-2", columnId: "col-9", teacher: "B" }), /columna que no existe/);
  bad((s) => s.cells.push({ rowId: "row-2", columnId: "col-1", teacher: "B", tagIds: ["nope"] }), /etiqueta que no existe/);
  bad((s) => s.cells.push({ rowId: "row-2", columnId: "col-1", teacher: "B", tagIds: ["t", "t"] }), /repite una etiqueta/);
  bad((s) => s.cells.push({ rowId: "row-2", columnId: "col-1", teacher: "B", activity: "C" }), /maestro o actividad/);
  bad((s) => s.columns.push({ ...s.columns[0] }), /identificador repetido/);
  bad((s) => s.tags.push({ id: "t", name: "Otra" }), /identificador repetido/);
  bad((s) => s.views.push({ ...s.views[0] }), /identificador repetido/);
  bad((s) => { s.views[0].columnIds = ["col-1", "col-9"]; }, /columna que no existe/);
  bad((s) => { s.views[0].columnIds = ["col-1", "col-1"]; }, /repite una columna/);
  bad((s) => { s.views[0].columnIds = []; }, /al menos una columna/);
  bad((s) => { s.tags[0].name = ""; }, /obligatorio/);
  bad((s) => { s.version = 2; }, /Versión/);
  bad((s) => { s.cells[0].teacher = "x".repeat(121); }, /máximo 120/);
  assert.throws(() => validateRoomSchedule("no", assignments), /no es válida/);
  assert.throws(() => validateRoomSchedule({ ...base(), columns: {} }, assignments), /lista válida/);
});

test("rechaza horas inválidas y rangos fuera de límite", () => {
  const assignments = rowsOf(1);
  const withColumn = (patch) => {
    const schedule = scheduleOf({ columns: 1 });
    schedule.columns[0] = { ...schedule.columns[0], ...patch };
    return schedule;
  };
  assert.throws(() => validateRoomSchedule(withColumn({ startTime: "25:00" }), assignments), /hora no válida/);
  assert.throws(() => validateRoomSchedule(withColumn({ endTime: "9:5" }), assignments), /hora no válida/);
  assert.throws(() => validateRoomSchedule(withColumn({ startTime: "10:00", endTime: "10:00" }), assignments), /posterior/);
  assert.throws(() => validateRoomSchedule(withColumn({ startTime: "10:00", endTime: "09:00" }), assignments), /posterior/);
  assert.doesNotThrow(() => validateRoomSchedule(withColumn({ startTime: "10:00", endTime: "10:45" }), assignments));

  const withView = (patch) => {
    const schedule = scheduleOf({ columns: 1 });
    schedule.views[0] = { ...schedule.views[0], ...patch };
    return schedule;
  };
  [[{ rowsPerPage: 0 }, /filas por página/], [{ rowsPerPage: 13 }, /filas por página/],
    [{ columnsPerPage: 7 }, /columnas por página/], [{ columnsPerPage: 1.5 }, /columnas por página/],
    [{ pageSeconds: 2 }, /segundos/], [{ pageSeconds: 121 }, /segundos/], [{ rotate: "si" }, /rotación/],
  ].forEach(([patch, pattern]) => assert.throws(() => validateRoomSchedule(withView(patch), assignments), pattern));
  const limits = validateRoomSchedule(withView({ rowsPerPage: 12, columnsPerPage: 6, pageSeconds: 120 }), assignments).views[0];
  assert.deepEqual([limits.rowsPerPage, limits.columnsPerPage, limits.pageSeconds], [12, 6, 120]);
  const defaults = validateRoomSchedule(scheduleOf({ columns: 1 }), assignments).views[0];
  assert.deepEqual([defaults.rowsPerPage, defaults.columnsPerPage, defaults.pageSeconds, defaults.rotate], [8, 3, 10, true]);
});

test("las filas del acomodo deben tener ID estable y único cuando hay matriz", () => {
  const schedule = scheduleOf();
  const dup = [{ id: "a" }, { id: "a" }];
  assert.throws(() => validateRoomSchedule(schedule, dup), /repetido/);
  assert.throws(() => validateRoomSchedule(schedule, [{ id: "a" }, { id: "" }]), /identificador estable/);
  assert.throws(() => validateRoomLayout(layoutWith(schedule, { assignments: [{ id: "a", roomName: "1" }, { id: "a", roomName: "2" }] })), /repetido/);
  // Sin matriz, los acomodos antiguos conservan su comportamiento (IDs repetidos se regeneran).
  const legacy = validateRoomLayout({ ...layoutWith(undefined), assignments: [{ id: "a", roomName: "1" }, { id: "a", roomName: "2" }] });
  assert.notEqual(legacy.assignments[0].id, legacy.assignments[1].id);
});

test("remapScheduleRowIds mantiene la matriz al duplicar filas con IDs nuevos y descarta ajenas", () => {
  const schedule = validateRoomSchedule(scheduleOf({
    cells: [
      { rowId: "row-1", columnId: "col-1", teacher: "A" },
      { rowId: "row-2", columnId: "col-2", teacher: "B" },
    ],
  }), rowsOf(2));
  const copy = remapScheduleRowIds(schedule, { "row-1": "nuevo-1" });
  assert.deepEqual(copy.cells.map((cell) => [cell.rowId, cell.teacher]), [["nuevo-1", "A"]]);
  assert.equal(schedule.cells.length, 2, "el original no se altera");
  assert.equal(remapScheduleRowIds(null, {}), null);
});

test("normalizeRoomLayout aísla celdas a las filas del propio acomodo y conserva el orden", () => {
  const schedule = scheduleOf({ cells: [
    { rowId: "row-3", columnId: "col-2", teacher: "C" },
    { rowId: "row-1", columnId: "col-1", teacher: "A" },
    { rowId: "ajena", columnId: "col-1", teacher: "Z" },
  ] });
  const layout = normalizeRoomLayout(layoutWith(schedule));
  assert.deepEqual(layout.schedule.cells.map((cell) => cell.rowId), ["row-3", "row-1"]);
  assert.throws(() => validateRoomLayout(layoutWith(schedule)), /fila que no existe/, "al guardar se rechaza, no se descarta en silencio");
});

test("compatibilidad: acomodos, reglas y plantillas antiguas no ganan claves nuevas", () => {
  const legacyLayout = normalizeRoomLayout({ name: "A", plantel: "N", assignments: [{ id: "a", roomName: "1" }], displayRules: [{ id: "r", daysOfWeek: [1], startTime: "08:00", endTime: "09:00" }] });
  assert.equal("schedule" in legacyLayout, false);
  assert.equal("selectedViewId" in normalizeRoomLayout({ ...legacyLayout, selectedViewId: "x" }), false, "la vista seleccionada es efímera");
  assert.equal("viewId" in legacyLayout.displayRules[0], false);
  assert.equal("viewId" in normalizeDisplayRule({ id: "r", viewId: "  " }), false);
  assert.equal(normalizeDisplayRule({ id: "r", viewId: " v1 " }).viewId, "v1");
  assert.equal("matrixStyle" in normalizeRoomTemplate(DEFAULT_ROOM_TEMPLATE), false);
  assert.equal(normalizeRoomLayout({ ...legacyLayout, schedule: null }).schedule, undefined);
  assert.equal(validateRoomLayout({ ...legacyLayout, schedule: null }).schedule, undefined);
  assert.equal(normalizeRoomTemplate({ name: "x", elements: [{ type: "assignments" }] }).elements[0].type, "assignments");
});

test("rule.viewId debe existir en la matriz del acomodo (vista seleccionada válida)", () => {
  const schedule = scheduleOf({ columns: 6, views: [
    { id: "a", name: "A", columnIds: ["col-1", "col-2", "col-3"] },
    { id: "b", name: "B", columnIds: ["col-4", "col-5", "col-6"] },
  ] });
  const draftLayout = layoutWith(schedule);
  const withRule = (viewId) => ({ ...draftLayout, displayRules: [{ ...draftLayout.displayRules[0], viewId }] });
  assert.equal(validateRoomLayout(withRule("b")).displayRules[0].viewId, "b");
  assert.equal("viewId" in validateRoomLayout(withRule("")).displayRules[0], false, "vacío = primera vista");
  assert.throws(() => validateRoomLayout(withRule("zzz")), /vista seleccionada no existe/);
  assert.throws(() => validateRoomLayout({ ...withRule("a"), schedule: undefined }), /no usa matriz/);
  // Tantas ventanas con vistas distintas como se quiera; clase y aparición son independientes.
  const two = { ...draftLayout, displayRules: [
    { ...draftLayout.displayRules[0], id: "r1", startTime: "14:50", endTime: "15:15", viewId: "a" },
    { ...draftLayout.displayRules[0], id: "r2", startTime: "17:50", endTime: "18:15", viewId: "b" },
  ] };
  assert.deepEqual(validateRoomLayout(two).displayRules.map((rule) => rule.viewId), ["a", "b"]);
});

test("estilo de matriz: colores, enumeraciones y rangos saneados", () => {
  assert.deepEqual(normalizeMatrixStyle(undefined), DEFAULT_MATRIX_STYLE);
  assert.deepEqual(normalizeMatrixStyle(null), DEFAULT_MATRIX_STYLE);
  const style = normalizeMatrixStyle({
    fontFamily: "Comic Sans", fontSize: 9999, headerColor: "javascript:alert(1)", cellColor: "#abc",
    cellBackground: "rgba(0,0,0,0.5)", roomShape: "hexagon", rowGap: -5, columnGap: "20", borderRadius: "x",
    borderColor: "red", roomWidth: 1, extra: "se elimina",
  });
  assert.deepEqual(style, {
    ...DEFAULT_MATRIX_STYLE, fontSize: 120, cellColor: "#abc", cellBackground: "rgba(0,0,0,0.5)",
    rowGap: 0, columnGap: 20, roomWidth: 40,
  });
  assert.equal(normalizeMatrixStyle({ fontFamily: "serif", roomShape: "pill" }).roomShape, "pill");
  assert.deepEqual(normalizeMatrixStyle(normalizeMatrixStyle(style)), style);
});

test("plantilla integrada Cuadrícula: scheduleGrid dinámico, campos legados y estilo", () => {
  const template = validateRoomTemplate(DEFAULT_SCHEDULE_TEMPLATE);
  assert.equal(template.name, "Acomodo por horarios — Cuadrícula");
  assert.equal(template.version, 1);
  assert.equal(template.columns, 2);
  assert.equal(template.rows, 4);
  assert.deepEqual(template.matrixStyle, DEFAULT_MATRIX_STYLE);
  const grid = template.elements.find((element) => element.type === "scheduleGrid");
  assert.deepEqual([grid.x, grid.y, grid.width, grid.height], [6, 26, 88, 68]);
  assert.equal(template.elements.some((element) => element.type === "assignments"), false);
  assert.ok(template.elements.some((element) => element.type === "image" && element.url), "logotipo institucional");
  assert.equal(grid.text, "", "sin nombres incrustados");
  assert.deepEqual(normalizeRoomTemplate(template), template, "idempotente");

  const builtIn = getBuiltInRoomTemplate(SCHEDULE_GRID_TEMPLATE_ID);
  assert.equal(builtIn.name, template.name);
  assert.equal(getBuiltInRoomTemplate("otra"), null);
  assert.equal(getBuiltInRoomTemplate(""), null);
  // Estilo personalizado saneado dentro de plantillas del usuario.
  const custom = normalizeRoomTemplate({ ...template, matrixStyle: { fontSize: 50, roomShape: "pill" } });
  assert.equal(custom.matrixStyle.fontSize, 50);
  assert.equal(custom.matrixStyle.roomShape, "pill");
});

test("snapshot publicado y manifiesto conservan matriz, vista de la regla y plantilla integrada", () => {
  const schedule = validateRoomSchedule(scheduleOf({
    columns: 6,
    tags: [{ id: "kids", name: "KIDS", backgroundColor: "#d97706" }],
    cells: [
      { rowId: "row-5", columnId: "col-1", teacher: "Johanna", tagIds: ["kids"] },
      { rowId: "row-5", columnId: "col-5", teacher: "Paloma" },
    ],
    views: [
      { id: "a", name: "A", columnIds: ["col-1", "col-2", "col-3"] },
      { id: "b", name: "B", columnIds: ["col-4", "col-5", "col-6"] },
    ],
  }), rowsOf(8));
  const base = layoutWith(schedule);
  const layout = { ...base, templateId: SCHEDULE_GRID_TEMPLATE_ID, displayRules: [{ ...base.displayRules[0], viewId: "b" }] };
  const snapshot = buildPublishedRoomSnapshot(layout, getBuiltInRoomTemplate(SCHEDULE_GRID_TEMPLATE_ID), 5);
  assert.deepEqual(snapshot.schedule, schedule);
  assert.equal(snapshot.displayRules[0].viewId, "b");
  assert.equal(snapshot.template.name, DEFAULT_SCHEDULE_TEMPLATE.name);

  const device = { id: "d1", deviceToken: "d1", plantel: "Norte" };
  const manifest = buildRoomDisplayManifest(device, [snapshot], 9);
  const roundtrip = normalizeRoomManifest(JSON.parse(JSON.stringify(manifest)), device);
  assert.deepEqual(roundtrip.layouts[0].schedule, schedule);
  assert.equal(roundtrip.layouts[0].displayRules[0].viewId, "b");
  assert.deepEqual(roundtrip.layouts[0].template.matrixStyle, DEFAULT_MATRIX_STYLE);
  assert.equal(getSchedulePages(roundtrip.layouts[0], "b")[0].columns[1].id, "col-5");

  // Cambiar el borrador no altera el snapshot ya construido.
  const edited = { ...layout, schedule: { ...schedule, cells: [] } };
  assert.equal(snapshot.schedule.cells.length, 2);
  assert.equal(getRoomLayoutPublicationState({ ...edited, publishedSnapshot: snapshot }, null), "pending");
  assert.equal(getRoomLayoutPublicationState({ ...layout, publishedSnapshot: snapshot }, null), "published");
});

test("no hay publicación parcial: una referencia inválida impide construir el snapshot", () => {
  const schedule = scheduleOf({ cells: [{ rowId: "row-1", columnId: "col-1", teacher: "A" }, { rowId: "row-1", columnId: "col-1", teacher: "B" }] });
  assert.throws(() => buildPublishedRoomSnapshot(layoutWith(schedule), DEFAULT_ROOM_TEMPLATE, 1), /ya existe otra celda/);
});

test("avisos con matriz: maestro duplicado en el mismo horario y sin avisos por fila sin maestro", () => {
  const assignments = rowsOf(3).map((row, index) => ({ ...row, roomName: `Sala ${index + 1}` }));
  const schedule = validateRoomSchedule(scheduleOf({
    columns: 2,
    cells: [
      { rowId: "row-1", columnId: "col-1", teacher: "Rocío" },
      { rowId: "row-2", columnId: "col-1", teacher: "rocio" },
      { rowId: "row-2", columnId: "col-2", teacher: "Rocío" },
    ],
    views: [{ id: "v", name: "V", columnIds: ["col-1"] }],
  }), assignments);
  const warnings = getScheduleWarnings(schedule, assignments);
  assert.ok(warnings.some((text) => /2 salones.*Sala 1, Sala 2/.test(text)));
  assert.ok(warnings.some((text) => /no aparecen en ninguna vista/.test(text)));
  const layoutWarnings = getRoomLayoutWarnings({ ...layoutWith(schedule, { assignments }) });
  assert.equal(layoutWarnings.some((text) => /sin maestro/.test(text)), false);
});

test("publicar matriz con plantilla antigua exige agregar la capa dinámica y conserva la plantilla original", () => {
  const layout = layoutWith(createRoomSchedule(rowsOf(8)));
  assert.throws(() => buildPublishedRoomSnapshot(layout, DEFAULT_ROOM_TEMPLATE), /capa Cuadrícula/);
  const extended = { ...DEFAULT_ROOM_TEMPLATE, elements: [...DEFAULT_ROOM_TEMPLATE.elements, DEFAULT_SCHEDULE_TEMPLATE.elements.find(element => element.type === "scheduleGrid")] };
  const snapshot = buildPublishedRoomSnapshot(layout, extended);
  assert.ok(snapshot.template.elements.some(element => element.type === "scheduleGrid"));
  assert.ok(!DEFAULT_ROOM_TEMPLATE.elements.some(element => element.type === "scheduleGrid"));
});


test("dos ventanas eligen vistas distintas de las mismas asignaciones sin depender del horario de clase", () => {
  const schedule = createRoomSchedule(rowsOf(8));
  const [a,b,c] = schedule.columns;
  schedule.views = [{id:"a",name:"A",columnIds:[a.id,b.id]},{id:"b",name:"B",columnIds:[c.id]}];
  const base = layoutWith(schedule, {timezone:"UTC",classStart:"09:00",classEnd:"10:00"});
  base.displayRules = [{...base.displayRules[0],id:"first",daysOfWeek:[1],startTime:"14:50",endTime:"15:15",viewId:"a"},{...base.displayRules[0],id:"second",daysOfWeek:[1],startTime:"17:50",endTime:"18:15",viewId:"b"}];
  const snapshot = buildPublishedRoomSnapshot(base, DEFAULT_SCHEDULE_TEMPLATE);
  const device = {id:"screen",deviceToken:"screen",plantel:"Norte",active:true};
  const manifest = buildRoomDisplayManifest(device, [snapshot]);
  const first = resolveRoomLayout(manifest,device,Date.parse("2026-11-23T14:50:00Z"));
  const second = resolveRoomLayout(manifest,device,Date.parse("2026-11-23T17:50:00Z"));
  assert.equal(first.rule.viewId,"a");assert.equal(second.rule.viewId,"b");
  assert.deepEqual(getSchedulePages(first.layout,first.rule.viewId)[0].columns.map(col=>col.id),[a.id,b.id]);
  assert.deepEqual(getSchedulePages(second.layout,second.rule.viewId)[0].columns.map(col=>col.id),[c.id]);
  assert.equal(resolveRoomLayout(manifest,device,Date.parse("2026-11-23T18:15:00Z")),null);
});
