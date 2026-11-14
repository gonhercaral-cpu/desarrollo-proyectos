import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ROOM_TEMPLATE,
  ROOM_BLOCK_PRESETS,
  createRoomLayoutDraft,
  formatRoomClassTime,
  getRoomDayLabel,
  getRoomLayoutPublicationState,
  getRoomLayoutWarnings,
  getRoomLocalParts,
  normalizeRoomConfig,
  normalizeRoomLayout,
  normalizeRoomTemplate,
  resolveRoomLayout,
  validateRoomLayout,
  validateRoomTemplate,
} from "../src/utils/digitalSignage/roomLayouts.js";
import {
  buildPublishedRoomSnapshot,
  buildRoomDisplayManifest,
  computeClockOffset,
  getRoomManifestImageUrls,
  normalizeRoomManifest,
} from "../src/utils/digitalSignage/roomPublication.js";

const TZ = "America/Tijuana";

// Instante UTC cuya hora local en `tz` es date+time (resuelve DST probando offsets).
function zoned(date, time, tz = TZ, seconds = 0) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  for (let offset = -14; offset <= 14; offset += 1) {
    const guess = Date.UTC(y, mo - 1, d, h - offset, mi, seconds);
    const parts = getRoomLocalParts(guess, tz);
    if (parts.dateKey === date && parts.minutes === h * 60 + mi) return guess;
  }
  throw new Error(`Hora local inexistente ${date} ${time}`);
}

function rule(overrides = {}) {
  return {
    id: "r1", daysOfWeek: [1, 2, 3, 4, 5], dates: [], startTime: "08:50", endTime: "09:15",
    deviceIds: [], active: true, priority: 0, ...overrides,
  };
}

function layout(overrides = {}) {
  return {
    id: "L1", name: "Bloque 9", plantel: "Norte", timezone: TZ, classDays: [1, 2, 3, 4, 5],
    classStart: "09:00", classEnd: "10:00", templateId: "", active: true,
    assignments: [{ id: "a1", roomName: "1", teacher: "Abel", group: "A1", active: true }],
    displayRules: [rule()], ...overrides,
  };
}

function snapshot(overrides = {}) {
  return { ...layout(overrides), template: normalizeRoomTemplate(DEFAULT_ROOM_TEMPLATE), publishedAtMillis: 1000 };
}

const device = { id: "tok1", deviceToken: "tok1", plantel: "Norte", active: true };

function manifestFor(dev, snapshots) {
  return buildRoomDisplayManifest(dev, snapshots, 5);
}

// 2026-03-09 es lunes (PDT); 2026-03-02 lunes (PST).
const MON = "2026-03-09";

test("Escenario A: sin acomodo publicado no se resuelve nada", () => {
  assert.equal(resolveRoomLayout(null, device, zoned(MON, "08:55")), null);
  assert.equal(resolveRoomLayout(manifestFor(device, []), device, zoned(MON, "08:55")), null);
});

