import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { guardedSubscription, processingResourceFromSnapshot } from "../utils/processingProgress";

const save = httpsCallable(functions, "saveActiveClassroomUnit");
const publish = httpsCallable(functions, "publishActiveClassroomUnit");
const check = httpsCallable(functions, "checkActiveClassroomDriveChanges", { timeout: 540000 });
const refresh = httpsCallable(functions, "refreshActiveClassroomDriveResource");
const processDocument = httpsCallable(functions, "processActiveClassroomDocument", { timeout: 540000 });
const validatePublication = httpsCallable(functions, "validateActiveClassroomPublication", { timeout: 540000 });

export async function loadUnitEditor(unitId) {
  const snapshot = await getDoc(doc(db, "activeClassroomUnits", unitId));
  return snapshot.exists() ? snapshot.data() : null;
}
export async function loadUnitResources(unitId) {
  const result = await getDocs(query(collection(db, "activeClassroomResources"), where("folderId", "==", unitId)));
  return result.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
}
export async function loadUnitPublications(unitId) {
  const result = await getDocs(collection(db, "activeClassroomUnits", unitId, "publications"));
  return result.docs.map((snapshot) => snapshot.data()).sort((a, b) => b.version - a.version);
}
export async function saveUnitDraft(unitId, draft, expectedRevision) {
  return (await save({ unitId, draft, expectedRevision })).data;
}
export async function publishUnit(unitId, expectedRevision, publishAt) {
  return (await publish({ unitId, expectedRevision, ...(publishAt ? { publishAt } : {}) })).data;
}
export async function validateUnitPublication(unitId, expectedRevision) {
  return (await validatePublication({ unitId, expectedRevision })).data;
}
export function subscribeUnitPublication(unitId, onChange, onError) {
  return onSnapshot(doc(db, "activeClassroomUnits", unitId), (snapshot) => onChange(snapshot.data()?.publicationJob || null), onError);
}
export function subscribeUnitProcessing(unitId, resourceId, onChange, onError) {
  return guardedSubscription(
    (next, fail) => onSnapshot(doc(db, "activeClassroomResources", resourceId), (snapshot) => {
      const resource = processingResourceFromSnapshot(unitId, resourceId, snapshot);
      if (resource) next(resource);
    }, fail),
    onChange, onError,
  );
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
export async function processUnitDocument(unitId, resourceId, expectedRevision, studioRevision) {
  return (await processDocument({ unitId, resourceId, expectedRevision, ...(studioRevision === undefined ? {} : { studioRevision }) })).data;
}
export async function getBuildPreview(unitId, resourceId, pageObjectId, buildIndex = 0, baseline = false, original = false) {
  const result = await httpsCallable(functions, "getActiveClassroomBuildPreview", { timeout: 120000 })({ unitId, resourceId, ...(pageObjectId ? { pageObjectId } : {}), buildIndex, baseline, original });
  return result.data;
}

const loadStudio = httpsCallable(functions, "getActiveClassroomStudioDraft");
const saveStudio = httpsCallable(functions, "saveActiveClassroomStudioDraft");
const reviewStudio = httpsCallable(functions, "reviewActiveClassroomStudioDraft");
const inspectStudio = httpsCallable(functions, "inspectActiveClassroomStudioSlide", { timeout: 120000 });

export async function getStudioDraft(unitId, resourceId) {
  return (await loadStudio({ unitId, resourceId })).data;
}

export async function saveStudioEdits(unitId, resourceId, expectedRevision, edits) {
  return (await saveStudio({ unitId, resourceId, expectedRevision, edits })).data;
}

export async function reviewStudioDraft(unitId, resourceId, expectedRevision, expectedReviewRevision, status, notes, settings = {}) {
  return (await reviewStudio({ unitId, resourceId, expectedRevision, expectedReviewRevision, status, notes, ...settings })).data;
}

export async function inspectStudioSlide(unitId, resourceId, slideIndex) {
  return (await inspectStudio({ unitId, resourceId, slideIndex })).data;
}

export async function restoreStudioVersion(unitId, sourceVersion, expectedVersion, expectedRevision) {
  return (await httpsCallable(functions, "restoreActiveClassroomPublication", { timeout: 540000 })({ unitId, sourceVersion, expectedVersion, expectedRevision })).data;
}

export async function cancelStudioPublication(unitId, jobId) {
  return (await httpsCallable(functions, "cancelActiveClassroomPublication")({ unitId, jobId })).data;
}

export async function loadStudioReviewers() {
  const result = (await httpsCallable(functions, "listActiveClassroomCollaborators")()).data;
  return result.collaborators.filter(user => user.active && user.permissions.access && user.permissions.orderMaterial);
}
