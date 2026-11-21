import test from "node:test";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Firestore/Storage en memoria: valida publicación, manifiestos y suscripciones sin red.
// Map con versión por path: base del control optimista de las transacciones simuladas.
const versions = new Map();
class VersionedMap extends Map {
  set(key, value) {
    versions.set(key, (versions.get(key) || 0) + 1);
    return super.set(key, value);
  }
  delete(key) {
    versions.set(key, (versions.get(key) || 0) + 1);
    return super.delete(key);
  }
}
const store = new VersionedMap(); // path -> data
const listeners = new Set();
const SERVER_TS = { __sentinel: "serverTimestamp" };
const DELETE = { __sentinel: "deleteField" };
const counters = { adminListeners: 0, batches: 0, attempts: 0, commits: 0 };
const txHooks = { afterReads: null, failCommit: false };

const colRef = (path) => ({ kind: "col", path });
const docRef = (path) => ({ kind: "doc", path, id: path.split("/").pop() });
let autoId = 0;

function applyFields(target, fields, merge) {
  const next = merge ? { ...target } : {};
  Object.entries(fields).forEach(([key, value]) => {
    if (value === DELETE) delete next[key];
    else next[key] = value === SERVER_TS ? 1234 : value;
  });
  return next;
}

function snapshotOf(path) {
  const data = store.get(path);
  return { id: path.split("/").pop(), exists: () => data !== undefined, data: () => structuredClone(data), metadata: { fromCache: false } };
}

function notify() {
  listeners.forEach((listener) => listener());
}

const firestore = {
  collection: (_db, name) => colRef(name),
  doc: (base, ...segments) => {
    if (base.kind === "col" && segments.length === 0) return docRef(`${base.path}/auto${++autoId}`);
    return docRef([base.kind === "col" ? base.path : "", ...segments].filter(Boolean).join("/"));
  },
  getDoc: async (ref) => snapshotOf(ref.path),
  getDocs: async (q) => {
    const prefix = `${q.col.path}/`;
    const docs = [...store.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .filter((path) => q.filters.every(([field, value]) => store.get(path)[field] === value))
      .slice(0, q.max)
      .map(snapshotOf);
    return { docs };
  },
  query: (col, ...parts) => ({ col, filters: parts.filter((p) => p.filter).map((p) => p.filter), max: parts.find((p) => p.max)?.max ?? Infinity }),
  where: (field, _op, value) => ({ filter: [field, value] }),
  limit: (max) => ({ max }),
  setDoc: async (ref, data, options = {}) => {
    store.set(ref.path, applyFields(store.get(ref.path) || {}, data, options.merge === true));
    notify();
  },
  updateDoc: async (ref, data) => {
    store.set(ref.path, applyFields(store.get(ref.path) || {}, data, true));
  },
  deleteDoc: async (ref) => store.delete(ref.path),
  deleteField: () => DELETE,
  serverTimestamp: () => SERVER_TS,
  writeBatch: () => {
    const ops = [];
    return {
      set: (ref, data) => ops.push(() => store.set(ref.path, applyFields({}, data, false))),
      update: (ref, data) => ops.push(() => store.set(ref.path, applyFields(store.get(ref.path) || {}, data, true))),
      delete: (ref) => ops.push(() => store.delete(ref.path)),
      commit: async () => {
        counters.batches += 1;
        ops.forEach((op) => op());
        notify();
      },
    };
  },
  onSnapshot: (target, onNext) => {
    if (target.kind === "col") counters.adminListeners += 1;
    const emit = () => {
      if (target.kind === "doc") onNext(snapshotOf(target.path));
      else {
        const prefix = `${target.path}/`;
        onNext({ docs: [...store.keys()].filter((path) => path.startsWith(prefix)).map(snapshotOf) });
      }
    };
    listeners.add(emit);
    emit();
    return () => {
      if (target.kind === "col") counters.adminListeners -= 1;
      listeners.delete(emit);
    };
  },
  Timestamp: { fromMillis: (ms) => ms },
  // Transacción optimista: registra la versión de cada doc leído y, al confirmar, reintenta el
  // callback completo (hasta 5 veces, como el SDK) si algún doc leído cambió. Las escrituras
  // se aplican todas juntas o ninguna; leer después de escribir es error, como en Firestore.
  runTransaction: async (_db, callback) => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      counters.attempts += 1;
      const reads = new Map();
      const writes = [];
      const transaction = {
        get: async (ref) => {
          if (writes.length > 0) throw new Error("Firestore transactions require all reads to be executed before all writes.");
          if (!reads.has(ref.path)) reads.set(ref.path, versions.get(ref.path) || 0);
          return snapshotOf(ref.path);
        },
        set: (ref, data) => writes.push(() => store.set(ref.path, applyFields({}, data, false))),
        update: (ref, data) => {
          writes.push(() => {
            if (!store.has(ref.path)) throw new Error(`No document to update: ${ref.path}`);
            store.set(ref.path, applyFields(store.get(ref.path), data, true));
          });
        },
        delete: (ref) => writes.push(() => store.delete(ref.path)),
      };
      const result = await callback(transaction);
      if (txHooks.afterReads) await txHooks.afterReads(attempt);
      const conflict = [...reads].some(([path, version]) => (versions.get(path) || 0) !== version);
      if (conflict) continue;
      if (txHooks.failCommit) throw new Error("commit failed");
      writes.forEach((apply) => apply());
      counters.commits += 1;
      notify();
      return result;
    }
    throw new Error("Transaction failed after 5 attempts (aborted).");
  },
  addDoc: async () => ({}),
  orderBy: () => ({}),
  getDocsFromCache: async () => ({}),
};

