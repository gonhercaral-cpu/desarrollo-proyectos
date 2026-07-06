/* global require, exports */

const { setGlobalOptions } = require("firebase-functions/v2");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { google } = require("googleapis");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10, region: "us-central1" });

const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const DRIVE_SETTINGS_PATH = "systemSettings/drive";

let driveClientPromise;

function getDriveClient() {
  if (!driveClientPromise) {
    const auth = new google.auth.GoogleAuth({
      scopes: [DRIVE_SCOPE],
    });

    driveClientPromise = auth.getClient().then((authClient) =>
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

  const userSnapshot = await admin.firestore().doc(`users/${uid}`).get();
  const role = userSnapshot.exists ? userSnapshot.data()?.role : null;

  if (role !== "admin") {
    throw new HttpsError("permission-denied", "Solo administradores pueden usar Nube AES.");
  }

  return uid;
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

exports.driveListFolder = onCall(async (request) => {
  await assertAdmin(request);

  const folderId = requireString(request.data?.folderId, "folderId");
  const drive = await getDriveClient();
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
  await assertAdmin(request);

  const parentId = requireString(request.data?.parentId, "parentId");
  const name = requireString(request.data?.name, "name");
  const drive = await getDriveClient();

  const folder = await createDriveFolder(drive, parentId, name);

  return {
    id: folder.id || "",
    name: folder.name || "",
    webViewLink: folder.webViewLink || "",
  };
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
