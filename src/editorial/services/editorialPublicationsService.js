import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { createEditorialEventNotifications } from "../../services/notificationsService";
import { buildPublicationPayload, canTransitionPublication, findImmutableViolations, nextPublicationRevision, normalizePublication } from "../models/editorialPublication";
import { buildDedupeKey, buildEditorialLink } from "../utils/editorialNotifications";
import { getEditorialDocumentRef } from "./editorialPagesService";

async function notifyPublication({ project, documentId, type, title, message, user, targetId }) {
  if (!project?.id) return;
  try {
    await createEditorialEventNotifications({
      project,
      documentId,
      type,
      title,
      message,
      actorUid: String(user?.uid || user?.id || ""),
      actorName: String(user?.name || user?.email || "Usuario"),
      actorIsAdmin: String(user?.role || "").toLowerCase() === "admin",
      dedupeKey: buildDedupeKey({ type, editorialProjectId: project.id, editorialDocumentId: documentId, targetId }),
      link: buildEditorialLink({ editorialProjectId: project.id, editorialDocumentId: documentId }),
    });
  } catch (error) {
    console.warn("No se pudieron generar notificaciones editoriales:", error);
  }
}

function publicationsRef(projectId, documentId) {
  return collection(getEditorialDocumentRef(projectId, documentId), "publications");
}

export function subscribeEditorialPublications({ projectId, documentId, onChange, onError }) {
  if (!projectId || !documentId) { onChange([]); return () => {}; }
  return onSnapshot(
    query(publicationsRef(projectId, documentId), orderBy("revision", "desc")),
    (snapshot) => onChange(snapshot.docs.map((item) => normalizePublication({ id: item.id, ...item.data() }))),
    onError
  );
}

// Publica una revisión inmutable: congela snapshot (versión) + exportaciones
// terminadas. La revisión se calcula desde las publicaciones existentes.
export async function createEditorialPublication({ projectId, documentId, project, version, exports, variant, reviewStatus, notes = "", publications = [], user }) {
  const revision = nextPublicationRevision(publications);
  const payload = buildPublicationPayload({
    documentId,
    version,
    exports,
    variant,
    revision,
    reviewStatus,
    notes,
    user,
  });
  const created = await addDoc(publicationsRef(projectId, documentId), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await notifyPublication({
    project: project || { id: projectId },
    documentId,
    type: "EDITORIAL_PUBLISHED",
    title: "Documento publicado",
    message: `Se publicó la revisión ${revision} (${variant}).`,
    user,
    targetId: created.id,
  });
  return created.id;
}

// Actualiza SÓLO campos mutables (status, notes). Rechaza cambios inmutables.
async function updatePublicationSafe({ projectId, documentId, publication, changes, user }) {
  const violations = findImmutableViolations(publication, changes);
  if (violations.length) {
    throw new Error(`No se pueden modificar campos inmutables de una publicación: ${violations.join(", ")}.`);
  }
  await updateDoc(doc(publicationsRef(projectId, documentId), publication.id), {
    ...changes,
    updatedByUid: String(user?.uid || user?.id || ""),
    updatedByName: String(user?.name || user?.email || "Usuario"),
    updatedAt: serverTimestamp(),
  });
}

function transitionOrThrow(publication, nextStatus) {
  if (!canTransitionPublication(publication.status, nextStatus)) {
    throw new Error(`Transición no permitida: ${publication.status} → ${nextStatus}.`);
  }
}

// Despublica sin eliminar historial.
export async function unpublishEditorialPublication({ projectId, documentId, project, publication, user }) {
  transitionOrThrow(publication, "unpublished_after_release");
  await updatePublicationSafe({ projectId, documentId, publication, changes: { status: "unpublished_after_release" }, user });
  await notifyPublication({
    project: project || { id: projectId },
    documentId,
    type: "EDITORIAL_UNPUBLISHED",
    title: "Documento despublicado",
    message: `Se despublicó la revisión ${publication.revision}. El historial se conserva.`,
    user,
    targetId: publication.id,
  });
}

// Vuelve a publicar una revisión previamente despublicada.
export async function republishEditorialPublication({ projectId, documentId, publication, user }) {
  transitionOrThrow(publication, "published");
  await updatePublicationSafe({ projectId, documentId, publication, changes: { status: "published" }, user });
}

// Archiva (conserva historial y dependencias).
export async function archiveEditorialPublication({ projectId, documentId, publication, user }) {
  transitionOrThrow(publication, "archived");
  await updatePublicationSafe({ projectId, documentId, publication, changes: { status: "archived" }, user });
}

export async function updateEditorialPublicationNotes({ projectId, documentId, publication, notes, user }) {
  await updatePublicationSafe({ projectId, documentId, publication, changes: { notes: String(notes || "") }, user });
}
