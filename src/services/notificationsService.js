import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";

const NOTIFICATIONS_COLLECTION = "notifications";
const USERS_COLLECTION = "users";
const createEditorialNotificationsCallable = httpsCallable(functions, "createEditorialNotifications");

export const PROJECT_NOTIFICATION_TYPES = new Set([
  "PROJECT_CREATED",
  "PROJECT_UPDATED",
  "STATUS_CHANGED",
  "PROGRESS_CHANGED",
  "EVIDENCE_UPLOADED",
  "EVIDENCE_REVIEWED",
  "COMMENT_ADDED",
  "REVIEW_REQUESTED",
  "CORRECTIONS_REQUESTED",
  "PROJECT_APPROVED",
  "PROJECT_FINISHED",
  "PROJECT_CANCELLED",
]);

const NOTIFICATION_VISUALS = {
  PROJECT_CREATED: { tone: "green", icon: "✦" },
  PROJECT_UPDATED: { tone: "blue", icon: "✎" },
  STATUS_CHANGED: { tone: "blue", icon: "◷" },
  PROGRESS_CHANGED: { tone: "green", icon: "▧" },
  EVIDENCE_UPLOADED: { tone: "blue", icon: "📎" },
  EVIDENCE_REVIEWED: { tone: "green", icon: "☑" },
  COMMENT_ADDED: { tone: "gold", icon: "💬" },
  REVIEW_REQUESTED: { tone: "gold", icon: "☑" },
  CORRECTIONS_REQUESTED: { tone: "red", icon: "!" },
  PROJECT_APPROVED: { tone: "green", icon: "✓" },
  PROJECT_FINISHED: { tone: "green", icon: "✓" },
  PROJECT_CANCELLED: { tone: "red", icon: "✕" },
  project_assigned: { tone: "green", icon: "✦" },
  project_updated: { tone: "blue", icon: "✎" },
  project_comment: { tone: "gold", icon: "●" },
  project_status_changed: { tone: "blue", icon: "▷" },
  project_due_date_changed: { tone: "gold", icon: "◷" },
  print_request_assigned: { tone: "green", icon: "▤" },
  print_request_updated: { tone: "blue", icon: "▤" },
  production_batch_assigned: { tone: "green", icon: "▣" },
  production_batch_updated: { tone: "blue", icon: "▣" },
  production_batch_stage_changed: { tone: "gold", icon: "▷" },
  quality_audit_assigned: { tone: "gold", icon: "✓" },
  MATERIAL_CORRECTION_URGENT: { tone: "red", icon: "!" },
  MATERIAL_CORRECTION_ASSIGNED: { tone: "blue", icon: "✓" },
  MATERIAL_CORRECTION_INFO_REQUESTED: { tone: "gold", icon: "?" },
  MATERIAL_CORRECTION_CORRECTED: { tone: "green", icon: "✓" },
  MATERIAL_CORRECTION_COMPLETED: { tone: "green", icon: "✓" },
};

export function getNotificationVisual(tipo) {
  return NOTIFICATION_VISUALS[tipo] || { tone: "blue", icon: "🔔" };
}

export async function getAdminUserIds() {
  const usersRef = collection(db, USERS_COLLECTION);
  const adminsQuery = query(
    usersRef,
    where("role", "==", "admin"),
    where("active", "==", true)
  );

  const snapshot = await getDocs(adminsQuery);
  return snapshot.docs.map((document) => document.id);
}

// Fase 7 — Tipos de notificación del Editor Editorial. Reutilizan la misma
// colección `notifications` y el mismo mecanismo de fan-out; no tocan el flujo
// de proyectos operativos.
export const EDITORIAL_NOTIFICATION_TYPES = new Set([
  "EDITORIAL_ASSIGNED",
  "EDITORIAL_COMMENT",
  "EDITORIAL_CORRECTIONS",
  "EDITORIAL_APPROVED",
  "EDITORIAL_PUBLISHED",
  "EDITORIAL_UNPUBLISHED",
  "EDITORIAL_PRINT_REQUESTED",
  "EDITORIAL_PERMISSIONS_CHANGED",
]);

// Notificaciones editoriales. Reutiliza collectProjectRecipients (el proyecto
// editorial usa collaboratorUids/ownerUid) y getAdminUserIds. Deduplica por
// destinatario dentro del evento y guarda dedupeKey + enlace al contexto.
export async function createEditorialEventNotifications({
  project,
  documentId = "",
  type,
  title,
  message,
  actorUid,
  actorName,
  actorIsAdmin = false,
  extraRecipientUids = [],
  dedupeKey = "",
  link = "",
}) {
  if (!project?.id || !EDITORIAL_NOTIFICATION_TYPES.has(type)) return;
  await createEditorialNotificationsCallable({
    projectId: project.id,
    documentId,
    type,
    title,
    message,
    actorUid,
    actorName,
    actorIsAdmin,
    extraRecipientUids,
    deduplicationKey: dedupeKey,
    link,
  });
}

export async function createProjectEventNotifications({
  project,
  type,
  title,
  message,
  actorUid,
  actorName,
  actorIsAdmin = false,
}) {
  // Fan-out operativo ocurre en Cloud Functions al cambiar proyecto/comentario.
  void project;
  void type;
  void title;
  void message;
  void actorUid;
  void actorName;
  void actorIsAdmin;
}

