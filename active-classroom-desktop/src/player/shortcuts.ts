import type { PlayerCommand } from "./types.ts";
export type ShortcutCommand = PlayerCommand | "ESCAPE" | "PROJECT" | "OPEN_RESOURCE" | "BACKGROUND_MUSIC_PLAY_PAUSE" | "BACKGROUND_MUSIC_NEXT" | "BACKGROUND_MUSIC_PREVIOUS";
export const SHORTCUTS_KEY = "active-classroom-shortcuts:v1";
export const SHORTCUT_ACTIONS: Record<ShortcutCommand, { label: string; context: "all" | "presentation" | "media"; keys: string[] }> = {
  BACKGROUND_MUSIC_PLAY_PAUSE: { label: "Música ambiente: reproducir / pausar", context: "all", keys: [] },
  BACKGROUND_MUSIC_NEXT: { label: "Música ambiente: siguiente pista", context: "all", keys: [] },
  BACKGROUND_MUSIC_PREVIOUS: { label: "Música ambiente: pista anterior", context: "all", keys: [] },
  ADVANCE: { label: "Avanzar diapositiva o revelado", context: "presentation", keys: ["ArrowRight", "Space", "PageDown"] },
  BACK: { label: "Retroceder diapositiva o revelado", context: "presentation", keys: ["ArrowLeft", "PageUp"] },
  NEXT: { label: "Siguiente página", context: "media", keys: ["ArrowRight"] },
  PREVIOUS: { label: "Página anterior", context: "media", keys: ["ArrowLeft"] },
  PLAY_PAUSE: { label: "Play / Pausa", context: "media", keys: ["Space"] },
  STOP: { label: "Detener reproducción", context: "media", keys: ["s"] },
  SEEK_FORWARD: { label: "Adelantar audio o video", context: "media", keys: ["l"] },
  SEEK_BACKWARD: { label: "Retroceder audio o video", context: "media", keys: ["j"] },
  VOLUME_UP: { label: "Subir volumen", context: "all", keys: ["ArrowUp"] },
  VOLUME_DOWN: { label: "Bajar volumen", context: "all", keys: ["ArrowDown"] },
  MUTE: { label: "Silenciar", context: "all", keys: ["m"] },
  FULLSCREEN: { label: "Pantalla completa", context: "all", keys: ["f"] },
  ESCAPE: { label: "Salir / Volver", context: "all", keys: ["Escape"] },
  PROJECT: { label: "Proyectar / Detener proyección", context: "all", keys: ["p"] },
  OPEN_RESOURCE: { label: "Abrir primer recurso de diapositiva", context: "presentation", keys: ["r"] },
};
export type ShortcutMap = Record<ShortcutCommand, string[]>;
export function defaultShortcuts(): ShortcutMap { return Object.fromEntries(Object.entries(SHORTCUT_ACTIONS).map(([action, value]) => [action, [...value.keys]])) as ShortcutMap; }
export function shortcutLabel(key: string): string { return key.split("+").map(part => ({ ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Space: "Espacio", Escape: "Esc" } as Record<string, string>)[part] || (part.length === 1 ? part.toUpperCase() : part)).join(" + "); }
export function reservedShortcut(key: string): boolean {
  return /Meta|^Alt\+(Tab|Space|F[124]|Escape)$|^Ctrl\+Alt\+(Delete|Backspace|F\d+)$|^Ctrl\+Shift\+Escape$/.test(key) || /^F(1[1-9]|[2-9]\d)$/.test(key);
}
export function combination(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  if (event.metaKey || ["Control", "Alt", "Shift", "Meta", "Dead", "Unidentified"].includes(event.key)) return null;
  const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return [event.ctrlKey ? "Ctrl" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", key].filter(Boolean).join("+");
}
function validKey(key: unknown): key is string { return typeof key === "string" && /^(Ctrl\+)?(Alt\+)?(Shift\+)?([a-z0-9]|Space|Escape|Enter|Page(Up|Down)|Arrow(Left|Right|Up|Down)|F([1-9]|10)|[+\-.,/;])$/.test(key) && !reservedShortcut(key); }
// SEEK_* stay in the "media" context so stored maps keep validating; while a presentation is open they also drive the independent audio,
// so a new assignment must not share a key with slide navigation. Stored maps are not re-checked for this (see audioSeekCollisions).
export const AUDIO_SEEK_COMMANDS: ShortcutCommand[] = ["SEEK_BACKWARD", "SEEK_FORWARD"];
const SLIDE_NAVIGATION: ShortcutCommand[] = ["ADVANCE", "BACK", "OPEN_RESOURCE"];
const audioSeekOverlap = (a: ShortcutCommand, b: ShortcutCommand) => AUDIO_SEEK_COMMANDS.includes(a) && SLIDE_NAVIGATION.includes(b) || AUDIO_SEEK_COMMANDS.includes(b) && SLIDE_NAVIGATION.includes(a);
const contextsOverlap = (a: ShortcutCommand, b: ShortcutCommand, forAssignment: boolean) => { const x = SHORTCUT_ACTIONS[a].context, y = SHORTCUT_ACTIONS[b].context; return x === "all" || y === "all" || x === y || forAssignment && audioSeekOverlap(a, b); };
export function shortcutConflict(map: ShortcutMap, command: ShortcutCommand, key: string, forAssignment = false): ShortcutCommand | undefined {
  return (Object.keys(SHORTCUT_ACTIONS) as ShortcutCommand[]).find(other => other !== command && map[other].includes(key) && contextsOverlap(command, other, forAssignment));
}
export interface AudioSeekCollision { key: string; seek: ShortcutCommand; navigation: ShortcutCommand }
// Legacy maps may already bind a seek key to slide navigation: navigation keeps priority at runtime and Settings shows the pair to resolve.
export function audioSeekCollisions(map: ShortcutMap = readShortcuts()): AudioSeekCollision[] {
  const found: AudioSeekCollision[] = [];
  for (const seek of AUDIO_SEEK_COMMANDS) for (const navigation of SLIDE_NAVIGATION) for (const key of map[seek]) if (map[navigation].includes(key)) found.push({ key, seek, navigation });
  return found;
}
export function readShortcuts(storage = globalThis.window?.localStorage || globalThis.localStorage): ShortcutMap {
  try {
    const saved = JSON.parse(storage?.getItem(SHORTCUTS_KEY) || "null"); if (!saved || saved.version !== 1) return defaultShortcuts();
    const map = defaultShortcuts();
    for (const command of Object.keys(map) as ShortcutCommand[]) if (Array.isArray(saved.bindings?.[command]) && saved.bindings[command].every(validKey)) map[command] = [...new Set(saved.bindings[command])] as string[];
    // Corrupt/conflicting persisted configuration safely falls back as a unit.
    if ((Object.keys(map) as ShortcutCommand[]).some(command => map[command].some(key => shortcutConflict(map, command, key)))) return defaultShortcuts();
    return map;
  } catch { return defaultShortcuts(); }
}
export function assignShortcut(command: ShortcutCommand, key: string, replace = false, storage = globalThis.window?.localStorage || globalThis.localStorage): { conflict?: ShortcutCommand; reserved?: boolean } {
  if (!validKey(key)) return { reserved: true };
  const map = readShortcuts(storage); const conflict = shortcutConflict(map, command, key, true);
  if (conflict && !replace) return { conflict };
  // Remove every overlapping binding, including all-context conflicts.
  if (replace) for (const other of Object.keys(map) as ShortcutCommand[]) if (other !== command && contextsOverlap(command, other, true)) map[other] = map[other].filter(item => item !== key);
  map[command] = [key]; storage.setItem(SHORTCUTS_KEY, JSON.stringify({ version: 1, bindings: map }));
  globalThis.window?.dispatchEvent(new window.Event("classroom-shortcuts-changed")); return {};
}
export function restoreShortcuts(storage = globalThis.window?.localStorage || globalThis.localStorage): void { storage.removeItem(SHORTCUTS_KEY); globalThis.window?.dispatchEvent(new window.Event("classroom-shortcuts-changed")); }
export function shortcutFor(event: Pick<KeyboardEvent, "key" | "target" | "ctrlKey" | "altKey" | "metaKey" | "defaultPrevented" | "isComposing"> & { shiftKey?: boolean }, presentation = false, audioSeek = false): ShortcutCommand | null {
  if (globalThis.document?.querySelector("[data-settings-dialog]")) return null;
  if (event.defaultPrevented || event.isComposing || event.metaKey) return null;
  const target = event.target as HTMLElement | null;
  if (target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [data-settings-dialog]")) return null;
  if (event.key === " " && target?.closest?.("button, a")) return null;
  const key = combination({ key: event.key, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey, shiftKey: event.shiftKey === true }); if (!key || reservedShortcut(key)) return null;
  const map = readShortcuts();
  const scoped = (Object.keys(map) as ShortcutCommand[]).find(command => map[command].includes(key) && (SHORTCUT_ACTIONS[command].context === "all" || SHORTCUT_ACTIONS[command].context === (presentation ? "presentation" : "media")));
  // Presentation navigation and global commands win; seek only fills the keys they leave free, and only when the audio can use it.
  if (scoped || !presentation || !audioSeek) return scoped || null;
  return AUDIO_SEEK_COMMANDS.find(command => map[command].includes(key)) || null;
}
