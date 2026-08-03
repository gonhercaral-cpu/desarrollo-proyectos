const { createHash } = require("node:crypto");

const NOTIFICATION_TYPES = Object.freeze({
  PROJECT_ASSIGNED: "project_assigned",
  PROJECT_UPDATED: "project_updated",
  PROJECT_COMMENT: "project_comment",
  PROJECT_STATUS_CHANGED: "project_status_changed",
  PROJECT_DUE_DATE_CHANGED: "project_due_date_changed",
  PRINT_REQUEST_ASSIGNED: "print_request_assigned",
  PRINT_REQUEST_UPDATED: "print_request_updated",
  PRODUCTION_BATCH_ASSIGNED: "production_batch_assigned",
  PRODUCTION_BATCH_UPDATED: "production_batch_updated",
  PRODUCTION_BATCH_STAGE_CHANGED: "production_batch_stage_changed",
  QUALITY_AUDIT_ASSIGNED: "quality_audit_assigned",
});

function cleanText(value) {
  return String(value || "").trim();
}

function getStringList(value) {
  return Array.isArray(value)
    ? value.map(cleanText).filter(Boolean)
    : [];
}

function addRecipient(target, value) {
  if (Array.isArray(value)) {
    value.forEach((item) => addRecipient(target, item));
    return;
  }
  const uid = cleanText(value);
  if (uid) target.add(uid);
}

function addNestedAssignmentRecipients(target, items) {
  if (!Array.isArray(items)) return;
  items.forEach((item) => {
    if (!item || typeof item !== "object") return;
    [
      item.responsibleUid,
      item.assignedToUid,
      item.assigneeUid,
      item.ownerUid,
      item.userId,
      item.responsibleUids,
      item.assignedUserIds,
    ].forEach((value) => addRecipient(target, value));
  });
}

function collectProjectRecipients(project = {}) {
  const recipients = new Set();
  [
    project.assignedToUid,
    project.assignedToId,
    project.responsibleUid,
    project.responsibleId,
    project.collaboratorIds,
    project.collaboratorUids,
    project.collaboratorsIds,
    project.responsibleIds,
    project.activityResponsibleUids,
    project.deliverableResponsibleUids,
  ].forEach((value) => addRecipient(recipients, value));
  addNestedAssignmentRecipients(recipients, project.activities);
  addNestedAssignmentRecipients(recipients, project.activity);
  addNestedAssignmentRecipients(recipients, project.deliverables);
  return recipients;
}

function collectPrintRequestRecipients(printRequest = {}) {
  const recipients = new Set();
  [
    printRequest.assignedUserId,
    printRequest.responsibleUid,
    printRequest.assignedToUid,
    printRequest.productionAssigneeUid,
    printRequest.assignedCollaboratorUid,
    printRequest.responsibleId,
    printRequest.collaboratorUid,
    printRequest.collaboratorId,
    printRequest.supportCollaboratorUid,
    printRequest.supportUid,
    printRequest.supportUserIds,
    printRequest.supportCollaboratorIds,
    printRequest.collaboratorUids,
    printRequest.collaboratorIds,
  ].forEach((value) => addRecipient(recipients, value));
  return recipients;
}

function collectBatchRecipients(batch = {}) {
  const recipients = new Set();
  addRecipient(recipients, batch.responsibleUid);
  addRecipient(recipients, batch.auditorUid);
  return recipients;
}

function getActor(data = {}, event = {}) {
  return {
    uid: cleanText(
      event.authId
      || data.updatedByUid
      || data.modifiedByUid
      || data.lastUpdatedByUid
      || data.createdByUid
      || data.transferredByUid
    ),
    name: cleanText(
      data.updatedByName
      || data.modifiedByName
      || data.lastUpdatedByName
      || data.createdByName
      || data.transferredByName
      || "Sistema"
    ),
    photoURL: cleanText(data.updatedByPhotoURL || data.actorPhotoURL),
  };
}

function getEntityName(data = {}, fallback = "") {
  return cleanText(
    data.name
    || data.title
    || data.projectName
    || data.requestTitle
    || data.productName
    || data.folio
    || fallback
  );
}

function deduplicationDocumentId(key) {
  return createHash("sha256").update(cleanText(key)).digest("hex");
}

