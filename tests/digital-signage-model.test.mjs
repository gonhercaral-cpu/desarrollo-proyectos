import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCampaignUpdate,
  campaignMatchesDevice,
  getCampaignPlanteles,
  getCampaignPlantelesForEdit,
  normalizeCampaignPayload,
  validateCampaignPayload,
} from "../src/utils/digitalSignage/signageCampaigns.js";
import { DIGITAL_SIGNAGE_PLANTELES } from "../src/utils/digitalSignage/signageConstants.js";
import { formatDuration } from "../src/utils/digitalSignage/signageFormatters.js";
import {
  assignPlaylistItemIds,
  getDefaultDurationSeconds,
  getDriveVideoDurationSeconds,
  measureMediaDuration,
  normalizeDurationSeconds,
  parseDurationInput,
} from "../src/utils/digitalSignage/signageMedia.js";

const [ESTRELLA_BAJA, ESTRELLA_ALTA, BUGAMBILIAS] = DIGITAL_SIGNAGE_PLANTELES;

const baseCampaign = {
  name: "Promo",
  playlistId: "pl-1",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  planteles: [ESTRELLA_BAJA],
  deviceIds: ["dev-1"],
  schedule: { enabled: true, daysOfWeek: [1, 2], startTime: "08:00", endTime: "12:00" },
};

test("getCampaignPlanteles: el array planteles es autoritativo, incluso vacío", () => {
  assert.deepEqual(getCampaignPlanteles({ planteles: [ESTRELLA_BAJA, ESTRELLA_BAJA, " "], plantel: BUGAMBILIAS }), [ESTRELLA_BAJA]);
  assert.deepEqual(getCampaignPlanteles({ planteles: [], plantel: BUGAMBILIAS }), []);
  assert.equal(campaignMatchesDevice({ planteles: [] }, { plantel: BUGAMBILIAS }), false);
});

test("getCampaignPlanteles: legacy plantel -> [plantel]; legacy sin ambos conserva 'todos' y la UI lo explicita", () => {
  assert.deepEqual(getCampaignPlanteles({ plantel: ` ${BUGAMBILIAS} ` }), [BUGAMBILIAS]);
  assert.deepEqual(getCampaignPlanteles({}), []);
  assert.equal(campaignMatchesDevice({}, { plantel: ESTRELLA_ALTA }), true);
  assert.deepEqual(getCampaignPlantelesForEdit({}), DIGITAL_SIGNAGE_PLANTELES);
  assert.deepEqual(getCampaignPlantelesForEdit({ planteles: [] }), []);
});

test("matching multi-plantel y restricción por deviceIds", () => {
  const multi = { planteles: [ESTRELLA_BAJA, BUGAMBILIAS] };
  assert.equal(campaignMatchesDevice(multi, { plantel: BUGAMBILIAS }), true);
  assert.equal(campaignMatchesDevice(multi, { plantel: ESTRELLA_ALTA }), false);

  const restricted = { ...multi, deviceIds: ["dev-1", "token-2"] };
  assert.equal(campaignMatchesDevice(restricted, { id: "dev-1", plantel: BUGAMBILIAS }), true);
  assert.equal(campaignMatchesDevice(restricted, { id: "x", deviceToken: "token-2", plantel: ESTRELLA_BAJA }), true);
  assert.equal(campaignMatchesDevice(restricted, { id: "dev-9", plantel: BUGAMBILIAS }), false);
  assert.equal(campaignMatchesDevice(restricted, { id: "dev-1", plantel: ESTRELLA_ALTA }), false);

  // Legacy con deviceIds: el plantel no participa, como antes.
  assert.equal(campaignMatchesDevice({ plantel: BUGAMBILIAS, deviceIds: ["dev-1"] }, { id: "dev-1", plantel: ESTRELLA_ALTA }), true);
});

test("payload nuevo: planteles deduplicados, plantel=planteles[0], valores inválidos rechazados", () => {
  const payload = normalizeCampaignPayload({ ...baseCampaign, planteles: [BUGAMBILIAS, ESTRELLA_BAJA, BUGAMBILIAS] });
  assert.deepEqual(payload.planteles, [BUGAMBILIAS, ESTRELLA_BAJA]);
  assert.equal(payload.plantel, BUGAMBILIAS);
  assert.deepEqual(payload.deviceIds, ["dev-1"]);

  assert.throws(() => normalizeCampaignPayload({ ...baseCampaign, planteles: ["Inventado"] }), /Plantel no válido/);
  assert.deepEqual(normalizeCampaignPayload({ ...baseCampaign, planteles: undefined, plantel: ESTRELLA_ALTA }).planteles, [ESTRELLA_ALTA]);
});

