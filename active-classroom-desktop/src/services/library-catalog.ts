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
  const folders = Array.from({ length: 5 }, (_, levelIndex) => {
    const number = levelIndex + 1;
    const level = { id: `level-${number}`, name: `Nivel ${number}`, parentId: null, kind: "level" as const, updated: "Respaldo local" };
    const units = Array.from({ length: 16 }, (_, unitIndex) => ({
      id: `level-${number}-unit-${String(unitIndex + 1).padStart(2, "0")}`,
      name: `Unit ${String(unitIndex + 1).padStart(2, "0")}`,
      parentId: level.id,
      kind: "unit" as const,
      updated: "Respaldo local",
    }));
    return [level, ...units];
  }).flat();
  return { version: 1, updatedAt: new Date(0).toISOString(), folders, files: [] };
}
