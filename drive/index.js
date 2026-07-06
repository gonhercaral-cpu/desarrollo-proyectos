/* global require, exports */

const { setGlobalOptions } = require("firebase-functions/v2");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { google } = require("googleapis");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10, region: "us-central1" });

const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

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

  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      parents: [parentId],
    },
    fields: "id,name,webViewLink",
    supportsAllDrives: true,
  });

  return {
    id: response.data.id || "",
    name: response.data.name || "",
    webViewLink: response.data.webViewLink || "",
  };
});
