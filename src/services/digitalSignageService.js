import {
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
import { db, storage } from "./firebase";
import { importDriveFileToSignageStorage } from "./driveService";

const ASSETS_COLLECTION = "digitalSignageAssets";
const PLAYLISTS_COLLECTION = "digitalSignagePlaylists";
const DEVICES_COLLECTION = "digitalSignageDevices";
const CAMPAIGNS_COLLECTION = "digitalSignageCampaigns";
const PAIRING_SESSIONS_COLLECTION = "digitalSignagePairingSessions";
const VISUAL_TEMPLATES_COLLECTION = "digitalSignageVisualTemplates";
const ASSET_STORAGE_ROOT = "digital-signage/assets";
const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const TEMPLATE_KEYS = ["aviso", "promocion", "evento", "coffee", "bienvenida"];
const TEMPLATE_THEMES = ["azul", "verde", "dorado", "rojo", "cafe"];
const ASSET_TYPES = ["image", "video", "web", "template", "visual_ad"];
const VISUAL_TEMPLATE_CATEGORIES = ["institucional", "promocion", "aviso", "coffee", "evento", "otro"];
const ASSET_CATEGORIES = VISUAL_TEMPLATE_CATEGORIES;
const PUBLISH_STATUSES = ["draft", "review", "published", "archived"];
const WEB_MODES = ["iframe", "redirect"];
const WEB_COMMAND_TYPES = ["reload", "refresh-url"];

function assertAdminUser(user) {
  if (user?.role !== "admin") {
    throw new Error("Solo administradores pueden gestionar Digital Signage.");
  }
}

function cleanText(value = "") {
  return String(value || "").trim();
}

function cleanDuration(value) {
  const duration = Number(value);

  if (!Number.isFinite(duration) || duration <= 0) {
    return 10;
  }

  return Math.min(Math.round(duration), 3600);
}

function cleanFileName(fileName = "archivo") {
  return String(fileName || "archivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140) || "archivo";
}

function getAssetTypeFromFile(file) {
  if (file?.type?.startsWith("video/")) return "video";
  return "image";
}

function getUserName(user) {
  return user?.name || user?.displayName || user?.email || "Administrador";
}

function getUserId(user) {
  return user?.uid || user?.id || "";
}

function normalizeAssetDocument(documentSnapshot) {
  return {
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  };
}

function normalizePlaylistDocument(documentSnapshot) {
  const data = documentSnapshot.data();

  return {
    id: documentSnapshot.id,
    ...data,
    items: normalizePlaylistItems(data.items),
  };
}

function normalizeDeviceDocument(documentSnapshot) {
  return {
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  };
}

function normalizePairingSessionDocument(documentSnapshot) {
  return {
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  };
}

function normalizeCampaignDocument(documentSnapshot) {
  const data = documentSnapshot.data();

  return {
    id: documentSnapshot.id,
    ...data,
    schedule: normalizeCampaignSchedule(data.schedule),
  };
}

function normalizeVisualTemplateDocument(documentSnapshot) {
  const data = documentSnapshot.data();

  return {
    id: documentSnapshot.id,
    ...data,
    visualAdData: normalizeVisualAdData(data.visualAdData),
  };
}

function normalizePlaylistItems(items = []) {
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

function cleanTemplateKey(value) {
  return TEMPLATE_KEYS.includes(value) ? value : "aviso";
}

function cleanTemplateTheme(value) {
  return TEMPLATE_THEMES.includes(value) ? value : "azul";
}

function cleanVisualTemplateCategory(value) {
  return VISUAL_TEMPLATE_CATEGORIES.includes(value) ? value : "otro";
}

function cleanAssetCategory(value) {
  return ASSET_CATEGORIES.includes(value) ? value : "otro";
}

function cleanPublishStatus(value, fallback = "published") {
  return PUBLISH_STATUSES.includes(value) ? value : fallback;
}

function cleanWebSettings(settings = {}) {
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

function cleanTags(value = []) {
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

function normalizeTemplateData(data = {}) {
  return {
    title: cleanText(data?.title),
    subtitle: cleanText(data?.subtitle),
    body: cleanText(data?.body),
    footer: cleanText(data?.footer),
    cta: cleanText(data?.cta),
  };
}

function cleanHexColor(value, fallback = "#0f4fc4") {
  const cleanValue = cleanText(value);
  return /^#[0-9a-fA-F]{6}$/.test(cleanValue) ? cleanValue : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function clampDecimal(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function normalizeVisualElement(element = {}, index = 0) {
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

function normalizeVisualAdData(data = {}) {
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

function isValidVisualAdData(visualAdData) {
  const canvas = visualAdData?.canvas || {};
  const hasBackground =
    canvas.backgroundType === "solid" ||
    (canvas.backgroundType === "image" && Boolean(canvas.backgroundUrl));
  const hasElements = Array.isArray(visualAdData?.elements) && visualAdData.elements.length > 0;
  return hasBackground || hasElements;
}

function clearVisualAdStorageReferences(visualAdData) {
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

function normalizeCampaignSchedule(schedule = {}) {
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

function cleanTime(value = "") {
  const cleanValue = cleanText(value);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(cleanValue) ? cleanValue : "";
}

function timeToMinutes(value = "") {
  const [hours, minutes] = cleanTime(value).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return -1;
  return hours * 60 + minutes;
}

function validateCampaignSchedule(schedule) {
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

function normalizeCampaignPayload(data = {}) {
  const schedule = normalizeCampaignSchedule(data.schedule);
  validateCampaignSchedule(schedule);

  return {
    name: cleanText(data.name),
    plantel: cleanText(data.plantel),
    playlistId: cleanText(data.playlistId),
    priority: ["urgente", "alta", "normal"].includes(data.priority)
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

async function getOrderedCollection(collectionName) {
  const snapshot = await getDocs(
    query(collection(db, collectionName), orderBy("createdAt", "desc"))
  );

  return snapshot.docs;
}

export async function uploadSignageAsset(file, data, user) {
  assertAdminUser(user);

  if (!file) {
    throw new Error("Selecciona una imagen o video.");
  }

  const title = cleanText(data?.title) || cleanText(file.name);
  const plantel = cleanText(data?.plantel);

  if (!title) {
    throw new Error("El titulo es obligatorio.");
  }

  if (!plantel) {
    throw new Error("El plantel es obligatorio.");
  }

  const assetRef = doc(collection(db, ASSETS_COLLECTION));
  const fileName = cleanFileName(file.name);
  const storagePath = `${ASSET_STORAGE_ROOT}/${assetRef.id}/${fileName}`;
  const storageReference = ref(storage, storagePath);

  await uploadBytes(storageReference, file);
  const url = await getDownloadURL(storageReference);

  const payload = {
    title,
    type: getAssetTypeFromFile(file),
    url,
    storagePath,
    plantel,
    durationSeconds: cleanDuration(data?.durationSeconds),
    category: cleanAssetCategory(data?.category),
    tags: cleanTags(data?.tags),
    archived: data?.archived === true,
    active: data?.active !== false,
    publishStatus: cleanPublishStatus(data?.publishStatus),
    createdAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
    updatedAt: serverTimestamp(),
  };

  await setDoc(assetRef, payload);

  return {
    id: assetRef.id,
    ...payload,
  };
}

export async function createWebAsset(data, user) {
  assertAdminUser(user);

  const title = cleanText(data?.title);
  const url = cleanText(data?.url);
  const plantel = cleanText(data?.plantel);

  if (!title || !url || !plantel) {
    throw new Error("Completa titulo, URL y plantel.");
  }

  const assetRef = doc(collection(db, ASSETS_COLLECTION));
  const payload = {
    title,
    type: "web",
    url,
    storagePath: "",
    plantel,
    durationSeconds: cleanDuration(data?.durationSeconds),
    webSettings: cleanWebSettings(data?.webSettings),
    category: cleanAssetCategory(data?.category),
    tags: cleanTags(data?.tags),
    archived: data?.archived === true,
    active: data?.active !== false,
    publishStatus: cleanPublishStatus(data?.publishStatus),
    createdAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
    updatedAt: serverTimestamp(),
  };

  await setDoc(assetRef, payload);

  return {
    id: assetRef.id,
    ...payload,
  };
}

export async function importSignageAssetFromDrive(driveFile, data, user) {
  assertAdminUser(user);

  const driveFileId = cleanText(driveFile?.id || data?.sourceFileId);
  const title = cleanText(data?.title) || cleanText(driveFile?.name);
  const plantel = cleanText(data?.plantel);

  if (!driveFileId) {
    throw new Error("Selecciona un archivo de Nube AES.");
  }

  if (!title) {
    throw new Error("El titulo es obligatorio.");
  }

  if (!plantel) {
    throw new Error("El plantel es obligatorio.");
  }

  const existingSnapshot = await getDocs(
    query(collection(db, ASSETS_COLLECTION), where("sourceFileId", "==", driveFileId), limit(1))
  );

  if (!existingSnapshot.empty) {
    throw new Error("Este archivo de Nube AES ya fue importado a Digital Signage.");
  }

  const assetRef = doc(collection(db, ASSETS_COLLECTION));
  const importedFile = await importDriveFileToSignageStorage({
    driveFileId,
    assetId: assetRef.id,
    filename: data?.filename || driveFile?.name || "",
  });

  const payload = {
    title,
    type: importedFile.type,
    url: importedFile.url,
    storagePath: importedFile.storagePath,
    plantel,
    durationSeconds: cleanDuration(data?.durationSeconds),
    category: cleanAssetCategory(data?.category),
    tags: cleanTags(data?.tags),
    archived: false,
    active: data?.active !== false,
    publishStatus: cleanPublishStatus(data?.publishStatus, "draft"),
    source: "nube_aes",
    sourceFileId: driveFileId,
    sourceFileName: cleanText(driveFile?.name || importedFile.fileName),
    sourceFileMimeType: cleanText(driveFile?.mimeType || importedFile.mimeType),
    sourceFileSize: cleanText(driveFile?.size || importedFile.size),
    sourceFolderId: cleanText(data?.sourceFolderId),
    sourceFolderName: cleanText(data?.sourceFolderName),
    importedAt: serverTimestamp(),
    importedBy: getUserName(user),
    importedById: getUserId(user),
    createdAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
    updatedAt: serverTimestamp(),
  };

  await setDoc(assetRef, payload);

  return {
    id: assetRef.id,
    ...payload,
  };
}

export async function createTemplateAsset(data, user) {
  assertAdminUser(user);

  const templateData = normalizeTemplateData(data?.templateData);
  const title = cleanText(data?.title) || templateData.title;
  const plantel = cleanText(data?.plantel);

  if (!title || !plantel) {
    throw new Error("Completa titulo y plantel.");
  }

  const assetRef = doc(collection(db, ASSETS_COLLECTION));
  const payload = {
    title,
    type: "template",
    url: "",
    storagePath: "",
    plantel,
    durationSeconds: cleanDuration(data?.durationSeconds),
    category: cleanAssetCategory(data?.category),
    tags: cleanTags(data?.tags),
    archived: data?.archived === true,
    active: data?.active !== false,
    publishStatus: cleanPublishStatus(data?.publishStatus),
    templateKey: cleanTemplateKey(data?.templateKey),
    templateData: {
      ...templateData,
      title,
    },
    templateTheme: cleanTemplateTheme(data?.templateTheme),
    createdAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
    updatedAt: serverTimestamp(),
  };

  await setDoc(assetRef, payload);

  return {
    id: assetRef.id,
    ...payload,
  };
}

export async function createVisualAdAsset(data, backgroundFile, user, elementFiles = {}) {
  assertAdminUser(user);

  const title = cleanText(data?.title);
  const plantel = cleanText(data?.plantel);

  if (!title || !plantel) {
    throw new Error("Completa titulo y plantel.");
  }

  const assetRef = doc(collection(db, ASSETS_COLLECTION));
  const rawVisualAdData = normalizeVisualAdData(data?.visualAdData);
  let backgroundUrl = rawVisualAdData.canvas.backgroundUrl;
  let backgroundStoragePath = rawVisualAdData.canvas.backgroundStoragePath;

  if (backgroundFile && rawVisualAdData.canvas.backgroundType === "image") {
    const fileName = cleanFileName(backgroundFile.name || "fondo");
    backgroundStoragePath = `${ASSET_STORAGE_ROOT}/${assetRef.id}/${fileName}`;
    const storageReference = ref(storage, backgroundStoragePath);

    await uploadBytes(storageReference, backgroundFile);
    backgroundUrl = await getDownloadURL(storageReference);
  }

  let visualAdData = normalizeVisualAdData({
    ...rawVisualAdData,
    canvas: {
      ...rawVisualAdData.canvas,
      backgroundUrl,
      backgroundStoragePath,
      backgroundType: backgroundUrl ? rawVisualAdData.canvas.backgroundType : "solid",
    },
  });

  visualAdData = await uploadVisualAdElementImages(assetRef.id, visualAdData, elementFiles);

  if (!isValidVisualAdData(visualAdData)) {
    throw new Error("Agrega un fondo o al menos un texto.");
  }

  const payload = {
    title,
    type: "visual_ad",
    url: "",
    storagePath: backgroundStoragePath || "",
    plantel,
    durationSeconds: cleanDuration(data?.durationSeconds),
    category: cleanAssetCategory(data?.category),
    tags: cleanTags(data?.tags),
    archived: data?.archived === true,
    active: data?.active !== false,
    publishStatus: cleanPublishStatus(data?.publishStatus, "draft"),
    visualAdData,
    createdAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
    updatedAt: serverTimestamp(),
  };

  await setDoc(assetRef, payload);

  return {
    id: assetRef.id,
    ...payload,
  };
}

export async function updateVisualAdAsset(id, data, backgroundFile, user, elementFiles = {}) {
  assertAdminUser(user);

  if (!id) throw new Error("Falta el ID del anuncio visual.");

  const title = cleanText(data?.title);
  const plantel = cleanText(data?.plantel);

  if (!title || !plantel) {
    throw new Error("Completa titulo y plantel.");
  }

  const assetRef = doc(db, ASSETS_COLLECTION, id);
  const snapshot = await getDoc(assetRef);
  const previousStoragePath = snapshot.exists() ? snapshot.data()?.storagePath || "" : "";
  const rawVisualAdData = normalizeVisualAdData(data?.visualAdData);
  let backgroundUrl = rawVisualAdData.canvas.backgroundUrl;
  let backgroundStoragePath = rawVisualAdData.canvas.backgroundStoragePath || previousStoragePath;

  if (rawVisualAdData.canvas.backgroundType === "solid") {
    backgroundUrl = "";
    backgroundStoragePath = "";
  }

  if (backgroundFile && rawVisualAdData.canvas.backgroundType === "image") {
    const fileName = cleanFileName(backgroundFile.name || "fondo");
    backgroundStoragePath = `${ASSET_STORAGE_ROOT}/${id}/${fileName}`;
    const storageReference = ref(storage, backgroundStoragePath);

    await uploadBytes(storageReference, backgroundFile);
    backgroundUrl = await getDownloadURL(storageReference);
  }

  if (previousStoragePath && previousStoragePath !== backgroundStoragePath) {
    await deleteObject(ref(storage, previousStoragePath)).catch(() => {});
  }

  let visualAdData = normalizeVisualAdData({
    ...rawVisualAdData,
    canvas: {
      ...rawVisualAdData.canvas,
      backgroundUrl,
      backgroundStoragePath,
      backgroundType: backgroundUrl ? rawVisualAdData.canvas.backgroundType : "solid",
    },
  });

  visualAdData = await uploadVisualAdElementImages(id, visualAdData, elementFiles);

  const nextElementStoragePaths = new Set(
    (visualAdData.elements || []).map((element) => element.storagePath).filter(Boolean)
  );
  const previousElementStoragePaths = snapshot.exists() && Array.isArray(snapshot.data()?.visualAdData?.elements)
    ? snapshot.data().visualAdData.elements.map((element) => element?.storagePath).filter(Boolean)
    : [];

  await Promise.allSettled(
    previousElementStoragePaths
      .filter((elementStoragePath) => !nextElementStoragePaths.has(elementStoragePath))
      .map((elementStoragePath) => deleteObject(ref(storage, elementStoragePath)))
  );

  if (!isValidVisualAdData(visualAdData)) {
    throw new Error("Agrega un fondo o al menos un texto.");
  }

  await updateDoc(assetRef, {
    title,
    type: "visual_ad",
    url: "",
    storagePath: backgroundStoragePath || "",
    plantel,
    durationSeconds: cleanDuration(data?.durationSeconds),
    active: data?.active !== false,
    visualAdData,
    updatedAt: serverTimestamp(),
  });
}

async function uploadVisualAdElementImages(assetId, visualAdData, elementFiles = {}) {
  const filesById = elementFiles && typeof elementFiles === "object" ? elementFiles : {};
  const elements = await Promise.all(
    (visualAdData.elements || []).map(async (element) => {
      if (element.type !== "image") return element;

      const imageFile = filesById[element.id];
      if (!imageFile) return element;

      const fileName = cleanFileName(imageFile.name || "elemento");
      const storagePath = `${ASSET_STORAGE_ROOT}/${assetId}/elements/${element.id}-${fileName}`;
      const storageReference = ref(storage, storagePath);

      await uploadBytes(storageReference, imageFile);
      const url = await getDownloadURL(storageReference);

      if (element.storagePath && element.storagePath !== storagePath) {
        await deleteObject(ref(storage, element.storagePath)).catch(() => {});
      }

      return {
        ...element,
        url,
        storagePath,
      };
    })
  );

  return {
    ...visualAdData,
    elements,
  };
}

export async function getSignageAssets() {
  const docs = await getOrderedCollection(ASSETS_COLLECTION);
  return docs.map(normalizeAssetDocument);
}

export async function updateSignageAsset(id, data) {
  if (!id) throw new Error("Falta el ID del asset.");

  const payload = {
    ...data,
    title: data?.title !== undefined ? cleanText(data.title) : data?.title,
    plantel: data?.plantel !== undefined ? cleanText(data.plantel) : data?.plantel,
    durationSeconds:
      data?.durationSeconds !== undefined
        ? cleanDuration(data.durationSeconds)
        : data?.durationSeconds,
    templateKey:
      data?.templateKey !== undefined ? cleanTemplateKey(data.templateKey) : data?.templateKey,
    templateData:
      data?.templateData !== undefined ? normalizeTemplateData(data.templateData) : data?.templateData,
    templateTheme:
      data?.templateTheme !== undefined ? cleanTemplateTheme(data.templateTheme) : data?.templateTheme,
    visualAdData:
      data?.visualAdData !== undefined ? normalizeVisualAdData(data.visualAdData) : data?.visualAdData,
    webSettings:
      data?.webSettings !== undefined ? cleanWebSettings(data.webSettings) : data?.webSettings,
    category:
      data?.category !== undefined ? cleanAssetCategory(data.category) : data?.category,
    tags:
      data?.tags !== undefined ? cleanTags(data.tags) : data?.tags,
    archived:
      data?.archived !== undefined ? data.archived === true : data?.archived,
    publishStatus:
      data?.publishStatus !== undefined ? cleanPublishStatus(data.publishStatus) : data?.publishStatus,
    updatedAt: serverTimestamp(),
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });

  await updateDoc(doc(db, ASSETS_COLLECTION, id), payload);

  if (
    payload.webSettings !== undefined ||
    payload.url !== undefined ||
    payload.title !== undefined ||
    payload.durationSeconds !== undefined
  ) {
    await syncWebAssetInPlaylists(id, {
      title: payload.title,
      url: payload.url,
      durationSeconds: payload.durationSeconds,
      webSettings: payload.webSettings,
    });
  }
}

export async function sendWebAssetCommand(assetId, command, user) {
  assertAdminUser(user);

  const cleanAssetId = cleanText(assetId);
  const commandType = cleanText(command?.type || "reload");

  if (!cleanAssetId) throw new Error("Falta el ID del asset web.");
  if (!WEB_COMMAND_TYPES.includes(commandType)) {
    throw new Error("Comando web no permitido.");
  }

  const assetRef = doc(db, ASSETS_COLLECTION, cleanAssetId);
  const snapshot = await getDoc(assetRef);

  if (!snapshot.exists() || snapshot.data()?.type !== "web") {
    throw new Error("Asset web no encontrado.");
  }

  const nextSettings = {
    ...cleanWebSettings(snapshot.data()?.webSettings),
    lastCommand: {
      type: commandType,
      createdAt: Timestamp.now(),
      createdBy: getUserName(user),
    },
  };

  await updateDoc(assetRef, {
    webSettings: nextSettings,
    updatedAt: serverTimestamp(),
  });
  await syncWebAssetInPlaylists(cleanAssetId, { webSettings: nextSettings });
}

async function syncWebAssetInPlaylists(assetId, updates = {}) {
  const docs = await getOrderedCollection(PLAYLISTS_COLLECTION);
  const cleanUpdates = {
    ...(updates.title !== undefined ? { title: cleanText(updates.title) } : {}),
    ...(updates.url !== undefined ? { url: cleanText(updates.url) } : {}),
    ...(updates.durationSeconds !== undefined ? { durationSeconds: cleanDuration(updates.durationSeconds) } : {}),
    ...(updates.webSettings !== undefined ? { webSettings: cleanWebSettings(updates.webSettings) } : {}),
  };

  if (Object.keys(cleanUpdates).length === 0) return;

  await Promise.all(
    docs
      .map((playlistSnapshot) => {
        const data = playlistSnapshot.data();
        const items = Array.isArray(data.items) ? data.items : [];
        const hasAsset = items.some((item) => item?.assetId === assetId && item?.type === "web");

        if (!hasAsset) return null;

        return updateDoc(doc(db, PLAYLISTS_COLLECTION, playlistSnapshot.id), {
          items: normalizePlaylistItems(
            items.map((item) =>
              item?.assetId === assetId && item?.type === "web"
                ? { ...item, ...cleanUpdates }
                : item
            )
          ),
          updatedAt: serverTimestamp(),
        });
      })
      .filter(Boolean)
  );
}

export async function deleteSignageAsset(id) {
  if (!id) throw new Error("Falta el ID del asset.");

  const assetRef = doc(db, ASSETS_COLLECTION, id);
  const snapshot = await getDoc(assetRef);

  if (snapshot.exists()) {
    const data = snapshot.data();
    const storagePath = data?.storagePath;
    const visualElements = Array.isArray(data?.visualAdData?.elements)
      ? data.visualAdData.elements
      : [];

    if (storagePath) {
      await deleteObject(ref(storage, storagePath)).catch(() => {});
    }

    await Promise.allSettled(
      visualElements
        .map((element) => element?.storagePath)
        .filter(Boolean)
        .map((elementStoragePath) => deleteObject(ref(storage, elementStoragePath)))
    );
  }

  await deleteDoc(assetRef);
}

export async function duplicateSignageAsset(id, user) {
  assertAdminUser(user);
  if (!id) throw new Error("Falta el ID del asset.");

  const snapshot = await getDoc(doc(db, ASSETS_COLLECTION, id));
  if (!snapshot.exists()) throw new Error("No se encontrÃ³ el asset.");

  const data = snapshot.data();
  const assetRef = doc(collection(db, ASSETS_COLLECTION));
  const visualAdData = data.type === "visual_ad"
    ? clearVisualAdStorageReferences(normalizeVisualAdData(data.visualAdData))
    : undefined;
  const payload = {
    ...data,
    title: `${cleanText(data.title) || "Contenido"} copia`,
    storagePath: "",
    ...(visualAdData ? { visualAdData } : {}),
    archived: false,
    publishStatus: "draft",
    createdAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
    updatedAt: serverTimestamp(),
  };

  delete payload.id;

  await setDoc(assetRef, payload);

  return {
    id: assetRef.id,
    ...payload,
  };
}

export async function createVisualTemplate(data, user) {
  assertAdminUser(user);

  const name = cleanText(data?.name);
  const category = cleanVisualTemplateCategory(data?.category);
  const visualAdData = normalizeVisualAdData(data?.visualAdData);

  if (!name) {
    throw new Error("El nombre de la plantilla es obligatorio.");
  }

  if (!isValidVisualAdData(visualAdData)) {
    throw new Error("La plantilla necesita un diseño válido.");
  }

  const templateRef = doc(collection(db, VISUAL_TEMPLATES_COLLECTION));
  const payload = {
    name,
    category,
    description: cleanText(data?.description),
    visualAdData,
    thumbnailHint: cleanText(data?.thumbnailHint),
    active: data?.active !== false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
  };

  await setDoc(templateRef, payload);

  return {
    id: templateRef.id,
    ...payload,
  };
}

export async function getVisualTemplates() {
  const docs = await getOrderedCollection(VISUAL_TEMPLATES_COLLECTION);
  return docs.map(normalizeVisualTemplateDocument);
}

export async function updateVisualTemplate(id, data) {
  if (!id) throw new Error("Falta el ID de la plantilla.");

  const payload = {
    ...data,
    name: data?.name !== undefined ? cleanText(data.name) : data?.name,
    category:
      data?.category !== undefined ? cleanVisualTemplateCategory(data.category) : data?.category,
    description:
      data?.description !== undefined ? cleanText(data.description) : data?.description,
    visualAdData:
      data?.visualAdData !== undefined ? normalizeVisualAdData(data.visualAdData) : data?.visualAdData,
    thumbnailHint:
      data?.thumbnailHint !== undefined ? cleanText(data.thumbnailHint) : data?.thumbnailHint,
    updatedAt: serverTimestamp(),
  };

  if (payload.name !== undefined && !payload.name) {
    throw new Error("El nombre de la plantilla es obligatorio.");
  }

  if (payload.visualAdData !== undefined && !isValidVisualAdData(payload.visualAdData)) {
    throw new Error("La plantilla necesita un diseño válido.");
  }

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });

  await updateDoc(doc(db, VISUAL_TEMPLATES_COLLECTION, id), payload);
}

export async function deleteVisualTemplate(id) {
  if (!id) throw new Error("Falta el ID de la plantilla.");
  await deleteDoc(doc(db, VISUAL_TEMPLATES_COLLECTION, id));
}

export async function createSignagePlaylist(data, user) {
  assertAdminUser(user);

  const name = cleanText(data?.name);
  const plantel = cleanText(data?.plantel);

  if (!name || !plantel) {
    throw new Error("Completa nombre y plantel.");
  }

  const playlistRef = doc(collection(db, PLAYLISTS_COLLECTION));
  const payload = {
    name,
    plantel,
    active: data?.active !== false,
    publishStatus: cleanPublishStatus(data?.publishStatus),
    items: normalizePlaylistItems(data?.items),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
  };

  await setDoc(playlistRef, payload);

  return {
    id: playlistRef.id,
    ...payload,
  };
}

export async function getSignagePlaylists() {
  const docs = await getOrderedCollection(PLAYLISTS_COLLECTION);
  return docs.map(normalizePlaylistDocument);
}

export async function updateSignagePlaylist(id, data) {
  if (!id) throw new Error("Falta el ID de la playlist.");

  const payload = {
    ...data,
    name: data?.name !== undefined ? cleanText(data.name) : data?.name,
    plantel: data?.plantel !== undefined ? cleanText(data.plantel) : data?.plantel,
    items: data?.items !== undefined ? normalizePlaylistItems(data.items) : data?.items,
    publishStatus:
      data?.publishStatus !== undefined ? cleanPublishStatus(data.publishStatus) : data?.publishStatus,
    updatedAt: serverTimestamp(),
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });

  await updateDoc(doc(db, PLAYLISTS_COLLECTION, id), payload);
}

export async function deleteSignagePlaylist(id) {
  if (!id) throw new Error("Falta el ID de la playlist.");
  await deleteDoc(doc(db, PLAYLISTS_COLLECTION, id));
}

export async function createSignageCampaign(data, user) {
  assertAdminUser(user);

  const payload = normalizeCampaignPayload(data);

  if (!payload.name || !payload.plantel || !payload.playlistId) {
    throw new Error("Completa nombre, plantel y playlist.");
  }

  if (!payload.startDate || !payload.endDate) {
    throw new Error("Completa fecha inicio y fecha fin.");
  }

  if (payload.endDate < payload.startDate) {
    throw new Error("La fecha fin debe ser posterior a la fecha inicio.");
  }

  const campaignRef = doc(collection(db, CAMPAIGNS_COLLECTION));
  const campaignPayload = {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
  };

  await setDoc(campaignRef, campaignPayload);

  return {
    id: campaignRef.id,
    ...campaignPayload,
  };
}

export async function getSignageCampaigns() {
  const docs = await getOrderedCollection(CAMPAIGNS_COLLECTION);
  return docs.map(normalizeCampaignDocument);
}

export async function updateSignageCampaign(id, data) {
  if (!id) throw new Error("Falta el ID de la campaña.");

  const payload =
    data?.schedule !== undefined ||
    data?.name !== undefined ||
    data?.plantel !== undefined ||
    data?.playlistId !== undefined ||
    data?.priority !== undefined ||
    data?.startDate !== undefined ||
    data?.endDate !== undefined ||
    data?.deviceIds !== undefined
      ? normalizeCampaignPayload(data)
      : { ...data };

  if (data?.publishStatus !== undefined) {
    payload.publishStatus = cleanPublishStatus(data.publishStatus);
  }

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });

  await updateDoc(doc(db, CAMPAIGNS_COLLECTION, id), {
    ...payload,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSignageCampaign(id) {
  if (!id) throw new Error("Falta el ID de la campaña.");
  await deleteDoc(doc(db, CAMPAIGNS_COLLECTION, id));
}

export function subscribeSignageCampaigns(callback, onError) {
  return onSnapshot(
    collection(db, CAMPAIGNS_COLLECTION),
    (snapshot) => {
      callback(snapshot.docs.map(normalizeCampaignDocument));
    },
    onError
  );
}

export async function createSignageDevice(data, user) {
  assertAdminUser(user);

  const name = cleanText(data?.name);
  const plantel = cleanText(data?.plantel);
  const location = cleanText(data?.location);

  if (!name || !plantel) {
    throw new Error("Completa nombre y plantel.");
  }

  const deviceToken = await createUniqueDeviceToken();
  const deviceRef = doc(db, DEVICES_COLLECTION, deviceToken);
  const payload = {
    name,
    plantel,
    location,
    deviceToken,
    assignedPlaylistId: cleanText(data?.assignedPlaylistId),
    active: data?.active !== false,
    lastSeenAt: null,
    lastSeenMillis: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
  };

  await setDoc(deviceRef, payload);

  return {
    id: deviceToken,
    ...payload,
  };
}

export async function createPairingSession() {
  const pairingRef = doc(collection(db, PAIRING_SESSIONS_COLLECTION));
  const code = generatePairingCode();
  const setupSecret = generateSessionSecret();
  const payload = {
    code,
    status: "pending",
    deviceToken: null,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + PAIRING_CODE_TTL_MS),
    claimedAt: null,
    claimedBy: "",
    userAgent:
      typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "",
    lastSeenAt: serverTimestamp(),
    setupSecret,
  };

  await setDoc(pairingRef, payload);

  return {
    id: pairingRef.id,
    ...payload,
  };
}

export function subscribePairingSession(sessionId, callback, onError) {
  const cleanSessionId = cleanText(sessionId);
  if (!cleanSessionId) return () => {};

  return onSnapshot(
    doc(db, PAIRING_SESSIONS_COLLECTION, cleanSessionId),
    (snapshot) => {
      callback(snapshot.exists() ? normalizePairingSessionDocument(snapshot) : null);
    },
    onError
  );
}

export async function updatePairingSessionHeartbeat(sessionId, setupSecret) {
  const cleanSessionId = cleanText(sessionId);
  const cleanSecret = cleanText(setupSecret);
  if (!cleanSessionId || !cleanSecret) return;

  await updateDoc(doc(db, PAIRING_SESSIONS_COLLECTION, cleanSessionId), {
    lastSeenAt: serverTimestamp(),
    setupSecret: cleanSecret,
  });
}

export async function claimPairingCode(code, deviceData, user) {
  assertAdminUser(user);

  const cleanCode = normalizePairingCode(code);
  const name = cleanText(deviceData?.name);
  const plantel = cleanText(deviceData?.plantel);
  const location = cleanText(deviceData?.location);
  const assignedPlaylistId = cleanText(deviceData?.assignedPlaylistId);

  if (!cleanCode) {
    throw new Error("Ingresa el codigo de vinculacion.");
  }

  if (!name || !plantel || !location) {
    throw new Error("Completa nombre, plantel y ubicacion.");
  }

  const pairingSnapshot = await getDocs(
    query(
      collection(db, PAIRING_SESSIONS_COLLECTION),
      where("code", "==", cleanCode),
      limit(10)
    )
  );
  const now = Date.now();
  const sessionDocument = pairingSnapshot.docs.find((candidate) => {
    const data = candidate.data();
    return isPairingSessionClaimable(data, now);
  });

  if (!sessionDocument) {
    throw new Error("Codigo invalido, expirado o ya usado.");
  }

  const deviceToken = await createUniqueDeviceToken();
  const deviceRef = doc(db, DEVICES_COLLECTION, deviceToken);
  const pairingRef = doc(db, PAIRING_SESSIONS_COLLECTION, sessionDocument.id);

  await runTransaction(db, async (transaction) => {
    const pairingDoc = await transaction.get(pairingRef);

    if (!pairingDoc.exists()) {
      throw new Error("Codigo no encontrado.");
    }

    const pairingData = pairingDoc.data();
    if (pairingData.status !== "pending") {
      throw new Error("Codigo ya usado.");
    }

    if (!isPairingSessionClaimable(pairingData, Date.now())) {
      throw new Error("Codigo expirado.");
    }

    transaction.set(deviceRef, {
      name,
      plantel,
      location,
      deviceToken,
      assignedPlaylistId,
      active: true,
      lastSeenAt: null,
      lastSeenMillis: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: getUserName(user),
      createdById: getUserId(user),
    });

    transaction.update(pairingRef, {
      status: "claimed",
      deviceToken,
      claimedAt: serverTimestamp(),
      claimedBy: getUserName(user),
      updatedAt: serverTimestamp(),
    });
  });

  return {
    id: deviceToken,
    deviceToken,
    name,
    plantel,
    location,
    assignedPlaylistId,
  };
}

export async function expireOldPairingSessions() {
  const snapshot = await getDocs(
    query(
      collection(db, PAIRING_SESSIONS_COLLECTION),
      where("status", "==", "pending"),
      limit(50)
    )
  );
  const now = Date.now();

  await Promise.all(
    snapshot.docs
      .filter((sessionDocument) => getTimestampMillis(sessionDocument.data().expiresAt) <= now)
      .map((sessionDocument) =>
        updateDoc(doc(db, PAIRING_SESSIONS_COLLECTION, sessionDocument.id), {
          status: "expired",
          updatedAt: serverTimestamp(),
        })
      )
  );
}

export async function getSignageDevices() {
  const docs = await getOrderedCollection(DEVICES_COLLECTION);
  return docs.map(normalizeDeviceDocument);
}

export async function updateSignageDevice(id, data) {
  if (!id) throw new Error("Falta el ID del dispositivo.");

  const payload = {
    ...data,
    name: data?.name !== undefined ? cleanText(data.name) : data?.name,
    plantel: data?.plantel !== undefined ? cleanText(data.plantel) : data?.plantel,
    location: data?.location !== undefined ? cleanText(data.location) : data?.location,
    assignedPlaylistId:
      data?.assignedPlaylistId !== undefined
        ? cleanText(data.assignedPlaylistId)
        : data?.assignedPlaylistId,
    updatedAt: serverTimestamp(),
  };

  delete payload.deviceToken;
  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });

  await updateDoc(doc(db, DEVICES_COLLECTION, id), payload);
}

export async function deleteSignageDevice(id) {
  if (!id) throw new Error("Falta el ID del dispositivo.");
  await deleteDoc(doc(db, DEVICES_COLLECTION, id));
}

export async function getDeviceByToken(deviceToken) {
  const cleanToken = cleanText(deviceToken);
  if (!cleanToken) return null;

  const snapshot = await getDoc(doc(db, DEVICES_COLLECTION, cleanToken));

  if (!snapshot.exists()) {
    return null;
  }

  return normalizeDeviceDocument(snapshot);
}

export function subscribeDeviceByToken(deviceToken, callback, onError) {
  const cleanToken = cleanText(deviceToken);
  if (!cleanToken) return () => {};

  return onSnapshot(
    doc(db, DEVICES_COLLECTION, cleanToken),
    (snapshot) => {
      callback(snapshot.exists() ? normalizeDeviceDocument(snapshot) : null);
    },
    onError
  );
}

export function subscribePlaylist(playlistId, callback, onError) {
  const cleanPlaylistId = cleanText(playlistId);
  if (!cleanPlaylistId) return () => {};

  return onSnapshot(
    doc(db, PLAYLISTS_COLLECTION, cleanPlaylistId),
    (snapshot) => {
      callback(snapshot.exists() ? normalizePlaylistDocument(snapshot) : null);
    },
    onError
  );
}

export async function updateDeviceHeartbeat(deviceId) {
  const cleanDeviceId = cleanText(deviceId);
  if (!cleanDeviceId) return;

  await updateDoc(doc(db, DEVICES_COLLECTION, cleanDeviceId), {
    lastSeenAt: serverTimestamp(),
    lastSeenMillis: Date.now(),
    updatedAt: serverTimestamp(),
  });
}

async function createUniqueDeviceToken() {
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

function generateSessionSecret() {
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

function normalizePairingCode(value = "") {
  const cleanValue = cleanText(value).toUpperCase().replace(/\s+/g, "");
  if (!cleanValue) return "";

  if (/^AES-\d{4,6}$/.test(cleanValue)) return cleanValue;
  if (/^AES\d{4,6}$/.test(cleanValue)) return cleanValue.replace(/^AES/, "AES-");
  if (/^\d{4,6}$/.test(cleanValue)) return `AES-${cleanValue}`;
  return cleanValue;
}

function getTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number(value) || 0;
}

function isPairingSessionClaimable(sessionData, now = Date.now()) {
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
