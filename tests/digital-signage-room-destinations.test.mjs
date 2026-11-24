import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  createRoomLayoutDraft,
  getRoomLayoutDestinations,
  getRoomLayoutPlanteles,
  getRoomLayoutPublicationState,
  normalizeRoomDestinations,
  normalizeRoomLayout,
  roomLayoutTargetsDevice,
  validateRoomLayout,
} from "../src/utils/digitalSignage/roomLayouts.js";
import {
  buildPublishedRoomSnapshot,
  buildRoomDisplayManifest,
  normalizeRoomManifest,
} from "../src/utils/digitalSignage/roomPublication.js";

// Modelo puro de destinos + paridad cliente/backend de la proyección por pantalla.
// Las pruebas con Firestore simulado viven en digital-signage-room-services.test.mjs.
const { projectRoomLayout } = createRequire(import.meta.url)("../functions/digitalSignage.js");

const base = (overrides = {}) => ({
  ...createRoomLayoutDraft({ plantel: "", destinations: [], rooms: [{ name: "1" }] }),
  name: "Global",
  ...overrides,
});
const dest = (plantel, deviceIds = []) => ({ plantel, deviceIds });
const device = (id, plantel, extra = {}) => ({ id, deviceToken: id, plantel, active: true, ...extra });

test("Sin destinations el acomodo conserva exactamente la semántica y el esquema antiguos", () => {
  const legacy = normalizeRoomLayout({ name: "A", plantel: "Norte" });
  assert.equal("destinations" in legacy, false);
  assert.deepEqual(getRoomLayoutDestinations(legacy), [dest("Norte")]);
  assert.deepEqual(getRoomLayoutPlanteles(legacy), ["Norte"]);
  assert.equal(roomLayoutTargetsDevice(legacy, device("d1", "Norte")), true);
  assert.equal(roomLayoutTargetsDevice(legacy, device("d1", "Sur")), false);
  assert.throws(() => validateRoomLayout({ name: "A", plantel: "" }), /plantel/);
  assert.equal(validateRoomLayout({ name: "A", plantel: "Norte" }).plantel, "Norte");
});

test("destinations (incluso []) vuelve independiente: plantel vacío válido y sin receptores", () => {
  const empty = validateRoomLayout(base());
  assert.deepEqual(empty.destinations, []);
  assert.equal(empty.plantel, "");
  assert.deepEqual(getRoomLayoutDestinations(empty), []);
  assert.deepEqual(getRoomLayoutPlanteles(empty), []);
  assert.equal(roomLayoutTargetsDevice(empty, device("d1", "Norte")), false);
  assert.equal(roomLayoutTargetsDevice(empty, device("d1", "")), false);
});

test("Destinos: planteles repetidos, inválidos, duplicados y topes fallan antes de normalizar", () => {
  const bad = (destinations, pattern) =>
    assert.throws(() => validateRoomLayout(base({ destinations })), pattern);
  bad([dest("Norte"), dest(" Norte ")], /repetido/);
  bad([dest("")], /plantel válido/);
  bad([{ plantel: 3 }], /plantel válido/);
  bad([dest("Norte", ["a", "a"])], /repetidas/);
  bad([dest("Norte", ["a", " "])], /no válida/);
  bad([dest("Norte", [7])], /no válida/);
  bad([{ plantel: "Norte", deviceIds: "a" }], /lista de pantallas/);
  bad("Norte", /no son válidos/);
  bad(Array.from({ length: 21 }, (_, index) => dest(`P${index}`)), /máximo 20/);
  bad([dest("Norte", Array.from({ length: 391 }, (_, index) => `d${index}`))], /máximo 390/);
  bad([
    dest("A", Array.from({ length: 200 }, (_, index) => `a${index}`)),
    dest("B", Array.from({ length: 191 }, (_, index) => `b${index}`)),
  ], /suman más de 390/);
  const ok = validateRoomLayout(base({
    destinations: Array.from({ length: 20 }, (_, index) => dest(`P${index}`, index === 0 ? Array.from({ length: 390 }, (_, n) => `d${n}`) : [])),
  }));
  assert.equal(ok.destinations.length, 20);
});

