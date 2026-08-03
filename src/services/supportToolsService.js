import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import { db, functions, storage } from "./firebase";

const callables = {
  create: httpsCallable(functions, "createSupportTool"),
  update: httpsCallable(functions, "updateSupportTool"),
  loan: httpsCallable(functions, "loanSupportTool"),
  returnTool: httpsCallable(functions, "returnSupportTool"),
  startMaintenance: httpsCallable(functions, "startSupportToolMaintenance"),
  completeMaintenance: httpsCallable(functions, "completeSupportToolMaintenance"),
  retire: httpsCallable(functions, "retireSupportTool"),
  labelPrint: httpsCallable(functions, "recordSupportToolLabelPrint"),
};

function unwrap(result) {
  return result?.data || {};
}

export function subscribeSupportTools(onChange, onError) {
  return onSnapshot(
    query(collection(db, "supportTools"), limit(300)),
    (snapshot) => onChange(snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((first, second) => getDateMillis(second.createdAt) - getDateMillis(first.createdAt))),
    onError
  );
}

function getDateMillis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value || 0).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function subscribeSupportToolHistory(toolId, onChange, onError) {
  if (!toolId) {
    onChange([]);
    return () => {};
  }
  return onSnapshot(
    query(collection(db, "supportTools", toolId, "history"), orderBy("createdAt", "desc"), limit(80)),
    (snapshot) => onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    onError
  );
}

export function subscribeSupportToolMovements(toolId, onChange, onError) {
  if (!toolId) {
    onChange([]);
    return () => {};
  }
  return onSnapshot(
    query(collection(db, "supportTools", toolId, "movements"), orderBy("createdAt", "desc"), limit(40)),
    (snapshot) => onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    onError
  );
}

export function subscribeSupportToolMaintenance(toolId, onChange, onError) {
  if (!toolId) {
    onChange([]);
    return () => {};
  }
  return onSnapshot(
    query(collection(db, "supportTools", toolId, "maintenance"), orderBy("createdAt", "desc"), limit(40)),
    (snapshot) => onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    onError
  );
}

export async function createSupportTool(input) {
  return unwrap(await callables.create(input));
}

export async function updateSupportTool(toolId, input) {
  return unwrap(await callables.update({ ...input, toolId }));
}

export async function loanSupportTool(toolId, input) {
  return unwrap(await callables.loan({ ...input, toolId }));
}

export async function returnSupportTool(toolId, input) {
  return unwrap(await callables.returnTool({ ...input, toolId }));
}

export async function startSupportToolMaintenance(toolId, input) {
  return unwrap(await callables.startMaintenance({ ...input, toolId }));
}

export async function completeSupportToolMaintenance(toolId, input) {
  return unwrap(await callables.completeMaintenance({ ...input, toolId }));
}

export async function retireSupportTool(toolId, reason) {
  return unwrap(await callables.retire({ toolId, reason }));
}

export async function recordSupportToolLabelPrint(toolId) {
  return unwrap(await callables.labelPrint({ toolId }));
}

async function resizeToolImage(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("Selecciona una imagen válida.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Imagen máxima: 8 MB.");
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  if (!blob) return file;
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "tool"}.webp`, { type: "image/webp" });
}

export async function uploadSupportToolImage(toolId, file, previousPath = "") {
  const optimizedFile = await resizeToolImage(file);
  const path = `support/tools/${toolId}/main-image/tool-${Date.now()}.webp`;
  const imageRef = ref(storage, path);
  await uploadBytes(imageRef, optimizedFile, {
    contentType: optimizedFile.type || "image/webp",
    cacheControl: "public,max-age=3600",
  });
  const imageUrl = await getDownloadURL(imageRef);
  if (previousPath && previousPath !== path) {
    deleteObject(ref(storage, previousPath)).catch(() => undefined);
  }
  return { imageUrl, imagePath: path };
}