function buildNotificationDocument(event, recipientId, fieldValue) {
  const createdAt = fieldValue.serverTimestamp();
  return {
    recipientId,
    type: event.type,
    module: event.module,
    title: cleanText(event.title).slice(0, 140),
    message: cleanText(event.message).slice(0, 600),
    entityType: event.entityType,
    entityId: event.entityId,
    entityName: cleanText(event.entityName).slice(0, 180),
    route: cleanText(event.route),
    actorId: cleanText(event.actor?.uid),
    actorName: cleanText(event.actor?.name || "Sistema").slice(0, 120),
    actorPhotoURL: cleanText(event.actor?.photoURL),
    read: false,
    acknowledged: false,
    priority: event.priority || "normal",
    deduplicationKey: event.deduplicationKey,
    metadata: event.metadata || {},
    createdAt,
    updatedAt: createdAt,

    // Compatibilidad con consumidores anteriores.
    tipo: event.type,
    titulo: cleanText(event.title).slice(0, 140),
    mensaje: cleanText(event.message).slice(0, 600),
    projectId: event.entityType === "project" ? event.entityId : "",
    ...(event.legacyFields || {}),
  };
}

async function createDeduplicatedNotifications(db, fieldValue, event, recipients) {
  const actorUid = cleanText(event.actor?.uid);
  const uniqueRecipients = [...new Set([...recipients].map(cleanText).filter(Boolean))]
    .filter((recipientId) => recipientId !== actorUid);
  if (!event.entityId || uniqueRecipients.length === 0) return 0;

  let created = 0;
  await Promise.all(uniqueRecipients.map(async (recipientId) => {
    const key = `${event.deduplicationKey}:${recipientId}`;
    const notificationRef = db.collection("notifications").doc(deduplicationDocumentId(key));
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(notificationRef);
      if (snapshot.exists) return;
      transaction.create(notificationRef, buildNotificationDocument({
        ...event,
        deduplicationKey: key,
      }, recipientId, fieldValue));
      created += 1;
    });
  }));
  return created;
}

function changed(before, after, field) {
  return JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after?.[field] ?? null);
}

function addedRecipients(beforeRecipients, afterRecipients) {
  return new Set([...afterRecipients].filter((uid) => !beforeRecipients.has(uid)));
}

async function handleProjectNotificationWrite(db, fieldValue, event) {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  if (!after || after.deleted === true) return;
  const projectId = event.params.projectId;
  const name = getEntityName(after, "Proyecto");
  const route = `/?page=project-detail&projectId=${encodeURIComponent(projectId)}`;
  const actor = getActor(after, event);
  const recipients = collectProjectRecipients(after);
  const version = cleanText(after.updatedAt?.toMillis?.() || after.updatedAt?._seconds || event.id);

  if (!before) {
    await createDeduplicatedNotifications(db, fieldValue, {
      type: NOTIFICATION_TYPES.PROJECT_ASSIGNED,
      module: "projects",
      title: "Nuevo proyecto asignado",
      message: `Se te asignó el proyecto “${name}”.`,
      entityType: "project",
      entityId: projectId,
      entityName: name,
      route,
      actor,
      priority: after.priority === "Alta" ? "important" : "normal",
      deduplicationKey: `project_assigned:${projectId}:created`,
      metadata: { status: cleanText(after.status), role: "member" },
    }, recipients);
    return;
  }

  const previousRecipients = collectProjectRecipients(before);
  const newRecipients = addedRecipients(previousRecipients, recipients);
  if (newRecipients.size > 0) {
    await createDeduplicatedNotifications(db, fieldValue, {
      type: NOTIFICATION_TYPES.PROJECT_ASSIGNED,
      module: "projects",
      title: "Nuevo proyecto asignado",
      message: `Se te asignó el proyecto “${name}”.`,
      entityType: "project",
      entityId: projectId,
      entityName: name,
      route,
      actor,
      priority: after.priority === "Alta" ? "important" : "normal",
      deduplicationKey: `project_assigned:${projectId}:${version || [...newRecipients].join("-")}`,
      metadata: { role: "member" },
    }, newRecipients);
  }

  const events = [];
  if (changed(before, after, "status")) {
    events.push({
      type: NOTIFICATION_TYPES.PROJECT_STATUS_CHANGED,
      title: "Estado de proyecto actualizado",
      message: `“${name}” cambió de ${cleanText(before.status) || "sin estado"} a ${cleanText(after.status) || "sin estado"}.`,
      key: `status:${cleanText(after.status)}`,
      priority: ["Pausado", "Detenido", "Bloqueado"].includes(after.status) ? "urgent" : "important",
      metadata: { previousStatus: cleanText(before.status), status: cleanText(after.status) },
    });
  }
  if (changed(before, after, "deadline")) {
    events.push({
      type: NOTIFICATION_TYPES.PROJECT_DUE_DATE_CHANGED,
      title: "Fecha límite actualizada",
      message: `La fecha límite de “${name}” cambió a ${cleanText(after.deadline) || "sin fecha"}.`,
      key: `deadline:${cleanText(after.deadline)}`,
      priority: "important",
      metadata: { previousDueDate: cleanText(before.deadline), dueDate: cleanText(after.deadline) },
    });
  }
  if (changed(before, after, "priority")) {
    events.push({
      type: NOTIFICATION_TYPES.PROJECT_UPDATED,
      title: "Prioridad de proyecto actualizada",
      message: `“${name}” ahora tiene prioridad ${cleanText(after.priority) || "sin definir"}.`,
      key: `priority:${cleanText(after.priority)}`,
      priority: after.priority === "Alta" ? "urgent" : "important",
      metadata: { previousPriority: cleanText(before.priority), priority: cleanText(after.priority) },
    });
  }
  if (["reviewRequestedAt", "reviewStatus", "blockedReason", "reactivatedAt", "activities", "deliverables"]
    .some((field) => changed(before, after, field))) {
    events.push({
      type: NOTIFICATION_TYPES.PROJECT_UPDATED,
      title: changed(before, after, "reviewRequestedAt") ? "RevisiÃ³n solicitada" : "Proyecto actualizado",
      message: `â€œ${name}â€ tiene una actualizaciÃ³n relevante que requiere revisiÃ³n.`,
      key: `relevant:${version}`,
      priority: changed(before, after, "blockedReason") || changed(before, after, "reviewRequestedAt")
        ? "important"
        : "normal",
      metadata: { reviewStatus: cleanText(after.reviewStatus), blockedReason: cleanText(after.blockedReason) },
    });
  }

  await Promise.all(events.map((item) => createDeduplicatedNotifications(db, fieldValue, {
    ...item,
    module: "projects",
    entityType: "project",
    entityId: projectId,
    entityName: name,
    route,
    actor,
    deduplicationKey: `project:${projectId}:${item.key}:${version}`,
  }, recipients)));
}

