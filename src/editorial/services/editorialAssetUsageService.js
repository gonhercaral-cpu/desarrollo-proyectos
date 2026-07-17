import { collection, deleteDoc, doc, getDoc, getDocs } from "firebase/firestore";
import { deleteObject, ref } from "firebase/storage";
import { db, storage } from "../../services/firebase";
import { EDITORIAL_COLLECTIONS } from "./editorialProjectsService";

async function collectUsedAssetIds(projectId) {
  const used = new Set();
  const projectRef = doc(db, EDITORIAL_COLLECTIONS.projects, projectId);
  const elementCollections = [];
  const documents = await getDocs(collection(projectRef, EDITORIAL_COLLECTIONS.documents));
  for (const documentSnapshot of documents.docs) {
    for (const collectionName of [EDITORIAL_COLLECTIONS.pages, "masterPages"]) {
      const parents = await getDocs(collection(documentSnapshot.ref, collectionName));
      parents.docs.forEach((parent) => elementCollections.push(collection(parent.ref, EDITORIAL_COLLECTIONS.elements)));
    }
  }
  const components = await getDocs(collection(projectRef, "components"));
  components.docs.forEach((component) => elementCollections.push(collection(component.ref, EDITORIAL_COLLECTIONS.elements)));
  for (const elementsCollection of elementCollections) {
    const elements = await getDocs(elementsCollection);
    elements.docs.forEach((element) => { if (element.data().assetId) used.add(element.data().assetId); });
  }
  return used;
}

export async function cleanupUnusedEditorialAssets(projectId, candidateAssetIds) {
  if (!candidateAssetIds?.size) return;
  const used = await collectUsedAssetIds(projectId);
  for (const assetId of candidateAssetIds) {
    if (used.has(assetId)) continue;
    const assetRef = doc(db, EDITORIAL_COLLECTIONS.assets, assetId);
    const snapshot = await getDoc(assetRef);
    if (!snapshot.exists() || snapshot.data().projectId !== projectId) continue;
    if (snapshot.data().storagePath) await deleteObject(ref(storage, snapshot.data().storagePath)).catch(() => {});
    await deleteDoc(assetRef);
  }
}
