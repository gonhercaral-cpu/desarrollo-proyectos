import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";

const save = httpsCallable(functions, "saveActiveClassroomUnit");
const publish = httpsCallable(functions, "publishActiveClassroomUnit", { timeout: 540000 });
const check = httpsCallable(functions, "checkActiveClassroomDriveChanges", { timeout: 540000 });
const refresh = httpsCallable(functions, "refreshActiveClassroomDriveResource");
const processDocument = httpsCallable(functions, "processActiveClassroomDocument", { timeout: 540000 });

export async function loadUnitEditor(unitId) {
  const snapshot = await getDoc(doc(db, "activeClassroomUnits", unitId));
  return snapshot.exists() ? snapshot.data() : null;
}
export async function loadUnitPublications(unitId) {
  const result = await getDocs(collection(db, "activeClassroomUnits", unitId, "publications"));
  return result.docs.map((snapshot) => snapshot.data()).sort((a, b) => b.version - a.version);
}
export async function saveUnitDraft(unitId, draft, expectedRevision) {
  return (await save({ unitId, draft, expectedRevision })).data;
}
export async function publishUnit(unitId, expectedRevision) {
  return (await publish({ unitId, expectedRevision })).data;
}
export async function checkUnitDriveChanges(unitId, resourceIds) {
  const results = [];
  for (let index = 0; index < resourceIds.length; index += 200) {
    const batch = (await check({ unitId, resourceIds: resourceIds.slice(index, index + 200) })).data;
    results.push(...batch.results);
  }
  return { results };
}
export async function refreshUnitDriveResource(unitId, resourceId, expectedRevision) {
  return (await refresh({ unitId, resourceId, expectedRevision })).data;
}
export async function processUnitDocument(unitId, resourceId, expectedRevision) {
  return (await processDocument({ unitId, resourceId, expectedRevision })).data;
}
