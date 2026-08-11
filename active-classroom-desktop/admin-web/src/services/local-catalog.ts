import type { DriveFolder, Resource } from "../models";

const apiRoot = "/__active_classroom";

export interface LocalCatalog {
  version: 1;
  updatedAt: string;
  folders: DriveFolder[];
  files: Resource[];
}

export async function loadLocalCatalog(): Promise<LocalCatalog> {
  return request<LocalCatalog>(`${apiRoot}/catalog`);
}

export async function mirrorFolder(folder: DriveFolder): Promise<DriveFolder> {
  return request<DriveFolder>(`${apiRoot}/folders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(folder) });
}

export async function renameCatalogFolder(id: string, name: string): Promise<DriveFolder> {
  return request<DriveFolder>(`${apiRoot}/folders/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
}

export async function mirrorFile(resource: Resource, blob: Blob): Promise<Resource> {
  const metadata = { ...resource, url: undefined, blob: undefined };
  return request<Resource>(`${apiRoot}/files/${encodeURIComponent(resource.id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Active-Classroom-Meta": encodeURIComponent(JSON.stringify(metadata)) },
    body: blob,
  });
}

function request<T>(url: string, init?: RequestInit): Promise<T> {
  return fetch(url, init).then(async (response) => {
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(body.error ?? `Puente local respondió ${response.status}`);
    }
    return response.json() as Promise<T>;
  });
}
