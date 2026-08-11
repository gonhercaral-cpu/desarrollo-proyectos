import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { InternalPresentation } from "../models/presentation";

export const isTauri = "__TAURI_INTERNALS__" in window;
export function currentViewLabel(): string { return isTauri ? getCurrentWindow().label : new URLSearchParams(location.search).get("view") ?? "teacher"; }
export async function choosePresentation(): Promise<string | null> { const selected = await openDialog({ multiple: false, directory: false, title: "Elegir presentación para la clase", filters: [{ name: "Presentaciones PPTX", extensions: ["pptx"] }] }); return typeof selected === "string" ? selected : null; }
export function importPresentation(path: string): Promise<InternalPresentation> { return invoke<InternalPresentation>("import_presentation", { path }); }
export async function showAudienceWindow(): Promise<void> { if (!isTauri) { window.open("/?view=audience", "active-classroom-audience", "width=1280,height=720"); return; } await invoke("show_audience_window"); }
export interface AudienceStatus { visible: boolean; fullscreen: boolean; width: number; height: number; monitorCount: number; available: boolean; }
export function getAudienceStatus(): Promise<AudienceStatus> { if (!isTauri) return Promise.resolve({ visible: false, fullscreen: false, width: 1920, height: 1080, monitorCount: 1, available: false }); return invoke<AudienceStatus>("audience_status"); }
export function assetUrl(path: string): string { return isTauri ? convertFileSrc(path) : path; }
