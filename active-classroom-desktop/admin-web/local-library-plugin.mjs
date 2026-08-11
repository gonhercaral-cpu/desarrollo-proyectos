import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

const API_ROOT = "/__active_classroom";
const allowedOrigins = new Set(["http://localhost:1420", "http://127.0.0.1:1420", "http://127.0.0.1:1430"]);

export function localLibraryPlugin(projectRoot) {
  const libraryRoot = resolve(projectRoot, "local-library");
  const catalogPath = join(libraryRoot, "catalog.json");
  const filesRoot = join(libraryRoot, "files");

  return {
    name: "active-classroom-local-library",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (!url.pathname.startsWith(API_ROOT)) return next();
        setCors(request, response);
        if (request.method === "OPTIONS") { response.statusCode = 204; response.end(); return; }
        try {
          await mkdir(filesRoot, { recursive: true });
          const catalog = await readCatalog(catalogPath);
          if (request.method === "GET" && url.pathname === `${API_ROOT}/catalog`) return sendJson(response, 200, catalog);
          if (request.method === "POST" && url.pathname === `${API_ROOT}/folders`) {
            const folder = JSON.parse((await readBody(request)).toString("utf8"));
            validateFolder(folder, catalog);
            const existing = catalog.folders.findIndex(({ id }) => id === folder.id);
            if (existing >= 0) catalog.folders[existing] = folder; else catalog.folders.push(folder);
            await saveCatalog(catalogPath, catalog);
            return sendJson(response, 200, folder);
          }
          const folderMatch = url.pathname.match(/^\/__active_classroom\/folders\/([a-zA-Z0-9_-]+)$/);
          if (folderMatch && request.method === "PATCH") {
            const folder = catalog.folders.find(({ id }) => id === folderMatch[1]);
            if (!folder) return sendJson(response, 404, { error: "Carpeta no encontrada" });
            const body = JSON.parse((await readBody(request)).toString("utf8"));
            if (typeof body.name !== "string" || !body.name.trim()) throw new Error("Nombre inválido");
            folder.name = body.name.trim().slice(0, 56);
            folder.updated = new Date().toISOString();
            await saveCatalog(catalogPath, catalog);
            return sendJson(response, 200, folder);
          }
          if (folderMatch && request.method === "DELETE") {
            const hasChildren = catalog.folders.some(({ parentId }) => parentId === folderMatch[1]);
            const hasFiles = catalog.files.some(({ folderId }) => folderId === folderMatch[1]);
            if (hasChildren || hasFiles) return sendJson(response, 409, { error: "Carpeta no vacía" });
            catalog.folders = catalog.folders.filter(({ id }) => id !== folderMatch[1]);
            await saveCatalog(catalogPath, catalog);
            return sendJson(response, 200, { deleted: folderMatch[1] });
          }
          const fileMatch = url.pathname.match(/^\/__active_classroom\/files\/([a-zA-Z0-9_-]+)$/);
          if (fileMatch && request.method === "POST") {
            const id = fileMatch[1];
            const metadata = JSON.parse(decodeURIComponent(request.headers["x-active-classroom-meta"] ?? ""));
            validateFile(metadata, catalog, id);
            const safeExtension = extname(basename(metadata.name)).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 12);
            const storedName = `${id}${safeExtension}`;
            await writeFile(join(filesRoot, storedName), await readBody(request));
            const record = { ...metadata, id, storedName, localPath: join(filesRoot, storedName), url: `${API_ROOT}/files/${id}` };
            const existing = catalog.files.findIndex((file) => file.id === id);
            if (existing >= 0) catalog.files[existing] = record; else catalog.files.push(record);
            await saveCatalog(catalogPath, catalog);
            return sendJson(response, 200, record);
          }
          if (fileMatch && request.method === "GET") {
            const record = catalog.files.find(({ id }) => id === fileMatch[1]);
            if (!record) return sendJson(response, 404, { error: "Archivo no encontrado" });
            response.statusCode = 200;
            response.setHeader("Content-Type", record.mimeType || "application/octet-stream");
            response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(record.name)}`);
            createReadStream(join(filesRoot, record.storedName)).on("error", () => sendJson(response, 404, { error: "Binario no encontrado" })).pipe(response);
            return;
          }
          return sendJson(response, 404, { error: "Ruta local no encontrada" });
        } catch (error) {
          return sendJson(response, 400, { error: error instanceof Error ? error.message : "Solicitud local inválida" });
        }
      });
    },
  };
}

async function readCatalog(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function saveCatalog(path, catalog) {
  catalog.updatedAt = new Date().toISOString();
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(catalog, null, 2) + "\n");
  await rename(temporary, path);
}

function validateFolder(folder, catalog) {
  if (!folder || !/^[a-zA-Z0-9_-]+$/.test(folder.id) || typeof folder.name !== "string" || !folder.name.trim()) throw new Error("Carpeta inválida");
  if (!["level", "unit"].includes(folder.kind)) throw new Error("Tipo de carpeta inválido");
  if (folder.kind === "level" || !catalog.folders.some(({ id, kind }) => id === folder.parentId && kind === "level")) throw new Error("Unidad requiere Nivel válido");
}

function validateFile(file, catalog, id) {
  if (!file || file.id !== id || typeof file.name !== "string") throw new Error("Metadatos de archivo inválidos");
  if (!catalog.folders.some(({ id: folderId, kind }) => folderId === file.folderId && kind === "unit")) throw new Error("Archivo requiere Unit válido");
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => { total += chunk.length; if (total > 512 * 1024 * 1024) { reject(new Error("Archivo supera 512 MB")); request.destroy(); return; } chunks.push(chunk); });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function setCors(request, response) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Active-Classroom-Meta");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response, status, value) {
  if (response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}
