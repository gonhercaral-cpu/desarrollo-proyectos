import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  limit,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../firebase";
import { importDriveFileToSignageStorage } from "../driveService";
import {
  ASSET_CATEGORY_VALUES,
  ASSET_TYPES,
  CAMPAIGN_PRIORITIES,
  PLAYBACK_ASSET_TYPES,
  PLAYBACK_EVENT_TYPES,
  PLAYBACK_SOURCES,
  TEMPLATE_KEYS,
  TEMPLATE_THEMES,
  VISUAL_TEMPLATE_CATEGORY_VALUES,
  WEB_COMMAND_TYPES,
  WEB_MODES,
  normalizePublishStatus,
} from "../../utils/digitalSignage";

export const ASSETS_COLLECTION = "digitalSignageAssets";
export const PLAYLISTS_COLLECTION = "digitalSignagePlaylists";
export const DEVICES_COLLECTION = "digitalSignageDevices";
export const CAMPAIGNS_COLLECTION = "digitalSignageCampaigns";
export const PAIRING_SESSIONS_COLLECTION = "digitalSignagePairingSessions";
export const VISUAL_TEMPLATES_COLLECTION = "digitalSignageVisualTemplates";
export const AUDIT_LOGS_COLLECTION = "digitalSignageAuditLogs";
export const PLAYBACK_LOGS_COLLECTION = "digitalSignagePlaybackLogs";
export const ASSET_STORAGE_ROOT = "digital-signage/assets";
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export function assertAdminUser(user) {
  if (user?.role !== "admin") {
    throw new Error("Solo administradores pueden gestionar Digital Signage.");
  }
}

export function cleanText(value = "") {
  return String(value || "").trim();
}

export function cleanDuration(value) {
  const duration = Number(value);

  if (!Number.isFinite(duration) || duration <= 0) {
    return 10;
  }

  return Math.min(Math.round(duration), 3600);
}

export function cleanFileName(fileName = "archivo") {
  return String(fileName || "archivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140) || "archivo";
}

export function getAssetTypeFromFile(file) {
  if (file?.type?.startsWith("video/")) return "video";
  return "image";
}

export function getUserName(user) {
  return user?.name || user?.displayName || user?.email || "Administrador";
}

export function getUserId(user) {
  return user?.uid || user?.id || "";
}

export function normalizeAssetDocument(documentSnapshot) {
  return {
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  };
}

export function normalizePlaylistDocument(documentSnapshot) {
  const data = documentSnapshot.data();

  return {
    id: documentSnapshot.id,
    ...data,
    items: normalizePlaylistItems(data.items),
  };
}

export function normalizeDeviceDocument(documentSnapshot) {
  return {
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  };
}

export function normalizePairingSessionDocument(documentSnapshot) {
  return {
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  };
}

export function normalizeCampaignDocument(documentSnapshot) {
  const data = documentSnapshot.data();

  return {
    id: documentSnapshot.id,
    ...data,
    schedule: normalizeCampaignSchedule(data.schedule),
  };
}

export function normalizeVisualTemplateDocument(documentSnapshot) {
  const data = documentSnapshot.data();

  return {
    id: documentSnapshot.id,
    ...data,
    visualAdData: normalizeVisualAdData(data.visualAdData),
  };
}

export function normalizePlaylistItems(items = []) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      const type = ASSET_TYPES.includes(item?.type) ? item.type : "image";
      const templateData = normalizeTemplateData(item?.templateData);
      const visualAdData = normalizeVisualAdData(item?.visualAdData);

      return {
        assetId: cleanText(item?.assetId),
        title: cleanText(item?.title) || templateData.title || "Contenido sin titulo",
        type,
        url: cleanText(item?.url),
        durationSeconds: cleanDuration(item?.durationSeconds),
        publishStatus: cleanPublishStatus(item?.publishStatus),
        ...(type === "web"
          ? {
              webSettings: cleanWebSettings(item?.webSettings),
            }
          : {}),
        ...(type === "template"
          ? {
              templateKey: cleanTemplateKey(item?.templateKey),
              templateData,
              templateTheme: cleanTemplateTheme(item?.templateTheme),
            }
          : {}),
        ...(type === "visual_ad"
          ? {
              visualAdData,
            }
          : {}),
      };
    })
    .filter((item) => {
      if (!item.assetId) return false;
      if (item.type === "template") return Boolean(item.templateData.title || item.title);
      if (item.type === "visual_ad") return isValidVisualAdData(item.visualAdData);
      return Boolean(item.url);
    });
}

