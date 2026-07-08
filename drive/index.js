/* global require, exports */

const { setGlobalOptions } = require("firebase-functions/v2");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { Buffer } = require("buffer");
const { google } = require("googleapis");
const { Readable } = require("stream");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10, region: "us-central1" });

const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const DRIVE_SETTINGS_PATH = "systemSettings/drive";
const DRIVE_ACTIVITY_LOGS_COLLECTION = "driveActivityLogs";
const DRIVE_PRIVATE_ITEMS_COLLECTION = "drivePrivateItems";
const DRIVE_SHARES_COLLECTION = "driveShares";
const DRIVE_USERS_FOLDER_NAME = "Usuarios";
const DRIVE_SHARE_ROLES = new Set(["viewer", "editor"]);
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const DRIVE_SEARCH_TYPES = new Set(["todos", "carpetas", "documentos", "imagenes", "videos", "pdf"]);
const DRIVE_UPLOAD_ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://sistema-desarrollo-proyectos.web.app",
  "https://sistema-desarrollo-proyectos.firebaseapp.com",
]);

let driveClientPromise;
let driveAuthClientPromise;

function getDriveAuthClient() {
  if (!driveAuthClientPromise) {
    const auth = new google.auth.GoogleAuth({
      scopes: [DRIVE_SCOPE],
    });

    driveAuthClientPromise = auth.getClient();
  }

  return driveAuthClientPromise;
}

function getDriveClient() {
  if (!driveClientPromise) {
    driveClientPromise = getDriveAuthClient().then((authClient) =>
      google.drive({
        version: "v3",
        auth: authClient,
      })
    );
  }

  return driveClientPromise;
}

async function assertAdmin(context) {
  const uid = context.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  }

  const profile = await getUserProfile(uid);

  if (!isAdmin(profile)) {
    throw new HttpsError("permission-denied", "Solo administradores pueden usar Nube AES.");
  }

  return profile;
}

async function getUserProfile(uid) {
  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  }

  const userSnapshot = await admin.firestore().doc(`users/${uid}`).get();

  if (!userSnapshot.exists) {
    throw new HttpsError("permission-denied", "Tu usuario no tiene perfil en Firestore.");
  }

  return {
    uid,
    id: userSnapshot.id,
    ...userSnapshot.data(),
  };
}

function isAdmin(profile) {
  return profile?.role === "admin";
}

function isCollaborator(profile) {
  return profile?.role === "collaborator";
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return normalizeString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map(normalizeString).filter(Boolean)
    : [];
}

function getUserDepartmentIds(profile) {
  return [
    ...normalizeStringArray(profile?.departmentIds),
    normalizeString(profile?.primaryDepartmentId),
  ].filter((value, index, array) => value && array.indexOf(value) === index);
}

function getUserDepartmentNames(profile) {
  return [
    ...normalizeStringArray(profile?.departmentNames),
    normalizeString(profile?.area),
    normalizeString(profile?.department),
    normalizeString(profile?.departmentName),
    normalizeString(profile?.team),
    ...normalizeStringArray(profile?.departments),
  ].filter((value, index, array) => value && array.indexOf(value) === index);
}

async function getAllowedDepartmentFolders(profile) {
  const db = admin.firestore();

  if (isAdmin(profile)) {
    const snapshot = await db.collection("driveDepartmentFolders").orderBy("departmentName", "asc").get();
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  }

  if (!isCollaborator(profile)) {
    return [];
  }

  const departmentIds = getUserDepartmentIds(profile);
  const departmentNames = getUserDepartmentNames(profile).map(normalizeText);
  const folders = new Map();

  await Promise.all(
    departmentIds.map(async (departmentId) => {
      const folderSnapshot = await db.collection("driveDepartmentFolders").doc(departmentId).get();

      if (folderSnapshot.exists) {
        folders.set(folderSnapshot.id, { id: folderSnapshot.id, ...folderSnapshot.data() });
      }
    })
  );

  if (departmentNames.length > 0) {
    const snapshot = await db.collection("driveDepartmentFolders").get();

    snapshot.docs.forEach((folderDoc) => {
      const folder = { id: folderDoc.id, ...folderDoc.data() };
      const folderName = normalizeText(folder.departmentName);

      if (departmentNames.includes(folderName)) {
        folders.set(folderDoc.id, folder);
      }
    });
  }

  return Array.from(folders.values()).sort((a, b) =>
    String(a.departmentName || "").localeCompare(String(b.departmentName || ""), "es")
  );
}

async function getUserPrivateRootId(uid) {
  const snapshot = await admin
    .firestore()
    .collection(DRIVE_PRIVATE_ITEMS_COLLECTION)
    .where("ownerUid", "==", uid)
    .where("isRoot", "==", true)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return "";
  }

  return snapshot.docs[0].id;
}

async function getSharedDriveRootIds(uid) {
  if (!uid) return [];

  const snapshot = await admin
    .firestore()
    .collection(DRIVE_SHARES_COLLECTION)
    .where("sharedWithUid", "==", uid)
    .get();

  return snapshot.docs
    .map((shareDoc) => normalizeString(shareDoc.data()?.itemId))
    .filter(Boolean);
}

function sanitizeUserFolderName(profile) {
  const base =
    normalizeString(profile?.displayName) ||
    normalizeString(profile?.name) ||
    normalizeString(profile?.email) ||
    profile.uid;

  return `${base} (${profile.uid.slice(0, 6)})`.slice(0, 120);
}

