import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  db,
  CAMPAIGNS_COLLECTION,
  assertAdminUser,
  getUserName,
  getUserId,
  normalizeCampaignDocument,
  getOrderedCollection
} from "./shared";
import {
  buildCampaignUpdate,
  normalizeCampaignPayload,
  validateCampaignPayload,
} from "../../utils/digitalSignage/signageCampaigns";
import { logSignageAudit } from "./auditService";

export async function createSignageCampaign(data, user) {
  assertAdminUser(user);

  const payload = normalizeCampaignPayload(data);
  validateCampaignPayload(payload);

  const campaignRef = doc(collection(db, CAMPAIGNS_COLLECTION));
  const campaignPayload = {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: getUserName(user),
    createdById: getUserId(user),
  };

  await setDoc(campaignRef, campaignPayload);
  await logSignageAudit("crear campana", "campaign", campaignRef.id, campaignPayload.name, {
    plantel: campaignPayload.plantel,
    planteles: campaignPayload.planteles,
    playlistId: campaignPayload.playlistId,
    priority: campaignPayload.priority,
    publishStatus: campaignPayload.publishStatus,
    scheduleEnabled: campaignPayload.schedule?.enabled === true,
  }, user);

  return {
    id: campaignRef.id,
    ...campaignPayload,
  };
}

export async function getSignageCampaigns() {
  const docs = await getOrderedCollection(CAMPAIGNS_COLLECTION);
  return docs.map(normalizeCampaignDocument);
}

export async function updateSignageCampaign(id, data) {
  if (!id) throw new Error("Falta el ID de la campaña.");

  const campaignRef = doc(db, CAMPAIGNS_COLLECTION, id);
  const snapshot = await getDoc(campaignRef);

  if (!snapshot.exists()) throw new Error("No se encontró la campaña.");

  const payload = buildCampaignUpdate(snapshot.data(), data || {});

  await updateDoc(campaignRef, {
    ...payload,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSignageCampaign(id) {
  if (!id) throw new Error("Falta el ID de la campaña.");
  await deleteDoc(doc(db, CAMPAIGNS_COLLECTION, id));
}

export function subscribeSignageCampaigns(callback, onError) {
  return onSnapshot(
    collection(db, CAMPAIGNS_COLLECTION),
    (snapshot) => {
      callback(snapshot.docs.map(normalizeCampaignDocument));
    },
    onError
  );
}