test("La normalización nunca ensancha: lista explícita vacía tras filtrar descarta el destino", () => {
  assert.deepEqual(normalizeRoomDestinations([dest("Norte", ["  ", ""]), dest("Sur", [" s1 ", "s1"])]), [dest("Sur", ["s1"])]);
  const layout = { destinations: [{ plantel: "Norte", deviceIds: [" "] }] };
  assert.equal(roomLayoutTargetsDevice(layout, device("d1", "Norte")), false, "sin 'todas' implícito");
  assert.equal(roomLayoutTargetsDevice({ destinations: [dest("Norte")] }, device("d1", "Norte")), true, "[] explícito = todas del plantel");
  assert.equal(roomLayoutTargetsDevice({ destinations: [dest("Norte", ["d2"])] }, device("d1", "Norte", { deviceToken: "d2" })), true, "también por token");
  assert.equal(roomLayoutTargetsDevice({ destinations: [dest("Norte", ["d1"])] }, device("d1", "Sur")), false, "ID de otro plantel no basta");
});

test("Ventanas con pantallas explícitas fuera de los destinos se rechazan cuando es determinable", () => {
  const rule = (deviceIds, extra = {}) => ({ ...base().displayRules[0], deviceIds, ...extra });
  assert.throws(
    () => validateRoomLayout(base({ destinations: [dest("Norte", ["d1"])], displayRules: [rule(["d1", "d9"])] })),
    /Ventana 1: apunta a una pantalla fuera/
  );
  assert.equal(validateRoomLayout(base({ destinations: [dest("Norte", ["d1"])], displayRules: [rule(["d1"])] })).displayRules[0].deviceIds[0], "d1");
  // Con un destino "todas" depende de pantallas vivas (lo comprueba el servicio); ventana inactiva no bloquea.
  assert.ok(validateRoomLayout(base({ destinations: [dest("Norte")], displayRules: [rule(["x"])] })));
  assert.ok(validateRoomLayout(base({ destinations: [dest("Norte", ["d1"])], displayRules: [rule(["zz"], { active: false })] })));
});

test("Publicar un acomodo independiente sin destinos se rechaza; el snapshot conserva los destinos", () => {
  const draft = { ...base({ destinations: [] }), id: "L1" };
  assert.throws(() => buildPublishedRoomSnapshot(draft, { name: "T" }, 1), /al menos un destino/);
  const snapshot = buildPublishedRoomSnapshot({ ...draft, destinations: [dest("Norte"), dest("Sur", ["s1"])] }, { name: "T" }, 1);
  assert.deepEqual(snapshot.destinations, [dest("Norte"), dest("Sur", ["s1"])]);
  // La comparación borrador/publicado incluye destinos.
  const raw = { ...draft, destinations: [dest("Norte"), dest("Sur", ["s1"])], publishedSnapshot: snapshot };
  assert.equal(getRoomLayoutPublicationState(raw, null), "published");
  assert.equal(getRoomLayoutPublicationState({ ...raw, destinations: [dest("Norte")] }, null), "pending");
});

function published(overrides = {}) {
  return buildPublishedRoomSnapshot(
    { ...base({ destinations: [dest("Norte"), dest("Sur", ["s1"])] }), id: "L1", ...overrides },
    { name: "T" },
    5
  );
}