async function ensureUserPrivateRoot(profile) {
  const existingId = await getUserPrivateRootId(profile.uid);

  if (existingId) {
    return existingId;
  }

  const db = admin.firestore();
  const drive = await getDriveClient();
  const rootFolderId = await getRootFolderId();

  const usersFolder =
    (await findFolderByName(drive, rootFolderId, DRIVE_USERS_FOLDER_NAME)) ||
    (await createDriveFolder(drive, rootFolderId, DRIVE_USERS_FOLDER_NAME));

  const userFolder =
    (await findFolderByName(drive, usersFolder.id, profile.uid)) ||
    (await createDriveFolder(drive, usersFolder.id, profile.uid));

  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.collection(DRIVE_PRIVATE_ITEMS_COLLECTION).doc(userFolder.id).set(
    {
      fileId: userFolder.id,
      name: sanitizeUserFolderName(profile),
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      parentId: usersFolder.id,
      ownerUid: profile.uid,
      ownerName: getProfileName(profile),
      visibility: "private",
      isRoot: true,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  return userFolder.id;
}

async function getAuthorizedFolderRoots(profile) {
  const [privateRootId, sharedRootIds] = await Promise.all([
    getUserPrivateRootId(profile.uid),
    getSharedDriveRootIds(profile.uid),
  ]);

  if (isAdmin(profile)) {
    return [await getRootFolderId(), privateRootId, ...sharedRootIds].filter(Boolean);
  }

  if (!isCollaborator(profile)) {
    throw new HttpsError("permission-denied", "Tu rol no tiene acceso a Nube AES.");
  }

  const folders = await getAllowedDepartmentFolders(profile);
  const folderIds = folders.map((folder) => normalizeString(folder.folderId)).filter(Boolean);

  if (privateRootId) {
    folderIds.push(privateRootId);
  }

  folderIds.push(...sharedRootIds);

  if (folderIds.length === 0) {
    throw new HttpsError("permission-denied", "No tienes carpetas de departamento asignadas.");
  }

  return folderIds;
}

async function getShareRole({ itemId, uid }) {
  if (!itemId || !uid) return null;

  const snapshot = await admin
    .firestore()
    .collection(DRIVE_SHARES_COLLECTION)
    .where("itemId", "==", itemId)
    .where("sharedWithUid", "==", uid)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  return snapshot.docs[0].data()?.role || "viewer";
}

async function resolveFolderAccess(drive, folderId, allowedRootIds) {
  const allowed = new Set(allowedRootIds.filter(Boolean));
  const db = admin.firestore();
  const pending = [folderId];
  const visited = new Set();
  let depth = 0;
  let privacyRootId = null;
  let ownerUid = null;

  while (pending.length > 0 && depth < 30) {
    const currentId = pending.shift();

    if (!currentId || visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    depth += 1;

    if (privacyRootId === null) {
      const privateDoc = await db.collection(DRIVE_PRIVATE_ITEMS_COLLECTION).doc(currentId).get();

      if (privateDoc.exists) {
        privacyRootId = currentId;
        ownerUid = privateDoc.data()?.ownerUid || null;
      }
    }

    if (allowed.has(currentId)) {
      return { insideAllowedRoot: true, privacyRootId, ownerUid, matchedRootId: currentId };
    }

    try {
      const response = await drive.files.get({
        fileId: currentId,
        fields: "id,parents",
        supportsAllDrives: true,
      });

      const parents = Array.isArray(response.data.parents) ? response.data.parents : [];
      pending.push(...parents);
    } catch {
      return { insideAllowedRoot: false, privacyRootId, ownerUid, matchedRootId: "" };
    }
  }

  return { insideAllowedRoot: false, privacyRootId, ownerUid, matchedRootId: "" };
}

async function assertCanAccessDriveFolder({ profile, drive, folderId, requireWrite = true }) {
  const cleanFolderId = requireString(folderId, "folderId");
  const allowedRootIds = await getAuthorizedFolderRoots(profile);
  const access = await resolveFolderAccess(drive, cleanFolderId, allowedRootIds);

  if (!access.insideAllowedRoot) {
    throw new HttpsError("permission-denied", "No tienes permiso para acceder a esta carpeta de Nube AES.");
  }

  if (access.privacyRootId && access.ownerUid !== profile.uid) {
    const role =
      (await getShareRole({ itemId: access.privacyRootId, uid: profile.uid })) ||
      (await getShareRole({ itemId: access.matchedRootId, uid: profile.uid }));

    if (!role) {
      throw new HttpsError("permission-denied", "No tienes acceso a este elemento privado de Nube AES.");
    }

    if (requireWrite && role !== "editor") {
      throw new HttpsError("permission-denied", "Solo puedes ver este elemento compartido.");
    }
  }

  return cleanFolderId;
}

function requireString(value, fieldName) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) {
    throw new HttpsError("invalid-argument", `Falta ${fieldName}.`);
  }

  return cleanValue;
}

function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function getDriveTypeQuery(type) {
  const cleanType = String(type || "todos").trim().toLowerCase();

  if (!DRIVE_SEARCH_TYPES.has(cleanType)) {
    throw new HttpsError("invalid-argument", "Filtro de busqueda no valido.");
  }

  if (cleanType === "carpetas") {
    return `mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`;
  }

  if (cleanType === "documentos") {
    return [
      "mimeType contains 'document'",
      "mimeType contains 'spreadsheet'",
      "mimeType contains 'presentation'",
      "mimeType = 'text/plain'",
      "mimeType = 'application/msword'",
      "mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
      "mimeType = 'application/vnd.ms-excel'",
      "mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'",
      "mimeType = 'application/vnd.ms-powerpoint'",
      "mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'",
    ].join(" or ");
  }

  if (cleanType === "imagenes") {
    return "mimeType contains 'image/'";
  }

  if (cleanType === "videos") {
    return "mimeType contains 'video/'";
  }

  if (cleanType === "pdf") {
    return "mimeType = 'application/pdf'";
  }

  return "";
}

function buildDriveSearchQuery({ query, type }) {
  const conditions = ["trashed = false"];
  const cleanQuery = String(query || "").trim().slice(0, 120);
  const typeQuery = getDriveTypeQuery(type);

  if (cleanQuery) {
    const escapedQuery = escapeDriveQueryValue(cleanQuery);
    conditions.push(`(name contains '${escapedQuery}' or fullText contains '${escapedQuery}')`);
  }

  if (typeQuery) {
    conditions.push(`(${typeQuery})`);
  }

  return conditions.join(" and ");
}

function normalizeDriveFile(file) {
  return {
    id: file.id || "",
    name: file.name || "",
    mimeType: file.mimeType || "",
    webViewLink: file.webViewLink || "",
    iconLink: file.iconLink || "",
    thumbnailLink: file.thumbnailLink || "",
    modifiedTime: file.modifiedTime || "",
    size: file.size || "",
    parents: Array.isArray(file.parents) ? file.parents : [],
    trashed: Boolean(file.trashed),
  };
}

async function enrichDriveFilesWithPrivateMetadata(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  const db = admin.firestore();

  return Promise.all(
    files.map(async (file) => {
      if (!file?.id) return file;

      const snapshot = await db.collection(DRIVE_PRIVATE_ITEMS_COLLECTION).doc(file.id).get();

      if (!snapshot.exists) {
        return file;
      }

      const metadata = snapshot.data() || {};

      return {
        ...file,
        ownerUid: metadata.ownerUid || metadata.createdByUid || "",
        ownerName: metadata.ownerName || metadata.createdByName || "",
        visibility: metadata.visibility || "private",
        isPrivate: metadata.visibility === "private" || Boolean(metadata.ownerUid),
        isPrivateRoot: metadata.isRoot === true,
      };
    })
  );
}

function getProfileName(profile) {
  return (
    normalizeString(profile?.displayName) ||
    normalizeString(profile?.name) ||
    normalizeString(profile?.fullName) ||
    normalizeString(profile?.userName) ||
    normalizeString(profile?.email) ||
    "Usuario"
  );
}

function getProfileEmail(profile) {
  return normalizeString(profile?.email) || normalizeString(profile?.userEmail);
}

function normalizeShareableUser(userDoc) {
  const data = userDoc.data() || {};
  const departmentIds = normalizeStringArray(data.departmentIds);
  const departmentNames = normalizeStringArray(data.departmentNames);
  const departmentId =
    normalizeString(data.primaryDepartmentId) ||
    normalizeString(data.departmentId) ||
    departmentIds[0] ||
    "";
  const departmentName =
    normalizeString(data.primaryDepartmentName) ||
    normalizeString(data.departmentName) ||
    normalizeString(data.area) ||
    departmentNames[0] ||
    "";

  return {
    uid: userDoc.id,
    id: userDoc.id,
    name: normalizeString(data.name) || normalizeString(data.displayName) || normalizeString(data.fullName),
    email: normalizeString(data.email),
    role: normalizeString(data.role) || "collaborator",
    departmentId,
    departmentName,
  };
}

function cleanActivityMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return Object.entries(metadata).reduce((cleanMetadata, [key, value]) => {
    if (value === undefined || value === null) {
      return cleanMetadata;
    }

    if (typeof value === "string") {
      cleanMetadata[key] = value.slice(0, 300);
      return cleanMetadata;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      cleanMetadata[key] = value;
      return cleanMetadata;
    }

    if (Array.isArray(value)) {
      cleanMetadata[key] = value.slice(0, 10).map((item) => String(item || "").slice(0, 120));
      return cleanMetadata;
    }

    return cleanMetadata;
  }, {});
}

