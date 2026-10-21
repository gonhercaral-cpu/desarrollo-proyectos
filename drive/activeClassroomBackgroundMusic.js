const { HttpsError } = require("firebase-functions/v2/https");
const AUDIO_MIMES = new Set(["audio/mpeg", "audio/mp3", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/wav", "audio/wave", "audio/x-wav", "audio/webm", "audio/flac"]);
function normalizeBackgroundMusic(tracks = []) {
  const fail = () => { throw new HttpsError("invalid-argument", "Música ambiente inválida. Selecciona archivos de audio de esta Unit."); };
  if (!Array.isArray(tracks) || tracks.length > 30) fail();
  const ids = new Set();
  return tracks.map((track, order) => {
    if (!track || !/^[a-zA-Z0-9_-]{1,200}$/.test(track.resourceId || "") || (track.sourceType && track.sourceType !== "file") || ids.has(track.resourceId) || typeof track.title !== "string" || !track.title.trim() || track.title.length > 160) fail();
    ids.add(track.resourceId);
    return { id: track.resourceId, resourceId: track.resourceId, sourceType: "file", title: track.title.trim(), order };
  });
}
function validateMusicResources(tracks, resources) {
  for (const track of tracks || []) if (!AUDIO_MIMES.has(resources.find(resource => resource.id === track.resourceId)?.mimeType)) throw new HttpsError("invalid-argument", "Música ambiente requiere un archivo de audio compatible.");
}
function freezeBackgroundMusic(tracks, files) {
  return (tracks || []).map(track => {
    const file = files.get(track.resourceId);
    if (!file || !AUDIO_MIMES.has(file.mimeType)) throw new HttpsError("data-loss", "Falta un archivo verificado de música ambiente.");
    return { ...track, mime: file.mimeType, size: file.sizeBytes, sha256: file.checksums.sha256, storagePath: file.path, generation: file.generation };
  });
}
module.exports = { normalizeBackgroundMusic, validateMusicResources, freezeBackgroundMusic };
