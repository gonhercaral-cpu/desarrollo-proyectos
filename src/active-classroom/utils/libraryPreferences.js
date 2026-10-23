export const DEFAULT_LIBRARY_PREFERENCES = Object.freeze({
  thumbnailSize: "medium", viewMode: "grid", sortMode: "name", pageSize: 12,
  showCover: true, showName: true, showLevel: true, showSlides: true,
  showResources: true, showStatus: true, showDate: true, showVersion: true,
});

export function normalizeLibraryPreferences(input) {
  const value = input && typeof input === "object" ? input : {};
  const result = { ...DEFAULT_LIBRARY_PREFERENCES };
  for (const [key, choices] of Object.entries({ thumbnailSize: ["small", "medium", "large"], viewMode: ["grid", "list"], sortMode: ["name", "date"], pageSize: [12, 24, 48] })) {
    if (choices.includes(value[key])) result[key] = value[key];
  }
  for (const key of Object.keys(result).filter(key => key.startsWith("show"))) {
    if (typeof value[key] === "boolean") result[key] = value[key];
  }
  return result;
}