async function logDriveActivity({
  uid,
  profile,
  action,
  fileId = "",
  fileName = "",
  folderId = "",
  metadata = {},
}) {
  try {
    const cleanUid = normalizeString(uid);
    const cleanAction = normalizeString(action);

    if (!cleanUid || !cleanAction) {
      return;
    }

    const activityProfile = profile || (await getUserProfile(cleanUid));

    await admin.firestore().collection(DRIVE_ACTIVITY_LOGS_COLLECTION).add({
      uid: cleanUid,
      userName: getProfileName(activityProfile),
      userEmail: getProfileEmail(activityProfile),
      action: cleanAction,
      fileId: normalizeString(fileId),
      fileName: normalizeString(fileName),
      folderId: normalizeString(folderId),
      metadata: cleanActivityMetadata(metadata),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.warn("No se pudo registrar actividad de Drive.", error?.message || error);
  }
}

function normalizeDriveActivityLog(snapshot) {
  const data = snapshot.data() || {};
  const createdAt = data.createdAt?.toMillis ? data.createdAt.toMillis() : null;

  return {
    id: snapshot.id,
    uid: data.uid || "",
    userName: data.userName || "",
    userEmail: data.userEmail || "",
    action: data.action || "",
    fileId: data.fileId || "",
    fileName: data.fileName || "",
    folderId: data.folderId || "",
    metadata: data.metadata && typeof data.metadata === "object" ? data.metadata : {},
    createdAt,
  };
}

function normalizeBase64(value) {
  return String(value || "").replace(/^data:[^;]+;base64,/, "").trim();
}

function getBase64Buffer(base64) {
  const cleanBase64 = normalizeBase64(base64);

  if (!cleanBase64) {
    throw new HttpsError("invalid-argument", "Falta base64.");
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64)) {
    throw new HttpsError("invalid-argument", "base64 no es valido.");
  }

  const buffer = Buffer.from(cleanBase64, "base64");

  if (!buffer.length) {
    throw new HttpsError("invalid-argument", "Archivo vacio.");
  }

  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new HttpsError("resource-exhausted", "El archivo supera el limite de 25MB.");
  }

  return buffer;
}

function getDriveUploadError(error) {
  if (error instanceof HttpsError) {
    return error;
  }

  const status = error?.code || error?.response?.status;

  if (status === 403) {
    return new HttpsError(
      "permission-denied",
      "La cuenta de servicio no tiene permiso para subir archivos en esta carpeta."
    );
  }

  if (status === 404) {
    return new HttpsError("not-found", "No se encontro la carpeta destino en Google Drive.");
  }

  return new HttpsError(
    "internal",
    "No se pudo subir el archivo a Google Drive.",
    { message: error?.message || "" }
  );
}

function getDriveResumableUploadError(error) {
  if (error instanceof HttpsError) {
    return error;
  }

  const status = error?.code || error?.response?.status;

  if (status === 403) {
    return new HttpsError(
      "permission-denied",
      "La cuenta de servicio no tiene permiso para crear la sesion de subida en esta carpeta."
    );
  }

  if (status === 404) {
    return new HttpsError("not-found", "No se encontro la carpeta destino en Google Drive.");
  }

  return new HttpsError(
    "internal",
    "No se pudo preparar la subida grande en Google Drive.",
    { message: error?.message || "" }
  );
}

function requireUploadSize(value) {
  const size = Number(value);

  if (!Number.isFinite(size) || size < 0 || !Number.isSafeInteger(size)) {
    throw new HttpsError("invalid-argument", "El tamano del archivo no es valido.");
  }

  return size;
}

function normalizeMimeType(value) {
  const mimeType = String(value || "application/octet-stream").trim() || "application/octet-stream";

  if (/[\r\n]/.test(mimeType)) {
    throw new HttpsError("invalid-argument", "mimeType no es valido.");
  }

  return mimeType.slice(0, 180);
}

