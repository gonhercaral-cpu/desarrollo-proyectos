export const ACADEMIC_TYPES = [
  "book", "unit", "lesson", "activity", "worksheet", "song", "exam",
  "teacher_guide", "extra_material", "answer_key",
];

export const ACADEMIC_TYPE_OPTIONS = [
  ["", "Sin tipo académico"], ["book", "Libro"], ["unit", "Unidad"],
  ["lesson", "Lección"], ["activity", "Actividad"], ["worksheet", "Hoja de trabajo"],
  ["song", "Canción"], ["exam", "Examen"], ["teacher_guide", "Guía docente"],
  ["extra_material", "Material extra"], ["answer_key", "Clave de respuestas"],
].map(([value, label]) => ({ value, label }));

export const ACADEMIC_VISIBILITY_MODES = ["student", "teacher", "both"];
export const EXERCISE_TYPES = ["multiple_choice", "fill_blanks", "true_false", "matching", "open_questions"];

export const ACADEMIC_BLOCKS = [
  ["activity_header", "Encabezado de actividad"],
  ["exercise_number", "Número de ejercicio"],
  ["instructions", "Instrucciones"],
  ["student_info", "Nombre, grupo y fecha"],
  ["vocabulary_box", "Caja de vocabulario"],
  ["word_bank", "Banco de palabras"],
  ["grammar_box", "Cuadro de gramática"],
  ["example_box", "Cuadro de ejemplo"],
  ["writing_space", "Espacio para escritura"],
  ["answer_lines", "Líneas de respuesta"],
  ["multiple_choice", "Opción múltiple"],
  ["true_false", "Verdadero o falso"],
  ["matching", "Relacionar columnas"],
  ["fill_blanks", "Completar espacios"],
  ["comprehension", "Preguntas de comprensión"],
  ["teacher_note", "Nota para maestro"],
  ["answers", "Respuestas"],
  ["audio_reference", "QR o referencia de audio"],
].map(([value, label]) => ({ value, label }));

export const ACADEMIC_METADATA_FIELDS = [
  "seriesId", "seriesName", "levelId", "levelName", "bookId", "bookName",
  "unitNumber", "unitTitle", "lessonNumber", "lessonTitle", "academicType",
  "activityNumber",
];

export function normalizeAcademicMetadata(source = {}) {
  const metadata = {};
  ACADEMIC_METADATA_FIELDS.forEach((field) => {
    const value = source?.academicMetadata?.[field] ?? source?.[field];
    if (value === undefined || value === null || value === "") return;
    metadata[field] = ["unitNumber", "lessonNumber", "activityNumber"].includes(field)
      ? Number(value)
      : String(value);
  });
  return metadata;
}

export function toAcademicPersistenceFields(values = {}) {
  const normalized = normalizeAcademicMetadata(values);
  return {
    ...Object.fromEntries(ACADEMIC_METADATA_FIELDS.map((field) => [field, normalized[field] ?? ""])),
    academicMetadata: normalized,
  };
}

export function getAcademicTypeLabel(type) {
  return ACADEMIC_TYPE_OPTIONS.find((option) => option.value === type)?.label || "Personalizado";
}
