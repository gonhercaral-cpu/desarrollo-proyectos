const { HttpsError } = require("firebase-functions/v2/https");
const { validateMusicResources } = require("./activeClassroomBackgroundMusic");
const DEFAULT_PLAYLIST_ID = "module-default";
function normalizeUnitMusic(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !["inherit", "custom", "none"].includes(value.mode)) throw new HttpsError("invalid-argument", "Configuración de música inválida.");
  if (value.mode === "custom" && !/^[a-f0-9]{64}$/.test(value.trackId || "")) throw new HttpsError("invalid-argument", "Selecciona una pista del catálogo.");
  if (value.mode !== "custom" && value.trackId != null) throw new HttpsError("invalid-argument", "La música heredada no almacena una selección individual.");
  return { mode: value.mode, trackId: value.mode === "custom" ? value.trackId : null };
}
function selectedTrack(catalog, value) {
  if (!value || value.mode === "none") return null;
  const defaults = catalog?.playlists?.find(playlist => playlist.id === DEFAULT_PLAYLIST_ID);
  const trackId = value.mode === "custom" ? value.trackId : defaults ? defaults.trackIds[0] : catalog?.tracks?.find(track => track.active)?.id;
  if (!trackId) return null;
  const track = catalog?.tracks?.find(track => track.id === trackId && track.active);
  if (!track) throw new HttpsError("failed-precondition", "La pista seleccionada ya no está disponible. Elige otra o vuelve a la música predeterminada.");
  validateMusicResources([{ resourceId: track.id }], [{ id: track.id, mimeType: track.mime }]);
  return track;
}
function catalogResource(track, unitId) {
  const resourceId = `ambient-${track.id}`;
  return { id: resourceId, folderId: unitId, source: "ambient", kind: "audio", name: track.title, mimeType: track.mime, sizeBytes: track.size, storagePath: track.storagePath,
    ambientDownload: { endpoint: "activeClassroomPublicationFile", provider: "storage", path: track.storagePath, generation: track.generation, name: track.title, mimeType: track.mime, sizeBytes: track.size, checksums: { sha256: track.sha256 }, capturedAt: null } };
}
module.exports = { DEFAULT_PLAYLIST_ID, normalizeUnitMusic, selectedTrack, catalogResource };