function getAllowedDriveUploadOrigins() {
  const origins = new Set(DRIVE_UPLOAD_ALLOWED_ORIGINS);
  const envOrigins = String(process.env.DRIVE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  envOrigins.forEach((origin) => origins.add(origin));
  return origins;
}

function getValidatedDriveUploadOrigin(request) {
  const origin = String(request.rawRequest?.headers?.origin || "").trim();

  if (!origin) {
    return "";
  }

  if (!getAllowedDriveUploadOrigins().has(origin)) {
    throw new HttpsError("permission-denied", "Origen no autorizado para subida a Drive.");
  }

  return origin;
}

async function getDriveAccessToken() {
  const authClient = await getDriveAuthClient();
  const tokenResponse = await authClient.getAccessToken();
  const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;

  if (!token) {
    throw new HttpsError("internal", "No se pudo obtener token para Google Drive.");
  }

  return token;
}

function getDriveMutationError(error, fallbackMessage) {
  if (error instanceof HttpsError) {
    return error;
  }

  const status = error?.code || error?.response?.status;

  if (status === 403) {
    return new HttpsError("permission-denied", "No tienes permiso para modificar este elemento de Drive.");
  }

  if (status === 404) {
    return new HttpsError("not-found", "No se encontro el elemento de Google Drive.");
  }

  return new HttpsError("internal", fallbackMessage, { message: error?.message || "" });
}

function getDriveSearchError(error) {
  if (error instanceof HttpsError) {
    return error;
  }

  const status = error?.code || error?.response?.status;

  if (status === 403) {
    return new HttpsError("permission-denied", "No tienes permiso para buscar en estas carpetas de Drive.");
  }

  if (status === 404) {
    return new HttpsError("not-found", "No se encontro la carpeta para buscar en Google Drive.");
  }

  return new HttpsError("internal", "No se pudo buscar en Google Drive.", { message: error?.message || "" });
}

async function getRootFolderId() {
  const settingsSnapshot = await admin.firestore().doc(DRIVE_SETTINGS_PATH).get();
  const rootFolderId = String(settingsSnapshot.data()?.rootFolderId || "").trim();

  if (!rootFolderId) {
    throw new HttpsError("failed-precondition", "Falta systemSettings/drive.rootFolderId.");
  }

  return rootFolderId;
}

async function findFolderByName(drive, parentId, name) {
  const response = await drive.files.list({
    q:
      `'${escapeDriveQueryValue(parentId)}' in parents and ` +
      `mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and ` +
      `name = '${escapeDriveQueryValue(name)}' and trashed = false`,
    fields: "files(id,name,webViewLink)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return response.data.files?.[0] || null;
}

async function createDriveFolder(drive, parentId, name) {
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      parents: [parentId],
    },
    fields: "id,name,webViewLink",
    supportsAllDrives: true,
  });

  return response.data;
}

async function getDriveItem(drive, fileId) {
  const response = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size,parents,trashed",
    supportsAllDrives: true,
  });

  return normalizeDriveFile(response.data || {});
}

async function getDriveRootContainer(drive, rootFolderId) {
  const response = await drive.files.get({
    fileId: rootFolderId,
    fields: "id,driveId",
    supportsAllDrives: true,
  });

  return {
    rootFolderId: response.data.id || rootFolderId,
    driveId: response.data.driveId || "",
  };
}

async function assertCanAccessDriveItem({ profile, drive, fileId, requireWrite = true }) {
  const cleanFileId = requireString(fileId, "fileId");
  const allowedRootIds = await getAuthorizedFolderRoots(profile);
  const access = await resolveFolderAccess(drive, cleanFileId, allowedRootIds);

  if (!access.insideAllowedRoot) {
    throw new HttpsError("permission-denied", "No tienes permiso para modificar este elemento de Nube AES.");
  }

  if (access.privacyRootId && access.ownerUid !== profile.uid) {
    const role =
      (await getShareRole({ itemId: access.privacyRootId, uid: profile.uid })) ||
      (await getShareRole({ itemId: access.matchedRootId, uid: profile.uid }));

    if (!role) {
      throw new HttpsError("permission-denied", "No tienes acceso a este elemento privado de Nube AES.");
    }

    if (requireWrite && role !== "editor") {
      throw new HttpsError("permission-denied", "Solo puedes ver este elemento compartido.");
    }
  }

  return cleanFileId;
}

async function ensureOwnedPrivateShareTarget({ drive, fileId, profile }) {
  const cleanFileId = requireString(fileId, "fileId");
  const access = await resolveFolderAccess(drive, cleanFileId, []);
  const item = await getDriveItem(drive, cleanFileId);
  let canSharePrivateTarget = access.privacyRootId && access.ownerUid === profile.uid;

  if (!canSharePrivateTarget && !access.privacyRootId) {
    const privateRootId = await getUserPrivateRootId(profile.uid);
    if (privateRootId) {
      const privateAccess = await resolveFolderAccess(drive, cleanFileId, [privateRootId]);
      canSharePrivateTarget = privateAccess.insideAllowedRoot;
    }
  }

  if (!canSharePrivateTarget && !access.privacyRootId && isAdmin(profile)) {
    await assertCanAccessDriveItem({ profile, drive, fileId: cleanFileId, requireWrite: false });
    return item;
  }

  if (!canSharePrivateTarget) {
    throw new HttpsError("permission-denied", "Solo el propietario puede compartir este elemento.");
  }

  const now = admin.firestore.FieldValue.serverTimestamp();

  await admin
    .firestore()
    .collection(DRIVE_PRIVATE_ITEMS_COLLECTION)
    .doc(cleanFileId)
    .set(
      {
        fileId: cleanFileId,
        name: item.name || "",
        mimeType: item.mimeType || "",
        parentId: item.parents[0] || "",
        ownerUid: profile.uid,
        ownerName: getProfileName(profile),
        visibility: "private",
        updatedAt: now,
      },
      { merge: true }
    );

  return item;
}

async function getSearchAllowedRoots({ profile, drive, folderId }) {
  const cleanFolderId = String(folderId || "").trim();

  if (!cleanFolderId) {
    return getAuthorizedFolderRoots(profile);
  }

  await assertCanAccessDriveFolder({ profile, drive, folderId: cleanFolderId, requireWrite: false });
  return [cleanFolderId];
}

async function filterFilesInsideRoots({ drive, files, allowedRootIds, profile }) {
  const filtered = [];

  for (const file of files) {
    const access = await resolveFolderAccess(drive, file.id, allowedRootIds);

    if (!access.insideAllowedRoot) {
      continue;
    }

    if (access.privacyRootId && access.ownerUid !== profile.uid) {
      const role = await getShareRole({ itemId: access.privacyRootId, uid: profile.uid });

      if (!role) {
        continue;
      }
    }

    filtered.push(file);
  }

  return filtered;
}

async function getDrivePrivateMetadata(fileId) {
  if (!fileId) return {};

  const snapshot = await admin.firestore().collection(DRIVE_PRIVATE_ITEMS_COLLECTION).doc(fileId).get();
  return snapshot.exists ? snapshot.data() || {} : {};
}

async function getTrashEditorRole({ access, fileId, uid }) {
  const itemIds = [
    fileId,
    access?.privacyRootId,
    access?.matchedRootId,
  ].filter((value, index, array) => value && array.indexOf(value) === index);

  for (const itemId of itemIds) {
    const role = await getShareRole({ itemId, uid });

    if (role) {
      return role;
    }
  }

  return null;
}

async function getTrashAllowedRootIds(profile, requestedFolderId, drive) {
  if (requestedFolderId) {
    await assertCanAccessDriveFolder({ profile, drive, folderId: requestedFolderId, requireWrite: false });
    return [requestedFolderId];
  }

  try {
    return await getAuthorizedFolderRoots(profile);
  } catch {
    return [];
  }
}