export function cleanTemplateKey(value) {
  return TEMPLATE_KEYS.includes(value) ? value : "aviso";
}

export function cleanTemplateTheme(value) {
  return TEMPLATE_THEMES.includes(value) ? value : "azul";
}

export function cleanVisualTemplateCategory(value) {
  return VISUAL_TEMPLATE_CATEGORY_VALUES.includes(value) ? value : "otro";
}

export function cleanAssetCategory(value) {
  return ASSET_CATEGORY_VALUES.includes(value) ? value : "otro";
}

export function cleanPublishStatus(value, fallback = "published") {
  return normalizePublishStatus(value, fallback);
}

export function cleanWebSettings(settings = {}) {
  const reloadIntervalSeconds = Number(settings?.reloadIntervalSeconds);
  const hasReloadInterval =
    Number.isFinite(reloadIntervalSeconds) && reloadIntervalSeconds > 0;
  const lastCommand = settings?.lastCommand || null;
  const cleanLastCommand =
    lastCommand && WEB_COMMAND_TYPES.includes(lastCommand.type)
      ? {
          type: lastCommand.type,
          createdAt: lastCommand.createdAt || null,
          createdBy: cleanText(lastCommand.createdBy),
        }
      : null;

  return {
    ...(hasReloadInterval
      ? { reloadIntervalSeconds: Math.min(Math.round(reloadIntervalSeconds), 86400) }
      : {}),
    zoom: clampNumber(settings?.zoom, 50, 150, 100),
    mode: WEB_MODES.includes(settings?.mode) ? settings.mode : "iframe",
    showStatusOverlay: settings?.showStatusOverlay === true,
    allowInteraction: settings?.allowInteraction === true,
    cacheBustOnReload: settings?.cacheBustOnReload === true,
    ...(cleanLastCommand ? { lastCommand: cleanLastCommand } : {}),
  };
}

export function cleanTags(value = []) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  return Array.from(
    new Set(
      source
        .map((tag) => cleanText(tag).toLowerCase())
        .filter(Boolean)
        .slice(0, 12)
    )
  );
}

export function normalizeTemplateData(data = {}) {
  return {
    title: cleanText(data?.title),
    subtitle: cleanText(data?.subtitle),
    body: cleanText(data?.body),
    footer: cleanText(data?.footer),
    cta: cleanText(data?.cta),
  };
}

