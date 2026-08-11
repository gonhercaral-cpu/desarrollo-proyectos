import type { InternalPresentation } from "../models/presentation";

export interface ClassroomState { levelId: string | null; levelTitle: string | null; unitId: string | null; unitTitle: string | null; dayId: string | null; resourceId: string | null; audienceMessage: string; audienceVisible: boolean; presentation: InternalPresentation | null; currentSlideIndex: number; mediaPlaying: boolean; }
const STORAGE_KEY = "active-classroom:session";
const CHANNEL_NAME = "active-classroom:sync";
export const initialState: ClassroomState = { levelId: "level-1", levelTitle: "Nivel 1", unitId: "level-1-unit-01", unitTitle: "Unit 01", dayId: null, resourceId: null, audienceMessage: "Selecciona un archivo para comenzar la clase.", audienceVisible: true, presentation: null, currentSlideIndex: 0, mediaPlaying: false };
type Listener = (state: ClassroomState) => void;

export class ClassroomStore {
  private state: ClassroomState = this.read();
  private listeners = new Set<Listener>();
  private channel = new BroadcastChannel(CHANNEL_NAME);
  constructor() {
    this.channel.addEventListener("message", (event: MessageEvent<ClassroomState>) => { this.state = { ...initialState, ...event.data }; this.emit(); });
    window.addEventListener("storage", (event) => { if (event.key === STORAGE_KEY) { this.state = this.read(); this.emit(); } });
  }
  get snapshot(): ClassroomState { return { ...this.state }; }
  update(patch: Partial<ClassroomState>): void { this.state = { ...this.state, ...patch }; localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); this.channel.postMessage(this.state); this.emit(); }
  subscribe(listener: Listener): () => void { this.listeners.add(listener); listener(this.snapshot); return () => this.listeners.delete(listener); }
  private read(): ClassroomState { try { const saved = localStorage.getItem(STORAGE_KEY); if (!saved) return { ...initialState }; const parsed = JSON.parse(saved); return typeof parsed.levelId === "string" && parsed.levelId.startsWith("level-") ? { ...initialState, ...parsed } : { ...initialState, audienceMessage: parsed.audienceMessage ?? initialState.audienceMessage, audienceVisible: parsed.audienceVisible ?? true }; } catch { return { ...initialState }; } }
  private emit(): void { const snapshot = this.snapshot; this.listeners.forEach((listener) => listener(snapshot)); }
}
