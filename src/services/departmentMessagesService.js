import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "./firebase";
import {
  filterVisibleDepartmentMessages,
  getUserDepartmentLabels,
  getUserExplicitDepartmentIds,
} from "../utils/departmentMembership";

const DEPARTMENT_MESSAGES_COLLECTION = "departmentMessages";

function normalizeMessageDocument(messageDoc) {
  return { id: messageDoc.id, ...messageDoc.data() };
}

function buildVisibleDepartmentMessageQueries(profile, isAdmin) {
  const currentUserId = String(profile?.uid || profile?.id || "").trim();
  if (!currentUserId) return [];

  const messagesRef = collection(db, DEPARTMENT_MESSAGES_COLLECTION);
  if (isAdmin) return [messagesRef];

  const departmentIds = getUserExplicitDepartmentIds(profile);
  const departmentLabels = getUserDepartmentLabels(profile);
  const membershipField = departmentIds.length > 0 ? "departmentId" : "departmentName";
  const memberships = departmentIds.length > 0 ? departmentIds : departmentLabels;

  return memberships.map((membership) => query(
    messagesRef,
    where("memberIds", "array-contains", currentUserId),
    where(membershipField, "==", membership)
  ));
}

function mergeVisibleDepartmentMessages(messageLists, profile, isAdmin) {
  const messagesById = new Map();
  messageLists.forEach((messages) => {
    messages.forEach((message) => messagesById.set(message.id, message));
  });
  return filterVisibleDepartmentMessages(Array.from(messagesById.values()), profile, isAdmin);
}

export async function loadVisibleDepartmentMessages(profile, isAdmin = false) {
  const queries = buildVisibleDepartmentMessageQueries(profile, isAdmin);
  if (queries.length === 0) return [];

  const snapshots = await Promise.all(queries.map((messagesQuery) => getDocs(messagesQuery)));
  return mergeVisibleDepartmentMessages(
    snapshots.map((snapshot) => snapshot.docs.map(normalizeMessageDocument)),
    profile,
    isAdmin
  );
}

export function subscribeToVisibleDepartmentMessages({
  profile,
  isAdmin = false,
  onMessages,
  onChanges,
  onError,
}) {
  const currentUserId = String(profile?.uid || profile?.id || "").trim();
  if (!currentUserId) {
    onMessages?.([]);
    return () => {};
  }

  const queries = buildVisibleDepartmentMessageQueries(profile, isAdmin);

  if (queries.length === 0) {
    onMessages?.([]);
    return () => {};
  }

  const messagesByQuery = new Map();
  onMessages?.([]);

  function emitMessages() {
    onMessages?.(mergeVisibleDepartmentMessages(
      Array.from(messagesByQuery.values()),
      profile,
      isAdmin
    ));
  }

  const unsubscribes = queries.map((messagesQuery, queryIndex) => onSnapshot(
    messagesQuery,
    (snapshot) => {
      const isInitialSnapshot = !messagesByQuery.has(queryIndex);
      messagesByQuery.set(queryIndex, snapshot.docs.map(normalizeMessageDocument));
      emitMessages();
      onChanges?.(
        filterVisibleDepartmentMessages(
          snapshot.docChanges().map((change) => ({
            type: change.type,
            message: normalizeMessageDocument(change.doc),
          })).filter((change) => change.type === "added").map((change) => change.message),
          profile,
          isAdmin
        ),
        isInitialSnapshot
      );
    },
    (error) => {
      messagesByQuery.delete(queryIndex);
      emitMessages();
      onError?.(error);
    }
  ));

  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}