export function cleanHexColor(value, fallback = "#0f4fc4") {
  const cleanValue = cleanText(value);
  return /^#[0-9a-fA-F]{6}$/.test(cleanValue) ? cleanValue : fallback;
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

export function clampDecimal(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

export function normalizeVisualElement(element = {}, index = 0) {
  const type = element.type === "image" ? "image" : "text";
  const baseElement = {
    id: cleanText(element.id) || `${type}-${Date.now()}-${index}`,
    type,
    x: clampNumber(element.x, 0, 100, 10),
    y: clampNumber(element.y, 0, 100, 10),
    width: clampNumber(element.width, 5, 100, type === "image" ? 30 : 50),
    locked: element.locked === true,
    rotation: clampNumber(element.rotation, -180, 180, 0),
    zIndex: clampNumber(element.zIndex, 0, 999, index + 1),
  };

  if (element.height !== undefined) {
    baseElement.height = clampNumber(element.height, 5, 100, 20);
  }

  if (type === "image") {
    return {
      ...baseElement,
      url: cleanText(element.url),
      storagePath: cleanText(element.storagePath),
      opacity: clampDecimal(element.opacity, 0, 1, 1),
      borderRadius: clampNumber(element.borderRadius, 0, 100, 0),
    };
  }

  return {
    ...baseElement,
    text: cleanText(element.text),
    fontSize: clampNumber(element.fontSize, 12, 160, 48),
    fontWeight: element.fontWeight === "bold" ? "bold" : "normal",
    color: cleanHexColor(element.color, "#ffffff"),
    align: ["left", "center", "right"].includes(element.align) ? element.align : "left",
  };
}

export function normalizeVisualAdData(data = {}) {
  const canvas = data?.canvas || {};
  const backgroundType = canvas.backgroundType === "image" ? "image" : "solid";
  const elements = Array.isArray(data?.elements)
    ? data.elements
        .map(normalizeVisualElement)
        .filter((element) => element.type === "image" ? Boolean(element.url) : Boolean(element.text))
    : [];

  return {
    canvas: {
      aspectRatio: "16:9",
      backgroundType,
      backgroundUrl: cleanText(canvas.backgroundUrl),
      backgroundStoragePath: cleanText(canvas.backgroundStoragePath),
      backgroundColor: cleanHexColor(canvas.backgroundColor, "#0f4fc4"),
    },
    elements,
  };
}

export function isValidVisualAdData(visualAdData) {
  const canvas = visualAdData?.canvas || {};
  const hasBackground =
    canvas.backgroundType === "solid" ||
    (canvas.backgroundType === "image" && Boolean(canvas.backgroundUrl));
  const hasElements = Array.isArray(visualAdData?.elements) && visualAdData.elements.length > 0;
  return hasBackground || hasElements;
}

export function clearVisualAdStorageReferences(visualAdData) {
  return {
    ...visualAdData,
    canvas: {
      ...visualAdData.canvas,
      backgroundStoragePath: "",
    },
    elements: (visualAdData.elements || []).map((element) => ({
      ...element,
      storagePath: "",
    })),
  };
}

export function normalizeCampaignSchedule(schedule = {}) {
  const enabled = schedule?.enabled === true;
  const daysOfWeek = Array.isArray(schedule?.daysOfWeek)
    ? Array.from(
        new Set(
          schedule.daysOfWeek
            .map((day) => Number(day))
            .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        )
      ).sort((a, b) => a - b)
    : [];
  const startTime = cleanTime(schedule?.startTime);
  const endTime = cleanTime(schedule?.endTime);

  return {
    enabled,
    daysOfWeek: enabled ? daysOfWeek : [],
    startTime: enabled ? startTime : "",
    endTime: enabled ? endTime : "",
    timezone: cleanText(schedule?.timezone) || "America/Tijuana",
  };
}

export function cleanTime(value = "") {
  const cleanValue = cleanText(value);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(cleanValue) ? cleanValue : "";
}

export function timeToMinutes(value = "") {
  const [hours, minutes] = cleanTime(value).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return -1;
  return hours * 60 + minutes;
}

export function validateCampaignSchedule(schedule) {
  if (schedule.enabled !== true) return;

  if (!schedule.daysOfWeek.length) {
    throw new Error("Selecciona al menos un dia para la programacion.");
  }

  if (!schedule.startTime || !schedule.endTime) {
    throw new Error("Completa hora inicio y hora fin.");
  }

  if (timeToMinutes(schedule.endTime) <= timeToMinutes(schedule.startTime)) {
    throw new Error("La hora fin debe ser posterior a la hora inicio.");
  }
}

export function normalizeCampaignPayload(data = {}) {
  const schedule = normalizeCampaignSchedule(data.schedule);
  validateCampaignSchedule(schedule);

  return {
    name: cleanText(data.name),
    plantel: cleanText(data.plantel),
    playlistId: cleanText(data.playlistId),
    priority: CAMPAIGN_PRIORITIES.includes(data.priority)
      ? data.priority
      : "normal",
    startDate: cleanText(data.startDate),
    endDate: cleanText(data.endDate),
    active: data.active !== false,
    publishStatus: cleanPublishStatus(data.publishStatus),
    deviceIds: Array.isArray(data.deviceIds)
      ? data.deviceIds.map(cleanText).filter(Boolean)
      : [],
    schedule,
  };
}

export async function getOrderedCollection(collectionName) {
  const snapshot = await getDocs(
    query(collection(db, collectionName), orderBy("createdAt", "desc"))
  );

  return snapshot.docs;
}

export function normalizeAuditDocument(documentSnapshot) {
  return {
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  };
}

export function normalizePlaybackLogDocument(documentSnapshot) {
  return {
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  };
}

export function cleanAuditValue(value) {
  if (value === null || value === undefined) return null;
  if (["number", "boolean"].includes(typeof value)) return value;
  if (typeof value === "string") return cleanText(value).slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 12).map(cleanAuditValue);
  if (typeof value === "object") return cleanAuditDetails(value);
  return cleanText(value).slice(0, 500);
}

export function cleanAuditDetails(details = {}) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};

  return Object.fromEntries(
    Object.entries(details)
      .slice(0, 25)
      .map(([key, value]) => [cleanText(key).slice(0, 60), cleanAuditValue(value)])
      .filter(([key]) => key)
  );
}