const storage = {
  ref: (_s, path) => ({ path }),
  uploadBytes: async (reference) => store.set(`__storage/${reference.path}`, true),
  getDownloadURL: async (reference) => `https://storage.test/${reference.path}?token=abc`,
  deleteObject: async () => {},
};

// Hooks de resolución: sustituyen el SDK de Firebase y los módulos que lo inicializan por
// dobles en memoria; la prueba es hermética y no depende de node_modules ni de la red.
globalThis.__roomFirestoreMock = firestore;
globalThis.__roomStorageMock = storage;
globalThis.__roomControlMock = async () => ({});
const stubModule = (globalName, names) =>
  `data:text/javascript,${encodeURIComponent(
    names.map((name) => `export const ${name} = globalThis.${globalName}.${name} instanceof Function ? (...args) => globalThis.${globalName}.${name}(...args) : globalThis.${globalName}.${name};`).join("\n")
  )}`;
const STUBS = {
  "firebase/firestore": stubModule("__roomFirestoreMock", Object.keys(firestore)),
  "firebase/storage": stubModule("__roomStorageMock", Object.keys(storage)),
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./controlService") {
      return { url: "data:text/javascript,export const isSecureSignageToken = (token) => token.startsWith('ds2_'); export const playerSignageExchange = async () => ({roomManifest:null}); export const adminSignageControl = (...args) => globalThis.__roomControlMock(...args); export const signagePairingRequest = async () => ({});", shortCircuit: true };
    }
    if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
    if (specifier === "../firebase") {
      return { url: "data:text/javascript,export const db = {}; export const storage = {};", shortCircuit: true };
    }
    if (specifier === "../driveService") {
      return {
        url: "data:text/javascript,export const importDriveFileToSignageStorage = async () => ({});",
        shortCircuit: true,
      };
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      // El código de src usa imports sin extensión (Vite): se emula esa resolución.
      if (!specifier.startsWith(".")) throw error;
      for (const suffix of [".js", "/index.js"]) {
        try {
          return nextResolve(`${specifier}${suffix}`, context);
        } catch {
          // siguiente candidato
        }
      }
      throw error;
    }
  },
});

const service = await import("../src/services/digital-signage/roomLayoutsService.js");

const roomModel = await import("../src/utils/digitalSignage/roomLayouts.js");

const admin = { role: "admin", uid: "u1", name: "Admin" };
function seedDevice(id, plantel, extra = {}) {
  store.set(`digitalSignageDevices/${id}`, { name: id, plantel, active: true, deviceToken: id, ...extra });
}

function draft(overrides = {}) {
  return {
    ...roomModel.createRoomLayoutDraft({ plantel: "Norte", rooms: [{ name: "1" }, { name: "2" }] }),
    name: "Bloque 9",
    ...overrides,
  };
}

