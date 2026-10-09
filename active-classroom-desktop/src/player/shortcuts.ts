import type { PlayerCommand } from "./types.ts";

export function shortcutFor(event: Pick<KeyboardEvent, "key" | "target" | "ctrlKey" | "altKey" | "metaKey" | "defaultPrevented" | "isComposing">, presentation = false): PlayerCommand | "ESCAPE" | null {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return null;
  const target = event.target as HTMLElement | null;
  if (target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']")) return null;
  // Space activates focused buttons normally; do not also toggle playback.
  if (event.key === " " && target?.closest?.("button, a")) return null;
  if (presentation && ["ArrowRight", " "].includes(event.key)) return "ADVANCE";
  if (presentation && event.key === "ArrowLeft") return "BACK";
  return ({ ArrowLeft: "PREVIOUS", ArrowRight: "NEXT", " ": "PLAY_PAUSE", j: "SEEK_BACKWARD", l: "SEEK_FORWARD", ArrowUp: "VOLUME_UP", ArrowDown: "VOLUME_DOWN", m: "MUTE", f: "FULLSCREEN", Escape: "ESCAPE" } as Record<string, PlayerCommand | "ESCAPE">)[event.key.length === 1 ? event.key.toLowerCase() : event.key] || null;
}
