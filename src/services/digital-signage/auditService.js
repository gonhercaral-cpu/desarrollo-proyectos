import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  limit,
  db,
  AUDIT_LOGS_COLLECTION,
  cleanText,
  getUserName,
  getUserId,
  normalizeAuditDocument,
  cleanAuditDetails
} from "./shared";

export async function logSignageAudit(action, entityType, entityId, entityName, details = {}, user = null) {
  try {
    await addDoc(collection(db, AUDIT_LOGS_COLLECTION), {
      action: cleanText(action),
      entityType: cleanText(entityType || "system"),
      entityId: cleanText(entityId) || null,
      entityName: cleanText(entityName) || null,
      details: cleanAuditDetails(details),
      createdAt: serverTimestamp(),
      createdBy: getUserId(user),
      createdByName: getUserName(user),
    });
  } catch (error) {
    console.warn("No se pudo registrar auditoria de Digital Signage.", error);
  }
}

export async function getSignageAuditLogs({ limitCount = 250 } = {}) {
  const snapshot = await getDocs(
    query(
      collection(db, AUDIT_LOGS_COLLECTION),
      orderBy("createdAt", "desc"),
      limit(Math.min(Math.max(Number(limitCount) || 250, 1), 500))
    )
  );

  return snapshot.docs.map(normalizeAuditDocument);
}