async function handleProjectCommentCreated(db, fieldValue, event) {
  const comment = event.data?.data();
  if (!comment) return;
  const projectId = cleanText(comment.projectId || event.params.projectId);
  if (!projectId) return;
  const projectSnapshot = await db.collection("projects").doc(projectId).get();
  if (!projectSnapshot.exists) return;
  const project = projectSnapshot.data();
  const actor = {
    uid: cleanText(event.authId || comment.createdByUid || comment.userId),
    name: cleanText(comment.createdByName || comment.userName || "Un colaborador"),
    photoURL: cleanText(comment.actorPhotoURL),
  };
  const name = getEntityName(project, "Proyecto");
  await createDeduplicatedNotifications(db, fieldValue, {
    type: NOTIFICATION_TYPES.PROJECT_COMMENT,
    module: "projects",
    title: "Nuevo comentario en proyecto",
    message: `${actor.name} comentó en “${name}”.`,
    entityType: "project",
    entityId: projectId,
    entityName: name,
    route: `/?page=project-detail&projectId=${encodeURIComponent(projectId)}`,
    actor,
    priority: "normal",
    deduplicationKey: `project_comment:${projectId}:${event.params.commentId}`,
    metadata: { commentId: event.params.commentId },
  }, collectProjectRecipients(project));
}

