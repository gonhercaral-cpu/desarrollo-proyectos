export const MATERIAL_CORRECTION_TIME_ZONE = "America/Tijuana";

export const REPORTER_POSITION_OPTIONS = [
  { value: "director", label: "Director" },
  { value: "subdirector", label: "Subdirector" },
  { value: "academic_coordinator", label: "Coordinador académico" },
  { value: "other", label: "Otro" },
];

export const MATERIAL_TYPE_OPTIONS = [
  { value: "student_book", label: "Libro del alumno" },
  { value: "teacher_book", label: "Libro del maestro" },
  { value: "slide", label: "Diapositiva" },
  { value: "song", label: "Canción" },
  { value: "audio", label: "Audio" },
  { value: "video", label: "Video" },
  { value: "activity_sheet", label: "Hoja de actividades" },
  { value: "exam", label: "Examen" },
  { value: "answers", label: "Respuestas" },
  { value: "other", label: "Otro" },
];

export const ERROR_TYPE_OPTIONS = [
  { value: "spelling", label: "Ortografía" },
  { value: "grammar", label: "Gramática" },
  { value: "typo", label: "Error de dedo" },
  { value: "incorrect_answer", label: "Respuesta incorrecta" },
  { value: "incorrect_or_confusing_instruction", label: "Instrucción incorrecta o confusa" },
  { value: "incorrect_translation", label: "Traducción incorrecta" },
  { value: "design_or_format", label: "Diseño o formato" },
  { value: "incorrect_image", label: "Imagen incorrecta" },
  { value: "incorrect_audio", label: "Audio incorrecto" },
  { value: "missing_content", label: "Contenido faltante" },
  { value: "duplicate_content", label: "Contenido duplicado" },
  { value: "broken_link", label: "Enlace dañado" },
  { value: "other", label: "Otro" },
];

export const MATERIAL_CORRECTION_STATUS_OPTIONS = [
  { value: "reported", label: "Reportado", publicLabel: "Recibido", rank: 0 },
  { value: "under_review", label: "En revisión", publicLabel: "En revisión", rank: 1 },
  { value: "needs_information", label: "Información requerida", publicLabel: "Se requiere información", rank: 2 },
  { value: "confirmed", label: "Confirmado", publicLabel: "Corrección programada", rank: 3 },
  { value: "in_correction", label: "En corrección", publicLabel: "En proceso", rank: 4 },
  { value: "corrected", label: "Corregido", publicLabel: "Corregido, pendiente de publicación", rank: 5 },
  { value: "publishing", label: "En publicación", publicLabel: "Actualizando materiales", rank: 6 },
  { value: "completed", label: "Completado", publicLabel: "Completado", rank: 7 },
  { value: "dismissed", label: "Descartado", publicLabel: "No se requiere corrección", rank: 8 },
  { value: "duplicate", label: "Duplicado", publicLabel: "Relacionado con otro reporte", rank: 9 },
];

export const MATERIAL_CORRECTION_PRIORITY_OPTIONS = [
  { value: "low", label: "Baja", rank: 0 },
  { value: "normal", label: "Normal", rank: 1 },
  { value: "high", label: "Alta", rank: 2 },
  { value: "urgent", label: "Urgente", rank: 3 },
];

export const DISTRIBUTION_DESTINATIONS = [
  { key: "sourceFile", label: "Archivo fuente corregido" },
  { key: "inPersonDrive", label: "Drive para clases presenciales" },
  { key: "onlineDrive", label: "Drive para clases en línea" },
  { key: "platform", label: "Plataforma o sistema" },
  { key: "futurePrint", label: "Material impreso futuro" },
];

export const DISTRIBUTION_STATUS_OPTIONS = [
  { value: "pending", label: "Pendiente" },
  { value: "not_applicable", label: "No aplica" },
  { value: "completed", label: "Publicado / completado" },
];

export const MATERIAL_CORRECTION_SORT_OPTIONS = [
  { value: "recent", label: "Más recientes" },
  { value: "oldest", label: "Más antiguos" },
  { value: "priority", label: "Prioridad" },
  { value: "level", label: "Nivel" },
  { value: "unit", label: "Unidad" },
  { value: "status", label: "Estado" },
  { value: "assigned", label: "Responsable" },
  { value: "manual", label: "Orden manual" },
];

export const MATERIAL_CORRECTION_GROUP_OPTIONS = [
  { value: "none", label: "Sin agrupar" },
  { value: "level", label: "Nivel" },
  { value: "book", label: "Libro" },
  { value: "unit", label: "Unidad" },
  { value: "material", label: "Material" },
  { value: "status", label: "Estado" },
  { value: "assigned", label: "Responsable" },
];

export const MATERIAL_LOCATION_FIELDS = {
  student_book: ["pageNumber", "exerciseNumber", "questionNumber"],
  teacher_book: ["pageNumber", "exerciseNumber", "questionNumber"],
  slide: ["slideNumber"],
  song: ["songName", "timestamp"],
  audio: ["timestamp"],
  video: ["timestamp"],
  activity_sheet: ["pageNumber", "exerciseNumber", "questionNumber"],
  exam: ["pageNumber", "exerciseNumber", "questionNumber"],
  answers: ["pageNumber", "exerciseNumber", "questionNumber"],
  other: ["pageNumber", "timestamp"],
};

export const EVIDENCE_FILE_POLICIES = {
  jpg: { types: ["image/jpeg"], maxBytes: 10 * 1024 * 1024 },
  jpeg: { types: ["image/jpeg"], maxBytes: 10 * 1024 * 1024 },
  png: { types: ["image/png"], maxBytes: 10 * 1024 * 1024 },
  webp: { types: ["image/webp"], maxBytes: 10 * 1024 * 1024 },
  pdf: { types: ["application/pdf"], maxBytes: 20 * 1024 * 1024 },
  mp3: { types: ["audio/mpeg", "audio/mp3"], maxBytes: 25 * 1024 * 1024 },
  m4a: { types: ["audio/mp4", "audio/x-m4a"], maxBytes: 25 * 1024 * 1024 },
  wav: { types: ["audio/wav", "audio/x-wav"], maxBytes: 25 * 1024 * 1024 },
  ogg: { types: ["audio/ogg"], maxBytes: 25 * 1024 * 1024 },
  mp4: { types: ["video/mp4"], maxBytes: 100 * 1024 * 1024 },
  mov: { types: ["video/quicktime"], maxBytes: 100 * 1024 * 1024 },
  webm: { types: ["video/webm"], maxBytes: 100 * 1024 * 1024 },
};

export const INTERNAL_CORRECTED_FILE_POLICIES = {
  ...EVIDENCE_FILE_POLICIES,
  docx: {
    types: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    maxBytes: 100 * 1024 * 1024,
  },
  pptx: {
    types: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    maxBytes: 100 * 1024 * 1024,
  },
  xlsx: {
    types: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    maxBytes: 100 * 1024 * 1024,
  },
  zip: {
    types: ["application/zip", "application/x-zip-compressed"],
    maxBytes: 100 * 1024 * 1024,
  },
};

export const PUBLIC_PROGRESS_STATUSES = [
  "reported",
  "under_review",
  "confirmed",
  "in_correction",
  "corrected",
  "publishing",
  "completed",
];
