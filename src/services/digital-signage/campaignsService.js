import {
  collection,
  deleteDoc,
  doc,
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
  cleanPublishStatus,
  normalizeCampaignPayload,
  getOrderedCollection
} from "./shared";
import { logSignageAudit } from "./auditService";

export async function createSignageCampaign(data, user) {
  assertAdminUser(user);

  const payload = normalizeCampaignPayload(data);

  if (!payload.name || !payload.plantel || !payload.playlistId) {
    throw new Error("Completa nombre, plantel y playlist.");
  }

  if (!payload.startDate || !payload.endDate) {
    throw new Error("Completa fecha inicio y fecha fin.");
  }

  if (payload.endDate < payload.startDate) {
    throw new Error("La fecha fin debe ser posterior a la fecha inicio.");
  }

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

  const payload =
    data?.schedule !== undefined ||
    data?.name !== undefined ||
    data?.plantel !== undefined ||
    data?.playlistId !== undefined ||
    data?.priority !== undefined ||
    data?.startDate !== undefined ||
    data?.endDate !== undefined ||
    data?.deviceIds !== undefined
      ? normalizeCampaignPayload(data)
      : { ...data };

  if (data?.publishStatus !== undefined) {
    payload.publishStatus = cleanPublishStatus(data.publishStatus);
  }

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });

  await updateDoc(doc(db, CAMPAIGNS_COLLECTION, id), {
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