async function handlePrintRequestNotificationWrite(db, fieldValue, event) {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  if (!after || after.deleted === true) return;
  const requestId = event.params.requestId;
  const name = getEntityName(after, "Solicitud de Imprenta");
  const folio = cleanText(after.folio || after.requestFolio || requestId);
  const route = `/?page=print-shop&printTab=requests&requestId=${encodeURIComponent(requestId)}`;
  const actor = getActor(after, event);
  const recipients = collectPrintRequestRecipients(after);
  const previousRecipients = collectPrintRequestRecipients(before || {});
  const assignments = before ? addedRecipients(previousRecipients, recipients) : recipients;
  const version = cleanText(after.updatedAt?.toMillis?.() || after.updatedAt?._seconds || event.id);

  if (assignments.size > 0) {
    await createDeduplicatedNotifications(db, fieldValue, {
      type: NOTIFICATION_TYPES.PRINT_REQUEST_ASSIGNED,
      module: "printing",
      title: "Nueva solicitud de Imprenta",
      message: `Se te asignó la solicitud “${name}” con folio ${folio}.`,
      entityType: "printRequest",
      entityId: requestId,
      entityName: name,
      route,
      actor,
      priority: after.urgent === true || after.priority === "Urgente" ? "urgent" : "important",
      deduplicationKey: `print_request_assigned:${requestId}:${version || "created"}`,
      metadata: { folio, status: cleanText(after.status) },
    }, assignments);
  }

  if (before && ["status", "commitmentDate", "dueDate", "urgent", "priority", "requiresRegeneration", "students"]
    .some((field) => changed(before, after, field))) {
    await createDeduplicatedNotifications(db, fieldValue, {
      type: NOTIFICATION_TYPES.PRINT_REQUEST_UPDATED,
      module: "printing",
      title: "Solicitud de Imprenta actualizada",
      message: `La solicitud ${folio} requiere revisión. Estado: ${cleanText(after.status) || "sin estado"}.`,
      entityType: "printRequest",
      entityId: requestId,
      entityName: name,
      route,
      actor,
      priority: after.urgent === true || after.priority === "Urgente" ? "urgent" : "important",
      deduplicationKey: `print_request_updated:${requestId}:${version}:${cleanText(after.status)}`,
      metadata: { folio, status: cleanText(after.status) },
    }, recipients);
  }
}

async function handleProductionBatchNotificationWrite(db, fieldValue, event) {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  if (!after || after.deleted === true) return;
  const batchId = event.params.batchId;
  const folio = cleanText(after.folio || after.batchFolio || batchId);
  const productName = cleanText(after.productName || after.product || "producto");
  const route = `/?page=print-shop&printTab=batches&batchId=${encodeURIComponent(batchId)}`;
  const actor = getActor(after, event);
  const version = cleanText(after.updatedAt?.toMillis?.() || after.updatedAt?._seconds || event.id);

  const previousResponsible = cleanText(before?.responsibleUid);
  const nextResponsible = cleanText(after.responsibleUid);
  if (nextResponsible && nextResponsible !== previousResponsible) {
    await createDeduplicatedNotifications(db, fieldValue, {
      type: NOTIFICATION_TYPES.PRODUCTION_BATCH_ASSIGNED,
      module: "printing",
      title: "Nuevo lote asignado",
      message: `Se te asignó el lote ${folio} para producir “${productName}”.`,
      entityType: "productionBatch",
      entityId: batchId,
      entityName: folio,
      route,
      actor,
      priority: "important",
      deduplicationKey: `production_batch_assigned:${batchId}:${nextResponsible}:${version}`,
      metadata: { role: "production", stage: cleanText(after.status), folio },
    }, new Set([nextResponsible]));
  }

  const previousAuditor = cleanText(before?.auditorUid);
  const nextAuditor = cleanText(after.auditorUid);
  if (nextAuditor && nextAuditor !== previousAuditor) {
    await createDeduplicatedNotifications(db, fieldValue, {
      type: NOTIFICATION_TYPES.QUALITY_AUDIT_ASSIGNED,
      module: "printing",
      title: "Auditoría asignada",
      message: `Se te asignó la revisión de calidad del lote ${folio}.`,
      entityType: "qualityAudit",
      entityId: batchId,
      entityName: folio,
      route,
      actor,
      priority: "important",
      deduplicationKey: `quality_audit_assigned:${batchId}:${nextAuditor}:${version}`,
      metadata: { role: "quality", stage: cleanText(after.status), folio },
    }, new Set([nextAuditor]));
  }

  if (before && changed(before, after, "status")) {
    const status = cleanText(after.status);
    const isQuality = ["quality_review", "En revisión de calidad", "Revisión de calidad"].includes(status);
    const recipients = isQuality && nextAuditor ? new Set([nextAuditor]) : collectBatchRecipients(after);
    await createDeduplicatedNotifications(db, fieldValue, {
      type: NOTIFICATION_TYPES.PRODUCTION_BATCH_STAGE_CHANGED,
      module: "printing",
      title: isQuality ? "Lote listo para auditoría" : "Etapa de lote actualizada",
      message: `El lote ${folio} cambió a ${status || "una nueva etapa"}.`,
      entityType: isQuality ? "qualityAudit" : "productionBatch",
      entityId: batchId,
      entityName: folio,
      route,
      actor,
      priority: ["rejected", "Rechazado", "blocked", "Bloqueado"].includes(status) ? "urgent" : "important",
      deduplicationKey: `production_batch_stage_changed:${batchId}:${status}:${version}`,
      metadata: { previousStage: cleanText(before.status), stage: status, folio },
    }, recipients);
  }

  if (before && [
    "plannedQuantity",
    "producedQuantity",
    "approvedQuantity",
    "rejectedQuantity",
    "dueDate",
    "estimatedCompletionAt",
    "incident",
    "incidents",
  ].some((field) => changed(before, after, field))) {
    await createDeduplicatedNotifications(db, fieldValue, {
      type: NOTIFICATION_TYPES.PRODUCTION_BATCH_UPDATED,
      module: "printing",
      title: "Lote de producciÃ³n actualizado",
      message: `El lote ${folio} registrÃ³ cambios de cantidad, fecha o incidencia.`,
      entityType: "productionBatch",
      entityId: batchId,
      entityName: folio,
      route,
      actor,
      priority: changed(before, after, "incident") || changed(before, after, "incidents") ? "urgent" : "important",
      deduplicationKey: `production_batch_updated:${batchId}:${version}`,
      metadata: {
        folio,
        plannedQuantity: Number(after.plannedQuantity || 0),
        producedQuantity: Number(after.producedQuantity || 0),
        dueDate: cleanText(after.dueDate),
      },
    }, collectBatchRecipients(after));
  }
}