test("Guardar borrador no toca lo publicado; publicar sincroniza; despublicar recompone", async () => {
  store.clear();
  seedDevice("d1", "Norte");
  seedDevice("d2", "Norte");
  seedDevice("d3", "Sur");

  const saved = await service.saveRoomLayout(draft({ assignments: [{ id: "a", roomName: "1", teacher: "Abel", group: "", active: true }] }), admin);
  assert.ok(saved.id);
  assert.equal(store.get(`digitalSignageRoomDisplays/d1`), undefined);

  const result = await service.publishRoomLayout(saved.id, admin);
  assert.equal(result.devicesUpdated, 2);
  const d1 = store.get("digitalSignageRoomDisplays/d1");
  assert.equal(d1.layouts.length, 1);
  assert.equal(d1.layouts[0].assignments[0].teacher, "Abel");
  assert.equal(store.get("digitalSignageRoomDisplays/d3"), undefined);
  assert.equal(store.get(`digitalSignageRoomLayouts/${saved.id}`).publishedPlantel, "Norte");

  // Editar el borrador (guardar) conserva el snapshot publicado y el manifiesto.
  await service.saveRoomLayout({ ...saved, assignments: [{ id: "a", roomName: "1", teacher: "Frida", group: "", active: true }] }, admin);
  const stored = store.get(`digitalSignageRoomLayouts/${saved.id}`);
  assert.equal(stored.assignments[0].teacher, "Frida");
  assert.equal(stored.publishedSnapshot.assignments[0].teacher, "Abel");
  assert.equal(store.get("digitalSignageRoomDisplays/d1").layouts[0].assignments[0].teacher, "Abel");

  // Republicar sincroniza sin duplicar ventanas.
  await service.publishRoomLayout(saved.id, admin);
  const after = store.get("digitalSignageRoomDisplays/d1");
  assert.equal(after.layouts.length, 1);
  assert.equal(after.layouts[0].assignments[0].teacher, "Frida");
  assert.equal(after.layouts[0].displayRules.length, 1);

  // Despublicar elimina snapshot y vacía manifiestos del plantel.
  await service.unpublishRoomLayout(saved.id, admin);
  assert.equal(store.get(`digitalSignageRoomLayouts/${saved.id}`).publishedSnapshot, undefined);
  assert.equal(store.get("digitalSignageRoomDisplays/d1").layouts.length, 0);
  assert.equal(store.get("digitalSignageRoomDisplays/d2").layouts.length, 0);
});

test("Retirar destinos al republicar y mover un acomodo de plantel recompone ambos", async () => {
  store.clear();
  seedDevice("d1", "Norte");
  seedDevice("d2", "Norte");
  seedDevice("d3", "Sur");
  const base = draft();
  const saved = await service.saveRoomLayout(
    { ...base, displayRules: [{ ...base.displayRules[0], deviceIds: ["d1", "d2"] }] },
    admin
  );
  await service.publishRoomLayout(saved.id, admin);
  assert.equal(store.get("digitalSignageRoomDisplays/d2").layouts.length, 1);

  await service.saveRoomLayout({ ...saved, displayRules: [{ ...saved.displayRules[0], deviceIds: ["d1"] }] }, admin);
  await service.publishRoomLayout(saved.id, admin);
  assert.equal(store.get("digitalSignageRoomDisplays/d1").layouts.length, 1);
  assert.equal(store.get("digitalSignageRoomDisplays/d2").layouts.length, 0, "destino retirado");

  await service.saveRoomLayout({ ...saved, plantel: "Sur", displayRules: [{ ...saved.displayRules[0], deviceIds: [] }] }, admin);
  await service.publishRoomLayout(saved.id, admin);
  assert.equal(store.get("digitalSignageRoomDisplays/d1").layouts.length, 0, "plantel anterior limpiado");
  assert.equal(store.get("digitalSignageRoomDisplays/d3").layouts.length, 1);
});

test("Dispositivo nuevo o reubicado recibe solo reglas publicadas de su plantel", async () => {
  store.clear();
  seedDevice("d1", "Norte");
  const saved = await service.saveRoomLayout(draft(), admin);
  await service.publishRoomLayout(saved.id, admin);

  const manifest = await service.refreshRoomDisplayForDevice({ id: "nuevo", deviceToken: "nuevo", plantel: "Norte" });
  assert.equal(manifest.layouts.length, 1);
  const moved = await service.refreshRoomDisplayForDevice({ id: "nuevo", deviceToken: "nuevo", plantel: "Sur" });
  assert.equal(moved.layouts.length, 0);
  assert.equal(store.get("digitalSignageRoomDisplays/nuevo").plantel, "Sur");
});

