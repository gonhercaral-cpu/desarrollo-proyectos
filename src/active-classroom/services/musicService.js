import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
export const loadMusicCatalog = async () => (await httpsCallable(functions, "getActiveClassroomAmbientCatalog")({})).data.catalog;
export const previewMusicTrack = async (version, trackId) => (await httpsCallable(functions, "previewActiveClassroomAmbient")({ version, trackId })).data;