test("Escenarios B/C/D: 08:50–09:15 inicio inclusivo, fin exclusivo y sin parpadeo", () => {
  const manifest = manifestFor(device, [snapshot()]);
  assert.equal(resolveRoomLayout(manifest, device, zoned(MON, "08:49", TZ, 59)), null);
  assert.equal(resolveRoomLayout(manifest, device, zoned(MON, "08:50"))?.layout.id, "L1");
  // Se mantiene continuamente durante toda la ventana (muestreo cada minuto).
  for (let minute = 50; minute < 75; minute += 1) {
    const time = `${String(8 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    assert.ok(resolveRoomLayout(manifest, device, zoned(MON, time)), `visible a las ${time}`);
  }
  assert.ok(resolveRoomLayout(manifest, device, zoned(MON, "09:14", TZ, 59)));
  assert.equal(resolveRoomLayout(manifest, device, zoned(MON, "09:15")), null);
  // Sábado no está en daysOfWeek.
  assert.equal(resolveRoomLayout(manifest, device, zoned("2026-03-14", "08:55")), null);
});

test("El bloque de clase (09:00) no se confunde con la ventana de aparición (08:50)", () => {
  const manifest = manifestFor(device, [snapshot()]);
  const match = resolveRoomLayout(manifest, device, zoned(MON, "08:50"));
  assert.equal(match.layout.classStart, "09:00");
  assert.equal(match.rule.startTime, "08:50");
});

test("Escenario E: cada sucursal solo recibe y muestra su acomodo", () => {
  const south = { id: "tok2", deviceToken: "tok2", plantel: "Sur", active: true };
  const norte = snapshot({ id: "N", plantel: "Norte" });
  const sur = snapshot({ id: "S", plantel: "Sur" });
  const all = [norte, sur];
  const manifestNorth = manifestFor(device, all);
  const manifestSouth = manifestFor(south, all);
  assert.deepEqual(manifestNorth.layouts.map((item) => item.id), ["N"]);
  assert.deepEqual(manifestSouth.layouts.map((item) => item.id), ["S"]);
  const now = zoned(MON, "09:00");
  assert.equal(resolveRoomLayout(manifestNorth, device, now).layout.id, "N");
  assert.equal(resolveRoomLayout(manifestSouth, south, now).layout.id, "S");
  // Manifiesto ajeno o plantel cambiado: nunca se muestra.
  assert.equal(resolveRoomLayout(manifestNorth, south, now), null);
  assert.equal(resolveRoomLayout(manifestNorth, { ...device, plantel: "Sur" }, now), null);
  assert.equal(resolveRoomLayout(manifestNorth, { ...device, deviceToken: "otro", id: "otro" }, now), null);
});

test("Escenario F: republicar sustituye el contenido sin duplicar acomodos", () => {
  const first = snapshot({ assignments: [{ id: "a1", roomName: "1", teacher: "Abel", group: "", active: true }] });
  const second = {
    ...snapshot({ assignments: [{ id: "a1", roomName: "1", teacher: "Frida", group: "", active: true }] }),
    publishedAtMillis: 2000,
  };
  const manifest = manifestFor(device, [first, second, second]);
  assert.equal(manifest.layouts.length, 1);
  assert.equal(manifest.layouts[0].assignments[0].teacher, "Frida");
});

test("Escenario G: el manifiesto sobrevive a serializar/leer (caché offline) y sigue resolviendo", () => {
  const manifest = manifestFor(device, [snapshot()]);
  const restored = normalizeRoomManifest(JSON.parse(JSON.stringify(manifest)), { deviceToken: "tok1" });
  assert.ok(resolveRoomLayout(restored, device, zoned(MON, "09:00")));
  assert.equal(normalizeRoomManifest(JSON.parse(JSON.stringify(manifest)), { deviceToken: "otro" }), null);
  assert.equal(normalizeRoomManifest({ ...manifest, version: 2 }), null);
  assert.equal(normalizeRoomManifest({ ...manifest, layouts: "x" }), null);
});

test("Escenario H: traslapes resueltos por prioridad desc, luego ID asc; determinista", () => {
  const a = snapshot({ id: "B", displayRules: [rule({ id: "r", priority: 0 })] });
  const b = snapshot({ id: "A", displayRules: [rule({ id: "r", priority: 0 })] });
  const c = snapshot({ id: "Z", displayRules: [rule({ id: "r", priority: 5 })] });
  const now = zoned(MON, "09:00");
  assert.equal(resolveRoomLayout(manifestFor(device, [a, b]), device, now).layout.id, "A");
  assert.equal(resolveRoomLayout(manifestFor(device, [b, a]), device, now).layout.id, "A");
  assert.equal(resolveRoomLayout(manifestFor(device, [a, b, c]), device, now).layout.id, "Z");
  // Sin alternancia: mismo resultado durante toda la ventana.
  const manifest = manifestFor(device, [a, b, c]);
  for (let minute = 50; minute < 75; minute += 3) {
    const time = `${String(8 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    assert.equal(resolveRoomLayout(manifest, device, zoned(MON, time)).layout.id, "Z");
  }
});

test("Ventanas que cruzan medianoche", () => {
  const night = snapshot({ displayRules: [rule({ daysOfWeek: [5], startTime: "23:30", endTime: "00:30" })] });
  const manifest = manifestFor(device, [night]);
  assert.equal(resolveRoomLayout(manifest, device, zoned("2026-03-13", "23:29")), null);
  assert.ok(resolveRoomLayout(manifest, device, zoned("2026-03-13", "23:30")));
  assert.ok(resolveRoomLayout(manifest, device, zoned("2026-03-14", "00:29", TZ, 59)));
  assert.equal(resolveRoomLayout(manifest, device, zoned("2026-03-14", "00:30")), null);
  // La madrugada del viernes no pertenece a la ventana que empieza el jueves.
  assert.equal(resolveRoomLayout(manifest, device, zoned("2026-03-13", "00:10")), null);

  const dated = snapshot({ displayRules: [rule({ dates: ["2026-03-13"], daysOfWeek: [], startTime: "23:30", endTime: "00:30" })] });
  const datedManifest = manifestFor(device, [dated]);
  assert.ok(resolveRoomLayout(datedManifest, device, zoned("2026-03-14", "00:10")));
  assert.equal(resolveRoomLayout(datedManifest, device, zoned("2026-03-15", "00:10")), null);
});

test("Fechas específicas reemplazan la recurrencia", () => {
  const dated = snapshot({ displayRules: [rule({ dates: ["2026-03-14"], daysOfWeek: [1] })] });
  const manifest = manifestFor(device, [dated]);
  assert.ok(resolveRoomLayout(manifest, device, zoned("2026-03-14", "09:00")));
  assert.equal(resolveRoomLayout(manifest, device, zoned(MON, "09:00")), null);
});

test("Horario de verano: 08:50 local es válido antes y después del cambio", () => {
  const manifest = manifestFor(device, [snapshot()]);
  const winter = zoned("2026-03-02", "08:50");
  const summer = zoned(MON, "08:50");
  assert.equal(new Date(winter).getUTCHours(), 16); // PST
  assert.equal(new Date(summer).getUTCHours(), 15); // PDT
  assert.ok(resolveRoomLayout(manifest, device, winter));
  assert.ok(resolveRoomLayout(manifest, device, summer));
});

test("DST primavera/otoño con fechas específicas", () => {
  const spring = snapshot({ displayRules: [rule({ dates: ["2026-03-08"], daysOfWeek: [], startTime: "02:00", endTime: "03:30" })] });
  const springManifest = manifestFor(device, [spring]);
  assert.equal(resolveRoomLayout(springManifest, device, Date.UTC(2026, 2, 8, 9, 59)), null); // 01:59 PST
  assert.ok(resolveRoomLayout(springManifest, device, Date.UTC(2026, 2, 8, 10, 0))); // 03:00 PDT
  assert.ok(resolveRoomLayout(springManifest, device, Date.UTC(2026, 2, 8, 10, 29))); // 03:29 PDT
  assert.equal(resolveRoomLayout(springManifest, device, Date.UTC(2026, 2, 8, 10, 30)), null); // 03:30

  const fall = snapshot({ displayRules: [rule({ dates: ["2026-11-01"], daysOfWeek: [], startTime: "01:00", endTime: "02:00" })] });
  const fallManifest = manifestFor(device, [fall]);
  assert.ok(resolveRoomLayout(fallManifest, device, Date.UTC(2026, 10, 1, 8, 30))); // 01:30 PDT
  assert.ok(resolveRoomLayout(fallManifest, device, Date.UTC(2026, 10, 1, 9, 30))); // 01:30 PST (repetida)
  assert.equal(resolveRoomLayout(fallManifest, device, Date.UTC(2026, 10, 1, 10, 0)), null); // 02:00 PST
});

test("Otras zonas horarias usan su propio día local", () => {
  const auckland = snapshot({ timezone: "Pacific/Auckland", displayRules: [rule({ daysOfWeek: [1], startTime: "08:00", endTime: "09:00" })] });
  const manifest = manifestFor(device, [auckland]);
  // Lunes 08:30 en Auckland = domingo en Tijuana.
  const instant = zoned(MON, "08:30", "Pacific/Auckland");
  assert.ok(resolveRoomLayout(manifest, device, instant));
  assert.equal(getRoomLocalParts(instant, TZ).dayOfWeek, 0);
});

test("Destinos: deviceIds explícitos restringen; [] = todo el plantel; inactivos y borradores se ignoran", () => {
  const other = { id: "tok9", deviceToken: "tok9", plantel: "Norte", active: true };
  const targeted = snapshot({ id: "T", displayRules: [rule({ deviceIds: ["tok9"] })] });
  const now = zoned(MON, "09:00");
  assert.equal(manifestFor(device, [targeted]).layouts.length, 0);
  assert.equal(manifestFor(other, [targeted]).layouts.length, 1);
  const inactiveRule = snapshot({ id: "I", displayRules: [rule({ active: false })] });
  const inactiveLayout = snapshot({ id: "J", active: false });
  assert.equal(manifestFor(device, [inactiveRule, inactiveLayout]).layouts.length, 0);
  // Un manifiesto manipulado con regla de otro destino tampoco resuelve.
  const forged = { ...manifestFor(other, [targeted]), deviceToken: "tok1" };
  assert.equal(resolveRoomLayout(forged, device, now), null);
  assert.equal(resolveRoomLayout(manifestFor(device, [snapshot()]), { ...device, active: false }, now), null);
});

test("Publicación: destinos retirados, dispositivos nuevos y reubicados", () => {
  const base = snapshot({ displayRules: [rule({ deviceIds: ["tok1"] })] });
  assert.equal(manifestFor(device, [base]).layouts.length, 1);
  // Se retira el destino: el manifiesto recompuesto ya no lo contiene.
  const retired = snapshot({ displayRules: [rule({ deviceIds: ["tok9"] })] });
  assert.equal(manifestFor(device, [retired]).layouts.length, 0);
  // Dispositivo nuevo del plantel recibe reglas con deviceIds [].
  const all = snapshot({ id: "ALL" });
  const fresh = { id: "tok7", deviceToken: "tok7", plantel: "Norte", active: true };
  assert.deepEqual(manifestFor(fresh, [all, base]).layouts.map((item) => item.id), ["ALL"]);
  // Reubicado a otro plantel: no conserva lo anterior.
  const moved = { ...fresh, plantel: "Sur" };
  assert.equal(manifestFor(moved, [all]).layouts.length, 0);
  assert.equal(manifestFor(moved, [all]).plantel, "Sur");
});

test("Manifiesto: límite de tamaño y URLs a precargar", () => {
  const huge = snapshot({
    assignments: Array.from({ length: 300 }, (_, index) => ({
      id: `a${index}`, roomName: `Salón ${index}`, teacher: "M".repeat(120), group: "G".repeat(80), active: true,
    })),
  });
  const many = Array.from({ length: 40 }, (_, index) => ({ ...huge, id: `L${index}` }));
  assert.throws(() => manifestFor(device, many), /tamaño/);

  const withImages = snapshot();
  withImages.template = normalizeRoomTemplate({
    ...DEFAULT_ROOM_TEMPLATE,
    backgroundUrl: "https://example.com/bg.png",
  });
  const urls = getRoomManifestImageUrls(manifestFor(device, [withImages]));
  assert.deepEqual(urls.sort(), ["/active-logo.png", "https://example.com/bg.png"]);
});

test("Normalización y validación de acomodos", () => {
  const draft = createRoomLayoutDraft({ plantel: "Norte", rooms: [{ name: "Salón 1", active: true }, { name: "Salón 2", active: false }, { name: "Salón 3" }] });
  assert.equal(draft.assignments.length, 2);
  assert.equal(new Set(draft.assignments.map((row) => row.id)).size, 2);
  assert.equal(draft.displayRules.length, 1);
  assert.equal(draft.displayRules[0].startTime, "08:50");
  assert.equal(draft.displayRules[0].endTime, "09:15");
  assert.equal(validateRoomLayout(draft).plantel, "Norte");

  assert.throws(() => validateRoomLayout({ ...draft, timezone: "Mars/Base" }), /Zona horaria/);
  assert.throws(() => validateRoomLayout({ ...draft, plantel: "" }), /plantel/);
  assert.throws(() => validateRoomLayout({ ...draft, classDays: [] }), /día/);
  assert.throws(() => validateRoomLayout({ ...draft, classEnd: draft.classStart }), /distintos/);
  assert.throws(() => validateRoomLayout({ ...draft, displayRules: [{ ...draft.displayRules[0], endTime: draft.displayRules[0].startTime }] }), /iguales/);
  assert.throws(() => validateRoomLayout({ ...draft, displayRules: [{ ...draft.displayRules[0], daysOfWeek: [], dates: [] }] }), /días de la semana o fechas/);
  assert.throws(() => validateRoomLayout({ ...draft, displayRules: [{ ...draft.displayRules[0], dates: ["2026-02-31"] }] }), /fechas/);

  // IDs duplicados o ausentes se regeneran; filas sin maestro son válidas en borrador.
  const normalized = normalizeRoomLayout({
    ...draft,
    assignments: [{ id: "x", roomName: "1" }, { id: "x", roomName: "2" }, { roomName: "3" }],
  });
  assert.equal(new Set(normalized.assignments.map((row) => row.id)).size, 3);
  assert.ok(validateRoomLayout(normalized));

  // Más de 8 filas (100+) y tope razonable.
  const big = Array.from({ length: 120 }, (_, index) => ({ roomName: `S${index}`, teacher: `T${index}` }));
  assert.equal(validateRoomLayout({ ...draft, assignments: big }).assignments.length, 120);
  assert.throws(() => validateRoomLayout({ ...draft, assignments: Array.from({ length: 301 }, () => ({})) }), /máximo/);
});

test("Plantillas: normalización, validación y URLs seguras", () => {
  const template = validateRoomTemplate({
    name: "Mi plantilla", columns: 99, rows: 0, backgroundUrl: "javascript:alert(1)",
    elements: [
      { id: "i", type: "image", url: "http://evil.test/x.png" },
      { id: "i", type: "bogus", x: 500, fontSize: 9999, color: "red", align: "justify" },
      { id: "ok", type: "image", url: "https://firebasestorage.googleapis.com/x.png" },
    ],
  });
  assert.equal(template.columns, 12);
  assert.equal(template.rows, 1);
  assert.equal(template.backgroundUrl, "");
  assert.equal(template.elements[0].url, "");
  assert.equal(new Set(template.elements.map((item) => item.id)).size, 3);
  assert.equal(template.elements[1].type, "text");
  assert.equal(template.elements[1].x, 100);
  assert.equal(template.elements[1].fontSize, 240);
  assert.equal(template.elements[1].color, "#ffffff");
  assert.equal(template.elements[1].align, "left");
  assert.equal(template.elements[2].url.startsWith("https://"), true);
  assert.throws(() => validateRoomTemplate({ name: "" }), /nombre/);
  assert.ok(normalizeRoomTemplate(DEFAULT_ROOM_TEMPLATE).elements.some((item) => item.type === "assignments"));
  assert.equal(DEFAULT_ROOM_TEMPLATE.backgroundColor, "#0b3265");
});

test("Límites del modelo alineados con las reglas (200 filas/salones/elementos, 100 ventanas)", () => {
  const base = createRoomLayoutDraft({ plantel: "Norte" });
  const rows = (count) => Array.from({ length: count }, (_, index) => ({ id: `a${index}`, roomName: `S${index}`, teacher: "", group: "", active: true }));
  assert.equal(validateRoomLayout({ ...base, assignments: rows(200) }).assignments.length, 200);
  assert.throws(() => validateRoomLayout({ ...base, assignments: rows(201) }), /200 filas/);

  const rule = base.displayRules[0];
  const rules = (count) => Array.from({ length: count }, (_, index) => ({ ...rule, id: `r${index}` }));
  assert.equal(validateRoomLayout({ ...base, displayRules: rules(100) }).displayRules.length, 100);
  assert.throws(() => validateRoomLayout({ ...base, displayRules: rules(101) }), /100 ventanas/);

  const elements = (count) => Array.from({ length: count }, (_, index) => ({ id: `e${index}`, type: "rect" }));
  assert.equal(validateRoomTemplate({ ...DEFAULT_ROOM_TEMPLATE, elements: elements(200) }).elements.length, 200);
  assert.throws(() => validateRoomTemplate({ ...DEFAULT_ROOM_TEMPLATE, elements: elements(201) }), /200 elementos/);

  const grid = validateRoomTemplate({ ...DEFAULT_ROOM_TEMPLATE, columns: 50, rows: 500 });
  assert.equal(grid.columns, 12);
  assert.equal(grid.rows, 100);
  assert.equal(normalizeRoomConfig({ plantel: "N", rooms: rows(250).map((row) => ({ name: row.roomName })) }).rooms.length, 200);
});

test("Config de plantel: nombres editables, sin límite de 8, copia sin vínculos", () => {
  const config = normalizeRoomConfig({
    plantel: "Norte",
    rooms: Array.from({ length: 12 }, (_, index) => ({ name: `Aula ${index + 1}`, active: index % 2 === 0 })),
    teacherNames: ["Abel", "abel", " Frida ", ""],
  });
  assert.equal(config.rooms.length, 12);
  assert.deepEqual(config.teacherNames, ["Abel", "Frida"]);
  const copy = normalizeRoomConfig({ ...config, plantel: "Sur", rooms: config.rooms.map(({ name, active }) => ({ name, active })) });
  assert.equal(copy.rooms.some((room) => config.rooms.some((original) => original.id === room.id)), false);
  assert.equal(config.plantel, "Norte");
});

test("Etiquetas y presets", () => {
  assert.equal(formatRoomClassTime({ classStart: "09:00", classEnd: "10:00" }), "09:00 – 10:00");
  assert.equal(getRoomDayLabel([1, 2, 3, 4, 5]), "Lunes a viernes");
  assert.equal(getRoomDayLabel([6]), "Sábado");
  assert.equal(getRoomDayLabel([0]), "Domingo");
  assert.equal(getRoomDayLabel([1, 3]), "Lun, Mié");
  const labels = ROOM_BLOCK_PRESETS.map((preset) => `${preset.daysOfWeek.join("")}${preset.startTime}-${preset.endTime}`);
  assert.ok(labels.includes("1234508:00-09:00"));
  assert.ok(labels.includes("1234520:00-21:00"));
  assert.ok(labels.includes("608:00-13:00"));
  assert.ok(labels.includes("613:30-17:30"));
  assert.ok(labels.includes("009:00-13:00"));
});

test("Advertencias: maestro duplicado/simultáneo, traslapes con destinos compatibles", () => {
  const current = layout({
    assignments: [
      { id: "a", roomName: "1", teacher: "Abel", group: "", active: true },
      { id: "b", roomName: "2", teacher: "abel", group: "", active: true },
      { id: "c", roomName: "3", teacher: "", group: "", active: true },
    ],
  });
  const warnings = getRoomLayoutWarnings(current);
  assert.ok(warnings.some((text) => /sin maestro/.test(text)));
  assert.ok(warnings.some((text) => /Abel.*2 salones/.test(text)));

  const simultaneous = layout({ id: "L2", name: "Otro", classStart: "09:30", classEnd: "10:30", assignments: [{ id: "z", roomName: "9", teacher: "ABEL", group: "", active: true }], displayRules: [rule({ id: "x", startTime: "08:00", endTime: "08:30" })] });
  assert.ok(getRoomLayoutWarnings(current, [current, simultaneous]).some((text) => /también está/.test(text)));
  const sequential = { ...simultaneous, classStart: "10:00", classEnd: "11:00" };
  assert.equal(getRoomLayoutWarnings(current, [sequential]).some((text) => /también está/.test(text)), false);

  const overlapping = layout({ id: "L3", name: "Solapado", displayRules: [rule({ id: "y", startTime: "09:00", endTime: "09:30" })] });
  assert.ok(getRoomLayoutWarnings(current, [overlapping]).some((text) => /se superpone/.test(text)));
  const disjointDevices = layout({ id: "L4", displayRules: [rule({ id: "y", deviceIds: ["tok9"] })] });
  const explicitCurrent = { ...current, displayRules: [rule({ deviceIds: ["tok1"] })] };
  assert.equal(getRoomLayoutWarnings(explicitCurrent, [disjointDevices]).some((text) => /se superpone/.test(text)), false);
  const adjacent = layout({ id: "L5", displayRules: [rule({ id: "y", startTime: "09:15", endTime: "09:40" })] });
  assert.equal(getRoomLayoutWarnings(current, [adjacent]).some((text) => /se superpone/.test(text)), false);
  const otherPlantel = layout({ id: "L6", plantel: "Sur" });
  assert.equal(getRoomLayoutWarnings(current, [otherPlantel]).some((text) => /se superpone|también/.test(text)), false);
});

test("Estado de publicación: borrador no modifica lo publicado", () => {
  const saved = layout();
  const snap = buildPublishedRoomSnapshot(saved, { ...DEFAULT_ROOM_TEMPLATE, name: "T" }, 10);
  assert.equal(getRoomLayoutPublicationState({ ...saved }), "unpublished");
  assert.equal(getRoomLayoutPublicationState({ ...saved, publishedSnapshot: snap }), "published");
  const edited = { ...saved, assignments: [{ ...saved.assignments[0], teacher: "Nuevo" }], publishedSnapshot: snap };
  assert.equal(getRoomLayoutPublicationState(edited), "pending");
  assert.equal(snap.assignments[0].teacher, "Abel");
  assert.throws(() => buildPublishedRoomSnapshot({ ...saved, id: "" }, DEFAULT_ROOM_TEMPLATE), /Guarda/);
});

test("Reloj corregido: offset desde Date/Age de HEAD y descarte de RTT alto", () => {
  const offset = computeClockOffset({
    dateHeader: "Mon, 09 Mar 2026 16:00:00 GMT",
    ageHeader: "10",
    localStartMillis: Date.UTC(2026, 2, 9, 15, 59, 0, 0),
    localEndMillis: Date.UTC(2026, 2, 9, 15, 59, 0, 200),
  });
  // Servidor ≈ 16:00:10.5; local medio ≈ 15:59:00.1 → ≈ +70.4 s.
  assert.ok(Math.abs(offset - 70400) < 50);
  assert.equal(computeClockOffset({ dateHeader: "nope", localStartMillis: 0, localEndMillis: 1 }), null);
  assert.equal(computeClockOffset({ dateHeader: "Mon, 09 Mar 2026 16:00:00 GMT", localStartMillis: 0, localEndMillis: 9000 }), null);
});

test("URLs: http solo en loopback; remoto, javascript y data se rechazan", async () => {
  const { cleanRoomUrl } = await import("../src/utils/digitalSignage/roomLayouts.js");
  for (const ok of ["http://127.0.0.1:9199/v0/b/x/o/a.png?alt=media", "http://localhost:9199/a.png", "http://[::1]:9199/a.png", "https://x.test/a.png", "/active-logo.png"]) {
    assert.equal(cleanRoomUrl(ok), ok);
  }
  for (const bad of ["http://example.com/a.png", "http://127.0.0.1.evil.com/a.png", "javascript:alert(1)", "data:image/png;base64,AAA", "//evil.com/a.png", "ftp://localhost/a.png"]) {
    assert.equal(cleanRoomUrl(bad), "");
  }
});

test("Maestro simultáneo: bloque que cruza medianoche conflicta (Lun 23-01 vs Mar 00-02); sin solape no avisa", async () => {
  const { getRoomLayoutWarnings } = await import("../src/utils/digitalSignage/roomLayouts.js");
  const make = (id, classDays, classStart, classEnd) => ({
    ...createRoomLayoutDraft({ plantel: "Norte", classDays, classStart, classEnd }),
    id,
    assignments: [{ id: "a", roomName: "1", teacher: "Abel", group: "", active: true }],
  });
  const hit = (layout, other) => getRoomLayoutWarnings(layout, [other]).some((warning) => /Abel/.test(warning));
  const night = make("n", [1], "23:00", "01:00");
  assert.equal(hit(make("m", [2], "00:00", "02:00"), night), true);
  assert.equal(hit(make("m", [2], "01:00", "02:00"), night), false, "fin exclusivo");
  assert.equal(hit(make("m", [3], "00:00", "02:00"), night), false);
  assert.equal(hit(make("m", [1], "00:00", "02:00"), make("s", [0], "23:00", "01:00")), true);
  assert.equal(hit(make("m", [0], "00:00", "02:00"), make("s", [6], "23:00", "01:00")), true);
});