test("validación de creación: nombre, al menos un plantel, playlist y fechas", () => {
  const valid = normalizeCampaignPayload(baseCampaign);
  assert.doesNotThrow(() => validateCampaignPayload(valid));
  assert.throws(() => validateCampaignPayload({ ...valid, name: "" }), /nombre/);
  assert.throws(() => validateCampaignPayload(normalizeCampaignPayload({ ...baseCampaign, planteles: [] })), /al menos un plantel/);
  assert.throws(() => validateCampaignPayload({ ...valid, playlistId: "" }), /playlist/);
  assert.throws(() => validateCampaignPayload({ ...valid, endDate: "2025-01-01" }), /fecha fin/);
  assert.throws(
    () => normalizeCampaignPayload({ ...baseCampaign, schedule: { enabled: true, daysOfWeek: [1], startTime: "10:00", endTime: "09:00" } }),
    /hora fin/
  );
});

test("update parcial: publicar/pausar solo escribe estado y nunca borra deviceIds ni schedule", () => {
  const current = { ...baseCampaign };
  assert.deepEqual(buildCampaignUpdate(current, { active: false }), { active: false });
  assert.deepEqual(buildCampaignUpdate(current, { publishStatus: "draft" }), { publishStatus: "draft" });
});

test("update parcial: cambios de contenido se combinan con el documento actual", () => {
  const current = { ...baseCampaign };
  const update = buildCampaignUpdate(current, { name: "Nuevo nombre" });
  assert.equal(update.name, "Nuevo nombre");
  assert.deepEqual(update.deviceIds, ["dev-1"]);
  assert.equal(update.schedule.enabled, true);
  assert.deepEqual(update.schedule.daysOfWeek, [1, 2]);
  assert.deepEqual(update.planteles, undefined);

  const withPlanteles = buildCampaignUpdate(current, { planteles: [ESTRELLA_ALTA, BUGAMBILIAS] });
  assert.deepEqual(withPlanteles.planteles, [ESTRELLA_ALTA, BUGAMBILIAS]);
  assert.equal(withPlanteles.plantel, ESTRELLA_ALTA);
  assert.throws(() => buildCampaignUpdate(current, { endDate: "2000-01-01" }), /fecha fin/);
  assert.throws(() => buildCampaignUpdate(current, { planteles: [] }), /al menos un plantel/);
});

test("update de campañas legacy: conserva plantel legacy y 'todos' hasta que se editen planteles", () => {
  const legacyAll = { ...baseCampaign, planteles: undefined, plantel: "" };
  const renamed = buildCampaignUpdate(legacyAll, { name: "Renombrada" });
  assert.equal("planteles" in renamed, false);
  assert.equal("plantel" in renamed, false);

  const legacyOld = { ...baseCampaign, planteles: undefined, plantel: "Plantel Antiguo" };
  assert.doesNotThrow(() => buildCampaignUpdate(legacyOld, { name: "Otra" }));
  assert.deepEqual(buildCampaignUpdate(legacyOld, { planteles: ["Plantel Antiguo", ESTRELLA_BAJA] }).planteles, ["Plantel Antiguo", ESTRELLA_BAJA]);
  assert.throws(() => buildCampaignUpdate(legacyOld, { planteles: ["Otro Antiguo"] }), /Plantel no válido/);
});

test("duraciones: límites 1..86400, inválidos y defaults", () => {
  assert.equal(normalizeDurationSeconds(1), 1);
  assert.equal(normalizeDurationSeconds(3601), 3601);
  assert.equal(normalizeDurationSeconds(86400), 86400);
  assert.equal(normalizeDurationSeconds(999999), 86400);
  assert.equal(normalizeDurationSeconds(0.2), 1);
  assert.equal(normalizeDurationSeconds(12.6), 13);
  for (const invalid of [0, -5, NaN, "abc", "", null, undefined]) {
    assert.equal(normalizeDurationSeconds(invalid), 10, String(invalid));
  }

  assert.equal(getDefaultDurationSeconds("image"), 10);
  assert.equal(getDefaultDurationSeconds("image", 99), 10);
  assert.equal(getDefaultDurationSeconds("video", 47.4), 47);
  assert.equal(getDefaultDurationSeconds("video"), 10);
  assert.equal(getDefaultDurationSeconds("video", 0), 10);
});

