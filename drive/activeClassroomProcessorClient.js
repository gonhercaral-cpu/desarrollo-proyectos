const { HttpsError } = require("firebase-functions/v2/https");
const { descriptor } = require("./activeClassroomFiles");
const { processingTargetPath } = require("./activeClassroomProcessingModel");

function createProcessorClient({ bucket, getUrl, getClient, clock = Date.now }) {
  return async (data) => {
    const url = getUrl();
    if (!/^https:\/\/[a-zA-Z0-9-]+\.(?:[a-z0-9-]+\.)?run\.app$/.test(url)) throw new HttpsError("failed-precondition", "Configura el procesador privado de documentos antes de continuar.");
    const client = await getClient(url);
    const path = processingTargetPath(data.revision); const target = bucket.file(path);
    const expires = clock() + 10 * 60 * 1000;
    // Capabilities stay inside the private backend. Converter has no cloud data roles.
    const [sourceUrl] = await bucket.file(data.original.path).getSignedUrl({ version: "v4", action: "read", expires, queryParams: { generation: data.original.generation } });
    const [uploadUrl] = await target.getSignedUrl({ version: "v4", action: "write", expires, contentType: "application/pdf", extensionHeaders: { "x-goog-if-generation-match": "0" } });
    const response = await client.request({ url: `${url}/convert`, method: "POST", data: { ...data, sourceUrl, uploadUrl }, timeout: 420000 });
    const result = response.data;
    if (!/^[a-f0-9]{64}$/.test(result?.sha256 || "") || result.revision !== data.revision || result.processorVersion !== data.processorVersion || !Number.isInteger(result.pageCount) || result.pageCount < 1 || result.pageCount > 200 || !Number.isSafeInteger(result.sizeBytes) || result.sizeBytes < 5 || result.sizeBytes > 250 * 1024 * 1024) throw new HttpsError("data-loss", "Resultado del procesador inválido.");
    await target.setMetadata({ cacheControl: "private, no-store", metadata: { sha256: result.sha256, deliveredName: `${data.original.name.replace(/\.[^.]+$/, "").slice(0, 140)}.pdf`, capturedAt: new Date(clock()).toISOString(), processingRevision: data.revision, pageCount: String(result.pageCount) } });
    const [metadata] = await target.getMetadata();
    if (Number(metadata.size) !== result.sizeBytes) throw new HttpsError("data-loss", "Tamaño del PDF procesado inválido.");
    return { ...result, download: descriptor(path, metadata) };
  };
}
module.exports = { createProcessorClient };
