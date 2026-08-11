import type { DriveFolder, Resource } from "../models";

interface StoredFileRecord { id: string; resource: Resource; blob: Blob; }
export interface HydratedLibrary { files: Resource[]; folders: DriveFolder[]; }

const databaseName = "active-classroom-admin-demo";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("files")) database.createObjectStore("files", { keyPath: "id" });
      if (!database.objectStoreNames.contains("folders")) database.createObjectStore("folders", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB no disponible"));
    request.onblocked = () => reject(new Error("Base local bloqueada por otra pestaña"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Error de almacenamiento local"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("No se completó la escritura local"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Escritura local cancelada"));
  });
}

export async function persistFile(resource: Resource, blob: Blob): Promise<void> {
  const database = await openDatabase();
  const storedResource = { ...resource };
  delete storedResource.url;
  const transaction = database.transaction("files", "readwrite");
  transaction.objectStore("files").put({ id: resource.id, resource: storedResource, blob } satisfies StoredFileRecord);
  await transactionComplete(transaction);
  database.close();
}

export async function persistFolder(folder: DriveFolder): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction("folders", "readwrite");
  transaction.objectStore("folders").put(folder);
  await transactionComplete(transaction);
  database.close();
}

export async function hydrateLibrary(): Promise<HydratedLibrary> {
  const database = await openDatabase();
  const transaction = database.transaction(["files", "folders"], "readonly");
  const [storedFiles, folders] = await Promise.all([
    requestResult(transaction.objectStore("files").getAll() as IDBRequest<StoredFileRecord[]>),
    requestResult(transaction.objectStore("folders").getAll() as IDBRequest<DriveFolder[]>),
  ]);
  database.close();
  return { files: storedFiles.map(({ resource, blob }) => ({ ...resource, url: URL.createObjectURL(blob), persisted: true, blob })), folders };
}

export function storageError(error: unknown): string {
  if (error instanceof DOMException && error.name === "QuotaExceededError") return "cuota del navegador agotada";
  return error instanceof Error ? error.message : "almacenamiento no disponible";
}