export function cleanPlaybackEvent(event = {}) {
  const eventType = cleanText(event.eventType);
  const assetType = cleanText(event.assetType);
  const source = cleanText(event.source);
  const durationSeconds = Number(event.durationSeconds);

  return {
    deviceId: cleanText(event.deviceId),
    deviceTokenHash: cleanText(event.deviceTokenHash),
    deviceName: cleanText(event.deviceName),
    plantel: cleanText(event.plantel),
    location: cleanText(event.location),
    eventType: PLAYBACK_EVENT_TYPES.includes(eventType) ? eventType : "play_error",
    assetId: cleanText(event.assetId),
    assetTitle: cleanText(event.assetTitle),
    assetType: PLAYBACK_ASSET_TYPES.includes(assetType) ? assetType : "",
    playlistId: cleanText(event.playlistId),
    playlistName: cleanText(event.playlistName),
    campaignId: cleanText(event.campaignId),
    campaignName: cleanText(event.campaignName),
    source: PLAYBACK_SOURCES.includes(source) ? source : "",
    durationSeconds:
      Number.isFinite(durationSeconds) && durationSeconds >= 0
        ? Math.min(Math.round(durationSeconds), 86400)
        : null,
    errorMessage: cleanText(event.errorMessage).slice(0, 300),
    localTimestamp: cleanText(event.localTimestamp).slice(0, 80),
    playerVersion: cleanText(event.playerVersion || "web-player-v1").slice(0, 60),
  };
}

export async function createUniqueDeviceToken() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateDeviceToken();
    const snapshot = await getDoc(doc(db, DEVICES_COLLECTION, token));

    if (!snapshot.exists()) {
      return token;
    }
  }

  throw new Error("No se pudo generar un token unico para el dispositivo.");
}

export function generateDeviceToken() {
  const bytes = new Uint8Array(32);

  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generatePairingCode() {
  const code = 100000 + Math.floor(Math.random() * 900000);
  return `AES-${code}`;
}

export function generateSessionSecret() {
  const bytes = new Uint8Array(16);

  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizePairingCode(value = "") {
  const cleanValue = cleanText(value).toUpperCase().replace(/\s+/g, "");
  if (!cleanValue) return "";

  if (/^AES-\d{4,6}$/.test(cleanValue)) return cleanValue;
  if (/^AES\d{4,6}$/.test(cleanValue)) return cleanValue.replace(/^AES/, "AES-");
  if (/^\d{4,6}$/.test(cleanValue)) return `AES-${cleanValue}`;
  return cleanValue;
}

export function getTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number(value) || 0;
}

export function isPairingSessionClaimable(sessionData, now = Date.now()) {
  const createdAt = getTimestampMillis(sessionData?.createdAt);
  const expiresAt = getTimestampMillis(sessionData?.expiresAt);
  const maxExpiresAt = createdAt + PAIRING_CODE_TTL_MS + 60 * 1000;

  return (
    sessionData?.status === "pending" &&
    createdAt > 0 &&
    createdAt <= now + 60 * 1000 &&
    expiresAt > now &&
    expiresAt <= maxExpiresAt
  );
}

export {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  limit,
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
  db,
  storage,
  importDriveFileToSignageStorage,
  ASSET_CATEGORY_VALUES,
  ASSET_TYPES,
  CAMPAIGN_PRIORITIES,
  PLAYBACK_ASSET_TYPES,
  PLAYBACK_EVENT_TYPES,
  PLAYBACK_SOURCES,
  TEMPLATE_KEYS,
  TEMPLATE_THEMES,
  VISUAL_TEMPLATE_CATEGORY_VALUES,
  WEB_COMMAND_TYPES,
  WEB_MODES,
  normalizePublishStatus
};