async function canAccessTrashedFile({ drive, file, profile, allowedRootIds }) {
  const uid = profile.uid;
  const metadata = await getDrivePrivateMetadata(file.id);

  if (metadata.deletedByUid === uid) {
    return true;
  }

  const access = await resolveFolderAccess(drive, file.id, allowedRootIds);
  const ownerUid = metadata.ownerUid || metadata.createdByUid || access.ownerUid || "";

  if (ownerUid === uid && (access.insideAllowedRoot || metadata.ownerUid === uid || metadata.createdByUid === uid)) {
    return true;
  }

  const role = await getTrashEditorRole({ access, fileId: file.id, uid });
  return role === "editor";
}

async function filterTrashFilesForProfile({ drive, files, profile, rootFolderId, requestedFolderId }) {
  if (isAdmin(profile)) {
    const allowedRootIds = requestedFolderId ? [requestedFolderId] : [rootFolderId];
    return filterFilesInsideRoots({ drive, files, allowedRootIds, profile });
  }

  const allowedRootIds = await getTrashAllowedRootIds(profile, requestedFolderId, drive);
  const filtered = [];

  for (const file of files) {
    if (await canAccessTrashedFile({ drive, file, profile, allowedRootIds })) {
      filtered.push(file);
    }
  }

  return filtered;
}

async function markDriveItemDeleted({ fileId, item, profile }) {
  const now = admin.firestore.FieldValue.serverTimestamp();

  await admin
    .firestore()
    .collection(DRIVE_PRIVATE_ITEMS_COLLECTION)
    .doc(fileId)
    .set(
      {
        fileId,
        name: item.name || "",
        mimeType: item.mimeType || "",
        parentId: item.parents?.[0] || "",
        deletedByUid: profile.uid,
        deletedByName: getProfileName(profile),
        deletedAt: now,
        trashed: true,
        updatedAt: now,
      },
      { merge: true }
    );
}

async function assertCanRestoreTrashedItem({ drive, fileId, profile }) {
  const cleanFileId = requireString(fileId, "fileId");

  if (isAdmin(profile)) {
    return assertCanAccessDriveItem({ profile, drive, fileId: cleanFileId, requireWrite: false });
  }

  const allowedRootIds = await getTrashAllowedRootIds(profile, "", drive);
  const item = await getDriveItem(drive, cleanFileId);

  if (await canAccessTrashedFile({ drive, file: item, profile, allowedRootIds })) {
    return cleanFileId;
  }

  throw new HttpsError("permission-denied", "No tienes permiso para restaurar este elemento.");
}

exports.driveListFolder = onCall(async (request) => {
  const uid = request.auth?.uid;

  const profile = await getUserProfile(uid);
  const drive = await getDriveClient();
  const folderId = await assertCanAccessDriveFolder({
    profile,
    drive,
    folderId: request.data?.folderId,
    requireWrite: false,
  });
  const files = [];
  let pageToken;

  do {
    const response = await drive.files.list({
      q: `'${escapeDriveQueryValue(folderId)}' in parents and trashed = false`,
      fields:
        "nextPageToken, files(id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size,parents)",
      orderBy: "folder,name_natural",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    files.push(...(response.data.files || []).map(normalizeDriveFile));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return { folderId, files: await enrichDriveFilesWithPrivateMetadata(files) };
});

exports.driveGetStorageQuota = onCall(async (request) => {
  await getUserProfile(request.auth?.uid);

  try {
    const drive = await getDriveClient();
    const response = await drive.about.get({
      fields: "storageQuota",
    });
    const storageQuota = response.data?.storageQuota || {};

    return {
      available: Boolean(storageQuota.usage || storageQuota.limit || storageQuota.usageInDrive),
      usage: storageQuota.usage || "",
      limit: storageQuota.limit || "",
      usageInDrive: storageQuota.usageInDrive || "",
      usageInDriveTrash: storageQuota.usageInDriveTrash || "",
    };
  } catch (error) {
    const status = error?.code || error?.response?.status;

    if (status === 403 || status === 404) {
      return {
        available: false,
        usage: "",
        limit: "",
        usageInDrive: "",
        usageInDriveTrash: "",
      };
    }

    throw new HttpsError("internal", "No se pudo obtener almacenamiento de Google Drive.", {
      message: error?.message || "",
    });
  }
});

exports.driveCreateFolder = onCall(async (request) => {
  const uid = request.auth?.uid;

  const profile = await getUserProfile(uid);
  const drive = await getDriveClient();
  const parentId = await assertCanAccessDriveFolder({
    profile,
    drive,
    folderId: request.data?.parentId,
  });
  const name = requireString(request.data?.name, "name");

  const folder = await createDriveFolder(drive, parentId, name);

  await logDriveActivity({
    uid,
    profile,
    action: "create_folder",
    fileId: folder.id,
    fileName: folder.name,
    folderId: parentId,
    metadata: { parentId },
  });

  return {
    id: folder.id || "",
    name: folder.name || "",
    webViewLink: folder.webViewLink || "",
  };
});

exports.driveUploadFile = onCall(async (request) => {
  const uid = request.auth?.uid;

  try {
    const profile = await getUserProfile(uid);
    const drive = await getDriveClient();
    const folderId = await assertCanAccessDriveFolder({
      profile,
      drive,
      folderId: request.data?.folderId,
    });
    const name = requireString(request.data?.name, "name");
    const mimeType = String(request.data?.mimeType || "application/octet-stream").trim();
    const fileBuffer = getBase64Buffer(request.data?.base64);

    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType,
        parents: [folderId],
      },
      media: {
        mimeType,
        body: Readable.from(fileBuffer),
      },
      fields: "id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size,parents",
      supportsAllDrives: true,
    });
    const uploadedFile = normalizeDriveFile(response.data || {});

    await logDriveActivity({
      uid,
      profile,
      action: "upload_file",
      fileId: uploadedFile.id,
      fileName: uploadedFile.name,
      folderId,
      metadata: {
        mimeType,
        size: uploadedFile.size || fileBuffer.length,
      },
    });

    return uploadedFile;
  } catch (error) {
    throw getDriveUploadError(error);
  }
});