async function createEditorialNotificationsFromCallable(db, fieldValue, input, actorUid) {
  const projectId = cleanText(input.projectId);
  if (!projectId || !actorUid) throw new Error("Falta proyecto editorial o sesión.");
  const [projectSnapshot, actorSnapshot] = await Promise.all([
    db.collection("editorialProjects").doc(projectId).get(),
    db.collection("users").doc(actorUid).get(),
  ]);
  if (!projectSnapshot.exists || !actorSnapshot.exists || actorSnapshot.data().active !== true) {
    throw new Error("Proyecto editorial o perfil no disponible.");
  }
  const project = { id: projectId, ...projectSnapshot.data() };
  const actorProfile = actorSnapshot.data();
  const permissions = project.editorialPermissions?.users || {};
  const collaborators = new Set(getStringList(project.collaboratorUids));
  const allowed = actorProfile.role === "admin"
    || project.ownerUid === actorUid
    || collaborators.has(actorUid)
    || Boolean(permissions[actorUid]);
  if (!allowed) throw new Error("No tienes acceso al proyecto editorial.");
  const recipients = new Set([project.ownerUid, ...collaborators, ...Object.keys(permissions)]);
  getStringList(input.extraRecipientUids).forEach((uid) => {
    if (uid === project.ownerUid || collaborators.has(uid) || permissions[uid]) recipients.add(uid);
  });
  const type = cleanText(input.type, 60);
  const actor = {
    uid: actorUid,
    name: cleanText(actorProfile.name || actorProfile.email, 120),
    photoURL: cleanText(actorProfile.photoURL, 1000),
  };
  return createDeduplicatedNotifications(db, fieldValue, {
    type,
    module: "projects",
    title: cleanText(input.title || "Actualización editorial", 140),
    message: cleanText(input.message, 600),
    entityType: "project",
    entityId: projectId,
    entityName: getEntityName(project, "Proyecto editorial"),
    route: cleanText(input.link || `/editorial/${projectId}`, 1000),
    actor,
    priority: "normal",
    deduplicationKey: cleanText(input.deduplicationKey || `editorial:${type}:${projectId}:${input.documentId || "project"}`, 500),
    metadata: { editorial: true, documentId: cleanText(input.documentId, 180) },
    legacyFields: {
      editorialProjectId: projectId,
      editorialDocumentId: cleanText(input.documentId, 180),
      link: cleanText(input.link, 1000),
    },
  }, recipients);
}

module.exports = {
  NOTIFICATION_TYPES,
  collectBatchRecipients,
  collectPrintRequestRecipients,
  collectProjectRecipients,
  createEditorialNotificationsFromCallable,
  createDeduplicatedNotifications,
  handlePrintRequestNotificationWrite,
  handleProductionBatchNotificationWrite,
  handleProjectCommentCreated,
  handleProjectNotificationWrite,
};
