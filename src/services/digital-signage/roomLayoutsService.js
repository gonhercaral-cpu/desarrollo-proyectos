import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../firebase";
import {
  DEVICES_COLLECTION,
  assertAdminUser,
  cleanFileName,
  cleanText,
  getUserId,
} from "./shared";
import { logSignageAudit } from "./auditService";
import {
  DEFAULT_ROOM_TEMPLATE,
  ROOM_DEFAULT_TIMEZONE,
  createRoomId,
  normalizeRoomConfig,
  normalizeRoomLayout,
  normalizeRoomTemplate,
  validateRoomConfig,
  validateRoomLayout,
  validateRoomTemplate,
} from "../../utils/digitalSignage/roomLayouts.js";
import {
  buildPublishedRoomSnapshot,
  buildRoomDisplayManifest,
  byteLength,
  normalizeRoomManifest,
} from "../../utils/digitalSignage/roomPublication.js";

export const ROOM_CONFIGS_COLLECTION = "digitalSignageRoomConfigs";
export const ROOM_LAYOUTS_COLLECTION = "digitalSignageRoomLayouts";
export const ROOM_TEMPLATES_COLLECTION = "digitalSignageRoomTemplates";
export const ROOM_DISPLAYS_COLLECTION = "digitalSignageRoomDisplays";
export const ROOM_TEMPLATE_STORAGE_ROOT = "digital-signage/room-templates";

const ROOM_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const ROOM_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
// Límites explícitos v1 de una publicación (una sola transacción, nunca se trunca).
export const MAX_FANOUT_DEVICES = 390;
export const MAX_PUBLISHED_LAYOUTS = 100;
export const MAX_TRANSACTION_OPERATIONS = 400;
export const MAX_TRANSACTION_BYTES = 8 * 1024 * 1024;

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function layoutFromDocument(snapshot) {
  const data = snapshot.data();
  return {
    ...normalizeRoomLayout({ ...data, id: snapshot.id }),
    id: snapshot.id,
    // Metadatos de publicación crudos para getRoomLayoutPublicationState(rawLayout, template);
    // el borrador normalizado (campos puros) no se altera.
    publishedSnapshot: data.publishedSnapshot || null,
    publishedPlantel: data.publishedPlantel || "",
    publishedAt: toMillis(data.publishedAt),
    publishedAtMillis: toMillis(data.publishedAt) || Number(data.publishedSnapshot?.publishedAtMillis) || 0,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
    createdById: data.createdById || "",
  };
}