test("Proyección: plantel de la pantalla, sin destinos ni IDs de otras pantallas, sin fuga entre planteles", () => {
  const rule = { ...base().displayRules[0], deviceIds: ["n1", "s1", "x9"] };
  const snapshot = published({ displayRules: [rule], destinations: [dest("Norte"), dest("Sur", ["s1"])] });
  const north = buildRoomDisplayManifest(device("n1", "Norte"), [snapshot], 9);
  assert.equal(north.layouts.length, 1);
  assert.equal(north.layouts[0].plantel, "Norte");
  assert.equal("destinations" in north.layouts[0], false);
  assert.deepEqual(north.layouts[0].displayRules[0].deviceIds, ["n1"]);
  assert.equal(JSON.stringify(north).includes("s1"), false);

  const south = buildRoomDisplayManifest(device("s1", "Sur"), [snapshot], 9);
  assert.equal(south.layouts[0].plantel, "Sur");
  assert.deepEqual(south.layouts[0].displayRules[0].deviceIds, ["s1"]);
  assert.equal(JSON.stringify(south).includes("Norte"), false);

  assert.equal(buildRoomDisplayManifest(device("s2", "Sur"), [snapshot], 9).layouts.length, 0, "pantalla de Sur no listada");
  assert.equal(buildRoomDisplayManifest(device("n2", "Norte"), [snapshot], 9).layouts.length, 0, "la ventana no la apunta");
  assert.equal(buildRoomDisplayManifest(device("o1", "Otro"), [snapshot], 9).layouts.length, 0, "plantel sin destino");
  // El manifiesto emitido sigue siendo legible por el player (resolver por plantel + versión 1).
  assert.equal(normalizeRoomManifest(north, { deviceToken: "n1" }).layouts[0].plantel, "Norte");
  assert.equal(north.version, 1);
});

test("Paridad cliente/backend: misma proyección para acomodos independientes y antiguos", () => {
  const rule = { ...base().displayRules[0], deviceIds: ["n1", "s1"] };
  const open = { ...base().displayRules[0], deviceIds: [] };
  const independent = published({ displayRules: [rule, { ...open, id: "abierta", active: false }] });
  const legacy = buildPublishedRoomSnapshot(
    { ...createRoomLayoutDraft({ plantel: "Norte" }), name: "Antiguo", id: "L0" }, { name: "T" }, 5
  );
  const devices = [device("n1", "Norte"), device("n2", "Norte"), device("s1", "Sur"), device("s2", "Sur"), device("o1", "Otro"), device("sin", "")];
  const pick = (layout) => layout && {
    id: layout.id, plantel: layout.plantel, destinations: layout.destinations, displayRules: layout.displayRules,
  };
  devices.forEach((entry) => {
    const client = buildRoomDisplayManifest(entry, [independent, legacy], 9).layouts.map(pick);
    const backend = [independent, legacy].map((snapshot) => projectRoomLayout(snapshot, entry)).filter(Boolean)
      .sort((a, b) => String(a.id).localeCompare(String(b.id))).map((layout) => pick(JSON.parse(JSON.stringify(layout))));
    assert.deepEqual(backend, client, `paridad para ${entry.id}`);
  });
  // Antiguo: el backend deja el snapshot tal cual (con su plantel) y no le añade claves.
  const projectedLegacy = projectRoomLayout(legacy, device("d", "Norte"));
  assert.equal("destinations" in projectedLegacy, false);
  assert.equal(projectRoomLayout(legacy, device("d", "Sur")), null);
});


test("destinos mal tipados no se convierten en todas las pantallas y un borrador vacío conserva sus ventanas", () => {
  const source = {plantel:"",destinations:[{plantel:"Norte",deviceIds:"pantalla"}]};
  assert.deepEqual(getRoomLayoutDestinations(source),[]);
  assert.equal(roomLayoutTargetsDevice(source,{id:"pantalla",plantel:"Norte"}),false);
  assert.equal(projectRoomLayout({...source,displayRules:[{active:true,deviceIds:[]}]},{id:"pantalla",plantel:"Norte"}),null);
  const draft=base();draft.displayRules[0].deviceIds=["pantalla-previa"];
  assert.deepEqual(validateRoomLayout(draft).destinations,[]);
  assert.deepEqual(validateRoomLayout(draft).displayRules[0].deviceIds,["pantalla-previa"]);
});
