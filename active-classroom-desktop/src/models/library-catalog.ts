import type { ResourceKind } from "./content";

export interface CatalogFolder {
  id: string;
  name: string;
  parentId: string | null;
  kind: "level" | "unit";
  updated: string;
}

export interface CatalogFile {
  id: string;
  folderId: string;
  name: string;
  kind: ResourceKind;
  size: string;
  byteSize?: number;
  updated: string;
  published: boolean;
  mimeType?: string;
  dimensions?: string;
  pages?: number;
  url?: string;
  localPath?: string;
}

export interface LibraryCatalog {
  version: 1;
  updatedAt: string;
  folders: CatalogFolder[];
  files: CatalogFile[];
}

export interface CatalogLoadResult {
  catalog: LibraryCatalog;
  connected: boolean;
  warning?: string;
}
