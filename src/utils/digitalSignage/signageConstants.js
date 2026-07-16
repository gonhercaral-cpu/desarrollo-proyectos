export const DIGITAL_SIGNAGE_PLANTELES = [
  "Plaza Estrella planta baja",
  "Plaza Estrella planta alta",
  "Plaza Bugambilias",
  "Plaza Aranjuez",
  "Coffee Beans Factory",
];

export const DEFAULT_DIGITAL_SIGNAGE_PLANTEL = DIGITAL_SIGNAGE_PLANTELES[0];

export const ASSET_TYPES = ["image", "video", "web", "template", "visual_ad"];
export const TEMPLATE_KEYS = ["aviso", "promocion", "evento", "coffee", "bienvenida"];
export const TEMPLATE_THEMES = ["azul", "verde", "dorado", "rojo", "cafe"];
export const VISUAL_TEMPLATE_CATEGORY_VALUES = [
  "institucional",
  "promocion",
  "aviso",
  "coffee",
  "evento",
  "otro",
];
export const ASSET_CATEGORY_VALUES = VISUAL_TEMPLATE_CATEGORY_VALUES;
export const PUBLISH_STATUSES = ["draft", "review", "published", "archived"];
export const CAMPAIGN_PRIORITIES = ["urgente", "alta", "normal"];
export const WEB_MODES = ["iframe", "redirect"];
export const WEB_COMMAND_TYPES = ["reload", "refresh-url"];
export const PLAYBACK_EVENT_TYPES = [
  "play_start",
  "play_end",
  "play_error",
  "playlist_resolved",
  "no_content",
  "offline_cache",
  "heartbeat_status",
];
export const PLAYBACK_ASSET_TYPES = ["image", "video", "web", "template", "visual_ad"];
export const PLAYBACK_SOURCES = ["campaign", "devicePlaylist", "lastGoodManifest", "offlineCache"];

export const WEEKDAY_OPTIONS = [
  { value: 0, label: "Domingo", short: "Dom" },
  { value: 1, label: "Lunes", short: "Lun" },
  { value: 2, label: "Martes", short: "Mar" },
  { value: 3, label: "Miércoles", short: "Mié" },
  { value: 4, label: "Jueves", short: "Jue" },
  { value: 5, label: "Viernes", short: "Vie" },
  { value: 6, label: "Sábado", short: "Sáb" },
];

export const SIGNAGE_TABS = [
  { key: "library", label: "Biblioteca", icon: "library" },
  { key: "playlists", label: "Playlists", icon: "list" },
  { key: "campaigns", label: "Campañas", icon: "calendar" },
  { key: "devices", label: "Dispositivos", icon: "screen" },
  { key: "health", label: "Salud", icon: "chart" },
  { key: "preview", label: "Vista previa", icon: "eye" },
  { key: "playback", label: "Reproducción", icon: "play" },
  { key: "history", label: "Historial", icon: "history" },
];

export const PLAYBACK_EVENT_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "playlist_resolved", label: "Playlist resuelta" },
  { value: "play_start", label: "Iniciadas" },
  { value: "play_end", label: "Finalizadas" },
  { value: "play_error", label: "Errores" },
  { value: "no_content", label: "Sin contenido" },
  { value: "offline_cache", label: "Caché offline" },
];

export const PLAYBACK_ASSET_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "image", label: "Imagen" },
  { value: "video", label: "Video" },
  { value: "web", label: "Web" },
  { value: "template", label: "Plantilla" },
  { value: "visual_ad", label: "Anuncio visual" },
];

export const AUDIT_ENTITY_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "content", label: "Contenido" },
  { value: "playlists", label: "Playlists" },
  { value: "campaigns", label: "Campañas" },
  { value: "devices", label: "Dispositivos" },
  { value: "imports", label: "Importaciones" },
  { value: "web", label: "Web" },
];

export const AUDIT_RANGE_FILTERS = [
  { value: "today", label: "Hoy" },
  { value: "7", label: "7 días" },
  { value: "30", label: "30 días" },
];

export const TEMPLATE_OPTIONS = [
  { value: "aviso", label: "Aviso" },
  { value: "promocion", label: "Promoción" },
  { value: "evento", label: "Evento" },
  { value: "coffee", label: "Coffee Beans" },
  { value: "bienvenida", label: "Bienvenida" },
];

export const TEMPLATE_THEME_OPTIONS = [
  { value: "azul", label: "Azul institucional" },
  { value: "verde", label: "Verde" },
  { value: "dorado", label: "Dorado" },
  { value: "rojo", label: "Rojo" },
  { value: "cafe", label: "Café" },
];

export const VISUAL_TEMPLATE_CATEGORIES = [
  { value: "institucional", label: "Institucional" },
  { value: "promocion", label: "Promoción" },
  { value: "aviso", label: "Aviso" },
  { value: "coffee", label: "Coffee" },
  { value: "evento", label: "Evento" },
  { value: "otro", label: "Otro" },
];

export const PUBLISH_STATUS_OPTIONS = [
  { value: "draft", label: "Borrador" },
  { value: "review", label: "En revisión" },
  { value: "published", label: "Publicado" },
  { value: "archived", label: "Archivado" },
];