test("parseDurationInput y formatDuration usan MM:SS / HH:MM:SS", () => {
  assert.equal(parseDurationInput("90"), 90);
  assert.equal(parseDurationInput("01:30"), 90);
  assert.equal(parseDurationInput("1:00:00"), 3600);
  assert.equal(parseDurationInput("24:00:00"), 86400);
  for (const invalid of ["", "00:00", "24:00:01", "1:75", "a:b", "1:2:3:4", "-5", "1.5"]) {
    assert.equal(parseDurationInput(invalid), null, invalid);
  }

  assert.equal(formatDuration(5), "00:05");
  assert.equal(formatDuration(90), "01:30");
  assert.equal(formatDuration(3599), "59:59");
  assert.equal(formatDuration(3600), "01:00:00");
  assert.equal(formatDuration(86400), "24:00:00");
  assert.equal(formatDuration(undefined), "00:00");
  assert.equal(parseDurationInput(formatDuration(4321)), 4321);
});

test("metadata de Drive: durationMillis como string o número", () => {
  assert.equal(getDriveVideoDurationSeconds({ videoMediaMetadata: { durationMillis: "125400" } }), 125);
  assert.equal(getDriveVideoDurationSeconds({ videoMediaMetadata: { durationMillis: 30000 } }), 30);
  assert.equal(getDriveVideoDurationSeconds({ videoMediaMetadata: {} }), null);
  assert.equal(getDriveVideoDurationSeconds({}), null);
  assert.equal(getDriveVideoDurationSeconds({ videoMediaMetadata: { durationMillis: "0" } }), null);
});

function createFakeEnvironment(behavior) {
  const revoked = [];
  const video = {
    attrs: {},
    removeAttribute(name) { delete this.attrs[name]; },
    load() {},
    set src(value) {
      this.attrs.src = value;
      behavior(this);
    },
  };
  return {
    revoked,
    video,
    options: {
      documentRef: { createElement: () => video },
      urlApi: { createObjectURL: () => "blob:fake", revokeObjectURL: (url) => revoked.push(url) },
      timeoutMs: 20,
    },
  };
}

test("measureMediaDuration: lee metadata real y libera el objectURL", async () => {
  const env = createFakeEnvironment((video) => {
    video.duration = 42.4;
    queueMicrotask(() => video.onloadedmetadata());
  });
  assert.equal(await measureMediaDuration({ name: "a.mp4" }, env.options), 42);
  assert.deepEqual(env.revoked, ["blob:fake"]);
});

test("measureMediaDuration: error, duración inválida y timeout devuelven null sin colgarse", async () => {
  const failing = createFakeEnvironment((video) => queueMicrotask(() => video.onerror()));
  assert.equal(await measureMediaDuration({}, failing.options), null);
  assert.deepEqual(failing.revoked, ["blob:fake"]);

  const infinite = createFakeEnvironment((video) => {
    video.duration = Infinity;
    queueMicrotask(() => video.onloadedmetadata());
  });
  assert.equal(await measureMediaDuration("https://cdn.test/live.mp4", infinite.options), null);
  assert.deepEqual(infinite.revoked, []);

  const hanging = createFakeEnvironment(() => {});
  assert.equal(await measureMediaDuration({}, hanging.options), null);
  assert.deepEqual(hanging.revoked, ["blob:fake"]);

  assert.equal(await measureMediaDuration(null), null);
  assert.equal(await measureMediaDuration({}, { documentRef: null }), null);
});

test("itemId de playlist: se conserva y los legacy son deterministas por assetId + ocurrencia", () => {
  const items = [
    { assetId: "a", itemId: "uuid-1" },
    { assetId: "a" },
    { assetId: "b" },
    { assetId: "a" },
    { assetId: "a", itemId: "uuid-1" },
  ];
  const first = assignPlaylistItemIds(items).map((item) => item.itemId);
  const second = assignPlaylistItemIds(items.map((item) => ({ ...item }))).map((item) => item.itemId);

  assert.deepEqual(first, second);
  assert.equal(first[0], "uuid-1");
  assert.equal(new Set(first).size, items.length);

  // Quitar un item de otro asset no cambia las identidades legacy restantes.
  const withoutB = assignPlaylistItemIds(items.filter((item) => item.assetId !== "b"));
  assert.equal(withoutB[1].itemId, first[1]);
  assert.equal(withoutB[2].itemId, first[3]);

  // Un itemId explícito no colisiona con un legacy generado.
  const collision = assignPlaylistItemIds([{ assetId: "a", itemId: "legacy-a-1" }, { assetId: "a" }]);
  assert.notEqual(collision[0].itemId, collision[1].itemId);
});