test("Publicación valida: plantilla inexistente y acomodo sin guardar", async () => {
  store.clear();
  await assert.rejects(() => service.publishRoomLayout("", admin), /Guarda/);
  const saved = await service.saveRoomLayout(draft({ templateId: "no-existe" }), admin);
  await assert.rejects(() => service.publishRoomLayout(saved.id, admin), /plantilla/);
  await assert.rejects(() => service.publishRoomLayout(saved.id, { role: "user" }), /administradores/);
});

test("Publicar incluye la plantilla guardada", async () => {
  store.clear();
  seedDevice("d1", "Norte");
  const template = await service.saveRoomTemplate({ ...roomModel.DEFAULT_ROOM_TEMPLATE, name: "Mi diseño", backgroundColor: "#112233" }, admin);
  const saved = await service.saveRoomLayout(draft({ templateId: template.id }), admin);
  await service.publishRoomLayout(saved.id, admin);
  assert.equal(store.get("digitalSignageRoomDisplays/d1").layouts[0].template.backgroundColor, "#112233");
});

test("Suscripción admin compartida (sin listeners duplicados) y suscripción player por token", async () => {
  store.clear();
  counters.adminListeners = 0;
  const calls = [];
  const unsubA = service.subscribeRoomAdministration((data) => calls.push(["a", data]), () => {});
  const unsubB = service.subscribeRoomAdministration((data) => calls.push(["b", data]), () => {});
  assert.equal(counters.adminListeners, 3, "solo 3 listeners para 2 suscriptores");
  assert.ok(calls.some(([who]) => who === "b"), "el segundo recibe estado inmediato");
  unsubA();
  assert.equal(counters.adminListeners, 3);
  unsubB();
  assert.equal(counters.adminListeners, 0);

  seedDevice("d1", "Norte");
  const saved = await service.saveRoomLayout(draft(), admin);
  await service.publishRoomLayout(saved.id, admin);
  const received = [];
  const stop = service.subscribeRoomDisplay("d1", (manifest, meta) => received.push([manifest, meta]), () => {});
  assert.equal(received[0][0].deviceToken, "d1");
  assert.equal(received[0][0].layouts.length, 1);
  stop();
  const missing = [];
  service.subscribeRoomDisplay("zzz", (manifest) => missing.push(manifest), () => {})();
  assert.deepEqual(missing, [null]);
});

test("Imágenes: tipos/tamaño validados y rutas únicas sin sobreescritura", async () => {
  const png = { name: "Fondo ñ.png", type: "image/png", size: 1000 };
  const first = await service.uploadRoomTemplateImage(png, admin);
  const second = await service.uploadRoomTemplateImage(png, admin);
  assert.notEqual(first.storagePath, second.storagePath);
  assert.match(first.storagePath, /^digital-signage\/room-templates\/[^/]+\/[^/]+-Fondo-n\.png$/);
  assert.match(first.url, /token=/);
  await assert.rejects(() => service.uploadRoomTemplateImage({ ...png, type: "image/svg+xml" }, admin), /PNG, JPG o WebP/);
  await assert.rejects(() => service.uploadRoomTemplateImage({ ...png, size: 11 * 1024 * 1024 }, admin), /10 MB/);
});

