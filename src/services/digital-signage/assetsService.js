import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
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
  WEB_COMMAND_TYPES,
  ASSETS_COLLECTION,
  PLAYLISTS_COLLECTION,
  ASSET_STORAGE_ROOT,
  assertAdminUser,
  cleanText,
  cleanDuration,
  cleanFileName,
  getAssetTypeFromFile,
  getUserName,
  getUserId,
  normalizeAssetDocument,
  normalizePlaylistItems,
  cleanTemplateKey,
  cleanTemplateTheme,
  cleanAssetCategory,
  cleanPublishStatus,
  cleanWebSettings,
  cleanTags,
  normalizeTemplateData,
  normalizeVisualAdData,
  isValidVisualAdData,
  clearVisualAdStorageReferences,
  getOrderedCollection
} from "./shared";
import { logSignageAudit } from "./auditService";

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
  await logSignageAudit("crear asset", "asset", assetRef.id, title, {
    type: payload.type,
    plantel,
    publishStatus: payload.publishStatus,
  }, user);

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
  await logSignageAudit("crear asset web", "web_asset", assetRef.id, title, {
    url,
    plantel,
    publishStatus: payload.publishStatus,
  }, user);

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
  await logSignageAudit("importar desde Nube AES", "nube_aes_import", assetRef.id, title, {
    sourceFileId: driveFileId,
    sourceFileName: payload.sourceFileName,
    sourceFileMimeType: payload.sourceFileMimeType,
    sourceFolderId: payload.sourceFolderId,
    sourceFolderName: payload.sourceFolderName,
    type: payload.type,
    plantel,
  }, user);

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
  await logSignageAudit("crear plantilla rapida", "asset", assetRef.id, title, {
    type: "template",
    templateKey: payload.templateKey,
    plantel,
    publishStatus: payload.publishStatus,
  }, user);

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
  await logSignageAudit("crear anuncio visual", "asset", assetRef.id, title, {
    type: "visual_ad",
    plantel,
    publishStatus: payload.publishStatus,
  }, user);

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
    updatedAt: serverTimestamp(),
  };

  await updateDoc(assetRef, payload);
  await logSignageAudit("editar anuncio visual", "asset", id, title, {
    type: "visual_ad",
    plantel,
    publishStatus: payload.publishStatus,
  }, user);
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
  await logSignageAudit("enviar comando web", "web_asset", cleanAssetId, snapshot.data()?.title || "Asset web", {
    command: commandType,
  }, user);
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
  await logSignageAudit("duplicar asset", "asset", assetRef.id, payload.title, {
    sourceAssetId: id,
    sourceName: data.title || "",
    type: payload.type || data.type || "",
  }, user);

  return {
    id: assetRef.id,
    ...payload,
  };
}
