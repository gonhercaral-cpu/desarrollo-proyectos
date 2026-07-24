function cleanReportText(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  return "";
}

function firstReportText(...values) {
  return values.map(cleanReportText).find(Boolean) || "";
}

export function isCertificateReportRequest(request = {}) {
  const type = firstReportText(
    request.requestType,
    request.type,
    request.productType,
    request.product?.type
  )
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return type === "certificado" || type === "certificados";
}

export function getCertificateReportTeacher(request = {}) {
  return firstReportText(
    request.teacherSignerName,
    request.teacherName,
    request.teacher?.name,
    request.teacherSigner?.name,
    request.group?.teacherName,
    request.group?.teacher?.name,
    request.certificate?.teacherSignerName,
    request.certificate?.teacherName,
    request.certificateData?.teacherName,
    request.certificateDetails?.teacherName,
    request.details?.teacherName,
    request.metadata?.teacherName
  ) || "Sin maestro registrado";
}

export function getCertificateReportSchedule(request = {}) {
  return firstReportText(
    request.schedule,
    request.groupSchedule,
    request.group?.schedule,
    request.group?.groupSchedule,
    request.certificate?.schedule,
    request.certificate?.groupSchedule,
    request.certificateData?.schedule,
    request.certificateData?.groupSchedule,
    request.certificateDetails?.schedule,
    request.details?.schedule,
    request.metadata?.schedule,
    request.metadata?.groupSchedule
  ) || "Sin horario registrado";
}