exports.driveCreateResumableUpload = onCall(async (request) => {
  const uid = request.auth?.uid;

  try {
    const profile = await getUserProfile(uid);
    const drive = await getDriveClient();
    const folderId = await assertCanAccessDriveFolder({
      profile,
      drive,
      folderId: request.data?.folderId,
    });
    const name = requireString(request.data?.name, "name");
    const mimeType = normalizeMimeType(request.data?.mimeType);
    const size = requireUploadSize(request.data?.size);
    const validatedOrigin = getValidatedDriveUploadOrigin(request);
    const accessToken = await getDriveAccessToken();
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(size),
    };

    if (validatedOrigin) {
      headers.Origin = validatedOrigin;
    }

    const response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name,
          parents: [folderId],
        }),
      }
    );
    const uploadUrl = response.headers.get("location") || "";

    if (!response.ok || !uploadUrl) {
      throw new HttpsError(
        response.status === 403 ? "permission-denied" : "internal",
        "Google Drive no devolvio una sesion de subida valida.",
        { status: response.status }
      );
    }

    await logDriveActivity({
      uid,
      profile,
      action: "upload_started",
      fileName: name,
      folderId,
      metadata: {
        mimeType,
        size,
      },
    });

    return {
      uploadUrl,
      sessionExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };
  } catch (error) {
    throw getDriveResumableUploadError(error);
  }
});

exports.driveRenameItem = onCall(async (request) => {
  try {
    const profile = await getUserProfile(request.auth?.uid);
    const drive = await getDriveClient();
    const fileId = await assertCanAccessDriveItem({
      profile,
      drive,
      fileId: request.data?.fileId,
    });
    const name = requireString(request.data?.name, "name");
    const currentItem = await getDriveItem(drive, fileId);

    const response = await drive.files.update({
      fileId,
      requestBody: { name },
      fields: "id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size,parents",
      supportsAllDrives: true,
    });
    const renamedItem = normalizeDriveFile(response.data || {});

    await logDriveActivity({
      uid: request.auth?.uid,
      profile,
      action: "rename_item",
      fileId,
      fileName: renamedItem.name,
      folderId: renamedItem.parents[0] || currentItem.parents[0] || "",
      metadata: {
        previousName: currentItem.name,
        newName: renamedItem.name,
      },
    });

    return renamedItem;
  } catch (error) {
    throw getDriveMutationError(error, "No se pudo renombrar el elemento en Google Drive.");
  }
});

exports.driveMoveItem = onCall(async (request) => {
  try {
    const profile = await getUserProfile(request.auth?.uid);
    const drive = await getDriveClient();
    const fileId = await assertCanAccessDriveItem({
      profile,
      drive,
      fileId: request.data?.fileId,
    });
    const targetFolderId = await assertCanAccessDriveFolder({
      profile,
      drive,
      folderId: request.data?.targetFolderId,
    });
    const currentItem = await getDriveItem(drive, fileId);
    const previousParents = currentItem.parents.join(",");

    const response = await drive.files.update({
      fileId,
      addParents: targetFolderId,
      removeParents: previousParents || undefined,
      fields: "id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size,parents",
      supportsAllDrives: true,
    });
    const movedItem = normalizeDriveFile(response.data || {});

    await logDriveActivity({
      uid: request.auth?.uid,
      profile,
      action: "move_item",
      fileId,
      fileName: movedItem.name,
      folderId: targetFolderId,
      metadata: {
        previousParents: currentItem.parents,
        targetFolderId,
      },
    });

    return movedItem;
  } catch (error) {
    throw getDriveMutationError(error, "No se pudo mover el elemento en Google Drive.");
  }
});

exports.driveDeleteItem = onCall(async (request) => {
  try {
    const profile = await getUserProfile(request.auth?.uid);
    const drive = await getDriveClient();
    const fileId = await assertCanAccessDriveItem({
      profile,
      drive,
      fileId: request.data?.fileId,
    });

    const response = await drive.files.update({
      fileId,
      requestBody: { trashed: true },
      fields: "id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size,parents",
      supportsAllDrives: true,
    });
    const deletedItem = normalizeDriveFile(response.data || {});
    await markDriveItemDeleted({ fileId, item: deletedItem, profile });

    await logDriveActivity({
      uid: request.auth?.uid,
      profile,
      action: "delete_item",
      fileId,
      fileName: deletedItem.name,
      folderId: deletedItem.parents[0] || "",
      metadata: {
        trashed: true,
        deletedByUid: profile.uid,
      },
    });

    return deletedItem;
  } catch (error) {
    throw getDriveMutationError(error, "No se pudo enviar el elemento a la papelera.");
  }
});

exports.driveListTrash = onCall(async (request) => {
  try {
    const profile = await getUserProfile(request.auth?.uid);
    const drive = await getDriveClient();
    const rootFolderId = await getRootFolderId();
    const requestedFolderId = String(request.data?.folderId || "").trim();

    if (requestedFolderId && isAdmin(profile)) {
      await assertCanAccessDriveFolder({ profile, drive, folderId: requestedFolderId, requireWrite: false });
    }

    const rootContainer = await getDriveRootContainer(drive, rootFolderId);
    const files = [];
    let pageToken;
    let pagesRead = 0;

    do {
      const listParams = {
        q: "trashed = true",
        fields:
          "nextPageToken, files(id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size,parents,trashed)",
        orderBy: "modifiedTime desc",
        pageSize: 100,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      };

      if (rootContainer.driveId) {
        listParams.corpora = "drive";
        listParams.driveId = rootContainer.driveId;
      }

      const response = await drive.files.list({
        ...listParams,
      });
      const pageFiles = (response.data.files || []).map(normalizeDriveFile);
      const allowedFiles = await filterTrashFilesForProfile({
        drive,
        files: pageFiles,
        profile,
        rootFolderId,
        requestedFolderId,
      });

      files.push(...allowedFiles);
      pageToken = response.data.nextPageToken;
      pagesRead += 1;
    } while (pageToken && files.length < 100 && pagesRead < 10);

    return { folderId: rootFolderId, files: files.slice(0, 100) };
  } catch (error) {
    throw getDriveMutationError(error, "No se pudo cargar la papelera de Google Drive.");
  }
});

exports.driveRestoreItem = onCall(async (request) => {
  try {
    const profile = await getUserProfile(request.auth?.uid);
    const drive = await getDriveClient();
    const fileId = await assertCanRestoreTrashedItem({
      profile,
      drive,
      fileId: request.data?.fileId,
    });

    const response = await drive.files.update({
      fileId,
      requestBody: { trashed: false },
      fields: "id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size,parents,trashed",
      supportsAllDrives: true,
    });
    const restoredItem = normalizeDriveFile(response.data || {});
    const now = admin.firestore.FieldValue.serverTimestamp();

    await admin
      .firestore()
      .collection(DRIVE_PRIVATE_ITEMS_COLLECTION)
      .doc(fileId)
      .set(
        {
          deletedByUid: admin.firestore.FieldValue.delete(),
          deletedByName: admin.firestore.FieldValue.delete(),
          deletedAt: admin.firestore.FieldValue.delete(),
          restoredByUid: profile.uid,
          restoredByName: getProfileName(profile),
          restoredAt: now,
          trashed: false,
          updatedAt: now,
        },
        { merge: true }
      );

    await logDriveActivity({
      uid: request.auth?.uid,
      profile,
      action: "restore_item",
      fileId,
      fileName: restoredItem.name,
      folderId: restoredItem.parents[0] || "",
      metadata: {
        trashed: false,
        restoredByUid: profile.uid,
      },
    });

    return restoredItem;
  } catch (error) {
    throw getDriveMutationError(error, "No se pudo restaurar el elemento desde la papelera.");
  }
});

