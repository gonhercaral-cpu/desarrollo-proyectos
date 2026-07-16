import { normalizeSearch } from "./signageFormatters";

export function getPlaybackEventLabel(eventType = "") {
  const labels = {
    play_start: "Reproducción iniciada",
    play_end: "Reproducción finalizada",
    play_error: "Error de reproducción",
    playlist_resolved: "Playlist resuelta",
    no_content: "Sin contenido asignado",
    offline_cache: "Reproduciendo desde caché",
    heartbeat_status: "Estado del reproductor",
  };

  return labels[eventType] || "Evento";
}

export function getPlaybackEventTone(eventType = "") {
  const tones = {
    play_start: "play",
    play_end: "success",
    play_error: "error",
    playlist_resolved: "resolved",
    no_content: "warning",
    offline_cache: "offline",
    heartbeat_status: "device",
  };

  return tones[eventType] || "device";
}

export function getPlaybackSourceLabel(source = "") {
  const labels = {
    campaign: "Campaña",
    devicePlaylist: "Playlist fallback",
    lastGoodManifest: "Última versión guardada",
    offlineCache: "Copia local",
  };

  return labels[source] || source;
}

export function getAuditEntityLabel(entityType = "") {
  const labels = {
    asset: "Contenido",
    playlist: "Playlist",
    campaign: "Campaña",
    device: "Dispositivo",
    visual_template: "Plantilla visual",
    web_asset: "Web",
    nube_aes_import: "Nube AES",
    pairing: "Vinculación",
    system: "Sistema",
  };

  return labels[entityType] || "Sistema";
}

export function getAuditActionTone(action = "") {
  const normalizedAction = normalizeSearch(action);

  if (normalizedAction.includes("eliminar") || normalizedAction.includes("archivar")) return "error";
  if (normalizedAction.includes("publicar") || normalizedAction.includes("publishstatus")) return "success";
  if (normalizedAction.includes("importar") || normalizedAction.includes("nube")) return "resolved";
  if (normalizedAction.includes("asignar") || normalizedAction.includes("vincular")) return "play";
  if (normalizedAction.includes("quitar")) return "warning";
  if (normalizedAction.includes("editar") || normalizedAction.includes("duplicar")) return "offline";
  return "device";
}

export function isAuditPublishAction(log = {}) {
  const action = normalizeSearch(log.action);
  const status = normalizeSearch(log.details?.publishStatus);

  return action.includes("publishstatus") || status === "published";
}

export function isAuditRemovalAction(log = {}) {
  const action = normalizeSearch(log.action);
  return action.includes("eliminar") || action.includes("archivar");
}

export function getAuditActionLabel(action = "") {
  const labels = {
    "crear asset": "Contenido creado",
    "editar asset": "Contenido editado",
    "eliminar asset": "Contenido eliminado",
    "archivar asset": "Contenido archivado",
    "restaurar asset": "Contenido restaurado",
    "activar/desactivar asset": "Estado de contenido actualizado",
    "cambiar publishStatus asset": "Publicación de contenido actualizada",
    "importar desde Nube AES": "Contenido importado desde Nube AES",
    "crear asset web": "Asset web creado",
    "editar asset web": "Asset web editado",
    "enviar comando web": "Comando web enviado",
    "crear anuncio visual": "Anuncio visual creado",
    "editar anuncio visual": "Anuncio visual editado",
    "crear plantilla visual": "Plantilla visual creada",
    "editar plantilla visual": "Plantilla visual editada",
    "eliminar plantilla visual": "Plantilla visual eliminada",
    "activar/desactivar plantilla visual": "Estado de plantilla visual actualizado",
    "crear playlist": "Playlist creada",
    "editar playlist": "Playlist editada",
    "eliminar playlist": "Playlist eliminada",
    "duplicar playlist": "Playlist duplicada",
    "activar/desactivar playlist": "Estado de playlist actualizado",
    "cambiar publishStatus playlist": "Publicación de playlist actualizada",
    "agregar contenido a playlist": "Contenido agregado a playlist",
    "editar contenido de playlist": "Contenido de playlist actualizado",
    "crear campana": "Campaña creada",
    "editar campana": "Campaña editada",
    "eliminar campana": "Campaña eliminada",
    "activar/desactivar campana": "Estado de campaña actualizado",
    "cambiar publishStatus campana": "Campaña publicada",
    "crear dispositivo": "Dispositivo creado",
    "editar dispositivo": "Dispositivo editado",
    "eliminar dispositivo": "Dispositivo eliminado",
    "asignar playlist a dispositivo": "Playlist asignada a dispositivo",
    "quitar contenido de dispositivo": "Contenido quitado de dispositivo",
    "activar/desactivar dispositivo": "Estado de dispositivo actualizado",
    "vincular pantalla por codigo": "Pantalla vinculada",
  };

  return labels[action] || action || "Acción registrada";
}

export function getAuditDetailsSummary(details = {}) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return "Sin detalles";

  const preferredKeys = [
    "publishStatus",
    "previousStatus",
    "active",
    "plantel",
    "playlistId",
    "assignedPlaylistId",
    "sourceFileName",
    "sourceFolderName",
    "priority",
    "itemsCount",
    "type",
  ];
  const entries = preferredKeys
    .filter((key) => details[key] !== undefined && details[key] !== null && details[key] !== "")
    .map((key) => `${key}: ${Array.isArray(details[key]) ? details[key].join(", ") : details[key]}`);

  if (!entries.length) {
    return Object.keys(details).length ? `${Object.keys(details).length} detalle(s)` : "Sin detalles";
  }

  return entries.slice(0, 3).join(" · ");
}

export function getAuditToneLabel(tone = "") {
  const labels = {
    play: "Asignar",
    success: "Publicar",
    error: "Eliminar",
    warning: "Quitar",
    offline: "Editar",
    resolved: "Importar",
    device: "Actividad",
  };

  return labels[tone] || "Actividad";
}
