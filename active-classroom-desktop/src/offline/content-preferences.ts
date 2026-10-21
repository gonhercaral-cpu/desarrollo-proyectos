import type { Manifest, Publication } from "./manifest.ts";

export interface ContentPreferences { autoUpdate: boolean; followedLevels: string[]; pendingUnits: string[] }
const defaults = (): ContentPreferences => ({ autoUpdate: true, followedLevels: [], pendingUnits: [] });
let owner = "";
const validIds = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(id)))] : [];
export function contentOwner(value: string): void { owner = value; }
export function contentPreferences(storage = globalThis.window?.localStorage || globalThis.localStorage): ContentPreferences {
  try {
    const value = JSON.parse(storage.getItem(`active-classroom-content:${owner}`) || "{}");
    return { autoUpdate: value.autoUpdate !== false, followedLevels: validIds(value.followedLevels), pendingUnits: validIds(value.pendingUnits) };
  } catch { return defaults(); }
}
export function saveContentPreferences(patch: Partial<ContentPreferences>, storage = globalThis.window?.localStorage || globalThis.localStorage): void {
  if (!owner) return;
  const value = { ...contentPreferences(storage), ...patch };
  try { storage?.setItem(`active-classroom-content:${owner}`, JSON.stringify(value)); } catch { console.warn("No se pudieron guardar preferencias de contenido."); }
  globalThis.window?.dispatchEvent(new window.Event("classroom-content-preferences"));
}
export function requiredContent(locals: Manifest[], publications: Publication[], preferences: ContentPreferences): Publication[] {
  const versions = new Map(locals.map(manifest => [manifest.unit.unitId, manifest.version]));
  return publications.filter(publication => (publication.version > (versions.get(publication.unitId) || 0)) &&
    (preferences.followedLevels.includes(publication.levelId) || preferences.pendingUnits.includes(publication.unitId) || (preferences.autoUpdate && versions.has(publication.unitId))));
}
export function contentSettingsMarkup(): string {
  return `<section class="ui-stack content-settings"><h3>Contenido</h3><label><input type="checkbox" data-auto-content ${contentPreferences().autoUpdate ? "checked" : ""}/> Actualizar automáticamente las Units descargadas</label><small>Descarga en segundo plano. Conserva la versión abierta hasta cerrar la clase.</small></section>`;
}
export function bindContentSettings(host: HTMLElement): void {
  const input = host.querySelector<HTMLInputElement>("[data-auto-content]");
  if (input) input.onchange = () => { saveContentPreferences({ autoUpdate: input.checked }); };
}