exports.driveLogResumableUploadCompleted = onCall(async (request) => {
  try {
    const profile = await getUserProfile(request.auth?.uid);
    const drive = await getDriveClient();
    const folderId = await assertCanAccessDriveFolder({
      profile,
      drive,
      folderId: request.data?.folderId,
    });
    const fileId = normalizeString(request.data?.fileId);

    if (fileId) {
      await assertCanAccessDriveItem({ profile, drive, fileId });
    }

    await logDriveActivity({
      uid: request.auth?.uid,
      profile,
      action: "upload_completed",
      fileId,
      fileName: requireString(request.data?.name, "name"),
      folderId,
      metadata: {
        mimeType: normalizeMimeType(request.data?.mimeType),
        size: requireUploadSize(request.data?.size),
      },
    });

    return { logged: true };
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError("internal", "No se pudo registrar la subida completada.", {
      message: error?.message || "",
    });
  }
});

exports.driveListActivityLogs = onCall(async (request) => {
  try {
    const profile = await getUserProfile(request.auth?.uid);

    const limitCount = Math.max(1, Math.min(100, Number(request.data?.limitCount || 50)));
    const folderId = normalizeString(request.data?.folderId);
    const fileId = normalizeString(request.data?.fileId);
    const drive = fileId || folderId ? await getDriveClient() : null;

    if (fileId) {
      await assertCanAccessDriveItem({ profile, drive, fileId, requireWrite: false });
    } else if (folderId) {
      await assertCanAccessDriveFolder({ profile, drive, folderId, requireWrite: false });
    } else if (!isAdmin(profile)) {
      throw new HttpsError("permission-denied", "La actividad de Nube AES esta disponible solo para administradores.");
    }

    const snapshot = await admin
      .firestore()
      .collection(DRIVE_ACTIVITY_LOGS_COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(folderId || fileId ? Math.min(300, limitCount * 6) : limitCount)
      .get();
    const logs = snapshot.docs
      .map(normalizeDriveActivityLog)
      .filter((log) => (!folderId || log.folderId === folderId) && (!fileId || log.fileId === fileId))
      .slice(0, limitCount);

    return { logs };
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError("internal", "No se pudo cargar la actividad de Nube AES.", {
      message: error?.message || "",
    });
  }
});

exports.driveSearchFiles = onCall(async (request) => {
  try {
    const profile = await getUserProfile(request.auth?.uid);
    const drive = await getDriveClient();
    const allowedRootIds = await getSearchAllowedRoots({
      profile,
      drive,
      folderId: request.data?.folderId,
    });
    const searchQuery = buildDriveSearchQuery({
      query: request.data?.query,
      type: request.data?.type,
    });
    const results = [];
    let pageToken;
    let pagesRead = 0;

    do {
      const response = await drive.files.list({
        q: searchQuery,
        fields:
          "nextPageToken, files(id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size,parents)",
        orderBy: "folder,modifiedTime desc,name_natural",
        pageSize: 100,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      const files = (response.data.files || []).map(normalizeDriveFile);
      const allowedFiles = await filterFilesInsideRoots({ drive, files, allowedRootIds, profile });

      results.push(...allowedFiles);
      pageToken = response.data.nextPageToken;
      pagesRead += 1;
    } while (pageToken && results.length < 100 && pagesRead < 5);

    return {
      files: results.slice(0, 100),
      query: String(request.data?.query || "").trim().slice(0, 120),
      type: String(request.data?.type || "todos").trim().toLowerCase(),
    };
  } catch (error) {
    throw getDriveSearchError(error);
  }
});

exports.driveEnsureDepartmentFolders = onCall(async (request) => {
  await assertAdmin(request);

  const db = admin.firestore();
  const [rootFolderId, departmentsSnapshot] = await Promise.all([
    getRootFolderId(),
    db.collection("departments").where("active", "==", true).get(),
  ]);
  const drive = await getDriveClient();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const results = [];

  for (const departmentDoc of departmentsSnapshot.docs) {
    const department = departmentDoc.data();

    if (department.deleted === true) {
      continue;
    }

    const departmentName = String(department.name || "").trim();

    if (!departmentName) {
      continue;
    }

    const folderRef = db.collection("driveDepartmentFolders").doc(departmentDoc.id);
    const folderSnapshot = await folderRef.get();
    const existingFolderId = String(folderSnapshot.data()?.folderId || "").trim();
    let folderId = existingFolderId;
    let folderName = String(folderSnapshot.data()?.folderName || departmentName).trim();
    let webViewLink = String(folderSnapshot.data()?.webViewLink || "").trim();
    let created = false;

    if (!folderId) {
      const existingFolder = await findFolderByName(drive, rootFolderId, departmentName);
      const folder = existingFolder || (await createDriveFolder(drive, rootFolderId, departmentName));

      folderId = folder.id || "";
      folderName = folder.name || departmentName;
      webViewLink = folder.webViewLink || "";
      created = !existingFolder;
    }

    const payload = {
      departmentId: departmentDoc.id,
      departmentName,
      folderId,
      folderName,
      webViewLink,
      updatedAt: now,
    };

    if (!folderSnapshot.exists) {
      payload.createdAt = now;
    }

    await folderRef.set(payload, { merge: true });

    results.push({
      ...payload,
      created,
      createdAt: null,
      updatedAt: null,
    });
  }

  return {
    rootFolderId,
    count: results.length,
    folders: results,
  };
});

exports.driveListAllowedDepartmentFolders = onCall(async (request) => {
  const profile = await getUserProfile(request.auth?.uid);
  const folders = await getAllowedDepartmentFolders(profile);

  return {
    isAdmin: isAdmin(profile),
    folders: folders.map((folder) => ({
      id: folder.id || folder.departmentId || "",
      departmentId: folder.departmentId || folder.id || "",
      departmentName: folder.departmentName || "",
      folderId: folder.folderId || "",
      folderName: folder.folderName || "",
      webViewLink: folder.webViewLink || "",
    })),
  };
});

exports.driveListMyDrive = onCall(async (request) => {
  const profile = await getUserProfile(request.auth?.uid);
  const drive = await getDriveClient();
  const folderId = await ensureUserPrivateRoot(profile);
  const files = [];
  let pageToken;

  do {
    const response = await drive.files.list({
      q: `'${escapeDriveQueryValue(folderId)}' in parents and trashed = false`,
      fields:
        "nextPageToken, files(id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size,parents)",
      orderBy: "folder,name_natural",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    files.push(...(response.data.files || []).map(normalizeDriveFile));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return { folderId, files: await enrichDriveFilesWithPrivateMetadata(files) };
});

exports.driveCreatePrivateFolder = onCall(async (request) => {
  const uid = request.auth?.uid;

  const profile = await getUserProfile(uid);
  const drive = await getDriveClient();
  const privateRootId = await ensureUserPrivateRoot(profile);
  const requestedParentId = normalizeString(request.data?.parentId) || privateRootId;
  const name = requireString(request.data?.name, "name");

  const parentId =
    requestedParentId === privateRootId
      ? privateRootId
      : await assertCanAccessDriveFolder({ profile, drive, folderId: requestedParentId, requireWrite: true });

  const folder = await createDriveFolder(drive, parentId, name);
  const now = admin.firestore.FieldValue.serverTimestamp();

  await admin
    .firestore()
    .collection(DRIVE_PRIVATE_ITEMS_COLLECTION)
    .doc(folder.id)
    .set({
      fileId: folder.id,
      name: folder.name || name,
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      parentId,
      ownerUid: profile.uid,
      ownerName: getProfileName(profile),
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });

  await logDriveActivity({
    uid,
    profile,
    action: "create_private_folder",
    fileId: folder.id,
    fileName: folder.name,
    folderId: parentId,
    metadata: { parentId },
  });

  return {
    id: folder.id || "",
    name: folder.name || "",
    webViewLink: folder.webViewLink || "",
  };
});

exports.driveListShareableUsers = onCall(async (request) => {
  const profile = await getUserProfile(request.auth?.uid);

  if (!isAdmin(profile) && !isCollaborator(profile)) {
    throw new HttpsError("permission-denied", "No tienes permiso para listar colaboradores.");
  }

  const snapshot = await admin.firestore().collection("users").get();
  const users = snapshot.docs
    .filter((userDoc) => userDoc.id !== profile.uid)
    .filter((userDoc) => {
      const data = userDoc.data() || {};
      return data.active !== false && data.deleted !== true;
    })
    .map(normalizeShareableUser)
    .sort((left, right) =>
      (left.name || left.email || "").localeCompare(right.name || right.email || "", "es")
    );

  return { users };
});

exports.driveShareItem = onCall(async (request) => {
  const uid = request.auth?.uid;

  const profile = await getUserProfile(uid);
  const drive = await getDriveClient();
  const fileId = requireString(request.data?.fileId, "fileId");
  const sharedWithUid = requireString(request.data?.sharedWithUid, "sharedWithUid");
  const role = normalizeString(request.data?.role).toLowerCase();

  if (!DRIVE_SHARE_ROLES.has(role)) {
    throw new HttpsError("invalid-argument", "El rol debe ser viewer o editor.");
  }

  if (sharedWithUid === uid) {
    throw new HttpsError("invalid-argument", "No puedes compartir contigo mismo.");
  }

  const item = await ensureOwnedPrivateShareTarget({ drive, fileId, profile });

  const sharedProfile = await getUserProfile(sharedWithUid);
  const db = admin.firestore();
  const shareId = `${fileId}_${sharedWithUid}`;
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.collection(DRIVE_SHARES_COLLECTION).doc(shareId).set(
    {
      itemId: fileId,
      fileId,
      fileName: item.name || "",
      sharedWithUid,
      sharedWithEmail: getProfileEmail(sharedProfile),
      role,
      sharedByUid: uid,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  await logDriveActivity({
    uid,
    profile,
    action: "share_item",
    fileId,
    fileName: item.name || "",
    folderId: item.parents?.[0] || "",
    metadata: { sharedWithUid, role },
  });

  return { shareId, itemId: fileId, sharedWithUid, role };
});

exports.driveUnshareItem = onCall(async (request) => {
  const uid = request.auth?.uid;

  const profile = await getUserProfile(uid);
  const drive = await getDriveClient();
  const fileId = requireString(request.data?.fileId, "fileId");
  const sharedWithUid = requireString(request.data?.sharedWithUid, "sharedWithUid");

  await ensureOwnedPrivateShareTarget({ drive, fileId, profile });

  await admin
    .firestore()
    .collection(DRIVE_SHARES_COLLECTION)
    .doc(`${fileId}_${sharedWithUid}`)
    .delete();

  return { removed: true };
});

exports.driveListSharedWithMe = onCall(async (request) => {
  try {
    const uid = request.auth?.uid;

    await getUserProfile(uid);
    const drive = await getDriveClient();
    const db = admin.firestore();

    const snapshot = await db
      .collection(DRIVE_SHARES_COLLECTION)
      .where("sharedWithUid", "==", uid)
      .get();

    const shareDocs = snapshot.docs.sort((a, b) => {
      const left = a.data()?.createdAt?.toMillis?.() || 0;
      const right = b.data()?.createdAt?.toMillis?.() || 0;
      return right - left;
    });
    const items = [];

    for (const shareDoc of shareDocs) {
      const share = shareDoc.data();

      try {
        const item = await getDriveItem(drive, share.itemId);

        if (item.trashed) {
          continue;
        }

        items.push({
          ...item,
          shareRole: share.role || "viewer",
          sharedByUid: share.sharedByUid || "",
        });
      } catch (error) {
        console.warn("No se pudo cargar elemento compartido:", share.itemId, error?.message || error);
      }
    }

    return { items };
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    console.error("No se pudieron cargar compartidos conmigo:", error);
    throw new HttpsError("internal", "No se pudieron cargar los archivos compartidos contigo.");
  }
});

exports.driveListItemShares = onCall(async (request) => {
  const uid = request.auth?.uid;

  const profile = await getUserProfile(uid);
  const drive = await getDriveClient();
  const fileId = requireString(request.data?.fileId, "fileId");

  await assertCanAccessDriveItem({ profile, drive, fileId, requireWrite: false });

  const snapshot = await admin
    .firestore()
    .collection(DRIVE_SHARES_COLLECTION)
    .where("itemId", "==", fileId)
    .get();

  return {
    shares: snapshot.docs.map((shareDoc) => ({ id: shareDoc.id, ...shareDoc.data() })),
  };
});
