import type { Manifest } from "../offline/manifest.ts";

export type PlayerCommand = "NEXT" | "PREVIOUS" | "PLAY_PAUSE" | "STOP" | "SEEK_FORWARD" | "SEEK_BACKWARD" | "VOLUME_UP" | "VOLUME_DOWN" | "MUTE" | "FULLSCREEN";
export type RendererKind = "pdf" | "image" | "audio" | "video" | "unsupported";
export interface LocalClassroom {
  manifest: Manifest;
  resolveResource(resourceId: string): { path: string; mimeType: string; kind: string; name: string };
}
export interface RendererSource { url: string; mimeType: string; name: string; sizeBytes: number }
export interface RendererState {
  loading: boolean; page: number; pages: number; playing: boolean;
  time: number; duration: number; volume: number; muted: boolean; error: string;
}
export interface RendererOptions {
  page: number; volume: number; muted: boolean;
  silent?: boolean;
  onState(state: RendererState): void;
  onPage(page: number): void;
}
export interface LocalRenderer {
  kind: RendererKind;
  mount(host: HTMLElement, source: RendererSource, options: RendererOptions): Promise<void>;
  command(command: PlayerCommand): void | Promise<void>;
  setPage(page: number): void | Promise<void>;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  applyPlayback?(state: RendererState): void | Promise<void>;
  destroy(): void;
}
export function rendererKind(mime: string): RendererKind {
  const normalized = mime.split(";")[0].trim().toLowerCase();
  if (normalized === "application/pdf") return "pdf";
  if (["image/jpeg", "image/png", "image/webp"].includes(normalized)) return "image";
  if (["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/webm", "audio/flac"].includes(normalized)) return "audio";
  if (["video/mp4", "video/webm"].includes(normalized)) return "video";
  return "unsupported";
}
export const initialRendererState = (): RendererState => ({ loading: false, page: 1, pages: 0, playing: false, time: 0, duration: 0, volume: 0.8, muted: false, error: "" });