test("Contratos de integración (estáticos): devices, player y lecturas admin", () => {
  const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  const devices = read("services/digital-signage/devicesService.js");
  const pairing = read("services/digital-signage/pairingService.js");
  assert.doesNotMatch(devices + pairing, /refreshRoomDisplayQuietly/);
  assert.equal(devices.match(/saveRoomDevice\(/g).length, 2, "create + update, una vez cada uno");
  assert.match(devices, /saveRoomDevice\(\{ id: deviceToken, \.\.\.payload \}, \{ mustBeNew: true \}\)/);
  // Secure pairing now composes device + manifest atomically in the backend;
  // its behavioral/revocation tests run against Firestore in digital-signage-control.

  // El player y su hook no escuchan colecciones administrativas.
  const hook = read("hooks/useRoomLayoutPlayback.js");
  const player = read("components/SignagePlayer.jsx");
  [hook, player].forEach((source) => {
    assert.doesNotMatch(source, /subscribeRoomAdministration|ROOM_LAYOUTS_COLLECTION|ROOM_CONFIGS_COLLECTION|ROOM_TEMPLATES_COLLECTION/);
  });
  assert.match(hook, /subscribeRoomDisplay/);

  // Player: pausa con timer remanente, sin desmontar el stage y con identidad de playlist.
  assert.match(player, /remainingMs/);
  assert.match(player, /visibility: "hidden"/);
  assert.match(player, /getPlaylistIdentitySignature/);
  assert.match(player, /urgentCampaignActive/);
  assert.doesNotMatch(player, /currentItem\.type === "video" && !roomActive/);

  // Video: sin autoplay bajo el acomodo, play tardío pausado y posición restaurada en la misma instancia.
  assert.match(player, /autoPlay=\{!roomActive\}/);
  assert.match(player, /onLoadedData=/);
  assert.match(player, /if \(roomPausedRef\.current\) event\.currentTarget\.pause\(\)/);
  assert.match(player, /snapshot\.instanceId === loadedInstanceId/);

  // Hook: re-suscribe por plantel, limpia ante permission-denied y limita reintentos.
  assert.match(hook, /devicePlantel/);
  assert.match(hook, /permission-denied/);
  assert.match(hook, /MAX_RETRIES/);

  // Publicación: transacción única, sin batches ni chunks.
  const roomService = read("services/digital-signage/roomLayoutsService.js");
  assert.match(roomService, /runTransaction/);
  assert.doesNotMatch(roomService, /writeBatch|commitInChunks|BATCH_LIMIT/);
});

// ---------- publicación transaccional (control optimista simulado; NO es el emulador real) ----------

function resetTx() {
  store.clear();
  counters.attempts = 0;
  counters.commits = 0;
  txHooks.afterReads = null;
  txHooks.failCommit = false;
}

async function savedLayout(name, overrides = {}) {
  return service.saveRoomLayout(draft({ name, ...overrides }), admin);
}

const guardOf = (plantel) => store.get(`digitalSignageRoomConfigs/${encodeURIComponent(plantel)}`);

test("Dos publicadores del mismo plantel: ninguno pierde su acomodo (guard + reintento)", async () => {
  resetTx();
  seedDevice("d1", "Norte");
  const a = await savedLayout("A");
  const b = await savedLayout("B");

  // Ambos leen el guard en revisión 0 antes de que alguno confirme; el 2º debe reintentar.
  await Promise.all([service.publishRoomLayout(a.id, admin), service.publishRoomLayout(b.id, admin)]);

  const manifest = store.get("digitalSignageRoomDisplays/d1");
  assert.deepEqual(manifest.layouts.map((layout) => layout.id).sort(), [a.id, b.id].sort());
  assert.ok(counters.attempts > counters.commits, "al menos un reintento por conflicto optimista");
  assert.equal(guardOf("Norte").publicationRevision, 2, "cada publicación incrementó el guard");
  assert.ok(store.get(`digitalSignageRoomLayouts/${a.id}`).publishedSnapshot);
  assert.ok(store.get(`digitalSignageRoomLayouts/${b.id}`).publishedSnapshot);
});

test("Un cambio concurrente entre lecturas y commit fuerza reintento que vuelve a consultar", async () => {
  resetTx();
  seedDevice("d1", "Norte");
  const a = await savedLayout("A");
  const b = await savedLayout("B");
  await service.publishRoomLayout(a.id, admin);
  counters.attempts = 0;
  counters.commits = 0;

  // Mientras se publica B, "otro publicador" confirma un nuevo dispositivo + guard (revisión).
  let injected = false;
  txHooks.afterReads = async () => {
    if (injected) return;
    injected = true;
    seedDevice("d-nuevo", "Norte");
    store.set("digitalSignageRoomConfigs/Norte", { ...guardOf("Norte"), publicationRevision: 99 });
  };
  await service.publishRoomLayout(b.id, admin);

  assert.equal(counters.attempts, 2);
  assert.equal(counters.commits, 1);
  // El reintento volvió a consultar y alcanzó al dispositivo creado a mitad de la operación.
  assert.equal(store.get("digitalSignageRoomDisplays/d-nuevo").layouts.length, 2);
  assert.equal(guardOf("Norte").publicationRevision, 100);
});

test("Refresh de pantalla concurrente con publicación no restaura un manifiesto viejo", async () => {
  resetTx();
  seedDevice("d1", "Norte");
  const a = await savedLayout("A");
  seedDevice("d2", "Norte"); // creado, aún sin manifiesto

  await Promise.all([
    service.publishRoomLayout(a.id, admin),
    service.refreshRoomDisplayForDevice({ id: "d2", deviceToken: "d2", plantel: "Norte" }),
  ]);
  assert.equal(store.get("digitalSignageRoomDisplays/d1").layouts.length, 1);
  assert.equal(store.get("digitalSignageRoomDisplays/d2").layouts.length, 1);
});

test("Fallo en el commit deja todo intacto (sin publicación parcial)", async () => {
  resetTx();
  seedDevice("d1", "Norte");
  seedDevice("d2", "Norte");
  const a = await savedLayout("A");
  const before = JSON.stringify([...store]);

  txHooks.failCommit = true;
  await assert.rejects(() => service.publishRoomLayout(a.id, admin), /commit failed/);
  txHooks.failCommit = false;

  assert.equal(JSON.stringify([...store]), before, "ni snapshot ni manifiestos ni guard");
  assert.equal(store.get("digitalSignageRoomDisplays/d1"), undefined);
  assert.equal(guardOf("Norte"), undefined);
});

test("Fan-out sobre el límite se rechaza antes de escribir (sin truncar)", async () => {
  resetTx();
  const a = await savedLayout("A");
  for (let index = 0; index < service.MAX_FANOUT_DEVICES + 1; index += 1) seedDevice(`d${index}`, "Norte");
  const before = JSON.stringify([...store]);

  await assert.rejects(() => service.publishRoomLayout(a.id, admin), /390/);
  assert.equal(JSON.stringify([...store]), before, "no se escribió nada");

  // Despublicar tampoco trunca: mismo rechazo.
  const stored = store.get(`digitalSignageRoomLayouts/${a.id}`);
  store.set(`digitalSignageRoomLayouts/${a.id}`, { ...stored, publishedPlantel: "Norte", publishedSnapshot: { id: a.id, plantel: "Norte" } });
  await assert.rejects(() => service.unpublishRoomLayout(a.id, admin), /390/);

  // Exactamente en el límite sí se publica.
  store.delete(`digitalSignageDevices/d${service.MAX_FANOUT_DEVICES}`);
  store.set(`digitalSignageRoomLayouts/${a.id}`, stored);
  const result = await service.publishRoomLayout(a.id, admin);
  assert.equal(result.devicesUpdated, service.MAX_FANOUT_DEVICES);
});

test("Mover de plantel actualiza snapshot, ambos manifiestos y ambos guards en una sola confirmación", async () => {
  resetTx();
  seedDevice("d1", "Norte");
  seedDevice("d3", "Sur");
  const saved = await savedLayout("A");
  await service.publishRoomLayout(saved.id, admin);
  counters.commits = 0;

  await service.saveRoomLayout({ ...saved, plantel: "Sur" }, admin);
  await service.publishRoomLayout(saved.id, admin);
  assert.equal(counters.commits, 1);
  assert.equal(store.get("digitalSignageRoomDisplays/d1").layouts.length, 0);
  assert.equal(store.get("digitalSignageRoomDisplays/d3").layouts.length, 1);
  assert.equal(guardOf("Norte").publicationRevision, 2);
  const sur = guardOf("Sur");
  assert.equal(sur.publicationRevision, 1);
  assert.deepEqual([sur.plantel, sur.timezone, sur.rooms, sur.teacherNames], ["Sur", "America/Tijuana", [], []], "guard nuevo con defaults del esquema de config");
});

test("Un fallo de auditoría posterior no se reporta como publicación fallida", async () => {
  resetTx();
  seedDevice("d1", "Norte");
  const a = await savedLayout("A");
  const original = firestore.addDoc;
  firestore.addDoc = async () => {
    throw new Error("audit down");
  };
  const warn = console.warn;
  let warned = 0;
  console.warn = () => {
    warned += 1;
  };
  try {
    const result = await service.publishRoomLayout(a.id, admin);
    assert.equal(result.devicesUpdated, 1);
  } finally {
    firestore.addDoc = original;
    console.warn = warn;
  }
  assert.ok(store.get(`digitalSignageRoomLayouts/${a.id}`).publishedSnapshot);
  assert.ok(warned > 0);
});

test("Suscripción admin expone metadatos de publicación para getRoomLayoutPublicationState", async () => {
  resetTx();
  seedDevice("d1", "Norte");
  const saved = await savedLayout("A");
  await service.publishRoomLayout(saved.id, admin);
  let received = null;
  const stop = service.subscribeRoomAdministration((data) => {
    received = data;
  }, () => {});
  const raw = received.layouts.find((layout) => layout.id === saved.id);
  stop();
  assert.equal(raw.publishedPlantel, "Norte");
  assert.ok(raw.publishedSnapshot);
  assert.ok(raw.publishedAt >= 0);
  assert.equal(roomModel.getRoomLayoutPublicationState(raw, roomModel.normalizeRoomTemplate(raw.publishedSnapshot.template)), "published");
  assert.equal(roomModel.getRoomLayoutPublicationState({ ...raw, name: "Otro" }, null), "pending");
});

// ---------- alta/edición/vinculación atómicas (control optimista simulado; NO es el emulador real) ----------

const devicesService = await import("../src/services/digital-signage/devicesService.js");
const pairingService = await import("../src/services/digital-signage/pairingService.js");

async function publishedNorte() {
  const saved = await savedLayout("A");
  await service.publishRoomLayout(saved.id, admin);
  return saved;
}

test("MAX_PUBLISHED_LAYOUTS alineado con las reglas (100) y se rechaza sin truncar", async () => {
  assert.equal(service.MAX_PUBLISHED_LAYOUTS, 100);
  resetTx();
  for (let index = 0; index < 101; index += 1) {
    store.set(`digitalSignageRoomLayouts/p${index}`, { publishedPlantel: "Norte", publishedSnapshot: { id: `p${index}`, plantel: "Norte" } });
  }
  await assert.rejects(() => service.refreshRoomDisplayForDevice({ id: "x", deviceToken: "x", plantel: "Norte" }), /100/);
  assert.equal(store.get("digitalSignageRoomDisplays/x"), undefined);
});

test("Publicar el acomodo 101 se rechaza incluso sin pantallas y conserva los 100 existentes", async () => {
  resetTx();
  for (let index = 0; index < 100; index += 1) {
    store.set(`digitalSignageRoomLayouts/p${index}`, { publishedPlantel: "Norte", publishedSnapshot: { id: `p${index}`, plantel: "Norte" } });
  }
  const saved = await service.saveRoomLayout(draft(), admin);
  await assert.rejects(() => service.publishRoomLayout(saved.id, admin), /100/);
  assert.equal(store.get(`digitalSignageRoomLayouts/${saved.id}`).publishedSnapshot, undefined);
  assert.equal([...store.values()].filter((value) => value.publishedSnapshot).length, 100);
});

test("createSignageDevice: pantalla + manifiesto + guard en una transacción", async () => {
  resetTx();
  seedDevice("d1", "Norte");
  await publishedNorte();
  counters.commits = 0;
  const created = await devicesService.createSignageDevice({ name: "Nueva", plantel: "Norte", location: "Pasillo" }, admin);
  assert.equal(counters.commits, 1);
  assert.equal(store.get(`digitalSignageDevices/${created.id}`).plantel, "Norte");
  assert.equal(store.get(`digitalSignageRoomDisplays/${created.id}`).layouts.length, 1);
  assert.equal(guardOf("Norte").publicationRevision, 2);
});

test("createSignageDevice con fallo de commit: sin pantalla ni manifiesto", async () => {
  resetTx();
  await publishedNorte();
  const before = JSON.stringify([...store]);
  txHooks.failCommit = true;
  await assert.rejects(() => devicesService.createSignageDevice({ name: "Nueva", plantel: "Norte" }, admin), /commit failed/);
  txHooks.failCommit = false;
  assert.equal(JSON.stringify([...store]), before);
});

test("updateSignageDevice: cambio de plantel recompone manifiesto, preserva campos y exige existente", async () => {
  resetTx();
  seedDevice("d1", "Norte", { location: "Aula", assignedPlaylistId: "pl1" });
  seedDevice("d3", "Sur");
  await publishedNorte();
  assert.equal(store.get("digitalSignageRoomDisplays/d1").layouts.length, 1);

  await devicesService.updateSignageDevice("d1", { plantel: "Sur" });
  const device = store.get("digitalSignageDevices/d1");
  assert.deepEqual([device.plantel, device.location, device.assignedPlaylistId, device.deviceToken], ["Sur", "Aula", "pl1", "d1"]);
  assert.equal(store.get("digitalSignageRoomDisplays/d1").layouts.length, 0, "no conserva el manifiesto anterior");
  assert.equal(guardOf("Norte").publicationRevision, 2, "guard del plantel anterior incrementado");

  await assert.rejects(() => devicesService.updateSignageDevice("fantasma", { name: "x" }), /No se encontró/);
  assert.equal(store.get("digitalSignageRoomDisplays/fantasma"), undefined);

  const before = JSON.stringify([...store]);
  txHooks.failCommit = true;
  await assert.rejects(() => devicesService.updateSignageDevice("d1", { plantel: "Norte" }), /commit failed/);
  txHooks.failCommit = false;
  assert.equal(JSON.stringify([...store]), before, "ni pantalla ni manifiesto cambian");
});

test("saveRoomDevice mustBeNew rechaza token existente", async () => {
  resetTx();
  seedDevice("d1", "Norte");
  await assert.rejects(() => service.saveRoomDevice({ id: "d1", name: "x", plantel: "Norte" }, { mustBeNew: true }), /ya existe/);
});

test("Alta concurrente con publicación: reintenta y el manifiesto incluye lo publicado", async () => {
  resetTx();
  seedDevice("d1", "Norte");
  const a = await savedLayout("A");
  let fired = false;
  txHooks.afterReads = async () => {
    if (fired) return;
    fired = true;
    txHooks.afterReads = null;
    await service.publishRoomLayout(a.id, admin); // gana la carrera
  };
  await service.saveRoomDevice({ id: "nuevo", deviceToken: "nuevo", name: "N", plantel: "Norte", active: true }, { mustBeNew: true });
  assert.equal(store.get("digitalSignageRoomDisplays/nuevo").layouts.length, 1, "no queda sin all[] publicado");
  assert.equal(store.get("digitalSignageDevices/nuevo").plantel, "Norte");
});

test("pairing seguro propaga rechazo del servidor y no realiza escrituras cliente parciales", async () => {
  resetTx();
  seedDevice("d1", "Norte");
  await publishedNorte();
  const before = JSON.stringify([...store]);
  globalThis.__roomControlMock = async () => { throw new Error("backend rechazado"); };
  await assert.rejects(() => pairingService.claimPairingCode("AES-123456", { name: "P", plantel: "Norte", location: "L" }, admin), /backend rechazado/);
  assert.equal(JSON.stringify([...store]), before, "no hay alta parcial en el SDK cliente");
  globalThis.__roomControlMock = async () => ({ id: "estable", deviceId: "estable" });
  assert.equal((await pairingService.claimPairingCode("AES-123456", { name: "P", plantel: "Norte", location: "L" }, admin)).id, "estable");
  await assert.rejects(() => pairingService.claimPairingCode("AES-123456", {}, { role: "requester" }), /administradores/);
  globalThis.__roomControlMock = async () => ({});
});

test("roomId opcional se conserva en normalización, snapshot publicado y borrador desde catálogo", async () => {
  resetTx();
  seedDevice("d1", "Norte");
  const base = draft();
  const rows = [
    { id: "a", roomId: "room-7", roomName: "7", teacher: "Abel", group: "", active: true },
    { id: "b", roomName: "8", teacher: "", group: "", active: true },
  ];
  const normalized = roomModel.normalizeRoomLayout({ ...base, assignments: rows });
  assert.equal(normalized.assignments[0].roomId, "room-7");
  assert.equal("roomId" in normalized.assignments[1], false, "datos antiguos intactos");
  const saved = await service.saveRoomLayout({ ...base, assignments: rows }, admin);
  await service.publishRoomLayout(saved.id, admin);
  assert.equal(store.get("digitalSignageRoomDisplays/d1").layouts[0].assignments[0].roomId, "room-7");
  const fromCatalog = roomModel.createRoomLayoutDraft({ plantel: "Norte", rooms: [{ id: "r9", name: "9" }] });
  assert.equal(fromCatalog.assignments[0].roomId, "r9");
});
