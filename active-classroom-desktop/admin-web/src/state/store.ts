import type { AppState } from "../models";

export function createAppState(): AppState {
  return {
    resources: [],
    folders: [],
    selectedResourceId: "",
    selectedFolderId: "root",
    searchTerm: "",
    typeFilter: "all",
    statusFilter: "all",
    sortMode: "name",
    viewMode: "list",
  };
}
