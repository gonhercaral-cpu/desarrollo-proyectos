import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";

const NOTIFICATIONS_COLLECTION = "notifications";
const USERS_COLLECTION = "users";

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
};

export function getNotificationVisual(tipo) {
  return NOTIFICATION_VISUALS[tipo] || { tone: "blue", icon: "🔔" };
}

function addUidsToSet(set, value) {
  if (typeof value === "string" && value.trim()) {
    set.add(value.trim());
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (typeof item === "string" && item.trim()) set.add(item.trim());
    });
  }
}

function collectProjectRecipients(project) {
  const recipients = new Set();

  addUidsToSet(recipients, project?.assignedToUid);
  addUidsToSet(recipients, project?.assignedToId);
  addUidsToSet(recipients, project?.createdByUid);
  addUidsToSet(recipients, project?.collaboratorIds);
  addUidsToSet(recipients, project?.collaboratorUids);
  addUidsToSet(recipients, project?.collaboratorsIds);
  addUidsToSet(recipients, project?.collaborators);

  return recipients;
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

export async function createProjectEventNotifications({
  project,
  type,
  title,
  message,
  actorUid,
  actorName,
  actorIsAdmin = false,
}) {
  if (!project?.id || !PROJECT_NOTIFICATION_TYPES.has(type)) {
    return;
  }

  const recipients = collectProjectRecipients(project);

  if (!actorIsAdmin) {
    const adminIds = await getAdminUserIds();
    adminIds.forEach((id) => recipients.add(id));
  }

  recipients.delete(actorUid);

  if (recipients.size === 0) {
    return;
  }

  const notificationsRef = collection(db, NOTIFICATIONS_COLLECTION);

  await Promise.all(
    Array.from(recipients).map((recipientId) =>
      addDoc(notificationsRef, {
        recipientId,
        projectId: project.id,
        tipo: type,
        titulo: title || "Actualización de proyecto",
        mensaje: message || "",
        actorId: actorUid || "",
        actorName: actorName || "Usuario",
        read: false,
        createdAt: serverTimestamp(),
      })
    )
  );
}

export function subscribeToUserNotifications(userId, onChange, onError) {
  if (!userId) {
    onChange([]);
    return () => {};
  }

  const notificationsQuery = query(
    collection(db, NOTIFICATIONS_COLLECTION),
    where("recipientId", "==", userId),
    orderBy("createdAt", "desc"),
    limit(30)
  );

  return onSnapshot(
    notificationsQuery,
    (snapshot) => {
      onChange(
        snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
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

export async function markNotificationRead(notificationId) {
  if (!notificationId) return;

  await updateDoc(doc(db, NOTIFICATIONS_COLLECTION, notificationId), {
    read: true,
    readAt: serverTimestamp(),
  });
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

  const batch = writeBatch(db);
  snapshot.docs.forEach((document) => {
    batch.update(document.ref, { read: true, readAt: serverTimestamp() });
  });

  await batch.commit();
}
