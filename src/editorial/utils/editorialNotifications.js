// Fase 7 — Notificaciones y registro de actividad (reutiliza el sistema global).
// Aquí sólo hay lógica pura: tipos editoriales, destinatarios sin duplicados,
// clave de deduplicación y enlace al contexto correcto. La escritura la hace el
// servicio reutilizando notificationsService/projectsService.

// Tipos de eventos editoriales que sí generan notificación/actividad.
// (Se registran sólo acciones importantes; nunca movimientos de Konva.)
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

export function isEditorialNotificationType(type) {
  return EDITORIAL_NOTIFICATION_TYPES.has(String(type || ""));
}

// Reúne destinatarios de un proyecto editorial: owner + colaboradores + niveles
// asignados, menos el actor. Devuelve arreglo sin duplicados.
export function collectEditorialRecipients({ project = {}, actorUid = "", extraUids = [] } = {}) {
  const set = new Set();
  const add = (value) => {
    if (typeof value === "string" && value.trim()) set.add(value.trim());
  };
  add(project.ownerUid);
  (Array.isArray(project.collaboratorUids) ? project.collaboratorUids : []).forEach(add);
  Object.keys(project.editorialPermissions?.users || {}).forEach(add);
  (Array.isArray(extraUids) ? extraUids : []).forEach(add);
  set.delete(String(actorUid || ""));
  return Array.from(set);
}

// Clave de deduplicación estable por evento+contexto. Dos llamadas con la misma
// clave para el mismo destinatario no deben producir dos notificaciones.
export function buildDedupeKey({ type, editorialProjectId, editorialDocumentId, targetId = "" } = {}) {
  return [type, editorialProjectId, editorialDocumentId, targetId].filter(Boolean).join(":");
}

// Filtra destinatarios que ya tienen una notificación con la misma dedupeKey.
// `existing` es la lista de notificaciones ya presentes (con recipientId +
// dedupeKey). Devuelve sólo los uids que faltan.
export function dedupeRecipients({ recipients = [], dedupeKey = "", existing = [] } = {}) {
  const already = new Set(
    (Array.isArray(existing) ? existing : [])
      .filter((item) => item && item.dedupeKey === dedupeKey)
      .map((item) => String(item.recipientId || ""))
  );
  const seen = new Set();
  return recipients.filter((uid) => {
    const id = String(uid || "");
    if (!id || already.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

// Enlace al contexto editorial correcto para la notificación.
export function buildEditorialLink({ editorialProjectId, editorialDocumentId } = {}) {
  const base = `/editorial/${editorialProjectId || ""}`;
  return editorialDocumentId ? `${base}?document=${editorialDocumentId}` : base;
}
