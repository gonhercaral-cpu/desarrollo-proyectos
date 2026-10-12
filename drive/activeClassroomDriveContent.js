const { Readable } = require("node:stream");
const { setTimeout: sleep } = require("node:timers/promises");
const { HttpsError } = require("firebase-functions/v2/https");

function googleErrorReason(error) {
  const supplied = error?.response?.data?.error?.errors || error?.errors;
  const reasons = Array.isArray(supplied) ? supplied : [];
  if (error?.details?.reason === "exportSizeLimitExceeded" || reasons.some((entry) => entry?.reason === "exportSizeLimitExceeded")) return "exportSizeLimitExceeded";
  return reasons.map((entry) => entry?.reason).find((reason) => typeof reason === "string") || "";
}
function processingError(error, slides = false) {
  if (googleErrorReason(error) === "exportSizeLimitExceeded") return new HttpsError("resource-exhausted", "El archivo de Google supera el límite de exportación. Procesa Google Slides por diapositivas.", { reason: "exportSizeLimitExceeded" });
  if (Number(error?.response?.status || error?.code) === 413) return new HttpsError("resource-exhausted", "El proveedor rechazó el archivo por superar su límite de tamaño.", { reason: "providerSizeLimitExceeded" });
  if (error instanceof HttpsError) return error;
  return new HttpsError("failed-precondition", slides ? "No se pudo procesar la presentación de Google Slides" : "No se pudo procesar el documento. Reintenta o revisa el original.");
}
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
async function openSlidesExport(drive, fileId, { wait = sleep, clock = Date.now, request = fetch, resourceKey } = {}) {
  // files.export caps exports at 10 MB. The official download LRO supports large
  // Workspace exports. Its access-bearing URL never enters metadata or logs.
  const deadline = clock() + 120000;
  const resourceHeaders = key => key ? { "X-Goog-Drive-Resource-Keys": `${fileId}/${key}` } : {};
  let operation = (await drive.files.download({ fileId, mimeType: PPTX_MIME }, { timeout: 20000, headers: resourceHeaders(resourceKey) })).data;
  while (!operation.done) {
    if (clock() >= deadline || !operation.name) throw new HttpsError("deadline-exceeded", "La exportación de Nube AES tardó demasiado. Reintenta.");
    await wait(10000);
    operation = (await drive.operations.get({ name: operation.name }, { timeout: 20000, headers: resourceHeaders(resourceKey || operation.metadata?.resourceKey) })).data;
  }
  if (operation.error?.code === 12) throw new HttpsError("unimplemented", "Esta presentación requiere revelados manuales.");
  if (operation.error || !operation.response?.downloadUri) throw new HttpsError("failed-precondition", "No se pudo exportar esta presentación para extraer revelados.");
  let url = new URL(operation.response.downloadUri);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password || !(url.hostname === "www.googleapis.com" || url.hostname === "download.googleapis.com" || url.hostname === "docs.google.com" || url.hostname === "drive.google.com" || url.hostname === "drive.usercontent.google.com" || url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com"))) throw new HttpsError("data-loss", "Exportación de Nube AES inválida.");
    const headers = new Headers(await drive.context?._options?.auth?.getRequestHeaders(url.toString()));
    const key = resourceKey || operation.metadata?.resourceKey;
    if (key) headers.set("X-Goog-Drive-Resource-Keys", `${fileId}/${key}`);
    const response = await request(url, { headers, redirect: "manual", signal: AbortSignal.timeout(120000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = new URL(response.headers.get("location"), url);
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new HttpsError("unavailable", "No se pudo descargar la exportación de Nube AES."); }
    return Readable.fromWeb(response.body);
  }
  throw new HttpsError("data-loss", "Demasiadas redirecciones en exportación de Nube AES.");
}
async function openActiveClassroomDrive(drive, file, descriptor) {
  if (file.mimeType === "application/vnd.google-apps.presentation" && descriptor.deliveredMimeType === PPTX_MIME) return openSlidesExport(drive, file.id, { resourceKey: file.resourceKey });
  if (file.mimeType === "application/vnd.google-apps.presentation") throw new HttpsError("failed-precondition", "Google Slides requiere procesamiento por diapositivas.");
  try {
    // Only native Workspace documents use export. Real PPT/PPTX always use media,
    // even when an outdated caller passes an exported descriptor.
    const response = file.mimeType.startsWith("application/vnd.google-apps.")
      ? await drive.files.export({ fileId: file.id, mimeType: descriptor.deliveredMimeType }, { responseType: "stream" })
      : await drive.files.get({ fileId: file.id, alt: "media", supportsAllDrives: true }, { responseType: "stream" });
    return response.data;
  } catch (error) { throw processingError(error); }
}
module.exports = { openSlidesExport, PPTX_MIME, openActiveClassroomDrive, googleErrorReason, processingError };
