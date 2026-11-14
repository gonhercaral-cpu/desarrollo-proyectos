// Composición pura de manifiestos publicados por pantalla (sin Firebase).
import {
  ROOM_DEFAULT_TIMEZONE,
  ROOM_MODEL_VERSION,
  normalizePublishedRoomLayout,
  normalizeRoomLayout,
  normalizeRoomTemplate,
  validateRoomLayout,
  validateRoomTemplate,
} from "./roomLayouts.js";

export const ROOM_MANIFEST_MAX_BYTES = 900 * 1024;

function clean(value) {
  return String(value ?? "").trim();
}

export function byteLength(value) {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(json).length : json.length * 3;
}

// Copia inmutable lista para guardarse como publishedSnapshot.
export function buildPublishedRoomSnapshot(layoutData, templateData, publishedAtMillis = Date.now()) {
  const layout = validateRoomLayout(layoutData);
  const template = validateRoomTemplate(templateData);
  if (template.active === false) throw new Error("La plantilla seleccionada está inactiva.");
  const { id, ...rest } = layout;
  if (!id) throw new Error("Guarda el acomodo antes de publicarlo.");
  return JSON.parse(JSON.stringify({ id, ...rest, template, publishedAtMillis }));
}

function ruleAppliesToDevice(rule, device) {
  if (rule.active === false) return false;
  if (!rule.deviceIds || rule.deviceIds.length === 0) return true;
  return rule.deviceIds.includes(clean(device.id)) || rule.deviceIds.includes(clean(device.deviceToken));
}

// Manifiesto completo y determinista para UNA pantalla. Sin duplicados por ID de acomodo,
// solo reglas activas que apuntan a la pantalla y solo del mismo plantel.
export function buildRoomDisplayManifest(device, snapshots = [], updatedAtMillis = Date.now()) {
  const token = clean(device?.deviceToken || device?.id);
  const plantel = clean(device?.plantel);
  if (!token) throw new Error("Falta el token de la pantalla.");

  const byId = new Map();
  (Array.isArray(snapshots) ? snapshots : []).forEach((snapshot) => {
    if (!snapshot || !clean(snapshot.id) || snapshot.active === false) return;
    if (clean(snapshot.plantel) !== plantel) return;
    const previous = byId.get(snapshot.id);
    if (previous && (previous.publishedAtMillis || 0) >= (snapshot.publishedAtMillis || 0)) return;
    byId.set(snapshot.id, snapshot);
  });

  const layouts = Array.from(byId.values())
    .map((snapshot) => {
      const published = normalizePublishedRoomLayout(snapshot);
      const displayRules = published.displayRules.filter((rule) => ruleAppliesToDevice(rule, device));
      return { ...published, displayRules };
    })
    .filter((layout) => layout.displayRules.length > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const timezone = layouts[0]?.timezone || ROOM_DEFAULT_TIMEZONE;
  const manifest = {
    version: ROOM_MODEL_VERSION,
    deviceToken: token,
    plantel,
    timezone,
    active: true,
    layouts,
    updatedAt: updatedAtMillis,
  };

  if (byteLength(manifest) > ROOM_MANIFEST_MAX_BYTES) {
    throw new Error("Los acomodos publicados de esta pantalla superan el tamaño permitido; despublica o simplifica alguno.");
  }
  return manifest;
}

// Valida lo recibido de Firestore/localStorage: null si no es un manifiesto usable.
export function normalizeRoomManifest(data, expectedDevice = null) {
  if (!data || typeof data !== "object" || data.version !== ROOM_MODEL_VERSION) return null;
  const deviceToken = clean(data.deviceToken);
  if (!deviceToken || !Array.isArray(data.layouts)) return null;
  if (expectedDevice) {
    const expected = clean(expectedDevice.deviceToken || expectedDevice.id);
    if (expected && expected !== deviceToken) return null;
  }
  const updatedAt = typeof data.updatedAt?.toMillis === "function" ? data.updatedAt.toMillis() : Number(data.updatedAt) || 0;
  return {
    version: ROOM_MODEL_VERSION,
    deviceToken,
    plantel: clean(data.plantel),
    timezone: clean(data.timezone) || ROOM_DEFAULT_TIMEZONE,
    active: data.active !== false,
    updatedAt,
    layouts: data.layouts.map(normalizePublishedRoomLayout),
  };
}

// URLs de imagen que el player debe precargar (fondos, logos, imágenes de tarjetas).
export function getRoomManifestImageUrls(manifest) {
  const urls = new Set();
  (manifest?.layouts || []).forEach((layout) => {
    const template = normalizeRoomTemplate(layout.template || {});
    if (template.backgroundUrl) urls.add(template.backgroundUrl);
    template.elements.forEach((element) => {
      if (element.type === "image" && element.url) urls.add(element.url);
    });
  });
  return Array.from(urls);
}

const CLOCK_MAX_RTT_MS = 5000;

// Offset = hora del servidor - hora local. `Date` de HEAD tiene resolución de 1 s:
// se asume el punto medio del segundo y se suma `Age` si hay proxy/CDN.
export function computeClockOffset({ dateHeader, ageHeader = "", localStartMillis, localEndMillis }) {
  const serverMillis = Date.parse(dateHeader || "");
  if (!Number.isFinite(serverMillis)) return null;
  const rtt = localEndMillis - localStartMillis;
  if (!(rtt >= 0) || rtt > CLOCK_MAX_RTT_MS) return null;
  const age = Number(ageHeader);
  const ageMillis = Number.isFinite(age) && age > 0 ? age * 1000 : 0;
  const estimatedServerNow = serverMillis + ageMillis + 500;
  return Math.round(estimatedServerNow - (localStartMillis + localEndMillis) / 2);
}

export { normalizeRoomLayout };
