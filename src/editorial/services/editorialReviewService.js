import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { editorialUserId, normalizeReviewState } from "../models/editorialProduction";
import { getEditorialDocumentRef, getEditorialPageRef } from "./editorialPagesService";

function commentsRef(projectId, documentId) {
  return collection(getEditorialDocumentRef(projectId, documentId), "comments");
}

export function subscribeEditorialReview({ projectId, documentId, onState, onComments, onError }) {
  const unsubscribeDocument = onSnapshot(getEditorialDocumentRef(projectId, documentId), (snapshot) => onState(normalizeReviewState(snapshot.data()?.reviewState)), onError);
  const unsubscribeComments = onSnapshot(commentsRef(projectId, documentId), (snapshot) => onComments(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0))), onError);
  return () => { unsubscribeDocument(); unsubscribeComments(); };
}

export async function updateEditorialReviewState({ projectId, documentId, changes, user }) {
  const reference = getEditorialDocumentRef(projectId, documentId);
  const reviewState = normalizeReviewState(changes);
  await setDoc(reference, { reviewState, updatedAt: serverTimestamp(), updatedByUid: editorialUserId(user) }, { merge: true });
}

export async function updateEditorialPageReview({ projectId, documentId, pageId, status, assigneeUid, user }) {
  await updateDoc(getEditorialPageRef(projectId, documentId, pageId), {
    reviewStatus: status, reviewAssigneeUid: assigneeUid || "", updatedAt: serverTimestamp(), updatedByUid: editorialUserId(user),
  });
}

export async function createEditorialComment({ projectId, documentId, pageId, elementId = "", message, user }) {
  if (!String(message || "").trim()) throw new Error("Escribe comentario.");
  return addDoc(commentsRef(projectId, documentId), {
    pageId, elementId, message: String(message).trim(), status: "open",
    createdBy: { uid: editorialUserId(user), name: user?.name || "", email: user?.email || "" },
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
}

export async function setEditorialCommentStatus({ projectId, documentId, commentId, status, user }) {
  await updateDoc(doc(commentsRef(projectId, documentId), commentId), {
    status: status === "resolved" ? "resolved" : "open", resolvedByUid: status === "resolved" ? editorialUserId(user) : "",
    resolvedAt: status === "resolved" ? serverTimestamp() : null, updatedAt: serverTimestamp(),
  });
}

export async function deleteEditorialComment({ projectId, documentId, commentId }) {
  await deleteDoc(doc(commentsRef(projectId, documentId), commentId));
}
