import type { CatalogLoadResult, LibraryCatalog } from "../models/library-catalog";

const bridgeOrigin = "http://127.0.0.1:1430";

export async function loadLibraryCatalog(): Promise<CatalogLoadResult> {
  try {
    const response = await fetch(`${bridgeOrigin}/__active_classroom/catalog`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalog = await response.json() as LibraryCatalog;
    return {
      catalog: {
        ...catalog,
        files: catalog.files.map((file) => ({ ...file, url: file.url ? `${bridgeOrigin}${file.url}` : undefined })),
      },
      connected: true,
    };
  } catch (error) {
    return { catalog: fallbackCatalog(), connected: false, warning: `Puente local no disponible: ${String(error)}` };
  }
}

function fallbackCatalog(): LibraryCatalog {
  return { version: 1, updatedAt: new Date(0).toISOString(), folders: [], files: [] };
}
