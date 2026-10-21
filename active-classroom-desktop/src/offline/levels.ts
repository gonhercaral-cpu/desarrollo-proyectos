export interface LibraryLevel { id: string; name: string; position: number; active: boolean }
export function validLibraryLevels(value: unknown): value is LibraryLevel[] {
  return Array.isArray(value) && value.every(level => level && typeof level.id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(level.id) && typeof level.name === "string" && !!level.name.trim() && level.name.length <= 160 && Number.isSafeInteger(level.position) && typeof level.active === "boolean") && new Set(value.map(level => level.id)).size === value.length;
}
let libraryLevels: LibraryLevel[] = [];
try { const cached: unknown = JSON.parse(localStorage.getItem("active-classroom-levels") || "[]"); if (validLibraryLevels(cached)) libraryLevels = cached; } catch { /* Catalog cache is optional; Units remain available. */ }
export function setLibraryLevels(levels: LibraryLevel[]): void {
  libraryLevels = levels;
  try { localStorage.setItem("active-classroom-levels", JSON.stringify(levels)); } catch { /* Keep working if preference storage is unavailable. */ }
}
export function libraryLevelIds(unitLevels: string[]): string[] {
  return [...new Set([...libraryLevels.filter(level => level.active).map(level => level.id), ...unitLevels])].sort((a, b) => (libraryLevels.find(level => level.id === a)?.position ?? 999) - (libraryLevels.find(level => level.id === b)?.position ?? 999) || levelName(a).localeCompare(levelName(b), "es", { numeric: true }));
}
export const levelName = (id: string) => libraryLevels.find(level => level.id === id)?.name || (/^level-\d+$/.test(id) ? `Nivel ${id.slice(6)}` : id);
