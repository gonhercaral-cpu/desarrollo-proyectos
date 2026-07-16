import { PUBLISH_STATUS_OPTIONS, PUBLISH_STATUSES } from "./signageConstants";

export function getPublishStatus(status = "") {
  return PUBLISH_STATUSES.includes(status) ? status : "published";
}

export function normalizePublishStatus(status = "", fallback = "published") {
  return PUBLISH_STATUSES.includes(status) ? status : fallback;
}

export function isPublished(status = "") {
  return getPublishStatus(status) === "published";
}

export function getPublishStatusLabel(status = "") {
  const normalizedStatus = getPublishStatus(status);
  return PUBLISH_STATUS_OPTIONS.find((option) => option.value === normalizedStatus)?.label || "Publicado";
}

export function getPublishStatusMessage(entityLabel, publishStatus) {
  const messages = {
    draft: `${entityLabel} guardado como borrador.`,
    review: `${entityLabel} enviado a revisión.`,
    published: `${entityLabel} publicado.`,
    archived: `${entityLabel} archivado.`,
  };

  return messages[publishStatus] || `${entityLabel} actualizado.`;
}
