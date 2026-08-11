export type ResourceKind = "presentation" | "audio" | "video" | "document" | "image";
export type ViewMode = "list" | "grid";

export interface Resource {
  id: string;
  folderId: string;
  name: string;
  kind: ResourceKind;
  size: string;
  byteSize?: number;
  updated: string;
  published: boolean;
  url?: string;
  mimeType?: string;
  dimensions?: string;
  pages?: number;
  persisted?: boolean;
  localPath?: string;
  blob?: Blob;
}

export interface DriveFolder {
  id: string;
  name: string;
  updated: string;
  parentId: string | null;
  kind: "level" | "unit";
}

export interface AppState {
  resources: Resource[];
  folders: DriveFolder[];
  selectedResourceId: string;
  selectedFolderId: string;
  searchTerm: string;
  typeFilter: string;
  statusFilter: string;
  sortMode: string;
  viewMode: ViewMode;
}
