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

async function getAuthorizedFolderRoots(profile) {
  if (isAdmin(profile)) {
    return [await getRootFolderId()];
  }

  if (!isCollaborator(profile)) {
    throw new HttpsError("permission-denied", "Tu rol no tiene acceso a Nube AES.");
  }

  const folders = await getAllowedDepartmentFolders(profile);
  const folderIds = folders.map((folder) => normalizeString(folder.folderId)).filter(Boolean);

  if (folderIds.length === 0) {
    throw new HttpsError("permission-denied", "No tienes carpetas de departamento asignadas.");
  }

  return folderIds;
}

async function assertCanAccessDriveFolder({ profile, drive, folderId }) {
  const cleanFolderId = requireString(folderId, "folderId");
  const allowedRootIds = await getAuthorizedFolderRoots(profile);
  const canAccess = await isFolderInsideAllowedRoots(drive, cleanFolderId, allowedRootIds);

  if (!canAccess) {
    throw new HttpsError("permission-denied", "No tienes permiso para acceder a esta carpeta de Nube AES.");
  }

  return cleanFolderId;
}

async function isFolderInsideAllowedRoots(drive, folderId, allowedRootIds) {
  const allowed = new Set(allowedRootIds.filter(Boolean));
  const pending = [folderId];
  const visited = new Set();
  let depth = 0;

  while (pending.length > 0 && depth < 30) {
    const currentId = pending.shift();

    if (!currentId || visited.has(currentId)) {
      continue;
    }

    if (allowed.has(currentId)) {
      return true;
    }

    visited.add(currentId);
    depth += 1;

    try {
      const response = await drive.files.get({
        fileId: currentId,
        fields: "id,parents",
        supportsAllDrives: true,
      });

      const parents = Array.isArray(response.data.parents) ? response.data.parents : [];
      pending.push(...parents);
    } catch {
      return false;
    }
  }

  return false;
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
    fields: "id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size,parents",
    supportsAllDrives: true,
  });

  return normalizeDriveFile(response.data || {});
}

async function assertCanAccessDriveItem({ profile, drive, fileId }) {
  const cleanFileId = requireString(fileId, "fileId");
  const allowedRootIds = await getAuthorizedFolderRoots(profile);
  const canAccess = await isFolderInsideAllowedRoots(drive, cleanFileId, allowedRootIds);

  if (!canAccess) {
    throw new HttpsError("permission-denied", "No tienes permiso para modificar este elemento de Nube AES.");
  }

  return cleanFileId;
}

async function getSearchAllowedRoots({ profile, drive, folderId }) {
  const cleanFolderId = String(folderId || "").trim();

  if (!cleanFolderId) {
    return getAuthorizedFolderRoots(profile);
  }

  await assertCanAccessDriveFolder({ profile, drive, folderId: cleanFolderId });
  return [cleanFolderId];
}

async function filterFilesInsideRoots({ drive, files, allowedRootIds }) {
  const filtered = [];

  for (const file of files) {
    const canAccess = await isFolderInsideAllowedRoots(drive, file.id, allowedRootIds);

    if (canAccess) {
      filtered.push(file);
    }
  }

  return filtered;
}

exports.driveListFolder = onCall(async (request) => {
  const uid = request.auth?.uid;

  const profile = await getUserProfile(uid);
  const drive = await getDriveClient();
  const folderId = await assertCanAccessDriveFolder({
    profile,
    drive,
    folderId: request.data?.folderId,
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

  return { folderId, files };
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

    return normalizeDriveFile(response.data || {});
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

    const response = await drive.files.update({
      fileId,
      requestBody: { name },
      fields: "id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size,parents",
      supportsAllDrives: true,
    });

    return normalizeDriveFile(response.data || {});
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

    return normalizeDriveFile(response.data || {});
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

    return normalizeDriveFile(response.data || {});
  } catch (error) {
    throw getDriveMutationError(error, "No se pudo enviar el elemento a la papelera.");
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
      const allowedFiles = await filterFilesInsideRoots({ drive, files, allowedRootIds });

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