export function normalizeAppNotification(notification = {}) {
  const type = notification.type || notification.tipo || "project_updated";
  const projectId = notification.projectId || "";
  return {
    ...notification,
    type,
    tipo: type,
    module: notification.module || "projects",
    title: notification.title || notification.titulo || "Notificación",
    titulo: notification.title || notification.titulo || "Notificación",
    message: notification.message || notification.mensaje || "",
    mensaje: notification.message || notification.mensaje || "",
    entityType: notification.entityType || (projectId ? "project" : ""),
    entityId: notification.entityId || projectId || notification.editorialProjectId || "",
    route: notification.route || notification.link || "",
    priority: notification.priority || "normal",
    read: notification.read === true,
  };
}

export function subscribeToUserNotifications(userId, onChange, onError) {
  if (!userId) {
    onChange([]);
    return () => {};
  }

  const notificationsQuery = query(
    collection(db, NOTIFICATIONS_COLLECTION),
    where("recipientId", "==", userId),
    where("read", "==", false),
    orderBy("createdAt", "desc")
  );

  return onSnapshot(
    notificationsQuery,
    (snapshot) => {
      onChange(
        snapshot.docs.map((document) => ({
          id: document.id,
          ...normalizeAppNotification(document.data()),
        }))
      );
    },
    (error) => {
      console.error("No se pudieron cargar las notificaciones de proyectos:", error);
      onChange([]);
      onError?.(error);
    }
  );
}

export function subscribeToUnreadProjectNotifications(userId, onChange, onError) {
  if (!userId) {
    onChange([]);
    return () => {};
  }

  const unreadNotificationsQuery = query(
    collection(db, NOTIFICATIONS_COLLECTION),
    where("recipientId", "==", userId),
    where("read", "==", false)
  );

  return onSnapshot(
    unreadNotificationsQuery,
    (snapshot) => {
      onChange(
        snapshot.docs
          .map((document) => ({
            id: document.id,
            ...normalizeAppNotification(document.data()),
          }))
          .filter((notification) => notification.entityType === "project" || Boolean(notification.projectId))
      );
    },
    (error) => {
      console.error("No se pudo cargar la actividad pendiente de proyectos:", error);
      onChange([]);
      onError?.(error);
    }
  );
}

export async function markNotificationRead(notificationId) {
  if (!notificationId) return;

  await updateDoc(doc(db, NOTIFICATIONS_COLLECTION, notificationId), {
    read: true,
    readAt: serverTimestamp(),
    acknowledged: true,
    acknowledgedAt: serverTimestamp(),
  });
}

export async function markEntityNotificationsRead(userId, entityType, entityId) {
  if (!userId || !entityId) return 0;
  const constraints = [where("recipientId", "==", userId)];
  if (entityType) constraints.push(where("entityType", "==", entityType));
  constraints.push(where("entityId", "==", entityId), where("read", "==", false));
  const snapshot = await getDocs(query(collection(db, NOTIFICATIONS_COLLECTION), ...constraints));
  if (snapshot.empty) return 0;
  for (let offset = 0; offset < snapshot.docs.length; offset += 450) {
    const batch = writeBatch(db);
    snapshot.docs.slice(offset, offset + 450).forEach((item) => batch.update(item.ref, {
      read: true,
      readAt: serverTimestamp(),
      acknowledged: true,
      acknowledgedAt: serverTimestamp(),
    }));
    await batch.commit();
  }
  return snapshot.size;
}

export async function markProjectNotificationsRead(userId, projectId) {
  if (!userId || !projectId) return 0;

  const modernCount = await markEntityNotificationsRead(userId, "project", projectId);

  const unreadProjectQuery = query(
    collection(db, NOTIFICATIONS_COLLECTION),
    where("recipientId", "==", userId),
    where("projectId", "==", projectId),
    where("read", "==", false)
  );
  const snapshot = await getDocs(unreadProjectQuery);
  if (snapshot.empty) return modernCount;

  for (let offset = 0; offset < snapshot.docs.length; offset += 450) {
    const batch = writeBatch(db);

    snapshot.docs.slice(offset, offset + 450).forEach((document) => {
      batch.update(document.ref, {
        read: true,
        readAt: serverTimestamp(),
        acknowledged: true,
        acknowledgedAt: serverTimestamp(),
      });
    });

    await batch.commit();
  }

  return modernCount + snapshot.size;
}

export async function markAllNotificationsRead(userId) {
  if (!userId) return;

  const unreadQuery = query(
    collection(db, NOTIFICATIONS_COLLECTION),
    where("recipientId", "==", userId),
    where("read", "==", false)
  );

  const snapshot = await getDocs(unreadQuery);
  if (snapshot.empty) return;

  for (let offset = 0; offset < snapshot.docs.length; offset += 450) {
    const batch = writeBatch(db);
    snapshot.docs.slice(offset, offset + 450).forEach((document) => {
      batch.update(document.ref, {
        read: true,
        readAt: serverTimestamp(),
        acknowledged: true,
        acknowledgedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
}
