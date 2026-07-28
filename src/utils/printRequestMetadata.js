function firstRequestText(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;

    const normalized = value.trim();
    if (normalized) return normalized;
  }

  return "";
}

export function getRequestTeacherName(request, fallback = "No especificado") {
  return (
    firstRequestText(
      request?.teacherName,
      request?.teacherSignerName,
      request?.maestroNombre
    ) || fallback
  );
}

export function getRequestClassSchedule(request, fallback = "No especificado") {
  return (
    firstRequestText(
      request?.schedule,
      request?.groupSchedule,
      request?.horario
    ) || fallback
  );
}