function templateFromDocument(snapshot) {
  const data = snapshot.data();
  return {
    ...normalizeRoomTemplate({ ...data, id: snapshot.id }),
    id: snapshot.id,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

function configFromDocument(snapshot) {
  const data = snapshot.data();
  return { ...normalizeRoomConfig(data), id: snapshot.id, updatedAt: toMillis(data.updatedAt) };
}

// ---------- administración (suscripción compartida, sin listeners duplicados) ----------

const adminState = {
  subscribers: new Set(),
  unsubscribers: [],
  data: { configs: null, layouts: null, templates: null },
  failed: false,
};

function emitAdminState() {
  const { configs, layouts, templates } = adminState.data;
  if (!configs || !layouts || !templates) return;
  adminState.subscribers.forEach((subscriber) => {
    subscriber.callback({ configs, layouts, templates });
  });
}

function startAdminListeners() {
  const sources = [
    ["configs", ROOM_CONFIGS_COLLECTION, configFromDocument],
    ["layouts", ROOM_LAYOUTS_COLLECTION, layoutFromDocument],
    ["templates", ROOM_TEMPLATES_COLLECTION, templateFromDocument],
  ];
  adminState.data = { configs: null, layouts: null, templates: null };
  adminState.unsubscribers = sources.map(([key, collectionName, mapper]) =>
    onSnapshot(
      collection(db, collectionName),
      (snapshot) => {
        adminState.data = { ...adminState.data, [key]: snapshot.docs.map(mapper) };
        emitAdminState();
      },
      (error) => {
        adminState.subscribers.forEach((subscriber) => subscriber.onError?.(error));
      }
    )
  );
}

function stopAdminListeners() {
  adminState.unsubscribers.forEach((unsubscribe) => unsubscribe());
  adminState.unsubscribers = [];
  adminState.data = { configs: null, layouts: null, templates: null };
}

export function subscribeRoomAdministration(callback, onError) {
  const subscriber = { callback, onError };
  adminState.subscribers.add(subscriber);

  if (adminState.subscribers.size === 1) {
    startAdminListeners();
  } else {
    const { configs, layouts, templates } = adminState.data;
    if (configs && layouts && templates) callback({ configs, layouts, templates });
  }

  return () => {
    adminState.subscribers.delete(subscriber);
    if (adminState.subscribers.size === 0) stopAdminListeners();
  };
}

// ---------- guardado ----------

export async function saveRoomConfig(configData, user) {
  assertAdminUser(user);
  const config = validateRoomConfig(configData);
  const id = encodeURIComponent(config.plantel);

  await setDoc(
    doc(db, ROOM_CONFIGS_COLLECTION, id),
    { ...config, updatedAt: serverTimestamp(), updatedById: getUserId(user) },
    { merge: true }
  );
  await logSignageAudit("guardar configuracion de salones", "roomConfig", id, config.plantel, {
    plantel: config.plantel,
    rooms: config.rooms.length,
  }, user);

  return { ...config, id };
}

export async function saveRoomLayout(layoutData, user) {
  assertAdminUser(user);
  const layout = validateRoomLayout(layoutData);
  const layoutRef = layout.id
    ? doc(db, ROOM_LAYOUTS_COLLECTION, layout.id)
    : doc(collection(db, ROOM_LAYOUTS_COLLECTION));
  const existing = layout.id ? await getDoc(layoutRef) : null;
  const isNew = !existing?.exists();

  // Nunca se incluyen publishedSnapshot/publishedPlantel: el borrador no altera lo publicado.
  const { id: _omit, ...fields } = layout; // eslint-disable-line no-unused-vars
  const payload = {
    ...fields,
    updatedAt: serverTimestamp(),
    ...(isNew ? { createdAt: serverTimestamp(), createdById: getUserId(user) } : {}),
  };

  await setDoc(layoutRef, payload, { merge: true });
  await logSignageAudit("guardar acomodo", "roomLayout", layoutRef.id, layout.name, {
    plantel: layout.plantel,
    assignments: layout.assignments.length,
    rules: layout.displayRules.length,
  }, user);

  return { ...layout, id: layoutRef.id };
}

export async function saveRoomTemplate(templateData, user) {
  assertAdminUser(user);
  const template = validateRoomTemplate(templateData);
  const templateRef = template.id
    ? doc(db, ROOM_TEMPLATES_COLLECTION, template.id)
    : doc(collection(db, ROOM_TEMPLATES_COLLECTION));
  const existing = template.id ? await getDoc(templateRef) : null;
  const isNew = !existing?.exists();

  const { id: _omit, ...fields } = template; // eslint-disable-line no-unused-vars
  await setDoc(
    templateRef,
    {
      ...fields,
      updatedAt: serverTimestamp(),
      ...(isNew ? { createdAt: serverTimestamp(), createdById: getUserId(user) } : {}),
    },
    { merge: true }
  );
  await logSignageAudit("guardar plantilla de acomodo", "roomTemplate", templateRef.id, template.name, {
    elements: template.elements.length,
  }, user);

  return { ...template, id: templateRef.id };
}

export async function uploadRoomTemplateImage(file, user) {
  assertAdminUser(user);
  if (!file) throw new Error("Selecciona una imagen.");
  if (!ROOM_IMAGE_TYPES.includes(file.type)) throw new Error("Solo se permiten imágenes PNG, JPG o WebP.");
  if (!(file.size > 0) || file.size > ROOM_IMAGE_MAX_BYTES) {
    throw new Error("La imagen debe pesar máximo 10 MB.");
  }

  // Carpeta y nombre únicos: nunca sobreescribe imágenes previas.
  const storagePath = `${ROOM_TEMPLATE_STORAGE_ROOT}/${createRoomId("img")}/${createRoomId("f")}-${cleanFileName(file.name)}`;
  const storageReference = ref(storage, storagePath);
  await uploadBytes(storageReference, file, { contentType: file.type });
  const url = await getDownloadURL(storageReference);
  return { url, storagePath };
}

// ---------- publicación ----------
//
// Toda publicación/despublicación/refresh es UNA transacción de Firestore. El guard por
// plantel es el campo `publicationRevision` del doc de config del plantel: todas las
// operaciones del mismo plantel lo leen y lo incrementan, así dos publicadores (o un alta de
// pantalla) concurrentes se serializan por conflicto optimista y el perdedor reintenta
// recomponiendo con lo que ya publicó el ganador.
//
// El SDK web no admite consultas dentro de la transacción: las consultas (IDs de snapshots y
// de pantallas) se hacen dentro del callback, y cada doc que influye se vuelve a leer con
// transaction.get para registrar su versión. Si la transacción se reintenta, el callback
// vuelve a consultar.

function getGuardRef(plantel) {
  return doc(db, ROOM_CONFIGS_COLLECTION, encodeURIComponent(plantel));
}

function manifestRef(deviceToken) {
  return doc(db, ROOM_DISPLAYS_COLLECTION, deviceToken);
}

function manifestPayload(manifest) {
  return { ...manifest, updatedAt: serverTimestamp() };
}

function uniquePlanteles(planteles) {
  return Array.from(new Set(planteles.map(cleanText).filter(Boolean))).sort();
}

// Consulta con limit(max + 1): si devuelve más de `max` se rechaza, nunca se trunca.
async function queryIdsOrReject(collectionName, field, plantel, max, label) {
  const result = await getDocs(
    query(collection(db, collectionName), where(field, "==", plantel), limit(max + 1))
  );
  if (result.docs.length > max) {
    throw new Error(`El plantel "${plantel}" supera el límite de ${max} ${label} por publicación; divide el plantel o retira elementos.`);
  }
  return result.docs.map((snapshot) => snapshot.id);
}

// Lee (dentro de la transacción) guards, snapshots publicados y pantallas de los planteles.
// `knownLayouts`: acomodos ya leídos con transaction.get (id -> data|undefined).
async function readPublicationContext(transaction, planteles, knownLayouts = new Map()) {
  const guards = new Map();
  for (const plantel of planteles) {
    const ref = getGuardRef(plantel);
    const snapshot = await transaction.get(ref);
    guards.set(plantel, {
      ref,
      exists: snapshot.exists(),
      revision: Number(snapshot.exists() ? snapshot.data().publicationRevision : 0) || 0,
    });
  }

  const layoutIds = new Set();
  const deviceIds = new Set();
  for (const plantel of planteles) {
    (await queryIdsOrReject(ROOM_LAYOUTS_COLLECTION, "publishedPlantel", plantel, MAX_PUBLISHED_LAYOUTS, "acomodos publicados"))
      .forEach((id) => layoutIds.add(id));
    (await queryIdsOrReject(DEVICES_COLLECTION, "plantel", plantel, MAX_FANOUT_DEVICES, "pantallas"))
      .forEach((id) => deviceIds.add(id));
  }
  if (deviceIds.size > MAX_FANOUT_DEVICES) {
    throw new Error(`La publicación afecta ${deviceIds.size} pantallas; el máximo por operación es ${MAX_FANOUT_DEVICES}.`);
  }

  const layouts = new Map(knownLayouts);
  for (const id of layoutIds) {
    if (!layouts.has(id)) {
      const snapshot = await transaction.get(doc(db, ROOM_LAYOUTS_COLLECTION, id));
      layouts.set(id, snapshot.exists() ? snapshot.data() : undefined);
    }
  }
  const devices = [];
  for (const id of deviceIds) {
    const snapshot = await transaction.get(doc(db, DEVICES_COLLECTION, id));
    if (snapshot.exists()) devices.push({ id, ...snapshot.data() });
  }

  const snapshotsByPlantel = new Map(planteles.map((plantel) => [plantel, []]));
  layouts.forEach((data, id) => {
    const plantel = cleanText(data?.publishedPlantel);
    if (data?.publishedSnapshot && snapshotsByPlantel.has(plantel)) {
      snapshotsByPlantel.get(plantel).push({ ...data.publishedSnapshot, id });
    }
  });
  return { guards, devices, snapshotsByPlantel };
}

// Manifiestos completos (no incrementales) para las pantallas leídas. `replacement` sustituye
// el snapshot de `layoutId` solo en su plantel; sin `replacement` se retira de todos.
function composeManifestWrites(context, layoutId, replacement) {
  const writes = [];
  context.devices.forEach((device) => {
    const plantel = cleanText(device.plantel);
    const known = context.snapshotsByPlantel.get(plantel);
    if (!known) return; // cambió de plantel durante la operación: su propio refresh lo recompone
    const base = known.filter((snapshot) => snapshot.id !== layoutId);
    const snapshots = replacement && cleanText(replacement.plantel) === plantel ? [...base, replacement] : base;
    const token = cleanText(device.deviceToken || device.id);
    const manifest = buildRoomDisplayManifest({ ...device, deviceToken: token }, snapshots, Date.now());
    writes.push({ token, manifest });
  });
  return writes;
}

function assertTransactionBudget(manifestWrites, extraPayloads) {
  const operations = manifestWrites.length + extraPayloads.length;
  if (operations > MAX_TRANSACTION_OPERATIONS) {
    throw new Error(`La operación requiere ${operations} escrituras; el máximo es ${MAX_TRANSACTION_OPERATIONS}.`);
  }
  const bytes =
    manifestWrites.reduce((sum, entry) => sum + byteLength(entry.manifest), 0) +
    extraPayloads.reduce((sum, payload) => sum + byteLength(payload), 0);
  if (bytes > MAX_TRANSACTION_BYTES) {
    throw new Error("Los acomodos publicados superan el tamaño máximo por operación (8 MB); simplifica o despublica alguno.");
  }
}

function writeGuards(transaction, guards, user) {
  guards.forEach((guard, plantel) => {
    if (guard.exists) {
      transaction.update(guard.ref, { publicationRevision: guard.revision + 1 });
    } else {
      transaction.set(guard.ref, {
        plantel,
        timezone: ROOM_DEFAULT_TIMEZONE,
        rooms: [],
        teacherNames: [],
        publicationRevision: guard.revision + 1,
        updatedAt: serverTimestamp(),
        updatedById: getUserId(user),
      });
    }
  });
}

async function logAuditQuietly(...args) {
  // El audit nunca cambia el resultado de una operación ya confirmada.
  try {
    await logSignageAudit(...args);
  } catch (error) {
    console.warn("No se pudo registrar la auditoría del acomodo.", error);
  }
}

async function resolveTemplate(transaction, templateId) {
  if (!templateId) return { ...normalizeRoomTemplate(DEFAULT_ROOM_TEMPLATE), id: "" };
  const snapshot = await transaction.get(doc(db, ROOM_TEMPLATES_COLLECTION, templateId));
  if (!snapshot.exists()) throw new Error("La plantilla seleccionada ya no existe.");
  return templateFromDocument(snapshot);
}

export async function publishRoomLayout(id, user) {
  assertAdminUser(user);
  const layoutId = cleanText(id);
  if (!layoutId) throw new Error("Guarda el acomodo antes de publicarlo.");

  const layoutRef = doc(db, ROOM_LAYOUTS_COLLECTION, layoutId);
  const outcome = await runTransaction(db, async (transaction) => {
    const stored = await transaction.get(layoutRef);
    if (!stored.exists()) throw new Error("No se encontró el acomodo guardado.");

    const storedData = stored.data();
    const layout = validateRoomLayout({ ...storedData, id: layoutId });
    const template = await resolveTemplate(transaction, layout.templateId);
    const snapshot = buildPublishedRoomSnapshot({ ...layout, id: layoutId }, template, Date.now());

    const planteles = uniquePlanteles([layout.plantel, storedData.publishedPlantel]);
    const context = await readPublicationContext(transaction, planteles, new Map([[layoutId, storedData]]));
    const publishedInPlantel = context.snapshotsByPlantel.get(layout.plantel) || [];
    if (publishedInPlantel.filter((entry) => entry.id !== layoutId).length >= MAX_PUBLISHED_LAYOUTS) {
      throw new Error(`El plantel supera el límite de ${MAX_PUBLISHED_LAYOUTS} acomodos publicados; despublica alguno antes de continuar.`);
    }
    const layoutUpdate = {
      publishedSnapshot: snapshot,
      publishedPlantel: layout.plantel,
      publishedAt: serverTimestamp(),
      publishedById: getUserId(user),
    };
    const manifestWrites = composeManifestWrites(context, layoutId, snapshot);
    assertTransactionBudget(manifestWrites, [layoutUpdate]);

    // Todas las lecturas terminaron: se escribe snapshot + manifiestos + guards atómicamente.
    transaction.update(layoutRef, layoutUpdate);
    manifestWrites.forEach(({ token, manifest }) => transaction.set(manifestRef(token), manifestPayload(manifest)));
    writeGuards(transaction, context.guards, user);
    return { layout, snapshot, devicesUpdated: manifestWrites.length };
  });

  await logAuditQuietly("publicar acomodo", "roomLayout", layoutId, outcome.layout.name, {
    plantel: outcome.layout.plantel,
    devices: outcome.devicesUpdated,
  }, user);

  return {
    id: layoutId,
    plantel: outcome.layout.plantel,
    publishedAtMillis: outcome.snapshot.publishedAtMillis,
    devicesUpdated: outcome.devicesUpdated,
    warnings: outcome.layout.assignments.some((row) => row.active && !row.teacher)
      ? ["Hay filas activas sin maestro."]
      : [],
  };
}

export async function unpublishRoomLayout(id, user) {
  assertAdminUser(user);
  const layoutId = cleanText(id);
  if (!layoutId) throw new Error("Falta el ID del acomodo.");

  const layoutRef = doc(db, ROOM_LAYOUTS_COLLECTION, layoutId);
  const outcome = await runTransaction(db, async (transaction) => {
    const stored = await transaction.get(layoutRef);
    if (!stored.exists()) throw new Error("No se encontró el acomodo.");

    const data = stored.data();
    if (!data.publishedSnapshot) return { name: data.name, plantel: "", devicesUpdated: 0, changed: false };
    const plantel = cleanText(data.publishedPlantel || data.publishedSnapshot.plantel);

    const context = await readPublicationContext(transaction, uniquePlanteles([plantel]), new Map([[layoutId, data]]));
    const layoutUpdate = { publishedSnapshot: deleteField(), publishedPlantel: "", publishedAt: deleteField() };
    const manifestWrites = composeManifestWrites(context, layoutId, null);
    assertTransactionBudget(manifestWrites, [{ layoutId }]);

    transaction.update(layoutRef, layoutUpdate);
    manifestWrites.forEach(({ token, manifest }) => transaction.set(manifestRef(token), manifestPayload(manifest)));
    writeGuards(transaction, context.guards, user);
    return { name: data.name, plantel, devicesUpdated: manifestWrites.length, changed: true };
  });

  if (outcome.changed) {
    await logAuditQuietly("despublicar acomodo", "roomLayout", layoutId, outcome.name, {
      plantel: outcome.plantel,
      devices: outcome.devicesUpdated,
    }, user);
  }
  return { id: layoutId, devicesUpdated: outcome.devicesUpdated };
}

// Guard + snapshots publicados de un plantel, todo vía transaction.get (lecturas antes de escribir).
async function readPlantelGuard(transaction, plantel) {
  const ref = getGuardRef(plantel);
  const snapshot = await transaction.get(ref);
  return {
    ref,
    exists: snapshot.exists(),
    revision: Number(snapshot.exists() ? snapshot.data().publicationRevision : 0) || 0,
  };
}

async function readPublishedSnapshots(transaction, plantel) {
  const ids = await queryIdsOrReject(ROOM_LAYOUTS_COLLECTION, "publishedPlantel", plantel, MAX_PUBLISHED_LAYOUTS, "acomodos publicados");
  const snapshots = [];
  for (const layoutId of ids) {
    const layoutSnapshot = await transaction.get(doc(db, ROOM_LAYOUTS_COLLECTION, layoutId));
    const data = layoutSnapshot.exists() ? layoutSnapshot.data() : null;
    if (data?.publishedSnapshot && cleanText(data.publishedPlantel) === plantel) {
      snapshots.push({ ...data.publishedSnapshot, id: layoutId });
    }
  }
  return snapshots;
}

// Prepara alta/edición ATÓMICA de pantalla + manifiesto. Solo lecturas (transaction.get); nada se
// escribe hasta plan.commit(), que graba pantalla, manifiesto y guard(s) del plantel nuevo y del
// anterior juntos. Quien llama puede añadir más escrituras (p. ej. el pairing) tras las lecturas.
export async function prepareRoomDeviceWrite(transaction, devicePatch, { mustBeNew = false } = {}) {
  const token = cleanText(devicePatch?.deviceToken || devicePatch?.id);
  if (!token) throw new Error("Falta el token de la pantalla.");

  const deviceRef = doc(db, DEVICES_COLLECTION, token);
  const stored = await transaction.get(deviceRef);
  if (mustBeNew && stored.exists()) throw new Error("La pantalla ya existe.");
  if (!mustBeNew && !stored.exists()) throw new Error("No se encontró la pantalla.");

  const { id: _id, ...fields } = devicePatch; // eslint-disable-line no-unused-vars
  if (!mustBeNew) delete fields.deviceToken;
  const previous = stored.exists() ? stored.data() : {};
  const device = { ...previous, ...fields, id: token, deviceToken: token };
  const plantel = cleanText(device.plantel);
  const previousPlantel = cleanText(previous.plantel);

  const guards = new Map();
  for (const name of uniquePlanteles([plantel, previousPlantel])) {
    guards.set(name, await readPlantelGuard(transaction, name));
  }
  const snapshots = plantel ? await readPublishedSnapshots(transaction, plantel) : [];

  // Los centinelas serverTimestamp() no participan en el manifiesto: solo plantel/estado/token.
  const manifest = buildRoomDisplayManifest(device, snapshots, Date.now());
  assertTransactionBudget([{ manifest }], [fields]);

  return {
    device,
    commit: () => {
      if (mustBeNew) transaction.set(deviceRef, fields);
      else transaction.update(deviceRef, fields);
      transaction.set(manifestRef(token), manifestPayload(manifest));
      writeGuards(transaction, guards, null);
    },
  };
}

// Alta o edición atómica pantalla + manifiesto. mustBeNew=true crea; si no, exige existente.
export async function saveRoomDevice(devicePatch, options = {}) {
  return runTransaction(db, async (transaction) => {
    const plan = await prepareRoomDeviceWrite(transaction, devicePatch, options);
    plan.commit();
    return plan.device;
  });
}

// Recompone el manifiesto de UNA pantalla ya existente sin cambiar la pantalla.
export async function refreshRoomDisplayForDevice(device) {
  const token = cleanText(device?.deviceToken || device?.id);
  if (!token) throw new Error("Falta el token de la pantalla.");

  return runTransaction(db, async (transaction) => {
    const stored = await transaction.get(doc(db, DEVICES_COLLECTION, token));
    const current = stored.exists()
      ? { ...stored.data(), id: token, deviceToken: token }
      : { ...device, id: device.id || token, deviceToken: token };
    const plantel = cleanText(current.plantel);

    const guards = new Map();
    const layouts = [];
    for (const name of uniquePlanteles([plantel])) {
      guards.set(name, await readPlantelGuard(transaction, name));
      layouts.push(...(await readPublishedSnapshots(transaction, name)));
    }

    const manifest = buildRoomDisplayManifest(current, layouts, Date.now());
    assertTransactionBudget([{ manifest }], []);
    transaction.set(manifestRef(token), manifestPayload(manifest));
    writeGuards(transaction, guards, null);
    return manifest;
  });
}

// ---------- player ----------

// Lectura única por token (regla `get`); sin listas ni colecciones admin.
// callback(manifest|null, { fromCache }). Un manifiesto inválido se reporta como error
// para que el player conserve su caché en vez de borrarla.
export function subscribeRoomDisplay(deviceToken, callback, onError) {
  const token = cleanText(deviceToken);
  if (!token) return () => {};

  return onSnapshot(
    manifestRef(token),
    (snapshot) => {
      const meta = { fromCache: snapshot.metadata?.fromCache === true };
      if (!snapshot.exists()) {
        callback(null, meta);
        return;
      }
      const manifest = normalizeRoomManifest(snapshot.data(), { deviceToken: token });
      if (!manifest) {
        onError?.(new Error("Manifiesto de acomodos no válido."));
        return;
      }
      callback(manifest, meta);
    },
    onError
  );
}

export async function deleteRoomDisplayQuietly(deviceToken) {
  // Se deja el manifiesto huérfano si las reglas no permiten borrarlo: no afecta a nadie.
  try {
    const token = cleanText(deviceToken);
    if (!token) return;
    await deleteDoc(manifestRef(token));
  } catch (error) {
    console.warn("No se pudo eliminar el manifiesto de acomodos.", error);
  }
}
