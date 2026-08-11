export interface InternalPresentation { id: string; title: string; sourceName: string; width: number; height: number; manifestPath: string; slides: InternalSlide[]; resources: ImportedMedia[]; warnings: string[]; }
export interface InternalSlide { id: string; number: number; elements: SlideElement[]; warnings: string[]; }
export type SlideElement =
  | { type: "text"; x: number; y: number; width: number; height: number; text: string; fontSize: number; runs?: TextRun[]; color?: string; backgroundColor?: string; textAlign?: string; verticalAlign?: string; zIndex?: number }
  | { type: "image"; x: number; y: number; width: number; height: number; path: string; mimeType: string; zIndex?: number }
  | { type: "media"; x: number; y: number; width: number; height: number; mediaKind: "audio" | "video"; path?: string; linkedTarget?: string; zIndex?: number };
export interface TextRun { text: string; bold: boolean; italic: boolean; color?: string; }
export interface ImportedMedia { kind: "audio" | "video"; name: string; path?: string; linkedTarget?: string; slideNumber: number; }
